import { setTimeout as delay } from 'node:timers/promises'

import { systemErrorCode } from './systemErrorCode'

/** The answers after which the recursive `rm` of Node.js tries a removal again (`retryErrorCodes` of its rimraf): a file the system still holds, too many open files, or a folder that is not empty yet. */
const BUSY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'])

/**
 * Runs a file system step again while the system answers that something is still busy, as the recursive `rm` of Node.js does with `maxRetries` and `retryDelay`; called by {@link HostBrowser} for the removal of a run's own profile folder, which Windows may refuse a moment after the browser ended while it still holds a file.
 * @param operation - The step; it is run again from its start after each busy answer.
 * @param retries - How often it is run again at most.
 * @param retryDelayMs - The pause before the first retry; each further retry waits this much longer (`retryDelay` of `rm`).
 * @param pause - Waits the given time; a real timer unless a test counts the pauses.
 * @returns What the step gives once it succeeds.
 * @throws The step's error at once when it is no busy answer ({@link BUSY_CODES}), and its last error once the retries are used up.
 * @example
 * await retryWhileBusy(() => removeWithoutFollowing(profile), 3, 100) // after pauses of 100, 200 and 300 ms at most
 */
export async function retryWhileBusy<Value>(
  operation: () => Promise<Value>,
  retries: number,
  retryDelayMs: number,
  pause: (delayMs: number) => Promise<unknown> = (delayMs) => delay(delayMs),
): Promise<Value> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await operation()
    } catch (error) {
      // Only a busy answer may pass; every other answer, and the last busy one, is the caller's.
      if (retry >= retries || !BUSY_CODES.has(systemErrorCode(error)))
        throw error
      await pause(retryDelayMs * (retry + 1))
    }
  }
}
