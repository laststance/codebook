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
) {
  const editor = await extensionEditorHarness({
    constants: { EXTENSION_WAKE_BOUND_MS: WAKE_BOUND_MS },
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
  const { editor, created } = await attachedDebugger({
    startWorker: async () => ({ listed: false, sends: 5 }),
  })
  // Act
  const { error, elapsedMs } = await failedWake(
    created.debug.waitForWorker(AbortSignal.timeout(5_000)),
  )
  // Assert
  assert.equal(error.code, 'SERVICE_WORKER_NOT_ATTACHED')
  assert.deepEqual(JSON.parse(JSON.stringify(error.details)), {
    workerStartSends: 5,
    wakeBoundMs: WAKE_BOUND_MS,
  })
  assert.equal(elapsedMs < WAKE_BOUND_MS / 2, true)
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
  const { editor, created } = await attachedDebugger({
    startWorker: (_deadlineAt, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      }),
  })
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
  assert.equal(elapsedMs < WAKE_BOUND_MS, true)
  assert.deepEqual(
    created.events.filter(
      ({ type }) => type === 'chrome-extension.worker-start',
    ),
    [],
  )
  await created.debug.release()
  await editor.dispose()
})
