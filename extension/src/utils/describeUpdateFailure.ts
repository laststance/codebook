import { types } from 'node:util'

/**
 * Turns a failed Wiki update's thrown value into the sentence the browser shows after "Update failed:".
 *
 * Why: `String(error)` prefixes `Error:`, which reads as noise on the page; `instanceof Error` is false for an error raised in another realm, so the native-error check is used.
 * Trigger: the extension's update flow calls it when the chat cannot open or the Cursor agent run throws.
 *
 * @param error - Value thrown by the update flow.
 * @returns The error's message, or its string form when it is not an error.
 *
 * @example
 * ```ts
 * describeUpdateFailure(new Error('Chat is unavailable')) // => 'Chat is unavailable'
 * describeUpdateFailure('boom') // => 'boom'
 * ```
 */
export function describeUpdateFailure(error: unknown): string {
  return types.isNativeError(error) ? error.message : String(error)
}
