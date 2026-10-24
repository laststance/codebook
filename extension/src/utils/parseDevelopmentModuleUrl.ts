/** Reads a module's address in a development build: after the build's root marker (the scheme), the build layer in parentheses when the build names one, then the `./` the build may write before the path from the application's root, and everything up to a query or a fragment. */
const DEVELOPMENT_MODULE_URL =
  /^webpack-internal:\/\/\/(?:\(([^()/]+)\)\/)?(?:\.\/)?([^?#]*)/

/**
 * Splits a module's script address in a development build into the build layer and the module's path from the application's root, the one parser of that address for {@link isPageStubOfSource} (a page's stub of a source file) and {@link isModuleInAnotherLayer} (the same file loaded for another webpack layer).
 * @param scriptUrl - The address a runtime announced for a script; `undefined` for a script it never announced.
 * @returns The layer (absent when the build names none) and the path, without a `./`, query or fragment; `undefined` for an address of no development build.
 * @example
 * parseDevelopmentModuleUrl('webpack-internal:///(middleware)/./auth.config.ts') // => { layer: 'middleware', path: 'auth.config.ts' }
 * parseDevelopmentModuleUrl('webpack-internal:///./theme.tsx')                   // => { path: 'theme.tsx' }
 * parseDevelopmentModuleUrl('file:///app/auth.config.ts')                         // => undefined
 */
export function parseDevelopmentModuleUrl(
  scriptUrl: string | undefined,
): { layer?: string; path: string } | undefined {
  const match = DEVELOPMENT_MODULE_URL.exec(scriptUrl ?? '')
  if (!match) return undefined
  return {
    ...(match[1] === undefined ? {} : { layer: match[1] }),
    path: match[2]!,
  }
}
