import { cutChatCause } from './cutChatCause'
import type { WikiRunKind } from './wikiUpdateRun'

/**
 * Words the failure of a VS Code Wiki update whose chat answered the request with an error (a quota message, a refused sign-in) and stopped; called when the extension records that end.
 *
 * Why: the chat did answer, at once, so the sentence of a chat that showed no sign within the bound would be untrue, and the chat's own message is what tells the learner what to do. The message is the chat's text, so it is quoted as bounded data ({@link cutChatCause}); the sentence ends with the next step and is marked as Codebook's own, so the page shows it whole.
 *
 * @param message - The message of the error the chat's reply reports, or `undefined` when the reply names none.
 * @param runKind - Whether the run is a generation or an update; the sentence names its request and its button.
 * @returns The sentence with the message in brackets ("no message" without one), followed by the next step.
 * @example
 * describeWikiChatErrorReply('You have exceeded your premium request allowance.')
 * // => 'The editor chat answered the update request with an error and stopped (You have exceeded your premium request allowance.). Read its message in the Chat view, then press Update LLM Wiki again.'
 */
export function describeWikiChatErrorReply(
  message: string | undefined,
  runKind: WikiRunKind = 'update',
): string {
  // A generation's sentence names its own request and button (Cycle 0055, D5).
  const [request, button] =
    runKind === 'generate'
      ? ['generate request', 'Generate LLM Wiki']
      : ['update request', 'Update LLM Wiki']
  return `The editor chat answered the ${request} with an error and stopped (${cutChatCause(message ?? 'no message')}). Read its message in the Chat view, then press ${button} again.`
}
