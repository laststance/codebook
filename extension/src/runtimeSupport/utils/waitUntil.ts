import { setTimeout } from 'node:timers/promises'
import { ACTIVE_TIMEOUT_MS, POLL_INTERVAL_MS } from '../constants'

/** Polls an observable condition for callers awaiting runtime state, never retrying the operation itself. @example await waitUntil(() => ready, 'page ready') */
export async function waitUntil<Value>(
  read: () => Value | Promise<Value>,
  description: string,
  timeoutMs = ACTIVE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<NonNullable<Value>> {
  const startedMs = performance.now()
  // Poll only the observation; click/continue are always issued separately.
  while (performance.now() - startedMs < timeoutMs) {
    signal?.throwIfAborted()
    const value = await read()
    signal?.throwIfAborted()
    if (value) return value
    await setTimeout(POLL_INTERVAL_MS, undefined, { signal })
  }
  throw new Error(`Timed out waiting for ${description}`)
}
