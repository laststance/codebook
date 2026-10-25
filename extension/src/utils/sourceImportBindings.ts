import { blankCommentsAndTemplates } from './blankCommentsAndTemplates'

/** A static import declaration that starts a line of code, `import <clause> from '…'` or `import '…'`, across lines; its braces may hold quoted export names, a comma or a brace inside them included. */
const IMPORT_DECLARATION =
  /^[ \t]*import(?:\s+((?:[^'";{}]|\{(?:'[^']*'|"[^"]*"|[^}'"])*\})*?)\s*\bfrom)?\s*(['"])([^'"\n]*)\2/gm

/** A re-export that starts a line of code and loads its module: `export * from '…'`, `export * as name from '…'` or `export { … } from '…'`, `export type` ones included so they can be left out. */
const REEXPORT_DECLARATION =
  /^[ \t]*export\s+(type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{(?:'[^']*'|"[^"]*"|[^}'"])*\})\s*from\s*(['"])([^'"\n]*)\3/gm

/** An import or re-export clause's braces, whose quoted export names may hold a brace. */
const CLAUSE_BRACES = /\{((?:'[^']*'|"[^"]*"|[^}'"])*)\}/

/** One specifier between a clause's braces: the text up to a comma outside quotes. */
const SPECIFIER = /(?:'[^']*'|"[^"]*"|[^,'"])+/g

/** One named specifier: the export (a name or a quoted string) and its local alias, if any. */
const NAMED_SPECIFIER =
  /^(?:([\w$]+)|'([^']*)'|"([^"]*)")(?:\s+as\s+([\w$]+))?$/

/** The modules whose imports Vitest leaves static when it hoists a file's imports for its `vi.mock` calls (`@vitest/mocker`'s hoistMocks). */
const HOISTED_MODULES = ['vitest', 'vite-plus/test']

/** One declaration of the stopped module that loads another module at run time, as Vite and Vitest bind it. */
export type ModuleDeclarationBinding = {
  /** The variable Vite's SSR transform binds the module to: `__vite_ssr_import_<n>__`, numbered over the file's import and re-export declarations in source order. */
  plain: string
  /** The variable when Vitest hoisted the file's imports for its `vi.mock` calls: `__vi_import_<n>__` for an import of any other module, numbered over those imports; `__vite_ssr_import_<n>__` for an import of Vitest itself and for a re-export, numbered over those. */
  hoisted: string
  /** The exports the declaration names by name (`default` for a default import), which its module must have. */
  exports: readonly string[]
}

/** What a stopped module's source says about its imports: each run-time declaration in source order, and each imported local name with the export it reads and its declaration's position. */
export type SourceImports = {
  declarations: readonly ModuleDeclarationBinding[]
  names: ReadonlyMap<string, { exported: string; declaration: number }>
}

/** One run-time declaration found in the source, before it is numbered. */
type FoundDeclaration = {
  index: number
  specifier: string
  isReexport: boolean
  locals: Array<[string, string]>
  exports: string[]
}

/**
 * Reads a stopped module's static import and re-export declarations: which module binding variable Vite or Vitest gives each one, which exports it names, and which export each imported local name reads (the name itself for a named import, the original for an alias, `default` for a default import, `*` for a namespace import). Type-only declarations bind nothing at run time and are left out.
 * Why: Vitest binds each imported module whole, so an imported name has no variable of its own at a test stop, and only the source tells which export of which module binding a local name stands for; another module's export of the same name answered for it before (Cycle 0052 tasks 70, 96). Only real declarations count: an import written in a comment or a string, nested templates included, binds nothing (tasks 87, 88), and a quoted export name keeps its comma (task 89).
 * Called by {@link OwnedNodeTestRun} with the source of each stop, for {@link inspectNodeTestVariables}.
 * @param sourceText - The stopped module's source.
 * @returns The declarations in source order and the imported names.
 * @example
 * sourceImportBindings("import { vi } from 'vitest'\nimport db, { a as b } from './m'")
 * // => { declarations: [{ plain: '__vite_ssr_import_0__', hoisted: '__vite_ssr_import_0__', exports: ['vi'] }, { plain: '__vite_ssr_import_1__', hoisted: '__vi_import_0__', exports: ['default', 'a'] }], names: Map { 'vi' => …, 'db' => { exported: 'default', declaration: 1 }, 'b' => { exported: 'a', declaration: 1 } } }
 */
export function sourceImportBindings(sourceText: string): SourceImports {
  // Comments and template literals become blanks (line breaks kept), and a quoted string never starts a line, so neither can read as a declaration.
  const code = blankCommentsAndTemplates(sourceText)
  const found = [...importDeclarations(code), ...reexportDeclarations(code)]
    .filter((declaration) => declaration !== undefined)
    .sort((left, right) => left.index - right.index)
  const declarations: ModuleDeclarationBinding[] = [],
    names = new Map<string, { exported: string; declaration: number }>()
  let viImports = 0,
    staticImports = 0
  for (const [position, declaration] of found.entries()) {
    // Vitest leaves its own imports and every re-export static; Vite numbers the static ones in source order.
    const staysStatic =
      declaration.isReexport || HOISTED_MODULES.includes(declaration.specifier)
    declarations.push({
      plain: `__vite_ssr_import_${position}__`,
      hoisted: staysStatic
        ? `__vite_ssr_import_${staticImports++}__`
        : `__vi_import_${viImports++}__`,
      exports: declaration.exports,
    })
    for (const [local, exported] of declaration.locals)
      names.set(local, { exported, declaration: position })
  }
  return { declarations, names }
}

/**
 * Finds the run-time import declarations of a blanked source; called by {@link sourceImportBindings}.
 * @returns Each declaration, `undefined` for a type-only one.
 */
function importDeclarations(code: string): Array<FoundDeclaration | undefined> {
  return [...code.matchAll(IMPORT_DECLARATION)].map((match) => {
    const clause = match[1]
    // `import type …` binds nothing at run time; `import '…'` loads its module for its effects.
    if (clause !== undefined && /^type\s/.test(clause)) return undefined
    const locals = clause === undefined ? [] : clauseBindings(clause)
    // A clause of type specifiers only is dropped by the TypeScript compiler.
    if (clause !== undefined && locals.length === 0) return undefined
    return {
      index: match.index,
      specifier: match[3] ?? '',
      isReexport: false,
      locals,
      exports: locals
        .map(([, exported]) => exported)
        .filter((exported) => exported !== '*'),
    }
  })
}

/**
 * Finds the run-time re-export declarations of a blanked source; called by {@link sourceImportBindings}.
 * @returns Each declaration, `undefined` for a type-only one.
 */
function reexportDeclarations(
  code: string,
): Array<FoundDeclaration | undefined> {
  return [...code.matchAll(REEXPORT_DECLARATION)].map((match) => {
    const named = CLAUSE_BRACES.exec(match[2] ?? '')
    const exports = named ? namedBindings(named[1] ?? '') : []
    // `export type …` and a brace list of type specifiers only load nothing at run time.
    if (match[1] !== undefined || (named && exports.length === 0))
      return undefined
    return {
      index: match.index,
      specifier: match[4] ?? '',
      isReexport: true,
      locals: [],
      exports: exports.map(([, exported]) => exported),
    }
  })
}

/**
 * Reads one import clause's bindings: its default import, its namespace import and its named specifiers; called by {@link importDeclarations}.
 * @param clause - The text between `import` and `from`.
 * @returns Each local name with the export it reads.
 * @example clauseBindings('db, { a as b }') // => [['db', 'default'], ['b', 'a']]
 */
function clauseBindings(clause: string): Array<[string, string]> {
  const named = CLAUSE_BRACES.exec(clause)
  const outside = named ? clause.replace(named[0], '') : clause
  const bindings: Array<[string, string]> = []
  const defaultName = /^([\w$]+)/.exec(outside.trim())?.[1]
  if (defaultName) bindings.push([defaultName, 'default'])
  const namespace = /\*\s*as\s+([\w$]+)/.exec(outside)?.[1]
  if (namespace) bindings.push([namespace, '*'])
  return [...bindings, ...namedBindings(named?.[1] ?? '')]
}

/**
 * Reads the named specifiers between a clause's braces; called by {@link clauseBindings} and {@link reexportDeclarations}.
 * @param braces - The text inside the braces.
 * @returns Each local name with the export it reads; an inline `type` specifier binds nothing at run time and is left out.
 * @example namedBindings(" a, b as c, type D, 'e-f' as g ") // => [['a', 'a'], ['c', 'b'], ['g', 'e-f']]
 */
function namedBindings(braces: string): Array<[string, string]> {
  // The braces hold no comments by now ({@link sourceImportBindings} blanked them), so only a comma outside quotes splits specifiers.
  return (braces.match(SPECIFIER) ?? []).flatMap(
    (specifier): Array<[string, string]> => {
      const parts = NAMED_SPECIFIER.exec(specifier.trim())
      const exported = parts?.[1] ?? parts?.[2] ?? parts?.[3]
      return parts && exported !== undefined
        ? [[parts[4] ?? exported, exported]]
        : []
    },
  )
}
