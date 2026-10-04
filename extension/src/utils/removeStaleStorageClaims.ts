import { readdir, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { isLeftEmpty } from './isLeftEmpty'
import { isStaleStorageLock } from './isStaleStorageLock'
import type { StorageOwnerIdentity } from './readRecordedOwner'

/**
 * Removes what windows that were killed in the middle of taking a storage lock left beside it, so that such a leftover neither keeps a stale lock in place nor stays in the storage for good; called by {@link claimStorageLockTakeover} before it places its own claim, and by {@link withStorageLock} each time it holds the lock.
 * Three kinds are removed, each by its own unique name, which can never remove what a running window made meanwhile:
 * a claim inside `<lock>.takeover` whose owner is gone; a claim prepared as `<lock>.takeover-<name>` and never renamed into place, whose owner file is stale or which stayed empty; and a lock prepared as `<lock>.pending-<name>` and never linked, judged the same way ({@link placeStorageLock}).
 * @param lockPath - The `writer.lock` file the leftovers belong to.
 * @param identity - The machine and the boot of this process, by which each leftover's owner is judged ({@link isStaleStorageLock}).
 * @returns After every stale leftover that could be removed is gone; one that cannot be removed stays and is tried again by the next writer.
 * @example
 * await removeStaleStorageClaims('/storage/learning/writer.lock', await currentStorageOwner())
 * // removes /storage/learning/writer.lock.takeover-4f2c… of a window that was killed before its rename
 */
export async function removeStaleStorageClaims(
  lockPath: string,
  identity: StorageOwnerIdentity,
): Promise<void> {
  const storageDirectory = dirname(lockPath),
    claimDirectory = `${lockPath}.takeover`,
    preparedClaimPrefix = `${basename(claimDirectory)}-`,
    preparedLockPrefix = `${basename(lockPath)}.pending-`
  // Placed claims: one owner file each inside the claim directory.
  for (const claimName of await readdir(claimDirectory).catch(() => [])) {
    const claimPath = join(claimDirectory, claimName)
    if (await isStaleStorageLock(claimPath, identity))
      await unlink(claimPath).catch(() => undefined)
  }
  // Prepared claims and prepared locks: siblings of the lock that never got their final name.
  for (const name of await readdir(storageDirectory).catch(() => [])) {
    const path = join(storageDirectory, name)
    if (name.startsWith(preparedClaimPrefix)) {
      // A prepared claim holds one owner file named like the claim; a folder that never got one is judged by its emptiness.
      const ownerPath = join(path, name.slice(preparedClaimPrefix.length))
      if (
        (await isStaleStorageLock(ownerPath, identity)) ||
        (await isLeftEmpty(path, 'directory'))
      )
        await rm(path, { recursive: true, force: true }).catch(() => undefined)
    } else if (
      name.startsWith(preparedLockPrefix) &&
      (await isStaleStorageLock(path, identity))
    )
      await unlink(path).catch(() => undefined)
  }
}
