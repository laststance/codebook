/** Whether the character at `index` ends a command: a line break, `;`, `|` (also `||`), or a `&` that is not part of a redirection (`2>&1`, `&>file`). */
function endsCommand(line: string, index: number): boolean {
  const char = line[index]
  if (char === '\n' || char === ';' || char === '|') return true
  return char === '&' && line[index - 1] !== '>' && line[index + 1] !== '>'
}

/**
 * Splits a shell command line into commands of unquoted words.
 *
 * Called by {@link readDeclaredDevelopmentPort} to read a `dev` script. Commands end at `&&`, `||`, `;`, `&`, `|` and line breaks outside quotes; a quoted string stays one word with its quotes removed, so `concurrently "next dev -p 4000"` keeps `next dev -p 4000` whole. A `&` that belongs to a redirection (`2>&1`, `&>file`) is part of its word. Nothing is executed or expanded.
 *
 * @param line - A script line from `package.json`.
 * @returns One word list per command; empty commands are left out.
 *
 * @example
 * ```ts
 * splitShellCommandLine('node api.js & PORT=4000 next dev') // [['node', 'api.js'], ['PORT=4000', 'next', 'dev']]
 * ```
 */
export function splitShellCommandLine(line: string): string[][] {
  const commands: string[][] = []
  let words: string[] = []
  let word: string | undefined
  let quote: '"' | "'" | undefined
  const endWord = (): void => {
    if (word !== undefined) words.push(word)
    word = undefined
  }
  const endCommand = (): void => {
    endWord()
    if (words.length) commands.push(words)
    words = []
  }
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    // Inside quotes every character is part of the word until the matching quote.
    if (quote) {
      if (char === quote) quote = undefined
      else word += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      word ??= ''
      continue
    }
    if (endsCommand(line, index)) endCommand()
    else if (/\s/.test(char)) endWord()
    else word = (word ?? '') + char
  }
  endCommand()
  return commands
}
