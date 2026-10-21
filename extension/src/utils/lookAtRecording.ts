import { lstat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import {
  MAX_RECORDING_HEADER_BYTES,
  RECORDING_HEADER_FILE,
  RECORDING_SEAL_FILE,
} from '../constants'
import { recordingHeaderSchema } from '../recordingSchemas'

import { mayHoldRegularFileWithin } from './mayHoldRegularFileWithin'
import { readRecordingWriterRecord } from './readRecordingWriterRecord'
import { readWikiRegularFile } from './readWikiRegularFile'
import { recordingOwnerRecordPath } from './recordingOwnerRecordPath'

/** The owner a recording's header names and when the recording was created, read without the rest of the header, whose other fields depend on the recording's format. */
const headerOwnerSchema = z.object({
  owner: recordingHeaderSchema.shape.owner,
  createdAt: recordingHeaderSchema.shape.createdAt,
})

/**
 * What one cheap look at a recording directory finds, with no question to the system about any process ({@link lookAtRecording}).
 * - `isSealed`: the seal file is there; the run ended
 * - `header`: the writer the header names and the recording's creation time; absent while the header cannot be read (a start that has made the folder and not yet written its header, or a damaged header)
 * - `hasWriterRecord`: the record of the writer's full identity is there, beside the recordings ({@link recordingOwnerRecordPath}), and names this recording ({@link readRecordingWriterRecord}); `false` without a readable header, which gives the recording's creation time
 * - `mayHaveFailedRead`: the header, or the writer record of a recording whose header was read, gave this look no header, or no record of this recording, and either stands as a regular file within its bound or could not be looked at (a look that failed other than for a missing entry, such as `EACCES` or `EIO`): a read that failed for a moment (a scanner on Windows holds the file), a file this user may not read, or a file that is no header or no record of this recording. Such a look proves neither absent, so it releases no sealed recording ({@link isSealedRecordingReleased}, Cycle 0047 row 239), and a removal never takes it for a finished recording ({@link recordingWriterOf}, Cycle 0047 row 251)
 */
export type RecordingLook = {
  isSealed: boolean
  header?: z.infer<typeof headerOwnerSchema>
  hasWriterRecord: boolean
  mayHaveFailedRead: boolean
}

/**
 * Reads the writer and the creation time a recording's header names, for {@link lookAtRecording}: only a regular file of at most {@link MAX_RECORDING_HEADER_BYTES}, opened without following a link and without waiting on a pipe ({@link readWikiRegularFile}), as the reads of the Wiki's metadata are.
 * Why: the list and the removal read every unsealed recording's header, and a named pipe at `header.json` would hold that read, and the editor's process with it, for good.
 * @param directory - The directory of one recording.
 * @returns The header's writer and creation time; `undefined` for a link, a pipe, a device, a folder, a larger file and one that does not parse, as for a header that cannot be read.
 * @example await readHeaderOwner('/…/recordings.v2/<study id>') // => { owner: { pid: 4242, hostname: 'workstation', sessionId }, createdAt }
 */
async function readHeaderOwner(
  directory: string,
): Promise<RecordingLook['header']> {
  // A header larger than a header may be is refused by its size, before it is read.
  const read = await readWikiRegularFile(
    join(directory, RECORDING_HEADER_FILE),
    undefined,
    MAX_RECORDING_HEADER_BYTES,
  )
  if (!read) return undefined
  try {
    return headerOwnerSchema.parse(JSON.parse(read.bytes.toString()))
  } catch {
    // A header that does not parse names no writer.
    return undefined
  }
}

/**
 * Looks at one recording directory without asking the system about any process: its seal, its header's writer and creation time, whether the record of its writer is there, and whether a read may have failed instead; called by {@link recordingWriterOf} before it judges the writer, by the removal of {@link LearningLibrary.removeStudy}, which looks before its storage lock ({@link LearningLibrary.writerVerdictsOf}) and again under it ({@link LearningLibrary.verdictUnderLock}), where no slow question may run, and by {@link removeWriterRecordsOfSealedRecordings}, which removes the record of a sealed recording at the save of a checkpoint its run took after the seal.
 * @param directory - The directory of one recording, `<learning directory>/recordings.vN/<study id>`.
 * @returns What is there ({@link RecordingLook}).
 * @example await lookAtRecording('/…/recordings.v2/<study id>') // => { isSealed: false, header: { owner: { pid: 4242, hostname: 'workstation', sessionId }, createdAt }, hasWriterRecord: true, mayHaveFailedRead: false }
 */
export async function lookAtRecording(
  directory: string,
): Promise<RecordingLook> {
  const isSealed = await lstat(join(directory, RECORDING_SEAL_FILE)).then(
    () => true,
    () => false,
  )
  const header = await readHeaderOwner(directory)
  // Only a record that names this recording is its record; one of another format's recording of the id is none.
  const hasWriterRecord =
    header !== undefined &&
    (await readRecordingWriterRecord(directory, header.createdAt)) !== undefined
  // A file that stands there, or cannot be looked at, and gave nothing may be a read that failed for a moment: the look proves no header, or no record, absent then.
  const mayHaveFailedRead =
    header === undefined
      ? await mayHoldRegularFileWithin(
          join(directory, RECORDING_HEADER_FILE),
          MAX_RECORDING_HEADER_BYTES,
        )
      : !hasWriterRecord &&
        (await mayHoldRegularFileWithin(
          recordingOwnerRecordPath(
            dirname(dirname(directory)),
            basename(directory),
          ),
          MAX_RECORDING_HEADER_BYTES,
        ))
  return {
    isSealed,
    ...(header && { header }),
    hasWriterRecord,
    mayHaveFailedRead,
  }
}
