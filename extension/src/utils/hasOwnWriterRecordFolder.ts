import { join } from 'node:path'

import { RECORDING_OWNERS_DIRECTORY } from '../constants'

import { isFolderOfItsOwn } from './isFolderOfItsOwn'

/**
 * Says whether the folder of writer records ({@link RECORDING_OWNERS_DIRECTORY}) is a real folder of the learning directory, before a record in it is written, read or removed; called by {@link RecordingStore} (the write at a recording's start, the removal at its seal, the sweep), by {@link removeWriterRecord}, by {@link lookAtRecording} and by the judgement of a writer ({@link recordingWriterState}).
 * Why: a path through a link or a junction at that folder's place would write, read or delete a file the link leads to, which is no record of Codebook's. Such a folder is no folder of records: nothing is written there (the recording is judged by its header, as one of 0.2.29.0 is), nothing is removed, and a read finds no record.
 * @param learningDirectory - The private learning directory that holds the `recordings.vN` folders.
 * @returns `true` for a real directory that is its parent's own entry ({@link isFolderOfItsOwn}); `false` for a link, a junction, a file, nothing, and a path that cannot be looked at.
 * @example await hasOwnWriterRecordFolder('/storage/learning') // => false while `recording-owners` is a link
 */
export async function hasOwnWriterRecordFolder(
  learningDirectory: string,
): Promise<boolean> {
  return isFolderOfItsOwn(
    join(learningDirectory, RECORDING_OWNERS_DIRECTORY),
  ).catch(() => false)
}
