import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { describeChromeExtensionViewStatus } from '../utils/describeChromeExtensionStatus'

import {
  createRunHarness,
  manualClock,
} from './utils/chromeExtensionRunHarness'
import { defer } from './utils/defer'

/** The names of the journaled phases, in order. */
function phaseNames(journal: { type: string; detail: unknown }[]): unknown[] {
  return journal
    .filter((event) => event.type === 'chrome-extension.phase')
    .map((event) => Reflect.get(event.detail as object, 'name'))
}

/** The cleanup steps of the log, in order. */
function cleanupSteps(log: string[]): string[] {
  return log.filter((entry) =>
    [
      'viewport.end',
      'debugger.browserClosing',
      'debugger.release',
      'executor.dispose',
      'browser.close',
      'viewport.close',
    ].includes(entry),
  )
}

const FULL_CLEANUP = [
  'viewport.end',
  'debugger.browserClosing',
  'debugger.release',
  'executor.dispose',
  'browser.close',
  'viewport.close',
]

// Value: protects=CR15, SR17: every preparation phase is journaled in order with the elapsed time, and the run reads ready; fails_when=a phase is skipped, journaled twice or out of order; no_claim=the real launch and debugger phase reports (pt1 tests)
test('journals every phase from starting to ready in order', async () => {
  // Arrange
  const harness = createRunHarness()
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(phaseNames(harness.journal), [
    'starting',
    'launching',
    'installing',
    'opening',
    'attaching',
    'waking',
    'arming',
    'ready',
  ])
  assert.equal(harness.run.view().phase, 'ready')
  await harness.run.stop()
})

// protects=CXS2 (Cycle 0062 ship review, Codex; CR4): the run hands the viewport its declared stops' files as absolute paths with the identity, so the lease moves only those paused files; fails_when=the identity lacks the stop files, or names a file the run does not stop in; no_claim=the editor's routing of the paused file
test('the run names its declared stop files in the viewport identity', async () => {
  // Arrange
  const harness = createRunHarness()
  // Act
  await harness.run.prepare()
  // Assert
  const identity = harness.viewportCalls.find(
    ([name]) => name === 'setIdentity',
  )?.[1]
  assert.deepEqual(Reflect.get(identity as object, 'stopFiles'), [
    '/repo/extension/popup.js',
    '/repo/extension/worker.js',
  ])
  await harness.run.stop()
})

// Value: protects=CR15, acceptance 5: a failure while waiting for the worker is journaled up to that phase and the run cleans up in the fixed order; fails_when=the phase before the failure is not journaled, the run stays open, or the browser closes before the debugger is released; no_claim=the debugger's own error text (pt1)
test('a failure in waking journals the phases up to it, fails the run and cleans up in order', async () => {
  // Arrange
  const harness = createRunHarness({
    debuggerFailure: {
      step: 'waitForWorker',
      error: new StudyError(
        'SERVICE_WORKER_NOT_ATTACHED',
        "The extension's service worker did not start while popup was open.",
      ),
    },
  })
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal((failure as StudyError).code, 'SERVICE_WORKER_NOT_ATTACHED')
  assert.deepEqual(phaseNames(harness.journal), [
    'starting',
    'launching',
    'installing',
    'opening',
    'attaching',
    'waking',
  ])
  assert.equal(harness.run.view().phase, 'failed')
  // no surface, no executor: only the debugger, the browser and the lease are left to end
  assert.deepEqual(cleanupSteps(harness.log), [
    'debugger.browserClosing',
    'debugger.release',
    'browser.close',
    'viewport.close',
  ])
  assert.deepEqual(harness.run.view().cleanup, {
    profileLeft: false,
    exitConfirmed: true,
  })
})

// Value: protects=acceptance 5, ER18: a stop after ready ends the debugger before the executor and the browser, then the lease; fails_when=the order of the cleanup changes or a step runs twice; no_claim=real processes
test('stop after ready cleans up in the order debugger, executor, browser, lease', async () => {
  // Arrange
  const harness = createRunHarness()
  await harness.run.prepare()
  // Act
  await harness.run.stop()
  await harness.run.stop()
  // Assert
  assert.deepEqual(cleanupSteps(harness.log), FULL_CLEANUP)
})

// Value: protects=SR22: a stop before the last click leaves a partial result and no observation; fails_when=the stopped run reads complete, keeps an observation or claims the result; no_claim=the status text
test('stop after the first of two clicks reads partial with no observation', async () => {
  // Arrange
  const harness = createRunHarness()
  await harness.run.prepare()
  await harness.run.click()
  // Act
  await harness.run.stop()
  // Assert
  const view = harness.run.view()
  assert.deepEqual(
    [view.phase, view.result, view.observed, view.claimable],
    ['completed', 'partial', null, false],
  )
})

// Value: protects=ER18: a profile folder the close could not remove is reported, not hidden; fails_when=cleanup claims the profile is gone when close said it was left; no_claim=which folder
test('reports a profile that the browser close left behind', async () => {
  // Arrange
  const harness = createRunHarness({
    closeResult: { profileLeft: true, exitConfirmed: false },
  })
  await harness.run.prepare()
  // Act
  await harness.run.stop()
  // Assert
  assert.deepEqual(harness.run.view().cleanup, {
    profileLeft: true,
    exitConfirmed: false,
  })
})

