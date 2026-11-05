/** One DAP scope as js-debug answers `scopes`: the language-neutral hint and cost flag decide, never the translated name. */
type AnsweredScope = { presentationHint?: string; expensive?: boolean }

/**
 * Finds the scope that holds a module's own top-level bindings at a pause in that module's top-level code (a module evaluation).
 *
 * Why: Next's development server wraps each module in `eval`, so at a module evaluation js-debug's innermost scope of the stopped frame is the module's **Eval** scope, which has no presentation hint (only Local, Block, Catch and With are `locals`), and its name is translated into the editor's display language. Without this the stop's own values would never be copied. Called by {@link captureReplayDebugSnapshot} for the stopped frame of a module-evaluation pause.
 * @param scopes - The stopped frame's scopes, innermost first, as the adapter answered them.
 * @returns
 * - the position of the first scope without a hint, when no closure or other enclosing scope comes before it and it is not marked expensive (js-debug marks Global and an ES Module scope expensive)
 * - `undefined` when there is no such scope
 * @example
 * moduleScopePositionOf([{}, { presentationHint: 'arguments' }, { expensive: true }]) // => 0 (Eval, Closure, Global)
 * moduleScopePositionOf([{ presentationHint: 'locals' }, {}]) // => 1 (Block, Eval)
 * moduleScopePositionOf([{ presentationHint: 'locals' }, { presentationHint: 'arguments' }, { expensive: true }]) // => undefined
 */
export function moduleScopePositionOf(
  scopes: readonly AnsweredScope[],
): number | undefined {
  for (const [position, scope] of scopes.entries()) {
    // A block of the module's top-level code comes first and is copied as local values already; keep looking past it.
    if (scope.presentationHint === 'locals') continue
    // A closure (or any other hinted scope) belongs to enclosing code, so the frame's own scopes have ended.
    if (scope.presentationHint !== undefined) return undefined
    return scope.expensive === true ? undefined : position
  }
  return undefined
}
