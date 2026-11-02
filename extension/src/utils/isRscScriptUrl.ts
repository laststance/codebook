/**
 * Says whether a script address is an `(rsc)` instance (also the layer a sealed `(rsc)` stop's own bundle names).
 * Called by {@link serverExecutionOfScriptUrl} and by {@link ConfiguredBrowserRun}'s hit classification, which applies to `(rsc)` instances only.
 * @param scriptUrl - A script address, if known.
 * @returns `true` when the address names the `(rsc)` layer.
 * @example
 * isRscScriptUrl('webpack-internal:///(rsc)/./app/page.tsx') // => true
 * isRscScriptUrl('about://React/Server/webpack-internal:///(rsc)/./app/page.tsx?3') // => true
 * isRscScriptUrl(undefined) // => false
 */
export function isRscScriptUrl(scriptUrl: string | undefined): boolean {
  return scriptUrl?.includes('webpack-internal:///(rsc)/') ?? false
}
