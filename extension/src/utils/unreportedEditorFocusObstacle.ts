/**
 * Says that the main editor never reported the keyboard focus Codebook gave its first editor group, and what clears that.
 * {@link StudyWorkspace} gives it when the wait of its main editor measurement ends without that report: beside another editor part (an agent chat) the measurement can only tell the main editor's groups while the main editor has the focus.
 * @param waitedSeconds - How long Codebook waited for the report.
 * @returns One sentence that says what was not done and what Codebook observed, and one that says what the reader does next.
 * @example
 * unreportedEditorFocusObstacle(5)
 * // => 'The Codebook panes were not arranged: the main editor did not report the keyboard focus within 5 s after Codebook focused its first editor group. Click into a file in the main editor, then try again.'
 */
export function unreportedEditorFocusObstacle(waitedSeconds: number): string {
  return `The Codebook panes were not arranged: the main editor did not report the keyboard focus within ${waitedSeconds} s after Codebook focused its first editor group. Click into a file in the main editor, then try again.`
}
