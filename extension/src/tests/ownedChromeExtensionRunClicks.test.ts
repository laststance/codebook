import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { describeChromeExtensionViewStatus } from '../utils/describeChromeExtensionStatus'

import {
  createRunHarness,
  resolvedHarnessRun,
  settledReceipt,
  type HarnessBehaviour,
} from './utils/chromeExtensionRunHarness'
import { defer } from './utils/defer'

/** Reads the text observation from a script of successive values; the last one repeats. */
function textScript(values: string[]): HarnessBehaviour['readText'] {
  let position = 0
  return () => ({ text: values[Math.min(position++, values.length - 1)] ?? '' })
}

/** Runs both declared clicks and waits for the run to end. */
async function runToEnd(harness: ReturnType<typeof createRunHarness>) {
  await harness.run.prepare()
  await harness.run.click()
  await harness.run.click()
  await waitUntil(
    () => ['completed', 'failed'].includes(harness.run.view().phase),
    'the run to end',
  )
  return harness.run.view()
}

/** The code of the error a promise rejects with. */
async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  return promise.then(
    () => undefined,
    (error: unknown) =>
      error instanceof StudyError ? error.code : String(error),
  )
}

// Value: protects=DXR8, SR2: the click answers carry 1-based indexes and the progress counts performed clicks; fails_when=an index is 0-based or the procedure does not advance; no_claim=the executor's own steps (executor tests)
test('answers each click with its 1-based index and counts performed clicks', async () => {
  // Arrange
  const harness = createRunHarness()
  await harness.run.prepare()
  // Act
  const first = await harness.run.click()
  // Assert
  assert.deepEqual(
    [first.clickIndex, first.outcome, harness.run.view().procedure],
    [1, 'settled', { clicksDeclared: 2, clicksPerformed: 1 }],
  )
  assert.equal(
    describeChromeExtensionViewStatus(harness.run.view(), [
      'Open dialog',
      'Confirm',
    ]).statusItem,
    'Waiting for chat · next click 2 of 2',
  )
  await harness.run.stop()
})

// Value: protects=SR2, SR12: a click after the last declared one is refused with NO_MORE_ACTIONS; fails_when=a third click reaches the executor; no_claim=the idempotent replay of the same key (service)
test('refuses a click after the last declared one with NO_MORE_ACTIONS', async () => {
  // Arrange
  const harness = createRunHarness({ readText: textScript(['a', 'b']) })
  await harness.run.prepare()
  await harness.run.click()
  await harness.run.click()
  // Act
  const code = await codeOf(harness.run.click())
  // Assert
  assert.equal(code, 'NO_MORE_ACTIONS')
  assert.equal(
    harness.log.filter((entry) => entry.startsWith('executor.run')).length,
    2,
  )
  await harness.run.stop()
})

// Value: protects=SR12, DXR5: a click while a stop is paused answers RUN_PAUSED and consumes nothing; fails_when=the click reaches the executor or the paused run reads another phase; no_claim=the continue arguments (debugger tests)
test('refuses a click while a stop is paused with RUN_PAUSED and consumes nothing', async () => {
  // Arrange
  const harness = createRunHarness()
  await harness.run.prepare()
  harness.openDeclaredPause(1, 'page')
  // Act
  const code = await codeOf(harness.run.click())
  // Assert
  assert.equal(code, 'RUN_PAUSED')
  assert.equal(harness.run.view().phase, 'paused')
  assert.equal(
    harness.log.some((entry) => entry.startsWith('executor.run')),
    false,
  )
  assert.equal(harness.run.view().procedure.clicksPerformed, 0)
  await harness.run.stop()
})

// Value: protects=SR29: a second click call while the first still runs answers ACTION_IN_PROGRESS; fails_when=both reach the executor; no_claim=same-key joins (service)
test('refuses a concurrent click with ACTION_IN_PROGRESS', async () => {
  // Arrange
  const held = defer<void>()
  const harness = createRunHarness({
    receipts: { 1: async () => (await held.promise, settledReceipt(1)) },
  })
  await harness.run.prepare()
  const first = harness.run.click()
  await waitUntil(
    () => harness.run.view().procedure.clickInFlight === 1,
    'the first click to be in flight',
  )
  // Act
  const code = await codeOf(harness.run.click())
  held.resolve()
  await first
  // Assert
  assert.equal(code, 'ACTION_IN_PROGRESS')
  assert.equal(
    harness.log.filter((entry) => entry.startsWith('executor.run')).length,
    1,
  )
  await harness.run.stop()
})

