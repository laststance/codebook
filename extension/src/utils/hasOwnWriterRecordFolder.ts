import { join } from 'node:path'

import { RECORDING_OWNERS_DIRECTORY } from '../constants'

import { isFolderOfItsOwn } from './isFolderOfItsOwn'

/**
 * Says whether the folder of writer records ({@link RECORDING_OWNERS_DIRECTORY}) is a real folder of the learning directory, before a record in it is written, read or removed; called by {@link RecordingStore} (the write at a recording's start, the sweep), by {@link removeWriterRecord} (at a seal and with a study) and by {@link readRecordingWriterRecord} (for the judgement of a writer and {@link lookAtRecording}).
 * Why: a path through a link or a junction at that folder's place would write, read or delete a file the link leads to, which is no record of Codebook's. Such a folder is no folder of records: nothing is written there (the recording is judged by its header, as one of 0.2.29.0 is), nothing is removed, and a read finds no record.
 * Limit: this look and the write, read or removal it precedes are separate steps, and the write and the removal go by path. A program that puts a link at the folder's place in between still leads that one step through the link. Only a program with write access to the learning directory can do that, and that directory is this user's private extension storage (made with mode 0700 on macOS and Linux, a folder of this user's own profile on Windows): only this user's own processes can use the race, and they can write there anyway. A read is safe all the same: the record itself is opened without following a link ({@link readWikiRegularFile}).
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
