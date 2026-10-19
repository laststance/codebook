import { basename, dirname } from 'node:path'

import { z } from 'zod'

import { MAX_RECORDING_HEADER_BYTES } from '../constants'

import { hasOwnWriterRecordFolder } from './hasOwnWriterRecordFolder'
import { recordedOwnerSchema, type RecordedOwner } from './readRecordedOwner'
import { readWikiRegularFile } from './readWikiRegularFile'
import { recordingOwnerRecordPath } from './recordingOwnerRecordPath'

/** The recording a writer record belongs to, as its header and its place name it: the recording format's folder (`recordings.v2`, `recordings.v3`) and the time the recording was created. */
export type RecordingOfWriterRecord = { folder: string; createdAt: string }

/** A writer record of this build: the writer's full identity, as a storage lock records it, and the recording it was written for. */
const writerRecordSchema = recordedOwnerSchema.extend({
  recording: z.strictObject({
    folder: z.string().min(1),
    createdAt: z.string().min(1),
  }),
})

/**
 * Names the recording one recording directory holds, as its writer record names it; called by {@link RecordingStore} when it writes the record at a recording's start, and by {@link readRecordingWriterRecord} to compare.
 * @param directory - The directory of one recording, `<learning directory>/recordings.vN/<study id>`.
 * @param createdAt - When the recording was created, as its header says.
 * @returns The recording format's folder and the creation time.
 * @example recordingOfDirectory('/storage/learning/recordings.v2/<id>', '2026-10-01T08:00:00.000Z') // => { folder: 'recordings.v2', createdAt: '2026-10-01T08:00:00.000Z' }
 */
export function recordingOfDirectory(
  directory: string,
  createdAt: string,
): RecordingOfWriterRecord {
  return { folder: basename(dirname(directory)), createdAt }
}

/**
 * Reads the record of a recording's writer ({@link recordingOwnerRecordPath}) for that one recording: the record is kept by the study id, which recordings of several formats can share, so it counts only for the recording it names; called by the judgement of a recording's writer ({@link recordingWriterState}), by {@link lookAtRecording} and by {@link removeWriterRecord} at a recording's seal.
 * The record is read only from a real folder of records ({@link hasOwnWriterRecordFolder}), as a regular file of bounded size without following a link ({@link readWikiRegularFile}).
 * A record that names no recording (one of an earlier build of this delivery) is not used: it may be another format's, and the header's rules judge a recording without a record, as they judge one of 0.2.29.0.
 * @param directory - The directory of one recording, `<learning directory>/recordings.vN/<study id>`.
 * @param createdAt - When the recording was created, as its header says.
 * @returns The writer the record names; `undefined` when there is no record, when it cannot be read or parsed, when it names no recording, and when it names another one (another format's folder, or another creation time).
 * @example await readRecordingWriterRecord('/storage/learning/recordings.v3/<id>', createdAt) // => undefined while the record names recordings.v2/<id>
 */
export async function readRecordingWriterRecord(
  directory: string,
  createdAt: string,
): Promise<RecordedOwner | undefined> {
  const learningDirectory = dirname(dirname(directory))
  // A record is read only from a real folder of records; one behind a link or a junction is none.
  if (!(await hasOwnWriterRecordFolder(learningDirectory))) return undefined
  // A record is written within the header's bound; a larger file is refused by its size, before it is read.
  const read = await readWikiRegularFile(
    recordingOwnerRecordPath(learningDirectory, basename(directory)),
    undefined,
    MAX_RECORDING_HEADER_BYTES,
  )
  if (!read) return undefined
  let parsed: z.infer<typeof writerRecordSchema>
  try {
    parsed = writerRecordSchema.parse(JSON.parse(read.bytes.toString('utf8')))
  } catch {
    // A record that does not parse, or names no recording, is none.
    return undefined
  }
  const { recording, ...owner } = parsed
  const named = recordingOfDirectory(directory, createdAt)
  // Only the recording the record was written for is judged by it.
  return recording.folder === named.folder &&
    recording.createdAt === named.createdAt
    ? owner
    : undefined
}
