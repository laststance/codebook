import { basename, dirname } from 'node:path'

import { hasStudyArchive } from './hasStudyArchive'
import type { RecordingLook } from './lookAtRecording'
import { isOwnRecording } from './ownRecordingSessions'

/**
 * Says, from one look at a sealed recording and without asking the system about any process, whether its run has released it, so that it counts as finished; called by {@link recordingWriterOf} before it judges the writer of a sealed recording ({@link sealedRecordingWriterState}), and by the removal under its storage lock ({@link LearningLibrary.verdictUnderLock}), where no slow question may run.
 * Why: a sealed recording belongs to its run until the run has saved its study. The seal keeps the record of the writer until then ({@link RecordingWriter.finish}); before that save another window would list the recording as what is left of a removed study and could move it to the Trash, and the study would be saved without its recording.
 * @param directory - The directory of the recording, `<learning directory>/recordings.vN/<study id>`.
 * @param look - What one look at the recording found ({@link lookAtRecording}); its seal is not looked at again.
 * @returns `true` for a recording without a readable header, one without the record of its writer (its study was saved, it was made by 0.2.29.0, or its record could not be written), this window's own (this window lists it and removes it by its own run state), and one whose study has an archive; `false` while another writer's record is kept and the study has no archive.
 * @example
 * await isSealedRecordingReleased('/storage/learning/recordings.v2/<id>', look) // => false while another window has not saved that study
 */
export async function isSealedRecordingReleased(
  directory: string,
  look: RecordingLook,
): Promise<boolean> {
  if (!look.header || !look.hasWriterRecord) return true
  // This window's own run is judged by this window, by its header's session.
  if (isOwnRecording(look.header.owner)) return true
  // A study that has an archive was saved: its run waits for no first save, also between its seal and the removal of its record.
  return hasStudyArchive(dirname(dirname(directory)), basename(directory))
}
