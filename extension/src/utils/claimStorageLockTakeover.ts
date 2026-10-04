import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from '../constants'

import type { StorageOwnerIdentity } from './readRecordedOwner'
import { removeStaleStorageClaims } from './removeStaleStorageClaims'
import { systemErrorCode } from './systemErrorCode'

/** What a rename onto the claim directory answers while another claim is inside: `ENOTEMPTY` or `EEXIST`, and `EPERM` or `EACCES` where a directory cannot be replaced at all. */
const OCCUPIED_CLAIM_CODES = ['ENOTEMPTY', 'EEXIST', 'EPERM', 'EACCES']

/**
 * Claims the exclusive right to remove one stale storage lock, so that windows that meet the same stale lock take it over one after another; called by {@link removeStaleStorageLock}.
 * The claim is the directory `<lock>.takeover` with one uniquely named owner file. It is prepared aside and renamed into place: the rename succeeds only while no other claim is inside, and puts the directory and its owner there in one step. What a window that was killed in the middle of a takeover left, in the claim directory or prepared beside it, is removed first by its unique name ({@link removeStaleStorageClaims}), which can never remove a later claim, so such a leftover does not keep the stale lock in place.
 * @param lockPath - The `writer.lock` file to take over.
 * @param identity - The machine and the boot of this process; the claim records them with the process id, as the lock does.
 * @returns
 * - The function that releases the claim, when this caller holds it
 * - `undefined` while another running window holds the claim
 * @throws What preparing the claim throws for another reason than an occupied claim directory, for example a storage directory that cannot be written.
 * @example
 * const releaseClaim = await claimStorageLockTakeover('/storage/learning/writer.lock', await currentStorageOwner())
 * // => holds /storage/learning/writer.lock.takeover/<uuid> until `await releaseClaim?.()`
 */
export async function claimStorageLockTakeover(
  lockPath: string,
  identity: StorageOwnerIdentity,
): Promise<(() => Promise<void>) | undefined> {
  const claimDirectory = `${lockPath}.takeover`,
    claimName = randomUUID(),
    preparedDirectory = `${claimDirectory}-${claimName}`
  await mkdir(preparedDirectory, { mode: PRIVATE_DIRECTORY_MODE })
  try {
    await writeFile(
      join(preparedDirectory, claimName),
      JSON.stringify({ pid: process.pid, ...identity }),
      { mode: PRIVATE_FILE_MODE },
    )
    await removeStaleStorageClaims(lockPath, identity)
    // An empty claim directory is nobody's; removing it lets the rename succeed where a directory cannot be replaced.
    await rmdir(claimDirectory).catch(() => undefined)
    await rename(preparedDirectory, claimDirectory)
  } catch (error) {
    await rm(preparedDirectory, { recursive: true, force: true })
    if (OCCUPIED_CLAIM_CODES.includes(systemErrorCode(error))) return undefined
    throw error
  }
  return async (): Promise<void> => {
    await unlink(join(claimDirectory, claimName)).catch(() => undefined)
    // Another window may have claimed the emptied directory already; then it stays.
    await rmdir(claimDirectory).catch(() => undefined)
  }
}
