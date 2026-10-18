import { answerOfWikiChatReply } from './answerOfWikiChatReply'
import { chatCommandReturnsInTime } from './chatCommandReturnsInTime'
import type { WikiChatSession } from './handWikiRequestToChat'
import { sleepUntilAborted } from './sleepUntilAborted'
import { waitWithin, type BoundedWait } from './waitWithin'

/** VS Code's command "Remove All Queued": removes every request that waits in the queue of the chat the learner focused last, and touches no request in progress. */
const REMOVE_QUEUED_CHAT_REQUESTS_COMMAND =
  'workbench.action.chat.removeAllPendingRequests'
/** VS Code's command behind the chat's Cancel button: stops the one request in progress of the chat the learner focused last, and touches no queued request. */
const CANCEL_CHAT_REQUEST_COMMAND = 'workbench.action.chat.cancel'

/** How the withdrawal of an unanswered Wiki update request ended: `not-sent` when the hand-over command had returned without a reply, so the chat never held the request; `withdrawn` when Codebook saw the hand-over command return with the end of its request, before the withdrawal or after one of the chat's commands, so nothing of the request is loading or queued; `left` when it did not, so the request may still be in the chat. */
export type WikiChatWithdrawal = 'not-sent' | 'withdrawn' | 'left'

/** What one of the chat's commands did to the request: `ended` (the hand-over command returned), `pending` (the command ran and the hand-over command is still pending) or `not-run` (the command threw, did not return in time or was not started because the withdrawal was aborted, so nothing can be said about the chat). */
type WithdrawalStep = 'ended' | 'pending' | 'not-run'

/** The hand-over command as the withdrawal watches it: whether its request has ended, whether it returned a reply (a response was made), and a promise that settles when it returns. */
type HandOverWatch = {
  hasEnded: boolean
  hadReply: boolean
  ended: Promise<void>
}

/**
 * Says whether what the hand-over command returned is the end of its request; called by {@link watchHandOver} when the command resolves.
 *
 * Why: the command returns at the response's end and also at its first wait for a confirmation ({@link answerOfWikiChatReply}). A reply that waits for a confirmation says that the chat has started and waits for the learner: that request is alive, and "no update is running" would be untrue.
 *
 * @param reply - What `workbench.action.chat.open` with `blockOnResponse` resolved with.
 * @returns `true` for a return without a reply (no response was ever made) and for a complete response, with or without an error; `false` for a reply that waits for a confirmation.
 * @example
 * isEndOfRequest({})                       // => true
 * isEndOfRequest({ type: 'confirmation' }) // => false
 */
function isEndOfRequest(reply: unknown): boolean {
  return (
    reply === undefined || answerOfWikiChatReply(reply).outcome !== 'working'
  )
}

/**
 * Notes when the hand-over command returns and whether that is the end of its request; called once by {@link withdrawWikiChatRequest}.
 * @param handOver - The promise of `workbench.action.chat.open` with `blockOnResponse`.
 * @returns The watch: `hasEnded` turns `true` in the turn the command settles with the end of its request ({@link isEndOfRequest}) or throws, `hadReply` says whether it resolved with a value, and `ended` settles at every return, also at one that is no end, because the command says nothing more after it.
 * @example
 * const watch = watchHandOver(Promise.resolve({}))
 * await watch.ended
 * watch.hasEnded // => true
 * watch.hadReply // => true
 */
function watchHandOver(handOver: Promise<unknown>): HandOverWatch {
  const watch: HandOverWatch = {
    hasEnded: false,
    hadReply: false,
    ended: Promise.resolve(),
  }
  watch.ended = handOver.then(
    (reply) => {
      watch.hasEnded = isEndOfRequest(reply)
      watch.hadReply = reply !== undefined
    },
    () => {
      watch.hasEnded = true
    },
  )
  return watch
}

/**
 * Says whether the chat never held the request: the hand-over command returned before the withdrawal without a reply (the chat made no response: it refused the request, or the command threw); called by {@link withdrawWikiChatRequest} before any command.
 * @param handOver - The watch of the hand-over command.
 * @returns `true` for a command that has returned without a reply; `false` while it is pending, and for one that returned a reply in the moment after the bound: a complete reply ended the request ({@link hasEndedWithReply}), and one that waits for a confirmation is stopped like a pending one.
 * @example
 * isRequestNotSent({ hasEnded: true, hadReply: false, ended }) // => true
 */
function isRequestNotSent(handOver: HandOverWatch): boolean {
  return handOver.hasEnded && !handOver.hadReply
}

