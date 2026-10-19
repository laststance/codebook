/**
 * Waits for a promise for at most a while, so that a test whose awaited event never comes fails in its assertion instead of at the runner's timeout.
 * Called by the tests of the Wiki reader and of its page workers wherever they wait for an answer, a thread's end or a connection's close that a defect would hold back.
 * @param promise - What the test waits for.
 * @param waitMs - How long it waits at most.
 * @returns What the promise settled with, or `'still waiting'`.
 * @example await within(pool.endOfWorker(0), 2_000) // => 'ended'
 */
export function within<Value>(
  promise: Promise<Value>,
  waitMs: number,
): Promise<Value | 'still waiting'> {
  return Promise.race([
    promise,
    new Promise<'still waiting'>((resolveWait) =>
      setTimeout(() => resolveWait('still waiting'), waitMs),
    ),
  ])
}
