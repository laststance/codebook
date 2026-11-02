/**
 * Reads the address a script names for itself in its last `//# sourceURL=` comment.
 *
 * Why it exists: js-debug's CDP proxy forwards only scripts parsed after a subscription, so a server module Next evaluated before the debugger attached is never announced; its text still ends with the address webpack gave it, which is how the run recognises it at its first pause. Called by {@link ConfiguredBrowserRun} when a server pause arrives in a script the run never saw parsed.
 * @param scriptSource - The text `Debugger.getScriptSource` returned.
 * @returns The address of the last `sourceURL` comment (legacy `//@` form included), or `undefined` when the text has none.
 * @example
 * ```ts
 * lastSourceUrlOf('eval("x");\n//# sourceURL=webpack-internal:///(rsc)/./app/page.tsx') // => 'webpack-internal:///(rsc)/./app/page.tsx'
 * ```
 */
export function lastSourceUrlOf(scriptSource: string): string | undefined {
  const matches = [
    ...scriptSource.matchAll(/^[ \t]*\/\/[#@][ \t]*sourceURL=(\S+)[ \t]*$/gm),
  ]
  return matches.at(-1)?.[1]
}
