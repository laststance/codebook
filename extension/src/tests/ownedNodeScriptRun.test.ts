import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'

import {
  createScriptHarness,
  fakeScriptHistory,
  runningHarness,
  settle,
  until,
  type ScriptHarness,
} from './utils/nodeScriptRunHarness'

/** Hits declared stop `index` and continues it, the way the chat does at each pause. */
async function hitAndContinue(
  harness: ScriptHarness,
  index: number,
): Promise<void> {
  harness.debug.hit(index)
  await settle()
  const pause = harness.run.view().pause
  assert.ok(pause, `stop ${index} did not pause`)
  await harness.run.continue(pause)
}

/** Hits declared stop `index` and leaves it held. */
async function hit(harness: ScriptHarness, index: number): Promise<void> {
  harness.debug.hit(index)
  await settle()
}

/** Waits for the run's end and returns it. */
async function endOf(harness: ScriptHarness) {
  const view = await until(harness, (current) => current.end !== undefined)
  assert.ok(view.end)
  return view.end
}

const CLEAN_EXIT = { exitCode: 0, signal: null } as const

// protects=a learner who cancels the dialog ends the run before anything is spawned, with sideEffects none; fails_when=the script is launched without a yes, or the refusal drops its code or sideEffects; no_claim=the real modal (a fake asker answers)
test('a cancelled confirmation ends the run with SCRIPT_NOT_CONFIRMED and spawns nothing', async () => {
  // Arrange
  const harness = createScriptHarness({ confirm: 'no' })

  // Act
  const failure = await harness.run.prepare().catch((error: unknown) => error)

  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'SCRIPT_NOT_CONFIRMED')
  assert.equal(failure.details?.sideEffects, 'none')
  assert.equal(harness.run.view().confirmation, 'declined')
  assert.equal(harness.order.includes('launch'), false)
})

// protects=the dialog names the entry, the package root and the run so the learner decides on this script; fails_when=the question loses one of the three; no_claim=the dialog's wording (the asker owns it)
test('the confirmation question names the entry, the package root and the run', async () => {
  // Arrange
  const harness = createScriptHarness()

  // Act
  await harness.run.prepare()

  // Assert
  assert.deepEqual(harness.questions, [
    { runId: 'script-run-1', entry: 'script.mjs', packageRoot: '.' },
  ])
  assert.equal(harness.run.view().confirmation, 'confirmed')
})

// protects=an unanswered dialog reads confirming, ends as SCRIPT_NOT_CONFIRMED at the pause hold and a late Run once starts nothing; fails_when=the wait is unbounded or a late yes launches the script; no_claim=that the real dialog closes (the editor cannot close it)
test('an unanswered confirmation ends at the pause hold and a late answer starts nothing', async () => {
  // Arrange
  const harness = createScriptHarness({ confirm: 'manual' })
  const preparing = harness.run.prepare().catch((error: unknown) => error)
  await settle()
  const stateWhileAsked = harness.run.view().state

  // Act
  harness.clock.advance(300_000)
  const failure = await preparing
  harness.answer(true)
  await settle()

  // Assert
  assert.equal(stateWhileAsked, 'confirming')
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'SCRIPT_NOT_CONFIRMED')
  assert.equal(harness.order.includes('launch'), false)
})

// protects=a stop while the learner is asked ends the run without a spawn; fails_when=codebook_stop leaves the dialog's wait pending or launches afterwards; no_claim=closing the editor's dialog
test('stopping a run that awaits the learner ends it without spawning', async () => {
  // Arrange
  const harness = createScriptHarness({ confirm: 'manual' })
  const preparing = harness.run.prepare().catch((error: unknown) => error)
  await settle()

  // Act
  await harness.run.stop()
  await preparing
  harness.answer(true)
  await settle()

  // Assert
  assert.equal(harness.order.includes('launch'), false)
  assert.equal(harness.run.view().state, 'stopped')
})

/** Starts a run with the arranged refusal and returns what its preparation threw. */
async function refusalOf(options: Parameters<typeof createScriptHarness>[0]) {
  const harness = createScriptHarness(options)
  const failure = await harness.run.prepare().catch((error: unknown) => error)
  assert.ok(failure instanceof StudyError)
  // A refused source never reaches the learner or the process.
  assert.equal(harness.order.includes('confirmRun'), false)
  assert.equal(harness.order.includes('launch'), false)
  return failure
}

