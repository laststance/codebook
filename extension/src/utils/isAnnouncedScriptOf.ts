import { sameScriptUrl } from './sameScriptUrl'

/**
 * Tells whether a script URL a page's debugger announced names a sealed webpack module, in the module's own spelling or in the spelling the editor's debugger announces for a page.
 *
 * Why it exists: js-debug's CDP channel announces a page's scripts with their dot segments resolved, as `new URL(...)` does (native C79-1 journal, VS Code 1.145, Chrome on macOS). A module inside the app keeps its layer and loses only `./`, which {@link sameScriptUrl} already accepts. A workspace library module named `(pages-dir-browser)/../../../packages/q/build/a.js` arrives as `packages/q/build/a.js`: the first `..` takes the layer and the rest stop at the root, so neither the layer nor the depth is left to compare. Called by {@link ConfiguredBrowserRun} wherever an announced script is matched with a library stop's sealed module, and by the Next adapter's module check.
 *
 * The resolved spelling holds less than the sealed one: two modules whose paths differ only in how far they climb (`../../packages/q` and `../../../packages/q`) resolve alike. Callers keep comparing the executed bytes with the sealed build, so such a script fails the run instead of passing for the sealed module.
 * @param sealedUrl - The module URL the run sealed, as the build wrote it.
 * @param announcedUrl - The URL the runtime announced for a parsed script.
 * @returns
 * - `true` when the announced URL is the sealed URL ({@link sameScriptUrl}), or the sealed URL with its dot segments resolved;
 * - `false` otherwise, also for a URL that does not parse.
 * @example
 * isAnnouncedScriptOf('webpack-internal:///(pages-dir-browser)/../../../packages/q/build/a.js', 'webpack-internal:///packages/q/build/a.js') // => true
 * isAnnouncedScriptOf('webpack-internal:///(pages-dir-browser)/./src/pages/_app.tsx', 'webpack-internal:///(pages-dir-browser)/src/pages/_app.tsx') // => true
 * isAnnouncedScriptOf('webpack-internal:///(pages-dir-browser)/../../../packages/q/build/a.js', 'webpack-internal:///packages/q/build/b.js') // => false
 */
export function isAnnouncedScriptOf(
  sealedUrl: string,
  announcedUrl: string,
): boolean {
  if (sameScriptUrl(sealedUrl, announcedUrl)) return true
  try {
    return sameScriptUrl(new URL(sealedUrl).href, announcedUrl)
  } catch {
    // A sealed URL that does not parse has no resolved spelling.
    return false
  }
}
