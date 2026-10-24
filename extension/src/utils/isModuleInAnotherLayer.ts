import { parseDevelopmentModuleUrl } from './parseDevelopmentModuleUrl'

/**
 * Tells whether a script address is the same module as a sealed one, loaded for another webpack layer.
 * Next compiles one source file once per layer that imports it (`(action-browser)`, `(middleware)`, `(rsc)`, ...) and the runtime parses each as a script of its own, so a declared stop's line can run in a script other than the one that was sealed. Called by {@link ConfiguredBrowserRun}'s `isModuleInAnotherLayerOfStop` for every script a server participant announces. The address is read by {@link parseDevelopmentModuleUrl}, the parser {@link isPageStubOfSource} uses for the same addresses.
 * @param sealedUrl - The script address the stop's bundle was sealed under.
 * @param url - The address of a script the runtime announced.
 * @returns `true` when both are webpack layer addresses of the same module path and the layers differ; `false` for the sealed script itself, another module, and any address that is no webpack layer address.
 * @example
 * ```ts
 * isModuleInAnotherLayer('webpack-internal:///(action-browser)/./auth.config.ts', 'webpack-internal:///(middleware)/./auth.config.ts') // true
 * isModuleInAnotherLayer('webpack-internal:///(action-browser)/./auth.ts', 'webpack-internal:///(middleware)/./auth.config.ts') // false
 * ```
 */
export function isModuleInAnotherLayer(
  sealedUrl: string,
  url: string,
): boolean {
  const sealed = parseDevelopmentModuleUrl(sealedUrl),
    announced = parseDevelopmentModuleUrl(url)
  return (
    sealed?.layer !== undefined &&
    announced?.layer !== undefined &&
    sealed.path === announced.path &&
    sealed.layer !== announced.layer
  )
}
