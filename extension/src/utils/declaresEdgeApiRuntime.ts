import { blankCommentsAndTemplates } from './blankCommentsAndTemplates'

/** An exported `config` object literal's opening brace, with or without a type annotation. */
const EXPORTED_CONFIG_OPENING =
  /(?:^|[;{}])[ \t]*export\s+const\s+config\s*(?::[^=\n]+)?=\s*\{/m

/** A `runtime` key at the top level of the literal whose value is a quoted Edge runtime name. */
const EDGE_RUNTIME_PROPERTY = /^\s*runtime\s*:\s*(['"])(?:experimental-)?edge\1/

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
    if (code[index] === '{') depth++
    else if (code[index] === '}') depth--
    // Past the literal's end or too deep to decide from the text.
    if (depth === 0 || depth > MAX_CONFIG_DEPTH) return false
    const startsProperty = code[index - 1] === '{' || code[index - 1] === ','
    if (
      depth === 1 &&
      startsProperty &&
      EDGE_RUNTIME_PROPERTY.test(code.slice(index))
    )
      return true
  }
  return false
}
