import { setTimeout as delay } from 'node:timers/promises'

import {
  CURSOR_SKILL_RECONNECT_ATTEMPTS,
  CURSOR_SKILL_RECONNECT_RETRY_DELAY_MS,
} from '../constants'

import { StorageLockHeldError } from './storageLockHeldError'

/** How long {@link retryWhileStorageLockHeld} waits: how many attempts it makes and the pause between them before the random share. */
export type StorageLockWait = { attempts: number; delayMs: number }

/**
 * Runs a storage write again while another window holds its lock, with the attempts and the pause of the Cursor skill's reconnect plus a random share of it, so that windows opened together do not retry in step; called by the Devin Desktop activation refresh.
 * @param operation - The write; it is run again from its start after each held-lock refusal.
 * @param wait - The attempts and the pause; the Cursor skill's reconnect when left out, and the Devin Desktop setup lock's longer wait for {@link withDevinSetupLock}.
 * @returns What the write returns once it ran.
 * @throws The write's error at once when it is no {@link StorageLockHeldError}, and the last refusal after `wait.attempts` attempts.
 * @example
 * await retryWhileStorageLockHeld(() => refreshManagedDevinMcpEntry(storageRoot, entry))
 */
export async function retryWhileStorageLockHeld<Value>(
  operation: () => Promise<Value>,
  wait: StorageLockWait = {
    attempts: CURSOR_SKILL_RECONNECT_ATTEMPTS,
    delayMs: CURSOR_SKILL_RECONNECT_RETRY_DELAY_MS,
  },
): Promise<Value> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      // Only a held lock is waited for; any other failure, and the last refusal, is the caller's.
      if (!(error instanceof StorageLockHeldError) || attempt >= wait.attempts)
        throw error
      await delay(wait.delayMs * (1 + Math.random()))
    }
  }
}