/**
 * Runs one of the chat's commands and waits for what it did to the request Codebook handed over; called by {@link withdrawWikiChatRequest} for the Cancel and, in a shared session, for the queue's command before it.
 * @param command - The chat command to run without arguments.
 * @param runChatCommand - Runs an editor command; its rejection is taken as a command that did not run.
 * @param handOver - The watch of the hand-over command.
 * @param wait - The bound of the command's return and, after it, of the hand-over command's return.
 * @returns
 * - `ended`: the hand-over command returned with the end of its request
 * - `pending`: the command returned and the request has not ended: the hand-over command is still pending after the settle time (or at the abort, after which no further command runs), or it returned a reply that waits for a confirmation
 * - `not-run`: the command threw or did not return within the settle time, or the signal had aborted
 * @example
 * await runWithdrawalStep('workbench.action.chat.cancel', run, watch, wait) // => 'ended' for the request in progress
 */
async function runWithdrawalStep(
  command: string,
  runChatCommand: (command: string) => PromiseLike<unknown>,
  handOver: HandOverWatch,
  wait: BoundedWait,
): Promise<WithdrawalStep> {
  const didCommandReturn = await chatCommandReturnsInTime(
    command,
    runChatCommand,
    wait,
  )
  // The request the command acted on ends its hand-over command right after; a command that did not run is not waited for.
  if (didCommandReturn) await waitWithin(handOver.ended, wait)
  if (handOver.hasEnded) return 'ended'
  return didCommandReturn ? 'pending' : 'not-run'
}

/**
 * Takes Codebook's request out of the queue of a session it shares with the learner, before the Cancel; called by {@link withdrawWikiChatRequest}.
 *
 * Why: in a shared session the request may wait in the queue behind a request of the learner, and the Cancel would then stop the learner's. No command tells an extension which of the two it is, and the command that removes one queued request needs its id, which no command returns. A queued request the queue's command removes ends the hand-over command without a reply (`chatServiceImpl.ts`, `removePendingRequest`), so only a hand-over command that is still pending afterwards is the request in progress. In a session of Codebook's own nothing of Codebook's can be queued, and the queue, which can then hold only requests the learner typed there, is left alone.
 *
 * @param session - Where the request was sent.
 * @param runChatCommand - Runs an editor command.
 * @param handOver - The watch of the hand-over command.
 * @param wait - The bound of the command and of the hand-over command's return after it.
 * @returns For a session of Codebook's own `pending` at once, with no command run; for a shared session what the queue's command did ({@link runWithdrawalStep}).
 * @example
 * await clearSharedQueue('own', run, watch, wait) // => 'pending', nothing ran
 */
async function clearSharedQueue(
  session: WikiChatSession,
  runChatCommand: (command: string) => PromiseLike<unknown>,
  handOver: HandOverWatch,
  wait: BoundedWait,
): Promise<WithdrawalStep> {
  return session === 'own'
    ? 'pending'
    : runWithdrawalStep(
        REMOVE_QUEUED_CHAT_REQUESTS_COMMAND,
        runChatCommand,
        handOver,
        wait,
      )
}

/**
 * Says whether the request already ended with a reply before the withdrawal: the hand-over command returned a complete response in the moment between the bound of the first answer and this call; called by {@link withdrawWikiChatRequest} before any command.
 * Why: the chat's commands act on the chat focused last, not on Codebook's request, so once that request has ended they can only remove the learner's queued requests or stop the learner's request in progress.
 * @param handOver - The watch of the hand-over command.
 * @returns `true` for a command that returned the end of its request with a reply; `false` while it is pending, for a reply that waits for a confirmation, and for a return without a reply ({@link isRequestNotSent}).
 * @example
 * hasEndedWithReply({ hasEnded: true, hadReply: true, ended }) // => true
 */
function hasEndedWithReply(handOver: HandOverWatch): boolean {
  return handOver.hasEnded && handOver.hadReply
}

/**
 * Words the end of the withdrawal after its last step; called by {@link withdrawWikiChatRequest}.
 * @param step - What the last command that ran did to the request.
 * @returns `withdrawn` for a request that ended; `left` for one that is still pending or whose command did not run.
 * @example
 * withdrawalAfter('ended')   // => 'withdrawn'
 * withdrawalAfter('pending') // => 'left'
 */
function withdrawalAfter(step: WithdrawalStep): WikiChatWithdrawal {
  return step === 'ended' ? 'withdrawn' : 'left'
}

