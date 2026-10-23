import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { workspaceHarness } from './studyWorkspaceHarness'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import {
  explainFirstStop,
  lastView,
  saveTwoStopNodeHistory,
} from './utils/twoStopNodeHistory'

type Harness = Awaited<ReturnType<typeof workspaceHarness>>
type History = Awaited<ReturnType<typeof saveTwoStopNodeHistory>>

/**
 * Opens a saved two-stop test replay at its first stop (sequence 2) with its material explained and the second step, `keep`, chosen.
 * @param harness - The workspace harness.
 * @returns The replay's header.
 * @example const history = await openWithChosenStep(harness)
 */
async function openWithChosenStep(harness: Harness): Promise<History> {
  const history = await saveTwoStopNodeHistory(
    harness.service.nodeHistoryStore!,
  )
  await harness.reader.action('retry')
  await harness.reader.openLearningReplay(history.studyId)
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
      !lastView(harness)?.loading,
    'the test replay lands on its first stop',
    READER_RESULT_BOUND_MS,
  )
  await explainFirstStop(harness, history)
  harness.receiveContext({
    type: 'node-history-event',
    revision: lastView(harness)!.revision,
    studyId: history.studyId,
    sequence: 2,
    stepId: 'keep',
  })
  await waitUntil(
    () => lastView(harness)?.nodeHistorySection?.selectedStepId === 'keep',
    'the chosen step is shown',
    READER_RESULT_BOUND_MS,
  )
  return history
}

/**
 * Reads the moment and step the Study pane shows.
 * @param harness - The workspace harness.
 * @returns The selected sequence, the shown step and its explanation, and the locator.
 * @example shownMoment(harness) // => { sequence: 2, stepId: 'keep', explanation: '…', position: 'Stop 1 of 2 · 0.20 s' }
 */
function shownMoment(harness: Harness) {
  const view = lastView(harness)
  return {
    sequence: view?.nodeHistoryPosition?.sequence,
    stepId: view?.nodeHistorySection?.selectedStepId,
    explanation: view?.nodeHistorySection?.explanation,
    position: view?.nodeHistorySection?.position,
  }
}

/**
 * Moves a replay that stands at its first stop to another event and waits until it shows it.
 * @param harness - The workspace harness.
 * @param history - The replay's header.
 * @param sequence - The event to stand at.
 * @example await standAt(harness, history, 3)
 */
async function standAt(
  harness: Harness,
  history: History,
  sequence: number,
): Promise<void> {
  if (sequence === 2) return
  harness.receiveContext({
    type: 'node-history-event',
    revision: lastView(harness)!.revision,
    studyId: history.studyId,
    sequence,
  })
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence === sequence &&
      !lastView(harness)?.loading,
    'the replay stands at the start of the move',
    READER_RESULT_BOUND_MS,
  )
  // The reader position is written after the commit; the harness is not closed under that write.
  await waitUntil(
    async () =>
      (await harness.service.nodeHistoryStore!.readReaderPosition(
        history.studyId,
      )) === sequence,
    'the start of the move is saved',
    READER_RESULT_BOUND_MS,
  )
}

/** One way to leave the first stop for a moment whose debugger presentation the test holds. */
type Move = {
  name: string
  /** Whether the held presentation is the next recorded stop's (a move to an output is held by the default hold). */
  recordedStopOnly: boolean
  /** The event the replay stands at when the move starts; the first stop (2) by default. A move to an output cannot hold a debugger presentation, so the moves that leave an output or come back to a stop start elsewhere. */
  startSequence?: number
  /** The recorded time, in milliseconds, of the shown moment, which a seek onto it overtakes the move with; 200 (the first stop) by default. */
  seekMs?: number
  /** Whether the move goes through the playback controller, whose seek waits for the pending presentation: the seek that overtakes it is then only started before the presentation ends. */
  throughController?: boolean
  message: (
    history: History,
    revision: number,
  ) => Parameters<Harness['receiveContext']>[0]
}

