import {
  DEVIN_SETUP_LOCK_RETRY_DELAY_MS,
  DEVIN_SETUP_LOCK_WAIT_ATTEMPTS,
} from '../constants'
import { DEVIN_SETUP_LOCK_HELD_SENTENCE } from '../devinWindowSentences'

import {
  retryWhileStorageLockHeld,
  type StorageLockWait,
} from './retryWhileStorageLockHeld'
import { StorageLockHeldError } from './storageLockHeldError'
import { withStorageLock } from './withStorageLock'

/** The wait of a Devin Desktop setup or removal for the setup lock of another window: about ten seconds. */
const DEVIN_SETUP_LOCK_WAIT: StorageLockWait = {
  attempts: DEVIN_SETUP_LOCK_WAIT_ATTEMPTS,
  delayMs: DEVIN_SETUP_LOCK_RETRY_DELAY_MS,
}

/**
 * Runs one Devin Desktop setup or removal alone across every window of the user: it waits a bounded time for a setup lock that another extension host process holds ({@link withStorageLock} queues only inside one process and refuses at once otherwise), then refuses with one fixed sentence; called by the Devin Desktop setup and removal of {@link activate}.
 * Only the taking of the lock is waited for: the operation runs once, and a held-lock refusal of a lock it takes itself reaches the caller as it is.
 * @param lockDirectory - The `devin-setup` folder of Codebook's global storage.
 * @param operation - The setup or removal steps.
 * @param wait - Attempts and pause; about ten seconds when left out.
 * @returns What the operation returns.
 * @throws An error with {@link DEVIN_SETUP_LOCK_HELD_SENTENCE} when the lock stays held; anything the operation or the lock throws otherwise.
 * @example
 * await withDevinSetupLock('/storage/devin-setup', () => removeDevinSetupLocked())
 */
export async function withDevinSetupLock<Value>(
  lockDirectory: string,
  operation: () => Promise<Value>,
  wait: StorageLockWait = DEVIN_SETUP_LOCK_WAIT,
): Promise<Value> {
  // The operation's own result, kept apart from the lock so that the retry reruns the taking of the lock only.
  let resolveOperation!: (value: Value) => void
  let rejectOperation!: (reason: unknown) => void
  const settled = new Promise<Value>((resolve, reject) => {
    resolveOperation = resolve
    rejectOperation = reject
  })
  // Read by the caller below; this keeps a rejection from counting as unhandled while the lock is released.
  settled.catch(() => {})
  let didRun = false
  try {
    await retryWhileStorageLockHeld(
      () =>
        withStorageLock(lockDirectory, async () => {
          didRun = true
          await operation().then(resolveOperation, rejectOperation)
        }),
      wait,
    )
  } catch (error) {
    // The lock was never taken: the wait ran out.
    if (!didRun && error instanceof StorageLockHeldError)
      throw new Error(DEVIN_SETUP_LOCK_HELD_SENTENCE)
    throw error
  }
  return settled
}
