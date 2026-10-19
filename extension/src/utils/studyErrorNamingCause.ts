import { StudyError } from '../errors'

import { messageNamingCause } from './messageNamingCause'

/**
 * Gives a run's failure a message that names its cause, so the run's terminal reason, its error's message and the `run.failed` reason its runtime journals all say why the run failed; called by {@link StudyService} wherever it sets a run's error (Cycle 0046 rows 645 and 653).
 * A failure built with a generic sentence ("Evidence buffering or persistence failed.", "Explanation was not committed.", {@link domainError}'s "The study operation failed.") keeps its words in {@link StudyError.causeDetail} only, which neither the journal nor a saved study's reason holds.
 * @param failure - The run's failure as its path built it.
 * @returns
 * - `failure` itself, its class kept, when its message is its cause or already quotes it.
 * - Otherwise a {@link StudyError} of the same code and cause whose message is {@link messageNamingCause} of the two.
 * @example
 * studyErrorNamingCause(new StudyError('EVIDENCE_UNAVAILABLE', 'Evidence buffering or persistence failed.', 'Error: ENOSPC: no space left on device, write')).message
 * // => 'Evidence buffering or persistence failed. Cause: ENOSPC: no space left on device, write'
 * studyErrorNamingCause(new StudyError('RUNTIME_FAILED', 'Study wall deadline expired; history only.')).message
 * // => 'Study wall deadline expired; history only.'
 */
export function studyErrorNamingCause(failure: StudyError): StudyError {
  const message = messageNamingCause(failure.message, failure.causeDetail)
  // A message that names its cause already keeps its own error, its class among it.
  return message === failure.message
    ? failure
    : new StudyError(failure.code, message, failure.causeDetail)
}
