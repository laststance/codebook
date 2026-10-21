import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'

import { STORAGE_LOCK_UNWRITTEN_GRACE_MS } from '../constants'

import { PREPARED_LOCK_SUFFIX } from './preparedLockSuffix'
import { readFileSystemNowMs } from './readFileSystemNowMs'

/** What {@link judgeLeftEmpty} found: `left-empty` for an entry created and never filled that both clocks call old, `kept` for every other entry, and `clock-unknown` for an entry that is empty and old by this window's clock whose file system's clock could not be read, so that nothing can be judged by it. */
export type LeftEmptyVerdict = 'left-empty' | 'kept' | 'clock-unknown'

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
 * Judges whether a lock file or a prepared takeover claim was created and never filled, and tells an entry whose file system's clock cannot be read from one that is simply kept; called by {@link isLeftEmpty} for its yes or no, and by {@link describeRefusedStorageLock} to name the unknown clock in a refusal.
 * Why: a folder that takes no new file (a full disk, a read-only mount, a quota) allows no clock probe, so an empty lock there is never judged old and stays on purpose (Cycle 0048 task 40); the learner can act on that cause only when the refusal names it, and the plain answer of {@link isLeftEmpty} cannot.
 * The rules are those of {@link isLeftEmpty}: only an entry that has stayed empty for {@link STORAGE_LOCK_UNWRITTEN_GRACE_MS} counts, by this window's clock and by the clock of the file system that holds it ({@link readFileSystemNowMs}, read only for an entry that is empty and old by this window's clock).
 * @param path - The file or folder to inspect; a final link is not followed.
 * @param kind - What the entry must be: a lock is a `file`, a prepared claim a `directory`.
 * @param lockPath - The `writer.lock` file (or the marker file) the entry belongs to, beside which the clock probe is made; the entry's own path unless it is a claim or a prepared file.
 * @returns A {@link LeftEmptyVerdict}.
 * @example
 * await judgeLeftEmpty('/storage/learning/writer.lock', 'file') // => 'clock-unknown' for a minute-old empty lock in a full folder
 */
export async function judgeLeftEmpty(
  path: string,
  kind: 'file' | 'directory',
  lockPath: string = path,
): Promise<LeftEmptyVerdict> {
  const entry = await lstat(path).catch(() => undefined)
  if (!entry || !(await holdsNothing(path, entry, kind))) return 'kept'
  if (Date.now() - entry.mtimeMs <= STORAGE_LOCK_UNWRITTEN_GRACE_MS)
    return 'kept'
  // This window's clock may run ahead of the clock that stamped the entry: the entry must be as old by that clock, and an unknown clock keeps it.
  const fileSystemNowMs = await readFileSystemNowMs(
    `${lockPath}${PREPARED_LOCK_SUFFIX}${randomUUID()}`,
  )
  if (fileSystemNowMs === undefined) return 'clock-unknown'
  return fileSystemNowMs - entry.mtimeMs > STORAGE_LOCK_UNWRITTEN_GRACE_MS
    ? 'left-empty'
    : 'kept'
}
