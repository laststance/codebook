import { join } from 'node:path'

import { RECORDING_OWNERS_DIRECTORY } from '../constants'

/**
 * Names the file that keeps the full identity of the editor process writing one recording, outside the recording's own folder ({@link RECORDING_OWNERS_DIRECTORY}); called by {@link RecordingStore} when a recording starts (written), by {@link removeWriterRecord} at a recording's seal and after a study's recordings moved, and by {@link readRecordingWriterRecord}, which hands it to the judgement of the writer ({@link recordingWriterState}) and to {@link lookAtRecording}.
 * The file is kept by the study id, which recordings of several formats can share: it names the recording it was written for, and counts only for that one ({@link readRecordingWriterRecord}).
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
