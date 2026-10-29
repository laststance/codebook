/** The character that replaces the inside of a blanked string; no regular expression of the import finder treats it specially. */
const BLANKED_CHARACTER = '_'

/**
 * Replaces the characters between the quotes of every single-line quoted string with `_`, keeping the quotes, the line breaks and every position, so keywords written inside a string literal can no longer read as code.
 * Why: an `import './x.js'` or `importScripts(...)` inside a string literal must not be followed or counted (Cycle 0061).
 * Called by {@link findExtensionImportReferences} on a source whose comments and templates were already blanked by {@link blankCommentsAndTemplates}.
 * @param code - Source with comments and template literals blanked.
 * @returns The source with string contents blanked; an unclosed string ends at its line break.
 * @example
 * blankStringContents("a('import x') // b")
 * // => "a('_________') // b"
 */
export function blankStringContents(code: string): string {
  const characters = code.split('')
  let index = 0
  while (index < characters.length) {
    const quote = characters[index]
    index =
      quote === "'" || quote === '"'
        ? blankStringFrom(characters, index)
        : index + 1
  }
  return characters.join('')
}

/**
 * Blanks the string whose opening quote is at `start` and returns the index after it.
 * Walks to the closing quote, skipping the character after a backslash; a line break ends an unclosed string.
 */
function blankStringFrom(characters: string[], start: number): number {
  const quote = characters[start]
  let cursor = start + 1
  while (
    cursor < characters.length &&
    characters[cursor] !== quote &&
    characters[cursor] !== '\n'
  ) {
    const step = characters[cursor] === '\\' ? 2 : 1
    for (let inner = cursor; inner < cursor + step; inner += 1)
      if (characters[inner] !== '\n' && inner < characters.length)
        characters[inner] = BLANKED_CHARACTER
    cursor += step
  }
  return characters[cursor] === quote ? cursor + 1 : cursor
}
