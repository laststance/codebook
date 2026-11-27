import {
  bindingNamesAt,
  identifierAt,
  isIdentifierCharacter,
  matchingCloseIndexOf,
  topLevelPartStartsOf,
} from './bindingNamesAt'
import { blankCommentsAndTemplates } from './blankCommentsAndTemplates'
import { blankStringContents } from './blankStringContents'

/** The stopped function as found in the source: where its body starts and the names its parameters bind. */
type StoppedFunction = { bodyStart: number; parameterNames: string[] }

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
function expressionBodyEndOf(code: string, start: number): number {
  let depth = 0
  for (let index = start; index < code.length; index += 1) {
    const character = code[index]!
    if ('([{'.includes(character)) depth += 1
    else if (')]}'.includes(character)) {
      if (depth === 0) return index
      depth -= 1
    } else if ((character === ',' || character === ';') && depth === 0)
      return index
  }
  return code.length
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
 * @example arrowAt('(a) => { x }', 4, 10) // => { bodyStart: 7, parameterNames: ['a'] }
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
  return { bodyStart, parameterNames: arrowParameterNamesOf(code, arrowIndex) }
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
 * @example functionAt('function f(a) { x }', 0, 16) // => { bodyStart: 14, parameterNames: ['a'] }
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
    bodyStart,
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

/**
 * Collects the names declared in a span: `const`/`let`/`var` bindings (patterns included), `function NAME`, `class NAME` and `catch (NAME)`.
 * Called by {@link stoppedFunctionDeclaredNamesOf}.
 * @param code - Blanked source.
 * @param from - Start of the span.
 * @param to - End of the span (exclusive).
 * @returns The declared names.
 * @example declaredNamesIn('const { a, b: c } = x', ...) // => ['a', 'c']
 */
function declaredNamesIn(code: string, from: number, to: number): string[] {
  const span = code.slice(from, to)
  const names: string[] = []
  for (const match of span.matchAll(VARIABLE_DECLARATION))
    names.push(...bindingNamesAt(span, match.index + match[0].length))
  for (const match of span.matchAll(NAMED_DECLARATION)) names.push(match[1]!)
  for (const match of span.matchAll(CATCH_BINDING))
    names.push(...bindingNamesAt(span, match.index + match[0].length))
  return names
}

/**
 * Names the variables the stopped function declares in its own source, so a replay copies a closure scope only when every name it holds is the stopped function's own.
 *
 * Why it exists: Bun reports a function's own scopes and its enclosing functions' scopes alike as closures, and an enclosing factory's closure may hold a client or a key; positive evidence from the stopped function's source keeps those out.
 * When it runs: once per Bun stop capture; called by {@link captureReplayDebugSnapshot} for {@link ownClosureScopePositionsOf}.
 *
 * The span is the innermost function whose body holds the stop (comments, template literals and strings blanked first), from its body start to the end of the stop line, plus its own parameters. A parameter list that cannot be read with confidence counts as declaring nothing.
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
  const code = blankStringContents(blankCommentsAndTemplates(sourceText))
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
  return new Set([
    ...stopped.parameterNames,
    ...declaredNamesIn(code, stopped.bodyStart, lineEnd),
  ])
}
