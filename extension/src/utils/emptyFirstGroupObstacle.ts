/**
 * Says that the main editor's first group is empty beside another editor part, so the editor cannot report that this group has the keyboard, and what clears that.
 * {@link StudyWorkspace} gives it at once, instead of waiting for a report, when its main editor measurement would have to focus an empty first group beside another editor part (an agent chat): no text editor and no Codebook pane reports the focus there, and the editor keeps naming the group it named before (row 610). The group may be the learner's own, kept by `workbench.editor.closeEmptyGroups` off, or an earlier window's leftover that its record could not prove; it is never unlocked, closed or merged.
 * @returns One sentence that says what was not done and why, naming the group, and one that says what the reader does next.
 * @example
 * emptyFirstGroupObstacle()
 * // => 'The Codebook panes were not arranged: the first editor group (column 1) is empty, and beside the chat the editor reports no keyboard focus in an empty group. Open a file in that group or close it, then try again.'
 */
export function emptyFirstGroupObstacle(): string {
  return 'The Codebook panes were not arranged: the first editor group (column 1) is empty, and beside the chat the editor reports no keyboard focus in an empty group. Open a file in that group or close it, then try again.'
}
