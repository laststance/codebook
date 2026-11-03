import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { StudyError } from '../errors'
import { FlatCdpCommandError } from '../runtimeSupport/flatCdpConnection'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  EXTENSION_ID,
  extensionEditorHarness,
  SURFACE_URL,
  type TestStop,
} from './utils/chromeExtensionEditorHarness'

/** The wake bound these tests run with; the real one is 5 s. */
const WAKE_BOUND_MS = 300
/** How far past the bound an end may land on a loaded machine (one poll pause, scheduler delay). */
const END_SLACK_MS = 700
const WORKER_STOP: TestStop = {
  file: 'service-worker.js',
  line: 3,
  context: 'service-worker',
}

/** Waits until a condition holds; the debugger classifies stops asynchronously. */
async function until(condition: () => boolean): Promise<void> {
  await waitUntil(condition, 'the condition to hold', 1_000, undefined, 2)
}

/** Attaches the debugger to the surface page and returns the editor and debugger of a wake test. */
async function attachedDebugger(
  overrides: Parameters<
    Awaited<ReturnType<typeof extensionEditorHarness>>['createDebugger']
  >[1] = {},
  /** Replaces the target read from the moment the test calls `beginWake`; the attach reads the real targets first. */
  readTargetsDuringWake?: NonNullable<
    NonNullable<
      Parameters<
        Awaited<ReturnType<typeof extensionEditorHarness>>['createDebugger']
      >[1]
    >['readTargets']
  >,
  /** The wake bound of this test; a test that must tell "refused at once" from "waited the bound" passes a longer one. */
  wakeBoundMs = WAKE_BOUND_MS,
) {
  const editor = await extensionEditorHarness({
    constants: { EXTENSION_WAKE_BOUND_MS: wakeBoundMs },
  })
  let isWaking = false
  const created = editor.createDebugger([WORKER_STOP], {
    ...overrides,
    ...(readTargetsDuringWake !== undefined && {
      readTargets: async (timeoutMs?: number) =>
        isWaking
          ? readTargetsDuringWake(timeoutMs)
          : [
              { targetId: 'surface-target', type: 'page', url: SURFACE_URL },
              {
                targetId: 'worker-target',
                type: 'service_worker',
                url: `chrome-extension://${EXTENSION_ID}/service-worker.js`,
              },
            ],
    }),
  })
  const attaching = created.debug.attach(AbortSignal.timeout(5_000))
  await until(() => editor.started.length > 0)
  await editor.addChild({ kind: 'page', id: 'page-session' })
  await attaching
  return {
    editor,
    created,
    beginWake: (): void => {
      isWaking = true
    },
  }
}

/** Runs a wake that must fail and returns the refusal with the time it took. */
async function failedWake(
  wake: Promise<void>,
): Promise<{ error: StudyError; elapsedMs: number }> {
  const startedAt = performance.now()
  const error = await wake.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  assert.ok(error instanceof StudyError, String(error))
  return { error, elapsedMs: performance.now() - startedAt }
}

// Value: protects=E14, a Chrome that never answers the target list cannot stretch the wake past its one deadline; fails_when=verifyWorker waits its own full bound or reads with the default 10 s timeout; no_claim=real Chrome
test('a wake whose target list is never answered ends at the wake bound and stops reading', async () => {
  // Arrange
  const timeouts: number[] = []
  const { editor, created, beginWake } = await attachedDebugger(
    {},
    async (timeoutMs) => {
      timeouts.push(timeoutMs ?? Number.POSITIVE_INFINITY)
      await sleep(timeoutMs ?? 10_000)
      throw new FlatCdpCommandError('Target.getTargets', undefined, 'timed out')
    },
  )
  await editor.addChild({ kind: 'service_worker', id: 'worker-session' })
  beginWake()
  // Act
  const { error, elapsedMs } = await failedWake(
    created.debug.waitForWorker(AbortSignal.timeout(5_000)),
  )
  const readsAtEnd = timeouts.length
  await sleep(150)
  // Assert
  assert.equal(error.code, 'SERVICE_WORKER_NOT_ATTACHED')
  assert.equal(elapsedMs < WAKE_BOUND_MS + END_SLACK_MS, true)
  assert.equal(
    timeouts.every((timeoutMs) => timeoutMs <= WAKE_BOUND_MS),
    true,
  )
  assert.equal(timeouts.length, readsAtEnd)
  await created.debug.release()
  await editor.dispose()
})

