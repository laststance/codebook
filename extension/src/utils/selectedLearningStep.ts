/**
 * Picks the step a browser replay's selected-step block describes; called by the Study pane's page at every Study message, and self-contained because the page receives it as source text.
 * A step is selectable only with a recorded position. The learner's chosen step counts while the presented position is less than `toleranceMs` from the position it was activated at; otherwise the first selectable step, in material order, that matches the presented observation is selected, and otherwise none.
 * @param input.steps - The material's steps, in order, each with its id and, when it cites an observation, that observation's snapshot URI.
 * @param input.positions - The recorded positions of the steps that have one.
 * @param input.presentedSnapshotUri - The presented observation's snapshot URI, if any.
 * @param input.presentedMs - The presented position, if any.
 * @param input.chosen - The step the learner last activated in the sequence and its position, if any.
 * @param input.toleranceMs - How close the presented position must be to the chosen one for the chosen step to count.
 * @returns The selected step's id, or `undefined` when none is selected.
 * @example selectedLearningStep({ steps, positions, presentedSnapshotUri: 'a', presentedMs: 100, chosen: undefined, toleranceMs: 1 }) // => 'first-match'
 */
export function selectedLearningStep(input: {
  steps: readonly { id: string; snapshotUri?: string }[]
  positions: readonly { stepId: string; elapsedMs: number }[]
  presentedSnapshotUri: string | undefined
  presentedMs: number | undefined
  chosen: { stepId: string; positionMs: number } | undefined
  toleranceMs: number
}): string | undefined {
  const selectable = input.steps.filter((step) =>
    input.positions.some((position) => position.stepId === step.id),
  )
  const chosen = input.chosen
  // The chosen step counts only while its own position is presented.
  if (
    chosen &&
    input.presentedMs !== undefined &&
    Math.abs(input.presentedMs - chosen.positionMs) < input.toleranceMs &&
    selectable.some((step) => step.id === chosen.stepId)
  )
    return chosen.stepId
  if (input.presentedSnapshotUri === undefined) return undefined
  return selectable.find(
    (step) => step.snapshotUri === input.presentedSnapshotUri,
  )?.id
}
