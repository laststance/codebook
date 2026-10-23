import { parseDevelopmentModuleUrl } from './parseDevelopmentModuleUrl'

/**
 * Tells whether a script of the page is the page's own copy of a source file, by the script's URL: a development build names each module of the page by its path from the application's root, right after the build's root marker, so the stub the page holds of a `"use server"` module (the client's reference to each exported action) is the script whose path there is that module's path. {@link ConfiguredBrowserRun} asks it for a page pause, to know a pause in the stub of a declared server stop's module before the debugger has said which breakpoint was hit.
 * The whole path is compared, not its end: a script of another folder whose path only ends like the source's (`vendor/app/lib/actions.ts` for `app/lib/actions.ts`) is another module, and its pause keeps the short bound of a pause nobody owns.
 * @param scriptUrl - The URL the page's runtime announced for the script; `undefined` for a script it never announced.
 * @param sourcePath - The source file's path from the application's root, with forward slashes, as a declared stop names it.
 * @returns `true` when the URL, without a query or a fragment, is the build's root marker (`webpack-internal:///`, a layer in parentheses when the build names one, an optional `./`) followed by exactly that path; `false` otherwise, also for a URL of no development build and for a script without a URL.
 * @example
 * isPageStubOfSource('webpack-internal:///(app-pages-browser)/./app/lib/actions.ts', 'app/lib/actions.ts')        // => true
 * isPageStubOfSource('webpack-internal:///(app-pages-browser)/app/lib/actions.ts', 'app/lib/actions.ts')          // => true
 * isPageStubOfSource('webpack-internal:///(app-pages-browser)/./vendor/app/lib/actions.ts', 'app/lib/actions.ts') // => false
 * isPageStubOfSource(undefined, 'app/lib/actions.ts')                                                           // => false
 */
export function isPageStubOfSource(
  scriptUrl: string | undefined,
  sourcePath: string,
): boolean {
  // Only a module of the build has a path here, and all of it is compared.
  return parseDevelopmentModuleUrl(scriptUrl)?.path === sourcePath
}
