import type { BundleSource } from '../repositoryBundle'

import { bundleOfEvaluatedModule } from './extractDevelopmentModule'
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

/**
 * Seals the module a runtime parsed for another layer under the frozen original of a declared stop, so a pause in that script can be placed by its own source map.
 * The instance is accepted only as the same original: its inline map must name the exact source path, and the caller's verifier ({@link createBundleVerifier}) refuses a map whose retained original differs from the frozen text. Its generated code may differ from the sealed instance's, which is why it carries its own map.
 * @param sealed - The stop's sealed bundle, which gives the frozen original and path.
 * @param url - The address of the script the runtime announced.
 * @param scriptSource - The text the runtime holds for that script (`Debugger.getScriptSource`).
 * @returns The instance's bundle, or `undefined` when the text carries another script address.
 * @throws When the text's script identity or inline map is ambiguous or malformed, or the map does not name the exact original.
 * @example
 * ```ts
 * createBundleVerifier(sealRuntimeModuleInstance(stop.bundle, event.url, executed.scriptSource)!)
 * ```
 */
export function sealRuntimeModuleInstance(
  sealed: BundleSource,
  url: string,
  scriptSource: string,
): BundleSource | undefined {
  return bundleOfEvaluatedModule(
    scriptSource,
    sealed,
    url,
  )
}
