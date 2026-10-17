/** One step of {@link REPLAY_MODEL_SELECTION_SCENARIO}: a presentation of one of two recorded stops (two snapshot objects) under a label, or an invalidation that empties the native session. */
export type ReplayModelSelectionStep =
  | { action: 'present'; stop: 'first' | 'second'; label: string }
  | { action: 'invalidate' }

/**
 * The scenario of F6's rule of the native model selection, with the model selections (`workbench.action.debug.focusProcess`) counted after each step: a presentation selects the model once per selection, a selection being the snapshot object, the label and the source; the same selection presented again selects nothing, and an invalidation drops the selection. Both the real {@link ReplayDebugger} (replayDebugger.test) and the workspace harness's fake (studyWorkspaceReplay.test) are driven through it, so a change of either rule fails the table (TR8, Cycle 0046).
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
]

/** What a test drives the scenario through: one owner of the historical debugger, the real one or the harness's fake. */
export type ReplayModelSelectionDriver = {
  /** Presents a stop under a label and waits until the presentation ended. */
  present(stop: 'first' | 'second', label: string): Promise<void>
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
    if (step.action === 'present') await driver.present(step.stop, step.label)
    else driver.invalidate()
    counted.push(driver.selections())
  }
  return counted
}
