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

/** The claim files this process placed and could not remove when it gave its claim back; {@link removeUnreleasedClaims} removes them before this process's next claim. */
const unreleasedClaimPaths = new Set<string>()

/** A takeover claim this window holds: how to give it back, and how to ask whether it is still this window's. */
export type StorageLockTakeoverClaim = {
  /** Removes this window's claim file and the claim directory it emptied, and answers whether the claim file is gone. A file that could not be removed (one another program holds open on Windows) is remembered and removed before this process's next claim ({@link removeUnreleasedClaims}). */
  release: () => Promise<boolean>
  /** Says whether this window's claim file is still in place; `false` once another window removed it as left behind, after which that window may hold a claim of its own. */
  isStillHeld: () => Promise<boolean>
}

/** The modes a claim's directory and its owner file are created with; the process's file mode mask narrows both. @example const modes: StorageLockTakeoverClaimModes = { directoryMode: 0o700, fileMode: 0o600 } */
type StorageLockTakeoverClaimModes = { directoryMode: number; fileMode: number }

/**
 * Removes one claim file this process placed, and remembers it while it cannot be removed; called by `release` of {@link claimStorageLockTakeover} and by {@link removeUnreleasedClaims}.
 * @param claimPath - The uniquely named owner file of this process's claim, `<lock>.takeover/<uuid>`.
 * @returns `true` when the file is gone (removed now, or no longer there); `false` when its removal failed, after which the path is kept for the next attempt.
 * @example
 * await removeOwnClaimFile('/storage/learning/writer.lock.takeover/4f2c8a1e-…') // => true
 */
async function removeOwnClaimFile(claimPath: string): Promise<boolean> {
  const isGone = await unlink(claimPath).then(
    () => true,
    (error: unknown) => systemErrorCode(error) === 'ENOENT',
  )
  if (isGone) unreleasedClaimPaths.delete(claimPath)
  else unreleasedClaimPaths.add(claimPath)
  return isGone
}

/**
 * Removes the claims this process placed earlier and could not remove when it gave them back; called by {@link claimStorageLockTakeover} before it judges the claims of other windows.
 * Why: such a claim names this process, which runs, so no window ever calls its owner gone ({@link isRecordedOwnerGone}), and a claim whose owner can be judged here has no age rule. Left in place it would keep every later claim of this window and of every other window from being placed. Only this process knows that it gave the claim back.
 * @returns Nothing; a claim that still cannot be removed stays remembered.
 * @example
 * await removeUnreleasedClaims() // removes /storage/learning/writer.lock.takeover/4f2c8a1e-…, whose removal failed at the last release
 */
async function removeUnreleasedClaims(): Promise<void> {
  for (const claimPath of [...unreleasedClaimPaths])
    await removeOwnClaimFile(claimPath)
}

/**
 * Claims the exclusive right to remove one stale storage lock, so that windows that meet the same stale lock take it over one after another; called by {@link removeStaleStorageLock}, and by {@link claimWikiUpdateMarker} for the right to remove or replace a Wiki update's marker.
 * The claim is the directory `<lock>.takeover` with one uniquely named owner file. It is prepared aside and renamed into place: the rename succeeds only while no other claim is inside, and puts the directory and its owner there in one step. What a window that was killed in the middle of a takeover left, in the claim directory or prepared beside it, is removed first by its unique name ({@link removeStaleStorageClaims}), which can never remove a later claim, so such a leftover does not keep the stale lock in place. A claim this process itself gave back and could not remove is removed before that ({@link removeUnreleasedClaims}).
 * @param lockPath - The `writer.lock` file to take over.
 * @param identity - The machine and the boot of this process, by which the leftovers of earlier claims are judged.
 * @param readStart - Reads the start of the process that has a leftover claim's process id now, handed on to {@link removeStaleStorageClaims}; {@link readProcessStart} unless a test names its own.
 * @param record - What the claim file says about its owner; the process id with the whole identity, as the lock records it, unless the caller names less (a claim in a project folder must not name the computer).
 * @param modes - The modes of the claim directory and of its owner file: private to this user, as everything in the editor's private storage is, unless the caller names others (the claim of a marker in a project folder is created like the project's own files, so that another user of a shared folder can judge it and clear what a killed window left).
 * @returns
 * - The claim, when this caller holds it: `release` gives it back and answers whether its claim file is gone, and `isStillHeld` says whether this window's claim file is still in place
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
  modes: StorageLockTakeoverClaimModes = {
    directoryMode: PRIVATE_DIRECTORY_MODE,
    fileMode: PRIVATE_FILE_MODE,
  },
): Promise<StorageLockTakeoverClaim | undefined> {
  const claimDirectory = `${lockPath}.takeover`,
    claimName = randomUUID(),
    preparedDirectory = `${claimDirectory}-${claimName}`,
    claimPath = join(claimDirectory, claimName)
  await mkdir(preparedDirectory, { mode: modes.directoryMode })
  try {
    await writeFile(
      join(preparedDirectory, claimName),
      JSON.stringify(record),
      { mode: modes.fileMode },
    )
    await removeUnreleasedClaims()
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
    async release(): Promise<boolean> {
      const isReleased = await removeOwnClaimFile(claimPath)
      // Another window may have claimed the emptied directory already; then it stays.
      await rmdir(claimDirectory).catch(() => undefined)
      return isReleased
    },
    isStillHeld: () =>
      access(claimPath).then(
        () => true,
        () => false,
      ),
  }
}
