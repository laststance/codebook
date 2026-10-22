/**
 * Decides which learning step a test replay shows once an event selection commits (DS21): the step a summary step's action chose, the event's first step for Next and Previous, and, for a selection that made no choice (a seek, Play, Inspect), the learner's chosen step only while the selection stays on its moment. Called by the Study workspace when it commits a test replay's selected event.
 * @param choice - The selection's own step choice, absent when it made none; `stepId` is `undefined` for the event's first step.
 * @param current - The event selected before and the step chosen on it.
 * @param sequence - The event the selection commits.
 * @returns The chosen step's id, or `undefined` for the event's first step.
 * @example
 * nextNodeHistoryStepId({ stepId: 'keep' }, { sequence: 4 }, 2) // => 'keep'
 * nextNodeHistoryStepId(undefined, { sequence: 2, stepId: 'keep' }, 2) // => 'keep'
 * nextNodeHistoryStepId(undefined, { sequence: 2, stepId: 'keep' }, 4) // => undefined
 */
export function nextNodeHistoryStepId(
  choice: { stepId: string | undefined } | undefined,
  current: { sequence: number | undefined; stepId: string | undefined },
  sequence: number,
): string | undefined {
  if (choice) return choice.stepId
  // A chosen step stays only with its own moment.
  return sequence === current.sequence ? current.stepId : undefined
}