// Value: protects=SR2, SR12, DR10: a selector that matches nothing consumes nothing, the run stays ready and the viewport says nothing was clicked; fails_when=the click counts as performed, the run fails, or the DR10 line is missing; no_claim=the retry bound (service)
test('SELECTOR_NOT_FOUND consumes nothing, leaves the run ready and says nothing was clicked', async () => {
  // Arrange
  let attempts = 0
  const harness = createRunHarness({
    receipts: {
      1: async () => {
        attempts += 1
        if (attempts === 1)
          throw new StudyError(
            'SELECTOR_NOT_FOUND',
            'No element matches #open in the extension surface.',
          )
        return settledReceipt(1)
      },
    },
  })
  await harness.run.prepare()
  // Act
  const code = await codeOf(harness.run.click())
  const retried = await harness.run.click()
  // Assert
  assert.equal(code, 'SELECTOR_NOT_FOUND')
  assert.equal(retried.clickIndex, 1)
  assert.equal(harness.run.view().phase, 'ready')
  assert.equal(
    harness.viewportCalls.some(
      ([name, text]) =>
        name === 'setPhase' &&
        text ===
          'No element matches #open in the extension surface. Nothing was clicked; ask the chat to retry or stop.',
    ),
    true,
  )
  await harness.run.stop()
})

// Value: protects=SR1, SR12: a worker that cannot be made ready refuses the click before anything is sent and leaves the run ready; fails_when=the executor runs or the run fails; no_claim=the wake attempt (debugger tests)
test('SERVICE_WORKER_NOT_ATTACHED refuses the click before the executor and leaves the run ready', async () => {
  // Arrange
  const harness = createRunHarness({
    ensureWorkerReadyFailure: new StudyError(
      'SERVICE_WORKER_NOT_ATTACHED',
      "The extension's service worker did not start while popup was open.",
    ),
  })
  await harness.run.prepare()
  // Act
  const code = await codeOf(harness.run.click())
  // Assert
  assert.equal(code, 'SERVICE_WORKER_NOT_ATTACHED')
  assert.equal(
    harness.log.some((entry) => entry.startsWith('executor.run')),
    false,
  )
  assert.equal(harness.run.view().phase, 'ready')
  await harness.run.stop()
})

for (const code of [
  'INPUT_PARTIAL',
  'CLICK_OUTCOME_UNKNOWN',
  'DIALOG_UNDECLARED',
] as const) {
  // Value: protects=ER15, TZ11: a click that may have changed the extension fails the run and cleans it up before the call settles; fails_when=the run stays ready or the call settles before the cleanup; no_claim=how the executor detects it (executor tests)
  test(`${code} from a click fails the run and cleans up before the call settles`, async () => {
    // Arrange
    const harness = createRunHarness({
      receipts: {
        1: async () => {
          throw new StudyError(code, `The click ended with ${code}.`)
        },
      },
    })
    await harness.run.prepare()
    // Act
    const thrown = await codeOf(harness.run.click())
    // Assert
    assert.equal(thrown, code)
    assert.equal(harness.run.view().phase, 'failed')
    assert.equal(harness.log.includes('browser.close'), true)
  })
}

// Value: protects=ER20: a source that changed after the run started refuses the next click, fails the run and sends nothing; fails_when=the click reaches the executor; no_claim=the hash comparison (source check tests)
test('a changed source fails the run before the click is sent', async () => {
  // Arrange
  const harness = createRunHarness({
    sourceCheckFailure: new StudyError(
      'SOURCE_CHANGED',
      'popup.js changed after the run started.',
    ),
  })
  await harness.run.prepare()
  // Act
  const code = await codeOf(harness.run.click())
  // Assert
  assert.equal(code, 'SOURCE_CHANGED')
  assert.equal(
    harness.log.some((entry) => entry.startsWith('executor.run')),
    false,
  )
  assert.equal(harness.run.view().phase, 'failed')
})

