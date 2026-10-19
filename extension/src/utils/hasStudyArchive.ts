import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { STUDY_STORAGE_FORMATS } from '../constants'

/**
 * Says whether the study library holds an archive of a study, in any format this Codebook saves; called by {@link RecordingWriter.finish} after the seal, to tell whether the run has saved its study, and so whether the record of the recording's writer may go, and by {@link isSealedRecordingReleased}, for which a saved study releases its sealed recording.
 * Why: the record keeps a finished recording for its run until the run's first save ({@link recordingWriterOf}); before that save another window would take the recording for what is left of a removed study.
 * An entry that cannot be looked at counts as absent: the record then stays, and the study's save removes it ({@link removeWriterRecordsOfSealedRecordings}).
 * @param learningDirectory - The private learning directory that holds the study archives.
 * @param studyId - The study's id.
 * @returns `true` when an archive of the study is there, `false` otherwise.
 * @example
 * await hasStudyArchive('/storage/learning', '<study id>') // => true once '/storage/learning/<study id>.study.v3.json' is saved
 */
export async function hasStudyArchive(
  learningDirectory: string,
  studyId: string,
): Promise<boolean> {
  for (const storage of STUDY_STORAGE_FORMATS) {
    const present = await lstat(
      join(learningDirectory, `${studyId}${storage.archiveSuffix}`),
    ).then(
      () => true,
      () => false,
    )
    // One archive is enough: the newest format is looked at first.
    if (present) return true
  }
  return false
}
