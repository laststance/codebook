import assert from 'node:assert/strict'
import { type TestContext, test } from 'node:test'

import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
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

// Value: protects=a Play step that is presenting when a newer seek arrives commits nothing: while the newer seek loads, the Study position names the newer seek's stop and never the played event; the newer seek's moment shows when it ends; fails_when=the overtaken Play step commits its event before the newer seek has shown anything; why_new=F139 (the coordinator's review of PR-2 B): the same defect as the seek's, through Play; seam=the workspace harness's held historical debug presentation and the playback clock, moved by hand; no_claim=Play's pacing
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
    // The Study position names the newer seek's stop while it loads (D29, F203); the overtaken Play step's event never shows.
    assert.deepEqual(whileNewerLoads, {
      sequence: 2,
      stepId: undefined,
      explanation: undefined,
      position: 'Stop 1 of 2 · 0.20 s',
    })
    assert.equal(before.position, 'Output · 0.25 s')
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
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 5 &&
        !lastView(harness)?.nodeHistoryPosition?.pending,
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

// Value: protects=a move to an event the replay lacks, a seek outside its range and an Inspect on an event that is no debugger stop are each refused by name and change nothing: the moment, the step the learner chose and the Application pane stay; fails_when=a refused request moves the selection or the chosen step, posts into the Application pane, says nothing, or names a "Node history"; why_new=F125: Select event, seek and Inspect had no refused cell; why_changed=F336 (PR-2 /ship Step 9 pass 3 maintainability): each refusal is in test replay words, never "Node" (DS14, as F117); seam=none; no_claim=the move buttons' disabled state (the Reader DOM check)
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
    assert.equal(
      refusals.some((refusal) => /\bNode\b/.test(refusal ?? '')),
      false,
    )
    assert.deepEqual(shownMoment(harness), before)
    assert.equal(harness.applicationOutputs().length, outputsBefore)
  } finally {
    await harness.close()
  }
})

/**
 * Makes the second stop (sequence 4) of the replays the workspace's store reads unverified: its captured text no longer hashes to its sealed hash, as after an edit of the captured file; the first stop stays verified.
 * @param context - The test's context, which restores the store's read.
 * @param harness - The workspace harness.
 * @example unverifySecondStop(context, harness)
 */
function unverifySecondStop(context: TestContext, harness: Harness): void {
  const store = harness.service.nodeHistoryStore!
  const read = NodeTestHistoryStore.prototype.read
  context.mock.method(
    store,
    'read',
    async function (this: NodeTestHistoryStore, studyId: string) {
      const index = await read.call(this, studyId)
      return {
        ...index,
        entries: index.entries.map((entry) =>
          entry.type === 'stop' && entry.sequence === 4
            ? {
                ...entry,
                debuggerSnapshot: {
                  ...entry.debuggerSnapshot,
                  frames: entry.debuggerSnapshot.frames.map((frame) => ({
                    ...frame,
                    source: frame.source && {
                      ...frame.source,
                      text: 'const nextTheme = "light";\n',
                    },
                  })),
                },
              }
            : entry,
        ),
      }
    },
  )
}

