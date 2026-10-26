/**
 * Runs a step that cannot be cancelled and ends the wait for it the moment an abort signal fires.
 * Why: the managed Cursor skill's verify and deploy run with the start's marker claimed; Stop LLM Wiki Run and a bound must end the start at once, without waiting for a step that may hang (Cycle 0056 task 13).
 * Trigger: the extension wraps the skill step in it; tests wrap stand-ins.
 * @param step - Starts the work; it is called once, and not at all when the signal has fired already.
 * @param signal - Ends the wait when it fires.
 * @returns What the step resolved with, when it settled before the signal.
 * @throws The signal's reason when it fired first; what the step threw when it failed first. A step that settles after the signal is not awaited: its result is ignored and its failure swallowed.
 * @example
 * await runUnderAbortSignal(() => deploy(), controller.signal)
 */
export async function runUnderAbortSignal<Result>(
  step: () => Promise<Result>,
  signal: AbortSignal,
): Promise<Result> {
  // A signal that fired before the step began leaves nothing to start.
  signal.throwIfAborted()
  const stepping = step()
  // A step that fails after the signal won the race has nobody left to tell.
  stepping.catch(() => undefined)
  let endWaiting = (): void => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    endWaiting = (): void => signal.removeEventListener('abort', onAbort)
  })
  try {
    return await Promise.race([stepping, aborted])
  } finally {
    endWaiting()
  }
}
