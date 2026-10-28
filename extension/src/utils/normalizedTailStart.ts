/**
 * Finds the earliest index of a text whose tail, once separator runs collapse to one character, is at most `maxLength` characters long.
 * Why: root spellings are compared with separator runs collapsed ({@link normalizeForPrefix}), so the windows that look for a root's start must be measured the same way, or an escaped Windows path (doubled separators) starts outside them. Called by {@link createRootHidingStage} (a held run stays under the longest spelling) and {@link hideTrailingRootPrefix} (a cut value's tail may be as long as the longest spelling).
 * @param text - The text whose tail is measured.
 * @param maxLength - The longest normalized tail allowed, inclusive.
 * @returns The index where the longest such tail starts; the text's length when even its last character exceeds `maxLength`.
 * @example
 * normalizedTailStart('C:\\\\Users\\\\a', 7) // => 4, where 'Users\\\\a' (7 characters once collapsed) begins
 * normalizedTailStart('abc', 0) // => 3
 */
export function normalizedTailStart(text: string, maxLength: number): number {
  let normalizedLength = 0
  let start = text.length
  while (start > 0) {
    // A separator directly before another one adds nothing: the run collapses to one.
    const adds =
      isSeparator(text[start - 1]) && isSeparator(text[start]) ? 0 : 1
    if (normalizedLength + adds > maxLength) break
    normalizedLength += adds
    start--
  }
  return start
}

/** Says whether a character is a path separator of either kind. */
function isSeparator(character: string | undefined): boolean {
  return character === '/' || character === '\\'
}
