/**
 * Tells whether a script the page announced is a webpack hot-update chunk (`…/<hash>.hot-update.js`), which a Pages run never binds as a sealed module.
 *
 * Why it exists: Fast Refresh delivers changed modules in hot-update chunks; such a chunk is no module the run sealed, so it must never stand in for one. Called by the configured browser run's `Debugger.scriptParsed` binding for a Pages run.
 * @param url - The announced script URL; empty for an inline script.
 * @returns `true` when the URL's path ends in `.hot-update.js` (a query such as `?ts=…` is ignored); `false` for any other URL, also one that does not parse.
 * @example
 * isHotUpdateScriptUrl('http://localhost:3000/_next/static/webpack/pages/index.0a1b.hot-update.js') // => true
 * isHotUpdateScriptUrl('webpack-internal:///(pages-dir-browser)/./src/pages/index.tsx')            // => false
 */
export function isHotUpdateScriptUrl(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith('.hot-update.js')
  } catch {
    return false
  }
}
