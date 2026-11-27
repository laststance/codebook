import {
  bindingNamesAt,
  identifierAt,
  isIdentifierCharacter,
  matchingCloseIndexOf,
  topLevelPartStartsOf,
} from './bindingNamesAt'
import { blankCommentsAndTemplates } from './blankCommentsAndTemplates'
import { blankRegexLiterals } from './blankRegexLiterals'
import { blankStringContents } from './blankStringContents'

/** A function as found in the source: where its head starts (the `=>` or the `function` keyword), where its body starts and ends (exclusive), and the names its parameters bind. */
type StoppedFunction = {
  headIndex: number
  bodyStart: number
  bodyEnd: number
  parameterNames: string[]
}

/** `const`, `let` or `var` followed by whitespace: the binding after it is declared. */
const VARIABLE_DECLARATION = /(?<![\w$.])(?:const|let|var)\s+/g
/** `function NAME` and `class NAME`: the name is declared. */
const NAMED_DECLARATION =
  /(?<![\w$.])(?:function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g
/** `catch (`: the binding after it is declared. */
const CATCH_BINDING = /(?<![\w$.])catch\s*\(/g

/**
 * Finds the first non-whitespace index at or after `index`.
 * @param code - Blanked source.
 * @param index - Where to start.
 * @returns The index, or the text length.
 * @example skipWhitespace('a  b', 1) // => 3
 */
function skipWhitespace(code: string, index: number): number {
  let cursor = index
  while (cursor < code.length && /\s/.test(code[cursor]!)) cursor += 1
  return cursor
}

/**
 * Finds where an arrow function's expression body ends: the first `,` `;` `)` `]` or `}` at the body's own depth.
 * Called by {@link arrowAt}.
 * @param code - Blanked source.
 * @param start - Where the body starts.
 * @returns The end index, or the text length.
 * @example expressionBodyEndOf('a.b, c', 0) // => 3
 */
/**
 * Scans from `start` for the end of a span at the start's own bracket depth, for {@link expressionBodyEndOf} and {@link statementEndOf}: a closing bracket that closes an outer group always ends it, and `endAt` decides for every other character at that depth.
 * @param code - Blanked source.
 * @param start - Where the span starts.
 * @param endAt - Gives the end index for a character at the span's own depth that ends it, or `undefined` to go on.
 * @returns The end index, or the text length.
 * @example spanEndAtOwnDepth('f(a, b), c', 0, (character, index) => (character === ',' ? index : undefined)) // => 7
 */
function spanEndAtOwnDepth(
  code: string,
  start: number,
  endAt: (character: string, index: number) => number | undefined,
): number {
  let depth = 0
  for (let index = start; index < code.length; index += 1) {
    const character = code[index]!
    if ('([{'.includes(character)) depth += 1
    else if (')]}'.includes(character)) {
      // A closing bracket of an outer group ends the span where it stands.
      if (depth === 0) return index
      depth -= 1
    } else if (depth === 0) {
      const end = endAt(character, index)
      if (end !== undefined) return end
    }
  }
  return code.length
}

function expressionBodyEndOf(code: string, start: number): number {
  return spanEndAtOwnDepth(code, start, (character, index) =>
    character === ',' || character === ';' ? index : undefined,
  )
}

/**
 * Reads the parameter names of an arrow function from the text before its `=>`.
 * Called by {@link arrowAt}.
 * @param code - Blanked source.
 * @param arrowIndex - The index of the `=>`.
 * @returns The bound names; empty (fail-closed) when the text before `=>` is not a plain parameter group or a single name, for example a TypeScript return type.
 * @example arrowParameterNamesOf('({ query }) => 1', 11) // => ['query']
 */
function arrowParameterNamesOf(code: string, arrowIndex: number): string[] {
  const last = lastNonWhitespaceBefore(code, arrowIndex)
  if (code[last] === ')') {
    const open = matchingOpenIndexOf(code, last)
    return open === -1 ? [] : parameterNamesOf(code, open + 1, last)
  }
  if (!isIdentifierCharacter(code[last])) return []
  let start = last
  while (isIdentifierCharacter(code[start - 1])) start -= 1
  const before = lastNonWhitespaceBefore(code, start)
  // `): Type =>` is a return type, not a parameter.
  if (code[before] === ':' || code[before] === '.') return []
  const name = identifierAt(code, start)
  return name === undefined ? [] : [name]
}

/**
 * Finds the last non-whitespace index before `index`.
 * @param code - Blanked source.
 * @param index - The exclusive end of the search.
 * @returns The index, or `-1` when only whitespace precedes.
 * @example lastNonWhitespaceBefore('a  =>', 3) // => 0
 */
function lastNonWhitespaceBefore(code: string, index: number): number {
  let last = index - 1
  while (last >= 0 && /\s/.test(code[last]!)) last -= 1
  return last
}

/**
 * Finds the `(` that opens the group closed by the `)` at `closeIndex`.
 * @param code - Blanked source.
 * @param closeIndex - The index of a `)`.
 * @returns The index of its `(`, or `-1`.
 * @example matchingOpenIndexOf('(a, b)', 5) // => 0
 */
function matchingOpenIndexOf(code: string, closeIndex: number): number {
  let depth = 0
  for (let index = closeIndex; index >= 0; index -= 1) {
    if (code[index] === ')') depth += 1
    else if (code[index] === '(' && --depth === 0) return index
  }
  return -1
}

/**
 * Collects the names a parameter list binds: each top-level comma part's binding (`...rest`, `name?: Type = default`, patterns).
 * Called by {@link arrowParameterNamesOf} and {@link functionAt}.
 * @param code - Blanked source.
 * @param from - Start of the list's content.
 * @param to - End of the list's content (exclusive).
 * @returns The bound names.
 * @example parameterNamesOf('{ a }, b = 1', 0, 12) // => ['a', 'b']
 */
function parameterNamesOf(code: string, from: number, to: number): string[] {
  return topLevelPartStartsOf(code, from, to).flatMap((start) =>
    bindingNamesAt(code, start),
  )
}

/**
 * Checks whether an arrow whose `=>` is at `arrowIndex` holds the stop in its body.
 * Called by {@link stoppedFunctionAt}.
 * @param code - Blanked source.
 * @param arrowIndex - The index of the `=>`.
 * @param stop - The stop's index.
 * @returns The arrow as a {@link StoppedFunction}, or `undefined` when its body ends before the stop.
 * @example arrowAt('(a) => { x }', 4, 10)?.bodyStart // => 7
 */
function arrowAt(
  code: string,
  arrowIndex: number,
  stop: number,
): StoppedFunction | undefined {
  const bodyStart = skipWhitespace(code, arrowIndex + 2)
  let bodyEnd: number
  if (code[bodyStart] === '{') {
    const closeIndex = matchingCloseIndexOf(code, bodyStart)
    bodyEnd = closeIndex === -1 ? code.length : closeIndex + 1
  } else bodyEnd = expressionBodyEndOf(code, bodyStart)
  // A closed arrow before the stop is not the stopped function.
  if (stop < bodyStart || stop >= bodyEnd) return undefined
  return {
    headIndex: arrowIndex,
    bodyStart,
    bodyEnd,
    parameterNames: arrowParameterNamesOf(code, arrowIndex),
  }
}

/**
 * Skips what sits between the `function` keyword and its parameter list: `*`, the function's name and generics.
 * Called by {@link functionAt}.
 * @param code - Blanked source.
 * @param keywordIndex - The index of `function`.
 * @returns The index after them; the `(` of the parameter list when the head is well formed.
 * @example parameterListStartOf('function* f<T>(a) {}', 0) // => 14
 */
function parameterListStartOf(code: string, keywordIndex: number): number {
  let cursor = skipWhitespace(code, keywordIndex + 'function'.length)
  if (code[cursor] === '*') cursor = skipWhitespace(code, cursor + 1)
  const name = identifierAt(code, cursor)
  if (name !== undefined) cursor = skipWhitespace(code, cursor + name.length)
  if (code[cursor] !== '<') return cursor
  // Generics: skip to the matching `>`.
  let depth = 0
  for (; cursor < code.length; cursor += 1) {
    if (code[cursor] === '<') depth += 1
    else if (code[cursor] === '>' && --depth === 0) break
  }
  return skipWhitespace(code, cursor + 1)
}

/**
 * Checks whether a `function` keyword at `keywordIndex` starts a function whose body holds the stop.
 * Called by {@link stoppedFunctionAt}.
 * @param code - Blanked source.
 * @param keywordIndex - The index of `function`.
 * @param stop - The stop's index.
 * @returns The function as a {@link StoppedFunction}, or `undefined` when it is not a function head or its body ends before the stop.
 * @example functionAt('function f(a) { x }', 0, 16)?.bodyStart // => 14
 */
function functionAt(
  code: string,
  keywordIndex: number,
  stop: number,
): StoppedFunction | undefined {
  if (
    isIdentifierCharacter(code[keywordIndex - 1]) ||
    isIdentifierCharacter(code[keywordIndex + 'function'.length])
  )
    return undefined
  const cursor = parameterListStartOf(code, keywordIndex)
  if (code[cursor] !== '(') return undefined
  const parametersEnd = matchingCloseIndexOf(code, cursor)
  const bodyStart = parametersEnd === -1 ? -1 : code.indexOf('{', parametersEnd)
  if (bodyStart === -1) return undefined
  const closeIndex = matchingCloseIndexOf(code, bodyStart)
  const bodyEnd = closeIndex === -1 ? code.length : closeIndex + 1
  if (stop < bodyStart || stop >= bodyEnd) return undefined
  return {
    headIndex: keywordIndex,
    bodyStart,
    bodyEnd,
    parameterNames: parameterNamesOf(code, cursor + 1, parametersEnd),
  }
}

/**
 * Finds the innermost function whose body holds the stop by scanning backwards for the nearest `=>` or `function` whose body does.
 * Called by {@link stoppedFunctionDeclaredNamesOf}.
 * @param code - Blanked source.
 * @param stop - The stop's index.
 * @returns The function, or `undefined` when none holds the stop.
 * @example stoppedFunctionAt('const f = (a) => { return a }', 24)?.parameterNames // => ['a']
 */
function stoppedFunctionAt(
  code: string,
  stop: number,
): StoppedFunction | undefined {
  for (let index = Math.min(stop, code.length - 1); index >= 0; index -= 1) {
    const found = code.startsWith('=>', index)
      ? arrowAt(code, index, stop)
      : code.startsWith('function', index)
        ? functionAt(code, index, stop)
        : undefined
    if (found) return found
  }
  return undefined
}

/** A stretch of source, `start` inclusive to `end` exclusive, that a declaration's scope covers. */
type Region = { start: number; end: number }

/** One declaration found in the stopped function's body: the names it binds, where it sits and the extra region that must hold the stop for its names to be in scope. */
type Declaration = { names: string[]; position: number; scope?: Region }

/**
 * Makes a region no stop position can fall in, for a scope that cannot be read with confidence (fail closed).
 * Called by {@link catchDeclarationsIn}.
 * @param code - Blanked source.
 * @returns An empty region at the end of the text.
 * @example unreadableRegionOf('abc') // => { start: 3, end: 3 }
 */
function unreadableRegionOf(code: string): Region {
  return { start: code.length, end: code.length }
}

/**
 * Checks whether a region holds the stop: it opens before the stop and has not ended at it.
 * Called by {@link declarationIsInScope}.
 * @param region - The region to test.
 * @param stop - The stop's index.
 * @returns `true` when the stop is inside the region.
 * @example regionHoldsStop({ start: 5, end: 20 }, 10) // => true
 */
function regionHoldsStop(region: Region, stop: number): boolean {
  return region.start < stop && stop < region.end
}

/**
 * Describes the `{ ... }` block opened at `openIndex`; a block that never closes runs to the end of the text.
 * Called by {@link nestedBraceRegionsIn}, {@link catchDeclarationsIn} and {@link forLoopRegionsIn}.
 * @param code - Blanked source.
 * @param openIndex - The index of the `{`.
 * @returns The block as a region.
 * @example braceRegionAt('{ a }', 0) // => { start: 0, end: 5 }
 */
function braceRegionAt(code: string, openIndex: number): Region {
  const closeIndex = matchingCloseIndexOf(code, openIndex)
  return {
    start: openIndex,
    end: closeIndex === -1 ? code.length : closeIndex + 1,
  }
}

/**
 * Lists every `{ ... }` block that opens inside the stopped function's body, the body's own braces excluded.
 * Called by {@link declaredNamesIn}.
 * @param code - Blanked source.
 * @param bodyStart - The body's start; a `{` there is the body itself.
 * @param to - End of the span (exclusive).
 * @returns The nested blocks, outer before inner.
 * @example nestedBraceRegionsIn('{ if (a) { b } }', 0, 16) // => [{ start: 9, end: 14 }]
 */
function nestedBraceRegionsIn(
  code: string,
  bodyStart: number,
  to: number,
): Region[] {
  const regions: Region[] = []
  for (let index = bodyStart + 1; index < to; index += 1)
    if (code[index] === '{') regions.push(braceRegionAt(code, index))
  return regions
}

/**
 * Finds where a statement without braces ends: after a `;`, at a line break or at a closing bracket of the statement's own depth.
 * Called by {@link forLoopRegionsIn}.
 * @param code - Blanked source.
 * @param start - Where the statement starts.
 * @returns The exclusive end index, or the text length.
 * @example statementEndOf('run(a)\nnext()', 0) // => 6
 */
function statementEndOf(code: string, start: number): number {
  return spanEndAtOwnDepth(code, start, (character, index) => {
    // A `;` belongs to the statement; a line break ends it before itself.
    if (character === ';') return index + 1
    return character === '\n' ? index : undefined
  })
}

/** A `for (...)` or `for await (...)` head. */
const FOR_HEAD = /(?<![\w$.])for\s*(?:await\s*)?\(/g

/** A `for` loop: its head and the whole loop (keyword to the end of its body). */
type ForLoop = { head: Region; loop: Region }

/**
 * Finds the `for` loops of the body with their heads and extents; a body without braces runs to the end of its single statement.
 * Called by {@link variableDeclarationsIn}.
 * @param code - Blanked source.
 * @param from - Start of the span.
 * @param to - End of the span (exclusive).
 * @returns The loops in source order.
 * @example forLoopRegionsIn('for (const x of xs) { f(x) }', 0, 27)[0]?.loop // => { start: 0, end: 27 }
 */
function forLoopRegionsIn(code: string, from: number, to: number): ForLoop[] {
  return [...code.slice(from, to).matchAll(FOR_HEAD)].map((match) => {
    const keywordIndex = from + match.index
    const parenIndex = keywordIndex + match[0].length - 1
    const headClose = matchingCloseIndexOf(code, parenIndex)
    // An unclosed head: the loop runs to the end of the text.
    if (headClose === -1)
      return {
        head: { start: parenIndex, end: code.length },
        loop: { start: keywordIndex, end: code.length },
      }
    const bodyStart = skipWhitespace(code, headClose + 1)
    // A braced body ends at its brace; a single statement ends where the statement does.
    const bodyEnd =
      code[bodyStart] === '{'
        ? braceRegionAt(code, bodyStart).end
        : statementEndOf(code, bodyStart)
    return {
      head: { start: parenIndex, end: headClose },
      loop: { start: keywordIndex, end: bodyEnd },
    }
  })
}

/**
 * Collects the `const`/`let`/`var` declarations of a span; one in a `for` head is scoped to that loop.
 * Called by {@link declaredNamesIn}.
 * @param code - Blanked source.
 * @param from - Start of the span.
 * @param to - End of the span (exclusive).
 * @returns The declarations with their positions.
 * @example variableDeclarationsIn('const a = 1', 0, 11) // => [{ names: ['a'], position: 0 }]
 */
function variableDeclarationsIn(
  code: string,
  from: number,
  to: number,
): Declaration[] {
  const span = code.slice(from, to)
  const loops = forLoopRegionsIn(code, from, to)
  return [...span.matchAll(VARIABLE_DECLARATION)].map((match) => {
    const position = from + match.index
    // A binding in a loop head lives only inside that loop.
    const inHead = loops.find(
      ({ head }) => head.start < position && position < head.end,
    )
    return {
      names: bindingNamesAt(span, match.index + match[0].length),
      position,
      scope: inHead?.loop,
    }
  })
}

/** Characters that, before a `function` or `class`, make it part of an expression, never a declaration. */
const EXPRESSION_PREDECESSORS = '(,=:?[+-*/%&|^<>!~'

/**
 * Checks whether a `function` or `class` keyword at `index` stands where a statement can start, so its name is declared; in an expression (`register(function tenant() {})`) the name is bound only inside that function.
 * A statement starts at the beginning of the text, after `{`, `}` or `;`, after `export`, `default` or `async`, or on a new line unless the line before ends in an operator or `return`.
 * Called by {@link namedDeclarationsIn}.
 * @param code - Blanked source.
 * @param index - The index of the keyword.
 * @returns `true` when the keyword is in statement position.
 * @example
 * isStatementPosition('{ function f() {} }', 2) // => true
 * isStatementPosition('register(function f() {})', 9) // => false
 */
function isStatementPosition(code: string, index: number): boolean {
  const last = lastNonWhitespaceBefore(code, index)
  if (last < 0 || '{};'.includes(code[last]!)) return true
  const hasLineBreak = code.slice(last + 1, index).includes('\n')
  if (EXPRESSION_PREDECESSORS.includes(code[last]!)) return false
  let wordStart = last
  while (isIdentifierCharacter(code[wordStart - 1])) wordStart -= 1
  const word = code.slice(wordStart, last + 1)
  if (['export', 'default', 'async'].includes(word)) return true
  // A new line starts a statement, except after keywords that take an expression.
  return hasLineBreak && !EXPRESSION_KEYWORDS.has(word)
}

/** Keywords that take an expression, so a `function` after them (even on the next line) is an expression. */
const EXPRESSION_KEYWORDS: ReadonlySet<string> = new Set([
  'return',
  'typeof',
  'void',
  'new',
  'await',
  'yield',
  'throw',
  'extends',
  'in',
  'of',
  'case',
  'delete',
  'instanceof',
])

/**
 * Collects `function NAME` and `class NAME` declarations of a span.
 * Called by {@link declaredNamesIn}.
 * @param code - Blanked source.
 * @param from - Start of the span.
 * @param to - End of the span (exclusive).
 * @returns The declarations with their positions.
 * @example namedDeclarationsIn('function f() {}', 0, 15) // => [{ names: ['f'], position: 0 }]
 */
function namedDeclarationsIn(
  code: string,
  from: number,
  to: number,
): Declaration[] {
  return [...code.slice(from, to).matchAll(NAMED_DECLARATION)]
    .filter((match) => isStatementPosition(code, from + match.index))
    .map((match) => ({
      names: [match[1]!],
      position: from + match.index,
    }))
}

/**
 * Collects `catch (NAME)` bindings of a span; each is scoped to the catch block after it.
 * Called by {@link declaredNamesIn}.
 * @param code - Blanked source.
 * @param from - Start of the span.
 * @param to - End of the span (exclusive).
 * @returns The declarations with their positions.
 * @example catchDeclarationsIn('try {} catch (e) { f(e) }', 0, 25)[0]?.names // => ['e']
 */
function catchDeclarationsIn(
  code: string,
  from: number,
  to: number,
): Declaration[] {
  const span = code.slice(from, to)
  return [...span.matchAll(CATCH_BINDING)].map((match) => {
    const parenIndex = from + match.index + match[0].length - 1
    const parenClose = matchingCloseIndexOf(code, parenIndex)
    const blockStart =
      parenClose === -1 ? -1 : skipWhitespace(code, parenClose + 1)
    return {
      names: bindingNamesAt(span, match.index + match[0].length),
      position: from + match.index,
      // Without a readable block the binding counts as out of scope.
      scope:
        blockStart !== -1 && code[blockStart] === '{'
          ? braceRegionAt(code, blockStart)
          : unreadableRegionOf(code),
    }
  })
}

/**
 * Checks whether a declaration's scope holds the stop: every nested block around it and its own loop or catch region hold the stop.
 * Called by {@link declaredNamesIn}.
 * @param declaration - The declaration.
 * @param blocks - The nested blocks of the body ({@link nestedBraceRegionsIn}).
 * @param stop - The stop's index.
 * @returns `true` when the declared names are in scope at the stop.
 * @example declarationIsInScope({ names: ['a'], position: 5 }, [{ start: 3, end: 9 }], 20) // => false
 */
function declarationIsInScope(
  declaration: Declaration,
  blocks: readonly Region[],
  stop: number,
): boolean {
  const { position, scope } = declaration
  if (scope && !regionHoldsStop(scope, stop)) return false
  // A block that surrounds the declaration but not the stop (closed before it, or opened after it) hides the names.
  return blocks.every(
    (block) =>
      !(block.start < position && position < block.end) ||
      regionHoldsStop(block, stop),
  )
}

/**
 * Collects the names declared in a span that are in scope at the stop: `const`/`let`/`var` bindings (patterns included), `function NAME`, `class NAME` and `catch (NAME)`.
 *
 * A declaration counts only when its scope holds the stop, so a name declared in a block or inner function that closed before the stop, in a catch block or `for` loop the stop is not inside, or in an inline function after the stop column does not count. A `var` in such a closed block is dropped too: it is function-scoped, so this can only remove a value from the replay, never add a foreign one.
 * Called by {@link stoppedFunctionDeclaredNamesOf}.
 * @param code - Blanked source.
 * @param from - Start of the span (the stopped function's body start).
 * @param to - End of the span (exclusive).
 * @param stop - The stop's index.
 * @returns The declared names.
 * @example declaredNamesIn('{ const a = 1 }', 0, 15, 14) // => ['a']
 */
function declaredNamesIn(
  code: string,
  from: number,
  to: number,
  stop: number,
): string[] {
  const blocks = nestedBraceRegionsIn(code, from, to)
  return [
    ...variableDeclarationsIn(code, from, to),
    ...namedDeclarationsIn(code, from, to),
    ...catchDeclarationsIn(code, from, to),
  ]
    .filter((declaration) => declarationIsInScope(declaration, blocks, stop))
    .flatMap((declaration) => declaration.names)
}

/**
 * Collects the names every function around the stopped one, and the module's top level, declare in a scope that holds the stopped function: their parameters, own-depth declarations, and catch, `for`-head and block bindings whose scope holds it.
 * Why it exists: a name both the stopped function and an enclosing scope declare cannot tell whose value a closure holds, so {@link stoppedFunctionDeclaredNamesOf} drops it (fail closed).
 * Called by {@link stoppedFunctionDeclaredNamesOf}.
 * @param code - Blanked source.
 * @param stopped - The stopped function.
 * @returns The outer names; names only a sibling function declares are not outer.
 * @example outerDeclaredNamesOf('const make = (tenant) => (req) => req', stoppedFunctionAt(code, 36)!) // => Set { 'make', 'tenant' }
 */
function outerDeclaredNamesOf(
  code: string,
  stopped: StoppedFunction,
): ReadonlySet<string> {
  const names = new Set<string>()
  let inner = stopped
  // Walk outwards: each enclosing function must hold the head of the function inside it.
  for (
    let enclosing = stoppedFunctionAt(code, inner.headIndex);
    enclosing;
    enclosing = stoppedFunctionAt(code, inner.headIndex)
  ) {
    for (const name of [
      ...enclosing.parameterNames,
      ...declaredNamesIn(
        code,
        enclosing.bodyStart,
        enclosing.bodyEnd,
        inner.headIndex,
      ),
    ])
      names.add(name)
    inner = enclosing
  }
  // The module's top level is the outermost scope.
  for (const name of declaredNamesIn(code, 0, code.length, inner.headIndex))
    names.add(name)
  return names
}

/**
 * Names the variables the stopped function declares in its own source, so a replay copies a closure scope only when every name it holds is the stopped function's own.
 *
 * Why it exists: Bun reports a function's own scopes and its enclosing functions' scopes alike as closures, and an enclosing factory's closure may hold a client or a key; positive evidence from the stopped function's source keeps those out.
 * When it runs: once per Bun stop capture; called by {@link captureReplayDebugSnapshot} for {@link ownClosureScopePositionsOf}.
 *
 * The span is the innermost function whose body holds the stop (comments, template literals, strings and regex literals blanked first), from its body start to the end of the stop line or of its own body when that comes first, plus its own parameters. A name an enclosing function or the module also declares ({@link outerDeclaredNamesOf}) is ambiguous and left out, so the closure holding it is not copied. Only declarations whose scope holds the stop count (see {@link declaredNamesIn}), so a name from a closed inner function or block cannot make an enclosing factory's closure look like the stopped function's own. A parameter list that cannot be read with confidence counts as declaring nothing.
 *
 * @param sourceText - The stopped file's text.
 * @param line - The stop's 1-based line.
 * @param column - The stop's 1-based column; the end of the line when unknown.
 * @returns The declared names, or `undefined` when the stop position is outside the text or no function holds it.
 * @example
 * stoppedFunctionDeclaredNamesOf('const h = ({ query }) => {\n  const name = 1\n  return name\n}', 3, 3) // => Set { 'query', 'name' }
 */
export function stoppedFunctionDeclaredNamesOf(
  sourceText: string,
  line: number,
  column?: number,
): ReadonlySet<string> | undefined {
  const code = blankRegexLiterals(
    blankStringContents(blankCommentsAndTemplates(sourceText)),
  )
  const lineStarts = [0]
  for (let index = 0; index < code.length; index += 1)
    if (code[index] === '\n') lineStarts.push(index + 1)
  const lineStart = lineStarts[line - 1]
  if (!Number.isInteger(line) || line < 1 || lineStart === undefined)
    return undefined
  const rawLineEnd = code.indexOf('\n', lineStart)
  const lineEnd = rawLineEnd === -1 ? code.length : rawLineEnd
  const stop =
    column !== undefined && column >= 1
      ? Math.min(lineStart + column - 1, lineEnd)
      : lineEnd
  const stopped = stoppedFunctionAt(code, stop)
  if (!stopped) return undefined
  const outerNames = outerDeclaredNamesOf(code, stopped)
  const ownNames = [
    ...stopped.parameterNames,
    ...declaredNamesIn(
      code,
      stopped.bodyStart,
      Math.min(lineEnd, stopped.bodyEnd),
      stop,
    ),
  ]
  // A name an enclosing scope also declares never authorizes a closure.
  return new Set(ownNames.filter((name) => !outerNames.has(name)))
}
