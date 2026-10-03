import { isCommentAt } from './isCommentAt'

/**
 * Tells whether a line of a source text holds nothing that could run: it is blank or only a comment.
 * {@link ConfiguredBrowserRun} asks it before any input for a declared line when the sealed map was too large to scan completely, so such a stop is refused there as it is for a small map.
 * @param source - The whole source text.
 * @param line - One-based line number.
 * @returns
 * - `true` for a blank line and for a line that is only a `//` or block comment
 * - `false` for a line with code, and for a line the text does not have
 * @example
 * isBlankOrCommentLine('a()\n\n  // why\nb()', 2) // => true
 * isBlankOrCommentLine('a()\n\n  // why\nb()', 3) // => true
 * isBlankOrCommentLine('a()\n\n  // why\nb()', 4) // => false
 */
export function isBlankOrCommentLine(source: string, line: number): boolean {
  const lineText = source.split(/\r\n|\r|\n/)[line - 1]
  if (lineText === undefined) return false
  return lineText.trim() === '' || isCommentAt(lineText, 0)
}
