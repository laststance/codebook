/**
 * Lets one waiter leave a shared, non-cancellable operation when its own signal aborts; the operation itself keeps running for other waiters.
 *
 * {@link ReplayDebugger.present} uses it for the owned session's startup and retirement, so an abandoned presentation releases
 * {@link PlaybackController}'s queue even when the editor never answers.
 *
 * @param operation - Shared promise to wait for; `undefined` resolves at once.
 * @param signal - This waiter's cancellation.
 * @returns The operation's value, or `undefined` when no operation was given.
 * @throws The signal's reason once it aborts first, or the operation's own rejection.
 *
 * @example
 * ```ts
 * await untilAborted(this.starting, signal) // rejects with signal.reason if the presentation is cancelled first
 * ```
 */
export function untilAborted<Value>(
  operation: Promise<Value> | undefined,
  signal: AbortSignal,
): Promise<Value | undefined> {
  if (!operation) {
    signal.throwIfAborted()
    return Promise.resolve(undefined)
  }
  return new Promise((resolve, reject) => {
    const aborted = (): void => reject(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted))
  })
}
