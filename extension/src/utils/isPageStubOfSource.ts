/**
 * Tells whether a script of the page is the page's own copy of a source file, by the script's URL: a development build names each module of the page by its path in the repository, so the stub the page holds of a `"use server"` module (the client's reference to each exported action) ends with that module's path. {@link ConfiguredBrowserRun} asks it for a page pause, to know a pause in the stub of a declared server stop's module before the debugger has said which breakpoint was hit.
 * @param scriptUrl - The URL the page's runtime announced for the script; `undefined` for a script it never announced.
 * @param sourcePath - The source file's path in the repository, with forward slashes.
 * @returns `true` when the URL's path, without a query or a fragment, ends with that path as whole segments; `false` otherwise, and for a script without a URL.
 * @example
 * isPageStubOfSource('webpack-internal:///(app-pages-browser)/./app/lib/actions.ts', 'app/lib/actions.ts') // => true
 * isPageStubOfSource('webpack-internal:///(app-pages-browser)/./app/lib/my-actions.ts', 'actions.ts')     // => false
 * isPageStubOfSource(undefined, 'app/lib/actions.ts')                                                   // => false
 */
export function isPageStubOfSource(
  scriptUrl: string | undefined,
  sourcePath: string,
): boolean {
  if (!scriptUrl) return false
  const path = scriptUrl.split(/[?#]/, 1)[0] ?? ''
  return path.endsWith(`/${sourcePath}`)
}