// Value: protects=Next stop onto a stop whose captured source does not verify shows that moment truthfully: it commits with its source unavailable, presents no recorded values in the debugger and tells no error; fails_when=the move is refused or stays on the first stop, or the debugger presents another moment's values at the unverified stop; why_new=F321 (PR-2 /ship Step 9 pass 2 state-machines): unverified stop × step move had no cell; seam=the store's read, whose second stop's captured text was edited; no_claim=the placeholder slot's text (the source slot tests); why_changed=a move leaves the earlier moment for 300 ms before it commits (F385, F387), so the wait also requires the position not to be pending
test('Next stop onto a stop whose source does not verify shows it without recorded values and tells no error', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    unverifySecondStop(context, harness)
    const history = await openWithChosenStep(harness)
    const presentationsBefore = harness.historicalDebugPresentations.length

    // Act
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        !lastView(harness)?.nodeHistoryPosition?.pending &&
        !lastView(harness)?.loading,
      'Next stop lands on the unverified stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sourceAvailable, false)
    assert.equal(
      harness.historicalDebugPresentations
        .slice(presentationsBefore)
        .some((presentation) => presentation.snapshot !== undefined),
      false,
    )
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a seek onto a stop whose captured source does not verify shows that moment truthfully: it commits with its source unavailable and presents no recorded values; fails_when=the seek is refused, lands elsewhere, or the debugger presents recorded values at the unverified stop; why_new=F321 (PR-2 /ship Step 9 pass 2 state-machines): unverified stop × seek had no cell; seam=the store's read, whose second stop's captured text was edited; no_claim=the playhead's drawing (the Reader DOM check); why_changed=a move leaves the earlier moment for 300 ms before it commits (F385, F387), so the wait also requires the position not to be pending
test('a seek onto a stop whose source does not verify shows it without recorded values and tells no error', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    unverifySecondStop(context, harness)
    const history = await openWithChosenStep(harness)
    const presentationsBefore = harness.historicalDebugPresentations.length

    // Act: the second stop was recorded at 300 ms.
    harness.receiveContext({
      type: 'node-history-playback',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      action: 'seek',
      positionMs: 300,
    })
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        !lastView(harness)?.nodeHistoryPosition?.pending &&
        !lastView(harness)?.loading,
      'the seek lands on the unverified stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sourceAvailable, false)
    assert.equal(
      harness.historicalDebugPresentations
        .slice(presentationsBefore)
        .some((presentation) => presentation.snapshot !== undefined),
      false,
    )
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=Play across a stop whose captured source does not verify shows that moment without recorded values and keeps playing; fails_when=Play pauses or reports an error at the unverified stop, or the debugger presents recorded values there; why_new=F321 (PR-2 /ship Step 9 pass 2 state-machines): unverified stop × Play step had no cell; seam=the store's read, whose second stop's captured text was edited, and the playback clock, moved by hand; no_claim=Play's pacing
test('Play across a stop whose source does not verify shows it without recorded values and keeps playing', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    unverifySecondStop(context, harness)
    const history = await openWithChosenStep(harness)
    await standAt(harness, history, 3)
    const presentationsBefore = harness.historicalDebugPresentations.length
    const advance = playbackClock(harness)
    const controller = advance(0)

    // Act: Play from the output at 250 ms reaches the second stop at 300 ms.
    controller.play()
    advance(60)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        !lastView(harness)?.nodeHistoryPosition?.pending,
      'Play reaches the unverified stop',
      READER_RESULT_BOUND_MS,
    )
    const modeAtTheStop = controller.state().mode
    controller.pause()

    // Assert
    assert.equal(modeAtTheStop, 'playing')
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sourceAvailable, false)
    assert.equal(
      harness.historicalDebugPresentations
        .slice(presentationsBefore)
        .some((presentation) => presentation.snapshot !== undefined),
      false,
    )
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=Inspect in native debugger on the result is refused by name and changes nothing: the moment and the step the learner chose stay; fails_when=the result is selected, the chosen step is lost, or the refusal says nothing; why_new=F321 (PR-2 /ship Step 9 pass 2 state-machines): result × Inspect had no cell (only an output was refused); seam=none; no_claim=the Inspect control's visibility at the result (the Reader DOM check)
test('Inspect on the result is refused as no debugger stop and changes nothing', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openWithChosenStep(harness)
    const before = shownMoment(harness)

    // Act
    harness.receiveContext({
      type: 'node-history-stop',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 5,
    })
    await waitUntil(
      () => /not a debugger stop/.test(lastView(harness)?.errors.at(-1) ?? ''),
      'the refusal is told',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(shownMoment(harness), before)
  } finally {
    await harness.close()
  }
})

