import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import type { StudyArchive } from '../studySchemas';

/** Pins captured facts while permitting later append-only interpretation, for publication and public link revalidation. @example bookObservationHash(study.observations[0]) */
export function bookObservationHash(observation: StudyArchive['observations'][number]): string {
  return sha256(JSON.stringify({ ...observation, interpretations: [] }));
}