/**
 * Takes back the Wiki update request an unanswering VS Code chat still holds, so nothing of it stays loading or queued when Codebook says the update was not started.
 *
 * Why: the chat keeps a request it cannot answer (Copilot Chat disabled for the launch shows "Getting chat ready" for good); a chat that becomes ready later would run it with no watch, and the editor asks about a session in progress when it quits.
 * Trigger: {@link startWikiChatUpdate} calls it when the bound of the first sign passed, before the result is published. A hand-over command that has already returned without a reply made no request, and one that has already returned a complete reply ended its request: for neither does a command run.
 *
 * How: in a session of Codebook's own ({@link handWikiRequestToChat}) the request is the session's request in progress, and the chat's Cancel stops it; nothing else runs. In a shared session the queue's command runs first ({@link clearSharedQueue}), and the Cancel only when the hand-over command is still pending after it. A cancelled response counts as complete (`chatModel.ts`, `isComplete`), so the hand-over command returns, and that return is the only proof that Codebook's own request ended. A return that waits for a confirmation is no such proof: the chat has started and waits for the learner, and whether a Cancel that ran at the same moment stopped that request the command no longer says. The result is then `left`, as for a first approval that comes after the settle time; a watch is not started for it, because it could wait 15 minutes for a request the Cancel did stop.
 *
 * Limits (VS Code source, `microsoft/vscode` at tags 1.120.0 and 1.140.0): both commands take no session from an extension. They act on the chat widget focused last and on the session it shows then (`chatExecuteActions.ts`, `CancelAction.run`: `widgetService.lastFocusedWidget`, `chatService.cancelCurrentRequestForSession(widget.viewModel.sessionResource)`; `chatQueueActions.ts`, `ChatRemoveAllPendingRequestsAction.run`). The hand-over leaves Codebook's session in the chat focused last, so that is where they act unless the learner moved within the bound:
 * - A learner who showed another session in that chat, or focused another chat (a chat editor, the quick chat, an inline chat) meanwhile: the Cancel stops the request in progress there (and in a shared session the queue's command removes the requests queued there); Codebook's request stays where it is, the hand-over command stays pending, or returns at the chat's first wait for an approval, which is no end of the request, and the result is `left`.
 * - In a shared session, requests the learner queued in the same chat are removed with Codebook's: the queue's command cannot name one request.
 *
 * @param options.handOver - The promise of `workbench.action.chat.open` with `blockOnResponse` that handed the request over; it settles when the request ended.
 * @param options.session - Where the request was sent: a session of Codebook's own, or the one the learner had open.
 * @param options.runChatCommand - Runs an editor command without arguments.
 * @param options.signal - Aborts the withdrawal (the window closes): the wait under way ends and no further command runs.
 * @param options.settleMs - How long each command may take to return, and the hand-over command to return after it.
 * @param options.sleep - Delay function that ends early when its signal aborts; tests pass one of a manual clock.
 * @returns
 * - `not-sent`: the hand-over command had returned without a reply; no command ran
 * - `withdrawn`: the hand-over command had returned a complete reply, and no command ran; or it returned with the end of its request after one of the chat's commands
 * - `left`: a command threw or did not return in time, the signal aborted, or after the Cancel the hand-over command stayed pending or had returned a reply that waits for a confirmation
 *
 * @example
 * ```ts
 * await withdrawWikiChatRequest({ handOver, session: 'own', runChatCommand: (command) => vscode.commands.executeCommand(command), signal, settleMs: 2_000 })
 * // => 'withdrawn' once the chat's Cancel stopped the request that showed "Getting chat ready"
 * ```
 */
export async function withdrawWikiChatRequest(options: {
  handOver: Promise<unknown>
  session: WikiChatSession
  runChatCommand: (command: string) => PromiseLike<unknown>
  signal: AbortSignal
  settleMs: number
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<WikiChatWithdrawal> {
  const handOver = watchHandOver(options.handOver)
  const wait: BoundedWait = {
    timeoutMs: options.settleMs,
    signal: options.signal,
    sleep: options.sleep ?? sleepUntilAborted,
  }
  // A hand-over command that returned before this call is seen one turn after the watch was set.
  await Promise.resolve()
  if (isRequestNotSent(handOver)) return 'not-sent'
  // A request that already ended leaves the chat's commands only the learner's requests to act on.
  if (hasEndedWithReply(handOver)) return 'withdrawn'
  const queueStep = await clearSharedQueue(
    options.session,
    options.runChatCommand,
    handOver,
    wait,
  )
  // A queued request that ended needs no Cancel; without the queue command's answer Codebook cannot tell whose request the Cancel would stop.
  if (queueStep !== 'pending') return withdrawalAfter(queueStep)
  return withdrawalAfter(
    await runWithdrawalStep(
      CANCEL_CHAT_REQUEST_COMMAND,
      options.runChatCommand,
      handOver,
      wait,
    ),
  )
}