const MOVES_FROM_THE_FIRST_STOP: Move[] = [
  {
    name: 'Select event',
    recordedStopOnly: true,
    message: (history, revision) => ({
      type: 'node-history-event',
      revision,
      studyId: history.studyId,
      sequence: 4,
    }),
  },
  {
    name: 'Next stop',
    recordedStopOnly: true,
    message: (history, revision) => ({
      type: 'node-history-step',
      revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    }),
  },
  {
    name: 'Next event',
    recordedStopOnly: true,
    startSequence: 3,
    seekMs: 250,
    message: (history, revision) => ({
      type: 'node-history-step',
      revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'event',
    }),
  },
  {
    name: 'Previous stop',
    recordedStopOnly: true,
    startSequence: 4,
    seekMs: 300,
    message: (history, revision) => ({
      type: 'node-history-step',
      revision,
      studyId: history.studyId,
      direction: 'previous',
      unit: 'stop',
    }),
  },
  {
    name: 'Previous event',
    recordedStopOnly: true,
    startSequence: 3,
    seekMs: 250,
    message: (history, revision) => ({
      type: 'node-history-step',
      revision,
      studyId: history.studyId,
      direction: 'previous',
      unit: 'event',
    }),
  },
  {
    name: 'seek',
    recordedStopOnly: true,
    throughController: true,
    message: (history, revision) => ({
      type: 'node-history-playback',
      revision,
      studyId: history.studyId,
      action: 'seek',
      positionMs: 300,
    }),
  },
  {
    name: 'Inspect',
    recordedStopOnly: true,
    message: (history, revision) => ({
      type: 'node-history-stop',
      revision,
      studyId: history.studyId,
      sequence: 4,
    }),
  },
]

for (const move of MOVES_FROM_THE_FIRST_STOP) {
  // A seek that has started presents and commits on its own; the case of a seek overtaken by a newer seek is its own test below.
  if (!move.throughController)
    // Value: protects=a move overtaken before its debugger presentation shows commits nothing of its own: the moment, the step the learner chose and its explanation stay as they were, and the overtaken press says nothing; fails_when=the overtaken move's moment or first step is committed (even for an instant, in a view posted after its presentation ends) or outlives it, or the superseded presentation is reported as an error; why_new=F139: only an overtaken step action was tested; seam=the workspace harness's held historical debug presentation, rejected as superseded; no_claim=the move that overtakes it (a seek onto the shown moment)
    test(`a ${move.name} overtaken before its stop is shown leaves the moment and the step the learner chose`, async () => {
      // Arrange
      const harness = await workspaceHarness()
      try {
        const history = await openWithChosenStep(harness)
        await standAt(harness, history, move.startSequence ?? 2)
        const before = shownMoment(harness)
        const held = harness.holdHistoricalDebugPresentation(
          move.recordedStopOnly,
        )
        // The move's own selection is kept so the test can wait for its end, whatever the product awaits after the presentation.
        const reader = harness.reader as unknown as {
          selectNodeHistoryEvent: (...args: unknown[]) => Promise<void>
        }
        const selectNodeHistoryEvent =
          reader.selectNodeHistoryEvent.bind(reader)
        const selections: Promise<void>[] = []
        reader.selectNodeHistoryEvent = (...args): Promise<void> => {
          const selection = selectNodeHistoryEvent(...args)
          selections.push(selection)
          return selection
        }
        harness.receiveContext(
          move.message(history, lastView(harness)!.revision),
        )
        await held.started
        const requestsBefore = harness.reader['selectedNodeHistoryRequest']

        // Act: a seek onto the shown moment overtakes the pending move.
        const seeking = harness.reader['nodeHistoryPlaybackController']!.seek(
          move.seekMs ?? 200,
        )
        if (!move.throughController)
          await waitUntil(
            () => harness.reader['selectedNodeHistoryRequest'] > requestsBefore,
            'the seek’s selection overtakes the move',
            READER_RESULT_BOUND_MS,
          )
        const postedBeforeRelease = harness.postedMessages().length
        held.reject(
          new Error('Historical debugger presentation was superseded.'),
        )
        await seeking
        // The overtaken move can end after the seek has: wait for its own selection to end before reading what was shown.
        await selections[0]

        // Assert
        // The overtaken move must not show its own moment even for an instant: every view posted from the release on stands at the moment the learner was at.
        const sequencesShownAfterRelease = harness
          .postedMessages()
          .slice(postedBeforeRelease)
          .flatMap((view) =>
            view.nodeHistoryPosition ? [view.nodeHistoryPosition.sequence] : [],
          )
          .filter((sequence) => sequence !== (move.startSequence ?? 2))
        assert.deepEqual(sequencesShownAfterRelease, [])
        assert.deepEqual(shownMoment(harness), before)
        assert.equal(shownMoment(harness).sequence, move.startSequence ?? 2)
        assert.equal(lastView(harness)?.errors.length, 0)
      } finally {
        await harness.close()
      }
    })

  // Value: protects=a move whose debugger presentation fails commits nothing of its own: the error is reported by name, and the moment, the step the learner chose and its explanation stay as they were; fails_when=the failed move's moment or first step is committed, or no error line tells the learner; why_new=F147: only a step action's failed presentation was tested; seam=the workspace harness's held historical debug presentation, rejected as failed; no_claim=the wording of the editor's own failure
  test(`a ${move.name} whose debugger presentation fails leaves the moment and the step the learner chose`, async () => {
    // Arrange
    const harness = await workspaceHarness()
    try {
      const history = await openWithChosenStep(harness)
      await standAt(harness, history, move.startSequence ?? 2)
      const before = shownMoment(harness)
      const held = harness.holdHistoricalDebugPresentation(
        move.recordedStopOnly,
      )
      harness.receiveContext(move.message(history, lastView(harness)!.revision))
      await held.started

      // Act
      held.reject(
        new Error('Run and Debug could not load the recorded values.'),
      )
      await waitUntil(
        () => (lastView(harness)?.errors.length ?? 0) > 0,
        'the failed presentation is reported',
        READER_RESULT_BOUND_MS,
      )

      // Assert
      assert.match(
        lastView(harness)!.errors[0]!,
        /Run and Debug could not load the recorded values\./,
      )
      assert.deepEqual(shownMoment(harness), before)
    } finally {
      await harness.close()
    }
  })
}

