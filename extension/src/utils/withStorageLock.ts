import type { Stats } from 'node:fs'
import { lstat, mkdir, realpath, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import {
  PRIVATE_DIRECTORY_MODE,
  STORAGE_LOCK_RELEASE_ATTEMPTS,
  STORAGE_LOCK_RELEASE_RETRY_DELAY_MS,
  STORAGE_LOCK_TAKE_BACK_ATTEMPTS,
  STORAGE_LOCK_TAKE_BACK_DELAY_MS,
  WIKI_METADATA_FILE_LIMIT_BYTES,
} from '../constants'

import { currentStorageOwner } from './currentStorageOwner'
import { describeKeptStorageLock } from './describeKeptStorageLock'
import { describeNoStorageFolder } from './describeNoStorageFolder'
import { describeRefusedStorageLock } from './describeRefusedStorageLock'
import { isSameStorageMachine } from './isSameStorageMachine'
import { placeStorageLock } from './placeStorageLock'
import {
  readRecordedOwner,
  type RecordedOwner,
  type StorageOwnerIdentity,
} from './readRecordedOwner'
import { removeStaleStorageClaims } from './removeStaleStorageClaims'
import { removeStaleStorageLock } from './removeStaleStorageLock'
import { StorageLockHeldError } from './storageLockHeldError'
import { systemErrorCode } from './systemErrorCode'

const pendingWriters = new Map<string, Promise<void>>()
/** The canonical storage directories whose leftovers this process has swept at a hold of its own ({@link withStorageLock}); a later hold of one of them does not list the directory again. */
const sweptDirectories = new Set<string>()
/** The lock files of this process whose release did not finish ({@link releaseOwnLock}: the owner could not be read, or the removal failed), by their canonical path: such a lock may still name this process, and this process's next hold of that directory takes it back ({@link takeBackOwnLeftover}). */
const unreleasedOwnLocks = new Set<string>()
/** The lock paths for which a take-back without a further write is planned and not yet run ({@link planTakeBackWithoutWrite}). */
const plannedTakeBacks = new Set<string>()
/** How many such take-backs each lock path has had since its release left the lock, so that a lock that stays unreadable is given up on after {@link STORAGE_LOCK_TAKE_BACK_ATTEMPTS} of them. */
const takeBacksMade = new Map<string, number>()

/** What a release of the storage lock found: `released` when the lock is gone (removed now, or already), `not-own` when the path holds a lock of another writer, and `kept` when the lock may still name this process because its owner could not be read or its removal failed. */
type LockRelease = 'released' | 'not-own' | 'kept'

/**
 * Says what an entry at the lock path is whose owner could not be read; called by {@link releaseLockOnce}.
 * Why: this process placed its lock with its owner written, as a regular file of a few hundred bytes, so an empty file (the lock of an earlier build, created and not yet written), a link, a folder and a file larger than any owner record are another writer's. A file with content may be this process's lock, read at a moment the system refused it (on Windows a scanner or an indexer can hold it open).
 * @param path - The `writer.lock` file.
 * @returns `released` when nothing is at the path; `kept` for a regular file with content within {@link WIKI_METADATA_FILE_LIMIT_BYTES} and for a path that cannot be inspected; `not-own` for any other entry.
 * @example
 * await releaseOfUnreadOwner('/storage/learning/writer.lock') // => 'not-own' for an empty lock file
 */
async function releaseOfUnreadOwner(path: string): Promise<LockRelease> {
  let entry: Stats
  try {
    entry = await lstat(path)
  } catch (error) {
    return systemErrorCode(error) === 'ENOENT' ? 'released' : 'kept'
  }
  return entry.isFile() &&
    entry.size > 0 &&
    entry.size <= WIKI_METADATA_FILE_LIMIT_BYTES
    ? 'kept'
    : 'not-own'
}

/**
 * Makes one attempt to remove the storage lock while it still names the process that took it; called by {@link releaseStorageLock} for each of its attempts.
 * @param path - The `writer.lock` file.
 * @param holder - The owner record this process placed.
 * @returns What the attempt found ({@link LockRelease}): `kept` here only for a lock whose owner could not be read.
 * @throws What removing this process's lock throws, except for a lock that is already gone: that one is `released`.
 * @example
 * await releaseLockOnce('/storage/learning/writer.lock', { pid: process.pid, hostname: 'workstation' }) // => 'released'
 */
async function releaseLockOnce(
  path: string,
  holder: RecordedOwner & StorageOwnerIdentity,
): Promise<LockRelease> {
  const owner = await readRecordedOwner(path)
  if (!owner) return releaseOfUnreadOwner(path)
  if (owner.pid !== holder.pid || !isSameStorageMachine(owner, holder))
    return 'not-own'
  try {
    await unlink(path)
  } catch (error) {
    if (systemErrorCode(error) !== 'ENOENT') throw error
  }
  return 'released'
}

/**
 * Removes the storage lock when it still names the process that took it; called by {@link releaseOwnLock} when a write has ended, and by {@link takeBackOwnLeftover} for a lock an earlier release left.
 * Only a lock that names this process is this call's to remove; one that names another writer, or an entry that cannot be this process's lock, is another window's and is left to it. A read or a removal that fails is made again, {@link STORAGE_LOCK_RELEASE_ATTEMPTS} times {@link STORAGE_LOCK_RELEASE_RETRY_DELAY_MS} apart, since on Windows a scanner or an indexer can hold the file for a moment (`EBUSY`, `EPERM`).
 * @param path - The `writer.lock` file.
 * @param holder - The owner record this process placed.
 * @returns `released` once the lock is gone, `not-own` for another writer's lock, and `kept` when the owner of the lock could still not be read at the last attempt.
 * @throws What removing this process's lock threw at the last attempt, for another reason than a lock that is already gone.
 * @example
 * await releaseStorageLock('/storage/learning/writer.lock', { pid: process.pid, hostname: 'workstation' }) // => 'released'
 */
async function releaseStorageLock(
  path: string,
  holder: RecordedOwner & StorageOwnerIdentity,
): Promise<LockRelease> {
  for (let attemptsLeft = STORAGE_LOCK_RELEASE_ATTEMPTS; ; attemptsLeft -= 1) {
    const isLastAttempt = attemptsLeft <= 1
    try {
      const release = await releaseLockOnce(path, holder)
      if (release !== 'kept' || isLastAttempt) return release
    } catch (error) {
      if (isLastAttempt) throw error
    }
    await delay(STORAGE_LOCK_RELEASE_RETRY_DELAY_MS)
  }
}

/**
 * Releases this process's lock when a write under it has ended, and notes a lock that may still name this process so that it is taken back; called by {@link releaseAfterWrite}.
 * @param path - The `writer.lock` file.
 * @param holder - The owner record this process placed.
 * @returns What the release found ({@link LockRelease}); `kept` when the lock may still name this process, so that {@link releaseAfterWrite} reports it like a failed release.
 * @throws What removing the lock threw ({@link releaseStorageLock}): the write was made, and {@link releaseAfterWrite} hands the failure on; the lock is noted all the same.
 * @example
 * await releaseOwnLock('/storage/learning/writer.lock', { pid: process.pid, hostname: 'workstation' }) // => 'released'
 */
async function releaseOwnLock(
  path: string,
  holder: RecordedOwner & StorageOwnerIdentity,
): Promise<LockRelease> {
  let release: LockRelease = 'kept'
  try {
    release = await releaseStorageLock(path, holder)
  } finally {
    // A lock that may still name this process is taken back by this process's next hold of the directory, and, without waiting for one, a few seconds later.
    if (release === 'kept') {
      unreleasedOwnLocks.add(path)
      planTakeBackWithoutWrite(path, holder)
    } else {
      unreleasedOwnLocks.delete(path)
      takeBacksMade.delete(path)
    }
  }
  return release
}

/**
 * Releases this process's lock after a write under it, without letting a failed release replace what the write did; called by {@link withStorageLock} in its `finally`.
 * The write was made when the release runs: its result (a recording's writer, a published catalog) or its own error is what the caller needs. A release that fails, and one that leaves the lock in place because its owner could not be read at any attempt ({@link describeKeptStorageLock}), is handed to `onReleaseFailure`, for a caller that names the lock in its answer (a study removal, {@link removalAfterLockFailure}); the lock is taken back all the same ({@link releaseOwnLock}).
 * @param path - The `writer.lock` file.
 * @param holder - The owner record this process placed.
 * @param onReleaseFailure - Told what removing the lock threw; a caller that does not ask never learns of it.
 * @example
 * await releaseAfterWrite('/storage/learning/writer.lock', holder, (error) => reportLock(error))
 */
async function releaseAfterWrite(
  path: string,
  holder: RecordedOwner & StorageOwnerIdentity,
  onReleaseFailure?: (error: unknown) => void,
): Promise<void> {
  try {
    // A release that kept the lock throws nothing, but it leaves a lock that blocks other windows: the caller is told as for a thrown failure.
    if ((await releaseOwnLock(path, holder)) === 'kept')
      onReleaseFailure?.(new Error(describeKeptStorageLock(path)))
  } catch (error) {
    onReleaseFailure?.(error)
  }
}

/**
 * Plans that this process takes back its own lock {@link STORAGE_LOCK_TAKE_BACK_DELAY_MS} from now, when its release left the lock in place, without waiting for this process's next hold of that folder; called by {@link releaseOwnLock}.
 * Why: the next hold may never come (the Cursor catalog is written a few times in a window's life), and until it comes, or this editor exits, every other window is refused by a lock that only this window can remove. A plan that fails plans the next, up to {@link STORAGE_LOCK_TAKE_BACK_ATTEMPTS} times; the timer does not keep the process alive.
 * @param path - The `writer.lock` file whose release left it in place.
 * @param holder - The owner record this process placed.
 * @example planTakeBackWithoutWrite('/storage/learning/writer.lock', holder)
 */
function planTakeBackWithoutWrite(
  path: string,
  holder: RecordedOwner & StorageOwnerIdentity,
): void {
  const made = takeBacksMade.get(path) ?? 0
  if (plannedTakeBacks.has(path) || made >= STORAGE_LOCK_TAKE_BACK_ATTEMPTS)
    return
  takeBacksMade.set(path, made + 1)
  plannedTakeBacks.add(path)
  setTimeout(() => {
    plannedTakeBacks.delete(path)
    void takeBackWithoutWrite(path, holder)
  }, STORAGE_LOCK_TAKE_BACK_DELAY_MS).unref()
}

/**
 * Takes back this process's own lock that a release left in place, in the queue of the folder's holds so that no hold of this process has the lock meanwhile; run by the timer {@link planTakeBackWithoutWrite} sets.
 * Plans the next try when the lock is still kept, and forgets the count once it is not.
 * @param path - The `writer.lock` file.
 * @param holder - The owner record this process placed.
 * @example await takeBackWithoutWrite('/storage/learning/writer.lock', holder)
 */
async function takeBackWithoutWrite(
  path: string,
  holder: RecordedOwner & StorageOwnerIdentity,
): Promise<void> {
  await runAfterHeldWrites(dirname(path), async () => {
    await takeBackOwnLeftover(path, holder)
  }).catch(() => undefined)
  if (unreleasedOwnLocks.has(path)) planTakeBackWithoutWrite(path, holder)
  else takeBacksMade.delete(path)
}

/**
 * Runs a step in the queue of this process's holds of one storage folder, after the holds before it have ended; called by {@link withStorageLock} for each hold and by {@link takeBackWithoutWrite} for a take-back.
 * @param canonical - The canonical storage directory, which names the queue.
 * @param step - The step to run once the holds before it have ended.
 * @returns What `step` returned.
 * @throws What `step` threw.
 * @example await runAfterHeldWrites('/storage/learning', async () => takeBackOwnLeftover(path, holder))
 */
async function runAfterHeldWrites<Value>(
  canonical: string,
  step: () => Promise<Value>,
): Promise<Value> {
  // Reserve shared process ownership before awaiting the prior writer; path aliases join the same queue.
  const pending = (pendingWriters.get(canonical) ?? Promise.resolve()).then(
    step,
  )
  const settled = pending.then(
    () => undefined,
    () => undefined,
  )
  pendingWriters.set(canonical, settled)
  try {
    return await pending
  } finally {
    if (pendingWriters.get(canonical) === settled)
      pendingWriters.delete(canonical)
  }
}

/**
 * Removes this process's own lock that its last release of the directory left, so that the lock can be placed again: by this process's next hold, when {@link withStorageLock} calls this with a write about to follow and finds the lock file already there, and by this process's own timer, when {@link takeBackWithoutWrite} calls this at the fire of the timer that {@link planTakeBackWithoutWrite} set, with no write in progress (via {@link runAfterHeldWrites}, so no hold of this process has the lock meanwhile). It touches only this process's own locks ({@link unreleasedOwnLocks}); a lock of another window is never taken back here.
 * Why: a lock that names this process is not stale while this process runs ({@link removeStaleStorageLock}), so every later write of this window would be refused until it closed. Only a path whose release this process could not finish is taken back, and only while the lock still names this process ({@link releaseStorageLock}): the holds of one directory in this process wait for each other, so no hold of this process holds that lock now.
 * A take-back that finds the lock still kept has spent the release's attempts, about half a second; a caller that asks for the lock again for one write keeps that answer for its later tries ({@link withCatalogLock}), so a leftover that stays unreadable costs one take-back per call, not one per try (Cycle 0047 row 199). The next call tries again.
 * @param path - The `writer.lock` file that is present.
 * @param holder - The owner record this process places.
 * @param keptTakeBacks - The lock paths whose take-back an earlier try of the caller's call found kept; a path in it is not tried again, and a take-back found kept now joins it. Left out, every hold tries.
 * @returns `true` when the lock was removed; `false` when this process left no lock there, when the lock names another writer by now, when it still cannot be read or removed, and when an earlier try of the same call found it so.
 * @example
 * await takeBackOwnLeftover('/storage/learning/writer.lock', { pid: process.pid, hostname: 'workstation' }) // => true after a release whose removal the system refused
 */
async function takeBackOwnLeftover(
  path: string,
  holder: RecordedOwner & StorageOwnerIdentity,
  keptTakeBacks?: Set<string>,
): Promise<boolean> {
  if (!unreleasedOwnLocks.has(path) || keptTakeBacks?.has(path)) return false
  const release = await releaseStorageLock(path, holder).catch(
    (): LockRelease => 'kept',
  )
  // A lock that is gone or names another writer is no longer this process's to take back; one still kept is not tried again by the same call.
  if (release !== 'kept') {
    unreleasedOwnLocks.delete(path)
    takeBacksMade.delete(path)
  } else keptTakeBacks?.add(path)
  return release === 'released'
}

/**
 * Makes the private storage folder when it is absent and refuses a path that holds no real folder, for {@link withStorageLock} before it places the lock: Codebook writes through no link, and it replaces nothing that stands at the path.
 * The folder's creation fails by itself where a file stands at the path (`EEXIST`) or a link that leads nowhere (`ENOENT`); the path is looked at all the same, so that both states get the sentence and not the system's text.
 * @param directory - The private storage directory.
 * @throws
 * - For a link, and for anything else that is no folder: "Learning storage is not a regular directory: <path>." with what stands there and what to do ({@link describeNoStorageFolder})
 * - What the creation threw, when the path holds a real folder or nothing after it (no right to create it, for example)
 * @example await makeStorageFolder('/storage/learning')
 */
async function makeStorageFolder(directory: string): Promise<void> {
  const refusedCreation: unknown = await mkdir(directory, {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  const standing = await lstat(directory).catch(() => undefined)
  if (standing && !standing.isDirectory())
    throw new Error(
      describeNoStorageFolder('Learning storage', directory, standing),
    )
  if (refusedCreation !== undefined) throw refusedCreation
}

/**
 * Queues this process's library/recorder writes and excludes other windows with the file `writer.lock` in the storage directory; called by every writer of private storage ({@link LearningLibrary}, {@link RecordingStore}, {@link RepositoryBookStore}, the Cursor skill and catalog).
 * The lock names its owner from the moment it exists ({@link placeStorageLock}). A lock that is present stays explicit, except one whose writer is gone from this machine, which is taken over by one window at a time ({@link removeStaleStorageLock}). What killed windows left beside the lock is removed by {@link removeStaleStorageClaims} on two paths: the holder sweeps at this process's first hold of the directory, and every takeover sweeps through its claim before it removes the stale lock ({@link claimStorageLockTakeover}). A later hold of this process sweeps nothing itself, so that an ordinary write does not list the whole storage directory, and a hold that took a stale lock over lists it once, for its claim. The release removes the lock only while it still names this process; whatever else is in its place by then belongs to another window and stays. A release whose read or removal of the lock fails tries again for about half a second ({@link releaseStorageLock}); a lock still left then is taken back {@link STORAGE_LOCK_TAKE_BACK_DELAY_MS} later without a further write ({@link planTakeBackWithoutWrite}), or at this process's next hold of the directory ({@link takeBackOwnLeftover}); until then other windows are refused by it.
 * @param directory - The private storage directory; it is created when absent.
 * @param operation - The write to run while the lock is held.
 * @param identity - The machine and the boot this process records in the lock and judges a present lock by; {@link currentStorageOwner} unless a test names its own.
 * @param holderStarts - The process starts a caller that asks for the lock again keeps for all its tries of one write, by process id ({@link withCatalogLock}), so that a present lock's live writer is read once for them, not at every try, also one whose start cannot be read; a kept answer only keeps that writer running ({@link removeStaleStorageLock}). A new one for each hold when left out.
 * @param keptTakeBacks - The lock paths whose take-back of this process's own leftover such a caller's earlier try found kept, which it keeps for all its tries of one write as it keeps `holderStarts` ({@link takeBackOwnLeftover}). Every hold tries the take-back when left out.
 * @param onReleaseFailure - Told what removing this process's own lock threw, when the release fails after `operation` ended; a caller that names the lock in its answer passes it (a study removal). Without it the failure is not reported: the write's result or error reaches the caller whole, and the lock is taken back ({@link takeBackWithoutWrite}).
 * @returns What `operation` returned, after the lock is released; also when the release fails (Cycle 0048 task 21).
 * @throws
 * - "Learning storage is not a regular directory: <path>. …" when the directory's path holds a link or something that is no folder ({@link makeStorageFolder}); nothing was written
 * - {@link StorageLockHeldError} "Learning storage is locked …", naming the lock file, with the `EEXIST` system error as `cause`, while another writer holds the lock or a lock stays that cannot be judged; nothing was written
 * - What `operation` throws; a release that fails is never thrown, it goes to `onReleaseFailure` ({@link releaseAfterWrite})
 * @example
 * await withStorageLock('/storage/learning', () => save())
 */
export async function withStorageLock<Value>(
  directory: string,
  operation: () => Promise<Value>,
  identity?: StorageOwnerIdentity,
  holderStarts?: Map<number, Promise<string | undefined>>,
  keptTakeBacks?: Set<string>,
  onReleaseFailure?: (error: unknown) => void,
): Promise<Value> {
  await makeStorageFolder(directory)
  const canonical = await realpath(directory),
    path = join(canonical, 'writer.lock')
  return runAfterHeldWrites(canonical, async () => {
    const holder = {
      pid: process.pid,
      ...(identity ?? (await currentStorageOwner())),
    }
    const acquire = (): Promise<void> => placeStorageLock(path, holder)
    await acquire()
      .catch(async (error) => {
        // This process's own lock that its last release left is taken back, and a lock left by a killed editor on this machine is taken over, once; a live or foreign one, one another window is taking over right now and one whose takeover fails stay explicit.
        if (
          error.code === 'EEXIST' &&
          ((await takeBackOwnLeftover(path, holder, keptTakeBacks)) ||
            (await removeStaleStorageLock(
              path,
              holder,
              undefined,
              holderStarts,
            ).catch(() => false)))
        )
          return acquire()
        throw error
      })
      .catch(async (error) => {
        // Only the lock's own refusal gets its type: a caller waits for it and for nothing else.
        if (error.code === 'EEXIST')
          throw new StorageLockHeldError(
            `Learning storage is locked by another writer or an interrupted session (lock file: ${path}). No data changed; retry after resolving the lock.${await describeRefusedStorageLock(path, unreleasedOwnLocks.has(path))}`,
            { cause: error },
          )
        throw error
      })
    try {
      // The lock is held: what a window that was killed while it prepared a lock or a takeover left beside it is nobody's and goes, swept at this process's first hold of the directory. A takeover has swept through its claim already.
      if (!sweptDirectories.has(canonical)) {
        sweptDirectories.add(canonical)
        await removeStaleStorageClaims(path, holder).catch(() => undefined)
      }
      return await operation()
    } finally {
      await releaseAfterWrite(path, holder, onReleaseFailure)
    }
  })
}