// Value: protects=CR12, SR3: a launch that fails leaves nothing for the run to clean beyond what the launch removed, and the run fails with the launch's own error; fails_when=the debugger is created or released for a browser that never launched, or the error changes; no_claim=the profile removal itself (pt1 launch test)
test('a failed launch fails the run without creating a debugger', async () => {
  // Arrange
  const harness = createRunHarness({
    launchFailure: new StudyError(
      'EXTENSION_LOAD_FAILED',
      'Chrome did not load the extension: bad manifest.',
    ),
  })
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal((failure as StudyError).code, 'EXTENSION_LOAD_FAILED')
  assert.equal(harness.log.includes('debugger.release'), false)
  assert.equal(harness.log.includes('browser.close'), false)
  assert.equal(harness.run.view().phase, 'failed')
})

// Value: protects=DR4, DR10: a refusal before the launch shows its sentence and the pre-launch next step; fails_when=the viewport shows another line or the browser launches; no_claim=the refusal wording (resolver tests)
test('a pre-launch refusal shows its sentence and the can-explain-from-source line', async () => {
  // Arrange
  const harness = createRunHarness({
    resolveFailure: new StudyError(
      'MANIFEST_NOT_V3',
      'The extension root needs a Manifest V3 manifest.json.',
    ),
  })
  // Act
  await harness.run.prepare().catch(() => undefined)
  // Assert
  assert.equal(harness.log.includes('launch'), false)
  assert.deepEqual(
    harness.viewportCalls.find(([name]) => name === 'showFailure'),
    [
      'showFailure',
      'The extension root needs a Manifest V3 manifest.json.',
      'The chat can explain this part from source.',
    ],
  )
})

// Value: protects=ER5: the acknowledged permissions of the start reach the pre-launch checks; fails_when=the checks run with the declaration's own empty list; no_claim=the permission rules (resolver tests)
test('passes the start’s acknowledged permissions to the pre-launch checks', async () => {
  // Arrange
  const harness = createRunHarness()
  // Act
  await harness.run.prepare()
  // Assert
  const options = harness.resolveInputs[0] as {
    repositoryRoot: string
    configuration: { acknowledgedPermissions: string[] }
  }
  assert.deepEqual(
    [options.repositoryRoot, options.configuration.acknowledgedPermissions],
    ['/repo', ['storage']],
  )
  await harness.run.stop()
})

// Value: protects=CR14: a stop accepted during the launch step starts no further phase step and the browser that appears late is closed once; fails_when=the debugger attaches after the stop, or the browser is left open or closed twice; no_claim=timing of real Chrome
test('a stop during the launch starts no later phase and closes the late browser once', async () => {
  // Arrange
  const launchGate = defer<void>()
  const harness = createRunHarness({ launchGate: launchGate.promise })
  const preparing = harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await waitUntil(() => harness.log.includes('launch'), 'the launch to start')
  // Act
  const stopping = harness.run.stop()
  launchGate.resolve()
  await stopping
  const failure = await preparing
  // Assert
  assert.equal(
    (failure as StudyError).message,
    'The extension run was stopped before it was ready.',
  )
  assert.equal(harness.log.includes('debugger.attach'), false)
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
})

// Value: protects=acceptance 5: the whole-run deadline ends a ready run through the one cleanup; fails_when=the run stays ready past its limit or the browser is not closed; no_claim=the 600 s value (constant)
test('the whole-run deadline fails a ready run and cleans it up', async () => {
  // Arrange
  const harness = createRunHarness({ timings: { runMs: 1_000 } })
  await harness.run.prepare()
  // Act
  await waitUntil(() => harness.run.view().phase === 'failed', 'the deadline')
  // Assert
  assert.equal(
    harness.run.view().runFailure?.message,
    'The extension run reached its limit of 1 s and was ended.',
  )
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
})

/**
 * Builds a run harness whose text observation answers the baseline at once and holds every later read until the test releases it.
 * Why: the state-matrix cells below end a run while its after-click read is still in flight.
 * @param behaviour - What else differs from a healthy run.
 * @returns The harness, the held read's release and a count of the reads sent.
 * @example const { harness, held, reads } = harnessWithHeldResultRead({ timings: { runMs: 1_000 } })
 */
function harnessWithHeldResultRead(
  behaviour: Parameters<typeof createRunHarness>[0] = {},
) {
  const held = defer<Record<string, unknown>>()
  let reads = 0
  const harness = createRunHarness({
    ...behaviour,
    surfaceAnswers: {
      'Runtime.evaluate': () => {
        reads += 1
        return reads === 1
          ? { result: { value: { text: 'before' } } }
          : held.promise
      },
    },
  })
  return { harness, held, reads: (): number => reads }
}

