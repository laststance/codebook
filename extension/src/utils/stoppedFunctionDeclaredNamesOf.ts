import { BUN_CLOSURE_CLASSIFICATION_MAX_SOURCE_CHARS } from '../constants'

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

/** A function as found in the source: where its head starts (the `=>` or the `function` keyword), where its parameter list starts (`-1` when unreadable), where its body starts and ends (exclusive), the names its parameters bind, and whether its body boundary could be read with confidence. */
type StoppedFunction = {
  headIndex: number
  parametersStart: number
  isBoundaryReadable: boolean
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
 * Finds where an arrow's parameters start: the `(` of its group or its single parameter name.
 * Called by {@link arrowAt} and {@link siblingSpansOf}.
 * @param code - Blanked source.
 * @param arrowIndex - The index of the `=>`.
 * @returns The start index, or `-1` when the text before `=>` is not a plain parameter group or a single name (for example a TypeScript return type).
 * @example arrowParametersStartOf('(a) => 1', 4) // => 0
 */
function arrowParametersStartOf(code: string, arrowIndex: number): number {
  const last = lastNonWhitespaceBefore(code, arrowIndex)
  if (code[last] === ')') return matchingOpenIndexOf(code, last)
  if (!isIdentifierCharacter(code[last])) return -1
  let start = last
  while (isIdentifierCharacter(code[start - 1])) start -= 1
  const before = lastNonWhitespaceBefore(code, start)
  // `): Type =>` is a return type, not a parameter.
  return code[before] === ':' || code[before] === '.' ? -1 : start
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
    parametersStart: arrowParametersStartOf(code, arrowIndex),
    isBoundaryReadable: true,
    bodyStart,
    bodyEnd,
    parameterNames: arrowParameterNamesOf(code, arrowIndex),
  }
}

/** Characters that, right before a `{` after a function's parameters, make that brace a type literal of the return type, not the body. */
const TYPE_LITERAL_PREDECESSORS = ':<|&,(['

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
 * Finds where a function whose return type opens with a type literal (`): { ok: boolean } {`) ends, since the first `{` after its parameters is then the type, not the body.
 * Called by {@link functionAt}.
 * @param code - Blanked source.
 * @param parametersEnd - The index of the `)` closing the parameter list.
 * @param firstBrace - The index of the first `{` after it.
 * @returns The end (exclusive) of the stretch whose boundary cannot be read, or `undefined` when the first brace is the body.
 * @example unreadableReturnTypeEndOf('function f(): { a: 1 } { b }', 10, 14) // => 28
 */
function unreadableReturnTypeEndOf(
  code: string,
  parametersEnd: number,
  firstBrace: number,
): number | undefined {
  const beforeBrace = lastNonWhitespaceBefore(code, firstBrace)
  if (
    beforeBrace <= parametersEnd ||
    !TYPE_LITERAL_PREDECESSORS.includes(code[beforeBrace]!)
  )
    return undefined
  const typeClose = matchingCloseIndexOf(code, firstBrace)
  const realBody = typeClose === -1 ? -1 : code.indexOf('{', typeClose)
  const realClose = realBody === -1 ? -1 : matchingCloseIndexOf(code, realBody)
  return realClose === -1 ? code.length : realClose + 1
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
  const firstBrace =
    parametersEnd === -1 ? -1 : code.indexOf('{', parametersEnd)
  if (firstBrace === -1) return undefined
  const parameterNames = parameterNamesOf(code, cursor + 1, parametersEnd)
  const unreadableEnd = unreadableReturnTypeEndOf(
    code,
    parametersEnd,
    firstBrace,
  )
  if (unreadableEnd !== undefined) {
    if (stop <= parametersEnd || stop >= unreadableEnd) return undefined
    return {
      headIndex: keywordIndex,
      parametersStart: cursor,
      isBoundaryReadable: false,
      bodyStart: firstBrace,
      bodyEnd: unreadableEnd,
      parameterNames,
    }
  }
  const closeIndex = matchingCloseIndexOf(code, firstBrace)
  const bodyEnd = closeIndex === -1 ? code.length : closeIndex + 1
  if (stop < firstBrace || stop >= bodyEnd) return undefined
  return {
    headIndex: keywordIndex,
    parametersStart: cursor,
    isBoundaryReadable: true,
    bodyStart: firstBrace,
    bodyEnd,
    parameterNames,
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

/** Keywords whose `(…)` head is followed by a block statement. */
const BLOCK_HEAD_KEYWORDS: ReadonlySet<string> = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'with',
])

