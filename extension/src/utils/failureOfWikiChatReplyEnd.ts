import { describeWikiChatErrorReply } from './describeWikiChatErrorReply'
import type { WikiPublishWait } from './waitForWikiPublish'
import type { WikiChatReplyEnd } from './watchWikiChatReply'
import type { WikiRunKind } from './wikiUpdateRun'

/**
 * Names the failure a VS Code Wiki update ends with when its watch stopped because the chat's reply ended; called by the extension when it records the end of a watched run.
 *
 * Why: a reply that ended with an error says why the chat stopped, and that message is the learner's next step ({@link describeWikiChatErrorReply}). A reply that is complete names no failure: the run's end then says what is on disk (updated, or that the chat finished its reply without publishing).
 *
 * @param watchOutcome - How the watch for the publish ended.
 * @param replyEnd - How the chat's reply ended, or `undefined` when it has not.
 * @param runKind - Whether the run is a generation or an update; the error reply's sentence names it.
 * @returns The failure sentence, marked as Codebook's own, for a watch that ended at a reply with an error; no facts otherwise, also when a publish or a refusal was found at the look after the reply's end.
 * @example
 * failureOfWikiChatReplyEnd('reply-ended', { outcome: 'error-reply', message: 'Quota exceeded.' })
 * // => { failure: 'The editor chat answered the update request with an error and stopped (Quota exceeded.). Read its message in the Chat view, then press Update LLM Wiki again.', isFailureCodebookSentence: true }
 * failureOfWikiChatReplyEnd('reply-ended', { outcome: 'replied' }) // => {}
 */
export function failureOfWikiChatReplyEnd(
  watchOutcome: WikiPublishWait<unknown>['outcome'],
  replyEnd: WikiChatReplyEnd | undefined,
  runKind: WikiRunKind = 'update',
):
  { failure: string; isFailureCodebookSentence: true } | Record<string, never> {
  return watchOutcome === 'reply-ended' && replyEnd?.outcome === 'error-reply'
    ? {
        failure: describeWikiChatErrorReply(replyEnd.message, runKind),
        isFailureCodebookSentence: true,
      }
    : {}
}
