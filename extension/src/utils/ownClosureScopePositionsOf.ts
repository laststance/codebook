/** One DAP scope of the stopped frame as js-debug answers `scopes`. */
type AnsweredClosureScope = {
  name: string
  presentationHint?: string
  variablesReference: number
}

/** A closure scope's function label as js-debug writes it, `Closure (greet)` (localized names keep the parentheses): the name in the trailing parentheses. */
const CLOSURE_FUNCTION_LABEL = /\(([^()]+)\)$/

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
    // The run ends at the first scope that is neither a block nor a closure (Script, Global).
    if (scope.presentationHint === 'arguments') outermost = position
    else if (scope.presentationHint !== 'locals') break
  }
  return outermost
}

/**
 * Names the closure labels that mean "the stopped function's own scope" for a frame name as js-debug shows it; called by {@link ownClosureScopePositionsOf}.
 * @param frameName - The stopped frame's name: `greet`, `Object.GET` (js-debug prefixes a method with its receiver's class), `Server.constructor`, or `<anonymous>`.
 * @returns
 * - the frame name and its last segment, plus the class name for a constructor frame
 * - an empty set for an anonymous frame, whose own closures carry no label
 * @example
 * frameFunctionLabelsOf('Object.GET') // => Set { 'Object.GET', 'GET' }
 * frameFunctionLabelsOf('<anonymous>') // => Set {}
 */
function frameFunctionLabelsOf(frameName: string): ReadonlySet<string> {
  if (frameName === '' || frameName === '<anonymous>') return new Set()
  const segments = frameName.split('.')
  const functionName = segments.at(-1) ?? frameName
  const labels = new Set([frameName, functionName])
  // js-debug names a constructor's frame `Class.constructor`; the constructor's own scopes carry the class's name.
  if (functionName === 'constructor' && segments.length > 1)
    labels.add(segments.at(-2) ?? frameName)
  return labels
}

/**
 * Finds which closure scopes of a Bun stop's stopped frame are the stopped function's own, so replay history may copy them.
 *
 * Why it exists: Bun (JavaScriptCore) reports a function's own scopes as closures, which js-debug hints as `arguments`, where V8 says Local; the replay policy copies only the stopped frame's own values and never the module's or an enclosing function's scope (a factory's arguments, a client it holds), which may hold credentials.
 * When it runs: once per Bun stop capture, for the stopped frame (frame 0) only.
 * Called by {@link captureReplayDebugSnapshot} when its input carries Bun closure facts.
 *
 * Reading order: scopes are innermost first. A block scope (`locals`) is copied by the default policy and passed over. JavaScriptCore labels each closure with the function it belongs to (`Closure (greet)`; an anonymous function's closures carry no label):
 * - a closure labelled with the stopped function's name is its own;
 * - a closure labelled with another name is an enclosing function's, and copying stops there;
 * - an unlabelled closure is an anonymous function's: never a named stopped function's own, and for an anonymous stopped function its own until one holds a module binding name, where the module scope begins (without module names nothing proves it its own).
 * The outermost closure of the run (the one just before Script or Global) is the module's scope, or the wrapper Bun gives a CommonJS module, and is never copied. One case stays open: an anonymous stopped function directly inside another anonymous function (an immediately invoked arrow) has that function's closure copied, as no label tells them apart.
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
export async function ownClosureScopePositionsOf(
  scopes: readonly AnsweredClosureScope[],
  readVariableNames: (variablesReference: number) => Promise<string[]>,
  moduleBindingNames: ReadonlySet<string>,
  frameName: string,
): Promise<Set<number>> {
  const own = new Set<number>()
  const outermostClosure = outermostClosurePositionOf(scopes)
  const frameLabels = frameFunctionLabelsOf(frameName)
  for (const [position, scope] of scopes.entries()) {
    // The outermost closure is the module's own scope: it and everything after it stay out.
    if (position >= outermostClosure) break
    // A block of the function's own code is copied by the default policy; keep looking past it.
    if (scope.presentationHint === 'locals') continue
    // Anything other than a closure (Script, Global) is never the function's own, and nothing after it is either.
    if (scope.presentationHint !== 'arguments') break
    // The first closure that is not the function's own ends the copy: it and every scope after it stay out.
    const isOwn = await isStoppedFunctionClosure(
      scope,
      frameLabels,
      moduleBindingNames,
      readVariableNames,
    )
    if (!isOwn) break
    own.add(position)
  }
  return own
}

/**
 * Judges one closure scope of the stopped frame by its label and, for an anonymous function, by the module's names; called by {@link ownClosureScopePositionsOf} for each closure before the outermost one.
 * @param scope - The closure scope as js-debug answered it.
 * @param frameLabels - The labels that name the stopped function ({@link frameFunctionLabelsOf}); empty for an anonymous function.
 * @param moduleBindingNames - The stopped module's top-level names.
 * @param readVariableNames - Reads the scope's variable names; asked only for an unlabelled closure of an anonymous function.
 * @returns
 * - `true` when the closure is the stopped function's own
 * - `false` when it belongs to an enclosing function or is the module's scope
 * @example
 * await isStoppedFunctionClosure({ name: 'Closure (makeRoutes)', presentationHint: 'arguments', variablesReference: 2 }, new Set(['GET']), new Set(), read) // => false
 */
async function isStoppedFunctionClosure(
  scope: AnsweredClosureScope,
  frameLabels: ReadonlySet<string>,
  moduleBindingNames: ReadonlySet<string>,
  readVariableNames: (variablesReference: number) => Promise<string[]>,
): Promise<boolean> {
  const label = CLOSURE_FUNCTION_LABEL.exec(scope.name)?.[1]
  // A labelled closure belongs to the function it names: the stopped function's own only when that is its name.
  if (label !== undefined) return frameLabels.has(label)
  // A named stopped function's own closures all carry its name, so an unlabelled closure is an enclosing anonymous function's; without module names nothing proves it the anonymous function's own.
  if (frameLabels.size > 0 || moduleBindingNames.size === 0) return false
  const names = await readVariableNames(scope.variablesReference)
  // A closure that holds a module binding is the module scope.
  return !names.some((name) => moduleBindingNames.has(name))
}
