import { lstat } from 'node:fs/promises'

import { systemErrorCode } from './systemErrorCode'

/**
 * Says whether a regular file of at most a bound may stand at a path, looked at without following a link; called by {@link lookAtRecording} for a header that gave the look nothing and by {@link mayHoldWriterRecord} for a writer record.
 * Why a failed look counts: a look that fails other than for a missing entry (`EACCES`, `EIO`) proves no file absent, and a removal that took it for none would move a recording another window still holds (Cycle 0047 row 251).
 * @param path - The file's path.
 * @param limitBytes - The largest size its reader accepts.
 * @returns `true` for such a file, and for a path whose look fails other than with `ENOENT` or `ENOTDIR`; `false` for a path that holds nothing, a link, a pipe, a folder and a larger file.
 * @example await mayHoldRegularFileWithin('/…/recordings.v2/<study id>/header.json', MAX_RECORDING_HEADER_BYTES) // => true for a header a scanner holds for a moment, and for one this user may not look at
 */
export async function mayHoldRegularFileWithin(
  path: string,
  limitBytes: number,
): Promise<boolean> {
  try {
    const entry = await lstat(path)
    return entry.isFile() && entry.size <= limitBytes
  } catch (error) {
    // Only a look that finds no entry proves the file absent; any other failure may hide one.
    return !['ENOENT', 'ENOTDIR'].includes(systemErrorCode(error))
  }
}
