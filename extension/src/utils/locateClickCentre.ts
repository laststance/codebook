/**
 * In-page function that finds where a trusted click on the retained element lands: it scrolls the element into view and answers its centre, or why it cannot be clicked.
 * Sent to the extension surface by {@link createChromeExtensionActionExecutor} through `Runtime.callFunctionOn` with the element's object id; it must stay self-contained because it is serialized with `toString()`.
 * @returns
 * - `{ ready: true, x, y }` with the viewport coordinates of the element's centre
 * - `{ ready: false, reason }` when the element is detached, has no size or is covered by another element
 * @example
 * locateClickCentre.call(button) // => { ready: true, x: 120, y: 48 }
 */
export function locateClickCentre(
  this: Element,
): { ready: true; x: number; y: number } | { ready: false; reason: string } {
  if (!this.isConnected) return { ready: false, reason: 'element-detached' }
  // An instant scroll: a smooth one would still move while the centre is measured.
  this.scrollIntoView({
    block: 'center',
    inline: 'center',
    behavior: 'instant',
  })
  const rect = this.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0)
    return { ready: false, reason: 'element-has-no-size' }
  const x = rect.x + rect.width / 2
  const y = rect.y + rect.height / 2
  const hit = document.elementFromPoint(x, y)
  if (hit !== this && !this.contains(hit))
    return { ready: false, reason: 'element-obscured' }
  return { ready: true, x, y }
}