// Value: protects=SR32: each declared click is journaled with its index and selector; fails_when=the click event is missing; no_claim=the whitelist (event detail tests)
test('journals each click with its index and selector', async () => {
  // Arrange
  const harness = createRunHarness()
  await harness.run.prepare()
  // Act
  await harness.run.click()
  // Assert
  assert.deepEqual(
    harness.journal.filter((event) => event.type === 'chrome-extension.click'),
    [
      {
        type: 'chrome-extension.click',
        detail: { clickIndex: 1, selector: '#open' },
      },
    ],
  )
  await harness.run.stop()
})

// Value: protects=CR9, SR3, SR23, DXR7: after the last click settles the run observes, reports a changed result and is claimable; fails_when=the run stays ready, the result is not changed or claimable is false; no_claim=real Chrome reads (real Chrome test)
test('observes a changed result after the last click and reports it claimable and complete', async () => {
  // Arrange
  const harness = createRunHarness({
    readText: textScript(['before', 'after']),
  })
  harness.debuggerState.notReached = []
  // Act
  const view = await runToEnd(harness)
  // Assert
  assert.deepEqual(
    [view.phase, view.result, view.claimable, view.observed?.changed],
    ['completed', 'complete', true, true],
  )
  assert.deepEqual(
    [view.observed?.before, view.observed?.after],
    [{ value: 'before' }, { value: 'after' }],
  )
  assert.equal(harness.log.includes('browser.close'), true)
})

// Value: protects=CR9, DXR7: an unchanged result is reported as unchanged and is still claimable; fails_when=unchanged reads unavailable or not claimable; no_claim=causation (skill text)
test('reports an unchanged result as unchanged and claimable', async () => {
  // Arrange
  const harness = createRunHarness({ readText: textScript(['same']) })
  harness.debuggerState.notReached = []
  // Act
  const view = await runToEnd(harness)
  // Assert
  assert.deepEqual(
    [view.observed?.changed, view.claimable, view.result],
    [false, true, 'complete'],
  )
})

// Value: protects=CR9: a value that changes for a while and then holds is reported at its stable value; fails_when=the first read is taken or the loop gives up; no_claim=the 5 s bound's length
test('waits for a slow change to hold before reporting the result', async () => {
  // Arrange
  const harness = createRunHarness({
    readText: textScript(['old', 'old', 'mid', 'new', 'new']),
  })
  // Act
  const view = await runToEnd(harness)
  // Assert
  assert.deepEqual(
    [view.observed?.after, view.observed?.changed],
    [{ value: 'new' }, true],
  )
})

// Value: protects=CR9, SR22: a stop not reached reads partial beside a claimable observation; fails_when=partial hides the observation or complete is claimed; no_claim=which stop (debugger tests)
test('a run with a stop not reached completes as partial and keeps its observation', async () => {
  // Arrange
  const harness = createRunHarness({ readText: textScript(['a', 'b']) })
  harness.debuggerState.notReached = [2]
  // Act
  const view = await runToEnd(harness)
  // Assert
  assert.deepEqual(
    [view.result, view.stopsNotReached, view.claimable],
    ['partial', [2], true],
  )
})

// Value: protects=ER23, DXR7: a failed observation completes the run with OBSERVATION_UNAVAILABLE and never claims the result; fails_when=the run fails, claimable is true or the cause shows a private path; no_claim=masking rules (observation tests)
test('an unreadable result completes the run with OBSERVATION_UNAVAILABLE and no claim', async () => {
  // Arrange
  const harness = createRunHarness({
    readText: () => {
      throw new Error('the page is gone')
    },
    timings: { boundMs: 120 },
  })
  // Act
  const view = await runToEnd(harness)
  // Assert
  assert.deepEqual(
    [
      view.phase,
      view.claimable,
      view.runFailure?.code,
      view.runFailure?.message,
    ],
    [
      'completed',
      false,
      'OBSERVATION_UNAVAILABLE',
      'The result could not be read: the page is gone.',
    ],
  )
})