// protects=a packageRoot that is no folder is refused as package-root before the dialog; fails_when=the reason is lost or the learner is asked first; no_claim=real path resolution (the resolver is a fake)
test('a missing package root is refused with reason package-root and sideEffects none', async () => {
  // Arrange / Act
  const failure = await refusalOf({
    resolveLaunchFails: new StudyError(
      'NODE_SERVER_SOURCE_REFUSED',
      "node-server's packageRoot apps/x is not a folder inside the opened repository by its real path.",
    ),
  })

  // Assert
  assert.equal(failure.code, 'NODE_SCRIPT_SOURCE_REFUSED')
  assert.deepEqual(failure.details, {
    reason: 'package-root',
    sideEffects: 'none',
  })
  assert.match(failure.message, /node-script's packageRoot apps\/x/)
})

// protects=an entry that is no file inside the package is refused as entry; fails_when=another reason is reported; no_claim=real path resolution
test('a missing entry is refused with reason entry', async () => {
  // Arrange / Act
  const failure = await refusalOf({
    resolveLaunchFails: new StudyError(
      'NODE_SERVER_SOURCE_REFUSED',
      "node-server's entry run.mjs is not a file inside packageRoot . by its real path.",
    ),
  })

  // Assert
  assert.equal(failure.details?.reason, 'entry')
})

// protects=a TypeScript entry without the repository's tsx is refused as tsx-missing; fails_when=the chat cannot tell a missing tsx from another refusal; no_claim=the installed tsx lookup
test('a TypeScript entry with no repository tsx is refused with reason tsx-missing', async () => {
  // Arrange / Act
  const failure = await refusalOf({
    resolveLaunchFails: new StudyError(
      'NODE_SERVER_SOURCE_REFUSED',
      "node-server's TypeScript entry runs through the repository's own tsx, and none is installed for . (searched node_modules/tsx at the repository root); install the repository's dependencies.",
    ),
  })

  // Assert
  assert.equal(failure.details?.reason, 'tsx-missing')
})

// protects=a stop whose file is missing is refused as stop-file; fails_when=the reason is lost; no_claim=real path resolution
test('a stop in a missing file is refused with reason stop-file', async () => {
  // Arrange / Act
  const failure = await refusalOf({
    resolveStopsFails: new StudyError(
      'NODE_SERVER_SOURCE_REFUSED',
      "node-server's stop 2 (src/a.ts) is not a file inside the opened repository by its real path.",
    ),
  })

  // Assert
  assert.equal(failure.details?.reason, 'stop-file')
})

// protects=a stop in node_modules is refused as node-modules, a published package being no checked-out library; fails_when=a stop under node_modules arms; no_claim=symlinked node_modules layouts
test('a stop under node_modules is refused with reason node-modules', async () => {
  // Arrange / Act
  const failure = await refusalOf({
    stopFiles: ['/repo-of-the-run-test/node_modules/immer/src/env.ts'],
  })

  // Assert
  assert.equal(failure.details?.reason, 'node-modules')
})

// protects=a stop outside the package folder is refused as outside-package; fails_when=a file the script does not own arms; no_claim=real path resolution
test('a stop outside the package is refused with reason outside-package', async () => {
  // Arrange / Act
  const failure = await refusalOf({
    stopFiles: ['/another-folder/src/users.ts'],
  })

  // Assert
  assert.equal(failure.details?.reason, 'outside-package')
})

// protects=a changed source stays SOURCE_CHANGED and spawns nothing; fails_when=the script refusal mapping swallows the code; no_claim=real hashing
test('a source that changed since it was cited stays SOURCE_CHANGED', async () => {
  // Arrange / Act
  const failure = await refusalOf({
    resolveStopsFails: new StudyError('SOURCE_CHANGED', 'changed'),
  })

  // Assert
  assert.equal(failure.code, 'SOURCE_CHANGED')
})

// protects=a script that exits before reaching any stop names every declared stop as never reached; fails_when=a stop is reported reached or the list is missing; no_claim=a real process
test('a script that exits reaching no stop ends exited with all three stops never reached', async () => {
  // Arrange
  const harness = await runningHarness()

  // Act
  harness.exits(CLEAN_EXIT)
  const end = await endOf(harness)

  // Assert
  assert.equal(harness.run.view().state, 'ended')
  assert.equal(end.kind, 'exited')
  assert.equal(end.exitCode, 0)
  assert.deepEqual(end.stopsReached, [])
  assert.deepEqual(end.stopsNeverReached, [0, 1, 2])
})

// protects=a script that reached two of three stops names exactly the one never reached; fails_when=the list holds a reached stop or omits the missing one; no_claim=a real process
test('a script that reached two of three stops names the third as never reached', async () => {
  // Arrange
  const harness = await runningHarness()
  await hitAndContinue(harness, 0)
  await hitAndContinue(harness, 2)

  // Act
  harness.exits(CLEAN_EXIT)
  const end = await endOf(harness)

  // Assert
  assert.deepEqual(end.stopsReached, [0, 2])
  assert.deepEqual(end.stopsNeverReached, [1])
})

// protects=a script that reached every stop and exited 0 lists none never reached and tells the history; fails_when=a reached stop is still listed or the history misses the end; no_claim=the history file format
test('a script that reached all stops and exited 0 ends with none never reached and the history told', async () => {
  // Arrange
  const history = fakeScriptHistory()
  const harness = await runningHarness({ history: history.sink })
  for (const index of [0, 1, 2]) await hitAndContinue(harness, index)

  // Act
  harness.exits(CLEAN_EXIT)
  const end = await endOf(harness)

  // Assert
  assert.deepEqual(end.stopsNeverReached, [])
  assert.deepEqual(end.stopsReached, [0, 1, 2])
  assert.deepEqual(
    history.told.map((entry) => entry.call),
    ['stop', 'stop', 'stop', 'end'],
  )
})

// protects=a nonzero exit is an observed end the run reads as ended with no error; fails_when=the exit becomes a run failure; no_claim=Node's exit code semantics
test('a nonzero exit ends the run as an observed end, not a failure', async () => {
  // Arrange
  const harness = await runningHarness()

  // Act
  harness.exits({ exitCode: 3, signal: null })
  const end = await endOf(harness)

  // Assert
  assert.equal(end.kind, 'exited')
  assert.equal(end.exitCode, 3)
  assert.equal(harness.run.view().runFailure, undefined)
  assert.equal(harness.run.view().state, 'ended')
})

// protects=a signal Codebook did not send ends the run as signal; fails_when=it reads as exited or stopped; no_claim=which signal an outside process sends
test('an outside signal ends the run as signal naming it', async () => {
  // Arrange
  const harness = await runningHarness()

  // Act
  harness.exits({ exitCode: null, signal: 'SIGTERM' })
  const end = await endOf(harness)

  // Assert
  assert.equal(end.kind, 'signal')
  assert.equal(end.signal, 'SIGTERM')
})

// protects=the script's output tail reaches the end; fails_when=the tail is empty or the truncated flag lies; no_claim=private-root hiding (the launcher's capture does it)
test('the end carries the output tail', async () => {
  // Arrange
  const harness = await runningHarness()
  harness.process.output = (): string => 'seeded 3 items\n'

  // Act
  harness.exits(CLEAN_EXIT)
  const end = await endOf(harness)

  // Assert
  assert.deepEqual(end.output, { tail: 'seeded 3 items\n', truncated: false })
})

// protects=running time outside pauses is bounded at 60 s and a long pause is not counted; fails_when=a 100 s pause trips the limit or 60 s of running does not; no_claim=real elapsed time
test('the running-time limit counts 60 s outside pauses and ignores a pause', async () => {
  // Arrange
  const harness = await runningHarness()
  await hit(harness, 0)
  harness.clock.advance(100_000)
  const stillPaused = harness.run.view().state
  const pause = harness.run.view().pause
  assert.ok(pause)
  await harness.run.continue(pause)

  // Act
  harness.clock.advance(60_000)
  const end = await endOf(harness)

  // Assert
  assert.equal(stillPaused, 'paused')
  assert.equal(end.kind, 'limit')
  assert.equal(end.limit, 'running-time')
  assert.deepEqual(end.stopsNeverReached, [1, 2])
})

// protects=the run deadline counts pauses and ends the run killed first; fails_when=pauses are excluded from the deadline or the paused code is resumed; no_claim=the real 600 s
test('the run deadline ends a run whose pauses add up past 600 s', async () => {
  // Arrange
  const harness = await runningHarness()
  await hit(harness, 0)
  harness.clock.advance(250_000)
  await harness.run.continue(harness.run.view().pause!)
  await hit(harness, 1)
  harness.clock.advance(250_000)
  await harness.run.continue(harness.run.view().pause!)
  await hit(harness, 2)

  // Act
  harness.clock.advance(100_000)
  const end = await endOf(harness)

  // Assert
  assert.equal(end.kind, 'limit')
  assert.equal(end.limit, 'run-deadline')
  assert.ok(
    harness.order.indexOf('signal:SIGKILL') <
      harness.order.indexOf('debugger.release'),
  )
})

// protects=a pause held past 300 s ends the run as the pause-hold limit and kills before the debugger lets go; fails_when=the paused code is resumed or the limit is named otherwise; no_claim=the real hold timer
test('a pause held past the hold bound ends the run as the pause-hold limit without resuming it', async () => {
  // Arrange
  const harness = await runningHarness()
  await hit(harness, 0)

  // Act
  harness.clock.advance(300_000)
  const end = await endOf(harness)

  // Assert
  assert.equal(end.kind, 'limit')
  assert.equal(end.limit, 'pause-hold')
  assert.deepEqual(harness.process.closeWithDetach, [false])
  assert.equal(harness.debug.resumed.length, 0)
})

// protects=codebook_stop mid-pause ends the whole group killed first and names the end stopped; fails_when=the end names the SIGKILL, the paused code runs on, or the stop detaches first; no_claim=real child processes (the integration test covers them)
test('codebook_stop during a pause kills the group first and ends as stopped', async () => {
  // Arrange
  const harness = await runningHarness()
  await hitAndContinue(harness, 0)
  await hit(harness, 1)

  // Act
  await harness.run.stop()
  const end = await endOf(harness)

  // Assert
  assert.equal(end.kind, 'stopped')
  assert.deepEqual(end.stopsReached, [0, 1])
  assert.deepEqual(end.stopsNeverReached, [2])
  assert.equal(harness.run.view().state, 'stopped')
  assert.ok(
    harness.order.indexOf('signal:SIGKILL') <
      harness.order.indexOf('debugger.release'),
  )
  assert.deepEqual(harness.process.closeWithDetach, [false])
})

// protects=the parent's exit is the end even while a child holds stdout, reported after the 500 ms settle with the group confirmed as the launched one before it is cleaned up; fails_when=the end waits for the pipes or the cleanup signals an unconfirmed group; no_claim=real pipes
test('the parent exiting while a child holds stdout ends after the settle with the parent exit code', async () => {
  // Arrange
  const harness = await runningHarness()
  harness.exits({ exitCode: 7, signal: null }, false)
  await settle()
  const beforeSettle = harness.run.view().end

  // Act
  harness.clock.advance(500)
  const end = await endOf(harness)

  // Assert
  assert.equal(beforeSettle, undefined)
  assert.equal(end.kind, 'exited')
  assert.equal(end.exitCode, 7)
  const close = harness.process.closeOptions[0]
  assert.equal(close?.retried, true)
  assert.equal(await close?.confirmGroup?.(), 'launched')
})

// protects=after a natural exit a group that is already gone receives no signal; fails_when=the cleanup signals a group id nobody holds; no_claim=real process groups
test('a group that is gone after the natural exit is left alone', async () => {
  // Arrange
  const harness = await runningHarness({ groupGone: true })

  // Act
  harness.exits(CLEAN_EXIT)
  await endOf(harness)

  // Assert
  assert.deepEqual(harness.signals, [])
  const close = harness.process.closeOptions[0]
  assert.equal(await close?.confirmGroup?.(), 'gone')
})

// protects=a debug session that ends while the process lives ends the run as exit-deadline after the 10 s stop deadline; fails_when=the run fails at once or never ends; no_claim=js-debug's own session end
test('a debug session ending without an exit ends the run as exit-deadline after 10 s', async () => {
  // Arrange
  const harness = await runningHarness()
  harness.debug.handlers?.onEnd('session terminated')
  await settle()
  const beforeDeadline = harness.run.view()

  // Act
  harness.clock.advance(10_000)
  const end = await endOf(harness)

  // Assert
  assert.equal(beforeDeadline.end, undefined)
  assert.equal(beforeDeadline.runFailure, undefined)
  assert.equal(end.kind, 'limit')
  assert.equal(end.limit, 'exit-deadline')
})

// protects=once 16 captures are spent a stop first reached later is not observed rather than never reached; fails_when=stopsNeverReached lists the retired stop; no_claim=the debugger's real breakpoint retirement
test('after the capture budget a stop first reached later reads not observed, never never-reached', async () => {
  // Arrange
  const history = fakeScriptHistory()
  const harness = await runningHarness({ history: history.sink })
  for (let count = 0; count < 16; count++) await hitAndContinue(harness, 0)
  harness.debug.hit(1)
  await settle()

  // Act
  harness.exits(CLEAN_EXIT)
  const end = await endOf(harness)

  // Assert
  assert.equal(end.captureBudgetExhausted, true)
  assert.deepEqual(end.stopsReached, [0])
  assert.deepEqual(end.stopsNeverReached, [])
  assert.deepEqual(end.stopsNotObserved, [1, 2])
  assert.ok(history.told.some((entry) => entry.call === 'budget'))
})

// protects=Node's debugger-disconnect text printed mid-run never detaches the debugger, so later stops still pause; fails_when=a script's own output releases the debugger; no_claim=Node's real notice
test('a script printing the debugger-disconnect notice keeps its debugger and its later stops pause', async () => {
  // Arrange
  const harness = await runningHarness()
  await hitAndContinue(harness, 0)

  // Act
  harness.emitOutput('Waiting for the debugger to disconnect...\n', 'stderr')
  await settle()
  await hit(harness, 1)

  // Assert
  assert.equal(harness.debug.releaseCount, 0)
  assert.equal(harness.run.view().state, 'paused')
  assert.equal(harness.run.view().pause?.declaredStopIndex, 1)
})

// protects=a failure after the spawn kills the group before the debugger lets go and reports sideEffects unknown with the trace; fails_when=the debugger detaches first or the failure claims no side effects; no_claim=js-debug timing (a fake debugger)
test('a preparation failure after the spawn kills first and reports sideEffects unknown', async () => {
  // Arrange
  const harness = createScriptHarness({ armFails: new Error('arming failed') })

  // Act
  const failure = await harness.run.prepare().catch((error: unknown) => error)

  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'RUNTIME_FAILED')
  assert.equal(failure.details?.sideEffects, 'unknown')
  assert.equal(failure.details?.trace, 'codebook://node-history/trace')
  assert.equal(harness.order.includes('detach'), false)
  assert.ok(
    harness.order.indexOf('signal:SIGKILL') <
      harness.order.indexOf('debugger.release'),
  )
})

// protects=a stop on the entry's first statement during the release is captured, not taken as a start hit; fails_when=the hit is continued unrecorded; no_claim=js-debug's entry-pause variance
test('a stop hit while the script is released is captured and pauses', async () => {
  // Arrange
  const harness = createScriptHarness({
    duringRelease: (debug) => void debug.hit(0),
  })

  // Act
  await harness.run.prepare()
  await settle()

  // Assert
  assert.equal(harness.run.view().state, 'paused')
  assert.equal(harness.run.view().pause?.declaredStopIndex, 0)
})

// protects=a script run's failure sentence names the script and the node-script profile, never the server; fails_when=the shared core words a script run's failure as the server's; no_claim=the server's sentences (nodeServer tests keep them byte for byte)
test('a script run that fails while attaching the debugger says script and never server', async () => {
  // Arrange
  const harness = createScriptHarness({ attachFails: new Error('refused') })

  // Act
  const failure = await harness.run.prepare().catch((error: unknown) => error)

  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(
    failure.message,
    'The node-script run failed while attaching the debugger: refused.',
  )
  assert.doesNotMatch(failure.message, /server/)
})