/** Keywords after which a `{` is a block statement or an object literal. */
const SAFE_BRACE_KEYWORDS: ReadonlySet<string> = new Set([
  'else',
  'try',
  'finally',
  'do',
  'return',
  'yield',
  'throw',
])

/** Characters after which a `{` is a block statement or an object literal. */
const SAFE_BRACE_PREDECESSORS = ';{=(,[:?'

/**
 * Reads the word that ends at `end`.
 * Called by {@link braceOpeningIsSafe}.
 * @param code - Blanked source.
 * @param end - The index of the word's last character.
 * @returns The word, or an empty string when no identifier ends there.
 * @example wordEndingAt('else {', 3) // => 'else'
 */
function wordEndingAt(code: string, end: number): string {
  let start = end
  while (isIdentifierCharacter(code[start - 1])) start -= 1
  return isIdentifierCharacter(code[end]) ? code.slice(start, end + 1) : ''
}

/**
 * Checks that a `{` opens a block statement or an object literal, never a method, class, static block, namespace, enum, arrow body or JSX container (fail closed).
 * Called by {@link openBracesAreSafe}.
 * @param code - Blanked source.
 * @param braceIndex - The index of the `{`.
 * @returns `true` only for a known safe opening.
 * @example braceOpeningIsSafe('if (a) { b }', 7) // => true
 */
function braceOpeningIsSafe(code: string, braceIndex: number): boolean {
  const previous = lastNonWhitespaceBefore(code, braceIndex)
  if (previous < 0) return false
  const character = code[previous]!
  if (SAFE_BRACE_PREDECESSORS.includes(character)) return true
  if (isIdentifierCharacter(character))
    return SAFE_BRACE_KEYWORDS.has(wordEndingAt(code, previous))
  if (character !== ')') return false
  // `)` opens a block only after `if`, `for`, `for await`, `while`, `switch`, `catch` or `with`.
  const open = matchingOpenIndexOf(code, previous)
  if (open === -1) return false
  const headEnd = lastNonWhitespaceBefore(code, open)
  const word = wordEndingAt(code, headEnd)
  if (word !== 'await') return BLOCK_HEAD_KEYWORDS.has(word)
  const forEnd = lastNonWhitespaceBefore(code, headEnd - word.length + 1)
  return wordEndingAt(code, forEnd) === 'for'
}

/**
 * Checks every `{` still open at the stop between the stopped function's body start and the stop: each must be a known safe opening.
 * Why it exists: a method, getter, class body or static block has no `function` or `=>` head, so the scanner would attribute a stop inside it to the enclosing function and could copy that function's private values.
 * Called by {@link stoppedFunctionDeclaredNamesOf}.
 * @param code - Blanked source.
 * @param stopped - The stopped function.
 * @param stop - The stop's index.
 * @returns `true` when every open brace is a safe block or object literal.
 * @example openBracesAreSafe('function get(t) { return { get() { return t } } }', stoppedFunctionAt(code, 43)!, 43) // => false
 */
function openBracesAreSafe(
  code: string,
  stopped: StoppedFunction,
  stop: number,
): boolean {
  // A braced body's own brace is the function itself; an expression body starts right at its text.
  const from =
    code[stopped.bodyStart] === '{' ? stopped.bodyStart + 1 : stopped.bodyStart
  const openBrackets: number[] = []
  for (let index = from; index < stop; index += 1) {
    const character = code[index]!
    if ('([{'.includes(character)) openBrackets.push(index)
    else if (')]}'.includes(character)) openBrackets.pop()
  }
  return openBrackets
    .filter((index) => code[index] === '{')
    .every((index) => braceOpeningIsSafe(code, index))
}

