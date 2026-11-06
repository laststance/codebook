/**
 * One `NAME=value` entry the way dotenv 16 reads it (the `.env` parser of `@expo/env`): an optional `export` prefix, `=` or `:` as the separator, a quoted value that may span lines, and an unquoted value that ends at an inline `#` comment.
 * Ported from dotenv 16's `LINE` pattern so the values Codebook masks are the values Expo inlines.
 */
const DOTENV_16_LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm

/**
 * Parses one `.env` text with the rules of dotenv 16, which Expo (`@expo/env`) uses before dotenv-expand: `export` prefixes, inline comments, single, double and backtick quotes (multi-line included), and `\n` and `\r` expanded inside double quotes only.
 *
 * Why it exists: react-scripts reads `.env` with dotenv 10, whose rules differ, so a value Expo loads (`export EXPO_PUBLIC_KEY=abc`, `A=abc # note`, a quoted multi-line value) could escape the mask list if it were parsed the react-scripts way. Called by {@link loadEnvFiles} for the Expo adapter.
 * @param text - The file text.
 * @returns The names and values the file sets; a later definition of a name wins, as in dotenv.
 * @example parseExpoEnvText('export A=abc # note\nB="x\\ny"') // => Map { 'A' => 'abc', 'B' => 'x\ny' }
 */
export function parseExpoEnvText(text: string): Map<string, string> {
  const values = new Map<string, string>()
  // dotenv normalizes every line ending to "\n" before matching.
  const source = text.replace(/\r\n?/gm, '\n')
  // The pattern is global and stateful, so each parse gets its own copy.
  const line = new RegExp(DOTENV_16_LINE.source, DOTENV_16_LINE.flags)
  for (
    let match = line.exec(source);
    match !== null;
    match = line.exec(source)
  ) {
    let value = (match[2] ?? '').trim()
    const maybeQuote = value[0]
    // Matching quotes around the whole value are removed, whatever the quote.
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, '$2')
    // Only double quotes expand escaped line breaks.
    if (maybeQuote === '"')
      value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
    values.set(match[1]!, value)
  }
  return values
}