// Value: protects=state matrix preparing × deadline (acceptance 5): a run not ready within the setup bound fails with that limit, starts no later phase, and closes the browser that appeared late once; fails_when=the setup timer is not armed, names another limit, or the late browser stays open; no_claim=the 90 s value (constant)
test('a run not ready within the setup bound fails with that limit and closes the late browser once', async () => {
  // Arrange
  const launchGate = defer<void>()
  const harness = createRunHarness({
    launchGate: launchGate.promise,
    timings: { setupMs: 1_000 },
  })
  const preparing = harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Act
  await waitUntil(
    () => harness.run.view().runFailure !== undefined,
    'the setup bound',
  )
  launchGate.resolve()
  const failure = await preparing
  // Assert
  assert.equal(
    (failure as StudyError).message,
    'The extension run was not ready within 1 s and was ended.',
  )
  assert.equal(harness.run.view().phase, 'failed')
  assert.equal(harness.log.includes('debugger.attach'), false)
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
})

// Value: protects=state matrix paused × stop (SR22, acceptance 5): stopping a run at a declared pause reads partial with no observation and no claim, through the one cleanup; fails_when=the stopped run reads complete, keeps an observation, or skips a cleanup step; no_claim=the debugger's own release of the pause (debugger tests)
test('stopping a run at a declared pause reads partial with no observation and runs the one cleanup', async () => {
  // Arrange
  const harness = createRunHarness()
  await harness.run.prepare()
  await harness.run.click()
  harness.openDeclaredPause(1, 'page')
  // Act
  await harness.run.stop()
  // Assert
  const view = harness.run.view()
  assert.deepEqual(
    [view.phase, view.result, view.observed, view.claimable],
    ['completed', 'partial', null, false],
  )
  assert.deepEqual(cleanupSteps(harness.log), FULL_CLEANUP)
})

// Value: protects=state matrix paused × deadline (acceptance 5): the whole-run deadline ends a run held at a declared pause with the limit's sentence, through the one cleanup; fails_when=a paused run outlives its limit or the browser is not closed once; no_claim=the 600 s value (constant)
test('the whole-run deadline ends a run held at a declared pause and cleans it up once', async () => {
  // Arrange
  const harness = createRunHarness({ timings: { runMs: 1_000 } })
  await harness.run.prepare()
  harness.openDeclaredPause(1, 'page')
  // Act
  await waitUntil(() => harness.run.view().phase === 'failed', 'the deadline')
  // Assert
  assert.equal(
    harness.run.view().runFailure?.message,
    'The extension run reached its limit of 1 s and was ended.',
  )
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
})

// Value: protects=state matrix observing × stop (SR22, CR14): a stop while the result is being read ends the run partial with no observation, and the read that answers later is not stored; fails_when=the late read becomes the observed result of a stopped run; no_claim=the lost-surface read (clicks tests)
test('stopping while the result is read keeps no observation, even when the read answers later', async () => {
  // Arrange
  const { harness, held, reads } = harnessWithHeldResultRead()
  await harness.run.prepare()
  await harness.run.click()
  await harness.run.click()
  await waitUntil(() => reads() >= 2, 'the after-click read to start')
  // Act
  const stopping = harness.run.stop()
  held.resolve({ result: { value: { text: 'after' } } })
  await stopping
  // gstack-timing-ok: a negative check; a slow runner can only miss a wrong store, never fail a correct run
  await new Promise((resolve) => setTimeout(resolve, 20))
  // Assert
  const view = harness.run.view()
  assert.deepEqual(
    [view.phase, view.result, view.observed, view.claimable],
    ['completed', 'partial', null, false],
  )
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
})

// Value: protects=state matrix observing × deadline (acceptance 5): the whole-run deadline during the result read fails the run with the limit's sentence and stores no result from the late read; fails_when=the late read is stored as observed or the run is not cleaned up once; no_claim=the 600 s value (constant)
test('the whole-run deadline during the result read fails the run and stores no late result', async () => {
  // Arrange
  const { harness, held, reads } = harnessWithHeldResultRead({
    timings: { runMs: 1_000 },
  })
  await harness.run.prepare()
  await harness.run.click()
  await harness.run.click()
  await waitUntil(() => reads() >= 2, 'the after-click read to start')
  // Act
  await waitUntil(() => harness.run.view().phase === 'failed', 'the deadline')
  held.resolve({ result: { value: { text: 'after' } } })
  // gstack-timing-ok: a negative check; a slow runner can only miss a wrong store, never fail a correct run
  await new Promise((resolve) => setTimeout(resolve, 20))
  // Assert
  assert.equal(
    harness.run.view().runFailure?.message,
    'The extension run reached its limit of 1 s and was ended.',
  )
  assert.equal(harness.run.view().observed ?? null, null)
  assert.equal(harness.run.view().claimable, false)
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
})

// Value: protects=acceptance 5: the learner stopping the debug session ends the run through the one cleanup; fails_when=the run stays ready with a dead debugger; no_claim=the editor's own session events
test('the end of the debug session fails the run and cleans it up once', async () => {
  // Arrange
  const harness = createRunHarness()
  await harness.run.prepare()
  // Act
  harness.endDebugSession()
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().phase, 'failed')
  assert.equal(
    harness.run.view().runFailure?.message,
    'The debug session of the extension run ended.',
  )
  assert.deepEqual(cleanupSteps(harness.log), FULL_CLEANUP)
})

