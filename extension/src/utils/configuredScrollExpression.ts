/**
 * Serializes the one scroll of a declared click: the owned page scrolls the click target to the middle of the viewport when its centre lies outside it, as a learner scrolls before clicking.
 * Why it exists: the condition reads ({@link configuredDomExpression}) only read the page, so the click step of {@link ConfiguredBrowserRun} evaluates this once, right before it reads the click point; the selector travels as data, never as an executable slot.
 * @param selector - The click target's selector.
 * @returns The expression the page evaluates; it answers `{ scrolled: true }` after a scroll and `{ scrolled: false }` for a target already inside the viewport, or one that is missing, not unique or behind an invalid selector (the read that follows names those).
 * @example
 * configuredScrollExpression('#load-newer') // => '(function scrollClickTargetIntoView(selector) {…})("#load-newer")'
 */
export function configuredScrollExpression(selector: string): string {
  return `(${scrollClickTargetIntoView.toString()})(${JSON.stringify(selector)})`
}

/**
 * Scrolls the unique click target to the middle of the viewport when its centre lies outside it, inside the owned page; it is serialized with `toString()`, so everything it calls is declared inside it.
 * The hit test of the click point reads viewport points only, so a button below the fold would read as obscured where it lies; a target already inside the viewport is left where it is, so no scroll fires the page's own scroll or visibility handlers for it.
 * @param selector - The click target's selector.
 * @returns Whether the page was scrolled.
 * @example
 * scrollClickTargetIntoView('#load-newer') // => { scrolled: true } for a button 1,500 px down a 720 px viewport
 */
function scrollClickTargetIntoView(selector: string) {
  const element = uniqueElementOf(selector)
  // Only a unique target outside the viewport is scrolled; the read of the click point that follows names every other failure.
  if (!element || isCentreInViewport(element)) return { scrolled: false }
  element.scrollIntoView({
    block: 'center',
    inline: 'center',
    behavior: 'instant',
  })
  return { scrolled: true }

  /** The one element the selector matches; none for an invalid selector, no match or several matches. */
  function uniqueElementOf(targetSelector: string): Element | undefined {
    try {
      const elements = document.querySelectorAll(targetSelector)
      return elements.length === 1 ? elements[0] : undefined
    } catch {
      return undefined
    }
  }

  /** Whether the element's centre lies inside the viewport. */
  function isCentreInViewport(target: Element): boolean {
    const rect = target.getBoundingClientRect(),
      centreX = rect.x + rect.width / 2,
      centreY = rect.y + rect.height / 2
    return (
      centreX >= 0 &&
      centreY >= 0 &&
      centreX < innerWidth &&
      centreY < innerHeight
    )
  }
}
