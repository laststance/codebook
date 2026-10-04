/**
 * Wraps an action so that a call made while an earlier call is still running gets that run's promise instead of starting a second one.
 *
 * Why: a command pressed twice must not run its start twice, each with resources of its own that the other knows nothing about.
 * Used for "Codebook: Open DeepWiki in Browser", where two opens in flight each started a reader.
 *
 * @param action - The action to run at most once at a time.
 * @returns A function that starts the action when none is running and otherwise returns the running one's promise; after it settled, the next call starts it anew.
 *
 * @example
 * ```ts
 * const open = joinInFlight(async () => startReader())
 * const [first, second] = [open(), open()]
 * first === second // => true, and one reader was started
 * ```
 */
export function joinInFlight<Result>(
  action: () => Promise<Result>,
): () => Promise<Result> {
  let running: Promise<Result> | undefined
  return () => {
    running ??= action().finally(() => {
      running = undefined
    })
    return running
  }
}
