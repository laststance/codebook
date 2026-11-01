import { StudyError } from '../../errors'
import { systemErrorCode } from '../../utils/systemErrorCode'

/**
 * Gives a thrown value whose words name a private path as a new error without them, and any other thrown value as it is.
 * Why it exists: a step of a saved-session run (the lease's preparation and marker write, the proof of the owned Chrome) fails with a file-system error whose message names the saved folder, and the run turns that message into the chat error and the `run.failed` journal entry. Called by {@link HostBrowser} for each such step's failure, with {@link hideSavedProfilePath} as `hide`.
 * An error the hider leaves unchanged keeps its identity (an abort, a timeout, a coded refusal), so its handling stays the same. A changed one is made new: a {@link StudyError} keeps its code, recovery and details; any other error keeps its name and system error code. Neither keeps the original as `cause` or its stack, since both name the path.
 * @param error - What the step threw.
 * @param hide - Replaces the private path's spellings in a text.
 * @returns
 * - `error` itself when neither its message nor its cause detail names the path
 * - A new {@link StudyError} or `Error` with the hidden words otherwise
 * @example
 * errorWithPathHidden(Object.assign(new Error("EACCES: permission denied, open '/p/x/Default/Preferences'"), { code: 'EACCES' }), (text) => text.split('/p/x').join('<saved-session>'))
 * // => Error { message: "EACCES: permission denied, open '<saved-session>/Default/Preferences'", code: 'EACCES' }
 * errorWithPathHidden(new Error('Timed out'), hide) // => the same error object
 */
export function errorWithPathHidden(
  error: unknown,
  hide: (text: string) => string,
): unknown {
  if (error instanceof StudyError) {
    const message = hide(error.message),
      causeDetail = hide(error.causeDetail)
    // A refusal that names no path stays the very error its caller reads by type and code.
    if (message === error.message && causeDetail === error.causeDetail)
      return error
    return new StudyError(
      error.code,
      message,
      causeDetail,
      error.recoveryOverride,
      undefined,
      error.details,
    )
  }
  const text = error instanceof Error ? error.message : String(error)
  const hidden = hide(text)
  if (hidden === text) return error
  const replaced = new Error(hidden)
  // The kind and the system error code stay readable; the path the original carried (its message, `path`, stack) goes.
  if (error instanceof Error) replaced.name = error.name
  const code = systemErrorCode(error)
  return code ? Object.assign(replaced, { code }) : replaced
}
