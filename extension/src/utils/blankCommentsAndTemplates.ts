/**
 * Blanks a module source's comments and template literals, nested templates and their `${…}` parts included, with spaces that keep every line break and character position, so that only code can read as an import declaration. Quoted strings stay, since a declaration's specifier and its quoted export names are strings. Regular expression literals are not parsed.
 * Why: an import written in a comment or in a test's source fixture bound a name, and a nested template's inner backticks ended the masking early (Cycle 0052 tasks 87, 88).
 * Called by {@link sourceImportBindings}.
 * @param sourceText - A module's source.
 * @returns The source with its comments and template literals blanked.
 * @example
 * blankCommentsAndTemplates("a // b\nc `d ${`e`}`")
 * // => 'a     \nc           '
 */
export function blankCommentsAndTemplates(sourceText: string): string {
  const spans: Array<[number, number]> = []
  scanCode(sourceText, 0, spans, false)
  const characters = sourceText.split('')
  for (const [from, to] of spans)
    for (let index = from; index < to; index += 1)
      if (characters[index] !== '\n') characters[index] = ' '
  return characters.join('')
}

/**
 * Walks code from `start` to the source's end or, inside a template's `${…}`, to the brace that closes it, recording the comments and templates it passes; called by {@link blankCommentsAndTemplates} and {@link templateEnd}.
 * @returns The index after the code.
 */
function scanCode(
  text: string,
  start: number,
  spans: Array<[number, number]>,
  isInsideTemplate: boolean,
): number {
  let depth = 0,
    index = start
  while (index < text.length) {
    const skipped = skipNonCode(text, index, spans)
    if (skipped !== index) {
      index = skipped
      continue
    }
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      // Inside a template's `${…}`, the brace that closes it ends this code.
      if (isInsideTemplate && depth === 0) return index + 1
      depth -= 1
    }
    index += 1
  }
  return index
}

/**
 * Skips the comment, quoted string or template literal that starts at `index`, recording comments and templates as spans to blank; called by {@link scanCode}.
 * @returns The index after it, or `index` when none starts there.
 */
function skipNonCode(
  text: string,
  index: number,
  spans: Array<[number, number]>,
): number {
  const pair = text.slice(index, index + 2),
    character = text[index]
  if (character === "'" || character === '"') return stringEnd(text, index)
  const end =
    pair === '//'
      ? lineEnd(text, index)
      : pair === '/*'
        ? blockCommentEnd(text, index)
        : character === '`'
          ? templateEnd(text, index)
          : index
  if (end !== index) spans.push([index, end])
  return end
}

/** The index of the line break that ends a line comment, or the source's end. */
function lineEnd(text: string, index: number): number {
  const lineBreak = text.indexOf('\n', index)
  return lineBreak === -1 ? text.length : lineBreak
}

/** The index after a block comment's `*\/`, or the source's end. */
function blockCommentEnd(text: string, index: number): number {
  const close = text.indexOf('*/', index + 2)
  return close === -1 ? text.length : close + 2
}

/** The index after a quoted string's closing quote; an unclosed string ends at its line break. */
function stringEnd(text: string, index: number): number {
  const quote = text[index]
  let cursor = index + 1
  while (
    cursor < text.length &&
    text[cursor] !== quote &&
    text[cursor] !== '\n'
  )
    cursor += text[cursor] === '\\' ? 2 : 1
  return text[cursor] === quote ? cursor + 1 : cursor
}

/** The index after a template literal's closing backtick, its `${…}` parts (and the templates nested in them) passed whole; an unclosed one ends at the source's end. */
function templateEnd(text: string, index: number): number {
  let cursor = index + 1
  while (cursor < text.length && text[cursor] !== '`') {
    if (text[cursor] === '\\') cursor += 2
    else if (text.startsWith('${', cursor))
      cursor = scanCode(text, cursor + 2, [], true)
    else cursor += 1
  }
  return Math.min(cursor + 1, text.length)
}
