import { setTimeout } from 'node:timers/promises'

import { ACTIVE_TIMEOUT_MS, POLL_INTERVAL_MS } from '../constants'

import { WaitTimeoutError } from './waitTimeoutError'
import { waitTimeoutText } from './waitTimeoutText'

/**
 * Polls an observable condition for callers awaiting runtime state, never retrying the operation itself.
 * @param read - Reads the condition; a truthy answer ends the wait.
 * @param description - What is waited for, named in the timeout.
 * @param timeoutMs - The wait's budget.
 * @param signal - Ends the wait with its abort reason, also during a read.
 * @returns The first truthy answer of `read`.
 * @throws {@link WaitTimeoutError} with {@link waitTimeoutText} when the budget passed without a truthy answer; the abort reason when the signal aborted; whatever `read` throws.
 * @example
 * await waitUntil(() => ready, 'page ready') // rejects with 'Timed out waiting for page ready' after 20 s
 */
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
  throw new WaitTimeoutError(waitTimeoutText(description))
}
