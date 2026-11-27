import { blankCommentsAndTemplates } from './blankCommentsAndTemplates'
import { sourceImportBindings } from './sourceImportBindings'

/** A top-level declaration at the start of a line: an optional `export`/`export default`/`declare`, then `async function`, `function*`, `class`, `const`, `let` or `var`, then its name. */
const TOP_LEVEL_DECLARATION =
  /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm

/**
 * Names the bindings of a module's own top-level scope: its imported names and the names it declares at the start of a line.
 *
 * Why it exists: Bun reports a stopped function's own scopes and the module's scope alike as closures, and the module scope can hold credentials (a database client, `process.env` values); a scope that holds one of these names is the module's, so replay history stops copying there.
 * When it runs: once per Bun stop capture, on the verified source of the stopped file.
 * Called by `VscodeNodeServerDebugger.capture` for {@link ownClosureScopePositionsOf}.
 *
 * @param sourceText - The stopped module's source (TypeScript or JavaScript).
 * @returns The imported local names and the top-level declared names; an empty set when the module has neither.
 * @example
 * moduleBindingNamesOf("import { Elysia } from 'elysia'\nconst app = new Elysia()\nexport function greet() {}")
 * // => Set { 'Elysia', 'app', 'greet' }
 */
export function moduleBindingNamesOf(sourceText: string): ReadonlySet<string> {
  const names = new Set(sourceImportBindings(sourceText).names.keys())
  // Comments and template literals are blanked first, so a declaration written inside one never counts.
  for (const match of blankCommentsAndTemplates(sourceText).matchAll(
    TOP_LEVEL_DECLARATION,
  ))
    names.add(match[1]!)
  return names
}
