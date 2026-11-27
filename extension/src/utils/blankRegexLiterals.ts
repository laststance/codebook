import { isIdentifierCharacter } from './bindingNamesAt'

/** Characters after which a `/` can only start a regular expression, never divide. */
const REGEX_START_PREDECESSORS = '(,=:[!&|?{};+-*%<>~^}'

/** Keywords after which a `/` starts a regular expression. */
const REGEX_START_KEYWORDS: ReadonlySet<string> = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'delete',
  'void',
  'throw',
  'new',
  'instanceof',
  'yield',
  'await',
])

/**
 * Finds the closing `/` of a regular expression literal that opens at `start`, on the same line.
 * Called by {@link blankRegexLiterals}.
 * @param code - Source with comments and strings blanked.
 * @param start - The index of the opening `/`.
 * @returns The index of the closing `/`, or `-1` when the line ends first.
 * @example regexCloseIndexOf('/a[/]b/g', 0) // => 6
 */
function regexCloseIndexOf(code: string, start: number): number {
  let inClass = false
  for (let index = start + 1; index < code.length; index += 1) {
    const character = code[index]!
    if (character === '\n') return -1
    // An escape hides the next character; a `/` inside `[...]` does not close.
    if (character === '\\') index += 1
    else if (character === '[') inClass = true
    else if (character === ']') inClass = false
    else if (character === '/' && !inClass) return index
  }
  return -1
}

/**
 * Checks whether the text before a `/` makes it certainly the start of a regular expression: nothing before it, an operator or opening bracket, or a keyword such as `return`.
 * Called by {@link blankRegexLiterals}.
 * @param code - Source with comments and strings blanked.
 * @param slashIndex - The index of the `/`.
 * @returns `true` when a division is impossible there.
 * @example regexStartsAfter('x = /a/', 4) // => true
 */
function regexStartsAfter(code: string, slashIndex: number): boolean {
  let last = slashIndex - 1
  while (last >= 0 && /\s/.test(code[last]!)) last -= 1
  if (last < 0) return true
  if (REGEX_START_PREDECESSORS.includes(code[last]!)) return true
  let wordStart = last
  while (isIdentifierCharacter(code[wordStart - 1])) wordStart -= 1
  return REGEX_START_KEYWORDS.has(code.slice(wordStart, last + 1))
}

/**
 * Checks whether the brackets in a stretch of text pair up on their own.
 * Called by {@link blankRegexLiterals} before it blanks a stretch that may be a division, so blanking never unbalances the code around it.
 * @param text - The stretch.
 * @returns `true` when every bracket closes inside the stretch.
 * @example isBracketBalanced('(a)[b]') // => true
 */
function isBracketBalanced(text: string): boolean {
  let depth = 0
  for (const character of text) {
    if ('([{'.includes(character)) depth += 1
    else if (')]}'.includes(character) && --depth < 0) return false
  }
  return depth === 0
}

/**
 * Blanks regular expression literals (and their flags) with spaces, keeping line breaks and every position, so words inside a literal such as `/const label/` no longer read as code.
 *
 * Why it exists: the stopped function's declared names authorize replay capture, and a name read out of a regex literal must not. The reading is a heuristic that fails toward blanking more: after an operator, an opening bracket or a keyword a `/` is a literal for certain; after a name, a number or a closing bracket it may be a division, and the stretch up to the next `/` on the line is blanked too when its brackets pair up, which can only remove names.
 * Called by {@link stoppedFunctionDeclaredNamesOf} after comments, templates and strings are blanked.
 * @param code - Source with comments, templates and strings blanked.
 * @returns The source with literals blanked.
 * @example blankRegexLiterals('const a = /const label/g') // => 'const a =               '
 */
export function blankRegexLiterals(code: string): string {
  const characters = code.split('')
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] !== '/') continue
    const close = regexCloseIndexOf(code, index)
    if (close === -1) continue
    // A possible division is blanked only when that cannot unbalance the code around it.
    if (
      !regexStartsAfter(code, index) &&
      !isBracketBalanced(code.slice(index, close + 1))
    )
      continue
    let end = close + 1
    while (isIdentifierCharacter(code[end])) end += 1
    for (let blank = index; blank < end; blank += 1) characters[blank] = ' '
    index = end - 1
  }
  return characters.join('')
}
