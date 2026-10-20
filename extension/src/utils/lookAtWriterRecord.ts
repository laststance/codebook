import { lstat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import {
  MAX_RECORDING_HEADER_BYTES,
  RECORDING_OWNERS_DIRECTORY,
} from '../constants'

import { hasOwnWriterRecordFolder } from './hasOwnWriterRecordFolder'
import { mayHoldRegularFileWithin } from './mayHoldRegularFileWithin'
import { recordedOwnerSchema, type RecordedOwner } from './readRecordedOwner'
import { recordedOwnerNamedBy } from './readRecordingWriterRecord'
import { readWikiRegularFile } from './readWikiRegularFile'
import { recordingOwnerRecordPath } from './recordingOwnerRecordPath'
import { systemErrorCode } from './systemErrorCode'

/**
 * What one look at a recording's writer record finds, the answer and the record coming from the same read.
 * - `record`: the record is readable and names this recording; `owner` is its writer
 * - `unreadable`: a regular file within the bound stands and cannot be read now, is no JSON, or is JSON that names no process (no owner record), or the folder of records or the file could not be looked at (other than with `ENOENT` or `ENOTDIR`)
 * - `none`: no record by design: a missing record or folder, a link, a folder or a pipe in either place, a larger file, and an owner record that names no recording or another one
 */
export type WriterRecordLook =
  | { kind: 'record'; owner: RecordedOwner }
  | { kind: 'unreadable' }
  | { kind: 'none' }

/**
 * Looks at the writer record of a recording once and says what it is, so that a header's `gone` is not believed while a record stands that names another computer or cannot be read now; called by {@link recordingWriterState} for an unsealed recording and by {@link sealedRecordingWriterState} for a sealed one, each when the read of the record gave nothing and the header judges the writer gone (Cycle 0048 tasks 1, 30, 75 and 124).
 * Why: a record that stands and gives nothing (a scanner on Windows holds it, or it is damaged or not yet whole) may be that of a writer on another computer with this host name and this storage folder, whose process id no process here has. A record that is none by design is none, and the header judges as it judges a recording of 0.2.29.0: one larger than its bound, one behind a link or a junction at the folder of records ({@link hasOwnWriterRecordFolder}), and one that is an owner record but names no recording or another one (a record of an earlier build, of another format's recording, or of an earlier recording of the same id).
 * A record that this look reads, which the first read could not (the scanner let go between the two), is returned with its writer, so that the caller judges by that very read and not by the header (Cycle 0048 task 124).
 * @param directory - The directory of one recording, `<learning directory>/recordings.vN/<study id>`.
 * @param createdAt - When the recording was created, as its header says; a record counts only for the recording it names ({@link recordedOwnerNamedBy}).
 * @returns What the look found ({@link WriterRecordLook}).
 * @example await lookAtWriterRecord('/storage/learning/recordings.v2/<id>', createdAt) // => { kind: 'unreadable' } while a scanner holds the record, { kind: 'none' } while `recording-owners` is a link
 */
export async function lookAtWriterRecord(
  directory: string,
  createdAt: string,
): Promise<WriterRecordLook> {
  const learningDirectory = dirname(dirname(directory))
  if (!(await hasOwnWriterRecordFolder(learningDirectory)))
    // A link, a file or nothing at the folder's place holds no record; a look that failed for another reason proves nothing.
    return lstat(join(learningDirectory, RECORDING_OWNERS_DIRECTORY)).then(
      () => ({ kind: 'none' }),
      (error: unknown) =>
        ['ENOENT', 'ENOTDIR'].includes(systemErrorCode(error))
          ? { kind: 'none' }
          : { kind: 'unreadable' },
    )
  const path = recordingOwnerRecordPath(learningDirectory, basename(directory))
  if (!(await mayHoldRegularFileWithin(path, MAX_RECORDING_HEADER_BYTES)))
    return { kind: 'none' }
  const read = await readWikiRegularFile(
    path,
    undefined,
    MAX_RECORDING_HEADER_BYTES,
  ).catch(() => undefined)
  if (!read) return { kind: 'unreadable' }
  let json: unknown
  try {
    json = JSON.parse(read.bytes.toString('utf8'))
  } catch {
    // A file that is no JSON may be one being written, or a damaged one.
    return { kind: 'unreadable' }
  }
  // A record names its writer by a process id, as every owner record does; a file that does not is no owner record.
  if (!recordedOwnerSchema.safeParse(json).success)
    return { kind: 'unreadable' }
  const owner = recordedOwnerNamedBy(json, directory, createdAt)
  // An owner record of an earlier build or of another recording is none: the header judges.
  return owner ? { kind: 'record', owner } : { kind: 'none' }
}