// Value: protects=after the learner stopped the replay debugger, an explicit Next stop is the learner's choice to see the next stop's values: it starts the debugger again there and commits the stop; fails_when=Next stop is refused like a seek, or commits the stop without recorded values; why_new=F321 (PR-2 /ship Step 9 pass 2 state-machines): a stopped debugger × step move had no cell (only a seek's refusal was tested); seam=the harness's fake historical debugger, marked stopped; no_claim=the native Run and Debug view; why_changed=a move leaves the earlier moment for 300 ms before it commits (F385, F387), so the wait also requires the position not to be pending
test('Next stop after the learner stopped the replay debugger starts it again at the next stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openWithChosenStep(harness)
    harness.historicalDebuggers.at(-1)!.available = false
    const debuggersBefore = harness.historicalDebuggers.length
    const presentationsBefore = harness.historicalDebugPresentations.length

    // Act
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        !lastView(harness)?.nodeHistoryPosition?.pending &&
        !lastView(harness)?.loading,
      'Next stop lands on the second stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(harness.historicalDebuggers.length, debuggersBefore + 1)
    assert.equal(
      harness.historicalDebugPresentations
        .slice(presentationsBefore)
        .some((presentation) => presentation.snapshot !== undefined),
      true,
    )
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=Play never restarts a replay debugger the learner stopped: at the next stop it pauses, says why and changes nothing; fails_when=Play starts a new debugger, commits the stop, or keeps playing past it silently; why_new=F321 (PR-2 /ship Step 9 pass 2 state-machines): a stopped debugger × Play step had no cell (only a seek's refusal was tested); seam=the harness's fake historical debugger, marked stopped, and the playback clock, moved by hand; no_claim=Play's pacing
test('Play after the learner stopped the replay debugger pauses at the next stop and says why', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openWithChosenStep(harness)
    await standAt(harness, history, 3)
    harness.historicalDebuggers.at(-1)!.available = false
    const debuggersBefore = harness.historicalDebuggers.length
    const before = shownMoment(harness)
    const advance = playbackClock(harness)
    const controller = advance(0)

    // Act: Play from the output at 250 ms reaches the second stop at 300 ms.
    controller.play()
    advance(60)
    await waitUntil(
      () =>
        /replay debugger was stopped/.test(
          lastView(harness)?.errors.at(-1) ?? '',
        ),
      'Play tells why it stopped',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(controller.state().mode, 'paused')
    assert.deepEqual(shownMoment(harness), before)
    assert.equal(harness.historicalDebuggers.length, debuggersBefore)
  } finally {
    await harness.close()
  }
})

// Value: protects=Play and its commits never wait for the reader position write (D39, F197): while the write of the first step's position never returns, Play goes on to the next event, the Study position and the Application header show each new moment, and the writes of the moments played meanwhile are coalesced into one that follows when the first returns, carrying the latest moment; fails_when=Play's step awaits the write before its commit is published, so a slow disk keeps the Study and Application panes on the earlier moment beside the new slot and debugger, or the write that never returns stops Play; why_new=F197 (Step 11 Codex adversarial: Play and seeks awaited the position write before the controller's publish); seam=the history store's position write, held by the test, and the playback clock, moved by hand; no_claim=the write's outcome, which the position tests cover
test('a reader position write that never returns holds neither Play nor the moment it shows', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  let releaseWrite = (): void => {}
  const heldWrites: Promise<unknown>[] = []
  try {
    const store = harness.service.nodeHistoryStore!
    await openWithChosenStep(harness)
    const advance = playbackClock(harness)
    const controller = advance(0)
    const writeHeld = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const save = store.saveReaderPosition.bind(store)
    const writtenSequences: number[] = []
    context.mock.method(
      store,
      'saveReaderPosition',
      (...args: Parameters<NodeTestHistoryStore['saveReaderPosition']>) => {
        writtenSequences.push(args[1])
        const write = writeHeld.then(() => save(...args))
        heldWrites.push(write)
        return write
      },
    )
    controller.play()

    // Act: Play steps from the first stop to the output and on to the second stop while the first write is held.
    void advance(1_000).tick()
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 3 &&
        !lastView(harness)?.nodeHistoryPosition?.pending,
      'Play shows the output while the first write is held',
      READER_RESULT_BOUND_MS,
    )
    void advance(1_000).tick()
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        !lastView(harness)?.nodeHistoryPosition?.pending,
      'Play shows the second stop while the first write is held',
      READER_RESULT_BOUND_MS,
    )
    const whileHeld = {
      position: lastView(harness)?.nodeHistorySection?.position,
      time: harness.applicationOutputs().at(-1)?.view.time,
      writes: [...writtenSequences],
      mode: controller.state().mode,
    }
    releaseWrite()
    await waitUntil(
      () => writtenSequences.length === 2,
      'the moments played meanwhile are written once',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(whileHeld, {
      position: 'Stop 2 of 2 · 0.30 s',
      time: 'Recorded test output · 0.30 s',
      writes: [3],
      mode: 'playing',
    })
    assert.deepEqual(writtenSequences, [3, 4])
  } finally {
    releaseWrite()
    await Promise.allSettled(heldWrites)
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=closing the reader waits for the reader position write a selection started, so the moment the learner left is the one saved and no write runs into storage that is being removed; fails_when=close() returns while the write is held, or the held position is never written; why_new=F197 moved the write out of the selection, so the close has to wait for it (bounded by NODE_HISTORY_POSITION_DRAIN_MS); seam=the history store's position write, held by the test; no_claim=the bound itself, which a stuck disk would hit
test('closing the reader waits for the reader position write of the last selection', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  let releaseWrite = (): void => {}
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await openWithChosenStep(harness)
    const writeHeld = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const save = store.saveReaderPosition.bind(store)
    context.mock.method(
      store,
      'saveReaderPosition',
      async (
        ...args: Parameters<NodeTestHistoryStore['saveReaderPosition']>
      ) => {
        await writeHeld
        return save(...args)
      },
    )
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 3,
    })
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 3 &&
        !lastView(harness)?.nodeHistoryPosition?.pending,
      'the output commits while its position write is held',
      READER_RESULT_BOUND_MS,
    )

    // Act
    let closed = false
    const closing = harness.reader.close().then(() => {
      closed = true
    })
    for (let turn = 0; turn < 20; turn++)
      await new Promise((resolve) => setImmediate(resolve))
    const closedWhileHeld = closed
    releaseWrite()
    await closing

    // Assert
    assert.equal(closedWhileHeld, false)
    assert.equal(await store.readReaderPosition(history.studyId), 3)
  } finally {
    releaseWrite()
    context.mock.restoreAll()
    await harness.close()
  }
})
