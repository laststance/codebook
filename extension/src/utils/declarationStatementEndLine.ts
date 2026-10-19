/** A bracket, a template literal or a template substitution the scan is inside. */
type Frame = '(' | '[' | '{' | '`' | '${'

/** Where the scan of one statement stands between two lines: the open brackets and template literals, an open quote, an open block comment. */
interface StatementScan {
  frames: Frame[]
  quote?: "'" | '"'
  inBlockComment: boolean
}

/** What one token did: `line-comment` ends the line's code, `ended` is a `;` outside every bracket, `undecided` is a bracket that closes what the statement did not open. */
type TokenOutcome = 'line-comment' | 'ended' | 'undecided' | undefined

/** One line of the statement as scanned: its code without comments (strings kept) and what ended the scan of it early. */
interface LineScan {
  code: string
  outcome: TokenOutcome
}

/** Where a line leaves the statement. */
type LineVerdict = 'ends' | 'continues' | 'undecided'

const CODE_TOKEN = /\/\/|\/\*|['"`]|[([{)\]}]|;/g
const TEMPLATE_TOKEN = /\\[\s\S]|`|\$\{/g
const BLOCK_COMMENT_END = /\*\//g
const QUOTE_TOKEN: Readonly<Record<"'" | '"', RegExp>> = {
  "'": /\\[\s\S]|'/g,
  '"': /\\[\s\S]|"/g,
}
/** A line whose code ends with an operator, `=>`, `=`, `,`, `.` or an opening bracket goes on on the next line; `++` and `--` end an expression. */
const CONTINUING_END = /(?:[=+\-*%&|^<>?:,.([{]|=>)$/
const COMPLETE_END = /(?:\+\+|--)$/
/** A line that is blank or begins a comment does not decide whether the statement goes on. */
const NOT_DECIDING_LINE = /^\s*(?:$|\/\/|\/\*|\*)/
/** A next line that begins with `.`, `?`, `:` or a binary operator continues the statement before it. */
const CONTINUING_START = /^\s*[.?:+\-*/%&|^=<>]/
const OUTCOME_VERDICT = new Map<TokenOutcome, LineVerdict>([
  ['ended', 'ends'],
  ['undecided', 'undecided'],
])

/**
 * Pops the frame a closing bracket closes; called by the code tokens `)`, `]` and `}`.
 * @param scan - The scan.
 * @param openers - The frames this bracket can close (`}` closes a block and a template substitution).
 * @returns `undecided` when the innermost frame is not one of them (the bracket closes something the statement did not open, such as the block around it); `undefined` otherwise.
 * @example
 * closeFrame({ frames: ['('], inBlockComment: false }, ['(']) // => undefined, frames []
 */
function closeFrame(
  scan: StatementScan,
  openers: readonly Frame[],
): TokenOutcome {
  const innermost = scan.frames.at(-1)
  if (!innermost || !openers.includes(innermost)) return 'undecided'
  scan.frames.pop()
  return undefined
}

/** What each code token does to the scan. */
const CODE_EFFECTS: Readonly<
  Record<string, (scan: StatementScan) => TokenOutcome>
> = {
  '//': () => 'line-comment',
  '/*': (scan) => {
    scan.inBlockComment = true
    return undefined
  },
  "'": (scan) => {
    scan.quote = "'"
    return undefined
  },
  '"': (scan) => {
    scan.quote = '"'
    return undefined
  },
  '`': (scan) => {
    scan.frames.push('`')
    return undefined
  },
  '(': (scan) => {
    scan.frames.push('(')
    return undefined
  },
  '[': (scan) => {
    scan.frames.push('[')
    return undefined
  },
  '{': (scan) => {
    scan.frames.push('{')
    return undefined
  },
  ')': (scan) => closeFrame(scan, ['(']),
  ']': (scan) => closeFrame(scan, ['[']),
  '}': (scan) => closeFrame(scan, ['{', '${']),
  ';': (scan) => (scan.frames.length === 0 ? 'ended' : undefined),
}

/**
 * Chooses the pattern of the next token that matters where the scan stands; called by {@link nextToken}.
 * @param scan - The scan.
 * @returns The end of a block comment, the closing quote of a string, the end or a substitution of a template literal, or any code token.
 * @example
 * tokenPattern({ frames: ['`'], inBlockComment: false }) // => TEMPLATE_TOKEN
 */