/**
 * Gives the open test replay's playback a clock the test moves by hand, so Play's dwell is passed without waiting.
 * @param harness - The workspace harness.
 * @returns Advances the clock by the given milliseconds and returns the controller.
 * @example const advance = playbackClock(harness); advance(1_000)
 */
function playbackClock(harness: Harness) {
  const controller = harness.reader['nodeHistoryPlaybackController']!
  let now = 0
  Object.assign(controller, { clock: () => now })
  return (milliseconds: number) => {
    now += milliseconds
    return controller
  }
}

// Value: protects=a Play step whose debugger presentation fails reports the error, pauses Play and leaves the moment and the step the learner chose; fails_when=the failed step's event or its first step is committed, Play keeps running after the failure, or no error line tells the learner; why_new=F147: only a step action's failed presentation was tested; seam=the workspace harness's held historical debug presentation and the playback clock, moved by hand; no_claim=Play's pacing
test('a Play step whose debugger presentation fails pauses Play and leaves the moment and the step the learner chose', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openWithChosenStep(harness)
    // Play from the output after the first stop, whose next event is a recorded stop that can hold the debugger presentation.
    await standAt(harness, history, 3)
    const before = shownMoment(harness)
    const advance = playbackClock(harness)
    const controller = advance(0)
    controller.play()
    const held = harness.holdHistoricalDebugPresentation(true)
    advance(1_000)
    await held.started

    // Act
    held.reject(new Error('Run and Debug could not load the recorded values.'))
    await waitUntil(
      () => (lastView(harness)?.errors.length ?? 0) > 0,
      'the failed presentation is reported',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(shownMoment(harness), before)
    assert.equal(controller.state().mode, 'paused')
    assert.match(
      lastView(harness)!.errors[0]!,
      /Run and Debug could not load the recorded values\./,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a seek that is presenting when a newer seek arrives commits nothing: while the newer seek's presentation loads, the Study pane still shows the moment it showed before, not the overtaken seek's moment, and the newer seek's moment (here the same one) shows when it ends, with the step the learner chose kept and without an error; fails_when=the overtaken seek's presentation ends and commits its moment (the Study pane and the Application pane show it) before the newer seek has shown anything; why_new=F139 (the coordinator's review of PR-2 B): an in-flight seek or Play step committed at the host after a newer seek had overtaken it; seam=the workspace harness's held historical debug presentation, held twice (the overtaken seek's, then the newer seek's) and released in order; no_claim=the native debugger's own display between the two presentations
test('a seek that is presenting when a newer seek arrives commits nothing before the newer seek shows', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openWithChosenStep(harness)
    const before = shownMoment(harness)
    const controller = harness.reader['nodeHistoryPlaybackController']!
    const overtakenHold = harness.holdHistoricalDebugPresentation(true)
    harness.receiveContext({
      type: 'node-history-playback',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      action: 'seek',
      positionMs: 300,
    })
    await overtakenHold.started

    // Act: a newer seek onto the first stop arrives while the first seek presents; the first seek's presentation then ends.
    const newerHold = harness.holdHistoricalDebugPresentation(true)
    const newerSeek = controller.seek(200)
    overtakenHold.release()
    await newerHold.started
    const whileNewerLoads = shownMoment(harness)
    newerHold.release()
    await newerSeek

    // Assert
    assert.deepEqual(whileNewerLoads, before)
    assert.equal(whileNewerLoads.sequence, 2)
    assert.equal(shownMoment(harness).sequence, 2)
    assert.equal(shownMoment(harness).stepId, 'keep')
    assert.equal(controller.state().sequence, 2)
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a Play step that is presenting when a newer seek arrives commits nothing: while the newer seek loads, the Study pane still shows the moment Play started from, not the played event; the newer seek's moment shows when it ends; fails_when=the overtaken Play step commits its event before the newer seek has shown anything; why_new=F139 (the coordinator's review of PR-2 B): the same defect as the seek's, through Play; seam=the workspace harness's held historical debug presentation and the playback clock, moved by hand; no_claim=Play's pacing
test('a Play step that is presenting when a newer seek arrives commits nothing before the newer seek shows', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openWithChosenStep(harness)
    await standAt(harness, history, 3)
    const before = shownMoment(harness)
    const advance = playbackClock(harness)
    const controller = advance(0)
    controller.play()
    const playHold = harness.holdHistoricalDebugPresentation(true)
    advance(1_000)
    await playHold.started

    // Act
    const newerHold = harness.holdHistoricalDebugPresentation(true)
    const newerSeek = controller.seek(200)
    playHold.release()
    await newerHold.started
    const whileNewerLoads = shownMoment(harness)
    newerHold.release()
    await newerSeek

    // Assert
    assert.deepEqual(whileNewerLoads, before)
    assert.equal(whileNewerLoads.sequence, 3)
    assert.equal(shownMoment(harness).sequence, 2)
    assert.equal(controller.state().sequence, 2)
    assert.equal(controller.state().mode, 'paused')
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=Play away from a chosen step and back shows the moment's first step, as a seek or Inspect away and back does (DS21); fails_when=the step the learner chose outlives Play's move to another moment and returns when the selection comes back; why_new=F147: Play away from a chosen step and back had no test; seam=the playback clock, moved by hand; no_claim=Play's pacing
test('Play away from a chosen step and back shows the moment’s first step', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await openWithChosenStep(harness)
    const advance = playbackClock(harness)
    const controller = advance(0)
    controller.play()

    // Act: Play steps to the output after the stop, is paused, and a seek comes back to the stop.
    await advance(1_000).tick()
    controller.pause()
    const atOutput = shownMoment(harness).sequence
    await controller.seek(200)

    // Assert
    assert.equal(atOutput, 3)
    assert.equal(shownMoment(harness).sequence, 2)
    assert.equal(shownMoment(harness).stepId, 'read')
  } finally {
    await harness.close()
  }
})

// Value: protects=Play at the result starts nothing: the moment stays the result, Play stays paused, no error is told and nothing is posted into the Application pane; fails_when=Play at the end runs, moves the selection or reports an error; why_new=F147: Play at the result had no test; seam=none; no_claim=the Play button's disabled state (the Reader DOM check)
test('Play at the result starts nothing and tells no error', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openWithChosenStep(harness)
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 5,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 5,
      'the result is selected',
      READER_RESULT_BOUND_MS,
    )
    const controller = harness.reader['nodeHistoryPlaybackController']!
    const outputsBefore = harness.applicationOutputs().length

    // Act
    controller.play()
    harness.receiveContext({
      type: 'node-history-playback',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      action: 'play',
    })
    // The reader position of the result is written after the commit; the harness is closed only once it is.
    await waitUntil(
      async () =>
        (await harness.service.nodeHistoryStore!.readReaderPosition(
          history.studyId,
        )) === 5,
      'the result’s reader position is written',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(controller.state().mode, 'paused')
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 5)
    assert.equal(lastView(harness)?.errors.length, 0)
    assert.equal(harness.applicationOutputs().length, outputsBefore)
  } finally {
    await harness.close()
  }
})

