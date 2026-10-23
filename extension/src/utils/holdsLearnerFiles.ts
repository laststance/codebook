import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { systemErrorCode } from './systemErrorCode'

/** The files of a test history that hold what an agent saved for the learner or what the learner decided: its learning material and its understanding marks. */
const LEARNER_FILES = ['learning-material.json', 'learning-decision.json']

/**
 * Tells whether a test history's folder holds learning material or understanding marks, so a history with no entry is never removed with them: such a folder keeps what was saved for the learner although its journal is empty (F274). Called by {@link isSealedEmptyHistory} for the list and the saved-study count, and by {@link NodeTestHistoryWriter.finish} before it removes a history that ends with no entry.
 * @param historyDirectory - The history's folder.
 * @returns `true` when either file exists, also when one cannot be inspected for another reason than its absence (a folder that may hold learner data is kept); `false` when both are absent.
 * @example await holdsLearnerFiles('/…/node-tests.v1/<study id>') // => true after a learning material was saved before the first output
 */
export async function holdsLearnerFiles(
  historyDirectory: string,
): Promise<boolean> {
  const present = await Promise.all(
    LEARNER_FILES.map((name) =>
      lstat(join(historyDirectory, name)).then(
        () => true,
        (error: unknown) => systemErrorCode(error) !== 'ENOENT',
      ),
    ),
  )
  return present.some(Boolean)
}
