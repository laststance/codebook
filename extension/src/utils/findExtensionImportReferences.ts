import { blankCommentsAndTemplates } from './blankCommentsAndTemplates'
import { blankStringContents } from './blankStringContents'

/** The load forms static discovery does not follow, named in the refusal sentence (SR40). */
export type UnfollowedLoadForm =
  | 'dynamic import'
  | 'computed path'
  | 'import.meta.url'
  | 'import map'
  | 'bare specifier'

/** How a script file loads others: a module through `import`/`export … from`, a classic worker through `importScripts`. */
export type ScriptLoadMode = 'module' | 'classic'

/** The references of one script file and the load forms it uses that are not followed. */
export interface ImportReferences {
  references: readonly string[]
  unfollowed: readonly UnfollowedLoadForm[]
}

/** The names between `import` and `from`: any non-quote characters, or a brace group that may hold quoted names; bounded, and its two alternatives never start with the same character, so matching cannot backtrack quadratically. */
const IMPORT_BINDINGS =
  '(?:[^\'"`;(){}]|\\{[^{}`;()]{0,2000}\\}){0,2000}?\\bfrom\\s*'
const STATIC_IMPORT = new RegExp(
  `\\bimport\\s*(?:${IMPORT_BINDINGS})?(['"])(_*)\\1`,
  'dg',
)
const EXPORT_FROM =
  /\bexport\s*(?:\*(?:\s+as\s+[^\s'",;(){}]+)?|\{[^{}]{0,2000}\})\s*from\s*(['"])(_*)\1/dg
const DYNAMIC_IMPORT = /\bimport\s*\(/
const IMPORT_META_URL = /\bimport\.meta\.url\b/
const IMPORT_SCRIPTS_CALL = /\bimportScripts\s*\(([^)]*)\)/dg
/** A string literal whose contents were blanked by {@link blankStringContents}. */
const BLANKED_LITERAL = /^(['"])_*\1$/
/** A module specifier that starts with `./`, `../`, `/` or a url scheme; anything else is a bare package specifier. */
const NON_BARE_SPECIFIER = /^(?:\.{1,2}\/|\/|[a-zA-Z][a-zA-Z0-9+.-]*:)/

/**
 * Collects the specifier of every match of a static import or export-from pattern, reading its text from the original source by position.
 * @param code - The source with comments, templates and string contents blanked.
 * @param original - The source as written (same positions).
 */
function moduleSpecifiers(code: string, original: string): string[] {
  return [...code.matchAll(STATIC_IMPORT), ...code.matchAll(EXPORT_FROM)]
    .map((match) => match.indices?.[2])
    .filter((span) => span !== undefined)
    .map(([from, to]) => original.slice(from, to))
}

/**
 * Reads the literal arguments of every `importScripts(...)` call; an argument that is not a plain quoted string is a computed path.
 * The argument structure is read from the blanked code (so a comment or a comma inside a literal splits nothing); each literal's text is taken from the original by the same positions.
 * @param code - The source with comments, templates and string contents blanked.
 * @param original - The source as written (same positions).
 */
function importScriptsArguments(
  code: string,
  original: string,
): { literals: string[]; hasComputed: boolean } {
  const literals: string[] = []
  let hasComputed = false
  for (const call of code.matchAll(IMPORT_SCRIPTS_CALL)) {
    const span = call.indices?.[1]
    if (span === undefined) continue
    const [argumentsStart] = span
    let segmentStart = argumentsStart
    for (const segment of (call[1] ?? '').split(',')) {
      const segmentEnd = segmentStart + segment.length
      const trimmed = segment.trim()
      if (trimmed === '') {
        // Blank in the code: an empty argument or a comment is nothing, a template literal is a computed path.
        if (original.slice(segmentStart, segmentEnd).includes('`'))
          hasComputed = true
      } else if (BLANKED_LITERAL.test(trimmed)) {
        const offset = segmentStart + segment.indexOf(trimmed)
        literals.push(original.slice(offset + 1, offset + trimmed.length - 1))
      } else hasComputed = true
      // The comma that split the segments takes one character.
      segmentStart = segmentEnd + 1
    }
  }
  return { literals, hasComputed }
}

/**
 * Finds the script files a JavaScript source loads statically and the load forms it uses that discovery cannot follow (ER3, SR40).
 * Called by {@link discoverStaticLoads} for every reachable script; comments, template literals and the insides of string literals are ignored.
 * @param source - The script's text.
 * @param mode - `module`: static `import` and `export … from`; `classic`: literal `importScripts(...)` arguments.
 * @returns The literal specifiers in source order and the unfollowed forms found (dynamic import, `import.meta.url`, computed `importScripts` arguments, bare specifiers).
 * @example
 * findExtensionImportReferences("import './a.js'\nimport('./b.js')", 'module')
 * // => { references: ['./a.js'], unfollowed: ['dynamic import'] }
 */
export function findExtensionImportReferences(
  source: string,
  mode: ScriptLoadMode,
): ImportReferences {
  const code = blankStringContents(blankCommentsAndTemplates(source))
  const unfollowed: UnfollowedLoadForm[] = []
  if (DYNAMIC_IMPORT.test(code)) unfollowed.push('dynamic import')
  if (IMPORT_META_URL.test(code)) unfollowed.push('import.meta.url')
  // A classic worker follows importScripts literals only.
  if (mode === 'classic') {
    const { literals, hasComputed } = importScriptsArguments(code, source)
    if (hasComputed) unfollowed.push('computed path')
    return { references: literals, unfollowed }
  }
  const references: string[] = []
  for (const specifier of moduleSpecifiers(code, source)) {
    if (NON_BARE_SPECIFIER.test(specifier)) references.push(specifier)
    else if (!unfollowed.includes('bare specifier'))
      unfollowed.push('bare specifier')
  }
  return { references, unfollowed }
}
