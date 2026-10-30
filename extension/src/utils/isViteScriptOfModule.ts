/** The loopback host names the run's browser may reach the owned server by. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Vite's cache-busting query parameters: they never change which module is served. */
const VITE_CACHE_BUSTING_PARAMETERS = ['t', 'v']

/** The query of an address with the cache-busting parameters removed, sorted so the order does not matter. */
function moduleQueryOf(url: URL): string {
  const parameters = new URLSearchParams(url.search)
  for (const name of VITE_CACHE_BUSTING_PARAMETERS) parameters.delete(name)
  parameters.sort()
  return parameters.toString()
}

/**
 * Tells whether a script a browser announced is the module sealed at an owned-origin address, ignoring Vite's cache-busting query parameters (`t` of a hot update, `v` of the dependency browser hash) and the fragment; any other query (`?raw`, `?url`) names a different module.
 *
 * Why it exists: the sealed address uses `127.0.0.1` where the server listens, while the browser opens `localhost`, so the two spellings must name one module. Called by {@link ConfiguredBrowserRun} for every parsed script through the Vite adapter.
 *
 * @param sealedUrl - The address the module was sealed at.
 * @param announcedUrl - The script URL the browser's debugger announced.
 * @returns `true` when both are loopback addresses of the same port and path.
 * @example
 * isViteScriptOfModule('http://127.0.0.1:3010/src/a.tsx', 'http://localhost:3010/src/a.tsx?t=1730') // => true
 * isViteScriptOfModule('http://127.0.0.1:3010/src/a.tsx', 'http://localhost:3010/src/b.tsx') // => false
 * isViteScriptOfModule('http://127.0.0.1:3010/src/a.tsx', 'http://localhost:3010/src/a.tsx?raw') // => false
 */
export function isViteScriptOfModule(
  sealedUrl: string,
  announcedUrl: string,
): boolean {
  try {
    const sealed = new URL(sealedUrl),
      announced = new URL(announcedUrl)
    return (
      LOOPBACK_HOSTS.has(announced.hostname) &&
      announced.protocol === sealed.protocol &&
      announced.port === sealed.port &&
      announced.pathname === sealed.pathname &&
      moduleQueryOf(announced) === moduleQueryOf(sealed)
    )
  } catch {
    return false
  }
}
