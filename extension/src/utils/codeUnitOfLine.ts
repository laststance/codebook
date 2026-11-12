import {
  WIKI_CONTEXT_LINE_LIMIT,
  WIKI_CONTEXT_UNIT_LINE_LIMIT,
} from '../constants'

/** A line that begins a `function`, `class`, `interface`, `enum`, `namespace`, `module` or `type` declaration, after any `export`, `default`, `declare`, `abstract`, `async` or `const`. */
const DECLARATION_START =
  /^(?:(?:export|default|declare|abstract|async|const)\s+)*(?:function|class|interface|enum|namespace|module|type)\b/
/** A line that begins a control-flow statement, also after the `}` of the branch before it; such a line on its own brings no unit. */
const CONTROL_FLOW_START =
  /^(?:\}\s*)?(?:if|else|for|while|switch|try|catch|finally|do)\b/
/** A signature line at its declaration's indentation still continues it when it starts with one of these characters, as `>(`, `): Store {` or `}: Props) {` do. */
const SIGNATURE_CONTINUATION_START = /^[)>\]}.?:|&=]/
/** A `{` right after `(`, `[` or `,` opens a destructured parameter or an object argument (`>({`, `run(options, {`), not a block. */
const OBJECT_ARGUMENT_OPENING = /[([,]\s*\{$/
/** The name a function or method signature declares, after any modifiers: `createStore` in `export function createStore<`, `read` in `public read(id: string): Item`. */
const DECLARED_NAME =
  /^(?:(?:export|default|declare|async|public|private|protected|static|abstract|override)\s+)*(?:function\s*\*?\s*)?([A-Za-z_$][\w$]*)\s*[<(]/

/** What a declaration scan reports when the block is still open at {@link WIKI_CONTEXT_UNIT_LINE_LIMIT} lines: the declaration is too long for a whole unit, as opposed to a block that was left by a dedent or a signature that never ends. Cycle 0123 (F3). */
const DECLARATION_TOO_LONG = 'too-long'

/** Zero-based first and last lines of a run of source lines, both included. */
export interface LineRange {
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
 * Tells whether a line is a decorator, such as `@Injectable()` above a class.
 * @param line - One source line; `undefined` past either end of the source.
 * @returns `true` when the line's text starts with `@`.
 * @example
 * isDecorator('  @Input()') // => true
 */
function isDecorator(line: string | undefined): boolean {
  return line?.trim().startsWith('@') ?? false
}

/**
 * Finds the run of `//` lines around a line that is one of them, looking at most {@link WIKI_CONTEXT_LINE_LIMIT} lines each way, since a longer comment cannot travel with its code.
 * @param lines - Complete source, indexed from zero.
 * @param index - A line whose text starts with `//`.
 * @returns The run's first and last lines within that reach.
 * @example
 * lineCommentRunAround(['// a', '// b', 'run()'], 1) // => { first: 0, last: 1 }
 */
function lineCommentRunAround(
  lines: readonly string[],
  index: number,
): LineRange {
  const isLineComment = (line: number): boolean =>
    Math.abs(line - index) <= WIKI_CONTEXT_LINE_LIMIT &&
    Boolean(lines[line]?.trim().startsWith('//'))
  let first = index
  let last = index
  // Walk outwards while the neighbouring lines are `//` lines too.
  while (isLineComment(first - 1)) first--
  while (isLineComment(last + 1)) last++
  return { first, last }
}

/**
 * Finds the block comment around a line that starts with `/*` or `*`: from the line that opens it to the line that closes it, looking at most {@link WIKI_CONTEXT_LINE_LIMIT} lines each way.
 * @param lines - Complete source, indexed from zero.
 * @param index - A line whose text starts with `/*` or `*`.
 * @returns The comment's first and last lines; `undefined` when no `/*` line opens it from above (a `*` line of code, such as a continued multiplication, or a comment that closed above the line), or no `*\/` closes it, within that reach.
 * @example
 * blockCommentAround(['/**', ' * Adds one.', ' *\/', 'function add() {}'], 1) // => { first: 0, last: 2 }
 */
function blockCommentAround(
  lines: readonly string[],
  index: number,
): LineRange | undefined {
  let first = index
  // Walk up through the comment's `*` lines to the line that opens it.
  for (;;) {
    const text = lines[first]!.trim()
    // A comment that closes above the line does not hold it.
    if (first < index && text.includes('*/')) return undefined
    if (text.startsWith('/*')) break
    if (first === 0 || index - first >= WIKI_CONTEXT_LINE_LIMIT)
      return undefined
    if (!text.startsWith('*')) return undefined
    first--
  }
  let last = index
  // Walk down to the line that closes it.
  while (!lines[last]!.includes('*/')) {
    if (last === lines.length - 1 || last - index >= WIKI_CONTEXT_LINE_LIMIT)
      return undefined
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
 * Finds the comment that documents a declaration: the one that closes directly above it, or above the one-line decorators right above it.
 * @param lines - Complete source, indexed from zero.
 * @param declarationLine - The declaration's first line.
 * @returns The comment's first and last lines; `undefined` when the line above (past any decorators) is code, blank or missing.
 * @example
 * commentAbove(['/** Adds one. *\/', '@Injectable()', 'class Adder {}'], 2) // => { first: 0, last: 0 }
 */
function commentAbove(
  lines: readonly string[],
  declarationLine: number,
): LineRange | undefined {
  let above = declarationLine - 1
  // Decorators stand between a class and its comment.
  while (isDecorator(lines[above])) above--
  if (above < 0) return undefined
  const text = lines[above]!.trim()
  // Only a comment that closes right above the declaration documents it.
  if (text.startsWith('//') || text.endsWith('*/'))
    return commentAround(lines, above)
  return undefined
}

/**
 * Tells whether the line after a signature line continues the signature.
 * @param next - The next line; `undefined` past the end of the source.
 * @param indentation - The declaration's indentation.
 * @returns `true` for a line indented deeper than the declaration, or one at its indentation starting with `)`, `>`, `]`, `}`, `.`, `?`, `:`, `|`, `&` or `=`; `false` for a blank line, a missing line, a new statement or a line that closes the scope around the declaration.
 * @example
 * continuesSignature('): Store {', 0) // => true
 * continuesSignature('export const next = 1', 0) // => false
 */
function continuesSignature(
  next: string | undefined,
  indentation: number,
): boolean {
  if (next === undefined || !next.trim()) return false
  const nextIndentation = indentationOf(next)
  return (
    nextIndentation > indentation ||
    (nextIndentation === indentation &&
      SIGNATURE_CONTINUATION_START.test(next.trim()))
  )
}

/**
 * Tells whether the line after a signature that opens no block declares the same function or method again: the next overload, or the implementation after the overloads.
 * @param declaration - The declaration's first line.
 * @param next - The line after the signature; `undefined` past the end of the source.
 * @returns `true` when both lines sit at the same indentation and declare the same name.
 * @example
 * declaresSameName('export function getStore(): Store', 'export function getStore(name?: string) {') // => true
 * declaresSameName('export function getStore(): Store', 'export function setStore(store: Store) {') // => false
 */
function declaresSameName(
  declaration: string,
  next: string | undefined,
): boolean {
  if (next === undefined || indentationOf(next) !== indentationOf(declaration))
    return false
  const name = DECLARED_NAME.exec(declaration.trim())?.[1]
  return name !== undefined && DECLARED_NAME.exec(next.trim())?.[1] === name
}

/**
 * Finds the line that closes a brace block: the first later line at the opening line's indentation that starts with `}` and does not open another block, so `} else {`, `} catch (error) {` and the `}) {` after a parameter type go on to the final `}`.
 * Braces are not counted, so a brace inside a string or a comment changes nothing; the source is taken to be formatted.
 * @param lines - Complete source, indexed from zero.
 * @param openLine - The line that ends with the block's `{`.
 * @param declarationLine - The declaration's first line, from which the unit limit counts.
 * @param maxLines - How many lines from the declaration line the walk may read: the unit limit by default, `Infinity` to find the closing line of a declaration too long for a whole unit ({@link longDeclarationLastLine}, Cycle 0124).
 * @returns
 * - The closing line
 * - {@link DECLARATION_TOO_LONG} when the block is still open, at its indentation or deeper, `maxLines` lines after the declaration
 * - `undefined` when a non-blank line is indented less than the opening line first, or the source ends first
 * @example
 * blockCloseLine(['if (ready) {', '  run()', '} else {', '  wait()', '}'], 0, 0) // => 4
 */
function blockCloseLine(
  lines: readonly string[],
  openLine: number,
  declarationLine: number,
  maxLines: number = WIKI_CONTEXT_UNIT_LINE_LIMIT,
): number | typeof DECLARATION_TOO_LONG | undefined {
  const indentation = indentationOf(lines[openLine]!)
  const limit = Math.min(lines.length, declarationLine + maxLines)
  for (let index = openLine + 1; index < limit; index++) {
    const line = lines[index]!
    const text = line.trim()
    // A blank line neither closes the block nor leaves it.
    if (!text) continue
    const lineIndentation = indentationOf(line)
    if (lineIndentation < indentation) return undefined
    // A closer that opens the next branch or the body goes on.
    if (
      lineIndentation === indentation &&
      text.startsWith('}') &&
      !opensBlock(line)
    )
      return index
  }
  // The line limit, not the end of the source, stopped the walk: the block is too long, not malformed.
  return limit === declarationLine + maxLines ? DECLARATION_TOO_LONG : undefined
}

/**
 * Finds the lines of the declaration that begins on a line: its signature, continued over lines, and the brace block it opens. The body's `{` ends the declaration line or a signature line at the declaration's indentation, so a parameter type or default opened on a deeper signature line is part of the signature. Overloads of the same function or method run on to its implementation.
 * @param lines - Complete source, indexed from zero.
 * @param declarationLine - The declaration's first line.
 * @param maxLines - How many lines from the declaration line the scan may read: the unit limit by default, `Infinity` for {@link longDeclarationLastLine}.
 * @returns The declaration's first and last lines; {@link DECLARATION_TOO_LONG} when its block is still open `maxLines` lines after the declaration; `undefined` when its block is left by a dedent, or its signature does not end, within that reach.
 * @example
 * declarationRange(['function add(', '  value,', ') {', '  return value + 1', '}'], 0) // => { first: 0, last: 4 }
 * declarationRange(['const limit = 3', 'run()'], 0) // => { first: 0, last: 0 }
 */
function declarationRange(
  lines: readonly string[],
  declarationLine: number,
  maxLines: number = WIKI_CONTEXT_UNIT_LINE_LIMIT,
): LineRange | typeof DECLARATION_TOO_LONG | undefined {
  const indentation = indentationOf(lines[declarationLine]!)
  const limit = Math.min(lines.length, declarationLine + maxLines)
  for (let index = declarationLine; index < limit; index++) {
    const line = lines[index]!
    // The body's `{` ends the declaration line or a signature line at its indentation; a deeper `{` opens a parameter type or a default.
    if (
      opensBlock(line) &&
      (index === declarationLine || indentationOf(line) === indentation)
    ) {
      const last = blockCloseLine(lines, index, declarationLine, maxLines)
      return typeof last === 'number' ? { first: declarationLine, last } : last
    }
    // A signature that opens no block ends at its last continued line, unless an overload or the implementation of the same name follows.
    if (
      !continuesSignature(lines[index + 1], indentation) &&
      !declaresSameName(lines[declarationLine]!, lines[index + 1])
    )
      return { first: declarationLine, last: index }
  }
  return undefined
}

/**
 * Finds the line a Wiki excerpt anchor makes a code unit of: for a line inside a comment, the code line right after the comment (past any one-line decorators); for a code line, itself when it begins a declaration, opens a brace block that is no control-flow statement, or begins a function or method signature that goes on over the next lines.
 * @param lines - Complete source, indexed from zero.
 * @param anchor - The anchor line.
 * @param comment - The comment the anchor lies in, if any.
 * @returns The declaration's first line; `undefined` when a comment documents no code (a blank line, another comment or the end of the source follows it), or a code line begins no declaration (a control-flow line such as `if (ready) {`, or a plain statement).
 * @example
 * declarationLineOf(['// Adds one.', 'function add() {', '}'], 0, { first: 0, last: 0 }) // => 1
 * declarationLineOf(['if (ready) {', '}'], 0, undefined) // => undefined
 */
function declarationLineOf(
  lines: readonly string[],
  anchor: number,
  comment: LineRange | undefined,
): number | undefined {
  if (!comment) {
    const line = lines[anchor]!
    const text = line.trim()
    if (DECLARATION_START.test(text)) return anchor
    if (CONTROL_FLOW_START.test(text)) return undefined
    // A block opener, or a function or method signature that goes on over the next lines (`read(`), begins a unit.
    return opensBlock(line) || (text.endsWith('(') && DECLARED_NAME.test(text))
      ? anchor
      : undefined
  }
  let next = comment.last + 1
  // Decorators stand between a comment and the class it documents.
  while (isDecorator(lines[next])) next++
  // The comment documents the code that follows it directly.
  return next < lines.length &&
    lines[next]!.trim() &&
    !commentAround(lines, next)
    ? next
    : undefined
}

/**
 * Finds the lines of the code unit a line of a long source belongs to, so a Wiki question's excerpt carries a whole function, class or object instead of one line of it.
 * A line inside a comment brings the declaration the comment documents, with its brace block; a code line that begins a declaration, or opens a brace block other than a control-flow statement, brings that declaration and its block. The comment directly above the declaration (past one-line decorators) comes too when both fit in {@link WIKI_CONTEXT_UNIT_LINE_LIMIT} lines; otherwise the anchor line comes with the declaration alone.
 * Why: Cycle 0122 (F3) — the excerpt of P03's `createStore.ts` held the doc comments that matched a question and not the function body that answered it, so the editor model called the behavior unknown.
 * Called by {@link selectWikiSourceLines} for each ranked anchor of a source longer than its excerpt budget.
 * @param lines - Complete verified source, indexed from zero.
 * @param anchor - A zero-based line that holds a question word or a route identifier.
 * @returns
 * - The unit's zero-based lines in order, the anchor included
 * - `undefined` when the anchor documents or begins no declaration, the declaration's block does not close at its indentation, or the unit (a detached anchor line included) passes {@link WIKI_CONTEXT_UNIT_LINE_LIMIT} lines
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
  if (!declaration || declaration === DECLARATION_TOO_LONG) return undefined
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
  if (unitLines.includes(anchor)) return unitLines
  // A detached anchor line counts toward the unit limit too.
  return unitLines.length < WIKI_CONTEXT_UNIT_LINE_LIMIT
    ? [anchor, ...unitLines].sort((one, other) => one - other)
    : undefined
}

/**
 * Finds the head of a declaration too long for a whole unit: its first {@link WIKI_CONTEXT_UNIT_LINE_LIMIT} lines, from the declaration line on, without the comment above it.
 * Why: Cycle 0123 (F3, Issue #316) — P06's `pasteItem` (44 lines) was just over the unit limit, so its excerpt held scattered lines and the create branches that answer the question were missing.
 * Only a code line that begins the declaration brings a head; a comment line never does, so a long function's doc comment stays one line (Cycle 0122). A block left by a dedent, or a signature that never ends, brings nothing.
 * Called by {@link selectWikiSourceLines} after every whole unit is placed, once per ranked anchor, through its head step.
 * @param lines - Complete verified source, indexed from zero.
 * @param anchor - A zero-based line that holds a question word or a route identifier.
 * @returns
 * - The head's zero-based lines in order, the declaration line first (shorter only when the source ends first)
 * - `undefined` when the anchor is a comment line, begins no declaration, or its declaration closes within {@link WIKI_CONTEXT_UNIT_LINE_LIMIT} lines or is malformed
 * @example
 * longDeclarationHeadOfLine(['function load() {', ...fortyOneStatements, '}'], 0) // => [0, 1, ..., 39]
 * longDeclarationHeadOfLine(['function add() {', '  return 1', '}'], 0) // => undefined
 */
export function longDeclarationHeadOfLine(
  lines: readonly string[],
  anchor: number,
): number[] | undefined {
  if (commentAround(lines, anchor)) return undefined
  const declarationLine = declarationLineOf(lines, anchor, undefined)
  if (declarationLine === undefined) return undefined
  if (declarationRange(lines, declarationLine) !== DECLARATION_TOO_LONG)
    return undefined
  return Array.from(
    {
      length: Math.min(
        WIKI_CONTEXT_UNIT_LINE_LIMIT,
        lines.length - declarationLine,
      ),
    },
    (_, offset) => declarationLine + offset,
  )
}

/**
 * Finds the closing line of a declaration too long for a whole unit, by the same rule that closes a unit's block but with no line limit.
 * Why: Cycle 0124 (F3, Issue #318) — a long function's window in a Wiki question's excerpt must never run past the function into the next one, as the window of P06's `setupKeyboardShortcuts` (lines 1660-1721) ran to line 1742.
 * Called by {@link enclosingLongDeclarationOf} for each declaration it finds above an anchor.
 * @param lines - Complete verified source, indexed from zero.
 * @param declarationLine - A line that begins a declaration too long for a whole unit (one {@link longDeclarationHeadOfLine} accepts).
 * @returns
 * - The declaration's closing line
 * - `undefined` when the line begins no declaration too long for a whole unit, or the declaration's block is left by a dedent or never closes
 * @example
 * longDeclarationLastLine(['function load() {', ...fortyOneStatements, '}', 'next()'], 0) // => 42
 * longDeclarationLastLine(['function add() {', '  return 1', '}'], 0) // => undefined
 */
function longDeclarationLastLine(
  lines: readonly string[],
  declarationLine: number,
): number | undefined {
  if (!longDeclarationHeadOfLine(lines, declarationLine)) return undefined
  const range = declarationRange(lines, declarationLine, Infinity)
  return range && range !== DECLARATION_TOO_LONG ? range.last : undefined
}

/**
 * Finds the signature line above a continued one: the nearest line at the same indentation, past the signature's deeper parameter lines.
 * Called by {@link signatureStartOf} for each continued signature line it walks up from.
 * @param lines - Complete source, indexed from zero.
 * @param line - A signature line that continues the one above it.
 * @param indentation - The declaration's indentation.
 * @returns The line above at that indentation; `undefined` when a blank line, a line indented less, or the start of the source comes first.
 * @example
 * signatureLineAbove(['function save(', '  item,', ') {'], 2, 0) // => 0
 */
function signatureLineAbove(
  lines: readonly string[],
  line: number,
  indentation: number,
): number | undefined {
  for (let above = line - 1; above >= 0; above--) {
    const text = lines[above]!
    // A blank line ends a signature; its parameter lines are indented deeper.
    if (!text.trim()) return undefined
    const aboveIndentation = indentationOf(text)
    if (aboveIndentation === indentation) return above
    if (aboveIndentation < indentation) return undefined
  }
  return undefined
}

/**
 * Finds the first line of the signature that a block-opening line ends: up over the signature's deeper parameter lines and over lines at its indentation that continue a signature (`) {`, `}: Props) {`), to the first line at its indentation that does not.
 * Why: Cycle 0124 `/ship` review — walking up from a body line meets a multi-line signature's `) {` first, so a function's window started on another line than the head of the same function named by the route reply, and both took places in the excerpt.
 * Called by {@link enclosingLongDeclarationOf} for the line that opens the enclosing block.
 * @param lines - Complete source, indexed from zero.
 * @param openLine - The line that opens the declaration's block.
 * @param last - The block's closing line.
 * @returns The signature's first line when the declaration that begins there closes on `last`; `openLine` otherwise, a block opener that continues no signature included.
 * @example
 * signatureStartOf(['function save(', '  item,', ') {', ...fortyOneStatements, '}'], 2, 44) // => 0
 * signatureStartOf(['function load() {', ...fortyOneStatements, '}'], 0, 42) // => 0
 */
function signatureStartOf(
  lines: readonly string[],
  openLine: number,
  last: number,
): number {
  const indentation = indentationOf(lines[openLine]!)
  let start: number | undefined = openLine
  // A line at the opener's indentation starting like `)` or `}` continues a signature that begins above it.
  while (
    start !== undefined &&
    SIGNATURE_CONTINUATION_START.test(lines[start]!.trim())
  )
    start = signatureLineAbove(lines, start, indentation)
  if (start === undefined || start === openLine) return openLine
  const declaration = declarationRange(lines, start, Infinity)
  // The start counts only when the declaration that begins there is this one.
  return typeof declaration === 'object' && declaration.last === last
    ? start
    : openLine
}

/**
 * Finds the declaration too long for a whole unit whose block holds a line, so the anchors inside one long function can be grouped.
 * Walks up from the line above the anchor: each non-blank line indented less than every non-blank line passed so far (the anchor included) may open the block that holds it. The first of those that begins a declaration too long for a whole unit ({@link longDeclarationHeadOfLine}) decides: it encloses the anchor when its block is still open there. A line at indentation 0 is the last one tried.
 * Why: Cycle 0124 (F3, Issue #318) — the route reply named identifiers inside P06's 44-line `pasteItem`, not the function, so its lines stayed scattered single lines in the excerpt.
 * Called by {@link longFunctionWindowsOf} for each route-identifier anchor.
 * @param lines - Complete verified source, indexed from zero; taken to be formatted, as for code units.
 * @param anchor - A zero-based anchor line.
 * @returns
 * - The enclosing declaration's first line (where its signature begins, {@link signatureStartOf}) and closing line
 * - `undefined` when the anchor is at indentation 0, no long declaration lies above it within its blocks, or the first one found closes before the anchor or never closes
 * @example
 * enclosingLongDeclarationOf(['function load() {', ...fortyOneStatements, '}'], 20) // => { first: 0, last: 42 }
 */
export function enclosingLongDeclarationOf(
  lines: readonly string[],
  anchor: number,
): LineRange | undefined {
  let bound = indentationOf(lines[anchor]!)
  for (let index = anchor - 1; index >= 0 && bound > 0; index--) {
    const line = lines[index]!
    // A blank line, or one at the bound or deeper, lies inside the same block.
    if (!line.trim() || indentationOf(line) >= bound) continue
    bound = indentationOf(line)
    if (!longDeclarationHeadOfLine(lines, index)) continue
    const last = longDeclarationLastLine(lines, index)
    // The first long declaration above decides; one that closed above the anchor or never closes encloses nothing.
    return last !== undefined && anchor <= last
      ? { first: signatureStartOf(lines, index, last), last }
      : undefined
  }
  return undefined
}
