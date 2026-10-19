import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { RECORDING_STORAGE_FORMATS } from '../constants'

import { lookAtRecording } from './lookAtRecording'
import { removeWriterRecord } from './removeWriterRecord'

/**
 * Removes the record of the writer of a study's sealed recording once the study is saved, so that the recording counts as finished from then on; called by {@link LearningLibrary.saveStudy} under the storage lock, after the archive was written.
 * Why: a sealed recording keeps the record of its writer until its run has saved its study ({@link RecordingWriter.finish}), so that another window neither lists it as what is left of a removed study nor removes it before that save ({@link recordingWriterOf}). Once the archive is there, a record that stayed would hide the recording from other windows after the archive was removed by hand.
 * A recording that is not sealed keeps its record: its run still writes it. A record that names another recording of the id stays ({@link removeWriterRecord}). A root that is no real folder is not looked into.
 * @param learningDirectory - The private learning directory that holds the `recordings.vN` folders.
 * @param studyId - The saved study's id.
 * @throws What looking at a recording or removing a record throws; the caller keeps the save all the same.
 * @example
 * await removeWriterRecordsOfSealedRecordings('/storage/learning', '<study id>') // the record of the sealed '/storage/learning/recordings.v2/<study id>' is gone
 */
export async function removeWriterRecordsOfSealedRecordings(
  learningDirectory: string,
  studyId: string,
): Promise<void> {
  for (const storage of RECORDING_STORAGE_FORMATS) {
    const root = join(learningDirectory, storage.directory)
    // A link that replaced a root is not followed.
    if (!(await lstat(root).catch(() => undefined))?.isDirectory()) continue
    const directory = join(root, studyId)
    const { isSealed, header, hasWriterRecord } =
      await lookAtRecording(directory)
    // Only a sealed recording whose record names it releases its record here.
    if (isSealed && header && hasWriterRecord)
      await removeWriterRecord(learningDirectory, studyId, {
        directory,
        createdAt: header.createdAt,
      })
  }
}
