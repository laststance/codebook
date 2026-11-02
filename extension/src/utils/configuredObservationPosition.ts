import type { ConfiguredStudy } from '../configuredStudySchemas'

import { configuredStops } from './configuredStops'

/** Resolves the selected historical stop for {@link StudyWorkspace}; file links must follow its declared source rather than the first stop. @example configuredObservationPosition(study, study.observations[1]?.id).path */
export function configuredObservationPosition(
  study: ConfiguredStudy,
  snapshotId?: string,
) {
  const position =
    snapshotId === undefined
      ? 0
      : study.observations.findIndex(
          (observation) => observation.id === snapshotId,
        )
  // A format 8 observation names its declared stop; earlier ones follow the declared order by position.
  const index = study.observations[position]?.declaredIndex ?? position
  const stop = configuredStops(study.configuration)[index]
  if (!stop)
    throw new Error('Selected observation has no declared source position')
  return stop.source
}
