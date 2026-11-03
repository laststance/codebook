import type { VerdictBudget } from './readWithinVerdictBudget'

/** A {@link VerdictBudget} with the cleanup its creator owes. */
export type DisposableVerdictBudget = VerdictBudget & {
  /** Clears the timer and the abort listener; call it when the hit's verdict is done. */
  dispose(): void
}

/**
 * Starts the single time budget of one Pages hit's verdict.
 *
 * Why it exists: the verdict's reads must end together, after {@link SERVER_RENDER_CLASSIFICATION_MS} or when the run stops, so the budget is one promise they all race against. Called by {@link ConfiguredBrowserRun} when a Pages hit arrives, before {@link pagesDataFunctionHitVerdictOf}.
 * @param milliseconds - How long the budget lasts.
 * @param signal - The run's stop; an aborted signal ends the budget at once.
 * @returns The budget and its `dispose`; the creator disposes it in a `finally` so a long render does not pile up listeners.
 * @example
 * const budget = createVerdictBudget(SERVER_RENDER_CLASSIFICATION_MS, abort.signal)
 * try { await pagesDataFunctionHitVerdictOf(hit, reader, budget) } finally { budget.dispose() }
 */
export function createVerdictBudget(
  milliseconds: number,
  signal?: AbortSignal,
): DisposableVerdictBudget {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, milliseconds)
    // A run that already stopped leaves no time to spend.
    if (signal?.aborted) resolve()
    else if (signal) {
      onAbort = resolve
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
  return {
    expired,
    dispose(): void {
      clearTimeout(timer)
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
    },
  }
}
