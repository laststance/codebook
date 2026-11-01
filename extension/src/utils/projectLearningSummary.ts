import type { ConfiguredStudy } from '../configuredStudySchemas'
import type { RecordingContext } from '../recordingSchemas'

/** Supplies checked stop and result-frame navigation when replay builds the saved learning reader. @param study - Retained learning and stops. @param phases - Verified recording phase times. @returns Saved learning with navigable positions and the steps linked to an operation mark, or undefined when absent. @example projectLearningSummary(study, context.phases)?.positions.find(position => position.stepId === 'result') */
export function projectLearningSummary(
  study:
    | Pick<ConfiguredStudy, 'learningSummary' | 'observations' | 'operations'>
    | undefined,
  phases?: RecordingContext['phases'],
) {
  const summary = study?.learningSummary
  if (!summary || !study) return
  const positions: { stepId: string; elapsedMs: number }[] = []
  // A step that names an operation of this run links to that operation's mark; a number with no operation leaves the step unlinked.
  const operationLinks = summary.content.steps.flatMap((step) =>
    step.operationIndex !== undefined &&
    study.operations?.some((record) => record.index === step.operationIndex)
      ? [{ stepId: step.id, operationIndex: step.operationIndex }]
      : [],
  )
  for (const step of summary.content.steps) {
    const reference = step.reference
    if (!reference) continue
    if ('snapshotUri' in reference) {
      const observation = study.observations.find(
        (value) =>
          value.snapshotUri === reference.snapshotUri &&
          value.source.hash === reference.sourceHash,
      )
      if (observation)
        positions.push({ stepId: step.id, elapsedMs: observation.elapsedMs })
      continue
    }
    const resultFrame = phases?.find(
      (phase) =>
        phase.phase === 'after' &&
        phase.hash === reference.captureHash &&
        phase.rendererConfirmedMs !== undefined,
    )
    // The renderer ACK follows the phase video frame; seeking to its earlier pixels receipt can show the preceding stream frame.
    if (resultFrame?.rendererConfirmedMs !== undefined)
      positions.push({
        stepId: step.id,
        elapsedMs: resultFrame.rendererConfirmedMs,
      })
  }
  return { ...summary, positions, operationLinks }
}
