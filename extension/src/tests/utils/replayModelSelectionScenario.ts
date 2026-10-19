/**
 * What surrounds a presentation of {@link REPLAY_MODEL_SELECTION_SCENARIO} besides the stop and the label (Cycle 0046 AD26):
 * - `host refuses`: the host rejects the presentation's `workbench.action.debug.focusProcess`; the frame is still shown, and the selection stays unsettled (AD25).
 * - `abandoned while the host answers`: the presentation is abandoned while the host still answers its selection; the answer settles the stop's selection all the same (AD25).
 * - `live session owns the view`: a debug session of the learner's own is active beside the replay, so no model is selected for the stop and the selection stays unsettled.
 */
export type ReplayModelSelectionCircumstance =
  | 'host refuses'
  | 'abandoned while the host answers'
  | 'live session owns the view'

/** A frame of {@link REPLAY_MODEL_SELECTION_SCENARIO}: one of its two recorded stops (two snapshot objects) under a label. */
export type ReplayModelSelectionFrame = {
  stop: 'first' | 'second'
  label: string
}

/**
 * One step of {@link REPLAY_MODEL_SELECTION_SCENARIO}:
 * - `present`: a presentation of a frame, maybe in one of the {@link ReplayModelSelectionCircumstance}s;
 * - `present while the host answers`: a presentation of `first`, whose model selection the host holds, and of `next` while the host still holds it (Cycle 0046 Q10). A `next` of the same stop and label waits for that answer; a `next` of another selection runs its own, which the host answers before it answers `first`;
 * - `present again while a newer answer is held`: a presentation of `older`, whose model selection the host holds, then of `newer`, whose selection the host holds too; the host answers `older`, and `newer` is presented again while its own answer is still held, and then answered (Cycle 0046 TT5);
 * - `invalidate`: an invalidation that empties the native session.
 */
export type ReplayModelSelectionStep =
  | ({
      action: 'present'
      circumstance?: ReplayModelSelectionCircumstance
    } & ReplayModelSelectionFrame)
  | {
      action: 'present while the host answers'
      first: ReplayModelSelectionFrame
      next: ReplayModelSelectionFrame
    }
  | {
      action: 'present again while a newer answer is held'
      older: ReplayModelSelectionFrame
      newer: ReplayModelSelectionFrame
    }
  | { action: 'invalidate' }

/**
 * The scenario of F6's rule of the native model selection, with the model selections (`workbench.action.debug.focusProcess`) counted after each step: a presentation selects the model once per selection, a selection being the snapshot object, the label and the source; the same selection presented again selects nothing, and an invalidation drops the selection. A selection the host refused, or one not made while a live debug session owns the view, is made at the stop's next frame; one whose presentation was abandoned while the host answered is made all the same (AD25, AD26). A frame of the same stop shown while the host still answers waits for that answer and asks no second time, and a late answer for a stop no longer shown settles nothing and leaves the shown stop's answer in flight (Q1, Q10, TT5). Both the real {@link ReplayDebugger} (replayDebugger.test) and the workspace harness's fake (studyWorkspaceReplay.test) are driven through it, so a change of either rule fails the table (TR8, Cycle 0046).
 */