// Value: protects=SR23: continuing the last paused stop leads into observing the same way as settling; fails_when=the run stays paused or ready after the last continue; no_claim=the debugger's resume
test('continuing the last paused stop leads into the observation', async () => {
  // Arrange
  const finishClick = defer<void>()
  const harness = createRunHarness({
    readText: textScript(['a', 'b']),
    receipts: {
      2: async () => settledReceipt(2, finishClick.promise, 'paused'),
    },
  })
  harness.debuggerState.notReached = []
  await harness.run.prepare()
  await harness.run.click()
  await harness.run.click()
  const pause = harness.openDeclaredPause(2, 'service-worker')
  // Act
  await harness.run.continue({
    participant: 'extension',
    sessionId: pause.sessionId,
    threadId: pause.threadId,
    generation: pause.generation,
  })
  finishClick.resolve()
  await waitUntil(
    () => harness.run.view().phase === 'completed',
    'the observation',
  )
  // Assert
  assert.equal(harness.run.view().observed?.changed, true)
  assert.equal(harness.log.includes('debugger.resume'), true)
})

// Value: protects=ER9: no observation read starts while a stop is paused, and the observation completes after the pause ends; fails_when=a read is sent under a pause or the run never finishes; no_claim=real renderer behaviour (N61)
test('does not read the result under a pause and finishes after the pause ends', async () => {
  // Arrange
  const harness = createRunHarness({
    // Keeps changing for a while, so the observation is still polling when the pause opens.
    readText: textScript(['0', '1', '2', '3', '4', '5', '6', '7', '8', '8']),
    timings: { pollMs: 30 },
  })
  await harness.run.prepare()
  await harness.run.click()
  await harness.run.click()
  const reads = () =>
    harness.surface.methods().filter((method) => method === 'Runtime.evaluate')
      .length
  await waitUntil(() => reads() >= 3, 'the observation to be polling')
  // Act
  const pause = harness.openDeclaredPause(1, 'page')
  await sleep(150)
  const readsAtPause = reads()
  await sleep(150)
  const readsLater = reads()
  harness.pauses.close(pause.sessionId, pause.threadId)
  await waitUntil(
    () => harness.run.view().phase === 'completed',
    'the observation after the pause',
  )
  // Assert
  assert.equal(readsLater, readsAtPause)
  assert.equal(harness.run.view().claimable, true)
})

// Value: protects=SR26, ER26: when the popup closes before the result is read, the run fails with SURFACE_LOST, journals it, a text observation reads unavailable and the viewport shows the loss; fails_when=the run completes, the code differs, or the viewport shows another ending; no_claim=real Chrome (real Chrome test)
test('a closed popup fails the run with SURFACE_LOST and reads a text observation unavailable', async () => {
  // Arrange
  const hold = defer<void>()
  const harness = createRunHarness({
    receipts: { 2: async () => settledReceipt(2, hold.promise, 'running') },
  })
  await harness.run.prepare()
  await harness.run.click()
  await harness.run.click()
  // Act
  harness.surface.emit('Target.targetDestroyed', { targetId: 'surface-target' })
  await waitUntil(
    () => harness.run.view().phase === 'failed',
    'the surface loss',
  )
  hold.resolve()
  // Assert
  const view = harness.run.view()
  assert.deepEqual(
    [view.runFailure?.code, view.runFailure?.message, view.observed?.after],
    [
      'SURFACE_LOST',
      'The extension surface closed or left the extension.',
      { unavailable: true, cause: 'the extension surface no longer exists' },
    ],
  )
  assert.deepEqual(
    harness.journal.filter(
      (event) => event.type === 'chrome-extension.surface-lost',
    ),
    [{ type: 'chrome-extension.surface-lost', detail: { surface: 'popup' } }],
  )
  assert.equal(
    harness.viewportCalls.some(([name]) => name === 'surfaceLost'),
    true,
  )
})

