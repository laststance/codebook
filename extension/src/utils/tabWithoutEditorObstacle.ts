/**
 * Names the focused text tab that stops a presentation change because the editor reports no text editor for it, and says how to clear it.
 * {@link StudyWorkspace} gives it when a selection or a restore meets such a tab: a captured-source tab an earlier session left that the editor would not close, or one of another workspace. Its focus could not be given back after the panes are arranged.
 * @param tabName - The tab as the learner sees it in the tab strip.
 * @param viewColumn - The editor group that holds the tab.
 * @returns One sentence that says what was not done and what Codebook observed, and one that says what the reader does next.
 * @example
 * tabWithoutEditorObstacle('Captured-login-form.tsx', 1)
 * // => 'The presentation was not changed: the focused tab "Captured-login-form.tsx" in editor group 1 has no text editor, so the focus could not be given back to it. Close that tab or click into another editor, then try again.'
 */
export function tabWithoutEditorObstacle(
  tabName: string,
  viewColumn: number,
): string {
  return `The presentation was not changed: the focused tab "${tabName}" in editor group ${viewColumn} has no text editor, so the focus could not be given back to it. Close that tab or click into another editor, then try again.`
}
