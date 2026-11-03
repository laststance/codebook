/** One hit's time budget as the reads of its verdict see it: it settles when the budget is spent (or the run stops). */
export type VerdictBudget = {
  /** Resolves once, when the budget ends; never rejects. */
  readonly expired: Promise<void>
}

/** What one budgeted read came to. */
export type BudgetedRead<Value> =
  | { status: 'read'; value: Value }
  | { status: 'failed' }
  | { status: 'timeout' }

/**
 * Runs one read of a hit's verdict against the hit's single time budget.
 *
 * Why it exists: every read of a Pages hit (script text, stack continuation, `pathname`, manifest) shares one budget ({@link SERVER_RENDER_CLASSIFICATION_MS}), so a slow read ends the verdict at once and the read that comes next does not start a new wait. Called by the Pages verdict's readers ({@link readPagesAsyncChain}, {@link readPagesRenderedPage}, {@link pagesDataFunctionHitVerdictOf}).
 * @param startRead - Starts the read; a throw counts as a failed read.
 * @param budget - The hit's budget. A budget that is already spent wins over a read that answers at once.
 * @returns
 * - `{ status: 'read', value }` when the read answered within the budget
 * - `{ status: 'failed' }` when the read threw or rejected
 * - `{ status: 'timeout' }` when the budget ended first
 * @example
 * await readWithinVerdictBudget(() => reader.scriptSourceOf('9'), budget) // => { status: 'read', value: 'async()=>getServerSideProps(…' }
 */
export async function readWithinVerdictBudget<Value>(
  startRead: () => Promise<Value> | Value,
  budget: VerdictBudget,
): Promise<BudgetedRead<Value>> {
  // The budget's promise is made before the read's, so when both are ready in the same turn the spent budget settles first and wins the race.
  const timeout = budget.expired.then((): BudgetedRead<Value> => ({
    status: 'timeout',
  }))
  const answer = (async () => startRead())().then(
    (value): BudgetedRead<Value> => ({ status: 'read', value }),
    (): BudgetedRead<Value> => ({ status: 'failed' }),
  )
  return Promise.race([timeout, answer])
}
