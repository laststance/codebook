import { REVERSE_PROXY_REFUSAL_REASONS } from '../constants'
import { StudyError, type ErrorCode } from '../errors'

/** The retry rule of a reverse proxy refusal the learner answers or fixes, then one new run: at most the second start for the question. */
const REVERSE_PROXY_RETRY_AFTER_LEARNER =
  "After the learner's answer or confirmation, start one new run; this is at most the second start for this question."

/** The retry rule when the run could not confirm that it stopped what it started. */
const REVERSE_PROXY_RETRY_UNRELEASED =
  'Start no run: Codebook could not confirm that it stopped what it started; tell the learner.'

/** The retry rule of every `REVERSE_PROXY_REFUSED` reason, keyed `REVERSE_PROXY_REFUSED:<reason>`: the shared rule except `not-loopback` and `proof-unclassified`. */
const REVERSE_PROXY_RETRY = Object.fromEntries(
  REVERSE_PROXY_REFUSAL_REASONS.map((reason) => [
    `REVERSE_PROXY_REFUSED:${reason}`,
    reason === 'not-loopback'
      ? 'Start no run unless the learner says they changed the host mapping.'
      : reason === 'proof-unclassified'
        ? 'Start one new run only if the learner asks.'
        : REVERSE_PROXY_RETRY_AFTER_LEARNER,
  ]),
)

/** The retry rule of each saved-session refusal that ends a run before it sent anything to the page, keyed by code, or by code and details' reason where the code alone also names other failures (`BUSY`, `INVALID_CONFIGURATION`). */
const RUN_START_RETRY: Partial<
  Record<ErrorCode | `${ErrorCode}:${string}`, string>
> = {
  SIGN_IN_IN_PROGRESS:
    'Wait for the learner to finish or close the setup, then start one new run.',
  'BUSY:profile-in-use':
    'Wait until the other run ended, then start one new run.',
  SIGN_IN_PROFILE_IN_USE:
    'Ask the learner to stop the other run or quit that Chrome, then start one new run.',
  SIGN_IN_PROFILE_UNUSABLE:
    'Ask the learner to remove the saved session and set it up again, then start one new run.',
  'SIGN_IN_ORIGIN_REFUSED:origin-not-proven':
    'Change nothing and start one new run; if it repeats, tell the learner and stop.',
  SIGN_IN_ORIGIN_REFUSED:
    'Fix the origin or declare session: "fresh", then start one new run.',
  ...REVERSE_PROXY_RETRY,
  'INVALID_CONFIGURATION:saved-session-initial-storage':
    'Remove initialStorage, or declare session: "fresh" when the flow needs no sign-in, then start one new run.',
}

/**
 * Adds the fields an agent decides a retry by (the run, that nothing reached the app, the retry rule, the Output > Codebook log id) to a saved-session refusal that ended a run before it sent anything to the page.
 *
 * Why it exists: the store and the origin check throw their coded errors without knowing the run; the service does, so it completes them where it sets the run's error (DX-5, CEO-R7). The refusals come at the admission, before any server (`SIGN_IN_IN_PROGRESS`, `BUSY`, `SIGN_IN_PROFILE_IN_USE`, `SIGN_IN_PROFILE_UNUSABLE`, and `INVALID_CONFIGURATION` with reason `saved-session-initial-storage` for a saved run that declares `initialStorage`), at the origin check after the development server started (`SIGN_IN_ORIGIN_REFUSED`, also with reason `origin-not-proven`), at the reverse proxy gate (`REVERSE_PROXY_REFUSED`, every reason; the run writes the line after it stopped the server and confirmed the stop), or at the saved folder's last check right before Chrome starts (`SIGN_IN_PROFILE_IN_USE`); the run stops a server it started, and at each of the three moments it writes the Output > Codebook line `<runId>#start` that `logId` names. Called by {@link StudyService.preparationError}.
 * @param error - The error the run's preparation rejected with.
 * @param runUri - The run's resource address.
 * @param runId - The service's run id, which names the log line (`<runId>#start`).
 * @returns A copy of the error with the added details for `SIGN_IN_IN_PROGRESS`, `SIGN_IN_PROFILE_IN_USE`, `SIGN_IN_PROFILE_UNUSABLE`, `SIGN_IN_ORIGIN_REFUSED`, `SIGN_IN_ORIGIN_REFUSED` with reason `origin-not-proven`, `REVERSE_PROXY_REFUSED` with any reason (the no-run rule when `details.resourcesReleased` is false), `BUSY` with reason `profile-in-use` and `INVALID_CONFIGURATION` with reason `saved-session-initial-storage`; any other error unchanged.
 * @example
 * withRunStartRefusalDetails(new StudyError('SIGN_IN_IN_PROGRESS', 'A setup is open.'), 'codebook://run/r1', 'r1').details
 * // => { runUri: 'codebook://run/r1', sideEffects: 'none', retry: 'Wait for the learner to finish or close the setup, then start one new run.', logId: 'r1#start' }
 */
export function withRunStartRefusalDetails(
  error: StudyError,
  runUri: string,
  runId: string,
): StudyError {
  const reason = error.details?.reason
  // A code that also names other failures keeps its retry under its reason (`BUSY:profile-in-use`); every other refusal under its code.
  // A refusal whose cleanup is unconfirmed allows no new run, whatever its reason.
  const unreleased =
    error.code === 'REVERSE_PROXY_REFUSED' &&
    error.details?.resourcesReleased === false
  const retry = unreleased
    ? REVERSE_PROXY_RETRY_UNRELEASED
    : ((typeof reason === 'string'
        ? RUN_START_RETRY[`${error.code}:${reason}`]
        : undefined) ?? RUN_START_RETRY[error.code])
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
      ...error.details,
      // The service's id names the line it writes; it wins over a `logId` the refusal carries, which only the run could have guessed.
      logId: `${runId}#start`,
    },
  )
}
