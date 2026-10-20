import { unlink } from 'node:fs/promises'

import { claimStorageLockTakeover } from './claimStorageLockTakeover'
import { isStaleStorageLock } from './isStaleStorageLock'
import { readProcessStart, type ProcessStartReader } from './readProcessStart'
import type { StorageOwnerIdentity } from './readRecordedOwner'

/**
 * Removes a storage lock whose writer is gone from this machine, so that {@link withStorageLock} can acquire the path again; called when the lock file already exists.
 * Two windows that meet the same stale lock must not both remove "the stale lock": the second would remove the lock the first has just taken, and both would write. The removal therefore runs under an exclusive claim ({@link claimStorageLockTakeover}), and the lock is judged again while the claim is held.
 * @param lockPath - The `writer.lock` file that is present.
 * @param identity - The machine and the boot of this process, by which the lock's owner is judged ({@link isStaleStorageLock}).
 * @param readStart - Reads the start of the process that has the owner's id now; {@link readProcessStart} unless a test names its own. The two looks share one cache, which keeps a start that confirms the owner and a read that found no start ({@link ProcessStartInputs} `keepsUnreadable`): both count the owner as running. A kept answer can therefore only keep an owner running, also one whose process id went to another process since it was read (the safe direction: the lock stays), and never calls a lock stale.
 * @param holderStarts - That cache: the starts read so far, by process id. A new one for this call unless the caller keeps one for all its tries of one write ({@link withStorageLock} hands on the one of the Cursor catalog's retries, {@link withCatalogLock}), so that a live holder that keeps the lock through them, also one whose start cannot be read, is read once.
 * @returns
 * - `true` when this caller held the claim: a lock that was still stale is removed, so acquiring the path may succeed now
 * - `false` when the lock is not stale, or another window is taking it over right now; the lock stays
 * @example
 * await removeStaleStorageLock('/storage/learning/writer.lock', await currentStorageOwner()) // => true after the editor that wrote the lock was killed
 */
export async function removeStaleStorageLock(
  lockPath: string,
  identity: StorageOwnerIdentity,
  readStart: ProcessStartReader = readProcessStart,
  holderStarts = new Map<number, Promise<string | undefined>>(),
): Promise<boolean> {
  // An owner whose start cannot be read counts as running at every look, so its failed read is kept like a start that confirms it.
  const readForBothLooks: ProcessStartReader = (pid, inputs) =>
    readStart(pid, { ...inputs, cache: holderStarts, keepsUnreadable: true })
  // The lock of a running or foreign writer needs no claim.
  if (!(await isStaleStorageLock(lockPath, identity, readForBothLooks)))
    return false
  const claim = await claimStorageLockTakeover(lockPath, identity, readStart)
  if (!claim) return false
  try {
    // Another window may have taken the lock over since the look above; only a lock that is still stale is removed.
    if (await isStaleStorageLock(lockPath, identity, readForBothLooks))
      await unlink(lockPath).catch(() => undefined)
    return true
  } finally {
    await claim.release()
  }
}
