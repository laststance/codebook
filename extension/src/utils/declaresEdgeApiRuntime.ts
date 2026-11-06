import { blankCommentsAndTemplates } from './blankCommentsAndTemplates'

/** An exported `config` object literal's opening brace, with or without a type annotation. */
const EXPORTED_CONFIG_OPENING =
  /(?:^|[;{}])[ \t]*export\s+const\s+config\s*(?::[^=\n]+)?=\s*\{/m

/** A `runtime` key (bare or quoted) at the top level of the literal whose value is a quoted Edge runtime name. */
const EDGE_RUNTIME_PROPERTY =
  /^\s*(['"]?)runtime\1\s*:\s*(['"])(?:experimental-)?edge\2/

/** How many object levels the scan follows below the config literal: its own body and one nested object (`api: { bodyParser: false }`). */
const MAX_CONFIG_DEPTH = 2

/**
 * Tells whether a Pages API route file declares the Edge runtime in an exported `config` object literal, decided from the text alone.
 *
 * Why it exists: Codebook's Node debugger cannot pause an Edge API route, and the source decides it, so such a stop is refused before any process starts (E-4, Cycle 0088). Called by {@link ConfiguredBrowserRun} when it collects API-route stops.
 * The text is read with comments and templates blanked. Only a `runtime` key at the literal's top level counts, after at most one nested object; a runtime set any other way (a constant, a spread, a re-export) is not decided here.
 * @param sourceText - The route file's source.
 * @returns `true` for `export const config = { runtime: 'edge' }` or `'experimental-edge'` (type annotation and one nested object before it allowed); `false` otherwise.
 * @example
 * declaresEdgeApiRuntime("export const config = { api: { bodyParser: false }, runtime: 'edge' }") // => true
 * declaresEdgeApiRuntime("export const config = { runtime: RUNTIME }") // => false
 */
export function declaresEdgeApiRuntime(sourceText: string): boolean {
  const code = blankCommentsAndTemplates(sourceText)
  const opening = EXPORTED_CONFIG_OPENING.exec(code)
  return opening
    ? hasEdgeRuntimeKey(code, opening.index + opening[0].length - 1)
    : false
}

/**
 * Walks an object literal from its opening brace and looks for a top-level `runtime` key with an Edge value.
 * Called by {@link declaresEdgeApiRuntime}.
 * @param code - The route file's code with comments and templates blanked.
 * @param openingBrace - The index of the literal's `{`.
 * @returns `true` when the key is found at depth 1; `false` at the literal's end, at a third nesting level or at the text's end.
 * @example hasEdgeRuntimeKey("{ runtime: 'edge' }", 0) // => true
 */
function hasEdgeRuntimeKey(code: string, openingBrace: number): boolean {
  let depth = 0
  for (let index = openingBrace; index < code.length; index++) {
    if (isQuote(code[index])) {
      // A quoted key right after `{` or `,` is a property start, so it is tested before the quote is skipped as a string.
      if (startsEdgeProperty(code, index, depth)) return true
      // A quoted string is skipped whole, so a brace inside it never moves the depth.
      index = closingQuoteOf(code, index)
      continue
    }
    if (code[index] === '{') depth++
    else if (code[index] === '}') depth--
    // Past the literal's end or too deep to decide from the text.
    if (depth === 0 || depth > MAX_CONFIG_DEPTH) return false
    if (startsEdgeProperty(code, index, depth)) return true
  }
  return false
}

/**
 * Tells whether a character opens a quoted string.
 * Called by {@link hasEdgeRuntimeKey} for each scanned character.
 * @param character - One character of the route's code.
 * @returns `true` for `'` and `"`.
 * @example isQuote("'") // => true
 */
function isQuote(character: string | undefined): boolean {
  return character === "'" || character === '"'
}

/**
 * Tells whether an Edge `runtime` property starts at an index of the literal's top level.
 * Called by {@link hasEdgeRuntimeKey} at each position where a property can begin.
 * @param code - The route file's code with comments and templates blanked.
 * @param index - The index to test.
 * @param depth - The object nesting depth at the index (1 = the literal's own body).
 * @returns `true` when depth is 1, the previous character is `{` or `,`, and `runtime: 'edge'` (bare or quoted key) starts there.
 * @example startsEdgeProperty("{ runtime: 'edge' }", 1, 1) // => true
 */
function startsEdgeProperty(
  code: string,
  index: number,
  depth: number,
): boolean {
  const startsProperty = code[index - 1] === '{' || code[index - 1] === ','
  return (
    depth === 1 &&
    startsProperty &&
    EDGE_RUNTIME_PROPERTY.test(code.slice(index))
  )
}

/**
 * Finds the closing quote of the string literal that opens at an index, so {@link hasEdgeRuntimeKey} can step over it.
 * @param code - The route file's code with comments and templates blanked.
 * @param openingQuote - The index of the literal's `'` or `"`.
 * @returns The index of the matching unescaped quote, or the opening quote's own index when the line ends first (quote strings cannot span lines), or the text's last index.
 * @example closingQuoteOf("{ x: '}' }", 5) // => 7
 */
function closingQuoteOf(code: string, openingQuote: number): number {
  const quote = code[openingQuote]
  for (let index = openingQuote + 1; index < code.length; index++) {
    // An escaped character never ends the literal.
    if (code[index] === '\\') index++
    // A line break ends an unterminated string (e.g. a quote inside a regular-expression literal): the quote is a plain character, so braces after it on the line still count.
    else if (code[index] === '\n') return openingQuote
    else if (code[index] === quote) return index
  }
  return code.length - 1
}
