import { readdir, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { isFolderOfItsOwn } from './isFolderOfItsOwn'
import { isLeftEmpty } from './isLeftEmpty'
import { isStaleStorageLock } from './isStaleStorageLock'
import { listPlacedClaims } from './listPlacedClaims'
import { readProcessStart, type ProcessStartReader } from './readProcessStart'
import type { StorageOwnerIdentity } from './readRecordedOwner'
import { removeWithoutFollowing } from './removeWithoutFollowing'

/** How one sweep judges every leftover it finds: by this process's identity, and with one reader of process starts that keeps what the sweep has read. */
type LeftoverJudgement = {
  identity: StorageOwnerIdentity
  readStart: ProcessStartReader
}

/** Removes one owner file, a placed claim or a prepared lock, when its owner is gone ({@link isStaleStorageLock}); a file that cannot be removed stays for the next sweep. @example await removeStaleOwnerFile('/storage/learning/writer.lock.pending-4f2c', judgement) */
async function removeStaleOwnerFile(
  path: string,
  { identity, readStart }: LeftoverJudgement,
): Promise<void> {
  if (await isStaleStorageLock(path, identity, readStart))
    await unlink(path).catch(() => undefined)
}

/**
 * Removes one prepared claim folder when the owner file inside it, named like the claim, is stale, or when the folder never got one and stayed empty ({@link isLeftEmpty}); called by {@link removeStalePreparations} for each `<lock>.takeover-<name>` beside the lock.
 * The prepared path is looked at first: an owner file is read only below a real directory that is its parent's own entry ({@link isFolderOfItsOwn}). Beside a Wiki update's marker a cloned repository decides what stands at such a name, and the read that refuses a link guards only the last part of a path, so a link to a folder there would have a file of the learner opened and the link judged by it. A link, a file or a folder that leads elsewhere is no prepared claim: it is not read and not removed here, and the marker's claim removes it by its age and its own name ({@link claimWikiUpdateMarker}).
 * The folder is removed by Codebook's own walk ({@link removeWithoutFollowing}), which never lists below a link.
 * @param path - `<lock>.takeover-<name>`.
 * @param claimName - `<name>`, as the owner file inside the folder is called.
 * @param judgement - The identity of this process and the reader of process starts.
 * @returns Nothing; a folder that cannot be removed stays for the next sweep.
 * @example
 * await removeStalePreparedClaim('/storage/learning/writer.lock.takeover-4f2c', '4f2c', judgement)
 */
async function removeStalePreparedClaim(
  path: string,
  claimName: string,
  { identity, readStart }: LeftoverJudgement,
): Promise<void> {
  // Nothing is read below a path that is no folder of its parent's own.
  if (!(await isFolderOfItsOwn(path).catch(() => false))) return
  if (
    (await isStaleStorageLock(join(path, claimName), identity, readStart)) ||
    (await isLeftEmpty(path, 'directory'))
  )
    await removeWithoutFollowing(path).catch(() => undefined)
}

/** Removes the stale claims inside the claim directory `<lock>.takeover`, one owner file each; a link or a file at that path is no claim directory and is removed by its own name, never listed ({@link listPlacedClaims}). @example await removeStalePlacedClaims('/storage/learning/writer.lock.takeover', judgement) */
async function removeStalePlacedClaims(
  claimDirectory: string,
  judgement: LeftoverJudgement,
): Promise<void> {
  for (const claimName of await listPlacedClaims(claimDirectory))
    await removeStaleOwnerFile(join(claimDirectory, claimName), judgement)
}

/** Removes the stale siblings of the lock that never got their final name: prepared claims `<lock>.takeover-<name>` and prepared locks `<lock>.pending-<name>`. @example await removeStalePreparations('/storage/learning/writer.lock', judgement) */
async function removeStalePreparations(
  lockPath: string,
  judgement: LeftoverJudgement,
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
        judgement,
      )
    else if (name.startsWith(preparedLockPrefix))
      await removeStaleOwnerFile(path, judgement)
  }
}

/**
 * Removes what windows that were killed in the middle of taking a storage lock left beside it, so that such a leftover neither keeps a stale lock in place nor stays in the storage for good; called by {@link claimStorageLockTakeover} before it places its own claim (for a storage lock and for a Wiki update's marker), and by {@link withStorageLock} while it holds the lock, at this process's first hold of a storage directory and at no later hold: an acquisition that met a stale lock in the way has swept through its takeover claim already.
 * Three kinds are removed, each by its own unique name, which can never remove what a running window made meanwhile:
 * a claim inside `<lock>.takeover` whose owner is gone, also one whose process id another process has now ({@link isRecordedOwnerGone}); a claim prepared as `<lock>.takeover-<name>` and never renamed into place, whose owner file is stale or which stayed empty; and a lock prepared as `<lock>.pending-<name>` and never linked, judged the same way ({@link placeStorageLock}).
 * @param lockPath - The `writer.lock` file the leftovers belong to.
 * @param identity - The machine and the boot of this process, by which each leftover's owner is judged ({@link isStaleStorageLock}).
 * @param readStart - Reads the start of the process that has a leftover's process id now; {@link readProcessStart} unless a test names its own. This call adds one cache of its own to it, so several leftovers of one running window cost one read; a kept start never calls an owner gone.
 * @returns After every stale leftover that could be removed is gone; one that cannot be removed stays and is tried again at the next sweep: the next takeover claim on this lock by any window, or the first hold of the directory by a process that has not swept it yet.
 * @example
 * await removeStaleStorageClaims('/storage/learning/writer.lock', await currentStorageOwner())
 * // removes /storage/learning/writer.lock.takeover-4f2c… of a window that was killed before its rename
 */
export async function removeStaleStorageClaims(
  lockPath: string,
  identity: StorageOwnerIdentity,
  readStart: ProcessStartReader = readProcessStart,
): Promise<void> {
  const cache = new Map<number, Promise<string | undefined>>()
  const judgement: LeftoverJudgement = {
    identity,
    readStart: (pid, inputs) => readStart(pid, { ...inputs, cache }),
  }
  await removeStalePlacedClaims(`${lockPath}.takeover`, judgement)
  await removeStalePreparations(lockPath, judgement)
}
