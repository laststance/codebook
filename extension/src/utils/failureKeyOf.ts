import { inspect } from 'node:util'

import { FAILURE_KEY_MAX_LENGTH } from '../constants'

import { systemErrorCode } from './systemErrorCode'

/**
 * Makes the `<name>|<code>|<message>` text of one `Error`, with every run of digits in the message replaced by `#`.
 * @param error - The error to describe.
 * @returns The text; two errors that differ only in the numbers of their messages (a pid, a timestamp, a port) read alike.
 * @example errorKeyOf(Object.assign(new Error('busy 4711'), { code: 'EBUSY' })) // => 'Error|EBUSY|busy #'
 */
function errorKeyOf(error: Error): string {
  return `${error.name}|${systemErrorCode(error)}|${error.message.replace(/\d+/g, '#')}`
}

/**
 * Makes the text two failures are compared by, so a failure that repeats is told apart from a different one.
 *
 * Why: the message alone merges failures that differ in kind (the same text with another system error code) and non-`Error` throws that print alike; a message that embeds a changing number (a pid, a timestamp) must not make every poll tick look like a new failure; a long dump must not be kept whole.
 * Trigger: the LLM Wiki view ({@link createLlmWikiView}) asks it for each failed read and each failed freshness check, to record a failure in Output once while it recurs.
 *
 * @param cause - Whatever the failed read threw.
 * @returns
 * - An `Error`: `<name>|<code>|<message>` (`code` is empty when it carries none, digit runs of the message read `#`), followed by `<-` and the same triple of its `cause` when that is an `Error` too
 * - Anything else: its `util.inspect` text
 * - Cut to {@link FAILURE_KEY_MAX_LENGTH} characters
 * - `Object.prototype.toString` text (`[object Object]`) when reading the cause throws (a `message` getter or an inspect hook that throws), so a hostile cause cannot break the caller
 * @example
 * failureKeyOf(Object.assign(new Error('busy'), { code: 'EBUSY' })) // => 'Error|EBUSY|busy'
 * failureKeyOf(new Error('pid 4711 gone'))                          // => 'Error||pid # gone'
 * failureKeyOf({ reason: 'busy' })                                   // => "{ reason: 'busy' }"
 */
export function failureKeyOf(cause: unknown): string {
  try {
    const key =
      cause instanceof Error
        ? `${errorKeyOf(cause)}${cause.cause instanceof Error ? `<-${errorKeyOf(cause.cause)}` : ''}`
        : inspect(cause)
    return key.slice(0, FAILURE_KEY_MAX_LENGTH)
  } catch {
    // A cause that cannot be read still needs a key; its type tag is all that is left to compare by.
    try {
      return Object.prototype.toString.call(cause)
    } catch {
      return 'unreadable failure'
    }
  }
}
