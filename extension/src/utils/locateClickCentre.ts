/**
 * In-page function that finds where a trusted click on the retained element lands: it scrolls the element into view and answers the centre of its first box the click would reach, or why it cannot be clicked.
 * Sent to the extension surface by {@link createChromeExtensionActionExecutor} through `Runtime.callFunctionOn` with the element's object id; it must stay self-contained because it is serialized with `toString()`.
 * A wrapped inline element (a link over two lines) has one box per line, and the centre of its bounding box can fall between them on the parent, so each box's centre is tried in order.
 * @returns
 * - `{ ready: true, x, y }` with the viewport coordinates of the centre of the first box where the element itself is hit
 * - `{ ready: false, reason }` when the element is detached, has no size or is covered by another element at every box
 * @example
 * locateClickCentre.call(button) // => { ready: true, x: 120, y: 48 }
 * locateClickCentre.call(wrappedLink) // => { ready: true, x: 417, y: 276 } (the centre of its first line)
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
  const boxes = Array.from(this.getClientRects()).filter(
    (box) => box.width > 0 && box.height > 0,
  )
  if (boxes.length === 0) return { ready: false, reason: 'element-has-no-size' }
  // The first box whose centre hits the element (or one of its children) takes the click.
  for (const box of boxes) {
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const hit = document.elementFromPoint(x, y)
    if (hit === this || this.contains(hit)) return { ready: true, x, y }
  }
  return { ready: false, reason: 'element-obscured' }
}