/**
 * Finds the span of an arrow whose `=>` is at `arrowIndex` when its body is a certain brace block that does not hold the stop.
 * Called by {@link siblingSpansOf}.
 * @param code - Blanked source.
 * @param arrowIndex - The index of the `=>`.
 * @param stop - The stop's index.
 * @returns The span from its parameters to its body end, or `undefined` when it is not certain or holds the stop.
 * @example siblingArrowSpanAt('const a = (x) => { x }', 16, 99) // => { start: 10, end: 22 }
 */
function siblingArrowSpanAt(
  code: string,
  arrowIndex: number,
  stop: number,
): Region | undefined {
  const bodyStart = skipWhitespace(code, arrowIndex + 2)
  const start = arrowParametersStartOf(code, arrowIndex)
  if (code[bodyStart] !== '{' || start === -1) return undefined
  const closeIndex = matchingCloseIndexOf(code, bodyStart)
  if (closeIndex === -1 || (stop >= start && stop <= closeIndex))
    return undefined
  return { start, end: closeIndex + 1 }
}

/**
 * Finds the span of a `function` whose parameter list is followed directly by a brace body that does not hold the stop.
 * Called by {@link siblingSpansOf}.
 * @param code - Blanked source.
 * @param keywordIndex - The index of `function`.
 * @param stop - The stop's index.
 * @returns The span from its parameter list to its body end, or `undefined` when it is not certain or holds the stop.
 * @example siblingFunctionSpanAt('function f(x) { x }', 0, 99) // => { start: 10, end: 19 }
 */
function siblingFunctionSpanAt(
  code: string,
  keywordIndex: number,
  stop: number,
): Region | undefined {
  const start = parameterListStartOf(code, keywordIndex)
  if (code[start] !== '(') return undefined
  const parametersEnd = matchingCloseIndexOf(code, start)
  const bodyStart =
    parametersEnd === -1 ? -1 : skipWhitespace(code, parametersEnd + 1)
  if (bodyStart === -1 || code[bodyStart] !== '{') return undefined
  const closeIndex = matchingCloseIndexOf(code, bodyStart)
  if (closeIndex === -1 || (stop >= start && stop <= closeIndex))
    return undefined
  return { start, end: closeIndex + 1 }
}

/**
 * Finds the spans of other functions that certainly do not hold the stop: an arrow whose `=>` is followed by `{`, and a `function` whose parameter list is followed directly by `{`; each from its parameters to its body end.
 * Called by {@link outerNamesOf}.
 * @param code - Blanked source.
 * @param stop - The stop's index.
 * @returns The spans, possibly nested.
 * @example siblingSpansOf('const a = (x) => { x }', 99) // => [{ start: 10, end: 22 }]
 */
function siblingSpansOf(code: string, stop: number): Region[] {
  return [
    ...[...code.matchAll(/=>/g)].map((match) =>
      siblingArrowSpanAt(code, match.index, stop),
    ),
    ...[...code.matchAll(/(?<![\w$.])function(?![\w$])/g)].map((match) =>
      siblingFunctionSpanAt(code, match.index, stop),
    ),
  ].filter((span) => span !== undefined)
}

/**
 * Collects every identifier of the file that could be an enclosing scope's name: all identifier tokens outside the stopped function's own span and outside the certain spans of other functions, except property names after a single `.`.
 * Why it exists: a name an enclosing function or the module also declares cannot tell whose value a closure holds, so {@link stoppedFunctionDeclaredNamesOf} drops it. An over-approximation cannot miss a destructured, comma-separated, catch, imported or parameter name of an enclosing scope; a surplus name only withholds a closure.
 * Called by {@link stoppedFunctionDeclaredNamesOf}.
 * @param tokenCode - Source with comments, templates and strings blanked, regex literals kept.
 * @param code - The same source with regex literals blanked too (finds the spans).
 * @param stopped - The stopped function.
 * @param ownEnd - Where the stopped function's own span ends (exclusive).
 * @param stop - The stop's index.
 * @returns The outer names.
 * @example outerNamesOf(tokenCode, code, stoppedFunctionAt(code, 36)!, 38, 36) // => Set { 'const', 'make', 'tenant' }
 */
