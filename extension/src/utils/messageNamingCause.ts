import { MAX_UI_TEXT_CHARS } from '../constants'

import { cutTextToFit } from './cutTextToFit'
import { withoutErrorName } from './withoutErrorName'

/** A cause that names an error's kind and nothing else, as a thrown error without a message reads in its string form ("Error", "TypeError:"). */
const ERROR_NAME_ONLY = /^[A-Za-z]*Error:?$/

/**
 * Builds the failure sentence of a run whose cause the sentence does not name yet, so the run's terminal reason and its journaled `run.failed` reason say why the run failed; called by {@link studyErrorNamingCause} for every failure {@link StudyService} sets on a run (Cycle 0046 rows 645 and 653).
 * A thrown error that is no {@link StudyError} becomes "The study operation failed." ({@link domainError}), and its own words stay in the cause only, which the journal and a saved study's reason never held.
 * @param message - The failure's sentence, as a {@link StudyError} carries it.
 * @param cause - The failure's cause, as {@link StudyError.causeDetail} carries it: often the string form of the thrown error.
 * @returns
 * - `message` itself when the cause is the message, the message already holds the cause's words, or the cause has no words besides an error's name (`'Error: '`, `'Error'`).
 * - Otherwise `"<message> Cause: <cause without its error name>"`, cut to {@link MAX_UI_TEXT_CHARS}, the limit of a saved reason.
 * @example
 * messageNamingCause('The study operation failed.', 'Error: The dedicated Application layout could not be confirmed.')
 * // => 'The study operation failed. Cause: The dedicated Application layout could not be confirmed.'
 * messageNamingCause('Configured source binding is absent.', 'Configured source binding is absent.')
 * // => 'Configured source binding is absent.'
 * messageNamingCause('The study operation failed.', String(new Error('')))
 * // => 'The study operation failed.'
 */
export function messageNamingCause(message: string, cause: string): string {
  const causeWords = withoutErrorName(cause).trim()
  // An empty cause, one that is only an error's name (`String(new Error(''))` is "Error"), and one the sentence already quotes are not appended (row 661).
  if (
    !causeWords ||
    ERROR_NAME_ONLY.test(causeWords) ||
    message.includes(causeWords)
  )
    return message
  // Cut between characters, never inside a surrogate pair, saying it was cut (F263).
  return cutTextToFit(
    `${message} Cause: ${causeWords}`,
    (candidate) => candidate.length <= MAX_UI_TEXT_CHARS,
  )
}
