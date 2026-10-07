import {
  answerOfWikiChatReply,
  type WikiChatReplyAnswer,
} from './answerOfWikiChatReply'

/** How the chat's reply to a Wiki update request ended: complete, or with an error. */
export type WikiChatReplyEnd = Exclude<
  WikiChatReplyAnswer,
  { outcome: 'working' }
>

/** The end of the chat's reply as the watch for the publish follows it: a signal that aborts when the reply ended, and how it ended (`undefined` until then). */
export type WikiChatReplyWatch = {
  ended: AbortSignal
  end: () => WikiChatReplyEnd | undefined
}

/**
 * Says whether what the chat command returned is the end of the chat's reply; called by {@link watchWikiChatReply} when the command settles.
 * @param reply - What `workbench.action.chat.open` with `blockOnResponse` resolved with.
 * @returns `replied` or `error-reply` for a complete response; `undefined` for a command that returned without a response and for a reply that waits for a confirmation (the chat goes on once the learner answered, and the command says nothing more).
 * @example
 * replyEndOf({})                       // => { outcome: 'replied' }
 * replyEndOf({ type: 'confirmation' }) // => undefined
 */
function replyEndOf(reply: unknown): WikiChatReplyEnd | undefined {
  if (reply === undefined) return undefined
  const answer = answerOfWikiChatReply(reply)
  return answer.outcome === 'working' ? undefined : answer
}

/**
 * Follows the command that handed a Wiki update request to the chat until the chat's reply ends, so that the watch for the publish need not wait out its whole bound for a chat that has said its last word.
 *
 * Why: the first sign of an update (a file the chat opens, the publisher it runs) says that the chat works; what it does afterwards it tells only by its reply. A chat that then answers that it cannot publish, or stops with an error, would be watched for 15 minutes with a reservation that refuses the next press.
 * Trigger: {@link startWikiChatUpdate} calls it once, right after the request was sent; the extension hands its signal to {@link waitForWikiPublish} and reads its end when the watch stopped.
 *
 * Limit (VS Code source, `chatActions.ts` at tags 1.120.0 and 1.140.0): with `blockOnResponse` the command returns once, at the response's end or at its first wait for a confirmation. After a wait for a confirmation it has returned, so the end of that response is not seen and the watch goes on as before.
 *
 * @param handOver - The promise of `workbench.action.chat.open` with `blockOnResponse`.
 * @returns The signal that aborts when the reply ended complete or with an error, and a function that says which; a command that throws ends nothing.
 * @example
 * const reply = watchWikiChatReply(handOver)
 * reply.ended.addEventListener('abort', () => reply.end()) // => { outcome: 'replied' } once the chat finished its reply
 */
export function watchWikiChatReply(
  handOver: Promise<unknown>,
): WikiChatReplyWatch {
  const ended = new AbortController()
  let end: WikiChatReplyEnd | undefined
  void handOver.then(
    (reply) => {
      end = replyEndOf(reply)
      if (end) ended.abort()
    },
    () => undefined,
  )
  return { ended: ended.signal, end: () => end }
}
