import { blankCommentsAndTemplates } from './blankCommentsAndTemplates'

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

const STATIC_IMPORT =
  /\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?(['"])([^'"\n]+)\1/g
const EXPORT_FROM =
  /\bexport\s*(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\1/g
const DYNAMIC_IMPORT = /\bimport\s*\(/
const IMPORT_META_URL = /\bimport\.meta\.url\b/
const IMPORT_SCRIPTS_CALL = /\bimportScripts\s*\(([^)]*)\)/g
const QUOTED_LITERAL = /^(['"])([^'"]*)\1$/
/** A module specifier that starts with `./`, `../`, `/` or a url scheme; anything else is a bare package specifier. */
const NON_BARE_SPECIFIER = /^(?:\.{1,2}\/|\/|[a-zA-Z][a-zA-Z0-9+.-]*:)/

/** Collects the specifier of every match of a static import or export-from pattern. */
function moduleSpecifiers(code: string): string[] {
  return [...code.matchAll(STATIC_IMPORT), ...code.matchAll(EXPORT_FROM)].map(
    (match) => match[2] ?? '',
  )
}

/**
 * Reads the literal arguments of every `importScripts(...)` call; an argument that is not a plain quoted string is a computed path.
 * @param code - The source with comments and templates blanked (same positions as `original`).
 * @param original - The source as written, from which the arguments are read so a template literal is not mistaken for an empty argument.
 */
function importScriptsArguments(
  code: string,
  original: string,
): { literals: string[]; hasComputed: boolean } {
  const literals: string[] = []
  let hasComputed = false
  for (const call of code.matchAll(IMPORT_SCRIPTS_CALL)) {
    const argumentText = original.slice(
      call.index + call[0].indexOf('(') + 1,
      call.index + call[0].length - 1,
    )
    for (const argument of argumentText.split(',')) {
      const trimmed = argument.trim()
      if (trimmed === '') continue
      const literal = QUOTED_LITERAL.exec(trimmed)
      if (literal) literals.push(literal[2] ?? '')
      else hasComputed = true
    }
  }
  return { literals, hasComputed }
}

/**
 * Finds the script files a JavaScript source loads statically and the load forms it uses that discovery cannot follow (ER3, SR40).
 * Called by {@link discoverStaticLoads} for every reachable script; comments and template literals are ignored.
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
  const code = blankCommentsAndTemplates(source)
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
  for (const specifier of moduleSpecifiers(code)) {
    if (NON_BARE_SPECIFIER.test(specifier)) references.push(specifier)
    else if (!unfollowed.includes('bare specifier'))
      unfollowed.push('bare specifier')
  }
  return { references, unfollowed }
}
