/** What a reply of VS Code's chat command says about a Wiki update request: the chat works on it (`working`: the reply waits for a confirmation), its response is complete (`replied`), or its response ended with an error, whose message it carries when it has one (`error-reply`). */
export type WikiChatReplyAnswer =
  | { outcome: 'working' }
  | { outcome: 'replied' }
  | { outcome: 'error-reply'; message: string | undefined }

/**
 * Reads one property of what VS Code's chat command returned, whatever its type; called by {@link answerOfWikiChatReply}.
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
 * Reads the message of the error a chat reply reports; called by {@link answerOfWikiChatReply} for a reply with `errorDetails`.
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
 * Says what a reply of VS Code's chat command means for the update; called by {@link waitForWikiChatAnswer} when the command settled with a response within the bound of the first answer, and by {@link watchWikiChatReply} when it settles later.
 *
 * Basis (VS Code source, `chatActions.ts` at tags 1.120.0 and 1.140.0): with `blockOnResponse` the command returns `{ ...response.result, ...confirmationInfo }` with `type: 'confirmation'` when the response waits for a confirmation (`getPendingConfirmationInfo`), and `{ ...response.result }` when the response is complete; a failed response carries `errorDetails` in its result.
 *
 * @param reply - What the command resolved with; never `undefined` here.
 * @returns
 * - A reply with `errorDetails`: `error-reply` with the error's message
 * - A reply with `type: 'confirmation'`: `working`
 * - Any other reply: `replied`
 * @example
 * answerOfWikiChatReply({ type: 'confirmation', kind: 'toolInvocation' })            // => { outcome: 'working' }
 * answerOfWikiChatReply({})                                                         // => { outcome: 'replied' }
 * answerOfWikiChatReply({ errorDetails: { message: 'Sorry, your request failed.' } }) // => { outcome: 'error-reply', message: 'Sorry, your request failed.' }
 */
export function answerOfWikiChatReply(reply: unknown): WikiChatReplyAnswer {
  const errorDetails = replyProperty(reply, 'errorDetails')
  if (errorDetails !== undefined)
    return { outcome: 'error-reply', message: errorMessageOf(errorDetails) }
  return replyProperty(reply, 'type') === 'confirmation'
    ? { outcome: 'working' }
    : { outcome: 'replied' }
}