// Value: protects=SR3, acceptance 5: a lost browser fails the run with BROWSER_LOST and cleans up once; fails_when=the code differs or cleanup runs twice for the loss plus a stop; no_claim=the browser's termination reason
test('a lost browser fails the run with BROWSER_LOST and a later stop adds no second cleanup', async () => {
  // Arrange
  const harness = createRunHarness()
  await harness.run.prepare()
  // Act
  harness.loseBrowser()
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().runFailure?.code, 'BROWSER_LOST')
  assert.equal(harness.run.view().phase, 'failed')
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
})

// Value: protects=ER8: a pause held past its limit, reported by the debugger, ends the run; fails_when=the failure the debugger reports is ignored; no_claim=the hold timer itself (debugger tests)
test('a pause hold that expired fails the run with the debugger’s error', async () => {
  // Arrange
  const harness = createRunHarness()
  await harness.run.prepare()
  // Act
  harness.debuggerState.handlers?.onFailure(
    new StudyError(
      'PAUSE_HOLD_EXPIRED',
      'The extension stayed paused too long.',
    ),
  )
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().runFailure?.code, 'PAUSE_HOLD_EXPIRED')
  assert.equal(harness.run.view().phase, 'failed')
})

// Value: protects=CR10: the stop of every worker the launch made is disclosed as an intervention; fails_when=the intervention is not recorded; no_claim=the intervention list format (debugger tests)
test('records the stop-all-workers intervention of the launch', async () => {
  // Arrange
  const harness = createRunHarness()
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(harness.log.includes('intervention:stop-all-workers'), true)
  await harness.run.stop()
})

// Value: protects=C3: console lines the debugger journals reach the view with their context, and the dropped count with them; fails_when=outputs or the count are missing from the view; no_claim=masking (journal tests)
test('lists the extension’s console output and the dropped count in the view', async () => {
  // Arrange
  const harness = createRunHarness()
  await harness.run.prepare()
  // Act
  harness.debuggerState.input?.record('chrome-extension.output', {
    context: 'service-worker',
    text: 'View mode: Popup',
  })
  harness.debuggerState.input?.record('chrome-extension.output-dropped', {
    count: 7,
  })
  // Assert
  const view = harness.run.view()
  assert.deepEqual(
    [
      view.outputs.map(({ context, text }) => [context, text]),
      view.outputsDropped,
    ],
    [[['service-worker', 'View mode: Popup']], 7],
  )
  await harness.run.stop()
})

// Value: protects=ER22: a run without an Application view prepares and ends normally; fails_when=the missing factory breaks the run; no_claim=the viewport
test('runs without an Application view when the editor offers none', async () => {
  // Arrange
  const harness = createRunHarness({ withoutViewport: true })
  // Act
  await harness.run.prepare()
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().phase, 'completed')
  assert.deepEqual(harness.viewportCalls, [])
})

