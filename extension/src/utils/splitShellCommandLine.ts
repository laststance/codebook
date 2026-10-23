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

/** Collects the words and commands of a line while {@link splitShellWords} scans it. */
class WordCollector {
  readonly commands: ShellWord[][] = []
  private words: ShellWord[] = []
  private word: string | undefined
  private expanded = false

  /** Whether a word is under way, so a `#` after it is no comment. */
  get inWord(): boolean {
    return this.word !== undefined
  }

  /** Adds text to the current word, starting one when none is under way; `expands` marks a `$` the outer shell expands. */
  append(text: string, expands = false): void {
    this.word = (this.word ?? '') + text
    if (expands) this.expanded = true
  }

  /** Starts an empty word, so an empty quoted string (`""`) still is one. */
  startWord(): void {
    this.word ??= ''
  }

  /** Ends the current word, if any. */
  endWord(): void {
    if (this.word !== undefined)
      this.words.push({
        text: this.word,
        expandedByOuterShell: this.expanded,
      })
    this.word = undefined
    this.expanded = false
  }

  /** Ends the current word and adds a word of its own, such as a parenthesis. */
  addSeparateWord(text: string): void {
    this.endWord()
    this.words.push({ text, expandedByOuterShell: false })
  }

  /** Ends the current word and command; empty commands are left out. */
  endCommand(): void {
    this.endWord()
    if (this.words.length) this.commands.push(this.words)
    this.words = []
  }
}

/**
 * Reads a POSIX backslash escape at `index`, for {@link splitShellWords}.
 * @param quote - The quote the scan is inside, if any; none inside single quotes reach here.
 * @returns The literal text the escape stands for (empty for an escaped line break, which joins the lines), or `undefined` when the backslash escapes nothing.
 */
function readEscape(
  line: string,
  index: number,
  quote: '"' | undefined,
): string | undefined {
  const next = line[index + 1]
  if (line[index] !== '\\' || next === undefined) return undefined
  const escapable = quote === '"' ? DOUBLE_QUOTED_ESCAPABLE : UNQUOTED_ESCAPABLE
  if (next !== '\n' && !escapable.test(next)) return undefined
  return next === '\n' ? '' : next
}

/**
 * Reads a backslash escape where the dialect and the quote allow one: POSIX text outside quotes and inside double quotes, never inside single quotes or in `cmd` text (F465).
 * @returns As {@link readEscape}.
 */
function readEscapeIn(
  line: string,
  index: number,
  quote: '"' | "'" | undefined,
  dialect: ShellDialect,
): string | undefined {
  if (dialect !== 'posix' || quote === "'") return undefined
  return readEscape(line, index, quote)
}

/**
 * Applies a character inside quotes to the collector, for {@link splitShellWords}: it is part of the word until the matching quote; a `$` inside double quotes is one the outer shell expands.
 * @returns The quote that is still open.
 */
function stepInQuote(
  char: string,
  quote: '"' | "'",
  collector: WordCollector,
): '"' | "'" | undefined {
  if (char === quote) return undefined
  collector.append(char, quote === '"' && char === '$')
  return quote
}

/**
 * Applies the unquoted character at `index` to the collector, for {@link splitShellWords}.
 * @returns The index of the last character the step consumed (a comment consumes its whole line).
 */
function stepUnquoted(
  line: string,
  index: number,
  dialect: ShellDialect,
  collector: WordCollector,
): number {
  const char = line[index]!
  switch (classifyUnquoted(line, index, collector.inWord, dialect)) {
    case 'comment':
      return lastIndexOfComment(line, index)
    case 'parenthesis':
      collector.addSeparateWord(char)
      break
    case 'command-end':
      collector.endCommand()
      break
    case 'blank':
      collector.endWord()
      break
    default:
      collector.append(char)
  }
  return index
}

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
  const collector = new WordCollector()
  let quote: '"' | "'" | undefined
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    const escaped = readEscapeIn(line, index, quote, dialect)
    if (escaped !== undefined) {
      if (escaped) collector.append(escaped)
      index += 1
    } else if (quote) {
      quote = stepInQuote(char, quote, collector)
    } else if (char === '"' || char === "'") {
      quote = char
      collector.startWord()
    } else {
      index = stepUnquoted(line, index, dialect, collector)
    }
  }
  collector.endCommand()
  return collector.commands
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
