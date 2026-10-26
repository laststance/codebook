import { inspect } from 'node:util'

import { systemErrorCode } from './systemErrorCode'

/**
 * Makes the text two failures are compared by, so a failure that repeats is told apart from a different one.
 *
 * Why: the message alone merges failures that differ in kind (the same text with another system error code) and non-`Error` throws that print alike.
 * Trigger: the LLM Wiki view ({@link createLlmWikiView}) asks it for each failed read, to record a failure in Output once while it recurs.
 *
 * @param cause - Whatever the failed read threw.
 * @returns
 * - An `Error`: `<name>|<code>|<message>` (`code` is empty when it carries none)
 * - Anything else: its `util.inspect` text
 * @example
 * failureKeyOf(Object.assign(new Error('busy'), { code: 'EBUSY' })) // => 'Error|EBUSY|busy'
 * failureKeyOf({ reason: 'busy' })                                   // => "{ reason: 'busy' }"
 */
export function failureKeyOf(cause: unknown): string {
  if (cause instanceof Error)
    return `${cause.name}|${systemErrorCode(cause)}|${cause.message}`
  return inspect(cause)
}
