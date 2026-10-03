/**
 * Tells whether the text of one line, from a column on, is only a comment, so that a source map position there marks nothing that could run.
 * {@link createBundleVerifier} asks this of the generated module for every mapping it scans: a development build keeps comments and maps them (Next's webpack maps `// Auth.js error messages…` to its original line), and the binding rule must not count such a line as code. Preparation also asks it of the original source when the map was too large to scan.
 * @param lineText - One line of text without its line break; `undefined` for a line the text does not have.
 * @param column - Zero-based column the position names on that line.
 * @returns
 * - `true` when, after any whitespace, the rest of the line is a `//` comment, or a block comment that runs past the line or is followed only by whitespace or a `//` comment
 * - `false` for code at or after the column, for a blank remainder (nothing proves it is not code), and for a line the text does not have
 * @example
 * isCommentAt('        // Auth.js error messages', 8) // => true
 * isCommentAt('  return user // why', 2) // => false: code comes first
 * isCommentAt('  return user', 2) // => false
 */
export function isCommentAt(
  lineText: string | undefined,
  column: number,
): boolean {
  const rest = lineText?.slice(column).trimStart() ?? ''
  if (rest.startsWith('//')) return true
  if (!rest.startsWith('/*')) return false
  const end = rest.indexOf('*/', 2)
  // A block comment that does not end on this line covers the rest of it.
  if (end < 0) return true
  const after = rest.slice(end + 2).trimStart()
  return after === '' || isCommentAt(after, 0)
}
