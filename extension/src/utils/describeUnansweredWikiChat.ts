import type { WikiChatSession } from './handWikiRequestToChat'
import { secondsText } from './secondsText'
import type { WikiChatWithdrawal } from './withdrawWikiChatRequest'

/** A withdrawal after which the request had not ended by itself: a request that ended with a reply before the withdrawal (`replied`) is answered by that reply, a complete one or one with an error ({@link startWikiChatUpdate}), so no sentence of a start without a sign is worded for it. */
type UnansweredWikiChatWithdrawal = Exclude<WikiChatWithdrawal, 'replied'>

/** What follows "Codebook saw no sign of the update in the editor chat within N seconds" for each session and withdrawal: what Codebook did with its request, then the next step. In a shared session the chat may only be busy with a request of the learner, so the next step names that case before the check of Copilot Chat. */
const UNANSWERED_ENDINGS: Record<
  WikiChatSession,
  Record<UnansweredWikiChatWithdrawal, string>
> = {
  own: {
    'not-sent':
      ' and the chat holds no request of it, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
    withdrawn:
      ' and took its request back, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
    left: ' and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
  },
  shared: {
    'not-sent':
      ' and the chat holds no request of it, so no update is running. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
    withdrawn:
      ' and took its request back, so no update is running. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
    left: ' and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
  },
}

/**
 * Words the failure of a VS Code Wiki update that showed no sign within its bound; called when the extension records that end, after {@link withdrawWikiChatRequest} took the request back or could not.
 *
 * Why: the sentence says what Codebook observed and did, because that is all it knows. No sign within the bound is not "the chat did not answer": a chat can work on the request with steps the editor does not report. And "no update is running" is true only when Codebook saw its request end. "Check that Copilot Chat is enabled" is the whole next step only where the request had a chat session of its own: in a session shared with the learner the editor queues the request behind a request in progress, so a chat that is only busy shows no sign either. Every sentence ends with the next step and is marked as Codebook's own, so the page shows it whole.
 *
 * @param withdrawal - Whether the chat ever held the request, and whether Codebook saw it leave the chat; never `replied`, a request that ended by itself with a reply.
 * @param session - Where the request was sent: a chat session of Codebook's own, or the one the learner had open.
 * @param timeoutMs - The bound of the first sign, a whole number of seconds.
 * @returns
 * - `not-sent`: no sign, the chat holds no request of the update, no update running
 * - `withdrawn` in a session of its own: no sign, the request taken back, no update running, and to check Copilot Chat
 * - `left` in a session of its own: no sign, the request not taken back, so it may still be in the chat and is stopped there before a retry; Codebook waits for that chat as after a stopped watch, so the retry is answered with Update anyway, which the sentence names in words that are true whether the request is in the chat or not
 * - in a shared session: the same two outcomes, with the next step that the chat may be working on another request
 * @example
 * describeUnansweredWikiChat('withdrawn', 'own', 30_000)
 * // => 'Codebook saw no sign of the update in the editor chat within 30 seconds and took its request back, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.'
 * describeUnansweredWikiChat('left', 'own', 30_000)
 * // => 'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.'
 */
export function describeUnansweredWikiChat(
  withdrawal: UnansweredWikiChatWithdrawal,
  session: WikiChatSession,
  timeoutMs: number,
): string {
  return `Codebook saw no sign of the update in the editor chat within ${secondsText(timeoutMs)}${UNANSWERED_ENDINGS[session][withdrawal]}`
}
