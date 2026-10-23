import { DEVELOPMENT_SCRIPT_ALLOWED_CHARACTERS } from '../constants'

/**
 * Says that the `dev` script has a form outside the grammar the reader asserts a port for (D72); thrown by {@link tokenizeDevelopmentScript} and the readers of {@link readDeclaredDevelopmentPort}, caught only there.
 *
 * @param words - The words of the statement that left the grammar, as the tokenizer saw them; empty when the thrower does not know the statement yet (the statement reader fills it in).
 */
export class UnreadScriptError extends Error {
  constructor(readonly words: readonly string[] = []) {
    super('The dev script has a form outside the grammar.')
  }
}

/**
 * Splits a `dev` script line into statements of words for the grammar of {@link readDeclaredDevelopmentPort}: statements end at `&&` or `;`, words end at blanks, and a quoted part joins its word with the quotes removed.
 *
 * Called by {@link readDeclaredDevelopmentPort} for the `dev` script, for each script it delegates to and for each quoted command of `concurrently`. The grammar is an allow-list (D72): the line may hold only {@link DEVELOPMENT_SCRIPT_ALLOWED_CHARACTERS}, a `&` must be half of `&&`, and an empty statement is refused, so no shell syntax outside the grammar (pipes, groups, expansions, redirections, comments, escapes, line breaks) is ever interpreted. Nothing is executed or expanded.
 *
 * @param line - A script line from `package.json`, or a quoted command of `concurrently`.
 * @returns One word list per statement, in order.
 * @throws {@link UnreadScriptError} When the line holds a character or a separator outside the grammar, an unterminated quote or an empty statement.
 *
 * @example
 * ```ts
 * tokenizeDevelopmentScript('export PORT=4000 && next dev') // [['export', 'PORT=4000'], ['next', 'dev']]
 * ```
 */
export function tokenizeDevelopmentScript(line: string): string[][] {
  if (!DEVELOPMENT_SCRIPT_ALLOWED_CHARACTERS.test(line))
    throw new UnreadScriptError(line.split(/\s+/).filter(Boolean))
  const scan = new ScriptScan()
  for (let index = 0; index < line.length; index += 1)
    index = scan.step(line, index)
  return scan.finish()
}

/** The state of one scan of {@link tokenizeDevelopmentScript}: the finished statements, the words of the open statement, the open word and the open quote. */
class ScriptScan {
  private readonly statements: string[][] = []
  private words: string[] = []
  private word: string | undefined
  private quote: string | undefined

  /** Applies the character at `index` and returns the index of the last character it consumed. */
  step(line: string, index: number): number {
    const char = line[index]!
    if (this.quote) {
      // Inside quotes every allowed character is part of the word until the matching quote.
      if (char === this.quote) this.quote = undefined
      else this.word = (this.word ?? '') + char
    } else if (char === '"' || char === "'") {
      this.quote = char
      this.word ??= ''
    } else if (char === ' ' || char === '\t') {
      this.endWord()
    } else if (char === ';') {
      this.endStatement()
    } else if (char === '&') {
      // A `&` alone backgrounds a command: not in the grammar.
      if (line[index + 1] !== '&') this.unread()
      this.endStatement()
      return index + 1
    } else {
      this.word = (this.word ?? '') + char
    }
    return index
  }

  /** Ends the scan: no quote may stay open and the last statement may not be empty. */
  finish(): string[][] {
    if (this.quote) this.unread()
    this.endStatement()
    return this.statements
  }

  private endWord(): void {
    if (this.word !== undefined) this.words.push(this.word)
    this.word = undefined
  }

  private endStatement(): void {
    this.endWord()
    if (!this.words.length) this.unread()
    this.statements.push(this.words)
    this.words = []
  }

  private unread(): never {
    throw new UnreadScriptError(
      this.word === undefined ? this.words : [...this.words, this.word],
    )
  }
}
