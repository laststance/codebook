import type { WikiChatSession } from './handWikiRequestToChat'
import { secondsText } from './secondsText'
import type { WikiChatWithdrawal } from './withdrawWikiChatRequest'

/** What follows "The editor chat did not answer within N seconds" for each session and withdrawal: what became of the request, then the next step. In a shared session the chat may only be busy with a request of the learner, so the next step names that case before the check of Copilot Chat. */
const UNANSWERED_ENDINGS: Record<
  WikiChatSession,
  Record<WikiChatWithdrawal, string>
> = {
  own: {
    withdrawn:
      ', so the update was not started. Check that Copilot Chat is enabled and signed in, then retry.',
    left: ', and Codebook could not withdraw its update request, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry.',
  },
  shared: {
    withdrawn:
      ', so the update was not started. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
    left: ', and Codebook could not withdraw its update request, so the request may still be in the chat. Stop or remove it in the Chat view. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
  },
}

/**
 * Words the failure of a VS Code Wiki update whose chat gave no first answer within its bound; called by the extension when it records that end, after {@link withdrawWikiChatRequest} took the request back or could not.
 *
 * Why: "the update was not started" is true only when nothing of the request stays in the chat, and "check that Copilot Chat is enabled" is the whole next step only where the request had a chat session of its own: in a session shared with the learner the editor queues the request behind a request in progress, so a chat that is only busy does not answer either. Every sentence ends with the next step and is marked as Codebook's own, so the page shows it whole.
 *
 * @param withdrawal - Whether Codebook saw its request leave the chat.
 * @param session - Where the request was sent: a chat session of Codebook's own, or the one the learner had open.
 * @param timeoutMs - The bound of the chat's first answer, a whole number of seconds.
 * @returns
 * - `withdrawn` in a session of its own: the sentence that the update was not started, and to check Copilot Chat
 * - `left` in a session of its own: the sentence that the request may still be in the chat and is stopped there before a retry
 * - in a shared session: the same two outcomes, with the next step that the chat may be working on another request
 * @example
 * describeUnansweredWikiChat('withdrawn', 'own', 30_000)
 * // => 'The editor chat did not answer within 30 seconds, so the update was not started. Check that Copilot Chat is enabled and signed in, then retry.'
 * describeUnansweredWikiChat('withdrawn', 'shared', 30_000)
 * // => 'The editor chat did not answer within 30 seconds, so the update was not started. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.'
 */
export function describeUnansweredWikiChat(
  withdrawal: WikiChatWithdrawal,
  session: WikiChatSession,
  timeoutMs: number,
): string {
  return `The editor chat did not answer within ${secondsText(timeoutMs)}${UNANSWERED_ENDINGS[session][withdrawal]}`
}
