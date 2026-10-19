import type { RecordingLook } from './lookAtRecording'
import { isOwnRecording } from './ownRecordingSessions'

/**
 * Says, from one look at a sealed recording and without asking the system about any process or reading the disk, whether its run has released it, so that it counts as finished; called by {@link recordingWriterOf} before it judges the writer of a sealed recording ({@link sealedRecordingWriterState}), and by the removal under its storage lock ({@link LearningLibrary.verdictUnderLock}), where no slow question may run.
 * Why: a sealed recording belongs to its run until the run has saved its study from a checkpoint taken after the seal. The seal keeps the record of the writer until then ({@link RecordingWriter.finish}, {@link removeWriterRecordsOfSealedRecordings}), also when a checkpoint taken while the run went on saved the study, before the seal or after it: an archive of the study does not release the recording, because the run's final state is not saved yet. Before that save another window would list the recording as what is left of a removed study, or remove the study with its recording before the run saved its state after the seal.
 * A checkpoint is taken after the seal once the run's stop that sealed the recording has ended, also a stop whose release failed after the seal, though such a run is never marked stopped: the save of that checkpoint releases the recording (Cycle 0047 row 140). The run's later saves (an explanation or a learning summary after the stop, Retry storage, its final checkpoint) may follow a removal by another window then, and none of them writes the study back without its recording: the library refuses an archive whose study left with its recording ({@link StudyRemovedWithItsRecordingError}, Cycle 0047 row 162).
 * A run whose final save fails keeps holding its recording until a later save of it succeeds (Retry storage in its window), and a window that closed without one holds it for good: a writer of this machine is then judged gone, while one on another computer can never be confirmed from here, so Delete keeps asking whether a window there still has to save it ({@link unconfirmedWriterSentences}), and the learner's Move to Trash Anyway moves the study with its recording.
 * @param look - What one look at the recording found ({@link lookAtRecording}); its seal is not looked at again.
 * A header or a record that the look could not take from a file that stands there ({@link RecordingLook.mayHaveFailedRead}) releases nothing: the read may have failed for a moment (a scanner on Windows holds the file), and the removal under its lock would move a recording another window still holds (Cycle 0047 row 239).
 * @returns `true` for a recording without a readable header, one without the record of its writer (its study was saved from a checkpoint taken after the seal, it was made by 0.2.29.0, or its record could not be written), each only when the look proves it absent, and this window's own (this window lists it and removes it by its own run state); `false` while another writer's record is kept, whether or not the study has an archive, and while the look may have failed to read the header or the record.
 * @example
 * isSealedRecordingReleased(look) // => false while another window has not saved that study from a checkpoint taken after the seal of its recording
 */
export function isSealedRecordingReleased(look: RecordingLook): boolean {
  // Only a header or a record the look proves absent releases the recording; a read that may have failed releases nothing.
  if (!look.header || !look.hasWriterRecord) return !look.mayHaveFailedRead
  // This window's own run is judged by this window, by its header's session.
  return isOwnRecording(look.header.owner)
}
