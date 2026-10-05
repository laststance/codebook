import { chatCommandReturnsInTime } from './chatCommandReturnsInTime'
import { sleepUntilAborted } from './sleepUntilAborted'
import type { BoundedWait } from './waitWithin'

/** VS Code's command that reveals the chat a request would go to (the chat focused last when it can be shown, the Chat view otherwise) and makes it the chat focused last; with a query it sends the query as a request into that chat and, with `blockOnResponse`, returns when the response completes or waits for a confirmation. */
const OPEN_CHAT_COMMAND = 'workbench.action.chat.open'
/** VS Code's command "New Chat": the chat focused last gets a new, empty session; the session it showed is kept. */
const NEW_CHAT_COMMAND = 'workbench.action.chat.newChat'

/** Where a Wiki update request was sent: into a chat session Codebook started for it (`own`), or into the session the learner had open (`shared`), because the editor did not start a new one. */
export type WikiChatSession = 'own' | 'shared'

/**
 * Gives the chat the update request will go to a new session; called by {@link handWikiRequestToChat} before the request is sent.
 * @param runChatCommand - Runs an editor command without arguments.
 * @param wait - The bound of each of the two commands.
 * @returns `own` when the chat was revealed and the editor's New Chat returned; `shared` when either command threw (an editor without it), did not return in time or was not started because of an abort.
 * @example
 * await startOwnChatSession(run, wait) // => 'own' in VS Code 1.120.0 and later
 */
async function startOwnChatSession(
  runChatCommand: (command: string) => PromiseLike<unknown>,
  wait: BoundedWait,
): Promise<WikiChatSession> {
  // The reveal first: New Chat acts on the chat focused last, which may be an inline chat the request would not go to; the reveal makes the request's chat the one focused last.
  if (
    !(await chatCommandReturnsInTime(OPEN_CHAT_COMMAND, runChatCommand, wait))
  )
    return 'shared'
  return (await chatCommandReturnsInTime(
    NEW_CHAT_COMMAND,
    runChatCommand,
    wait,
  ))
    ? 'own'
    : 'shared'
}

/**
 * Hands the request of a VS Code Wiki update to the editor chat in a chat session of its own, so that it is neither queued behind a request of the learner nor makes the editor cancel one, and the chat's Cancel at the bound finds Codebook's request alone.
 *
 * Why: sent into the session the learner uses, the request acts like a typed message. The editor queues it behind a request in progress (`chatWidget.ts`, `options.queue ??= ChatRequestQueueKind.Queued`), so a busy chat looks like one that does not answer, and it cancels a request that waits for a confirmation (`cancelCurrentRequestForSession(…, 'acceptInput-needsInput')`).
 * Trigger: the extension calls it once per VS Code update, after the start checks and before the wait for the chat's first answer.
 *
 * How (VS Code source, `microsoft/vscode` at tags 1.120.0 and 1.140.0): `workbench.action.chat.open` without a query reveals the chat a request would go to and reports it as the chat focused last (`chatActions.ts`, `widgetService.revealWidget()` and `chatWidget.focusInput()`; `chatWidget.ts`, `focusInput` fires the focus event also when the input cannot take the focus); the editor's New Chat gives that chat a new session (`chatNewActions.ts`, `runNewChatAction`); the request is then sent into it with the same command. New Chat asks the learner nothing: the question about undecided edits is skipped for a session that is kept alive, which every session but the quick chat's is (`chatEditorInput.ts`, `shouldShowClearEditingSessionConfirmation`; `chatModel.ts`, `willKeepAlive`). The session the learner had open stays in memory while a request of it is in progress, waits for a confirmation or has undecided edits (`chatModel.ts`, "requestInProgressKeepAlive"), and is in the chat's history otherwise; its requests go on. New Chat closes the diff editors of that session's edits (`chatEditingSession.ts`, `_performStop`) and nothing else of it.
 *
 * Limits: a Chat view opened for the first time in a window may not have its session yet when New Chat runs; New Chat then does nothing and the request goes into the session the view restores, in which nothing is in progress. When the chat focused last is a chat in an editor, New Chat replaces the session in that editor tab.
 *
 * @param options.query - The update request.
 * @param options.runCommand - Runs an editor command with the arguments given; the reveal and New Chat are run with none.
 * @param options.signal - Aborts the hand-over (the window closes): no further command is started and no request is sent.
 * @param options.sessionStartTimeoutMs - How long each of the two commands that start the session (the reveal and New Chat) may take.
 * @param options.sleep - Delay function that ends early when its signal aborts; tests pass one of a manual clock.
 * @returns The session the request went to, and the promise of the command that sent it (it settles when the request ended, and with `undefined` at once when no request was sent).
 *
 * @example
 * ```ts
 * const { session, handOver } = await handWikiRequestToChat({ query, runCommand: (command, ...argument) => vscode.commands.executeCommand(command, ...argument), signal, sessionStartTimeoutMs: 5_000 })
 * // session => 'own'; handOver settles with the chat's reply
 * ```
 */
export async function handWikiRequestToChat(options: {
  query: string
  runCommand: (command: string, ...argument: unknown[]) => PromiseLike<unknown>
  signal: AbortSignal
  sessionStartTimeoutMs: number
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<{ session: WikiChatSession; handOver: Promise<unknown> }> {
  const session = await startOwnChatSession(options.runCommand, {
    timeoutMs: options.sessionStartTimeoutMs,
    signal: options.signal,
    sleep: options.sleep ?? sleepUntilAborted,
  })
  // A window that began to close meanwhile sends no request.
  if (options.signal.aborted)
    return { session, handOver: Promise.resolve(undefined) }
  return {
    session,
    // A command that throws at once is a failed hand-over too.
    handOver: Promise.resolve().then(() =>
      options.runCommand(OPEN_CHAT_COMMAND, {
        query: options.query,
        isPartialQuery: false,
        blockOnResponse: true,
      }),
    ),
  }
}
