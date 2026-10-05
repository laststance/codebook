import { readdir, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { isLeftEmpty } from './isLeftEmpty'
import { isStaleStorageLock } from './isStaleStorageLock'
import type { StorageOwnerIdentity } from './readRecordedOwner'

/** Removes one owner file, a placed claim or a prepared lock, when its owner is gone ({@link isStaleStorageLock}); a file that cannot be removed stays for the next writer. @example await removeStaleOwnerFile('/storage/learning/writer.lock.pending-4f2c', identity) */
async function removeStaleOwnerFile(
  path: string,
  identity: StorageOwnerIdentity,
): Promise<void> {
  if (await isStaleStorageLock(path, identity))
    await unlink(path).catch(() => undefined)
}

/** Removes one prepared claim folder when the owner file inside it, named like the claim, is stale, or when the folder never got one and stayed empty ({@link isLeftEmpty}). @example await removeStalePreparedClaim('/storage/learning/writer.lock.takeover-4f2c', '4f2c', identity) */
async function removeStalePreparedClaim(
  path: string,
  claimName: string,
  identity: StorageOwnerIdentity,
): Promise<void> {
  if (
    (await isStaleStorageLock(join(path, claimName), identity)) ||
    (await isLeftEmpty(path, 'directory'))
  )
    await rm(path, { recursive: true, force: true }).catch(() => undefined)
}

/** Removes the stale claims inside the claim directory `<lock>.takeover`, one owner file each. @example await removeStalePlacedClaims('/storage/learning/writer.lock.takeover', identity) */
async function removeStalePlacedClaims(
  claimDirectory: string,
  identity: StorageOwnerIdentity,
): Promise<void> {
  for (const claimName of await readdir(claimDirectory).catch(() => []))
    await removeStaleOwnerFile(join(claimDirectory, claimName), identity)
}

/** Removes the stale siblings of the lock that never got their final name: prepared claims `<lock>.takeover-<name>` and prepared locks `<lock>.pending-<name>`. @example await removeStalePreparations('/storage/learning/writer.lock', identity) */
async function removeStalePreparations(
  lockPath: string,
  identity: StorageOwnerIdentity,
): Promise<void> {
  const storageDirectory = dirname(lockPath),
    preparedClaimPrefix = `${basename(lockPath)}.takeover-`,
    preparedLockPrefix = `${basename(lockPath)}.pending-`
  for (const name of await readdir(storageDirectory).catch(() => [])) {
    const path = join(storageDirectory, name)
    if (name.startsWith(preparedClaimPrefix))
      await removeStalePreparedClaim(
        path,
        name.slice(preparedClaimPrefix.length),
        identity,
      )
    else if (name.startsWith(preparedLockPrefix))
      await removeStaleOwnerFile(path, identity)
  }
}

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
  await removeStalePlacedClaims(`${lockPath}.takeover`, identity)
  await removeStalePreparations(lockPath, identity)
}
