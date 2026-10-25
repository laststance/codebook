import type { NodeTestHistoryStore } from '../nodeTestHistoryStore'

import { unknownNodeHistoryError } from './unknownNodeHistoryError'

/**
 * Runs one operation on a saved Node test history, refusing a study id this workspace holds no history for as unknown: before the operation, and when the history's folder is gone after it, whether it failed or answered.
 * Why: a history removed while it is read (moved to the Trash from Saved studies, for example) failed with the store's raw `ENOENT` as `RUNTIME_FAILED`, the answer task 60 replaced for an unknown id (Cycle 0052 task 75).
 * Called by the `codebook://node-history/<studyId>` resources ({@link readResource}) and {@link StudyService.explainNodeHistory}.
 * @param store - The workspace's history store.
 * @param studyId - The study id the agent sent.
 * @param operation - The read or the save.
 * @returns What the operation returned.
 * @throws The `NOT_FOUND` error of {@link unknownNodeHistoryError} for an id without a history folder, before or after the operation, also when it answered; otherwise what the operation threw.
 * @example
 * const history = await withKnownNodeHistory(store, studyId, () => store.read(studyId))
 */
export async function withKnownNodeHistory<Value>(
  store: Pick<NodeTestHistoryStore, 'holdsHistoryFolder'>,
  studyId: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  // An id this workspace holds no history for (mistyped, or another workspace's) is a reference to correct, not a failed study operation.
  if (!store.holdsHistoryFolder(studyId)) throw unknownNodeHistoryError(studyId)
  let result: Value
  try {
    result = await operation()
  } catch (error) {
    // A history removed while the operation ran is as unknown as one never saved.
    if (!store.holdsHistoryFolder(studyId))
      throw unknownNodeHistoryError(studyId)
    throw error
  }
  // So is one removed right after it answered: what it read belongs to a history that no longer exists (Cycle 0052 tasks 78, 86, 90, 94, 95).
  if (!store.holdsHistoryFolder(studyId)) throw unknownNodeHistoryError(studyId)
  return result
}
