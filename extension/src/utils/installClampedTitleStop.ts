/**
 * Makes a heading that a line clamp cuts a tab stop in a webview document, so a keyboard or touch learner can focus it and read it whole (the style shows a focused heading unclamped); runs in the page, so it reads nothing outside its arguments.
 * Called by {@link testOutputHtml} for the Application pane's test line, as the Study pane does for its titles (F144).
 * The heading is measured again after the page's layout settles and when the window is resized; a focused heading is not measured, because it is shown whole and would read as fitting.
 * @param headingId - The id of the clamped heading.
 * @example installClampedTitleStop('test-output-test')
 */
export function installClampedTitleStop(headingId: string): void {
  const heading = document.getElementById(headingId)
  if (!heading) return
  const offer = (): void => {
    if (document.activeElement === heading) return
    if (heading.scrollHeight > heading.clientHeight) heading.tabIndex = 0
    else heading.removeAttribute('tabindex')
  }
  window.addEventListener('resize', offer)
  // The first measure waits for a frame, when the document's styles have laid the heading out.
  requestAnimationFrame(offer)
  offer()
}
