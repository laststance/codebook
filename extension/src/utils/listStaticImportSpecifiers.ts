import { STATIC_PAGE_IMPORT_SCAN_MAX_CHARS } from '../constants'

/** An `import` or `export` keyword followed by white space; its position starts one candidate statement. */
const STATEMENT_KEYWORD_PATTERN = /\b(?:import|export)\s/g

/** Characters an import or export clause (`{ a, b as c }`, `* as ns`, `name`) may hold before its `from`. */
const CLAUSE_CHARACTER_PATTERN = /[\w$*{},\s]/

/**
 * Tells whether a keyword at `index` starts a statement: it follows the text start, a `;`, a `}` or a line break.
 * @param text - The script text.
 * @param index - Where the keyword starts.
 * @returns `true` when only white space (or nothing) separates the keyword from such a boundary.
 * @example startsStatement('a;\nimport x', 3) // => true
 */
function startsStatement(text: string, index: number): boolean {
  let cursor = index - 1
  while (cursor >= 0 && /\s/.test(text.charAt(cursor))) {
    // A line break before the keyword (after any white space) is a statement boundary.
    if (text.charAt(cursor) === '\n') return true
    cursor -= 1
  }
  return (
    cursor < 0 || text.charAt(cursor) === ';' || text.charAt(cursor) === '}'
  )
}

/**
 * Walks an import or export clause from `start` and returns where it ends.
 * @param text - The script text.
 * @param start - Where the clause starts.
 * @returns The index of the first character that cannot belong to a clause.
 * @example endOfClause("{ a } from 'x'", 0) // => 11
 */
function endOfClause(text: string, start: number): number {
  let cursor = start
  while (
    cursor < text.length &&
    CLAUSE_CHARACTER_PATTERN.test(text.charAt(cursor))
  )
    cursor += 1
  return cursor
}

/**
 * Reads the quoted specifier that opens at `quoteIndex`.
 * @param text - The script text.
 * @param quoteIndex - Where the opening quote is.
 * @returns The non-empty specifier closed by the same quote on the same line; `undefined` otherwise.
 * @example readQuoted("'lib'", 0) // => 'lib'
 */
function readQuoted(text: string, quoteIndex: number): string | undefined {
  const quote = text.charAt(quoteIndex)
  let end = quoteIndex + 1
  while (
    end < text.length &&
    text.charAt(end) !== quote &&
    text.charAt(end) !== '\n'
  )
    end += 1
  return text.charAt(end) === quote && end > quoteIndex + 1
    ? text.slice(quoteIndex + 1, end)
    : undefined
}

/**
 * Lists the literal specifiers of the static `import` and `export … from` statements of a script text, in a single linear pass.
 *
 * Why it exists: readiness reads page scripts that the learner's repository supplies, so a pattern that backtracks on long white space runs could freeze the extension host in `codebook_status`. This scan walks each clause once, never re-reads a region a previous keyword already walked, and reads at most {@link STATIC_PAGE_IMPORT_SCAN_MAX_CHARS} characters. Called by {@link firstBareImport}.
 * @param text - The script text; only its first {@link STATIC_PAGE_IMPORT_SCAN_MAX_CHARS} characters are read.
 * @returns The specifiers in text order.
 * @example listStaticImportSpecifiers("import { a } from 'lib'\nexport * from './x.js'") // => ['lib', './x.js']
 */
export function listStaticImportSpecifiers(text: string): string[] {
  const scanned = text.slice(0, STATIC_PAGE_IMPORT_SCAN_MAX_CHARS)
  const specifiers: string[] = []
  // Keywords inside a clause that was already walked share its outcome, so they are skipped.
  let walkedUntil = 0
  for (const match of scanned.matchAll(STATEMENT_KEYWORD_PATTERN)) {
    if (match.index < walkedUntil || !startsStatement(scanned, match.index))
      continue
    const clauseStart = match.index + match[0].length
    walkedUntil = endOfClause(scanned, clauseStart)
    const quote = scanned.charAt(walkedUntil)
    if (quote !== "'" && quote !== '"') continue
    const clause = scanned.slice(clauseStart, walkedUntil).trimEnd()
    // A non-empty clause is only an import when it ends in `from`.
    if (clause !== '' && !clause.endsWith('from')) continue
    const specifier = readQuoted(scanned, walkedUntil)
    if (specifier !== undefined) specifiers.push(specifier)
  }
  return specifiers
}
