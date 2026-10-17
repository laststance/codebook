import { unlink } from 'node:fs/promises'

import { hasOwnWriterRecordFolder } from './hasOwnWriterRecordFolder'
import { recordingOwnerRecordPath } from './recordingOwnerRecordPath'

/**
 * Removes the record of a recording's writer once the recording has no writer any more, and only from a real folder of records ({@link hasOwnWriterRecordFolder}); called by {@link RecordingWriter.finish} after the seal and by {@link LearningLibrary.removeStudy} after the study's recordings moved.
 * A link or anything else at the folder's place is left as it is, with what it leads to; a record that cannot be removed stays for the sweep at a later start of a recording.
 * @param learningDirectory - The private learning directory that holds the `recordings.vN` folders.
 * @param studyId - The recording's study id.
 * @example await removeWriterRecord('/storage/learning', '<study id>') // the record is gone; a `recording-owners` link and its target stay
 */
export async function removeWriterRecord(
  learningDirectory: string,
  studyId: string,
): Promise<void> {
  if (!(await hasOwnWriterRecordFolder(learningDirectory))) return
  await unlink(recordingOwnerRecordPath(learningDirectory, studyId)).catch(
    () => undefined,
  )
}