function tokenPattern(scan: StatementScan): RegExp {
  if (scan.inBlockComment) return BLOCK_COMMENT_END
  if (scan.quote) return QUOTE_TOKEN[scan.quote]
  return scan.frames.at(-1) === '`' ? TEMPLATE_TOKEN : CODE_TOKEN
}

/**
 * Finds the next token that matters on a line from a position; called by {@link scanLine}.
 * @param lineText - The line.
 * @param position - Where to search from.
 * @param scan - The scan, which decides what matters.
 * @returns The token's text and the position after it, or `undefined` when the rest of the line holds none.
 * @example
 * nextToken('f(a)', 0, scan) // => { text: '(', end: 2 }
 */
function nextToken(
  lineText: string,
  position: number,
  scan: StatementScan,
): { text: string; end: number } | undefined {
  const pattern = tokenPattern(scan)
  pattern.lastIndex = position
  const match = pattern.exec(lineText)
  return match
    ? { text: match[0], end: match.index + match[0].length }
    : undefined
}

/**
 * Applies a token inside a string: an escape is skipped, the quote closes the string; called by {@link applyToken}.
 * @example
 * quoteToken(scan, "'") // scan.quote === undefined
 */
function quoteToken(scan: StatementScan, token: string): TokenOutcome {
  // An escape is two characters long; the closing quote is one.
  if (token.length === 1) scan.quote = undefined
  return undefined
}

/**
 * Applies a token inside a template literal: the backtick closes it, `${` opens a substitution, an escape is skipped; called by {@link applyToken}.
 * @example
 * templateToken(scan, '${') // scan.frames ends with '${'
 */
function templateToken(scan: StatementScan, token: string): TokenOutcome {
  if (token === '`') scan.frames.pop()
  else if (token === '${') scan.frames.push('${')
  return undefined
}

/**
 * Applies one token to the scan; called by {@link scanLine}.
 * @param scan - The scan, changed in place.
 * @param token - A token {@link nextToken} found where the scan stands.
 * @returns What the token did ({@link TokenOutcome}).
 * @example
 * applyToken(scan, ';') // => 'ended' outside every bracket
 */
function applyToken(scan: StatementScan, token: string): TokenOutcome {
  // In a block comment the only token is its end.
  if (scan.inBlockComment) {
    scan.inBlockComment = false
    return undefined
  }
  if (scan.quote) return quoteToken(scan, token)
  if (scan.frames.at(-1) === '`') return templateToken(scan, token)
  return CODE_EFFECTS[token]!(scan)
}

/**
 * Keeps the code of a scanned piece of a line: nothing inside a block comment, and no comment opener; called by {@link scanLine} before the token at the piece's end is applied.
 * @example
 * codeOf('f() //', { frames: [], inBlockComment: false }, '//') // => 'f() '
 */
function codeOf(piece: string, scan: StatementScan, token: string): string {
  if (scan.inBlockComment) return ''
  return token === '//' || token === '/*'
    ? piece.slice(0, piece.length - token.length)
    : piece
}

/**
 * Scans one line of a statement; called by {@link declarationStatementEndLine} for each line from the declaration on.
 * @param lineText - The line (for the first line, from the declaration's keyword on).
 * @param scan - The scan, carried from line to line.
 * @returns The line's code and what ended its scan early, if anything.
 * @example
 * scanLine('const total = useMemo(() => {', scan) // => { code: 'const total = useMemo(() => {', outcome: undefined }, scan.frames ['(', '{']
 */
function scanLine(lineText: string, scan: StatementScan): LineScan {
  let position = 0,
    code = ''
  for (
    let token = nextToken(lineText, position, scan);
    token;
    token = nextToken(lineText, position, scan)
  ) {
    code += codeOf(lineText.slice(position, token.end), scan, token.text)
    position = token.end
    const outcome = applyToken(scan, token.text)
    if (outcome) return { code, outcome }
  }
  return {
    code: code + codeOf(lineText.slice(position), scan, ''),
    outcome: undefined,
  }
}