// Value: protects=E14 and DX-17, a worker target that is listed but never gets a session ends at the bound with the send count; fails_when=the start is sent again after startWorker returned, the end passes the bound, or the refusal drops workerStartSends and wakeBoundMs; no_claim=which js-debug session belongs to which target
test('a listed worker whose session never appears is refused at the wake bound with the sends and the bound', async () => {
  // Arrange
  const starts: number[] = []
  const { editor, created } = await attachedDebugger({
    startWorker: async () => {
      starts.push(performance.now())
      return { listed: true, sends: 2 }
    },
  })
  // Act
  const { error, elapsedMs } = await failedWake(
    created.debug.waitForWorker(AbortSignal.timeout(5_000)),
  )
  await sleep(150)
  // Assert
  assert.equal(error.code, 'SERVICE_WORKER_NOT_ATTACHED')
  assert.deepEqual(JSON.parse(JSON.stringify(error.details)), {
    workerStartSends: 2,
    wakeBoundMs: WAKE_BOUND_MS,
  })
  assert.equal(elapsedMs < WAKE_BOUND_MS + END_SLACK_MS, true)
  assert.equal(starts.length, 1)
  assert.deepEqual(
    created.events
      .filter(({ type }) => type === 'chrome-extension.worker-start')
      .map(({ detail }) => JSON.parse(JSON.stringify(detail))),
    [{ sends: 2 }],
  )
  await created.debug.release()
  await editor.dispose()
})

// Value: protects=DX-17, a start that reports no worker listed fails the wake at once; fails_when=the wake then waits the whole bound for a session of a worker that never appeared; no_claim=the real 5 s bound
test('a wake whose start lists no worker is refused at once with the send count', async () => {
  // Arrange
  const refusedAtOnceBoundMs = 3_000
  const { editor, created } = await attachedDebugger(
    { startWorker: async () => ({ listed: false, sends: 5 }) },
    undefined,
    refusedAtOnceBoundMs,
  )
  // Act
  const { error, elapsedMs } = await failedWake(
    created.debug.waitForWorker(AbortSignal.timeout(5_000)),
  )
  // Assert
  assert.equal(error.code, 'SERVICE_WORKER_NOT_ATTACHED')
  assert.deepEqual(JSON.parse(JSON.stringify(error.details)), {
    workerStartSends: 5,
    wakeBoundMs: refusedAtOnceBoundMs,
  })
  // Waiting the bound would take 3 s; the slack covers a loaded runner, so only a real wait fails this.
  assert.equal(elapsedMs < refusedAtOnceBoundMs - END_SLACK_MS, true)
  await created.debug.release()
  await editor.dispose()
})

// Value: protects=a worker child is not lost for good when the wake ran out of time before any target list was answered; fails_when=verifyWorker demotes the child to other on a timeout that never read a list, so the next wake finds no worker child; no_claim=Chrome's own timing, or a wake whose list was answered and mismatched (the next test)
test('a worker child stays attachable after a wake whose target list was never answered', async () => {
  // Arrange
  let answering = false
  const { editor, created, beginWake } = await attachedDebugger(
    {},
    async (timeoutMs) => {
      if (!answering) {
        await sleep(timeoutMs ?? 10_000)
        throw new FlatCdpCommandError(
          'Target.getTargets',
          undefined,
          'timed out',
        )
      }
      return [
        {
          targetId: 'worker-target',
          type: 'service_worker',
          url: `chrome-extension://${EXTENSION_ID}/service-worker.js`,
        },
      ]
    },
  )
  await editor.addChild({ kind: 'service_worker', id: 'worker-session' })
  beginWake()
  const first = await failedWake(
    created.debug.waitForWorker(AbortSignal.timeout(5_000)),
  )
  answering = true
  // Act
  const second = await created.debug
    .waitForWorker(AbortSignal.timeout(5_000))
    .then(
      () => 'attached',
      (reason: unknown) => String(reason),
    )
  // Assert
  assert.equal(first.error.code, 'SERVICE_WORKER_NOT_ATTACHED')
  assert.equal(second, 'attached')
  await created.debug.release()
  await editor.dispose()
})

