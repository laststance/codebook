import {
  DEVIN_SETUP_LOCK_ACQUIRE_BUDGET_MS,
  DEVIN_SETUP_LOCK_RELEASE_MS,
  DEVIN_SETUP_LOCK_RETRY_DELAY_MS,
  DEVIN_SETUP_LOCK_WAIT_ATTEMPTS,
} from '../constants'
import {
  DEVIN_SETUP_LOCK_HELD_SENTENCE,
  DEVIN_SETUP_LOCK_UNANSWERED_AFTER_HELD_SENTENCE,
  DEVIN_SETUP_LOCK_UNANSWERED_SENTENCE,
} from '../devinWindowSentences'

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

/** The last taking of the setup lock this process started, settled or not, by lock folder as the caller names it; the next taking of that folder waits for it ({@link afterEarlierTaking}). */
const lastTakings = new Map<string, Promise<void>>()

/**
 * Starts one taking of the setup lock only once this process's taking before it of the same folder settled, so that storage that stops answering keeps one taking waiting on it, not one more for each try of a setup or removal; called by {@link withDevinSetupLock} for each of its attempts.
 * Why: a taking cut by the acquisition budget goes on ({@link withStorageLock} creates the folder and reads its real path before its own queue), and each such wait holds one of the four threads of Node's file pool, which every file read of the window shares. A taking waits for the whole earlier one, its release included, as {@link withStorageLock}'s queue would make it wait all the same.
 * The folder is keyed as the caller names it: reading its real path is file work too, and the window always names the same folder.
 * @param lockDirectory - The `devin-setup` folder.
 * @param taking - The taking; called once the earlier one settled, whatever it answered.
 * @returns What `taking` returns.
 * @throws What `taking` throws.
 * @example
 * await afterEarlierTaking('/storage/devin-setup', () => withStorageLock('/storage/devin-setup', steps)) // starts once the earlier taking of that folder settled
 */
function afterEarlierTaking<Value>(
  lockDirectory: string,
  taking: () => Promise<Value>,
): Promise<Value> {
  const current = (lastTakings.get(lockDirectory) ?? Promise.resolve()).then(
    taking,
  )
  const ended = current.then(
    () => undefined,
    () => undefined,
  )
  lastTakings.set(lockDirectory, ended)
  // The folder's entry goes with its last taking, so a folder no longer taken keeps nothing.
  void ended.then(() => {
    if (lastTakings.get(lockDirectory) === ended)
      lastTakings.delete(lockDirectory)
  })
  return current
}

/**
 * Says why a Devin Desktop setup or removal did not get the setup lock within {@link DEVIN_SETUP_LOCK_ACQUIRE_BUDGET_MS}, from what its takings saw; called by {@link withDevinSetupLock} at that bound.
 * Why: a held-lock refusal tells who held the lock at one moment, so another window is named as changing the setup only while such a refusal is the last answer; a taking still under way after one means that window may have released the lock while storage did not answer.
 * @param wasRefusedByHeldLock - Whether another window's lock refused one of the takings.
 * @param isTakingUnderWay - Whether a taking was under way at the bound (waiting on storage or on this process's earlier taking), rather than the retry pausing after a refusal.
 * @returns
 * - {@link DEVIN_SETUP_LOCK_UNANSWERED_SENTENCE} when no held-lock refusal came
 * - {@link DEVIN_SETUP_LOCK_HELD_SENTENCE} when the last taking was refused by another window's lock
 * - {@link DEVIN_SETUP_LOCK_UNANSWERED_AFTER_HELD_SENTENCE} when a taking after such a refusal had no answer yet
 * @example
 * untakenLockSentence(false, true) // => 'Codebook could not take its Devin Desktop setup lock because storage does not answer …'
 * untakenLockSentence(true, false) // => 'Another Codebook window is changing the Devin Desktop setup. Try again in a moment.'
 * untakenLockSentence(true, true) // => 'Another Codebook window was changing the Devin Desktop setup, and storage has not answered since …'
 */
