import { cutChatCause } from './cutChatCause'

/**
 * Words the failure of a VS Code Wiki update whose chat answered the request with an error (a quota message, a refused sign-in) and stopped; called when the extension records that end.
 *
 * Why: the chat did answer, at once, so the sentence of a chat that showed no sign within the bound would be untrue, and the chat's own message is what tells the learner what to do. The message is the chat's text, so it is quoted as bounded data ({@link cutChatCause}); the sentence ends with the next step and is marked as Codebook's own, so the page shows it whole.
 *
 * @param message - The message of the error the chat's reply reports, or `undefined` when the reply names none.
 * @returns The sentence with the message in brackets ("no message" without one), followed by the next step.
 * @example
 * describeWikiChatErrorReply('You have exceeded your premium request allowance.')
 * // => 'The editor chat answered the update request with an error and stopped (You have exceeded your premium request allowance.). Read its message in the Chat view, then press Update LLM Wiki again.'
 */
export function describeWikiChatErrorReply(
  message: string | undefined,
): string {
  return `The editor chat answered the update request with an error and stopped (${cutChatCause(message ?? 'no message')}). Read its message in the Chat view, then press Update LLM Wiki again.`
}
