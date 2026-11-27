import { blankCommentsAndTemplates } from './blankCommentsAndTemplates'
import { blankStringContents } from './blankStringContents'
import { sourceImportBindings } from './sourceImportBindings'

/** A declaration at the start of a line: an optional `export`/`export default`/`declare`, then `async function`, `function*`, `class`, `const`, `let` or `var`, then its name; {@link moduleBindingNamesOf} keeps only those outside every brace. */
const TOP_LEVEL_DECLARATION =
  /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm

/**
 * Names the bindings of a module's own top-level scope: its imported names and the names it declares at the start of a line outside every brace.
 *
 * Why it exists: Bun reports a stopped function's own scopes and the module's scope alike as closures, and the module scope can hold credentials (a database client, `process.env` values); a scope that holds one of these names is the module's, so replay history stops copying there.
 * When it runs: once per Bun stop capture, on the verified source of the stopped file.
 * Called by `VscodeNodeServerDebugger.capture` for {@link ownClosureScopePositionsOf}.
 *
 * A line-start declaration inside a function body or block (JavaScript needs no indentation) is not the module's, so braces are counted; comments, template literals and string contents are blanked first, so neither a declaration nor a brace written inside one counts. A brace inside a regular expression literal is not recognised.
 *
 * @param sourceText - The stopped module's source (TypeScript or JavaScript).
 * @returns The imported local names and the top-level declared names; an empty set when the module has neither.
 * @example
 * moduleBindingNamesOf("import { Elysia } from 'elysia'\nconst app = new Elysia()\nexport function greet() {\nconst inner = 1\n}")
 * // => Set { 'Elysia', 'app', 'greet' }
 */
export function moduleBindingNamesOf(sourceText: string): ReadonlySet<string> {
  const names = new Set(sourceImportBindings(sourceText).names.keys())
  const code = blankStringContents(blankCommentsAndTemplates(sourceText))
  let depth = 0
  let scanned = 0
  for (const match of code.matchAll(TOP_LEVEL_DECLARATION)) {
    // The braces between the previous declaration and this one set its depth; only a declaration at depth 0 is the module's.
    for (; scanned < match.index; scanned += 1) {
      if (code[scanned] === '{') depth += 1
      else if (code[scanned] === '}') depth = Math.max(0, depth - 1)
    }
    if (depth === 0) names.add(match[1]!)
  }
  return names
}
