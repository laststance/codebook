import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { RECORDING_STORAGE_FORMATS } from '../constants'
import type { RetainedStudy } from '../retainedStudySchemas'

import { lookAtRecording } from './lookAtRecording'
import { removeWriterRecord } from './removeWriterRecord'

/** The state an archive names when its run had stopped as its checkpoint was taken: a run is marked stopped only after it sealed its recording ({@link StudyService.stopRecord}), and a capture that the stop overtook is dropped ({@link captureStudy}). */
const STOPPED_RUN_STATE = 'stopped'

/**
 * Removes the record of the writer of a study's sealed recording once the study is saved as its run left it after the seal, so that the recording counts as finished from then on; called by {@link LearningLibrary.saveStudy} under the storage lock, after the archive was written.
 * Why: a sealed recording keeps the record of its writer until its run has saved its study after the seal, so that another window neither lists it as what is left of a removed study nor removes it before that save ({@link recordingWriterOf}). Once the archive is there, a record that stayed would hide the recording from other windows after the archive was removed by hand.
 * Only an archive whose checkpoint was taken after the seal releases the recording: one that says its run had stopped ({@link STOPPED_RUN_STATE}), or one whose checkpoint its caller says was taken once the run's stop had ended after the seal ({@link StudyService.hasStopEndedAfterSeal}). That stop may have failed after the seal (a browser that did not close): such a run is never marked stopped, and nothing retries its stop by itself, so its recording, which takes nothing more, would otherwise stay held while its window lives, and Delete in another window would be refused (Cycle 0047 row 140). A checkpoint taken before the seal, or while a stop ran, and saved after the seal releases nothing, though the disk shows the recording sealed by then: the run's state after the seal is not saved yet, and another window that removed the study in between would see that save write it back without its recording. A run whose save after the seal fails keeps holding its recording until a later save of it (Retry storage in its window).
 * A recording that is not sealed keeps its record: its run still writes it. A record that names another recording of the id stays ({@link removeWriterRecord}). A root that is no real folder is not looked into.
 * @param learningDirectory - The private learning directory that holds the `recordings.vN` folders.
 * @param savedStudy - The archive just saved: its id, and the state of its run when its checkpoint was taken.
 * @param isTakenAfterSealedStop - Whether the archive's checkpoint was taken once the run's stop had ended after it sealed the recording, whatever state the archive names.
 * @throws What looking at a recording or removing a record throws; the caller keeps the save all the same.
 * @example
 * await removeWriterRecordsOfSealedRecordings('/storage/learning', { id: '<study id>', state: 'stopped' }, false)       // the record of the sealed '/storage/learning/recordings.v2/<study id>' is gone
 * await removeWriterRecordsOfSealedRecordings('/storage/learning', { id: '<study id>', state: 'paused-browser' }, true) // gone too: the checkpoint was taken once a stop that failed after the seal had ended
 * await removeWriterRecordsOfSealedRecordings('/storage/learning', { id: '<study id>', state: 'stopping' }, false)      // the record stays: the archive was taken before the seal
 */
export async function removeWriterRecordsOfSealedRecordings(
  learningDirectory: string,
  savedStudy: Pick<RetainedStudy, 'id' | 'state'>,
  isTakenAfterSealedStop: boolean,
): Promise<void> {
  // An archive taken before its run's stop had ended after the seal may hold a state from before the seal: the recording waits for a later save.
  if (savedStudy.state !== STOPPED_RUN_STATE && !isTakenAfterSealedStop) return
  for (const storage of RECORDING_STORAGE_FORMATS) {
    const root = join(learningDirectory, storage.directory)
    // A link that replaced a root is not followed.
    if (!(await lstat(root).catch(() => undefined))?.isDirectory()) continue
    const directory = join(root, savedStudy.id)
    const { isSealed, header, hasWriterRecord } =
      await lookAtRecording(directory)
    // Only a sealed recording whose record names it releases its record here.
    if (isSealed && header && hasWriterRecord)
      await removeWriterRecord(learningDirectory, savedStudy.id, {
        directory,
        createdAt: header.createdAt,
      })
  }
}
