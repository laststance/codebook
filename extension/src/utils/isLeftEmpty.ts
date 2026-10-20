import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'

import { STORAGE_LOCK_UNWRITTEN_GRACE_MS } from '../constants'

import { PREPARED_LOCK_SUFFIX } from './preparedLockSuffix'
import { readFileSystemNowMs } from './readFileSystemNowMs'

/** Says whether an inspected entry is of the expected kind and holds nothing: a file of zero bytes, or a folder without an entry; a folder that cannot be listed may hold something. @example await holdsNothing('/storage/learning/writer.lock', await lstat('/storage/learning/writer.lock'), 'file') // => true for a 0-byte file */
async function holdsNothing(
  path: string,
  entry: Stats,
  kind: 'file' | 'directory',
): Promise<boolean> {
  if (kind === 'file') return entry.isFile() && entry.size === 0
  return (
    entry.isDirectory() &&
    (await readdir(path).then(
      (names) => names.length === 0,
      () => false,
    ))
  )
}

/**
 * Says whether a lock file or a prepared takeover claim was created and never filled, which is what a window leaves that is killed between creating and writing it; called by {@link isStaleStorageLock} for a file without an owner and by {@link removeStaleStorageClaims} for a claim folder without one.
 * A running window is in that state for an instant, so only an entry that has stayed empty for {@link STORAGE_LOCK_UNWRITTEN_GRACE_MS} counts, by this window's clock and by the clock of the file system that holds it: a network home stamps an entry by its own clock, and a window whose clock runs ahead of it would otherwise find another live window's lock, empty for the instant between its creation and its write, old in its first moment. The file system's clock is read ({@link readFileSystemNowMs}, by a probe file beside the lock) only for an entry that is empty and old by this window's clock, once for each judgement; when it cannot be read the entry is not left empty, so the lock stays and a later try judges again.
 * The probe is an empty file beside the lock named like a prepared lock, `<lock>.pending-<uuid>` ({@link PREPARED_LOCK_SUFFIX}), whatever entry is judged: never inside a claim folder, where it would be listed as a claim, could make the removal of the folder fail, or move with a prepared claim that its window renames into place. A probe that a window killed in that instant left is swept like any prepared lock, by {@link removeStaleStorageClaims}, once it is old by both clocks (in the storage folder, and in a project's `.codebook` folder beside a Wiki update's marker).
 * @param path - The file or folder to inspect; a final link is not followed.
 * @param kind - What the entry must be: a lock is a `file`, a prepared claim a `directory`.
 * @param lockPath - The `writer.lock` file (or the marker file) the entry belongs to, beside which the clock probe is made; the entry's own path unless it is a claim or a prepared file.
 * @returns
 * - `true` for an entry of that kind that holds nothing and was last changed longer ago than the grace, by both clocks
 * - `false` for an entry with content, a younger one by either clock, one of another kind, a path that cannot be inspected, and an entry whose file system's clock cannot be read
 * @example
 * await isLeftEmpty('/storage/learning/writer.lock', 'file')                  // => true for a 0-byte lock a killed writer created a minute ago
 * await isLeftEmpty('/storage/learning/writer.lock.takeover-4f2c', 'directory') // => false while its window is still writing the claim
 */
export async function isLeftEmpty(
  path: string,
  kind: 'file' | 'directory',
  lockPath: string = path,
): Promise<boolean> {
  const entry = await lstat(path).catch(() => undefined)
  if (!entry || !(await holdsNothing(path, entry, kind))) return false
  if (Date.now() - entry.mtimeMs <= STORAGE_LOCK_UNWRITTEN_GRACE_MS)
    return false
  // This window's clock may run ahead of the clock that stamped the entry: the entry must be as old by that clock, and an unknown clock keeps it.
  const fileSystemNowMs = await readFileSystemNowMs(
    `${lockPath}${PREPARED_LOCK_SUFFIX}${randomUUID()}`,
  )
  return (
    fileSystemNowMs !== undefined &&
    fileSystemNowMs - entry.mtimeMs > STORAGE_LOCK_UNWRITTEN_GRACE_MS
  )
}
