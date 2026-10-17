import { lstat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import {
  MAX_RECORDING_HEADER_BYTES,
  RECORDING_HEADER_FILE,
  RECORDING_SEAL_FILE,
} from '../constants'
import { recordingHeaderSchema } from '../recordingSchemas'

import { hasOwnWriterRecordFolder } from './hasOwnWriterRecordFolder'
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
 * - `hasWriterRecord`: the record of the writer's full identity is there, beside the recordings ({@link recordingOwnerRecordPath})
 */
export type RecordingLook = {
  isSealed: boolean
  header?: z.infer<typeof headerOwnerSchema>
  hasWriterRecord: boolean
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
  const read = await readWikiRegularFile(join(directory, RECORDING_HEADER_FILE))
  if (!read || read.bytes.length > MAX_RECORDING_HEADER_BYTES) return undefined
  try {
    return headerOwnerSchema.parse(JSON.parse(read.bytes.toString()))
  } catch {
    // A header that does not parse names no writer.
    return undefined
  }
}

/**
 * Looks at one recording directory without asking the system about any process: its seal, its header's writer and creation time, and whether the record of its writer is there; called by {@link recordingWriterOf} before it judges the writer, and by {@link LearningLibrary.removeStudy}, which looks before its storage lock and again under it, where no slow question may run.
 * @param directory - The directory of one recording, `<learning directory>/recordings.vN/<study id>`.
 * @returns What is there ({@link RecordingLook}).
 * @example await lookAtRecording('/…/recordings.v2/<study id>') // => { isSealed: false, header: { owner: { pid: 4242, hostname: 'workstation', sessionId }, createdAt }, hasWriterRecord: true }
 */
export async function lookAtRecording(
  directory: string,
): Promise<RecordingLook> {
  const isSealed = await lstat(join(directory, RECORDING_SEAL_FILE)).then(
    () => true,
    () => false,
  )
  const header = await readHeaderOwner(directory)
  const learningDirectory = dirname(dirname(directory))
  // A record behind a link or a junction at the folder's place is none.
  const hasWriterRecord =
    (await hasOwnWriterRecordFolder(learningDirectory)) &&
    (await lstat(
      recordingOwnerRecordPath(learningDirectory, basename(directory)),
    ).then(
      (entry) => entry.isFile(),
      () => false,
    ))
  return { isSealed, ...(header && { header }), hasWriterRecord }
}
