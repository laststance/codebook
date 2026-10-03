import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from '../constants'

import { isStaleStorageLock } from './isStaleStorageLock'
import { systemErrorCode } from './systemErrorCode'

/** What a rename onto the claim directory answers while another claim is inside: `ENOTEMPTY` or `EEXIST`, and `EPERM` or `EACCES` where a directory cannot be replaced at all. */
const OCCUPIED_CLAIM_CODES = ['ENOTEMPTY', 'EEXIST', 'EPERM', 'EACCES']

/** Removes the claims of windows that were killed in the middle of a takeover, each by its own name; a claim made meanwhile has another name and stays. */
async function removeStaleClaims(claimDirectory: string): Promise<void> {
  for (const leftover of await readdir(claimDirectory).catch(() => [])) {
    const leftoverPath = join(claimDirectory, leftover)
    if (await isStaleStorageLock(leftoverPath))
      await unlink(leftoverPath).catch(() => undefined)
  }
}

/**
 * Claims the exclusive right to remove one stale storage lock, so that windows that meet the same stale lock take it over one after another; called by {@link removeStaleStorageLock}.
 * The claim is the directory `<lock>.takeover` with one uniquely named owner file. It is prepared aside and renamed into place: the rename succeeds only while no other claim is inside, and puts the directory and its owner there in one step. A claim left by a window that was killed in the middle of a takeover is removed by its unique name, which can never remove a later claim, so such a leftover does not keep the stale lock in place.
 * @param lockPath - The `writer.lock` file to take over.
 * @returns
 * - The function that releases the claim, when this caller holds it
 * - `undefined` while another running window holds the claim
 * @throws What preparing the claim throws for another reason than an occupied claim directory, for example a storage directory that cannot be written.
 * @example
 * const releaseClaim = await claimStorageLockTakeover('/storage/learning/writer.lock')
 * // => holds /storage/learning/writer.lock.takeover/<uuid> until `await releaseClaim?.()`
 */
export async function claimStorageLockTakeover(
  lockPath: string,
): Promise<(() => Promise<void>) | undefined> {
  const claimDirectory = `${lockPath}.takeover`,
    claimName = randomUUID(),
    preparedDirectory = `${claimDirectory}-${claimName}`
  await mkdir(preparedDirectory, { mode: PRIVATE_DIRECTORY_MODE })
  try {
    await writeFile(
      join(preparedDirectory, claimName),
      JSON.stringify({ pid: process.pid, hostname: hostname() }),
      { mode: PRIVATE_FILE_MODE },
    )
    await removeStaleClaims(claimDirectory)
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