/**
 * Says whether a statement goes on after a line whose scan ended normally; called by {@link lineVerdict}.
 * @param scan - The scan after the line.
 * @param code - The line's code.
 * @param lines - Every line of the source, for the next line that decides.
 * @param line - The one-based line just scanned.
 * @returns `true` while a bracket, a template literal, a string or a block comment is open, the line holds no code, its code ends with a continuing token, or the next line that decides begins with one.
 * @example
 * statementGoesOn(scan, 'const rows = items', ['const rows = items', '  .filter(isOpen)'], 1) // => true
 */
function statementGoesOn(
  scan: StatementScan,
  code: string,
  lines: readonly string[],
  line: number,
): boolean {
  const tail = code.trimEnd(),
    nextDeciding = lines
      .slice(line)
      .find((text) => !NOT_DECIDING_LINE.test(text))
  return [
    scan.frames.length > 0,
    scan.quote !== undefined,
    scan.inBlockComment,
    tail.trim() === '',
    CONTINUING_END.test(tail) && !COMPLETE_END.test(tail),
    CONTINUING_START.test(nextDeciding ?? ''),
  ].some(Boolean)
}

/**
 * Decides where one scanned line leaves the statement; called by {@link declarationStatementEndLine}.
 * @returns `ends` for a `;` outside every bracket or a line after which nothing continues, `undecided` for a bracket that closes what the statement did not open, `continues` otherwise.
 * @example
 * lineVerdict({ code: '}, [items])', outcome: undefined }, scan, lines, 23) // => 'ends'
 */
function lineVerdict(
  lineScan: LineScan,
  scan: StatementScan,
  lines: readonly string[],
  line: number,
): LineVerdict {
  const verdict = OUTCOME_VERDICT.get(lineScan.outcome)
  if (verdict) return verdict
  return statementGoesOn(scan, lineScan.code, lines, line)
    ? 'continues'
    : 'ends'
}

/**
 * Says whether the scan stands in code, outside every block comment, string and template literal (a template substitution is code); called by {@link blankedPiece} for each piece of a line and by {@link sourceLineCode} for its rest.
 * @example
 * standsInCode({ frames: ['`'], inBlockComment: false }) // => false
 * standsInCode({ frames: ['`', '${'], inBlockComment: false }) // => true
 */
function standsInCode(scan: StatementScan): boolean {
  return !scan.inBlockComment && !scan.quote && scan.frames.at(-1) !== '`'
}

/**
 * Says whether a code token the scan stands before stays in a line's code; called by {@link blankedPiece} before the token is applied.
 * @param token - A code token ({@link CODE_TOKEN}).
 * @param scan - The scan before the token, which tells whether a `}` closes a template substitution.
 * @returns `true` for a bracket or a `;`; `false` for a comment opener, a quote, a backtick and the `}` that closes a template substitution (the delimiters of comments, strings and template literals).
 * @example
 * isKeptCodeToken('(', { frames: [], inBlockComment: false }) // => true
 * isKeptCodeToken('}', { frames: ['`', '${'], inBlockComment: false }) // => false
 */
function isKeptCodeToken(token: string, scan: StatementScan): boolean {
  if (token === '}' && scan.frames.at(-1) === '${') return false
  return /^[([{)\]};]$/.test(token)
}

/**
 * Blanks what is no code in one scanned piece of a line, the text up to and including a token; called by {@link sourceLineCode} for each piece before the token at its end is applied.
 * @param piece - The text from the end of the token before to the end of this token.
 * @param token - The token the piece ends with.
 * @param scan - The scan before the token, which tells whether the piece stands in code.
 * @returns The piece with the same length: in code the text before the token stays and the token stays only when it is a bracket or a `;` ({@link isKeptCodeToken}); inside a comment, a string or a template literal everything is a space.
 * @example
 * blankedPiece('count += 1; //', '//', { frames: [], inBlockComment: false }) // => 'count += 1;   '
 * blankedPiece("let a'", "'", { frames: [], quote: "'", inBlockComment: false }) // => '      '
 */
function blankedPiece(
  piece: string,
  token: string,
  scan: StatementScan,
): string {
  // Inside a comment, a string or a template literal everything is blanked.
  if (!standsInCode(scan)) return ' '.repeat(piece.length)
  return (
    piece.slice(0, piece.length - token.length) +
    (isKeptCodeToken(token, scan) ? token : ' '.repeat(token.length))
  )
}

