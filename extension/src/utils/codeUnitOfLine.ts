import { WIKI_CONTEXT_UNIT_LINE_LIMIT } from '../constants'

/** A line that begins a `function`, `class`, `interface` or `enum` declaration, after any `export`, `default`, `declare`, `abstract` or `async`. */
const DECLARATION_START =
  /^(?:(?:export|default|declare|abstract|async)\s+)*(?:function|class|interface|enum)\b/
/** A signature line indented no deeper than its declaration still continues it when it starts with one of these characters, as `>(`, `): Store {` or `}: Props) {` do. */
const SIGNATURE_CONTINUATION_START = /^[)>\]}.?:|&=]/
/** A `{` right after `(`, `[` or `,` opens a destructured parameter or an object argument (`>({`, `run(options, {`), not a block. */
const OBJECT_ARGUMENT_OPENING = /[([,]\s*\{$/

/** Zero-based first and last lines of a run of source lines, both included. */
interface LineRange {
  first: number
  last: number
}

/**
 * Counts a line's leading whitespace characters; a tab counts as one.
 * @param line - One source line.
 * @returns The number of whitespace characters before the line's first other character.
 * @example
 * indentationOf('    return state') // => 4
 */
function indentationOf(line: string): number {
  return line.length - line.trimStart().length
}

/**
 * Tells whether a line opens a brace block: it ends with `{`, and that `{` does not open a destructured parameter or an object argument.
 * @param line - One source line.
 * @returns `true` for a line such as `function add(value) {`, `}: Props) {` or `useEffect(() => {`; `false` for `>({`, `run(options, {` or a line that does not end with `{`.
 * @example
 * opensBlock('    watch(observer) {') // => true
 * opensBlock('>({') // => false
 */
function opensBlock(line: string): boolean {
  const text = line.trimEnd()
  return text.endsWith('{') && !OBJECT_ARGUMENT_OPENING.test(text)
}

/**
 * Finds the run of `//` lines around a line that is one of them.
 * @param lines - Complete source, indexed from zero.
 * @param index - A line whose text starts with `//`.
 * @returns The run's first and last lines.
 * @example
 * lineCommentRunAround(['// a', '// b', 'run()'], 1) // => { first: 0, last: 1 }
 */
function lineCommentRunAround(
  lines: readonly string[],
  index: number,
): LineRange {
  let first = index
  let last = index
  // Walk outwards while the neighbouring lines are `//` lines too.
  while (first > 0 && lines[first - 1]!.trim().startsWith('//')) first--
  while (last < lines.length - 1 && lines[last + 1]!.trim().startsWith('//'))
    last++
  return { first, last }
}

/**
 * Finds the block comment around a line that starts with `/*` or `*`: from the line that opens it to the line that closes it.
 * @param lines - Complete source, indexed from zero.
 * @param index - A line whose text starts with `/*` or `*`.
 * @returns The comment's first and last lines; `undefined` when no `/*` line opens it from above (a `*` line of code, such as a continued multiplication) or no `*\/` closes it.
 * @example
 * blockCommentAround(['/**', ' * Adds one.', ' *\/', 'function add() {}'], 1) // => { first: 0, last: 2 }
 */
function blockCommentAround(
  lines: readonly string[],
  index: number,
): LineRange | undefined {
  let first = index
  // Walk up through the comment's `*` lines to the line that opens it.
  while (!lines[first]!.trim().startsWith('/*')) {
    if (first === 0 || !lines[first]!.trim().startsWith('*')) return undefined
    first--
  }
  let last = index
  // Walk down to the line that closes it.
  while (!lines[last]!.includes('*/')) {
    if (last === lines.length - 1) return undefined
    last++
  }
  return { first, last }
}

/**
 * Finds the comment a line lies in.
 * @param lines - Complete source, indexed from zero.
 * @param index - Any line of the source.
 * @returns The comment's first and last lines; `undefined` for a line of code or a blank line.
 * @example
 * commentAround(['// Adds one.', 'function add() {}'], 0) // => { first: 0, last: 0 }
 * commentAround(['// Adds one.', 'function add() {}'], 1) // => undefined
 */
function commentAround(
  lines: readonly string[],
  index: number,
): LineRange | undefined {
  const text = lines[index]!.trim()
  if (text.startsWith('//')) return lineCommentRunAround(lines, index)
  if (text.startsWith('/*') || text.startsWith('*'))
    return blockCommentAround(lines, index)
  return undefined
}

/**
 * Finds the comment that ends on the line directly above a declaration.
 * @param lines - Complete source, indexed from zero.
 * @param declarationLine - The declaration's first line.
 * @returns The comment's first and last lines; `undefined` when the line above is code, blank or missing.
 * @example
 * commentAbove(['/** Adds one. *\/', 'function add() {}'], 1) // => { first: 0, last: 0 }
 */
function commentAbove(
  lines: readonly string[],
  declarationLine: number,
): LineRange | undefined {
  if (declarationLine === 0) return undefined
  const above = lines[declarationLine - 1]!.trim()
  // Only a comment that closes right above the declaration documents it.
  if (above.startsWith('//') || above.endsWith('*/'))
    return commentAround(lines, declarationLine - 1)
  return undefined
}

/**
 * Tells whether the line after a signature line continues the signature.
 * @param next - The next line; `undefined` past the end of the source.
 * @param indentation - The declaration's indentation.
 * @returns `true` for a line indented deeper than the declaration, or one starting with `)`, `>`, `]`, `}`, `.`, `?`, `:`, `|`, `&` or `=`; `false` for a blank line, a missing line or a new statement.
 * @example
 * continuesSignature('): Store {', 0) // => true
 * continuesSignature('export const next = 1', 0) // => false
 */
function continuesSignature(
  next: string | undefined,
  indentation: number,
): boolean {
  if (next === undefined || !next.trim()) return false
  return (
    indentationOf(next) > indentation ||
    SIGNATURE_CONTINUATION_START.test(next.trim())
  )
}

/**
 * Finds the line that closes a brace block: the first later line at the declaration's indentation that starts with `}`.
 * Braces are not counted, so a brace inside a string or a comment changes nothing; the source is taken to be formatted.
 * @param lines - Complete source, indexed from zero.
 * @param indentation - The declaration's indentation.
 * @param openLine - The line that ends with the block's `{`.
 * @param declarationLine - The declaration's first line, from which the unit limit counts.
 * @returns The closing line; `undefined` when a non-blank line is indented less than the declaration first, or no closing line comes within {@link WIKI_CONTEXT_UNIT_LINE_LIMIT} lines of the declaration.
 * @example
 * blockCloseLine(['run() {', '  step()', '}'], 0, 0, 0) // => 2
 */
function blockCloseLine(
  lines: readonly string[],
  indentation: number,
  openLine: number,
  declarationLine: number,
): number | undefined {
  const limit = Math.min(
    lines.length,
    declarationLine + WIKI_CONTEXT_UNIT_LINE_LIMIT,
  )
  for (let index = openLine + 1; index < limit; index++) {
    const line = lines[index]!
    const text = line.trim()
    // A blank line neither closes the block nor leaves it.
    if (!text) continue
    const lineIndentation = indentationOf(line)
    if (lineIndentation < indentation) return undefined
    if (lineIndentation === indentation && text.startsWith('}')) return index
  }
  return undefined
}

/**
 * Finds the lines of the declaration that begins on a line: its signature, continued over lines, and the brace block it opens.
 * @param lines - Complete source, indexed from zero.
 * @param declarationLine - The declaration's first line.
 * @returns The declaration's first and last lines; `undefined` when its block does not close, or its signature does not end, within {@link WIKI_CONTEXT_UNIT_LINE_LIMIT} lines.
 * @example
 * declarationRange(['function add(', '  value,', ') {', '  return value + 1', '}'], 0) // => { first: 0, last: 4 }
 * declarationRange(['const limit = 3', 'run()'], 0) // => { first: 0, last: 0 }
 */
function declarationRange(
  lines: readonly string[],
  declarationLine: number,
): LineRange | undefined {
  const indentation = indentationOf(lines[declarationLine]!)
  const limit = Math.min(
    lines.length,
    declarationLine + WIKI_CONTEXT_UNIT_LINE_LIMIT,
  )
  for (let index = declarationLine; index < limit; index++) {
    // The block opens on the signature line that ends with the body's `{`.
    if (opensBlock(lines[index]!)) {
      const last = blockCloseLine(lines, indentation, index, declarationLine)
      return last === undefined ? undefined : { first: declarationLine, last }
    }
    // A signature that opens no block ends at its last continued line.
    if (!continuesSignature(lines[index + 1], indentation))
      return { first: declarationLine, last: index }
  }
  return undefined
}

/**
 * Finds the line a Wiki excerpt anchor makes a code unit of: for a line inside a comment, the code line right after the comment; for a code line, itself when it opens a brace block or begins a `function`, `class`, `interface` or `enum` declaration.
 * @param lines - Complete source, indexed from zero.
 * @param anchor - The anchor line.
 * @param comment - The comment the anchor lies in, if any.
 * @returns The declaration's first line; `undefined` when a comment documents no code (a blank line, another comment or the end of the source follows it) or a code line begins no unit.
 * @example
 * declarationLineOf(['// Adds one.', 'function add() {', '}'], 0, { first: 0, last: 0 }) // => 1
 * declarationLineOf(['run()'], 0, undefined) // => undefined
 */
function declarationLineOf(
  lines: readonly string[],
  anchor: number,
  comment: LineRange | undefined,
): number | undefined {
  if (!comment) {
    const line = lines[anchor]!
    return opensBlock(line) || DECLARATION_START.test(line.trim())
      ? anchor
      : undefined
  }
  const next = comment.last + 1
  // The comment documents the code that follows it directly.
  return next < lines.length &&
    lines[next]!.trim() &&
    !commentAround(lines, next)
    ? next
    : undefined
}

/**
 * Finds the lines of the code unit a line of a long source belongs to, so a Wiki question's excerpt carries a whole function, class or block instead of one line of it.
 * A line inside a comment brings the declaration the comment documents, with its brace block; a code line that opens a brace block, or begins a `function`, `class`, `interface` or `enum` declaration, brings that declaration and its block. The comment directly above the declaration comes too when both fit in {@link WIKI_CONTEXT_UNIT_LINE_LIMIT} lines; otherwise the anchor line comes with the declaration alone.
 * Why: Cycle 0122 (F3) — the excerpt of P03's `createStore.ts` held the doc comments that matched a question and not the function body that answered it, so the editor model called the behavior unknown.
 * Called by {@link selectWikiSourceLines} for each ranked anchor of a source longer than its excerpt budget.
 * @param lines - Complete verified source, indexed from zero.
 * @param anchor - A zero-based line that holds a question word or a route identifier.
 * @returns
 * - The unit's zero-based lines in order, the anchor included
 * - `undefined` when the anchor documents or opens no declaration, the declaration's block does not close at its indentation, or the declaration alone passes {@link WIKI_CONTEXT_UNIT_LINE_LIMIT} lines
 * @example
 * codeUnitOfLine(['/**', ' * Sends the state once.', ' *\/', 'subscribe(observer) {', '  observer.next(state)', '},'], 1)
 * // => [0, 1, 2, 3, 4, 5]
 * codeUnitOfLine(['const total = 1', 'run(total)'], 1) // => undefined
 */
export function codeUnitOfLine(
  lines: readonly string[],
  anchor: number,
): number[] | undefined {
  const comment = commentAround(lines, anchor)
  const declarationLine = declarationLineOf(lines, anchor, comment)
  if (declarationLine === undefined) return undefined
  const declaration = declarationRange(lines, declarationLine)
  if (!declaration) return undefined
  const commentFirst = (comment ?? commentAbove(lines, declarationLine))?.first
  // The comment comes along only when it fits in one unit with the declaration.
  const first =
    commentFirst !== undefined &&
    declaration.last - commentFirst < WIKI_CONTEXT_UNIT_LINE_LIMIT
      ? commentFirst
      : declaration.first
  const unitLines = Array.from(
    { length: declaration.last - first + 1 },
    (_, offset) => first + offset,
  )
  return unitLines.includes(anchor)
    ? unitLines
    : [anchor, ...unitLines].sort((one, other) => one - other)
}