// protects=DR6 truthfulness: an Application view the editor's layout refuses (a foreign preview tab in the destination group, seen in Cursor in the Cycle 0061 pt2 dry run) leaves the run going and says why, in the view and the journal, with the private path hidden; fails_when=the refusal is swallowed and the run shows no view and no cause; no_claim=placing the pane despite the preview tab (a carried defect)
test('an Application view the editor refuses leaves the run ready and reports why', async () => {
  // Arrange
  const harness = createRunHarness({
    viewportFailure: new StudyError(
      'PRESENTATION_UNAVAILABLE',
      'A destination group contains a foreign preview: "/repo/extension/background/service-worker.js" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
    ),
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(harness.run.view().phase, 'ready')
  assert.equal(
    harness.run.view().viewUnavailable,
    'A destination group contains a foreign preview: "<workspace>/extension/background/service-worker.js" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
  )
  assert.deepEqual(
    harness.journal.filter(
      (event) => event.type === 'chrome-extension.view-unavailable',
    ),
    [
      {
        type: 'chrome-extension.view-unavailable',
        detail: {
          message:
            'A destination group contains a foreign preview: "<workspace>/extension/background/service-worker.js" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
        },
      },
    ],
  )
  await harness.run.stop()
})

// protects=DR6 for a view that cannot show the surface: a learner's tab opened in the Application view's group makes the editor refuse the reveal, and the run still becomes ready without a view, says why and closes the half-made view (CodeRabbit pt2 round 2); fails_when=the refused reveal ends the run as RUNTIME_FAILED although the extension was ready; no_claim=the editor's lease rules
test('an Application view that cannot show the surface leaves the run ready and reports why', async () => {
  // Arrange
  const harness = createRunHarness({
    viewportAttachFailure: new StudyError(
      'PRESENTATION_UNAVAILABLE',
      'Editor group 2 has a tab that is not Codebook\'s: "/repo/notes.md". Close it, then try again.',
    ),
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(harness.run.view().phase, 'ready')
  assert.equal(
    harness.run.view().viewUnavailable,
    'Editor group 2 has a tab that is not Codebook\'s: "<workspace>/notes.md". Close it, then try again.',
  )
  assert.deepEqual(
    harness.journal.filter(
      (event) => event.type === 'chrome-extension.view-unavailable',
    ),
    [
      {
        type: 'chrome-extension.view-unavailable',
        detail: {
          message:
            'Editor group 2 has a tab that is not Codebook\'s: "<workspace>/notes.md". Close it, then try again.',
        },
      },
    ],
  )
  assert.deepEqual(harness.viewportCalls.at(-1), ['close'])
  await harness.run.stop()
  assert.equal(harness.run.view().phase, 'completed')
})

// protects=DR3 live frame after a quick continue: a pause continued while its frame capture is still in flight leaves the Application view live, not frozen on "Paused at stop n" (a service-worker stop does not pause the page, so its capture answers at once and can arrive after the continue; CodeRabbit pt2 round 2); fails_when=the late capture pins the ended pause and the view stays frozen until the next debugger change; no_claim=the capture timeout path
test('a pause continued before its frame capture answers leaves the Application view live', async () => {
  // Arrange
  const capture = defer<Record<string, unknown>>()
  const harness = createRunHarness({
    surfaceAnswers: { 'Page.captureScreenshot': () => capture.promise },
  })
  await harness.run.prepare()
  const pause = harness.openDeclaredPause(1, 'service-worker')
  await waitUntil(
    () => harness.surface.methods().includes('Page.captureScreenshot'),
    'the pause frame capture was sent',
  )
  // Act
  harness.pauses.close(pause.sessionId, pause.threadId)
  capture.resolve({ data: 'cGl4ZWxz' })
  // gstack-timing-ok: a negative check; a slow runner can only miss a wrong pin, never fail a correct run
  await new Promise((resolve) => setTimeout(resolve, 20))
  // Assert
  const viewCalls = harness.viewportCalls
    .map(([name]) => name)
    .filter((name) => name === 'pinPause' || name === 'resumeLive')
  assert.deepEqual(viewCalls, ['resumeLive'])
  await harness.run.stop()
})

// Value: protects=DR10: a version failure raised at launch shows the same next-step line in the Application view and the status item; fails_when=the viewport shows the ended line while the status item shows the before-launch line; no_claim=the version wording
test('a launch-time unsupported Chrome version shows the same next-step line in the view and the status item', async () => {
  // Arrange
  const harness = createRunHarness({
    launchFailure: new StudyError(
      'CHROME_VERSION_UNSUPPORTED',
      'This Chrome version cannot run the extension.',
    ),
  })
  // Act
  await harness.run.prepare().catch(() => undefined)
  // Assert
  const statusItem = describeChromeExtensionViewStatus(
    harness.run.view(),
    [],
  ).statusItem
  assert.deepEqual(
    harness.viewportCalls.find(([name]) => name === 'showFailure'),
    [
      'showFailure',
      'This Chrome version cannot run the extension.',
      'The chat can explain this part from source.',
    ],
  )
  assert.equal(
    statusItem,
    'This Chrome version cannot run the extension. The chat can explain this part from source.',
  )
})

// protects=ER18 (Cycle 0062 task 14): a stop settles within the 10 s stop bound while a preparation step ignores its abort and never settles, and the browser is closed once; fails_when=the cleanup awaits the stuck step forever and stop() never answers; no_claim=the 10 s value (CHROME_EXTENSION_STOP_DEADLINE_MS)
test('a stop settles at the stop bound while a preparation step never settles and closes the browser once', async () => {
  // Arrange
  const neverSettles = defer<void>()
  const timers = manualClock()
  const harness = createRunHarness({
    attachGate: neverSettles.promise,
    clock: timers.clock,
  })
  const preparing = harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await waitUntil(() => harness.log.includes('debugger.attach'), 'the attach')
  // Act
  const stopping = harness.run.stop()
  await waitUntil(
    () => timers.pendingDelays().includes(10_000),
    'the stop bound to be armed',
  )
  timers.fire(10_000)
  await stopping
  // Assert
  assert.equal(harness.run.view().phase, 'failed')
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
  neverSettles.resolve()
  await preparing
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
})

// protects=CR14 (Cycle 0062 task 17): a cleanup whose browser close throws never leaves an unhandled rejection from the fire-and-forget ending, and the run still reaches its ended phase; fails_when=the ending's rejection escapes unhandled or the run stays open; no_claim=the profile folder state
test('a browser close that throws ends the run without an unhandled rejection', async () => {
  // Arrange
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => void unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  const harness = createRunHarness()
  harness.browser.close = () => {
    throw new Error('close threw synchronously')
  }
  await harness.run.prepare()
  try {
    // Act
    harness.loseBrowser()
    await waitUntil(() => harness.run.view().phase === 'failed', 'the end')
    // gstack-timing-ok: lets a would-be unhandled rejection surface
    await new Promise((resolve) => setTimeout(resolve, 20))
    // Assert
    assert.deepEqual(unhandled, [])
    assert.deepEqual(harness.run.view().cleanup, {
      profileLeft: true,
      exitConfirmed: false,
    })
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

// protects=SR2 (Cycle 0062 task 17): a click called while the cleanup of an accepted stop is still running is refused and starts nothing; fails_when=the click dispatches, or clickInFlight is set, during cleanup; no_claim=the error wording
test('a click during the cleanup of a stop is refused and never reaches the executor', async () => {
  // Arrange
  const closeGate = defer<{ profileLeft: boolean; exitConfirmed: boolean }>()
  const harness = createRunHarness()
  harness.browser.close = () => closeGate.promise
  await harness.run.prepare()
  const stopping = harness.run.stop()
  await waitUntil(
    () => harness.log.includes('executor.dispose'),
    'the cleanup to reach the browser close',
  )
  // Act
  const refusal = await harness.run.click().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal((refusal as StudyError).code, 'RUN_NOT_READY')
  assert.equal(harness.run.view().procedure.clickInFlight, undefined)
  assert.equal(harness.log.includes('executor.run:1'), false)
  closeGate.resolve({ profileLeft: false, exitConfirmed: true })
  await stopping
})

// protects=DR3 (Cycle 0062 task 17): the pause pin's 2 s capture timer is cleared when the run ends, so none outlives a stopped run; fails_when=a timer for the pin stays pending after the run ended; no_claim=the pin's frame
test('the pause pin leaves no capture timer pending once the run has ended', async () => {
  // Arrange
  const neverAnswers = defer<Record<string, unknown>>()
  const timers = manualClock()
  const harness = createRunHarness({
    clock: timers.clock,
    surfaceAnswers: { 'Page.captureScreenshot': () => neverAnswers.promise },
  })
  await harness.run.prepare()
  harness.openDeclaredPause(1, 'service-worker')
  await waitUntil(
    () => timers.pendingDelays().includes(2_000),
    'the pin capture timer to be armed',
  )
  // Act
  await harness.run.stop()
  // Assert
  assert.deepEqual(timers.pendingDelays(), [])
})

// protects=DR3 (Cycle 0062 review OCR-M6): the pin capture settles when the run ends although the paused page never answers its screenshot; fails_when=cleanup cancels the 2 s timer without settling the race, so the capture never ends; no_claim=the pin's frame
test('a pause pin whose page never answers settles when the run ends', async () => {
  // Arrange
  const neverAnswers = defer<Record<string, unknown>>()
  const timers = manualClock()
  const harness = createRunHarness({
    clock: timers.clock,
    surfaceAnswers: { 'Page.captureScreenshot': () => neverAnswers.promise },
  })
  const originalRace = Promise.race.bind(Promise)
  const races: Promise<unknown>[] = []
  Promise.race = ((values: Iterable<unknown>) => {
    const race = originalRace(values as Iterable<Promise<unknown>>)
    races.push(race)
    return race
  }) as typeof Promise.race
  try {
    await harness.run.prepare()
    harness.openDeclaredPause(1, 'service-worker')
    await waitUntil(
      () => timers.pendingDelays().includes(2_000),
      'the pin capture timer to be armed',
    )
    const pinRace = races[races.length - 1]
    assert.notEqual(pinRace, undefined)
    // Act
    await harness.run.stop()
    // Assert
    const settled = await originalRace([
      Promise.resolve(pinRace).then(
        () => 'settled',
        () => 'settled',
      ),
      new Promise<string>((resolve) => setTimeout(resolve, 200, 'pending')),
    ])
    assert.equal(settled, 'settled')
  } finally {
    Promise.race = originalRace
  }
})

// protects=ER18 (Cycle 0062 review CR1): a browser a stuck step publishes after the stop bound is closed, and a failed late close shows in the run resource's cleanup; fails_when=the late close result is dropped and the resource keeps reporting a clean cleanup; no_claim=the 10 s value
test('a late browser whose close fails is reported in the run resource cleanup', async () => {
  // Arrange
  const launchGate = defer<void>()
  const timers = manualClock()
  const harness = createRunHarness({
    launchGate: launchGate.promise,
    clock: timers.clock,
  })
  harness.browser.close = async () => {
    harness.log.push('browser.close')
    return { profileLeft: true, exitConfirmed: false }
  }
  const preparing = harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await waitUntil(() => harness.log.includes('launch'), 'the launch')
  const stopping = harness.run.stop()
  await waitUntil(
    () => timers.pendingDelays().includes(10_000),
    'the stop bound to be armed',
  )
  timers.fire(10_000)
  await stopping
  // The launch is still under way, so nothing is confirmed yet (CX2).
  assert.deepEqual(harness.run.view().cleanup, {
    profileLeft: true,
    exitConfirmed: false,
  })
  // Act
  launchGate.resolve()
  await preparing
  await waitUntil(
    () => harness.log.includes('browser.close'),
    'the late browser to be closed',
  )
  // Assert
  await waitUntil(
    () => harness.run.view().cleanup?.profileLeft === true,
    'the failed late close to reach the cleanup state',
  )
  assert.deepEqual(harness.run.view().cleanup, {
    profileLeft: true,
    exitConfirmed: false,
  })
})

// protects=ER18 (Cycle 0062 ship review RT1): a viewport a stuck first step publishes after the stop bound is closed once, after the run ended; fails_when=the late viewport stays open and the Application lease stays current after the run ended; no_claim=the 10 s value
test('a viewport a stuck step publishes after the stop bound is closed once', async () => {
  // Arrange
  const viewportGate = defer<void>()
  const timers = manualClock()
  const harness = createRunHarness({
    viewportGate: viewportGate.promise,
    clock: timers.clock,
  })
  const preparing = harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  const stopping = harness.run.stop()
  await waitUntil(
    () => timers.pendingDelays().includes(10_000),
    'the stop bound to be armed',
  )
  timers.fire(10_000)
  await stopping
  assert.equal(harness.log.includes('viewport.close'), false)
  // Act
  viewportGate.resolve()
  await preparing
  // Assert
  await waitUntil(
    () => harness.log.includes('viewport.close'),
    'the late viewport to be closed',
  )
  assert.equal(
    harness.log.filter((entry) => entry === 'viewport.close').length,
    1,
  )
})

// protects=state matrix viewport × already-handled (Cycle 0062 ship review pass 2): when a stuck launch publishes its browser only after the stop bound, the late check closes that browser and leaves the viewport the cleanup already closed alone; fails_when=the late check closes the viewport a second time; no_claim=the 10 s value
test('a viewport the cleanup already closed is not closed again when the stuck launch publishes its browser late', async () => {
  // Arrange
  const launchGate = defer<void>()
  const timers = manualClock()
  const harness = createRunHarness({
    launchGate: launchGate.promise,
    clock: timers.clock,
  })
  const preparing = harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await waitUntil(() => harness.log.includes('launch'), 'the launch to start')
  const stopping = harness.run.stop()
  await waitUntil(
    () => timers.pendingDelays().includes(10_000),
    'the stop bound to be armed',
  )
  timers.fire(10_000)
  await stopping
  assert.equal(
    harness.log.filter((entry) => entry === 'viewport.close').length,
    1,
  )
  // Act
  launchGate.resolve()
  await preparing
  // Assert
  await waitUntil(
    () => harness.log.includes('browser.close'),
    'the late browser to be closed',
  )
  assert.equal(
    harness.log.filter((entry) => entry === 'viewport.close').length,
    1,
  )
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
})

// protects=CX2 (Cycle 0062 ship review, Codex): a stop that passes its bound while the launch is still under way reports the cleanup unconfirmed, and the late browser's clean close then confirms it; fails_when=the resource claims no profile left and a confirmed exit before the launch's browser was ever closed; no_claim=the real launcher's profile timing
test('a stop with the launch still under way reports its cleanup unconfirmed until the late browser is closed', async () => {
  // Arrange
  const launchGate = defer<void>()
  const timers = manualClock()
  const harness = createRunHarness({
    launchGate: launchGate.promise,
    clock: timers.clock,
  })
  const preparing = harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await waitUntil(() => harness.log.includes('launch'), 'the launch to start')
  const stopping = harness.run.stop()
  await waitUntil(
    () => timers.pendingDelays().includes(10_000),
    'the stop bound to be armed',
  )
  // Act
  timers.fire(10_000)
  await stopping
  // Assert
  assert.equal(harness.log.includes('browser.close'), false)
  assert.deepEqual(harness.run.view().cleanup, {
    profileLeft: true,
    exitConfirmed: false,
  })
  launchGate.resolve()
  await preparing
  await waitUntil(
    () => harness.run.view().cleanup?.exitConfirmed === true,
    'the late close to confirm the cleanup',
  )
  assert.deepEqual(harness.run.view().cleanup, {
    profileLeft: false,
    exitConfirmed: true,
  })
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
})

// protects=CX2 (Cycle 0062 ship review, Codex): a stuck step that settles after the bound without ever launching a browser confirms the cleanup it left unconfirmed; fails_when=the run resource keeps reporting a profile left after a run that never launched Chrome; no_claim=the 10 s value
test('a stuck step that settles without a browser confirms the cleanup it left unconfirmed', async () => {
  // Arrange
  const viewportGate = defer<void>()
  const timers = manualClock()
  const harness = createRunHarness({
    viewportGate: viewportGate.promise,
    clock: timers.clock,
  })
  const preparing = harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  const stopping = harness.run.stop()
  await waitUntil(
    () => timers.pendingDelays().includes(10_000),
    'the stop bound to be armed',
  )
  timers.fire(10_000)
  await stopping
  assert.deepEqual(harness.run.view().cleanup, {
    profileLeft: true,
    exitConfirmed: false,
  })
  // Act
  viewportGate.resolve()
  await preparing
  // Assert
  await waitUntil(
    () => harness.run.view().cleanup?.exitConfirmed === true,
    'the settled step to confirm the cleanup',
  )
  assert.deepEqual(harness.run.view().cleanup, {
    profileLeft: false,
    exitConfirmed: true,
  })
  assert.equal(harness.log.includes('launch'), false)
})

// protects=A1 (Cycle 0062 ship review, Codex adversarial): once a stop passes its bound with a preparation step that never settles, the run's preparation answers too, so the service's stop, which waits for it, returns and frees the run slot; fails_when=prepare keeps waiting on the stuck step after the run ended; no_claim=the service's own stop path (it awaits this preparation)
test('the preparation answers once the stop bound passes although a preparation step never settles', async () => {
  // Arrange
  const viewportGate = defer<void>()
  const timers = manualClock()
  const harness = createRunHarness({
    viewportGate: viewportGate.promise,
    clock: timers.clock,
  })
  let settled: unknown = 'pending'
  const preparing = harness.run.prepare().then(
    () => 'resolved',
    (error: unknown) => error,
  )
  void preparing.then((outcome) => {
    settled = outcome
  })
  const stopping = harness.run.stop()
  await waitUntil(
    () => timers.pendingDelays().includes(10_000),
    'the stop bound to be armed',
  )
  // Act
  timers.fire(10_000)
  await stopping
  // Assert
  await waitUntil(
    () => settled !== 'pending',
    'the preparation to answer after the stop bound',
  )
  assert.equal(
    (settled as StudyError).message,
    'The extension run was stopped before it was ready.',
  )
  viewportGate.resolve()
})

// protects=A2 (Cycle 0062 ship review, Codex adversarial; native INVESTIGATE): a launch that began and then failed after the stop bound keeps the cleanup unconfirmed, since its own close result (profile and Chrome) is not handed back; fails_when=the run resource confirms a clean exit for a launch that made a profile and a Chrome it may not have removed; no_claim=the launcher's own failure cleanup
test('a launch that began and failed after the stop bound keeps the cleanup unconfirmed', async () => {
  // Arrange
  const launchGate = defer<void>()
  const timers = manualClock()
  const harness = createRunHarness({
    launchGate: launchGate.promise,
    launchFailure: new StudyError('RUNTIME_FAILED', 'Chrome did not start.'),
    clock: timers.clock,
  })
  const preparing = harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await waitUntil(() => harness.log.includes('launch'), 'the launch to start')
  const stopping = harness.run.stop()
  await waitUntil(
    () => timers.pendingDelays().includes(10_000),
    'the stop bound to be armed',
  )
  timers.fire(10_000)
  await stopping
  // Act
  launchGate.resolve()
  await preparing
  // gstack-timing-ok: a negative check; the late check runs as soon as the failed launch settles, so one settle shows whether it changed the cleanup.
  await new Promise((resolve) => setTimeout(resolve, 50))
  // Assert
  assert.deepEqual(harness.run.view().cleanup, {
    profileLeft: true,
    exitConfirmed: false,
  })
})

// protects=state matrix deadline × click (Cycle 0062 ship review): a click called while the cleanup after the whole-run deadline is still running is refused RUN_NOT_READY and never reaches the executor; fails_when=the click dispatches, or is refused with another code, during that cleanup; no_claim=the error wording
test('a click during the cleanup after the whole-run deadline is refused and never reaches the executor', async () => {
  // Arrange
  const closeGate = defer<{ profileLeft: boolean; exitConfirmed: boolean }>()
  const timers = manualClock()
  const harness = createRunHarness({
    clock: timers.clock,
    timings: { runMs: 1_000 },
  })
  harness.browser.close = () => closeGate.promise
  await harness.run.prepare()
  timers.fire(1_000)
  await waitUntil(
    () => harness.log.includes('executor.dispose'),
    'the cleanup to reach the browser close',
  )
  // Act
  const refusal = await harness.run.click().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal((refusal as StudyError).code, 'RUN_NOT_READY')
  assert.equal(harness.log.includes('executor.run:1'), false)
  closeGate.resolve({ profileLeft: false, exitConfirmed: true })
  await waitUntil(() => harness.run.view().phase === 'failed', 'the end')
})

// protects=state matrix failed × click (Cycle 0062 ship review): a click called while the cleanup after a browser loss is still running is refused RUN_NOT_READY and never reaches the executor; fails_when=the click dispatches, or is refused with another code, during that cleanup; no_claim=the error wording
test('a click during the cleanup after a browser loss is refused and never reaches the executor', async () => {
  // Arrange
  const closeGate = defer<{ profileLeft: boolean; exitConfirmed: boolean }>()
  const harness = createRunHarness()
  harness.browser.close = () => closeGate.promise
  await harness.run.prepare()
  harness.loseBrowser()
  await waitUntil(
    () => harness.log.includes('executor.dispose'),
    'the cleanup to reach the browser close',
  )
  // Act
  const refusal = await harness.run.click().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal((refusal as StudyError).code, 'RUN_NOT_READY')
  assert.equal(harness.log.includes('executor.run:1'), false)
  closeGate.resolve({ profileLeft: false, exitConfirmed: true })
  await waitUntil(() => harness.run.view().phase === 'failed', 'the end')
})

// protects=state matrix deadline × cleanup with a stuck step (Cycle 0062 ship review): the whole-run deadline ends a run whose preparation step never settles, the cleanup finishes at the stop bound and the browser that appears late is closed once; fails_when=the cleanup waits for the stuck step, or the late browser stays open or is closed twice; no_claim=the 10 s value
test('the whole-run deadline with a stuck step ends at the stop bound and closes the late browser once', async () => {
  // Arrange
  const launchGate = defer<void>()
  const timers = manualClock()
  const harness = createRunHarness({
    launchGate: launchGate.promise,
    clock: timers.clock,
    timings: { runMs: 1_000 },
  })
  const preparing = harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await waitUntil(() => harness.log.includes('launch'), 'the launch')
  // Act
  timers.fire(1_000)
  await waitUntil(
    () => timers.pendingDelays().includes(10_000),
    'the stop bound to be armed',
  )
  timers.fire(10_000)
  await waitUntil(() => harness.run.view().phase === 'failed', 'the end')
  assert.equal(harness.log.includes('browser.close'), false)
  launchGate.resolve()
  await preparing
  // Assert
  await waitUntil(
    () => harness.log.includes('browser.close'),
    'the late browser to be closed',
  )
  assert.equal(
    harness.log.filter((entry) => entry === 'browser.close').length,
    1,
  )
})
