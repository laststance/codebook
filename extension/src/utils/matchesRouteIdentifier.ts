/** One character that may continue a JavaScript or TypeScript identifier written in ASCII: a letter, a digit, `_` or `$`. */
const IDENTIFIER_CHARACTER = /[\w$]/

/**
 * Tells whether a lowercased source line holds a route identifier as a whole identifier, not inside a longer name.
 * Why: Cycle 0124 (F3, Issue #318) — `get`, the last part of `chrome.bookmarks.get`, matched 178 lines of P06's `fullpage.js` as a substring (`getElementById`, `targetId`) but only 14 as an identifier, and the functions whose names hold `get` filled a Wiki question's excerpt.
 * The identifier's own dots stay part of it, so `state.clipboard` matches in `this.state.clipboard.id`.
 * Called by {@link selectWikiSourceLines} (its line scores and kept lines) and by {@link longFunctionGroupsOf}'s callers through {@link distinctRouteIdentifierCount}.
 * @param lowercasedLine - One source line, lowercased.
 * @param term - A lowercased route identifier (letters, digits, `_`, `$` and dots), as `routeTermsOf` returns it.
 * @returns `true` when the identifier occurs with no identifier character right before or right after it; `false` otherwise, and for an empty identifier.
 * @example
 * matchesRouteIdentifier('const [node] = await chrome.bookmarks.get(id)', 'get') // => true
 * matchesRouteIdentifier('document.getelementbyid(x)', 'get') // => false
 * matchesRouteIdentifier('if (this.state.clipboard.id) {', 'state.clipboard') // => true
 */
export function matchesRouteIdentifier(
  lowercasedLine: string,
  term: string,
): boolean {
  if (!term) return false
  // Every occurrence is checked: an embedded one (`targetId`) may come before a whole one (`.get(`).
  for (
    let start = lowercasedLine.indexOf(term);
    start !== -1;
    start = lowercasedLine.indexOf(term, start + 1)
  ) {
    const before = lowercasedLine[start - 1]
    const after = lowercasedLine[start + term.length]
    if (
      (before === undefined || !IDENTIFIER_CHARACTER.test(before)) &&
      (after === undefined || !IDENTIFIER_CHARACTER.test(after))
    )
      return true
  }
  return false
}