export const REPLAY_MODEL_SELECTION_SCENARIO: ReadonlyArray<{
  step: ReplayModelSelectionStep
  selectionsAfter: number
}> = [
  {
    step: {
      action: 'present',
      stop: 'first',
      label: 'Recorded pause · 1.00 s',
    },
    selectionsAfter: 1,
  },
  // The same snapshot and label again: the same selection.
  {
    step: {
      action: 'present',
      stop: 'first',
      label: 'Recorded pause · 1.00 s',
    },
    selectionsAfter: 1,
  },
  // Another label of the same snapshot: a new selection.
  {
    step: {
      action: 'present',
      stop: 'first',
      label: 'Recorded pause · 2.50 s',
    },
    selectionsAfter: 2,
  },
  // Another snapshot under the same label: a new selection.
  {
    step: {
      action: 'present',
      stop: 'second',
      label: 'Recorded pause · 2.50 s',
    },
    selectionsAfter: 3,
  },
  { step: { action: 'invalidate' }, selectionsAfter: 3 },
  // The same snapshot and label after the invalidation: a new selection.
  {
    step: {
      action: 'present',
      stop: 'second',
      label: 'Recorded pause · 2.50 s',
    },
    selectionsAfter: 4,
  },
  // A new selection the host refuses: the command ran, and the selection stays unsettled.
  {
    step: {
      action: 'present',
      stop: 'first',
      label: 'Recorded pause · 4.00 s',
      circumstance: 'host refuses',
    },
    selectionsAfter: 5,
  },
  // Its next frame selects the model, and the frame after that nothing.
  {
    step: {
      action: 'present',
      stop: 'first',
      label: 'Recorded pause · 4.00 s',
    },
    selectionsAfter: 6,
  },
  {
    step: {
      action: 'present',
      stop: 'first',
      label: 'Recorded pause · 4.00 s',
    },
    selectionsAfter: 6,
  },
  // A new selection whose presentation is abandoned while the host answers: the answer settles it.
  {
    step: {
      action: 'present',
      stop: 'second',
      label: 'Recorded pause · 5.00 s',
      circumstance: 'abandoned while the host answers',
    },
    selectionsAfter: 7,
  },
  {
    step: {
      action: 'present',
      stop: 'second',
      label: 'Recorded pause · 5.00 s',
    },
    selectionsAfter: 7,
  },
  // A new selection while a live debug session owns the view: none is made.
  {
    step: {
      action: 'present',
      stop: 'first',
      label: 'Recorded pause · 6.00 s',
      circumstance: 'live session owns the view',
    },
    selectionsAfter: 7,
  },
  // Its next frame, once that session ended, selects the model.
  {
    step: {
      action: 'present',
      stop: 'first',
      label: 'Recorded pause · 6.00 s',
    },
    selectionsAfter: 8,
  },
  // A new selection whose next frame comes while the host still answers: that frame waits for the answer and asks no second time.
  {
    step: {
      action: 'present while the host answers',
      first: { stop: 'second', label: 'Recorded pause · 7.00 s' },
      next: { stop: 'second', label: 'Recorded pause · 7.00 s' },
    },
    selectionsAfter: 9,
  },
  // A new selection followed by another stop while the host still answers: that stop runs its own selection, and the late answer for the first one does not displace it.
  {
    step: {
      action: 'present while the host answers',
      first: { stop: 'first', label: 'Recorded pause · 8.00 s' },
      next: { stop: 'second', label: 'Recorded pause · 8.00 s' },
    },
    selectionsAfter: 11,
  },
  {
    step: {
      action: 'present',
      stop: 'second',
      label: 'Recorded pause · 8.00 s',
    },
    selectionsAfter: 11,
  },
  // Two new selections, both held: the answer for the first, a stop no longer shown, leaves the second one's answer in flight, so the second stop's next frame waits for it and asks no third time.
  {
    step: {
      action: 'present again while a newer answer is held',
      older: { stop: 'first', label: 'Recorded pause · 9.00 s' },
      newer: { stop: 'second', label: 'Recorded pause · 9.00 s' },
    },
    selectionsAfter: 13,
  },
]

/** What a test drives the scenario through: one owner of the historical debugger, the real one or the harness's fake. */
export type ReplayModelSelectionDriver = {
  /** Presents a stop under a label, in the given circumstance if any, and waits until the presentation ended; a live session that owned the view ends with it. */
  present(
    stop: 'first' | 'second',
    label: string,
    circumstance?: ReplayModelSelectionCircumstance,
  ): Promise<void>
  /**
   * Presents `first` while the host holds its model selection, waits until the host holds it (a promise the host's stand-in resolves), then presents `next`, and waits until both presentations ended.
   * When `nextIsAnotherSelection`, the host holds `next`'s own selection too and answers it first, once it holds it, so the answer for `first` comes while `next` is the shown stop; otherwise it answers `first` once `next` waits for that answer.
   */
  presentWhileHostAnswers(
    first: ReplayModelSelectionFrame,
    next: ReplayModelSelectionFrame,
    nextIsAnotherSelection: boolean,
  ): Promise<void>
  /** Presents `older` and then `newer`, each once the host holds the selection before it (a promise the host's stand-in resolves); answers `older` and waits until its presentation ended; presents `newer` again, answers `newer` once that frame waits for the answer in flight, and waits until every presentation ended. */
  presentAgainWhileNewerAnswerHeld(
    older: ReplayModelSelectionFrame,
    newer: ReplayModelSelectionFrame,
  ): Promise<void>
  /** Empties the native session, as the reader's playback does for a hidden or covered moment. */
  invalidate(): void
  /** How many model selections ran since the scenario began. */
  selections(): number
}

/**
 * Drives one owner of the historical debugger through {@link REPLAY_MODEL_SELECTION_SCENARIO} and counts the model selections after each step; called by the scenario's tests of the real owner and of the workspace harness's fake.
 * @param driver - The owner under test.
 * @returns The selections counted after each step, in the scenario's order, to compare with its `selectionsAfter`.
 * @example
 * assert.deepEqual(await selectionsThroughScenario(driver), REPLAY_MODEL_SELECTION_SCENARIO.map((row) => row.selectionsAfter))
 */
export async function selectionsThroughScenario(
  driver: ReplayModelSelectionDriver,
): Promise<number[]> {
  const counted: number[] = []
  for (const { step } of REPLAY_MODEL_SELECTION_SCENARIO) {
    // A presentation waits for its end; an invalidation takes effect at once.
    if (step.action === 'present')
      await driver.present(step.stop, step.label, step.circumstance)
    else if (step.action === 'present while the host answers')
      await driver.presentWhileHostAnswers(
        step.first,
        step.next,
        step.first.stop !== step.next.stop ||
          step.first.label !== step.next.label,
      )
    else if (step.action === 'present again while a newer answer is held')
      await driver.presentAgainWhileNewerAnswerHeld(step.older, step.newer)
    else driver.invalidate()
    counted.push(driver.selections())
  }
  return counted
}
