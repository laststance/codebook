import { setTimeout as sleepFor } from 'node:timers/promises'

/**
 * Waits for a delay that ends early when its signal aborts, without keeping the process alive; the default delay of the Wiki update's bounded waits ({@link waitForWikiPublish}, {@link waitForWikiChatAnswer}), whose tests pass one of a manual clock instead.
 * @param delayMs - How long to wait.
 * @param signal - Ends the wait early when it aborts.
 * @returns A promise that resolves after the delay or at the abort, whichever comes first; it never rejects.
 * @example
 * await sleepUntilAborted(2_000, controller.signal) // resolves after 2 s, or at once when the controller aborts
 */
export function sleepUntilAborted(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  return sleepFor(delayMs, undefined, { signal, ref: false }).catch(
    () => undefined,
  )
}
