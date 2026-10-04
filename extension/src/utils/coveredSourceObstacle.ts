/**
 * Names the tab that is in front of the captured source in its editor group, and says how to clear it.
 * {@link StudyWorkspace} gives it as the cause when the live or replay arrangement cannot be confirmed because the source group shows another tab (an image the learner opened there, for example).
 * @param tabName - The covering tab as the learner sees it in the tab strip.
 * @param viewColumn - The editor group that holds the captured source.
 * @returns One sentence that says what Codebook observed, and one that says what the reader does next.
 * @example
 * coveredSourceObstacle('logo.png', 2)
 * // => 'The tab "logo.png" is in front of the captured source in editor group 2. Close that tab or select the captured source\'s tab, then restore the layout again.'
 */
export function coveredSourceObstacle(
  tabName: string,
  viewColumn: number,
): string {
  return `The tab "${tabName}" is in front of the captured source in editor group ${viewColumn}. Close that tab or select the captured source's tab, then restore the layout again.`
}
