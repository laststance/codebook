/** The bound of a wait: how long it may last, the abort that ends it early and the delay function. */
export type BoundedWait = {
  timeoutMs: number
  signal: AbortSignal
  sleep: (delayMs: number, signal: AbortSignal) => Promise<void>
}

/**
 * Waits for a promise for at most a bound, and no longer than an abort; the hand-over of a Wiki update request to the editor chat and its withdrawal bound every editor command and every wait for one with it ({@link chatCommandReturnsInTime}, {@link withdrawWikiChatRequest}).
 * @param pending - What is waited for; it must not reject.
 * @param wait - The bound, the abort and the delay function (one that ends early when its signal aborts).
 * @returns What `pending` resolved with, or `undefined` when the bound passed or the signal aborted first.
 * @example
 * await waitWithin(reply, { timeoutMs: 2_000, signal, sleep: sleepUntilAborted }) // the reply, or undefined after 2 s
 */
export async function waitWithin<Settled>(
  pending: Promise<Settled>,
  wait: BoundedWait,
): Promise<Settled | undefined> {
  const waited = new AbortController()
  try {
    return await Promise.race([
      pending,
      wait
        .sleep(wait.timeoutMs, AbortSignal.any([wait.signal, waited.signal]))
        .then(() => undefined),
    ])
  } finally {
    // The delay of a wait that ended otherwise is released.
    waited.abort()
  }
}
