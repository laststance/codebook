import { SET_UP_SAVED_SESSION_COMMAND } from '../constants'
import type { SignInRequiredReason } from '../constants'
import type { SavedSessionStatus } from '../runtimeSupport/savedSessionTypes'

/** What the service knows of a run when it words a sign-in refusal: the service's run id, which profile the run used and the saved-session status it read at admission. */
export type SignInRunFacts = {
  runId: string
  session?: 'saved' | 'fresh'
  savedSession?: SavedSessionStatus
}

/**
 * Builds the `details` of a `SIGN_IN_REQUIRED` error: the reason, which profile the run used, the saved-session state at its start, the setup command, and the DX-5 fields that decide a retry.
 *
 * Called by {@link StudyService} for a refusal at preparation and for one after an operation; the learner-facing command name is the same one the editor's notice offers. Holds no path, cookie or token.
 * @param input - `reason` and `session` as the run recorded them; `savedSession` as read at admission (absent when the run declared a fresh profile); `sent` and `logId` as the failure recorded them; `runUri` when the caller has it.
 * @returns The details object.
 * @example
 * describeSignInRequiredDetails({ reason: 'no-saved-session', session: 'fresh', sent: 'not-sent', logId: 'r1#start' })
 * // => { reason: 'no-saved-session', session: 'fresh', command: 'codebook.setUpSavedSession', sent: 'not-sent', sideEffects: 'none', retry: 'Ask the learner to set up the saved session, then start one new run.', logId: 'r1#start' }
 */
export function describeSignInRequiredDetails(input: {
  reason: SignInRequiredReason
  session?: 'saved' | 'fresh'
  savedSession?: SavedSessionStatus
  sent: 'sent' | 'not-sent'
  sideEffects?: 'none' | 'unknown'
  operationIndex?: number
  runUri?: string
  logId: string
}): Record<string, unknown> {
  const sideEffects =
    input.sideEffects ?? (input.sent === 'sent' ? 'unknown' : 'none')
  return {
    ...(input.runUri === undefined ? {} : { runUri: input.runUri }),
    reason: input.reason,
    ...(input.session === undefined ? {} : { session: input.session }),
    ...(input.savedSession === undefined
      ? {}
      : {
          savedSession: {
            state: input.savedSession.state,
            ...(input.savedSession.setupAt === undefined
              ? {}
              : { setupAt: input.savedSession.setupAt }),
          },
        }),
    command: SET_UP_SAVED_SESSION_COMMAND,
    ...(input.operationIndex === undefined
      ? {}
      : { operationIndex: input.operationIndex }),
    sent: input.sent,
    sideEffects,
    retry:
      sideEffects === 'none'
        ? 'Ask the learner to set up the saved session, then start one new run.'
        : 'Never retry automatically; ask the learner.',
    logId: input.logId,
  }
}
