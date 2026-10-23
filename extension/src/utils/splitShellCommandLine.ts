/** Whether the character at `index` ends a command: a line break, `;`, `|` (also `||`), or a `&` that is not part of a redirection (`2>&1`, `&>file`). */
function endsCommand(line: string, index: number): boolean {
  const char = line[index]
  if (char === '\n' || char === ';' || char === '|') return true
  return char === '&' && line[index - 1] !== '>' && line[index + 1] !== '>'
}

/**
 * Classifies the unquoted character at `index`:
 * - `comment`: a `#` that starts a word begins a comment up to the line break, as in a shell (`next dev # -p 4000` runs on 3000)
 * - `parenthesis`: a word of its own, so a subshell `(cd app && next dev)` is recognizable instead of gluing to a neighbor
 * - `command-end`, `blank`, or `text` for every other character
 */
function classifyUnquoted(
  line: string,
  index: number,
  inWord: boolean,
): 'comment' | 'parenthesis' | 'command-end' | 'blank' | 'text' {
  const char = line[index]!
  if (char === '#' && !inWord) return 'comment'
  if (char === '(' || char === ')') return 'parenthesis'
  if (endsCommand(line, index)) return 'command-end'
  return /\s/.test(char) ? 'blank' : 'text'
}

/** The index of the last character of the comment that starts at `start`: the one before the next line break, or the line's end. */
function lastIndexOfComment(line: string, start: number): number {
  const lineBreak = line.indexOf('\n', start)
  return lineBreak < 0 ? line.length - 1 : lineBreak - 1
}

/**
 * Splits a shell command line into commands of unquoted words.
 *
 * Called by {@link readDeclaredDevelopmentPort} to read a `dev` script. Commands end at `&&`, `||`, `;`, `&`, `|` and line breaks outside quotes; a quoted string stays one word with its quotes removed, so `concurrently "next dev -p 4000"` keeps `next dev -p 4000` whole. A `&` that belongs to a redirection (`2>&1`, `&>file`) is part of its word. An unquoted `#` at the start of a word begins a comment that runs to the line break. An unquoted parenthesis is a word of its own. Nothing is executed or expanded.
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
    switch (classifyUnquoted(line, index, word !== undefined)) {
      case 'comment':
        index = lastIndexOfComment(line, index)
        break
      case 'parenthesis':
        endWord()
        words.push(char)
        break
      case 'command-end':
        endCommand()
        break
      case 'blank':
        endWord()
        break
      default:
        word = (word ?? '') + char
    }
  }
  endCommand()
  return commands
}