// Value: protects=E14, a worker target that is listed once and then gone is not adopted; fails_when=the first listing alone ties the session, or the wait goes past the bound; no_claim=Chrome's own timing of a worker restart
test('a worker target that disappears again leaves the wake refused at the wake bound', async () => {
  // Arrange
  let reads = 0
  const { editor, created, beginWake } = await attachedDebugger(
    {},
    async () => {
      reads += 1
      // The first read lists a second worker beside the extension's own (ambiguous); later reads list none.
      return reads === 1
        ? [
            {
              targetId: 'worker-target',
              type: 'service_worker',
              url: `chrome-extension://${EXTENSION_ID}/service-worker.js`,
            },
            {
              targetId: 'second-target',
              type: 'service_worker',
              url: `chrome-extension://${EXTENSION_ID}/other-worker.js`,
            },
          ]
        : [{ targetId: 'surface-target', type: 'page', url: SURFACE_URL }]
    },
  )
  await editor.addChild({ kind: 'service_worker', id: 'worker-session' })
  beginWake()
  // Act
  const { error, elapsedMs } = await failedWake(
    created.debug.waitForWorker(AbortSignal.timeout(5_000)),
  )
  // Assert
  assert.equal(error.code, 'SERVICE_WORKER_NOT_ATTACHED')
  assert.equal(elapsedMs < WAKE_BOUND_MS + END_SLACK_MS, true)
  assert.equal(reads > 1, true)
  await created.debug.release()
  await editor.dispose()
})

// Value: protects=E14, a worker session that does not match the listed target is refused at the bound; fails_when=a session of another worker file is adopted as the extension's; no_claim=js-debug's session naming
test('a worker session that does not match the listed worker target is refused at the wake bound', async () => {
  // Arrange
  const { editor, created } = await attachedDebugger({
    targets: [
      { targetId: 'surface-target', type: 'page', url: SURFACE_URL },
      {
        targetId: 'other-target',
        type: 'service_worker',
        url: `chrome-extension://${EXTENSION_ID}/other-worker.js`,
      },
    ],
  })
  await editor.addChild({ kind: 'service_worker', id: 'worker-session' })
  // Act
  const { error, elapsedMs } = await failedWake(
    created.debug.waitForWorker(AbortSignal.timeout(5_000)),
  )
  // Assert
  assert.equal(error.code, 'SERVICE_WORKER_NOT_ATTACHED')
  assert.equal(elapsedMs < WAKE_BOUND_MS + END_SLACK_MS, true)
  await created.debug.release()
  await editor.dispose()
})

// Value: protects=E14, a Stop mid-wake ends the wake with the stop's reason and sends no further start; fails_when=the wake ignores the signal until the bound or reports the stop as SERVICE_WORKER_NOT_ATTACHED; no_claim=the run lifecycle's own stop handling
test('a Stop during the worker start ends the wake with the stop reason before the bound', async () => {
  // Arrange
  const controller = new AbortController()
  const reason = new Error('the learner stopped the run')
  // A bound far past the stop: only the Stop, never the bound, can end the wake early enough.
  const stopTestBoundMs = 3_000
  const { editor, created } = await attachedDebugger(
    {
      startWorker: (_deadlineAt, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          })
        }),
    },
    undefined,
    stopTestBoundMs,
  )
  const startedAt = performance.now()
  const waking = created.debug.waitForWorker(controller.signal)
  await sleep(40)
  // Act
  controller.abort(reason)
  const failure = await waking.then(
    () => undefined,
    (error: unknown) => error,
  )
  const elapsedMs = performance.now() - startedAt
  // Assert
  assert.equal(failure, reason)
  assert.equal(elapsedMs < stopTestBoundMs - END_SLACK_MS, true)
  assert.deepEqual(
    created.events.filter(
      ({ type }) => type === 'chrome-extension.worker-start',
    ),
    [],
  )
  await created.debug.release()
  await editor.dispose()
})

// Value: protects=a worker the start just listed is not refused because the start used the whole wake bound; fails_when=the worker-session or target-list wait gets 0 ms at the deadline and never reads once; no_claim=Chrome's own timing
test('a wake whose start lists the worker only at the deadline still adopts the worker session', async () => {
  // Arrange
  const boundMs = 200
  let editorRef: Awaited<ReturnType<typeof attachedDebugger>>['editor']
  const attached = await attachedDebugger(
    {
      startWorker: async (deadlineAt) => {
        // The start runs until the deadline, then reports the worker listed, with its session already there.
        await sleep(Math.max(0, deadlineAt - performance.now()) + 20)
        await editorRef.addChild({
          kind: 'service_worker',
          id: 'worker-session',
        })
        return { listed: true, sends: 3 }
      },
    },
    undefined,
    boundMs,
  )
  editorRef = attached.editor
  // Act
  const outcome = await attached.created.debug
    .waitForWorker(AbortSignal.timeout(5_000))
    .then(
      () => 'attached',
      (reason: unknown) => String(reason),
    )
  // Assert
  assert.equal(outcome, 'attached')
  await attached.created.debug.release()
  await attached.editor.dispose()
})
