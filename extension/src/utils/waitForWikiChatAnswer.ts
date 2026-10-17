import {
  answerOfWikiChatReply,
  type WikiChatReplyAnswer,
} from './answerOfWikiChatReply'
import { sleepUntilAborted } from './sleepUntilAborted'

/**
 * How the wait for the editor chat's first answer to a Wiki update request ended:
 * - `working`: a sign of the update was seen, or the chat's reply waits for a confirmation, so the chat works on the request
 * - `replied`: the chat's response completed without an error; whatever it did is done
 * - `error-reply`: the chat's response completed with an error, whose message it carries when it has one
 * - `unanswered`: the bound passed with neither
 * - `failed`: the chat command threw, with what it threw
 * - `cancelled`: the signal aborted first
 */
export type WikiChatAnswer =
  | WikiChatReplyAnswer
  | { outcome: 'unanswered' }
  | { outcome: 'failed'; error: unknown }
  | { outcome: 'cancelled' }

/**
 * Waits from the moment a VS Code Wiki update hands its request to the editor chat until the chat's first observable answer, the learner's cancel or the bound.
 *
 * Why: VS Code's chat command can return at once although no chat answers (Copilot Chat disabled for the launch shows "Getting chat ready…" for good); the update must not then watch for a publish for 15 minutes. With `blockOnResponse` the command settles only when the chat's response completes or waits for a confirmation, and a step the chat takes without a confirmation is reported by the caller as a sign.
 * Trigger: {@link startWikiChatUpdate} calls it right after it sent the request, before the watch for the publish starts.
 *
 * @param options.reply - The chat command's own promise (`workbench.action.chat.open` with `blockOnResponse`).
 * @param options.sign - Settles at the first sign of the update the caller saw; never settles when none comes.
 * @param options.signal - Aborts the wait (extension shutdown).
 * @param options.timeoutMs - Bound from the hand-over to the first answer.
 * @param options.sleep - Delay function that ends early when its signal aborts; tests pass one of a manual clock.
 * @returns
 * - `working`: a sign came, or the chat's reply waits for a confirmation, within the bound
 * - `replied`: the chat's response completed without an error within the bound
 * - `error-reply`: the chat's response completed with an error within the bound
 * - `unanswered`: the bound passed with none of these
 * - `failed`: the chat command threw, with what it threw
 * - `cancelled`: the signal aborted first
 * A command that resolves without a response (`undefined`) leaves the wait to a sign or the bound.
 *
 * @example
 * ```ts
 * await waitForWikiChatAnswer({ reply: vscode.commands.executeCommand('workbench.action.chat.open', { query, blockOnResponse: true }), sign, signal, timeoutMs: 30_000 })
 * // => { outcome: 'working' } once the chat read the manifest
 * ```
 */
export async function waitForWikiChatAnswer(options: {
  reply: PromiseLike<unknown>
  sign: Promise<void>
  signal: AbortSignal
  timeoutMs: number
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<WikiChatAnswer> {
  const sleep = options.sleep ?? sleepUntilAborted
  const ended = new AbortController()
  // A command that resolves without a response has nothing to say about the chat; the signs and the bound decide.
  const noAnswerYet = new Promise<never>(() => {})
  try {
    return await Promise.race<WikiChatAnswer>([
      Promise.resolve(options.reply).then(
        (reply): Promise<WikiChatAnswer> | WikiChatAnswer =>
          reply === undefined ? noAnswerYet : answerOfWikiChatReply(reply),
        (error: unknown): WikiChatAnswer => ({ outcome: 'failed', error }),
      ),
      options.sign.then((): WikiChatAnswer => ({ outcome: 'working' })),
      // The sleep ends at the bound, at the abort, or when another outcome came first.
      sleep(
        options.timeoutMs,
        AbortSignal.any([options.signal, ended.signal]),
      ).then((): WikiChatAnswer =>
        options.signal.aborted
          ? { outcome: 'cancelled' }
          : { outcome: 'unanswered' },
      ),
    ])
  } finally {
    ended.abort()
  }
}
