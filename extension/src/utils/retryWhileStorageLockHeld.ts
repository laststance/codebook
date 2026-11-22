import { setTimeout as delay } from 'node:timers/promises'

import {
  CURSOR_SKILL_RECONNECT_ATTEMPTS,
  CURSOR_SKILL_RECONNECT_RETRY_DELAY_MS,
} from '../constants'

import { StorageLockHeldError } from './storageLockHeldError'

/**
 * Runs a storage write again while another window holds its lock, with the attempts and the pause of the Cursor skill's reconnect plus a random share of it, so that windows opened together do not retry in step; called by the Devin Desktop activation refresh.
 * @param operation - The write; it is run again from its start after each held-lock refusal.
 * @returns What the write returns once it ran.
 * @throws The write's error at once when it is no {@link StorageLockHeldError}, and the last refusal after {@link CURSOR_SKILL_RECONNECT_ATTEMPTS} attempts.
 * @example
 * await retryWhileStorageLockHeld(() => refreshManagedDevinMcpEntry(storageRoot, entry))
 */
export async function retryWhileStorageLockHeld<Value>(
  operation: () => Promise<Value>,
): Promise<Value> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      // Only a held lock is waited for; any other failure, and the last refusal, is the caller's.
      if (
        !(error instanceof StorageLockHeldError) ||
        attempt >= CURSOR_SKILL_RECONNECT_ATTEMPTS
      )
        throw error
      await delay(CURSOR_SKILL_RECONNECT_RETRY_DELAY_MS * (1 + Math.random()))
    }
  }
}
