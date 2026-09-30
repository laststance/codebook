import type { RetainedStudy } from '../retainedStudySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

/** Pins captured facts while permitting later append-only interpretation, for publication and public link revalidation. @example bookObservationHash(study.observations[0]) */
export function bookObservationHash(
  observation: RetainedStudy['observations'][number],
): string {
  return sha256(JSON.stringify({ ...observation, interpretations: [] }))
}
