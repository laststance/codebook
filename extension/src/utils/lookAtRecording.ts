import { lstat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import {
  MAX_RECORDING_HEADER_BYTES,
  RECORDING_HEADER_FILE,
  RECORDING_SEAL_FILE,
} from '../constants'
import { recordingHeaderSchema } from '../recordingSchemas'

import { readBoundedFile } from './readBoundedFile'
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
  const header = await readBoundedFile(
    join(directory, RECORDING_HEADER_FILE),
    MAX_RECORDING_HEADER_BYTES,
  )
    .then((bytes) => headerOwnerSchema.parse(JSON.parse(bytes.toString())))
    .catch(() => undefined)
  const hasWriterRecord = await lstat(
    recordingOwnerRecordPath(dirname(dirname(directory)), basename(directory)),
  ).then(
    (entry) => entry.isFile(),
    () => false,
  )
  return { isSealed, ...(header && { header }), hasWriterRecord }
}
