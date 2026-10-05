import { sleepUntilAborted } from './sleepUntilAborted'

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

/** The bound of each wait of the withdrawal: the settle time, the abort that ends it early and the delay function. */
type WithdrawalWait = {
  settleMs: number
  signal: AbortSignal
  sleep: (delayMs: number, signal: AbortSignal) => Promise<void>
}

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
 * Waits for a promise for at most the settle time, and no longer than the abort; every wait of the withdrawal goes through it.
 * @param pending - What is waited for; it must not reject.
 * @param wait - The settle time, the abort and the delay function.
 * @returns What `pending` resolved with, or `undefined` when the settle time passed or the signal aborted first.
 * @example
 * await waitWithin(watch.ended, { settleMs: 2_000, signal, sleep }) // at most 2 s
 */
async function waitWithin<Settled>(
  pending: Promise<Settled>,
  wait: WithdrawalWait,
): Promise<Settled | undefined> {
  const waited = new AbortController()
  try {
    return await Promise.race([
      pending,
      wait
        .sleep(wait.settleMs, AbortSignal.any([wait.signal, waited.signal]))
        .then(() => undefined),
    ])
  } finally {
    // The delay of a wait that ended otherwise is released.
    waited.abort()
  }
}

/**
 * Runs one of the chat's commands and says whether it returned in time; called by {@link runWithdrawalStep}.
 * @param command - The chat command to run without arguments.
 * @param runChatCommand - Runs an editor command.
 * @param wait - The bound of the command's return; an aborted withdrawal runs no command.
 * @returns `true` when the command returned within the settle time; `false` when it threw, did not return in time, or the signal had aborted before it or aborted meanwhile.
 * @example
 * await returnsInTime('workbench.action.chat.cancel', run, wait) // => false for an editor without the command
 */
async function returnsInTime(
  command: string,
  runChatCommand: (command: string) => PromiseLike<unknown>,
  wait: WithdrawalWait,
): Promise<boolean> {
  // A withdrawal that was aborted (the window closes) runs no further command.
  if (wait.signal.aborted) return false
  const didReturn = await waitWithin(
    Promise.resolve()
      .then(() => runChatCommand(command))
      .then(
        () => true,
        () => false,
      ),
    wait,
  )
  return didReturn === true
}

/**
 * Runs one of the chat's commands and waits for what it did to the request Codebook handed over; called by {@link withdrawWikiChatRequest} for the queue's command and then for the Cancel.
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
  wait: WithdrawalWait,
): Promise<WithdrawalStep> {
  const didCommandReturn = await returnsInTime(command, runChatCommand, wait)
  // The request the command acted on ends its hand-over command right after; a command that did not run is not waited for.
  if (didCommandReturn) await waitWithin(handOver.ended, wait)
  if (handOver.hasEnded) return 'ended'
  return didCommandReturn ? 'pending' : 'not-run'
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
 * How, and why in this order: no command tells an extension whether its request is the chat's request in progress or waits in the queue behind one of the learner's, and the command that removes one queued request needs the request's id, which no command returns. So the queue's command runs first: a queued request it removes ends the hand-over command without a reply (`chatServiceImpl.ts`, `removePendingRequest`), and the Cancel is then not run, because the request in progress is not Codebook's. Only when the hand-over command is still pending after the settle time is Codebook's request the one in progress, and the Cancel stops it: a cancelled response counts as complete (`chatModel.ts`, `isComplete`), so the hand-over command returns then too.
 *
 * Limits (VS Code source, `microsoft/vscode` at tags 1.120.0 and 1.140.0): both commands act on the chat widget the learner focused last and on the session it shows then (`chatExecuteActions.ts`, `CancelAction.run`: `widgetService.lastFocusedWidget`, `chatService.cancelCurrentRequestForSession(widget.viewModel.sessionResource)`; `chatQueueActions.ts`, `ChatRemoveAllPendingRequestsAction.run`). The hand-over focuses the chat it wrote into, so that is Codebook's chat unless the learner moved within the bound:
 * - A learner who opened another chat session or focused another chat (a chat editor, the quick chat, an inline chat) meanwhile: the queue's command removes the requests queued there and the Cancel stops the request in progress there; Codebook's request stays where it is, the hand-over command stays pending and the result is `left`.
 * - Requests the learner queued in the same chat, behind Codebook's request or beside it, are removed with it: the queue's command cannot name one request.
 *
 * @param options.handOver - The promise of `workbench.action.chat.open` with `blockOnResponse` that handed the request over; it settles when the request ended.
 * @param options.runChatCommand - Runs an editor command without arguments.
 * @param options.signal - Aborts the withdrawal (the window closes): the wait under way ends and no further command runs.
 * @param options.settleMs - How long each command may take to return, and the hand-over command to return after it.
 * @param options.sleep - Delay function that ends early when its signal aborts; tests pass one of a manual clock.
 * @returns
 * - `withdrawn`: the hand-over command returned, before any command or after one of them
 * - `left`: a command threw or did not return in time, the signal aborted, or the hand-over command stayed pending after both commands
 *
 * @example
 * ```ts
 * await withdrawWikiChatRequest({ handOver, runChatCommand: (command) => vscode.commands.executeCommand(command), signal, settleMs: 2_000 })
 * // => 'withdrawn' once the chat's Cancel stopped the request that showed "Getting chat ready"
 * ```
 */
export async function withdrawWikiChatRequest(options: {
  handOver: Promise<unknown>
  runChatCommand: (command: string) => PromiseLike<unknown>
  signal: AbortSignal
  settleMs: number
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<WikiChatWithdrawal> {
  const handOver = watchHandOver(options.handOver)
  const wait: WithdrawalWait = {
    settleMs: options.settleMs,
    signal: options.signal,
    sleep: options.sleep ?? sleepUntilAborted,
  }
  // A hand-over command that returned before this call is seen one turn after the watch was set.
  await Promise.resolve()
  if (handOver.hasEnded) return 'withdrawn'
  // The queue first: only a request that is not queued can be the one the Cancel stops.
  const queueStep = await runWithdrawalStep(
    REMOVE_QUEUED_CHAT_REQUESTS_COMMAND,
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
