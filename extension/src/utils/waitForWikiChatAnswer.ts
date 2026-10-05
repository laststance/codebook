import { sleepUntilAborted } from './sleepUntilAborted'

/** How the wait for the editor chat's first answer to a Wiki update request ended; `failed` carries what the chat command threw. */
export type WikiChatAnswer =
  | { outcome: 'answered' }
  | { outcome: 'unanswered' }
  | { outcome: 'failed'; error: unknown }
  | { outcome: 'cancelled' }

/**
 * Says whether what VS Code's chat command returned is a reply that reports an error, so the chat answered the request with nothing it can work on; called by {@link waitForWikiChatAnswer} for a settled command.
 * @param reply - What `workbench.action.chat.open` with `blockOnResponse` resolved with: the result of the response that completed or waits for a confirmation, or undefined when no response was made.
 * @returns `true` for an object with `errorDetails`; `false` for every other value.
 * @example
 * isErrorReply({ errorDetails: { message: 'Sorry, your request failed.' } }) // => true
 * isErrorReply({})                                                           // => false
 */
function isErrorReply(reply: unknown): boolean {
  return (
    typeof reply === 'object' &&
    reply !== null &&
    'errorDetails' in reply &&
    reply.errorDetails !== undefined
  )
}

/**
 * Waits from the moment a VS Code Wiki update hands its request to the editor chat until the chat's first observable answer, the learner's cancel or the bound.
 *
 * Why: VS Code's chat command can return at once although no chat answers (Copilot Chat disabled for the launch shows "Getting chat ready…" for good); the update must not then watch for a publish for 15 minutes. With `blockOnResponse` the command settles only when the chat's response completes or waits for a confirmation, and a tool call the chat makes without a confirmation (a file it reads, a command it runs) is reported by the caller.
 * Trigger: the extension calls it right after it sent the request, before the watch for the publish starts.
 *
 * @param options.reply - The chat command's own promise (`workbench.action.chat.open` with `blockOnResponse`).
 * @param options.toolCall - Settles at the first tool call the caller saw the chat make; never settles when none comes.
 * @param options.signal - Aborts the wait (learner cancel, extension shutdown).
 * @param options.timeoutMs - Bound from the hand-over to the first answer.
 * @param options.sleep - Delay function that ends early when its signal aborts; tests pass one of a manual clock.
 * @returns
 * - `answered`: the chat replied (its response completed or waits for a confirmation) or made a tool call within the bound
 * - `unanswered`: the bound passed without either, or the chat's reply reports an error, so it cannot answer the request
 * - `failed`: the chat command threw, with what it threw
 * - `cancelled`: the signal aborted first
 * A command that resolves without a response leaves the wait to a tool call or the bound.
 *
 * @example
 * ```ts
 * await waitForWikiChatAnswer({ reply: vscode.commands.executeCommand('workbench.action.chat.open', { query, blockOnResponse: true }), toolCall, signal, timeoutMs: 30_000 })
 * // => { outcome: 'answered' } once the chat read the manifest
 * ```
 */
export async function waitForWikiChatAnswer(options: {
  reply: PromiseLike<unknown>
  toolCall: Promise<void>
  signal: AbortSignal
  timeoutMs: number
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<WikiChatAnswer> {
  const sleep = options.sleep ?? sleepUntilAborted
  const ended = new AbortController()
  // A command that resolves without a response has nothing to say about the chat; the other signs and the bound decide.
  const noAnswerYet = new Promise<never>(() => {})
  try {
    return await Promise.race<WikiChatAnswer>([
      Promise.resolve(options.reply).then(
        (reply): Promise<WikiChatAnswer> | WikiChatAnswer => {
          if (reply === undefined) return noAnswerYet
          return isErrorReply(reply)
            ? { outcome: 'unanswered' }
            : { outcome: 'answered' }
        },
        (error: unknown): WikiChatAnswer => ({ outcome: 'failed', error }),
      ),
      options.toolCall.then((): WikiChatAnswer => ({ outcome: 'answered' })),
      // The sleep ends at the bound, at the learner's cancel, or when another outcome came first.
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
