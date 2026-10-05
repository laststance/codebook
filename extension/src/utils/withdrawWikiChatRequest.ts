import { chatCommandReturnsInTime } from './chatCommandReturnsInTime'
import type { WikiChatSession } from './handWikiRequestToChat'
import { sleepUntilAborted } from './sleepUntilAborted'
import { waitWithin, type BoundedWait } from './waitWithin'

/** VS Code's command "Remove All Queued": removes every request that waits in the queue of the chat the learner focused last, and touches no request in progress. */
const REMOVE_QUEUED_CHAT_REQUESTS_COMMAND =
  'workbench.action.chat.removeAllPendingRequests'
/** VS Code's command behind the chat's Cancel button: stops the one request in progress of the chat the learner focused last, and touches no queued request. */
const CANCEL_CHAT_REQUEST_COMMAND = 'workbench.action.chat.cancel'

/** How the withdrawal of an unanswered Wiki update request ended: `withdrawn` when Codebook saw the hand-over command return, so nothing of the request is loading or queued; `left` when it did not, so the request may still be in the chat. */
export type WikiChatWithdrawal = 'withdrawn' | 'left'

/** What one of the chat's commands did to the request: `ended` (the hand-over command returned), `pending` (the command ran and the hand-over command is still pending) or `not-run` (the command threw, did not return in time or was not started because the withdrawal was aborted, so nothing can be said about the chat). */
type WithdrawalStep = 'ended' | 'pending' | 'not-run'

/** The hand-over command as the withdrawal watches it: whether it has returned, and a promise that settles when it does. */
type HandOverWatch = { hasEnded: boolean; ended: Promise<void> }

/**
 * Notes when the hand-over command returns, whatever it returns or throws: it returns exactly when its request ended; called once by {@link withdrawWikiChatRequest}.
 * @param handOver - The promise of `workbench.action.chat.open` with `blockOnResponse`.
 * @returns The watch, whose `hasEnded` turns `true` in the turn the command settles.
 * @example
 * const watch = watchHandOver(Promise.resolve({}))
 * await watch.ended
 * watch.hasEnded // => true
 */
function watchHandOver(handOver: Promise<unknown>): HandOverWatch {
  const watch: HandOverWatch = { hasEnded: false, ended: Promise.resolve() }
  const noteEnd = (): void => {
    watch.hasEnded = true
  }
  watch.ended = handOver.then(noteEnd, noteEnd)
  return watch
}

/**
 * Runs one of the chat's commands and waits for what it did to the request Codebook handed over; called by {@link withdrawWikiChatRequest} for the Cancel and, in a shared session, for the queue's command before it.
 * @param command - The chat command to run without arguments.
 * @param runChatCommand - Runs an editor command; its rejection is taken as a command that did not run.
 * @param handOver - The watch of the hand-over command.
 * @param wait - The bound of the command's return and, after it, of the hand-over command's return.
 * @returns
 * - `ended`: the hand-over command returned
 * - `pending`: the command returned and the hand-over command is still pending after the settle time (or at the abort, after which no further command runs)
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
 * Trigger: the extension calls it when the bound of the chat's first answer passed, before it publishes the result. A hand-over command that has already returned (a reply that reports an error, or no request was made) left nothing in the chat, and no command runs.
 *
 * How: in a session of Codebook's own ({@link handWikiRequestToChat}) the request is the session's request in progress, and the chat's Cancel stops it; nothing else runs. In a shared session the queue's command runs first ({@link clearSharedQueue}), and the Cancel only when the hand-over command is still pending after it. A cancelled response counts as complete (`chatModel.ts`, `isComplete`), so the hand-over command returns, and that return is the only proof that Codebook's own request ended.
 *
 * Limits (VS Code source, `microsoft/vscode` at tags 1.120.0 and 1.140.0): both commands take no session from an extension. They act on the chat widget focused last and on the session it shows then (`chatExecuteActions.ts`, `CancelAction.run`: `widgetService.lastFocusedWidget`, `chatService.cancelCurrentRequestForSession(widget.viewModel.sessionResource)`; `chatQueueActions.ts`, `ChatRemoveAllPendingRequestsAction.run`). The hand-over leaves Codebook's session in the chat focused last, so that is where they act unless the learner moved within the bound:
 * - A learner who showed another session in that chat, or focused another chat (a chat editor, the quick chat, an inline chat) meanwhile: the Cancel stops the request in progress there (and in a shared session the queue's command removes the requests queued there); Codebook's request stays where it is, the hand-over command stays pending and the result is `left`.
 * - In a shared session, requests the learner queued in the same chat are removed with Codebook's: the queue's command cannot name one request.
 *
 * @param options.handOver - The promise of `workbench.action.chat.open` with `blockOnResponse` that handed the request over; it settles when the request ended.
 * @param options.session - Where the request was sent: a session of Codebook's own, or the one the learner had open.
 * @param options.runChatCommand - Runs an editor command without arguments.
 * @param options.signal - Aborts the withdrawal (the window closes): the wait under way ends and no further command runs.
 * @param options.settleMs - How long each command may take to return, and the hand-over command to return after it.
 * @param options.sleep - Delay function that ends early when its signal aborts; tests pass one of a manual clock.
 * @returns
 * - `withdrawn`: the hand-over command returned, before any command or after one of them
 * - `left`: a command threw or did not return in time, the signal aborted, or the hand-over command stayed pending after the Cancel
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
  if (handOver.hasEnded) return 'withdrawn'
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