function untakenLockSentence(
  wasRefusedByHeldLock: boolean,
  isTakingUnderWay: boolean,
): string {
  // No other window's lock was seen: storage, or this window's own earlier work, did not answer.
  if (!wasRefusedByHeldLock) return DEVIN_SETUP_LOCK_UNANSWERED_SENTENCE
  return isTakingUnderWay
    ? DEVIN_SETUP_LOCK_UNANSWERED_AFTER_HELD_SENTENCE
    : DEVIN_SETUP_LOCK_HELD_SENTENCE
}

/** What {@link withDevinSetupLock} tells its caller about the setup lock besides the operation's result. */
export type DevinSetupLockReports = {
  /** Called once when the lock's release has not ended {@link DEVIN_SETUP_LOCK_RELEASE_MS} after the operation settled: the result is answered then, and the release goes on. */
  onReleaseStalled?: () => void
}

/**
 * Runs one Devin Desktop setup or removal alone across every window of the user: it waits a bounded time for a setup lock that another extension host process holds ({@link withStorageLock} queues only inside one process and refuses at once otherwise), then refuses with one fixed sentence, with another when storage never handed the lock over and no other window's lock was seen, and with a third when a taking after another window's refusal had no answer ({@link untakenLockSentence}); called by the Devin Desktop setup and removal of {@link activate}.
 * Only the taking of the lock is retried: the operation runs once, and a held-lock refusal of a lock it takes itself reaches the caller as it is. Each taking starts only once this process's earlier taking of the folder settled ({@link afterEarlierTaking}), so a setup run again after a taking that storage did not answer waits for that taking instead of starting another.
 * Each wait has its own timer, so storage that stops answering never holds the caller: the taking of the lock, from the call, at most {@link DEVIN_SETUP_LOCK_ACQUIRE_BUDGET_MS} (a lock taken later runs nothing and is released at once); the operation as long as it needs; the release, from the operation's end, at most {@link DEVIN_SETUP_LOCK_RELEASE_MS} (it goes on afterwards, and this process's next hold of the lock waits for it in {@link withStorageLock}'s queue).
 * @param lockDirectory - The `devin-setup` folder of Codebook's global storage.
 * @param operation - The setup or removal steps.
 * @param wait - Attempts and pause; about ten seconds when left out.
 * @param reports - `onReleaseStalled`, told when the release outlasts its bound.
 * @returns What the operation returns, once the lock is released or its release outlasted its bound.
 * @throws
 * - An error with {@link DEVIN_SETUP_LOCK_HELD_SENTENCE} when the lock stays held, or is not taken within {@link DEVIN_SETUP_LOCK_ACQUIRE_BUDGET_MS} while the retry pauses after another window's lock refused it
 * - An error with {@link DEVIN_SETUP_LOCK_UNANSWERED_AFTER_HELD_SENTENCE} when the lock is not taken within {@link DEVIN_SETUP_LOCK_ACQUIRE_BUDGET_MS} and a taking after such a refusal has no answer yet
 * - An error with {@link DEVIN_SETUP_LOCK_UNANSWERED_SENTENCE} when the lock is not taken within {@link DEVIN_SETUP_LOCK_ACQUIRE_BUDGET_MS} and no held-lock refusal came: storage did not answer, or this process's own earlier taking or hold has not ended
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
  let wasRefusedByHeldLock = false
  // Whether a taking runs now (waiting on storage or on this process's earlier taking), rather than the retry pausing after a refusal.
  let isTakingUnderWay = false
  const locking = retryWhileStorageLockHeld(() => {
    isTakingUnderWay = true
    return afterEarlierTaking(lockDirectory, () => {
      // A wait the caller gave up on, also while it waited for an earlier taking, takes no further attempt: this is no held-lock refusal, so the retry ends.
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
    })
      .catch((error: unknown) => {
        // Another window's lock refused this taking: a wait that runs out later names that window.
        if (error instanceof StorageLockHeldError) wasRefusedByHeldLock = true
        throw error
      })
      .finally(() => {
        isTakingUnderWay = false
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
  // Storage that did not hand the lock over within the budget names another window only after that window's lock refused a taking, and as changing the setup only while that refusal is the last answer; a lock taken at the very moment of the bound runs.
  if (!isAcquiredInTime && !didRun) {
    isAbandoned = true
    throw new Error(untakenLockSentence(wasRefusedByHeldLock, isTakingUnderWay))
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
