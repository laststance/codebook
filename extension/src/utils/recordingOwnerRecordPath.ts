import { join } from 'node:path'

import { RECORDING_OWNERS_DIRECTORY } from '../constants'

/**
 * Names the file that keeps the full identity of the editor process writing one recording, outside the recording's own folder ({@link RECORDING_OWNERS_DIRECTORY}); called by {@link RecordingStore} when a recording starts (written), when it is sealed (removed) and when its sweep finds no recording of that id any more, by {@link LearningLibrary.removeStudy} after the study's recordings moved, and by the two that hand it to the judgement of the writer ({@link recordingWriterState} in {@link isRecordingWriterLive}): {@link recordingWriterOf} (for the library's list and removal, and for {@link recordingMayStillBeWritten}) and {@link RecordingStore}'s status of a recording another session wrote (`ownerState`).
 * @param learningDirectory - The private learning directory that holds the `recordings.vN` folders.
 * @param studyId - The recording's study id, which is also its folder's name.
 * @returns `<learning directory>/recording-owners/<study id>.json`.
 * @example
 * recordingOwnerRecordPath('/storage/learning', 'a_b') // => '/storage/learning/recording-owners/a_b.json'
 */
export function recordingOwnerRecordPath(
  learningDirectory: string,
  studyId: string,
): string {
  return join(learningDirectory, RECORDING_OWNERS_DIRECTORY, `${studyId}.json`)
}
