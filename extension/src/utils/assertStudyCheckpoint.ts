import type { RetainedStudy } from '../retainedStudySchemas'

/** Preserves accepted identity/evidence when {@link LearningLibrary} advances a checkpoint under its writer lock. @example assertStudyCheckpoint(previous, next) // throws if captured facts changed */
export function assertStudyCheckpoint(
  prior: RetainedStudy,
  study: RetainedStudy,
): void {
  if (prior.profile !== study.profile || prior.createdAt !== study.createdAt)
    throw new Error('Study profile or creation identity changed.')
  if (prior.savedAt > study.savedAt || (prior.terminal && !study.terminal))
    throw new Error('An older checkpoint cannot replace later study history.')
  // Configured intent, copied sources and admitted operation become immutable once acquired.
  {
    if (
      study.version !== prior.version ||
      prior.configurationHash !== study.configurationHash ||
      JSON.stringify(prior.configuration) !==
        JSON.stringify(study.configuration)
    )
      throw new Error('Configured study intent changed after acceptance.')
    if (
      prior.descriptor &&
      JSON.stringify(prior.descriptor) !== JSON.stringify(study.descriptor)
    )
      throw new Error('Configured article/source descriptor changed.')
    const previous = prior.operation,
      next = study.operation
    const oldPause = previous?.continuedPause,
      newPause = next?.continuedPause
    // A later confirmed stop can advance the receipt, while every earlier captured stop stays immutable below.
    const oldIndex = oldPause
      ? prior.observations.findIndex(
          (observation) =>
            JSON.stringify(observation.pause) === JSON.stringify(oldPause),
        )
      : -1
    const newIndex = newPause
      ? study.observations.findIndex(
          (observation) =>
            JSON.stringify(observation.pause) === JSON.stringify(newPause),
        )
      : -1
    const continuationPreserved =
      !oldPause ||
      Boolean(
        newPause &&
        oldIndex >= 0 &&
        newIndex >= oldIndex &&
        (!prior.terminal ||
          JSON.stringify(newPause) === JSON.stringify(oldPause)),
      )
    if (
      previous &&
      (!next ||
        previous.id !== next.id ||
        previous.key !== next.key ||
        (previous.inputDispatched && !next.inputDispatched) ||
        (previous.inputAcknowledged && !next.inputAcknowledged) ||
        (previous.afterVerified && !next.afterVerified) ||
        !continuationPreserved)
    )
      throw new Error(
        'Configured operation identity or confirmed receipts changed.',
      )
  }
  // A later checkpoint may append interpretations/status, never rewrite captured facts or erase a stop.
  for (const [index, previous] of prior.observations.entries()) {
    const next = study.observations[index]
    if (
      !next ||
      JSON.stringify({ ...previous, interpretations: [] }) !==
        JSON.stringify({ ...next, interpretations: [] }) ||
      previous.interpretations.some(
        (value) =>
          !next.interpretations.some(
            (candidate) => JSON.stringify(candidate) === JSON.stringify(value),
          ),
      )
    )
      throw new Error('Captured observation or interpretation history changed.')
  }
  for (const previous of prior.captures) {
    if (
      (previous.status === 'captured' || previous.status === 'failed') &&
      !study.captures.some(
        (value) => JSON.stringify(value) === JSON.stringify(previous),
      )
    )
      throw new Error('Confirmed or failed image history changed.')
  }
}
