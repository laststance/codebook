/** Whether the character at `index` ends a command: a line break, `;`, `|` (also `||`), or a `&` that is not part of a redirection (`2>&1`, `&>file`). */
function endsCommand(line: string, index: number): boolean {
  const char = line[index]
  if (char === '\n' || char === ';' || char === '|') return true
  return char === '&' && line[index - 1] !== '>' && line[index + 1] !== '>'
}

/**
 * Classifies the unquoted character at `index`:
 * - `comment`: a `#` that starts a word (POSIX only) begins a comment up to the line break, as in a shell (`next dev # -p 4000` runs on 3000)
 * - `parenthesis`: a word of its own, so a subshell `(cd app && next dev)` is recognizable instead of gluing to a neighbor
 * - `command-end`, `blank`, or `text` for every other character
 */
function classifyUnquoted(
  line: string,
  index: number,
  inWord: boolean,
  dialect: ShellDialect,
): 'comment' | 'parenthesis' | 'command-end' | 'blank' | 'text' {
  const char = line[index]!
  // `#` starts a comment in a POSIX shell only; in `cmd /c` text it is an ordinary character (F465).
  if (char === '#' && !inWord && dialect === 'posix') return 'comment'
  if (char === '(' || char === ')') return 'parenthesis'
  if (endsCommand(line, index)) return 'command-end'
  return /\s/.test(char) ? 'blank' : 'text'
}

/** The index of the last character of the comment that starts at `start`: the one before the next line break, or the line's end. */
function lastIndexOfComment(line: string, start: number): number {
  const lineBreak = line.indexOf('\n', start)
  return lineBreak < 0 ? line.length - 1 : lineBreak - 1
}

/** Which shell's rules read the text: `posix` (`sh`, `bash`, the usual `package.json` script) or `cmd` (the text after `cmd /c`, where `#` and backslashes are ordinary characters). */
export type ShellDialect = 'posix' | 'cmd'

/** One word of a command: its unquoted text, and whether a double-quoted part of it holds an unescaped `$`, which the shell around it expands before the word reaches the command (so `bash -c "…${PORT:-1}…"` sees the outer shell's `PORT`). */
export type ShellWord = { text: string; expandedByOuterShell: boolean }

/** The unquoted characters a backslash escapes. Any other backslash stays literal, so a Windows path such as `node_modules\.bin\next` survives. */
const UNQUOTED_ESCAPABLE = /[\s"'`;&|()#$<>]/
/** The characters a backslash escapes inside double quotes in a POSIX shell. */
const DOUBLE_QUOTED_ESCAPABLE = /["$`\\\n]/

/**
 * Splits a shell command line into commands of words, keeping which words an outer shell expands.
 *
 * Called by {@link readDeclaredDevelopmentPort} to read a `dev` script and by {@link splitShellCommandLine}. Commands end at `&&`, `||`, `;`, `&`, `|` and line breaks outside quotes; a quoted string stays one word with its quotes removed, so `concurrently "next dev -p 4000"` keeps `next dev -p 4000` whole. A `&` that belongs to a redirection (`2>&1`, `&>file`) is part of its word. In the `posix` dialect an unquoted `#` at the start of a word begins a comment that runs to the line break, a backslash escapes a following special character outside quotes (`\;`, `\&`, `\|`, `\"`, a space) and `\"`, `\$`, `` \` ``, `\\` inside double quotes, and nothing inside single quotes (F465). In the `cmd` dialect there are no comments and no escapes. An unquoted parenthesis is a word of its own. Nothing is executed or expanded.
 *
 * @param line - A script line from `package.json`, or the text after `cmd /c`.
 * @param dialect - The shell whose rules read the line.
 * @returns One word list per command; empty commands are left out.
 *
 * @example
 * ```ts
 * splitShellWords('sh -c "echo $PORT"', 'posix') // [[{ text: 'sh', … }, { text: '-c', … }, { text: 'echo $PORT', expandedByOuterShell: true }]]
 * ```
 */
export function splitShellWords(
  line: string,
  dialect: ShellDialect = 'posix',
): ShellWord[][] {
  const commands: ShellWord[][] = []
  let words: ShellWord[] = []
  let word: string | undefined
  let expanded = false
  let quote: '"' | "'" | undefined
  const endWord = (): void => {
    if (word !== undefined)
      words.push({ text: word, expandedByOuterShell: expanded })
    word = undefined
    expanded = false
  }
  const endCommand = (): void => {
    endWord()
    if (words.length) commands.push(words)
    words = []
  }
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    const next = line[index + 1]
    // Inside quotes every character is part of the word until the matching quote; a backslash escapes only inside POSIX double quotes.
    if (quote) {
      if (char === quote) quote = undefined
      else if (
        quote === '"' &&
        dialect === 'posix' &&
        char === '\\' &&
        next !== undefined &&
        DOUBLE_QUOTED_ESCAPABLE.test(next)
      ) {
        // An escaped line break joins the lines; any other escaped character is kept literally.
        if (next !== '\n') word += next
        index += 1
      } else {
        if (quote === '"' && char === '$') expanded = true
        word += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      word ??= ''
      continue
    }
    // Outside quotes a POSIX backslash makes the next special character an ordinary one (`\;`), and joins an escaped line break.
    if (
      dialect === 'posix' &&
      char === '\\' &&
      next !== undefined &&
      (next === '\n' || UNQUOTED_ESCAPABLE.test(next))
    ) {
      if (next !== '\n') word = (word ?? '') + next
      index += 1
      continue
    }
    switch (classifyUnquoted(line, index, word !== undefined, dialect)) {
      case 'comment':
        index = lastIndexOfComment(line, index)
        break
      case 'parenthesis':
        endWord()
        words.push({ text: char, expandedByOuterShell: false })
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

/**
 * Splits a shell command line into commands of unquoted words, as {@link splitShellWords} reads it, without the expansion marks.
 *
 * @param line - A script line from `package.json`.
 * @param dialect - The shell whose rules read the line; `posix` by default.
 * @returns One word list per command; empty commands are left out.
 *
 * @example
 * ```ts
 * splitShellCommandLine('node api.js & PORT=4000 next dev') // [['node', 'api.js'], ['PORT=4000', 'next', 'dev']]
 * ```
 */
export function splitShellCommandLine(
  line: string,
  dialect: ShellDialect = 'posix',
): string[][] {
  return splitShellWords(line, dialect).map((command) =>
    command.map((word) => word.text),
  )
}
