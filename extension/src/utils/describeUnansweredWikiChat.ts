import type { WikiChatSession } from './handWikiRequestToChat'
import { secondsText } from './secondsText'
import type { UnansweredWikiRequest } from './sortUnansweredWikiRequest'

/** What became of a request the chat had not answered with a reply when Codebook looked: a request the chat answered with a reply in the moment after the bound (`replied`) is answered by that reply, a complete one, one with an error, or one that waits for a confirmation ({@link startWikiChatUpdate}), so no sentence of a start without a sign is worded for it. */
type UnrepliedWikiRequest = Exclude<UnansweredWikiRequest, 'replied'>

/** What follows "Codebook saw no sign of the update in the editor chat within N seconds" for each session and each {@link UnrepliedWikiRequest}: what Codebook did with its request, then the next step. In a shared session the chat may only be busy with a request of the learner, so the next step names that case before the check of Copilot Chat. */
const UNANSWERED_ENDINGS: Record<
  WikiChatSession,
  Record<UnrepliedWikiRequest, string>
> = {
  own: {
    'not-sent':
      ' and the chat holds no request of it, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
    left: ' and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
  },
  shared: {
    'not-sent':
      ' and the chat holds no request of it, so no update is running. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
    left: ' and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
  },
}

/**
 * Words the failure of a VS Code Wiki update that showed no sign within its bound; called when the extension records that end, after {@link sortUnansweredWikiRequest} said what became of the request: the chat never held it (`not-sent`) or it was left in the chat (`left`), since Codebook takes no request back ({@link UnansweredWikiRequest}).
 *
 * Why: the sentence says what Codebook observed and did, because that is all it knows. No sign within the bound is not "the chat did not answer": a chat can work on the request with steps the editor does not report. And "no update is running" is said only where the chat never held the request. "Check that Copilot Chat is enabled" is the whole next step only where the request had a chat session of its own: in a session shared with the learner the editor queues the request behind a request in progress, so a chat that is only busy shows no sign either. Every sentence ends with the next step and is marked as Codebook's own, so the page shows it whole.
 *
 * @param request - Whether the chat ever held the request; never `replied`, a request the chat answered with a reply.
 * @param session - Where the request was sent: a chat session of Codebook's own, or the one the learner had open.
 * @param timeoutMs - The bound of the first sign, a whole number of seconds.
 * @returns
 * - `not-sent`: no sign, the chat holds no request of the update, no update running
 * - `left` in a session of its own: no sign, the request not taken back, so it may still be in the chat and is stopped there before a retry; Codebook waits for that chat as after a stopped watch, so the retry is answered with Update anyway, which the sentence names in words that are true whether the request is in the chat or not
 * - in a shared session: the same two outcomes, with the next step that the chat may be working on another request
 * @example
 * describeUnansweredWikiChat('not-sent', 'own', 30_000)
 * // => 'Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.'
 * describeUnansweredWikiChat('left', 'own', 30_000)
 * // => 'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.'
 */
export function describeUnansweredWikiChat(
  request: UnrepliedWikiRequest,
  session: WikiChatSession,
  timeoutMs: number,
): string {
  return `Codebook saw no sign of the update in the editor chat within ${secondsText(timeoutMs)}${UNANSWERED_ENDINGS[session][request]}`
}
