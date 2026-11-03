/**
 * Says whether a script address is a module of a Pages page's server compile (the `(pages-dir-node)` webpack layer), the layer a Pages server stop is sealed in.
 *
 * Why it exists: a repeat hit of a Pages data function and the label of a Pages server pause are judged by the layer of the script, as an App Router hit is by `(rsc)` ({@link isRscScriptUrl}). Called by {@link serverExecutionOfScriptUrl} and by {@link ConfiguredBrowserRun}'s repeat-hit check.
 * @param scriptUrl - A script address, if known.
 * @returns `true` when the address names the `(pages-dir-node)` layer.
 * @example
 * isPagesServerScriptUrl('webpack-internal:///(pages-dir-node)/./src/pages/index.tsx') // => true
 * isPagesServerScriptUrl('webpack-internal:///(rsc)/./app/page.tsx') // => false
 * isPagesServerScriptUrl(undefined) // => false
 */
export function isPagesServerScriptUrl(scriptUrl: string | undefined): boolean {
  return scriptUrl?.includes('webpack-internal:///(pages-dir-node)/') ?? false
}
