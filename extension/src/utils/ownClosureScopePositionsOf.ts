/** One DAP scope of the stopped frame as js-debug answers `scopes`. */
type AnsweredClosureScope = {
  name: string
  presentationHint?: string
  variablesReference: number
}

/** A closure scope's function label as js-debug writes it, `Closure (greet)` (localized names keep the parentheses): the name in the trailing parentheses. */
const CLOSURE_FUNCTION_LABEL = /\(([^()]+)\)$/

/** Variable names every function's own scope may hold without holding another function's value. */
const NAMES_OF_NO_OTHER_FUNCTION: ReadonlySet<string> = new Set([
  'this',
  'arguments',
])

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
 * Reading order: scopes are innermost first. A block scope (`locals`) is copied by the default policy and passed over. The policy is positive evidence and fails closed:
 * - a closure labelled with another function's name ends the copy (labels are only a first filter);
 * - a closure is copied only when every name it holds, except `this` and `arguments`, is declared in the stopped function's own source (`declaredNames`); this holds for a closure labelled with the frame's own name too, so a same-named enclosing function's closure stays out;
 * - a closure that holds no other name (empty, or only `this`/`arguments`) carries no other function's value: it is passed over (not copied) and the copy goes on;
 * - the first closure holding an undeclared name ends the copy: it and everything after it stay out, and nothing after it is read.
 * The outermost closure of the run (the one just before Script or Global) is the module's scope, or the wrapper Bun gives a CommonJS module, and is never copied or read. Without declared names (no source, no stop position, no function found) nothing is copied.
 *
 * @param scopes - The stopped frame's scopes, innermost first.
 * @param readVariableNames - Reads a scope's variable names (one bounded `variables` request); rejects when the read fails.
 * @param declaredNames - The names the stopped function declares ({@link stoppedFunctionDeclaredNamesOf}); `undefined` when unknown.
 * @param frameName - The stopped frame's function name as js-debug shows it.
 * @param maxNamesPerScope - The most names one scope may hold to be classified; a scope with more is not the function's own.
 * @returns The positions of the scopes to copy; an empty set when none is the function's own.
 * @example
 * await ownClosureScopePositionsOf(
 *   [{ name: 'Closure', presentationHint: 'arguments', variablesReference: 7 }, { name: 'Closure', presentationHint: 'arguments', variablesReference: 8 }, { name: 'Script', variablesReference: 9 }],
 *   async (reference) => (reference === 7 ? ['name'] : ['app', 'greet']),
 *   new Set(['name']),
 *   '<anonymous>',
 *   100,
 * ) // => Set { 0 }
 */
export async function ownClosureScopePositionsOf(
  scopes: readonly AnsweredClosureScope[],
  readVariableNames: (variablesReference: number) => Promise<string[]>,
  declaredNames: ReadonlySet<string> | undefined,
  frameName: string,
  maxNamesPerScope: number,
): Promise<Set<number>> {
  const own = new Set<number>()
  if (!declaredNames) return own
  const outermostClosure = outermostClosurePositionOf(scopes)
  const frameLabels = frameFunctionLabelsOf(frameName)
  for (const [position, scope] of scopes.entries()) {
    // The outermost closure is the module's own scope: it and everything after it stay out, unread.
    if (position >= outermostClosure) break
    // A block of the function's own code is copied by the default policy; keep looking past it.
    if (scope.presentationHint === 'locals') continue
    // Anything other than a closure (Script, Global) is never the function's own, and nothing after it is either.
    if (scope.presentationHint !== 'arguments') break
    if (!isLabelOfStoppedFunction(scope.name, frameLabels)) break
    const names = (await readVariableNames(scope.variablesReference)).filter(
      (name) => !NAMES_OF_NO_OTHER_FUNCTION.has(name),
    )
    // The first closure too large to read whole, or with a name the function does not declare, ends the copy.
    if (
      names.length > maxNamesPerScope ||
      names.some((name) => !declaredNames.has(name))
    )
      break
    // A closure holding no other name has no value to copy; pass over it.
    if (names.length > 0) own.add(position)
  }
  return own
}

/**
 * Applies the label filter to a closure scope's name: the first, cheap test before any variable is read.
 * Called by {@link ownClosureScopePositionsOf}.
 * @param scopeName - The closure scope's name, such as `Closure (greet)`.
 * @param frameLabels - The labels naming the stopped function ({@link frameFunctionLabelsOf}); empty for an anonymous one.
 * @returns
 * - `true` when the closure may be the stopped function's own: it carries the function's label, or it is unlabelled and the function is anonymous
 * - `false` for another function's label, or an unlabelled closure of a named function (an enclosing anonymous function's)
 * @example isLabelOfStoppedFunction('Closure (makeRoutes)', new Set(['GET'])) // => false
 */
function isLabelOfStoppedFunction(
  scopeName: string,
  frameLabels: ReadonlySet<string>,
): boolean {
  const label = CLOSURE_FUNCTION_LABEL.exec(scopeName)?.[1]
  return label === undefined ? frameLabels.size === 0 : frameLabels.has(label)
}
