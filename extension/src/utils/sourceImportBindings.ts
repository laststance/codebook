/** A static import declaration that starts a line of code: its clause, between `import` and `from '…'`, across lines; its braces may hold quoted export names. */
const IMPORT_CLAUSE =
  /^[ \t]*import\s+((?:[^'";{}]|\{[^}]*\})*?)\s*\bfrom\s*['"][^'"\n]*['"]/gm

/** The spans of a module source that are no code: line and block comments and template literals; quoted strings are matched too, so a comment marker inside one is left alone. */
const NON_CODE =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g

/** One named import specifier: the export (a name or a quoted string) and its local alias, if any. */
const NAMED_SPECIFIER =
  /^(?:([\w$]+)|'([^']*)'|"([^"]*)")(?:\s+as\s+([\w$]+))?$/

/**
 * Lists the names a module's source binds by its static import declarations, each with the export it reads: the name itself for a named import (`import { a }`), the original for an alias (`import { a as b }`: `b` reads `a`), `default` for a default import and `*` for a namespace import. Type-only imports bind nothing at run time and are left out.
 * Why: Vitest binds each imported module whole, so an imported name has no variable of its own at a test stop, and only the source tells which export a local name stands for; reading the export named like the local name took another module's export for an alias (pt3 /ship Step 11, Cycle 0052 task 70). Only real declarations count: an import written in a comment or a string binds nothing (task 87).
 * Called by {@link OwnedNodeTestRun} with the source of each stop, for {@link inspectNodeTestVariables}.
 * @param sourceText - The stopped module's source.
 * @returns Each local name the source imports, with the export it reads.
 * @example
 * sourceImportBindings("import db, { a as b, type C } from './m'\nimport * as ns from 'n'")
 * // => Map { 'db' => 'default', 'b' => 'a', 'ns' => '*' }
 */
export function sourceImportBindings(
  sourceText: string,
): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>()
  // Comments and template literals become blanks (line breaks kept), and a quoted string never starts a line, so neither can read as a declaration.
  const code = sourceText.replace(NON_CODE, (span) =>
    span.startsWith("'") || span.startsWith('"')
      ? span
      : span.replace(/[^\n]/g, ' '),
  )
  for (const [, clause = ''] of code.matchAll(IMPORT_CLAUSE)) {
    // `import type …` binds nothing at run time.
    if (/^type\s/.test(clause)) continue
    for (const [local, exported] of clauseBindings(clause))
      bindings.set(local, exported)
  }
  return bindings
}

/**
 * Reads one import clause's bindings: its default import, its namespace import and its named specifiers; called by {@link sourceImportBindings}.
 * @param clause - The text between `import` and `from`.
 * @returns Each local name with the export it reads.
 * @example clauseBindings('db, { a as b }') // => [['db', 'default'], ['b', 'a']]
 */
function clauseBindings(clause: string): Array<[string, string]> {
  const named = /\{([^}]*)\}/.exec(clause)
  const outside = named ? clause.replace(named[0], '') : clause
  const bindings: Array<[string, string]> = []
  const defaultName = /^([\w$]+)/.exec(outside.trim())?.[1]
  if (defaultName) bindings.push([defaultName, 'default'])
  const namespace = /\*\s*as\s+([\w$]+)/.exec(outside)?.[1]
  if (namespace) bindings.push([namespace, '*'])
  return [...bindings, ...namedBindings(named?.[1] ?? '')]
}

/**
 * Reads the named specifiers between an import clause's braces; called by {@link clauseBindings}.
 * @param braces - The text inside the braces.
 * @returns Each local name with the export it reads; an inline `type` specifier binds nothing at run time and is left out.
 * @example namedBindings(" a, b as c, type D, 'e-f' as g ") // => [['a', 'a'], ['c', 'b'], ['g', 'e-f']]
 */
function namedBindings(braces: string): Array<[string, string]> {
  // The braces hold no comments by now ({@link sourceImportBindings} blanked them), so a comma splits specifiers only.
  return braces.split(',').flatMap((specifier): Array<[string, string]> => {
    const parts = NAMED_SPECIFIER.exec(specifier.trim())
    const exported = parts?.[1] ?? parts?.[2] ?? parts?.[3]
    return parts && exported !== undefined
      ? [[parts[4] ?? exported, exported]]
      : []
  })
}
