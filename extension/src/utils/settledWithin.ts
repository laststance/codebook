/**
 * Waits for an operation for at most `timeoutMs`, so {@link StudyWorkspace.close} cannot be held by a storage write that never returns.
 *
 * The operation is never cancelled: one still pending at the bound keeps running, so the data it writes is kept.
 *
 * @param operation - The pending work, or `undefined` when there is none.
 * @param timeoutMs - How long the caller may be held.
 * @returns
 * - `true` when the operation settled within the bound (or there was none)
 * - `false` when the bound elapsed first
 * @throws The operation's own rejection when it rejects within the bound.
 * @example
 * await settledWithin(library.flush(), 5_000) // => true once the queued writes landed
 * await settledWithin(new Promise(() => {}), 5_000) // => false after 5 s
 */
export async function settledWithin(
  operation: PromiseLike<unknown> | undefined,
  timeoutMs: number,
): Promise<boolean> {
  if (!operation) return true
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    return await Promise.race([
      Promise.resolve(operation).then((): true => true),
      bound,
    ])
  } finally {
    clearTimeout(timer)
  }
}
