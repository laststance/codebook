import { describeUnansweredWikiChat } from './describeUnansweredWikiChat'
import { describeWikiChatErrorReply } from './describeWikiChatErrorReply'
import { describeWikiChatOpenFailure } from './describeWikiChatOpenFailure'
import type { WikiChatStartOutcome } from './startWikiChatUpdate'
import { thrownMessage } from './thrownMessage'

/** What the extension records when the start of a VS Code update already ended the run: a failure sentence of Codebook's own, a cancel, or nothing more than "the run stopped" (the end then says what is on disk). */
export type WikiChatStartEnd =
  | { failure: string; isFailureCodebookSentence: true }
  | { cancelled: true }
  | Record<string, never>

/**
 * Words the failure of a start that did not bring the chat to work; called by {@link endOfWikiChatStart}.
 * @param start - How the start ended.
 * @param answerTimeoutMs - The bound of the first sign, which the sentence of a start without one names.
 * @returns
 * - `failed` (the chat command threw): the sentence of {@link describeWikiChatOpenFailure}
 * - `unanswered`: the sentence of {@link describeUnansweredWikiChat}
 * - `error-reply`: the sentence of {@link describeWikiChatErrorReply}
 * - Any other outcome: `undefined`
 * @example
 * failureOfWikiChatStart({ outcome: 'error-reply', message: 'Quota exceeded.' }, 30_000)
 * // => 'The editor chat answered the update request with an error and stopped (Quota exceeded.). Read its message in the Chat view, then press Update LLM Wiki again.'
 */
function failureOfWikiChatStart(
  start: WikiChatStartOutcome,
  answerTimeoutMs: number,
): string | undefined {
  if (start.outcome === 'failed')
    return describeWikiChatOpenFailure(thrownMessage(start.error))
  if (start.outcome === 'unanswered')
    return describeUnansweredWikiChat(
      start.withdrawal,
      start.session,
      answerTimeoutMs,
    )
  return start.outcome === 'error-reply'
    ? describeWikiChatErrorReply(start.message)
    : undefined
}

/**
 * Says how a start without a failure ends the run, if it does; called by {@link endOfWikiChatStart}.
 * @param outcome - The start's outcome.
 * @param isWindowClosing - Whether the window began to close meanwhile.
 * @returns
 * - `replied` (the chat's response completed): an end without facts, so the run ends with what is on disk
 * - `cancelled`, or any outcome in a closing window: a cancel
 * - `working` in a window that stays: `undefined`, the watch goes on
 * @example
 * endWithoutFailure('replied', false) // => {}
 * endWithoutFailure('working', false) // => undefined
 */
function endWithoutFailure(
  outcome: WikiChatStartOutcome['outcome'],
  isWindowClosing: boolean,
): WikiChatStartEnd | undefined {
  if (outcome === 'replied') return {}
  return outcome === 'cancelled' || isWindowClosing
    ? { cancelled: true }
    : undefined
}

/**
 * Decides whether the start of a VS Code Wiki update in the editor chat already ended the run, and with what; called by the extension right after {@link startWikiChatUpdate}, before it starts the watch for the publish.
 *
 * Why: only a chat that works on the request is watched. A chat command that threw, a start without a sign, and a reply that reports an error each end the run as failed with their own sentence; a reply that says the response is complete ends it with one look at the disk (updated, or finished without publishing), with no watch and no reservation; a window that closes starts no watch its shutdown no longer finds.
 *
 * @param start - How the start ended.
 * @param answerTimeoutMs - The bound of the first sign.
 * @param isWindowClosing - Whether the window began to close meanwhile.
 * @returns The facts to end the run with, or `undefined` when the chat works on the request and the watch starts.
 * @example
 * endOfWikiChatStart({ outcome: 'working' }, 30_000, false) // => undefined
 * endOfWikiChatStart({ outcome: 'replied' }, 30_000, false) // => {}
 * endOfWikiChatStart({ outcome: 'unanswered', session: 'own', withdrawal: 'withdrawn' }, 30_000, false)
 * // => { failure: 'Codebook saw no sign of the update in the editor chat within 30 seconds and took its request back, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.', isFailureCodebookSentence: true }
 */
export function endOfWikiChatStart(
  start: WikiChatStartOutcome,
  answerTimeoutMs: number,
  isWindowClosing: boolean,
): WikiChatStartEnd | undefined {
  const failure = failureOfWikiChatStart(start, answerTimeoutMs)
  return failure === undefined
    ? endWithoutFailure(start.outcome, isWindowClosing)
    : { failure, isFailureCodebookSentence: true }
}
