import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { createRunHarness } from './utils/chromeExtensionRunHarness'
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
