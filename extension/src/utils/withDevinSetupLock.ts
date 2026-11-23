import {
  DEVIN_SETUP_LOCK_ACQUIRE_BUDGET_MS,
  DEVIN_SETUP_LOCK_RELEASE_MS,
  DEVIN_SETUP_LOCK_RETRY_DELAY_MS,
  DEVIN_SETUP_LOCK_WAIT_ATTEMPTS,
} from '../constants'
import { DEVIN_SETUP_LOCK_HELD_SENTENCE } from '../devinWindowSentences'

import {
  retryWhileStorageLockHeld,
  type StorageLockWait,
} from './retryWhileStorageLockHeld'
import { settledWithin } from './settledWithin'
import { StorageLockHeldError } from './storageLockHeldError'
import { withStorageLock } from './withStorageLock'

/** The wait of a Devin Desktop setup or removal for the setup lock of another window: about ten seconds. */
const DEVIN_SETUP_LOCK_WAIT: StorageLockWait = {
  attempts: DEVIN_SETUP_LOCK_WAIT_ATTEMPTS,
  delayMs: DEVIN_SETUP_LOCK_RETRY_DELAY_MS,
}

/** What {@link withDevinSetupLock} tells its caller about the setup lock besides the operation's result. */
export type DevinSetupLockReports = {
  /** Called once when the lock's release has not ended {@link DEVIN_SETUP_LOCK_RELEASE_MS} after the operation settled: the result is answered then, and the release goes on. */
  onReleaseStalled?: () => void
}

/**
 * Runs one Devin Desktop setup or removal alone across every window of the user: it waits a bounded time for a setup lock that another extension host process holds ({@link withStorageLock} queues only inside one process and refuses at once otherwise), then refuses with one fixed sentence; called by the Devin Desktop setup and removal of {@link activate}.
 * Only the taking of the lock is retried: the operation runs once, and a held-lock refusal of a lock it takes itself reaches the caller as it is.
 * Each wait has its own timer, so storage that stops answering never holds the caller: the taking of the lock, from the call, at most {@link DEVIN_SETUP_LOCK_ACQUIRE_BUDGET_MS} (a lock taken later runs nothing and is released at once); the operation as long as it needs; the release, from the operation's end, at most {@link DEVIN_SETUP_LOCK_RELEASE_MS} (it goes on afterwards, and this process's next hold of the lock waits for it in {@link withStorageLock}'s queue).
 * @param lockDirectory - The `devin-setup` folder of Codebook's global storage.
 * @param operation - The setup or removal steps.
 * @param wait - Attempts and pause; about ten seconds when left out.
 * @param reports - `onReleaseStalled`, told when the release outlasts its bound.
 * @returns What the operation returns, once the lock is released or its release outlasted its bound.
 * @throws
 * - An error with {@link DEVIN_SETUP_LOCK_HELD_SENTENCE} when the lock stays held, or is not taken within {@link DEVIN_SETUP_LOCK_ACQUIRE_BUDGET_MS}
 * - What the operation throws, also when it throws before it returns a promise, and what the lock throws otherwise
 * @example
 * await withDevinSetupLock('/storage/devin-setup', () => removeDevinSetupLocked())
 * await withDevinSetupLock('/storage/devin-setup', () => setUpDevinChatLocked(), undefined, { onReleaseStalled: () => diagnostics.info('…') })
 */
export async function withDevinSetupLock<Value>(
  lockDirectory: string,
  operation: () => Promise<Value>,
  wait: StorageLockWait = DEVIN_SETUP_LOCK_WAIT,
  { onReleaseStalled }: DevinSetupLockReports = {},
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
  let resolveAcquired!: () => void
  const acquired = new Promise<void>((resolve) => {
    resolveAcquired = resolve
  })
  let didRun = false
  let isAbandoned = false
  const locking = retryWhileStorageLockHeld(() => {
    // A wait the caller gave up on takes no further attempt: this is no held-lock refusal, so the retry ends.
    if (isAbandoned) throw new Error(DEVIN_SETUP_LOCK_HELD_SENTENCE)
    return withStorageLock(lockDirectory, async () => {
      // A lock taken after the caller gave up runs nothing and is released at once.
      if (isAbandoned) return
      didRun = true
      resolveAcquired()
      // A throw before the operation returns a promise becomes its rejection, so it settles the result and is never retried as a refusal of this lock.
      await Promise.resolve()
        .then(operation)
        .then(resolveOperation, rejectOperation)
    })
  }, wait)
  // Awaited below; a failure after the caller stopped waiting (an abandoned wait, a stalled release) is nobody's.
  locking.catch(() => {})
  const isAcquiredInTime = await settledWithin(
    Promise.race([acquired, locking]),
    DEVIN_SETUP_LOCK_ACQUIRE_BUDGET_MS,
  ).catch((error: unknown) => {
    // The lock was never taken: the wait for another window's lock ran out.
    if (!didRun && error instanceof StorageLockHeldError)
      throw new Error(DEVIN_SETUP_LOCK_HELD_SENTENCE)
    throw error
  })
  // Storage that did not hand the lock over within the budget gets the same answer; a lock taken at the very moment of the bound runs.
  if (!isAcquiredInTime && !didRun) {
    isAbandoned = true
    throw new Error(DEVIN_SETUP_LOCK_HELD_SENTENCE)
  }
  // The operation is never cut, and it always settles its result, also when it throws at its call; the release's own timer starts once it settled.
  await settled.then(
    () => undefined,
    () => undefined,
  )
  if (!(await settledWithin(locking, DEVIN_SETUP_LOCK_RELEASE_MS)))
    onReleaseStalled?.()
  return settled
}
