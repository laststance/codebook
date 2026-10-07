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
  | { outcome: 'working' }
  | { outcome: 'replied' }
  | { outcome: 'error-reply'; message: string | undefined }
  | { outcome: 'unanswered' }
  | { outcome: 'failed'; error: unknown }
  | { outcome: 'cancelled' }

/**
 * Reads one property of what VS Code's chat command returned, whatever its type; called by {@link answerOfReply}.
 * @param reply - What `workbench.action.chat.open` with `blockOnResponse` resolved with.
 * @param name - The property's name.
 * @returns The property's value, or `undefined` when the reply is no object or has no such property.
 * @example
 * replyProperty({ type: 'confirmation' }, 'type') // => 'confirmation'
 * replyProperty('text', 'type')                   // => undefined
 */
function replyProperty(reply: unknown, name: string): unknown {
  if (typeof reply !== 'object' || reply === null) return undefined
  return new Map<string, unknown>(Object.entries(reply)).get(name)
}

/**
 * Reads the message of the error a chat reply reports; called by {@link answerOfReply} for a reply with `errorDetails`.
 * @param errorDetails - The reply's `errorDetails`.
 * @returns The `message` when it is a text; `undefined` otherwise.
 * @example
 * errorMessageOf({ message: 'You have exceeded your quota.' }) // => 'You have exceeded your quota.'
 * errorMessageOf({})                                           // => undefined
 */
function errorMessageOf(errorDetails: unknown): string | undefined {
  const message = replyProperty(errorDetails, 'message')
  return typeof message === 'string' ? message : undefined
}

/**
 * Says what a reply of VS Code's chat command means for the update; called by {@link waitForWikiChatAnswer} when the command settled with a response.
 *
 * Basis (VS Code source, `chatActions.ts` at tags 1.120.0 and 1.140.0): with `blockOnResponse` the command returns `{ ...response.result, ...confirmationInfo }` with `type: 'confirmation'` when the response waits for a confirmation (`getPendingConfirmationInfo`), and `{ ...response.result }` when the response is complete; a failed response carries `errorDetails` in its result.
 *
 * @param reply - What the command resolved with; never `undefined` here.
 * @returns
 * - A reply with `errorDetails`: `error-reply` with the error's message
 * - A reply with `type: 'confirmation'`: `working`
 * - Any other reply: `replied`
 * @example
 * answerOfReply({ type: 'confirmation', kind: 'toolInvocation' })            // => { outcome: 'working' }
 * answerOfReply({})                                                         // => { outcome: 'replied' }
 * answerOfReply({ errorDetails: { message: 'Sorry, your request failed.' } }) // => { outcome: 'error-reply', message: 'Sorry, your request failed.' }
 */
function answerOfReply(reply: unknown): WikiChatAnswer {
  const errorDetails = replyProperty(reply, 'errorDetails')
  if (errorDetails !== undefined)
    return { outcome: 'error-reply', message: errorMessageOf(errorDetails) }
  return replyProperty(reply, 'type') === 'confirmation'
    ? { outcome: 'working' }
    : { outcome: 'replied' }
}

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
          reply === undefined ? noAnswerYet : answerOfReply(reply),
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