// Value: protects=Inspect on the stop that is already selected, after its native session ended, shows the stop again and keeps the step the learner chose, because the moment does not change (DS21); fails_when=Inspect resets the chosen step to the stop's first; why_new=F147: Inspect on the selected stop had no test; seam=the workspace harness's ended historical debug session; no_claim=the debugger's own display of the stop
test('Inspect on the selected stop keeps the step the learner chose', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openWithChosenStep(harness)
    const before = shownMoment(harness)

    // Act: the native session ended meanwhile, so Inspect shows the same stop again.
    harness.endHistoricalDebugSession()
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.debuggerAvailable === false,
      'the ended session is told',
      READER_RESULT_BOUND_MS,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.debuggerAvailable === true,
      'the stop is shown in the native debugger again',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(shownMoment(harness), before)
    assert.equal(shownMoment(harness).stepId, 'keep')
  } finally {
    await harness.close()
  }
})

// Value: protects=a move to an event the replay lacks, a seek outside its range and an Inspect on an event that is no debugger stop are each refused by name and change nothing: the moment, the step the learner chose and the Application pane stay; fails_when=a refused request moves the selection or the chosen step, posts into the Application pane, or says nothing; why_new=F125: Select event, seek and Inspect had no refused cell; seam=none; no_claim=the move buttons' disabled state (the Reader DOM check)
test('a Select event, a seek and an Inspect that the replay refuses change nothing and say why', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openWithChosenStep(harness)
    const before = shownMoment(harness)
    const outputsBefore = harness.applicationOutputs().length
    const refusals: (string | undefined)[] = []
    const refuse = async (
      message: Parameters<Harness['receiveContext']>[0],
      expectedError: RegExp,
    ): Promise<void> => {
      harness.receiveContext(message)
      await waitUntil(
        () => expectedError.test(lastView(harness)?.errors.at(-1) ?? ''),
        'the refusal is told',
        READER_RESULT_BOUND_MS,
      )
      refusals.push(lastView(harness)!.errors.at(-1))
    }

    // Act
    await refuse(
      {
        type: 'node-history-event',
        revision: lastView(harness)!.revision,
        studyId: history.studyId,
        sequence: 99,
      },
      /unavailable/,
    )
    await refuse(
      {
        type: 'node-history-playback',
        revision: lastView(harness)!.revision,
        studyId: history.studyId,
        action: 'seek',
        positionMs: 9_999,
      },
      /outside the verified/,
    )
    await refuse(
      {
        type: 'node-history-stop',
        revision: lastView(harness)!.revision,
        studyId: history.studyId,
        sequence: 3,
      },
      /not a debugger stop/,
    )

    // Assert
    assert.equal(refusals.length, 3)
    assert.deepEqual(shownMoment(harness), before)
    assert.equal(harness.applicationOutputs().length, outputsBefore)
  } finally {
    await harness.close()
  }
})
