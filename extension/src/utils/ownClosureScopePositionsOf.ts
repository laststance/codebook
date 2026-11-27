/** One DAP scope of the stopped frame as js-debug answers `scopes`. */
type AnsweredClosureScope = {
  name: string
  presentationHint?: string
  variablesReference: number
}

/**
 * Finds which closure scopes of a Bun stop's stopped frame are the stopped function's own, so replay history may copy them.
 *
 * Why it exists: Bun (JavaScriptCore) reports a function's own scopes as closures, which js-debug hints as `arguments`, where V8 says Local; the replay policy copies only the stopped frame's own values and never the module's or an outer scope that may hold credentials.
 * When it runs: once per Bun stop capture, for the stopped frame (frame 0) only.
 * Called by {@link captureReplayDebugSnapshot} when its input carries Bun closure facts.
 *
 * Reading order: scopes are innermost first. A block scope (`locals`) is copied by the default policy and passed over; each closure scope is the function's own until one holds a module binding name, where the module scope (and every scope after it) begins. The outermost closure of the run (the one just before Script or Global) is the module's scope, or the wrapper Bun gives a CommonJS module, and is never copied, even when the source scan names none of its bindings. When the module names nothing at its top level, only a closure named after the stopped frame's function (`Closure (greet)`) counts as its own.
 *
 * @param scopes - The stopped frame's scopes, innermost first.
 * @param readVariableNames - Reads a scope's variable names (one `variables` request).
 * @param moduleBindingNames - The stopped module's top-level names (`moduleBindingNamesOf`).
 * @param frameName - The stopped frame's function name as js-debug shows it.
 * @returns The positions of the scopes to copy; an empty set when none is the function's own.
 * @example
 * await ownClosureScopePositionsOf(
 *   [{ name: 'Closure', presentationHint: 'arguments', variablesReference: 7 }, { name: 'Closure', presentationHint: 'arguments', variablesReference: 8 }, { name: 'Script', variablesReference: 9 }],
 *   async (reference) => (reference === 7 ? ['name'] : ['app', 'greet']),
 *   new Set(['app', 'greet']),
 *   '<anonymous>',
 * ) // => Set { 0 }
 */
/**
 * Finds the outermost closure of the stopped frame's leading run of block and closure scopes; called by {@link ownClosureScopePositionsOf}, which never copies it.
 * @param scopes - The stopped frame's scopes, innermost first.
 * @returns
 * - the position of the last closure (`arguments`) before the first scope that is neither a block nor a closure
 * - `-1` when the run holds no closure, so nothing is copied
 * @example
 * outermostClosurePositionOf([{ presentationHint: 'locals' }, { presentationHint: 'arguments' }, { presentationHint: 'arguments' }, {}]) // => 2
 * outermostClosurePositionOf([{ presentationHint: 'locals' }, {}]) // => -1
 */
function outermostClosurePositionOf(
  scopes: readonly Pick<AnsweredClosureScope, 'presentationHint'>[],
): number {
  let outermost = -1
  for (const [position, scope] of scopes.entries()) {
    // The run ends at the first scope that is neither a block nor a closure (Script, Global, With).
    if (scope.presentationHint === 'arguments') outermost = position
    else if (scope.presentationHint !== 'locals') break
  }
  return outermost
}

export async function ownClosureScopePositionsOf(
  scopes: readonly AnsweredClosureScope[],
  readVariableNames: (variablesReference: number) => Promise<string[]>,
  moduleBindingNames: ReadonlySet<string>,
  frameName: string,
): Promise<Set<number>> {
  const own = new Set<number>()
  const outermostClosure = outermostClosurePositionOf(scopes)
  for (const [position, scope] of scopes.entries()) {
    // The outermost closure is the module's own scope: it and everything after it stay out.
    if (position >= outermostClosure) break
    // A block of the function's own code is copied by the default policy; keep looking past it.
    if (scope.presentationHint === 'locals') continue
    // Anything other than a closure (Script, Global, With) is never the function's own, and nothing after it is either.
    if (scope.presentationHint !== 'arguments') break
    // Without module names, only a closure that carries the stopped function's own name is known to be its own.
    if (moduleBindingNames.size === 0) {
      if (!scope.name.endsWith(`(${frameName})`)) break
      own.add(position)
      continue
    }
    const names = await readVariableNames(scope.variablesReference)
    // The first closure that holds a module binding is the module scope: it and everything after it stay out.
    if (names.some((name) => moduleBindingNames.has(name))) break
    own.add(position)
  }
  return own
}
