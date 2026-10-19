import type { BigIntStats } from 'node:fs'
import { lstat } from 'node:fs/promises'

import { systemErrorCode } from './systemErrorCode'
import { thrownMessage } from './thrownMessage'

/** The codes of a look that prove nothing is at the path: `ENOENT`, and `ENOTDIR`, which a folder on the way that is a file now answers. */
const NO_ENTRY_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])

/** What a path holds after a mover rejected its move, against the look right before the move ({@link entryAfterRejectedMove}). */
export type EntryAfterRejectedMove =
  | { kind: 'still-there' }
  | { kind: 'gone' }
  | { kind: 'unknown'; cause: string }

/**
 * Looks at a path again after the mover of a removal rejected its move, and compares what stands there with the look right before the move, so that only the same entry still in place counts as the Trash's refusal; called by {@link LearningLibrary.removeStudy} for each path whose move rejected.
 * Why: a mover can reject after the move (an editor that answers late), a path can be made again after the move, and a look can fail after a real move (a folder that may not be read). None of these is a refusal of the Trash, and the last says nothing of where the entry went.
 * @param path - The path whose move the mover rejected.
 * @param before - The path's status, read with `{ bigint: true }` right before the move; `undefined` when that look failed.
 * @returns
 * - `still-there`: the same entry (the device and inode of `before`) is at the path
 * - `gone`: nothing is at the path (`ENOENT`, and `ENOTDIR`: a folder on the way is a file now, so nothing can be at the path), or another entry stands there (the path was made again after the move)
 * - `unknown`, with what failed as `cause`: the look failed otherwise (`EACCES`, `ELOOP`, …), or an entry is there and no look before the move tells whether it is the same
 * @example
 * await entryAfterRejectedMove('/storage/learning/recordings.v2/<id>', before) // => { kind: 'gone' } once the folder is in the Trash
 * await entryAfterRejectedMove('/storage/learning/<id>.study.v3.json', before) // => { kind: 'still-there' } when the Trash refused the file
 */
export async function entryAfterRejectedMove(
  path: string,
  before: BigIntStats | undefined,
): Promise<EntryAfterRejectedMove> {
  let after: BigIntStats
  try {
    after = await lstat(path, { bigint: true })
  } catch (error) {
    // No entry at the path, or a file where a folder on its way was: it left the library. Any other failure tells nothing of where it went.
    return NO_ENTRY_CODES.has(systemErrorCode(error))
      ? { kind: 'gone' }
      : { kind: 'unknown', cause: thrownMessage(error) }
  }
  if (before === undefined)
    return { kind: 'unknown', cause: 'the look before the move failed' }
  // Another entry at the path was made after the move; the one that was there left.
  return after.dev === before.dev && after.ino === before.ino
    ? { kind: 'still-there' }
    : { kind: 'gone' }
}
