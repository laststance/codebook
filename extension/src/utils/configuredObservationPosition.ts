import type { ConfiguredStudy } from '../configuredStudySchemas'

import { configuredStops } from './configuredStops'

/** Resolves the selected historical stop for {@link StudyWorkspace}; file links must follow its declared source rather than the first stop. @example configuredObservationPosition(study, study.observations[1]?.id).path */
export function configuredObservationPosition(
  study: ConfiguredStudy,
  snapshotId?: string,
) {
  const index =
    snapshotId === undefined
      ? 0
      : study.observations.findIndex(
          (observation) => observation.id === snapshotId,
        )
  const stop = configuredStops(study.configuration)[index]
  if (!stop)
    throw new Error('Selected observation has no declared source position')
  return stop.source
}
