import { unlink } from 'node:fs/promises'

import { claimStorageLockTakeover } from './claimStorageLockTakeover'
import { isStaleStorageLock } from './isStaleStorageLock'
import type { StorageOwnerIdentity } from './readRecordedOwner'

/**
 * Removes a storage lock whose writer is gone from this machine, so that {@link withStorageLock} can acquire the path again; called when the lock file already exists.
 * Two windows that meet the same stale lock must not both remove "the stale lock": the second would remove the lock the first has just taken, and both would write. The removal therefore runs under an exclusive claim ({@link claimStorageLockTakeover}), and the lock is judged again while the claim is held.
 * @param lockPath - The `writer.lock` file that is present.
 * @param identity - The machine and the boot of this process, by which the lock's owner is judged ({@link isStaleStorageLock}).
 * @returns
 * - `true` when this caller held the claim: a lock that was still stale is removed, so acquiring the path may succeed now
 * - `false` when the lock is not stale, or another window is taking it over right now; the lock stays
 * @example
 * await removeStaleStorageLock('/storage/learning/writer.lock', await currentStorageOwner()) // => true after the editor that wrote the lock was killed
 */
export async function removeStaleStorageLock(
  lockPath: string,
  identity: StorageOwnerIdentity,
): Promise<boolean> {
  // The lock of a running or foreign writer needs no claim.
  if (!(await isStaleStorageLock(lockPath, identity))) return false
  const releaseClaim = await claimStorageLockTakeover(lockPath, identity)
  if (!releaseClaim) return false
  try {
    // Another window may have taken the lock over since the look above; only a lock that is still stale is removed.
    if (await isStaleStorageLock(lockPath, identity))
      await unlink(lockPath).catch(() => undefined)
    return true
  } finally {
    await releaseClaim()
  }
}
