import { StudyError, type ErrorCode } from '../errors'

/** The retry rule of each refusal that ends a run before it started anything, keyed by code (`BUSY` by its details' reason). */
const RUN_START_RETRY: Partial<
  Record<ErrorCode | 'BUSY:profile-in-use', string>
> = {
  SIGN_IN_IN_PROGRESS:
    'Wait for the learner to finish or close the setup, then start one new run.',
  'BUSY:profile-in-use':
    'Wait until the other run ended, then start one new run.',
  SIGN_IN_PROFILE_IN_USE:
    'Ask the learner to stop the other run or quit that Chrome, then start one new run.',
  SIGN_IN_PROFILE_UNUSABLE:
    'Ask the learner to remove the saved session and set it up again, then start one new run.',
  SIGN_IN_ORIGIN_REFUSED:
    'Fix the origin or declare session: "fresh", then start one new run.',
}

/**
 * Adds the fields an agent decides a retry by (the run, that nothing was started, the retry rule, the Output > Codebook log id) to a saved-session refusal that ended a run before it started a server or a browser.
 *
 * Why it exists: the store and the origin check throw their coded errors without knowing the run; the service does, so it completes them where it sets the run's error (DX-5, CEO-R7). Called by {@link StudyService.preparationError}.
 * @param error - The error the run's preparation rejected with.
 * @param runUri - The run's resource address.
 * @param runId - The service's run id, which names the log line (`<runId>#start`).
 * @returns A copy of the error with the added details for `SIGN_IN_IN_PROGRESS`, `SIGN_IN_PROFILE_IN_USE`, `SIGN_IN_PROFILE_UNUSABLE`, `SIGN_IN_ORIGIN_REFUSED` and `BUSY` with reason `profile-in-use`; any other error unchanged.
 * @example
 * withRunStartRefusalDetails(new StudyError('SIGN_IN_IN_PROGRESS', 'A setup is open.'), 'codebook://run/r1', 'r1').details
 * // => { runUri: 'codebook://run/r1', sideEffects: 'none', retry: 'Wait for the learner to finish or close the setup, then start one new run.', logId: 'r1#start' }
 */
export function withRunStartRefusalDetails(
  error: StudyError,
  runUri: string,
  runId: string,
): StudyError {
  const key =
    error.code === 'BUSY' && error.details?.reason === 'profile-in-use'
      ? 'BUSY:profile-in-use'
      : error.code
  const retry = RUN_START_RETRY[key]
  if (retry === undefined) return error
  return new StudyError(
    error.code,
    error.message,
    error.causeDetail,
    error.recoveryOverride,
    undefined,
    {
      runUri,
      sideEffects: 'none',
      retry,
      logId: `${runId}#start`,
      ...error.details,
    },
  )
}
