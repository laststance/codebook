/**
 * Says that the Application pane painted no frame of a live capture within the paint bound, and what makes a new run possible.
 * {@link BrowserViewport} ends a live run with it when the pane's renderer never confirms a frame the run requires: the renderer paints nothing while another tab covers the pane or while the editor window is hidden, minimized or covered.
 * @param waitedSeconds - The paint bound the capture waited for.
 * @returns One sentence that says what was not done and what Codebook observed, and one that says what the reader does next.
 * @example
 * unpaintedApplicationReason(3)
 * // => 'The capture was not shown: the Application pane painted no frame within 3 s. Make the editor window and the Application pane visible, then start a new run.'
 */
export function unpaintedApplicationReason(waitedSeconds: number): string {
  return `The capture was not shown: the Application pane painted no frame within ${waitedSeconds} s. Make the editor window and the Application pane visible, then start a new run.`
}
