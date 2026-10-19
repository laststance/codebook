/** What became of an unanswered Wiki update request at the bound of the first sign: `not-sent` when the hand-over command had returned without a reply, so the chat never held the request; `replied` when it had already returned a reply, so the chat answered the request: a complete reply, with which the request ended by itself, or one that waits for a confirmation, with which the chat works on it; `left` when it is still pending, so the request may still be in the chat, where the learner stops or removes it. `withdrawn` names a request Codebook saw leave the chat after a command of the chat; {@link describeUnansweredWikiChat} still words it, but {@link withdrawWikiChatRequest} no longer returns it, because it runs none of the chat's commands. */
export type WikiChatWithdrawal = 'not-sent' | 'replied' | 'withdrawn' | 'left'

/** The hand-over command as the withdrawal watches it: whether it has returned (resolved or thrown) and whether it resolved with a reply (a response was made). */
type HandOverWatch = {
  hasReturned: boolean
  hadReply: boolean
}

/**
 * Notes when the hand-over command returns and whether it returned a reply; called once by {@link withdrawWikiChatRequest}.
 * @param handOver - The promise of `workbench.action.chat.open` with `blockOnResponse`.
 * @returns The watch: `hasReturned` turns `true` in the turn the command resolves or throws, and `hadReply` when it resolved with a value.
 * @example
 * const watch = watchHandOver(Promise.resolve({}))
 * await Promise.resolve()
 * watch.hadReply // => true
 */
function watchHandOver(handOver: Promise<unknown>): HandOverWatch {
  const watch: HandOverWatch = { hasReturned: false, hadReply: false }
  void handOver.then(
    (reply) => {
      watch.hasReturned = true
      watch.hadReply = reply !== undefined
    },
    () => {
      watch.hasReturned = true
    },
  )
  return watch
}

/**
 * Says whether the chat never held the request: the hand-over command returned before the withdrawal without a reply (the chat made no response: it refused the request, or the command threw); called by {@link withdrawWikiChatRequest}.
 * @param handOver - The watch of the hand-over command.
 * @returns `true` for a command that has returned without a reply; `false` while it is pending, and for one that returned a reply in the moment after the bound ({@link hasReturnedReply}).
 * @example
 * isRequestNotSent({ hasReturned: true, hadReply: false }) // => true
 */
function isRequestNotSent(handOver: HandOverWatch): boolean {
  return handOver.hasReturned && !handOver.hadReply
}

/**
 * Says whether the chat already answered the request with a reply before the withdrawal: the hand-over command returned a response in the moment between the bound of the first answer and this call, a complete one or one that waits for a confirmation; called by {@link withdrawWikiChatRequest}.
 * Why: that reply says what follows, as a reply within the bound does ({@link waitForWikiChatAnswer}): a complete one ended the request, and one that waits for a confirmation is the chat at work, which the watch follows.
 * @param handOver - The watch of the hand-over command.
 * @returns `true` for a command that returned a reply, whether it ended its request or waits for a confirmation; `false` while it is pending, and for a return without a reply ({@link isRequestNotSent}).
 * @example
 * hasReturnedReply({ hasReturned: true, hadReply: true })  // => true
 * hasReturnedReply({ hasReturned: false, hadReply: false }) // => false
 */
function hasReturnedReply(handOver: HandOverWatch): boolean {
  return handOver.hadReply
}

/**
 * Says what became of the Wiki update request an unanswering VS Code chat may still hold, before Codebook says the update showed no sign; it takes nothing back.
 *
 * Why it runs none of the chat's commands: the chat's Cancel and its "Remove All Queued" take no session and no request from an extension. They act on the chat widget focused last and on the session it shows then (VS Code source, `microsoft/vscode` at tags 1.120.0 and 1.140.0: `chatExecuteActions.ts`, `CancelAction.run`: `widgetService.lastFocusedWidget`, `chatService.cancelCurrentRequestForSession(widget.viewModel.sessionResource)`; `chatQueueActions.ts`, `ChatRemoveAllPendingRequestsAction.run`: every pending request of that widget's session), and neither the editor's commands nor its API tell an extension which session the chat focused last shows or which request is Codebook's. A learner who showed another session or focused another chat within the bound would have the request in progress there stopped while Codebook's goes on, and in a session shared with the learner "Remove All Queued" removes the learner's queued requests with Codebook's. Codebook cannot verify that a command would act on its own request, so it leaves the request where it is: the sentence of the end says that the request may still be in the chat and that the learner stops or removes it in the Chat view ({@link describeUnansweredWikiChat}), and the run keeps the reservation of a chat that may still publish ({@link mayWikiChatStillPublish}).
 * Trigger: {@link startWikiChatUpdate} calls it when the bound of the first sign passed, before the result is published.
 *
 * @param options.handOver - The promise of `workbench.action.chat.open` with `blockOnResponse` that handed the request over; it settles when the response completes or waits for a confirmation, and with `undefined` when no response was made.
 * @returns
 * - `not-sent`: the hand-over command had returned without a reply, or had thrown: the chat never held the request
 * - `replied`: the hand-over command had returned a reply (the chat answered in the moment after the bound): a complete one, with or without an error, or one that waits for a confirmation
 * - `left`: the hand-over command is still pending, so the request may still be in the chat
 *
 * @example
 * ```ts
 * await withdrawWikiChatRequest({ handOver })
 * // => 'left' for a chat that still shows "Getting chat ready"
 * ```
 */
export async function withdrawWikiChatRequest(options: {
  handOver: Promise<unknown>
}): Promise<Exclude<WikiChatWithdrawal, 'withdrawn'>> {
  const handOver = watchHandOver(options.handOver)
  // A hand-over command that returned before this call is seen one turn after the watch was set.
  await Promise.resolve()
  if (isRequestNotSent(handOver)) return 'not-sent'
  // A reply that came in the moment after the bound answers the request: a complete one ended it, and one that waits for a confirmation is the chat at work.
  if (hasReturnedReply(handOver)) return 'replied'
  // No command of the chat can be pointed at this request, so it is left to the learner, whom the end's sentence tells how to stop it.
  return 'left'
}
