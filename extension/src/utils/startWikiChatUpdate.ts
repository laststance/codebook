import {
  handWikiRequestToChat,
  type WikiChatSession,
} from './handWikiRequestToChat'
import { sleepUntilAborted } from './sleepUntilAborted'
import {
  waitForWikiChatAnswer,
  type WikiChatAnswer,
} from './waitForWikiChatAnswer'
import { waitForWikiOutputChange } from './waitForWikiOutputChange'
import {
  watchWikiChatReply,
  type WikiChatReplyWatch,
} from './watchWikiChatReply'
import {
  withdrawWikiChatRequest,
  type WikiChatWithdrawal,
} from './withdrawWikiChatRequest'

/** How the start of a VS Code Wiki update in the editor chat ended: the answers of {@link waitForWikiChatAnswer}, where `unanswered` also says which session the request went to and whether Codebook saw it leave the chat. */
export type WikiChatStartOutcome =
  | Exclude<WikiChatAnswer, { outcome: 'unanswered' }>
  | {
      outcome: 'unanswered'
      session: WikiChatSession
      withdrawal: WikiChatWithdrawal
    }

/** The start of a VS Code Wiki update in the editor chat: how it ended, the session the request went to, which the sentence of a start without a sign words its next step by, and the watch of the reply's end, which the watch for the publish follows when the chat works on the request. */
export type WikiChatStart = WikiChatStartOutcome & {
  session: WikiChatSession
  reply: WikiChatReplyWatch
}

/** The bounds of the start: of each command that starts the chat session, of the first sign, of each step of the withdrawal, and the time between two looks at the Wiki's output. */
export type WikiChatStartBounds = {
  sessionStartMs: number
  answerMs: number
  withdrawSettleMs: number
  outputPollMs: number
}

/**
 * Starts a VS Code Wiki update in the editor chat and says how the start ended: it watches for signs of the update, hands the request over in a chat session of its own, waits for the first answer, and takes the request back when none came within the bound.
 *
 * Why in one place: the steps depend on each other (the signs must be watched before the request is sent, the withdrawal needs the hand-over's command and session), and whatever happens the watches must go. A step that throws leaves this function as a rejection, which the extension's guard around the start turns into a failed run.
 * Trigger: the extension calls it once per VS Code update, after the run began.
 *
 * @param options.query - The update request.
 * @param options.runCommand - Runs an editor command with the arguments given.
 * @param options.watchSigns - Registers the editor's listeners; it gets the function to call when a sign of the update is seen ({@link isWikiUpdateSign}) and returns what disposes them.
 * @param options.readOutputStamp - Reads the cheap stamp of the Wiki's output; a change of it is a sign too.
 * @param options.signal - Aborts the start (the window closes).
 * @param options.bounds - The bounds of the start.
 * @param options.sleep - Delay function that ends early when its signal aborts; tests pass one of a manual clock.
 * @returns The answer of {@link waitForWikiChatAnswer}, for `unanswered` with the withdrawal's result, and always with the session the request went to and the watch of the reply's end ({@link watchWikiChatReply}).
 * @throws What `watchSigns` throws, before any command ran.
 *
 * @example
 * ```ts
 * await startWikiChatUpdate({ query, runCommand, watchSigns, readOutputStamp, signal, bounds })
 * // => { outcome: 'working', session: 'own', reply } once the chat read the manifest
 * // => { outcome: 'unanswered', session: 'own', withdrawal: 'withdrawn', reply } for a chat that is not ready
 * ```
 */
export async function startWikiChatUpdate(options: {
  query: string
  runCommand: (command: string, ...argument: unknown[]) => PromiseLike<unknown>
  watchSigns: (reportSign: () => void) => Array<{ dispose(): void }>
  readOutputStamp: () => Promise<string>
  signal: AbortSignal
  bounds: WikiChatStartBounds
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<WikiChatStart> {
  const { signal, bounds } = options
  const sleep = options.sleep ?? sleepUntilAborted
  let reportSign = (): void => {}
  const sign = new Promise<void>((resolveSign) => {
    reportSign = resolveSign
  })
  const ended = new AbortController()
  // The signs are watched before the request is sent, so none is missed; a listener that cannot be registered ends the start before anything was sent.
  const watches = options.watchSigns(reportSign)
  try {
    // A stamp that cannot be read is no sign.
    void waitForWikiOutputChange({
      readStamp: options.readOutputStamp,
      pollMs: bounds.outputPollMs,
      signal: AbortSignal.any([signal, ended.signal]),
      sleep,
    }).then(
      (didOutputChange) => didOutputChange && reportSign(),
      () => undefined,
    )
    const { session, handOver } = await handWikiRequestToChat({
      query: options.query,
      runCommand: options.runCommand,
      signal,
      sessionStartTimeoutMs: bounds.sessionStartMs,
      sleep,
    })
    // The bound starts when the request is handed over and ends at the first answer, not when the command returns: a chat that cannot answer still takes the request.
    const answer = await waitForWikiChatAnswer({
      reply: handOver,
      sign,
      signal,
      timeoutMs: bounds.answerMs,
      sleep,
    })
    // The reply may end after the first answer; the watch for the publish follows it.
    const reply = watchWikiChatReply(handOver)
    if (answer.outcome !== 'unanswered') return { ...answer, session, reply }
    // The request the chat still holds is taken back before the result is published.
    const withdrawal = await withdrawWikiChatRequest({
      handOver,
      session,
      runChatCommand: options.runCommand,
      signal,
      settleMs: bounds.withdrawSettleMs,
      sleep,
    })
    return { outcome: 'unanswered', session, withdrawal, reply }
  } finally {
    ended.abort()
    for (const watch of watches) watch.dispose()
  }
}
