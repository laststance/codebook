import { secondsText } from './secondsText'
import type { WikiChatWithdrawal } from './withdrawWikiChatRequest'

/**
 * Words the failure of a VS Code Wiki update whose chat gave no first answer within its bound; called by the extension when it records that end, after {@link withdrawWikiChatRequest} took the request back or could not.
 *
 * Why: "the update was not started" is true only when nothing of the request stays in the chat. Where Codebook did not see the request end, the sentence says so and names the step that makes a retry safe. Both sentences end with the next step and are marked as Codebook's own, so the page shows them whole.
 *
 * @param withdrawal - Whether Codebook saw its request leave the chat.
 * @param timeoutMs - The bound of the chat's first answer, a whole number of seconds.
 * @returns
 * - For `withdrawn`: the sentence that the update was not started
 * - For `left`: the sentence that the request may still be in the chat and is stopped there before a retry
 * @example
 * describeUnansweredWikiChat('withdrawn', 30_000)
 * // => 'The editor chat did not answer within 30 seconds, so the update was not started. Check that Copilot Chat is enabled and signed in, then retry.'
 * describeUnansweredWikiChat('left', 30_000)
 * // => 'The editor chat did not answer within 30 seconds, and Codebook could not withdraw its update request, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry.'
 */
export function describeUnansweredWikiChat(
  withdrawal: WikiChatWithdrawal,
  timeoutMs: number,
): string {
  const unanswered = `The editor chat did not answer within ${secondsText(timeoutMs)}`
  return withdrawal === 'withdrawn'
    ? `${unanswered}, so the update was not started. Check that Copilot Chat is enabled and signed in, then retry.`
    : `${unanswered}, and Codebook could not withdraw its update request, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry.`
}