// Value: protects=SR26, ER26: a page that navigates out of the extension is a lost surface, and a storage observation still completes; fails_when=the navigation is not noticed or the storage read is lost with the page; no_claim=real navigation (real Chrome test)
test('a surface that leaves the extension fails the run and a storage observation still completes', async () => {
  // Arrange
  const hold = defer<void>()
  const harness = createRunHarness({
    resolved: resolvedHarnessRun({
      observe: { kind: 'storage', key: 'lastCreated' },
    }),
    receipts: { 2: async () => settledReceipt(2, hold.promise, 'running') },
    surfaceAnswers: {
      'Extensions.getStorageItems': () => ({
        data: { lastCreated: 'New Folder' },
      }),
      'Target.createTarget': () => ({ targetId: 'host-page' }),
      'Target.attachToTarget': () => ({ sessionId: 'host-session' }),
    },
  })
  await harness.run.prepare()
  await harness.run.click()
  await harness.run.click()
  // Act
  harness.surface.emit('Target.targetInfoChanged', {
    targetInfo: { targetId: 'surface-target', url: 'https://example.test/' },
  })
  await waitUntil(
    () => harness.run.view().phase === 'failed',
    'the surface loss',
  )
  hold.resolve()
  // Assert
  const view = harness.run.view()
  assert.equal(view.runFailure?.code, 'SURFACE_LOST')
  assert.deepEqual(view.observed?.after, { value: 'New Folder' })
})

// Value: protects=DR2, DR5, C4: the viewport phase text follows the run from waiting to the finished line and names no save action; fails_when=the words change or a Save text appears; no_claim=the status bar rendering
test('the viewport shows waiting, then the finished result line, and never a save action', async () => {
  // Arrange
  const harness = createRunHarness({ readText: textScript(['a', 'b']) })
  harness.debuggerState.notReached = []
  // Act
  await runToEnd(harness)
  // Assert
  const phases = harness.viewportCalls
    .filter(([name]) => name === 'setPhase')
    .map(([, text]) => String(text))
  assert.equal(phases.includes('Waiting for chat · next click 1 of 2'), true)
  assert.equal(
    harness.viewportCalls.find(([name]) => name === 'end')?.[1],
    'clicks 2/2 · stops 2/2 · result changed',
  )
  assert.equal(
    phases.some((text) => /save/i.test(text)),
    false,
  )
})

// Value: protects=SR26, SR22: a stop accepted while the lost surface's storage read is pending keeps its own result (no observation, partial) and the late read does not overwrite it; fails_when=the late read sets observed after the stop; no_claim=real Chrome
test('a stop during the read after a lost surface is not overwritten by the late read', async () => {
  // Arrange
  const hold = defer<void>()
  const readGate = defer<void>()
  const lateReadStarted = defer<void>()
  let surfaceLost = false
  const harness = createRunHarness({
    resolved: resolvedHarnessRun({
      observe: { kind: 'storage', key: 'lastCreated' },
    }),
    receipts: { 2: async () => settledReceipt(2, hold.promise, 'running') },
    surfaceAnswers: {
      'Extensions.getStorageItems': async () => {
        // The first read (before the clicks) answers at once; the read after the loss is held.
        if (surfaceLost) {
          lateReadStarted.resolve()
          await readGate.promise
        }
        return { data: { lastCreated: 'New Folder' } }
      },
      'Target.createTarget': () => ({ targetId: 'host-page' }),
      'Target.attachToTarget': () => ({ sessionId: 'host-session' }),
    },
  })
  await harness.run.prepare()
  await harness.run.click()
  await harness.run.click()
  surfaceLost = true
  harness.surface.emit('Target.targetInfoChanged', {
    targetInfo: { targetId: 'surface-target', url: 'https://example.test/' },
  })
  await lateReadStarted.promise
  // Act
  const stopping = harness.run.stop()
  readGate.resolve()
  hold.resolve()
  await stopping
  await waitUntil(() => harness.log.includes('viewport.close'), 'the cleanup')
  // A negative check: give the held read time to finish and (wrongly) store its result.
  await sleep(100)
  // Assert
  assert.equal(harness.run.view().observed, null)
})
