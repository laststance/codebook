import { lstat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import {
  MAX_RECORDING_HEADER_BYTES,
  RECORDING_OWNERS_DIRECTORY,
} from '../constants'

import { hasOwnWriterRecordFolder } from './hasOwnWriterRecordFolder'
import { mayHoldRegularFileWithin } from './mayHoldRegularFileWithin'
import { readWikiRegularFile } from './readWikiRegularFile'
import { recordingOwnerRecordPath } from './recordingOwnerRecordPath'
import { systemErrorCode } from './systemErrorCode'

/**
 * Says whether the writer record of a recording stands as a regular file within its bound and cannot be read now, so that the header's `gone` proves nothing; called by {@link recordingWriterState} for an unsealed recording and by {@link sealedRecordingWriterState} for a sealed one, each when its header judges the writer gone (Cycle 0048 tasks 1 and 30).
 * Why: a record that stands and gives nothing (a scanner on Windows holds it, or it is damaged or not yet whole) may be that of a writer on another computer with this host name and this storage folder, whose process id no process here has. A record that is none by design is none, and the header judges as it judges a recording of 0.2.29.0: one larger than its bound, one behind a link or a junction at the folder of records ({@link hasOwnWriterRecordFolder}), and one that reads as JSON but names no recording or another one (a record of an earlier build, of another format's recording, or of an earlier recording of the same id).
 * @param directory - The directory of one recording, `<learning directory>/recordings.vN/<study id>`.
 * @returns `true` for a regular file within the bound that cannot be read or is no JSON, and for a look at the folder of records or at the file that failed other than with `ENOENT` or `ENOTDIR`; `false` for a missing record or folder, a link, a folder or a pipe in either place, a larger file, and a file that reads as JSON.
 * @example await isWriterRecordUnreadable('/storage/learning/recordings.v2/<id>') // => true while a scanner holds the record, false while `recording-owners` is a link
 */
export async function isWriterRecordUnreadable(
  directory: string,
): Promise<boolean> {
  const learningDirectory = dirname(dirname(directory))
  if (!(await hasOwnWriterRecordFolder(learningDirectory)))
    // A link, a file or nothing at the folder's place holds no record; a look that failed for another reason proves nothing.
    return lstat(join(learningDirectory, RECORDING_OWNERS_DIRECTORY)).then(
      () => false,
      (error: unknown) =>
        !['ENOENT', 'ENOTDIR'].includes(systemErrorCode(error)),
    )
  const path = recordingOwnerRecordPath(learningDirectory, basename(directory))
  if (!(await mayHoldRegularFileWithin(path, MAX_RECORDING_HEADER_BYTES)))
    return false
  const read = await readWikiRegularFile(
    path,
    undefined,
    MAX_RECORDING_HEADER_BYTES,
  ).catch(() => undefined)
  if (!read) return true
  try {
    JSON.parse(read.bytes.toString('utf8'))
    return false
  } catch {
    // A file that is no JSON may be one being written, or a damaged one.
    return true
  }
}
