import { randomUUID } from 'node:crypto'
import {
  access,
  mkdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'

import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from '../constants'

import { readProcessStart, type ProcessStartReader } from './readProcessStart'
import type { RecordedOwner, StorageOwnerIdentity } from './readRecordedOwner'
import { removeStaleStorageClaims } from './removeStaleStorageClaims'
import { systemErrorCode } from './systemErrorCode'

/** What a rename onto the claim directory answers while another claim is inside: `ENOTEMPTY` or `EEXIST`, and `EPERM` or `EACCES` where a directory cannot be replaced at all. */
const OCCUPIED_CLAIM_CODES = ['ENOTEMPTY', 'EEXIST', 'EPERM', 'EACCES']

/** A takeover claim this window holds: how to give it back, and how to ask whether it is still this window's. */
export type StorageLockTakeoverClaim = {
  /** Removes this window's claim file and the claim directory it emptied. */
  release: () => Promise<void>
  /** Says whether this window's claim file is still in place; `false` once another window removed it as left behind, after which that window may hold a claim of its own. */
  isStillHeld: () => Promise<boolean>
}

/**
 * Claims the exclusive right to remove one stale storage lock, so that windows that meet the same stale lock take it over one after another; called by {@link removeStaleStorageLock}, and by {@link claimWikiUpdateMarker} for the right to remove or replace a Wiki update's marker.
 * The claim is the directory `<lock>.takeover` with one uniquely named owner file. It is prepared aside and renamed into place: the rename succeeds only while no other claim is inside, and puts the directory and its owner there in one step. What a window that was killed in the middle of a takeover left, in the claim directory or prepared beside it, is removed first by its unique name ({@link removeStaleStorageClaims}), which can never remove a later claim, so such a leftover does not keep the stale lock in place.
 * @param lockPath - The `writer.lock` file to take over.
 * @param identity - The machine and the boot of this process, by which the leftovers of earlier claims are judged.
 * @param readStart - Reads the start of the process that has a leftover claim's process id now, handed on to {@link removeStaleStorageClaims}; {@link readProcessStart} unless a test names its own.
 * @param record - What the claim file says about its owner; the process id with the whole identity, as the lock records it, unless the caller names less (a claim in a project folder must not name the computer).
 * @returns
 * - The claim, when this caller holds it: `release` gives it back, and `isStillHeld` says whether this window's claim file is still in place
 * - `undefined` while another running window holds the claim
 * @throws What preparing the claim throws for another reason than an occupied claim directory, for example a storage directory that cannot be written.
 * @example
 * const claim = await claimStorageLockTakeover('/storage/learning/writer.lock', await currentStorageOwner())
 * // => holds /storage/learning/writer.lock.takeover/<uuid> until `await claim?.release()`
 */
export async function claimStorageLockTakeover(
  lockPath: string,
  identity: StorageOwnerIdentity,
  readStart: ProcessStartReader = readProcessStart,
  record: RecordedOwner = { pid: process.pid, ...identity },
): Promise<StorageLockTakeoverClaim | undefined> {
  const claimDirectory = `${lockPath}.takeover`,
    claimName = randomUUID(),
    preparedDirectory = `${claimDirectory}-${claimName}`,
    claimPath = join(claimDirectory, claimName)
  await mkdir(preparedDirectory, { mode: PRIVATE_DIRECTORY_MODE })
  try {
    await writeFile(
      join(preparedDirectory, claimName),
      JSON.stringify(record),
      { mode: PRIVATE_FILE_MODE },
    )
    await removeStaleStorageClaims(lockPath, identity, readStart)
    // An empty claim directory is nobody's; removing it lets the rename succeed where a directory cannot be replaced.
    await rmdir(claimDirectory).catch(() => undefined)
    await rename(preparedDirectory, claimDirectory)
  } catch (error) {
    await rm(preparedDirectory, { recursive: true, force: true })
    if (OCCUPIED_CLAIM_CODES.includes(systemErrorCode(error))) return undefined
    throw error
  }
  return {
    async release(): Promise<void> {
      await unlink(claimPath).catch(() => undefined)
      // Another window may have claimed the emptied directory already; then it stays.
      await rmdir(claimDirectory).catch(() => undefined)
    },
    isStillHeld: () =>
      access(claimPath).then(
        () => true,
        () => false,
      ),
  }
}
