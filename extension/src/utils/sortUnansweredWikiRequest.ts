/** What became of a Wiki update request the chat had not answered at the bound of the first sign: `not-sent` when the hand-over command had returned without a reply, so the chat never held the request; `replied` when it had already returned a reply, so the chat answered the request: a complete reply, with which the request ended by itself, or one that waits for a confirmation, with which the chat works on it; `left` when it is still pending, so the request may still be in the chat, where the learner stops or removes it. No value names a request taken back: {@link sortUnansweredWikiRequest} runs none of the chat's commands. */
export type UnansweredWikiRequest = 'not-sent' | 'replied' | 'left'

/**
 * Sorts the Wiki update request an unanswering VS Code chat was handed into not sent, replied or left, before Codebook says the update showed no sign; it takes nothing back.
 *
 * Why it runs none of the chat's commands: the chat's Cancel and its "Remove All Queued" take no session and no request from an extension. They act on the chat widget focused last and on the session it shows then (VS Code source, `microsoft/vscode` at tags 1.120.0 and 1.140.0: `chatExecuteActions.ts`, `CancelAction.run`: `widgetService.lastFocusedWidget`, `chatService.cancelCurrentRequestForSession(widget.viewModel.sessionResource)`; `chatQueueActions.ts`, `ChatRemoveAllPendingRequestsAction.run`: every pending request of that widget's session), and neither the editor's commands nor its API tell an extension which session the chat focused last shows or which request is Codebook's. A learner who showed another session or focused another chat within the bound would have the request in progress there stopped while Codebook's goes on, and in a session shared with the learner "Remove All Queued" removes the learner's queued requests with Codebook's. Codebook cannot verify that a command would act on its own request, so it leaves the request where it is: the sentence of the end says that the request may still be in the chat and that the learner stops or removes it in the Chat view ({@link describeUnansweredWikiChat}), and the run keeps the reservation of a chat that may still publish ({@link mayWikiChatStillPublish}).
 * Trigger: {@link startWikiChatUpdate} calls it when the bound of the first sign passed, before the result is published.
 *
 * @param options.handOver - The promise of `workbench.action.chat.open` with `blockOnResponse` that handed the request over; it settles when the response completes or waits for a confirmation, and with `undefined` when no response was made.
 * @returns
 * - `not-sent`: the hand-over command had returned without a reply, or had thrown: the chat never held the request
 * - `replied`: the hand-over command had returned a reply (the chat answered in the moment after the bound): a complete one, with or without an error, or one that waits for a confirmation; such a reply says what follows, as a reply within the bound does ({@link waitForWikiChatAnswer})
 * - `left`: the hand-over command is still pending, so the request may still be in the chat
 *
 * @example
 * ```ts
 * await sortUnansweredWikiRequest({ handOver })
 * // => 'left' for a chat that still shows "Getting chat ready"
 * ```
 */
export async function sortUnansweredWikiRequest(options: {
  handOver: Promise<unknown>
}): Promise<UnansweredWikiRequest> {
  // No command of the chat can be pointed at a request still pending, so it is left to the learner, whom the end's sentence tells how to stop it.
  let request: UnansweredWikiRequest = 'left'
  // A command that returned without a reply made no response: the chat refused the request, or the command threw. A reply that came in the moment after the bound answers the request: a complete one ended it, and one that waits for a confirmation is the chat at work.
  void options.handOver.then(
    (reply) => {
      request = reply === undefined ? 'not-sent' : 'replied'
    },
    () => {
      request = 'not-sent'
    },
  )
  // A hand-over command that returned before this call is seen one turn after its handlers were set.
  await Promise.resolve()
  return request
}
