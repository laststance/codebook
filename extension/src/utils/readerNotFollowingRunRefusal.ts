/**
 * Says that a run was not started because the open reader shows a saved study or a recording instead of the current run, and how the agent brings the reader back.
 * {@link StudyService} ends the run with it before the application gets any input: such a reader displays none of the run's captures, so the run would fail at its first one ("Learner is viewing history; current capture was not displayed.").
 * @param contentRevision - The reader's content revision, which `codebook_return_current` takes as `expectedRevision`.
 * @returns One sentence that says what was not done and what Codebook observed, and one that says what the agent does next.
 * @example
 * readerNotFollowingRunRefusal(7)
 * // => 'The run was not started: the reader shows saved history and does not follow the current run (reader.followingCurrentRun is false), so none of this run\'s captures would be displayed. Call codebook_return_current with expectedRevision 7 (reader.contentRevision), then start again with a new key.'
 */
export function readerNotFollowingRunRefusal(contentRevision: number): string {
  return `The run was not started: the reader shows saved history and does not follow the current run (reader.followingCurrentRun is false), so none of this run's captures would be displayed. Call codebook_return_current with expectedRevision ${contentRevision} (reader.contentRevision), then start again with a new key.`
}