/**
 * Blanks the comments, strings and template literals of one line with spaces, so a search for a declaration finds only code and every position stays the column it had; called by {@link declaredInspectionBindings} before it searches the declared line, and by {@link statementTexts} before it finds the keyword a statement begins at.
 * It reuses this file's scan from a line's start (a line is read as beginning outside every comment and string): escaped quotes stay inside their string, the expression of a template substitution is code (its `${` and `}` are blanked), and a `//` blanks the rest of the line.
 * @param lineText - One line of source, without its line ending.
 * @returns The line with the same length, every character inside a comment, a string or a template literal (and their delimiters) replaced by a space.
 * @example
 * sourceLineCode('count += 1; // const count = initial') // => 'count += 1;                         '
 * sourceLineCode("log('let a'); const b = 1")           // => "log(       ); const b = 1"
 */
export function sourceLineCode(lineText: string): string {
  const scan: StatementScan = { frames: [], inBlockComment: false }
  let position = 0,
    code = ''
  for (
    let token = nextToken(lineText, position, scan);
    token;
    token = nextToken(lineText, position, scan)
  ) {
    code += blankedPiece(lineText.slice(position, token.end), token.text, scan)
    position = token.end
    // A line comment blanks the rest of the line.
    if (applyToken(scan, token.text) === 'line-comment')
      return code + ' '.repeat(lineText.length - position)
  }
  const rest = lineText.slice(position)
  return code + (standsInCode(scan) ? rest : ' '.repeat(rest.length))
}

/**
 * Gives the lines a declaration's statement may span: from its keyword on the declared line to the last line of the citation; called by {@link declarationStatementEndLine}.
 * The keyword is searched in the line's code only ({@link sourceLineCode}), so a `const` or `let` in a comment or a string does not begin the statement.
 * @example
 * statementTexts(['if (ready) { const total = sum(rows) }'], 1, 1) // => ['const total = sum(rows) }']
 * statementTexts(["log('let a'); const total = sum(rows)"], 1, 1) // => ['const total = sum(rows)']
 */
function statementTexts(
  lines: readonly string[],
  startLine: number,
  endLine: number,
): string[] {
  const [first = '', ...rest] = lines.slice(startLine - 1, endLine),
    keyword = /\b(?:const|let)\s/.exec(sourceLineCode(first))
  // The statement begins at its keyword, so code before it on the line is not counted.
  return [first.slice(keyword?.index ?? 0), ...rest]
}

/**
 * Finds the last line of the statement a declaration begins, so a stop whose own line declares a binding it requires is requested after the whole statement instead of inside it (a callback, an object literal or the next line of a call); {@link ConfiguredBrowserRun} asks it at preparation and {@link selfDeclaredInspectionHint} when it words a missing value.
 * The scan is a small one, not a parser: it counts ( [ { and template literals, skips strings and comments, and ends the statement at a `;` outside every bracket or at the first line after which every bracket is closed, whose code does not end with an operator, `=>`, `=`, `,`, `.` or an opening bracket, and whose next non-blank, non-comment line does not begin with `.`, `?`, `:` or an operator.
 * @param lines - Every line of the sealed source, without line endings.
 * @param startLine - The one-based line of the declaration; the scan begins at its first `const` or `let`.
 * @param endLine - The last line of the stop's citation; a statement that goes on past it has no end the stop may be requested after.
 * @returns
 * - The one-based last line of the statement
 * - `undefined` when the statement does not end within the citation, or a bracket closes what it did not open (the declaration sits in a block that ends on its line), so the scan cannot decide
 * @example
 * declarationStatementEndLine(['const total = useMemo(() => {', '  return items.reduce(sum, 0)', '}, [items])', 'return total'], 1, 4) // => 3
 * declarationStatementEndLine(['const user = find(email)', 'if (!user) return null'], 1, 2) // => 1
 */
export function declarationStatementEndLine(
  lines: readonly string[],
  startLine: number,
  endLine: number,
): number | undefined {
  const scan: StatementScan = { frames: [], inBlockComment: false }
  for (const [offset, text] of statementTexts(
    lines,
    startLine,
    endLine,
  ).entries()) {
    const verdict = lineVerdict(
      scanLine(text, scan),
      scan,
      lines,
      startLine + offset,
    )
    if (verdict !== 'continues')
      return verdict === 'ends' ? startLine + offset : undefined
  }
  return undefined
}
