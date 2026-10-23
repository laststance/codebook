/**
 * Names a learner-owned preview tab that stops a Study arrangement and says how to clear it, so presentation selection and replay entry share one obstacle text.
 * {@link StudyWorkspace} calls it when a foreign preview blocks placing panes or when the main editor never reports focus beside such a preview.
 * @param tabName - The blocking tab as the learner sees it (a text tab's file name, otherwise its label).
 * @param viewColumn - The editor group that holds the tab.
 * @returns The obstacle text, always containing "foreign preview", the tab's name, its group and the remedy.
 * @example
 * foreignPreviewObstacle('login-form.tsx', 1)
 * // => 'A destination group contains a foreign preview: "login-form.tsx" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.'
 */
export function foreignPreviewObstacle(
  tabName: string,
  viewColumn: number,
): string {
  return `A destination group contains a foreign preview: "${tabName}" in editor group ${viewColumn}. Close that tab, or keep it open (double-click its tab), then try again.`
}

/**
 * Reads the tab and group out of a foreign-preview obstacle text, so a refusal that reached the reader only as words (a playback controller's failure reason, a test replay's open cause) can still be answered with a choice; called by {@link StudyWorkspace}'s `resolveForeignPreviewRefusal`.
 * @param text - Any text that may contain a {@link foreignPreviewObstacle} sentence.
 * @returns The blocking tab's name and its editor group; `undefined` when the text holds no such sentence.
 * @example
 * parseForeignPreviewObstacle('Error: A destination group contains a foreign preview: "login-form.tsx" in editor group 1. Close that tab, …')
 * // => { tabName: 'login-form.tsx', viewColumn: 1 }
 */
export function parseForeignPreviewObstacle(
  text: string,
): { tabName: string; viewColumn: number } | undefined {
  const match =
    /A destination group contains a foreign preview: "([^"]+)" in editor group (\d+)\./.exec(
      text,
    )
  return match
    ? { tabName: match[1]!, viewColumn: Number(match[2]) }
    : undefined
}
