import type { NodeLearningSummaryProjection } from './projectNodeLearningSummary'

/**
 * Words each learning step's action by the event it leads to, for the steps whose event the replay holds; shared by the server and Extension replays' Study sections.
 * The labels are own data properties, so a step id such as `__proto__` keeps its label through the message to the Study pane.
 * @param learning - The projected material, if any.
 * @param labelOf - Words the action of the event at a sequence; `undefined` for a sequence the replay lacks.
 * @returns The action labels by step id.
 * @example labelLearningStepActions(learning, (sequence) => (sequence === 2 ? 'Inspect Stop 1 · 0.42 s' : undefined)) // => { read: 'Inspect Stop 1 · 0.42 s' }
 */
export function labelLearningStepActions(
  learning: NodeLearningSummaryProjection | undefined,
  labelOf: (sequence: number) => string | undefined,
): Record<string, string> {
  return Object.fromEntries(
    (learning?.positions ?? []).flatMap((position) => {
      const label = labelOf(position.sequence)
      return label === undefined ? [] : [[position.stepId, label] as const]
    }),
  )
}
