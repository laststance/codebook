import { DEVELOPMENT_SCRIPT_ALLOWED_CHARACTERS } from '../constants'

/** The shell meanings that make a statement unread although it is in the grammar's syntax. */
export type UnreadReason = 'bun-env' | 'cmd'

/**
 * Says that the `dev` script has a form outside the grammar the reader asserts a port for (D72); thrown by {@link tokenizeDevelopmentScript} and the readers of {@link readDeclaredDevelopmentPort}, caught only there.
 *
 * @param words - The words of the statement that left the grammar, as the tokenizer saw them; empty when the thrower does not know the statement yet (the statement reader fills it in).
 * @param reason - Why the statement is unread when the cause is a shell's meaning and not its syntax: `bun-env` when Bun loads `.env` files into the script's environment, where a `PORT` can decide the port of a `next dev` without a port flag (F499), `cmd` when the form means something else under the Windows shell (F502).
 */
export class UnreadScriptError extends Error {
  constructor(
    readonly words: readonly string[] = [],
    readonly reason?: UnreadReason,
  ) {
    super('The dev script has a form outside the grammar.')
  }
}

/**
 * Splits a `dev` script line into statements of words for the grammar of {@link readDeclaredDevelopmentPort}: statements end at `&&` or `;`, words end at blanks, and a quoted part joins its word with the quotes removed.
 *
 * Called by {@link readDeclaredDevelopmentPort} for the `dev` script, for each script it delegates to and for each quoted command of `concurrently`. The grammar is an allow-list (D72): the line may hold only {@link DEVELOPMENT_SCRIPT_ALLOWED_CHARACTERS}, a `&` must be half of `&&`, and an empty statement is refused, so no shell syntax outside the grammar (pipes, groups, expansions, redirections, comments, escapes, line breaks) is ever interpreted. Nothing is executed or expanded.
 *
 * @param line - A script line from `package.json`, or a quoted command of `concurrently`.
 * @param windows - Whether `cmd` runs the line: a single quote and `;` are then outside the grammar, as they do not mean what they mean in `sh` (F502, D74).
 * @returns One word list per statement, in order.
 * @throws {@link UnreadScriptError} When the line holds a character or a separator outside the grammar, an unterminated quote or an empty statement.
 *
 * @example
 * ```ts
 * tokenizeDevelopmentScript('export PORT=4000 && next dev') // [['export', 'PORT=4000'], ['next', 'dev']]
 * ```
 */
export function tokenizeDevelopmentScript(
  line: string,
  windows = false,
): string[][] {
  if (!DEVELOPMENT_SCRIPT_ALLOWED_CHARACTERS.test(line))
    throw new UnreadScriptError(line.split(/\s+/).filter(Boolean))
  const scan = new ScriptScan(windows)
  for (let index = 0; index < line.length; index += 1)
    index = scan.step(line, index)
  return scan.finish()
}

/** Starts a word that had a quote before its `=`; it is in no character list of the grammar, so the word matches no assignment (F501). */
const QUOTED_ASSIGNMENT_MARK = '\u0000'

/** The state of one scan of {@link tokenizeDevelopmentScript}: the finished statements, the words of the open statement, the open word and the open quote. */
class ScriptScan {
  private readonly statements: string[][] = []
  private words: string[] = []
  private word: string | undefined
  private quote: string | undefined
  /** Whether the open word had a quote before its first `=`: `"PORT"=4000` and `"PORT=4000"` are commands for `sh`, no assignment (F501). */
  private quotedBeforeEquals = false
  /** The separator that ended the last statement. */
  private separator: ';' | '&&' | undefined

  constructor(private readonly windows: boolean) {}

  /** Applies the character at `index` and returns the index of the last character it consumed. */
  step(line: string, index: number): number {
    const char = line[index]!
    if (this.quote) {
      // Inside quotes every allowed character is part of the word until the matching quote.
      if (char === this.quote) this.quote = undefined
      else this.word = (this.word ?? '') + char
    } else if (char === '"' || char === "'") {
      // Under `cmd` a single quote is a literal character, not a quote.
      if (char === "'" && this.windows) this.cmdUnread()
      if (!this.word?.includes('=')) this.quotedBeforeEquals = true
      this.quote = char
      this.word ??= ''
    } else if (char === ' ' || char === '\t') {
      this.endWord()
    } else if (char === ';') {
      // Under `cmd` a `;` is no separator.
      if (this.windows) this.cmdUnread()
      this.endStatement(';')
    } else if (char === '&') {
      // A `&` alone backgrounds a command: not in the grammar.
      if (line[index + 1] !== '&') this.unread()
      this.endStatement('&&')
      return index + 1
    } else {
      this.word = (this.word ?? '') + char
    }
    return index
  }

  /** Ends the scan: no quote may stay open and the last statement may not be empty. */
  finish(): string[][] {
    if (this.quote) this.unread()
    this.endWord()
    // One trailing `;` ends the last statement, as in `sh` (F503); any other empty statement is refused.
    if (
      !this.words.length &&
      this.separator === ';' &&
      this.statements.length > 0
    )
      return this.statements
    this.endStatement()
    return this.statements
  }

  private endWord(): void {
    if (this.word !== undefined) {
      // A blank-free word with a quote before its `=` is marked, so no later reader takes it for an assignment (F501); a quoted command of `concurrently` holds blanks and stays whole.
      const marked =
        this.quotedBeforeEquals &&
        this.word.includes('=') &&
        !this.word.startsWith('-') &&
        !/\s/.test(this.word)
      this.words.push(
        marked ? `${QUOTED_ASSIGNMENT_MARK}${this.word}` : this.word,
      )
    }
    this.word = undefined
    this.quotedBeforeEquals = false
  }

  private endStatement(separator?: ';' | '&&'): void {
    this.endWord()
    // An empty statement is quoted by the statement before it, never as an empty text.
    if (!this.words.length) this.unread(this.statements.at(-1))
    this.statements.push(this.words)
    this.words = []
    this.separator = separator
  }

  private cmdUnread(): never {
    throw new UnreadScriptError(
      this.word === undefined ? this.words : [...this.words, this.word],
      'cmd',
    )
  }

  private unread(previous?: readonly string[]): never {
    throw new UnreadScriptError(
      this.word === undefined
        ? this.words.length
          ? this.words
          : (previous ?? [])
        : [...this.words, this.word],
    )
  }
}
