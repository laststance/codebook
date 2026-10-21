/**
 * Words the learner's line for a failed write of a study's archive: "History not saved: …", the one sentence every path that tells this failure shows; called by `persistArchive` and `reportUnsavedHistory` of {@link StudyWorkspace}.
 * @param error - What the write or the checkpoint threw.
 * @returns An error whose string form is `Error: History not saved: ` followed by the string form of `error`.
 * @example
 * String(unsavedHistoryLine(new Error('disk is read-only'))) // => 'Error: History not saved: Error: disk is read-only'
 */
export function unsavedHistoryLine(error: unknown): Error {
  return new Error(`History not saved: ${String(error)}`)
}
