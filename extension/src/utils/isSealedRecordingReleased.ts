import type { RecordingLook } from './lookAtRecording'
import { isOwnRecording } from './ownRecordingSessions'

/**
 * Says, from one look at a sealed recording and without asking the system about any process or reading the disk, whether its run has released it, so that it counts as finished; called by {@link recordingWriterOf} before it judges the writer of a sealed recording ({@link sealedRecordingWriterState}), and by the removal under its storage lock ({@link LearningLibrary.verdictUnderLock}), where no slow question may run.
 * Why: a sealed recording belongs to its run until the run has saved its study after the seal. The seal keeps the record of the writer until then ({@link RecordingWriter.finish}), also when a checkpoint saved the study while the run went on: an archive of the study does not release the recording, because the run's final state is not saved yet. Before that save another window would list the recording as what is left of a removed study, or remove the study with its recording, and the run's save would write the study back without its recording.
 * @param look - What one look at the recording found ({@link lookAtRecording}); its seal is not looked at again.
 * @returns `true` for a recording without a readable header, one without the record of its writer (its study was saved after the seal, it was made by 0.2.29.0, or its record could not be written), and this window's own (this window lists it and removes it by its own run state); `false` while another writer's record is kept, whether or not the study has an archive.
 * @example
 * isSealedRecordingReleased(look) // => false while another window has not saved that study after the seal of its recording
 */
export function isSealedRecordingReleased(look: RecordingLook): boolean {
  if (!look.header || !look.hasWriterRecord) return true
  // This window's own run is judged by this window, by its header's session.
  return isOwnRecording(look.header.owner)
}
