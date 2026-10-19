import { unlink } from 'node:fs/promises'

import { hasOwnWriterRecordFolder } from './hasOwnWriterRecordFolder'
import { readRecordingWriterRecord } from './readRecordingWriterRecord'
import { recordingOwnerRecordPath } from './recordingOwnerRecordPath'

/**
 * Removes the record of a recording's writer once the recording has no writer any more, and only from a real folder of records ({@link hasOwnWriterRecordFolder}); called by {@link RecordingWriter.finish} after the seal, for the sealed recording alone, and by {@link LearningLibrary.removeStudy} after every recording of the study moved.
 * A link or anything else at the folder's place is left as it is, with what it leads to; a record that cannot be removed stays for the sweep at a later start of a recording. The look and the removal are separate steps ({@link hasOwnWriterRecordFolder}: only this user's own processes can put a link there between them), and the removal never follows a link at the record's own name.
 * @param learningDirectory - The private learning directory that holds the `recordings.vN` folders.
 * @param studyId - The recording's study id.
 * @param sealed - The sealed recording, its directory and creation time, when only its own record may go: a record that names another recording of the id ({@link readRecordingWriterRecord}) stays. Left out when every recording of the study is gone.
 * @example
 * await removeWriterRecord('/storage/learning', '<study id>') // the record is gone; a `recording-owners` link and its target stay
 * await removeWriterRecord('/storage/learning', '<study id>', { directory: '/storage/learning/recordings.v2/<study id>', createdAt }) // only when the record names that recording
 */
export async function removeWriterRecord(
  learningDirectory: string,
  studyId: string,
  sealed?: { directory: string; createdAt: string },
): Promise<void> {
  if (!(await hasOwnWriterRecordFolder(learningDirectory))) return
  // At a seal, a record of another recording of the id is that recording's and stays.
  if (
    sealed &&
    !(await readRecordingWriterRecord(sealed.directory, sealed.createdAt))
  )
    return
  await unlink(recordingOwnerRecordPath(learningDirectory, studyId)).catch(
    () => undefined,
  )
}
