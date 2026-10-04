import type { Stats } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'

import { STORAGE_LOCK_UNWRITTEN_GRACE_MS } from '../constants'

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
 * A running window is in that state for an instant, so only an entry that has stayed empty for {@link STORAGE_LOCK_UNWRITTEN_GRACE_MS} counts.
 * @param path - The file or folder to inspect; a final link is not followed.
 * @param kind - What the entry must be: a lock is a `file`, a prepared claim a `directory`.
 * @returns
 * - `true` for an entry of that kind that holds nothing and was last changed longer ago than the grace
 * - `false` for an entry with content, a younger one, one of another kind, and a path that cannot be inspected
 * @example
 * await isLeftEmpty('/storage/learning/writer.lock', 'file')                  // => true for a 0-byte lock a killed writer created a minute ago
 * await isLeftEmpty('/storage/learning/writer.lock.takeover-4f2c', 'directory') // => false while its window is still writing the claim
 */
export async function isLeftEmpty(
  path: string,
  kind: 'file' | 'directory',
): Promise<boolean> {
  const entry = await lstat(path).catch(() => undefined)
  if (!entry || !(await holdsNothing(path, entry, kind))) return false
  return Date.now() - entry.mtimeMs > STORAGE_LOCK_UNWRITTEN_GRACE_MS
}