function outerNamesOf(
  tokenCode: string,
  code: string,
  stopped: StoppedFunction,
  ownEnd: number,
  stop: number,
): ReadonlySet<string> {
  const isExcluded = new Uint8Array(tokenCode.length)
  const exclude = ({ start, end }: Region): void => {
    isExcluded.fill(1, Math.max(0, start), Math.min(end, tokenCode.length))
  }
  // The own span starts at the parameter list; an unreadable list starts at the head.
  exclude({
    start:
      stopped.parametersStart === -1
        ? stopped.headIndex
        : stopped.parametersStart,
    end: ownEnd,
  })
  // A sibling span counts only when both readings of the text agree on it (a misread regex literal cannot stretch it over an enclosing name).
  const confirmed = new Set(
    siblingSpansOf(tokenCode, stop).map(({ start, end }) => `${start}:${end}`),
  )
  for (const span of siblingSpansOf(code, stop))
    if (confirmed.has(`${span.start}:${span.end}`)) exclude(span)
  const names = new Set<string>()
  for (const match of tokenCode.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (isExcluded[match.index] === 1) continue
    // A property name directly after a single `.` is no binding; `...rest` is.
    const before = match.index - 1
    if (tokenCode[before] === '.' && tokenCode[before - 1] !== '.') continue
    names.add(match[0])
  }
  return names
}

/**
 * Names the variables the stopped function declares in its own source, so a replay copies a closure scope only when every name it holds is the stopped function's own.
 *
 * Why it exists: Bun reports a function's own scopes and its enclosing functions' scopes alike as closures, and an enclosing factory's closure may hold a client or a key; positive evidence from the stopped function's source keeps those out.
 * When it runs: once per Bun stop capture; called by {@link captureReplayDebugSnapshot} for {@link ownClosureScopePositionsOf}.
 *
 * The span is the innermost function whose body holds the stop (comments, template literals, strings and regex literals blanked first), from its body start to the end of the stop line or of its own body when that comes first, plus its own parameters. A name that appears anywhere in the enclosing functions' or the module's own code ({@link outerNamesOf}) is ambiguous and left out, so the closure holding it is not copied. Only declarations whose scope holds the stop count (see {@link declaredNamesIn}), so a name from a closed inner function or block cannot make an enclosing factory's closure look like the stopped function's own. A parameter list that cannot be read with confidence counts as declaring nothing.
 *
 * @param sourceText - The stopped file's text.
 * @param line - The stop's 1-based line.
 * @param column - The stop's 1-based column; the end of the line when unknown.
 * @returns The declared names, or `undefined` when the stop position is outside the text, no function holds it, the function's boundary cannot be read (a method, class body, static block, return type with a type literal, or an unknown brace around the stop), or the source is above {@link BUN_CLOSURE_CLASSIFICATION_MAX_SOURCE_CHARS}.
 * @example
 * stoppedFunctionDeclaredNamesOf('const h = ({ query }) => {\n  const name = 1\n  return name\n}', 3, 3) // => Set { 'query', 'name' }
 */
export function stoppedFunctionDeclaredNamesOf(
  sourceText: string,
  line: number,
  column?: number,
): ReadonlySet<string> | undefined {
  // Above the cap the scans could stall the stop capture: copy nothing.
  if (sourceText.length > BUN_CLOSURE_CLASSIFICATION_MAX_SOURCE_CHARS)
    return undefined
  const tokenCode = blankStringContents(blankCommentsAndTemplates(sourceText))
  const code = blankRegexLiterals(tokenCode)
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
  // A boundary that cannot be read, or a stop inside a method, class body or other unknown brace, withholds every closure.
  if (!stopped || !stopped.isBoundaryReadable) return undefined
  if (!openBracesAreSafe(code, stopped, stop)) return undefined
  const ownEnd =
    code[stopped.bodyStart] === '{'
      ? stopped.bodyEnd
      : Math.min(lineEnd, stopped.bodyEnd)
  const outerNames = outerNamesOf(tokenCode, code, stopped, ownEnd, stop)
  const ownNames = [
    ...stopped.parameterNames,
    ...declaredNamesIn(
      code,
      stopped.bodyStart,
      Math.min(lineEnd, stopped.bodyEnd),
      stop,
    ),
  ]
  // A name that appears anywhere in the enclosing code never authorizes a closure.
  return new Set(ownNames.filter((name) => !outerNames.has(name)))
}
