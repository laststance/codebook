import { StudyError } from '../errors'

/**
 * Words the refusal of a Node test history reference that names no history of this workspace.
 *
 * Why: an agent that mistypes one character of a study id, or sends another workspace's, read the store's raw `ENOENT` as `RUNTIME_FAILED` ("The study operation failed.") with a recovery about owned resources and clicks, so it could not tell that only its reference was wrong (Cycle 0052 task 60).
 * Trigger: the `codebook://node-history/<studyId>` resources ({@link readResource}) and {@link StudyService.explainNodeHistory} call it when the store holds no folder for the id.
 *
 * @param studyId - The study id the agent sent.
 * @returns A `NOT_FOUND` error that names the id and where to copy a valid one.
 * @example
 * throw unknownNodeHistoryError('8ec11caa-db39-4835-bc6c-c3810d95afcc_81e3d2d6-6bb6-4735-a560-e69b06d7b946')
 * // message: 'No Node test history 8ec11caa-…-e69b06d7b946 is saved in this workspace. Read codebook://node-history and copy the studyId or historyUri of the history you mean.'
 */
export function unknownNodeHistoryError(studyId: string): StudyError {
  return new StudyError(
    'NOT_FOUND',
    `No Node test history ${studyId} is saved in this workspace. Read codebook://node-history and copy the studyId or historyUri of the history you mean.`,
  )
}
