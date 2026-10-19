import { setTimeout } from 'node:timers/promises'

import { ACTIVE_TIMEOUT_MS, POLL_INTERVAL_MS } from '../constants'

import { WaitTimeoutError } from './waitTimeoutError'
import { waitTimeoutText } from './waitTimeoutText'

/**
 * Polls an observable condition for callers awaiting runtime state, never retrying the operation itself.
 * @param read - Reads the condition; a truthy answer ends the wait.
 * @param description - What is waited for, named in the timeout.
 * @param timeoutMs - The wait's budget, compared with the clock before each read. A read that is pending is not cut short, so a read that can wait for an answer (a request to an adapter) passes its own bound, no longer than this budget.
 * @param signal - Ends the wait with its abort reason before a read, after it, and during the pause between two reads. A pending read is not interrupted: a read that can wait for an answer takes the signal itself.
 * @param pollIntervalMs - The pause after a read that gave no truthy answer, before the next one; {@link POLL_INTERVAL_MS} unless a caller whose read is costly names a longer one (the process listing on Windows, {@link HostBrowser}).
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
  pollIntervalMs = POLL_INTERVAL_MS,
): Promise<NonNullable<Value>> {
  const startedMs = performance.now()
  // Poll only the observation; click/continue are always issued separately.
  while (performance.now() - startedMs < timeoutMs) {
    signal?.throwIfAborted()
    const value = await read()
    signal?.throwIfAborted()
    if (value) return value
    await setTimeout(pollIntervalMs, undefined, { signal }).catch(
      (error: unknown) => {
        // The pause ends with an AbortError of its own; the wait rejects with the signal's reason, as before and after a read.
        if (signal?.aborted) throw signal.reason
        throw error
      },
    )
  }
  throw new WaitTimeoutError(waitTimeoutText(description))
}
