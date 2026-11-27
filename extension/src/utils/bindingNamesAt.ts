/** The characters an identifier may continue with. */
const IDENTIFIER_PART = /[\w$]/
/** An identifier at a position (sticky). */
const IDENTIFIER = /[A-Za-z_$][\w$]*/y

/**
 * Reads the identifier that starts at `index`.
 * Called by {@link bindingNamesAt} and {@link stoppedFunctionDeclaredNamesOf}.
 * @param code - Source with comments, templates and string contents blanked.
 * @param index - Where to read.
 * @returns The identifier, or `undefined` when none starts there.
 * @example identifierAt('const x', 6) // => 'x'
 */
export function identifierAt(code: string, index: number): string | undefined {
  IDENTIFIER.lastIndex = index
  return IDENTIFIER.exec(code)?.[0]
}

/**
 * Says whether a character can be part of an identifier.
 * Called by {@link stoppedFunctionDeclaredNamesOf} to find word boundaries and a parameter's name.
 * @param character - One character, or `undefined` past the text's end.
 * @returns `true` for a letter, digit, `_` or `$`.
 * @example isIdentifierCharacter('a') // => true
 */
export function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && IDENTIFIER_PART.test(character)
}

/**
 * Says how a character changes the bracket depth.
 * Called by {@link topLevelPartStartsOf} and {@link firstSeparatorOf}.
 * @param character - One character of blanked source.
 * @returns `1` for `(`, `[` or `{`; `-1` for `)`, `]` or `}`; otherwise `0`.
 * @example bracketDepthChangeOf('{') // => 1
 */
function bracketDepthChangeOf(character: string | undefined): number {
  if (character === '(' || character === '[' || character === '{') return 1
  if (character === ')' || character === ']' || character === '}') return -1
  return 0
}

/**
 * Finds the bracket that closes the one opened at `openIndex`, counting `(`, `[` and `{` together.
 * Called by {@link bindingNamesAt} and {@link stoppedFunctionDeclaredNamesOf}.
 * @param code - Source with comments, templates and string contents blanked.
 * @param openIndex - The index of an opening bracket.
 * @returns The index of its closing bracket, or `-1` when the text ends first.
 * @example matchingCloseIndexOf('{a:[1]}', 0) // => 6
 */
export function matchingCloseIndexOf(code: string, openIndex: number): number {
  let depth = 0
  for (let index = openIndex; index < code.length; index += 1) {
    const character = code[index]
    if (character === '(' || character === '[' || character === '{') depth += 1
    else if (character === ')' || character === ']' || character === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * Splits `code[from, to)` at the commas that sit outside every bracket and every `<…>` type argument list.
 * Called by {@link patternNamesOf} for a pattern's elements and by {@link stoppedFunctionDeclaredNamesOf} for a parameter list.
 * @param code - Source with comments, templates and string contents blanked.
 * @param from - Start of the text.
 * @param to - End of the text (exclusive).
 * @returns The start index of each part.
 * @example topLevelPartStartsOf('a, {b, c}, d', 0, 12) // => [0, 3, 10]
 */
export function topLevelPartStartsOf(
  code: string,
  from: number,
  to: number,
): number[] {
  const starts = [from]
  let depth = 0
  let angleDepth = 0
  for (let index = from; index < to; index += 1) {
    const character = code[index]
    depth += bracketDepthChangeOf(character)
    if (character === '<') angleDepth += 1
    // An arrow `=>` is no closing angle bracket.
    else if (character === '>' && code[index - 1] !== '=')
      angleDepth = Math.max(0, angleDepth - 1)
    else if (character === ',' && depth === 0 && angleDepth === 0)
      starts.push(index + 1)
  }
  return starts
}

/**
 * Finds the first `:` or `=` outside every bracket in `code[from, to)`.
 * Called by {@link patternNamesOf} to tell an object pattern's `key: value` from `name = default`.
 * @param code - Source with comments, templates and string contents blanked.
 * @param from - Start of the text.
 * @param to - End of the text (exclusive).
 * @returns That character and its index, or `undefined` when neither occurs.
 * @example firstSeparatorOf('b: c', 0, 4) // => { character: ':', index: 1 }
 */
function firstSeparatorOf(
  code: string,
  from: number,
  to: number,
): { character: ':' | '='; index: number } | undefined {
  let depth = 0
  for (let index = from; index < to; index += 1) {
    const character = code[index]
    depth += bracketDepthChangeOf(character)
    if ((character === ':' || character === '=') && depth === 0)
      return { character, index }
  }
  return undefined
}

/**
 * Collects the names a destructuring pattern binds: `{ a, b: c, d = x }` binds `a`, `c`, `d`; never a property key such as `b` nor a default value's expression.
 * Called by {@link bindingNamesAt}.
 * @param code - Source with comments, templates and string contents blanked.
 * @param openIndex - The index of the pattern's `{` or `[`.
 * @param closeIndex - The index of its matching close.
 * @returns The bound names.
 * @example patternNamesOf('{ a, b: c, d = x }', 0, 17) // => ['a', 'c', 'd']
 */
function patternNamesOf(
  code: string,
  openIndex: number,
  closeIndex: number,
): string[] {
  const isObject = code[openIndex] === '{'
  const names: string[] = []
  const starts = topLevelPartStartsOf(code, openIndex + 1, closeIndex)
  for (const [position, start] of starts.entries()) {
    const end = (starts[position + 1] ?? closeIndex + 1) - 1
    // An array pattern's element, an object pattern's shorthand and a rest element all bind the name at their start.
    if (!isObject) {
      names.push(...bindingNamesAt(code, start))
      continue
    }
    const separator = firstSeparatorOf(code, start, end)
    const text = code.slice(start, end).trimStart()
    if (separator?.character === ':')
      names.push(...bindingNamesAt(code, separator.index + 1))
    // A computed key without a value binds nothing.
    else if (!text.startsWith('[')) names.push(...bindingNamesAt(code, start))
  }
  return names
}

/**
 * Reads the binding that starts at `start`: a name, `...name`, or a destructuring pattern; a type annotation or default after it is ignored.
 * Why it exists: a replay copies a closure only when every name in it is declared by the stopped function, so the declared names must be read exactly (never a property key, never a default's expression).
 * Called by {@link stoppedFunctionDeclaredNamesOf} for each declaration and parameter.
 * @param code - Source with comments, templates and string contents blanked.
 * @param start - Where the binding starts; leading whitespace is skipped.
 * @returns The bound names; an empty list when nothing readable starts there.
 * @example
 * bindingNamesAt('{ a, b: c }: Props', 0) // => ['a', 'c']
 * bindingNamesAt('...rest', 0) // => ['rest']
 */
export function bindingNamesAt(code: string, start: number): string[] {
  let index = start
  while (/\s/.test(code[index] ?? '')) index += 1
  if (code.startsWith('...', index)) {
    index += 3
    while (/\s/.test(code[index] ?? '')) index += 1
  }
  if (code[index] === '{' || code[index] === '[') {
    const closeIndex = matchingCloseIndexOf(code, index)
    return closeIndex === -1 ? [] : patternNamesOf(code, index, closeIndex)
  }
  const name = identifierAt(code, index)
  return name === undefined ? [] : [name]
}
