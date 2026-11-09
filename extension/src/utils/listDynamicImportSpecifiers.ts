import { STATIC_PAGE_IMPORT_SCAN_MAX_CHARS } from '../constants'

/** Characters that may precede a dynamic import's keyword without making it a different name: `reimport(` and `a.import(` are no dynamic import. */
const IDENTIFIER_PART_PATTERN = /[\w$.]/

/**
 * Skips a quoted string or template literal that opens at `start`.
 * @param text - The script text.
 * @param start - Where the opening quote (`'`, `"` or a backtick) is.
 * @returns The index just after the closing quote, or the text length when it never closes.
 * @example skipQuoted("'ab' x", 0) // => 4
 */
function skipQuoted(text: string, start: number): number {
  const quote = text.charAt(start)
  let cursor = start + 1
  while (cursor < text.length) {
    const character = text.charAt(cursor)
    // A backslash escapes the next character, including a quote.
    if (character === '\\') cursor += 2
    else if (character === quote) return cursor + 1
    // A plain string ends at a line break; a template may span lines.
    else if (character === '\n' && quote !== '`') return cursor + 1
    else cursor += 1
  }
  return text.length
}

/**
 * Reads `( 'specifier' )` after an `import` keyword.
 * @param text - The script text.
 * @param start - The index just after the keyword.
 * @returns The literal specifier and where the call ends; `undefined` when the call is not `import('literal')`.
 * @example readImportCall("('lib')", 0) // => { specifier: 'lib', end: 7 }
 */
function readImportCall(
  text: string,
  start: number,
): { specifier: string; end: number } | undefined {
  const skipSpace = (from: number): number => {
    let cursor = from
    while (cursor < text.length && /\s/.test(text.charAt(cursor))) cursor += 1
    return cursor
  }
  const open = skipSpace(start)
  if (text.charAt(open) !== '(') return undefined
  const quoteIndex = skipSpace(open + 1)
  const quote = text.charAt(quoteIndex)
  if (quote !== "'" && quote !== '"') return undefined
  const close = text.indexOf(quote, quoteIndex + 1)
  const specifier = close < 0 ? '' : text.slice(quoteIndex + 1, close)
  if (specifier === '' || specifier.includes('\n')) return undefined
  const end = skipSpace(close + 1)
  return text.charAt(end) === ')' ? { specifier, end: end + 1 } : undefined
}

/**
 * Skips a comment, string or template literal that starts at `cursor`.
 * @param text - The script text.
 * @param cursor - The index to look at.
 * @returns The index just after the skipped region; `undefined` when `cursor` starts no such region.
 * @example skipNonCode('// a\nb', 0) // => 5
 * @example skipNonCode('abc', 0) // => undefined
 */
function skipNonCode(text: string, cursor: number): number | undefined {
  const character = text.charAt(cursor)
  const next = text.charAt(cursor + 1)
  if (character === "'" || character === '"' || character === '`')
    return skipQuoted(text, cursor)
  if (character !== '/' || (next !== '/' && next !== '*')) return undefined
  // A line comment runs to the line break, a block comment to its closing marker.
  const end = text.indexOf(next === '/' ? '\n' : '*/', cursor + 2)
  if (end < 0) return text.length
  return next === '/' ? end + 1 : end + 2
}

/**
 * Lists the literal specifiers of the dynamic `import('…')` calls that are code, in a single linear pass.
 *
 * Why it exists: a regex over the whole text also matches `import('lib')` inside a comment or a string, so a valid page would be refused as needing a bundler. This scan skips `//` and block comments and string and template literals, never re-reads a region, and reads at most {@link STATIC_PAGE_IMPORT_SCAN_MAX_CHARS} characters. Called by {@link firstBareImport}.
 * @param text - The script text; only its first {@link STATIC_PAGE_IMPORT_SCAN_MAX_CHARS} characters are read.
 * @returns The specifiers in text order.
 * @example listDynamicImportSpecifiers("// import('a')\nimport('b')") // => ['b']
 */
export function listDynamicImportSpecifiers(text: string): string[] {
  const scanned = text.slice(0, STATIC_PAGE_IMPORT_SCAN_MAX_CHARS)
  const specifiers: string[] = []
  let cursor = 0
  while (cursor < scanned.length) {
    const afterNonCode = skipNonCode(scanned, cursor)
    if (afterNonCode !== undefined) {
      cursor = afterNonCode
      continue
    }
    const isKeyword =
      scanned.startsWith('import', cursor) &&
      !IDENTIFIER_PART_PATTERN.test(scanned.charAt(cursor - 1))
    const call = isKeyword
      ? readImportCall(scanned, cursor + 'import'.length)
      : undefined
    if (call !== undefined) specifiers.push(call.specifier)
    cursor = call?.end ?? cursor + 1
  }
  return specifiers
}
