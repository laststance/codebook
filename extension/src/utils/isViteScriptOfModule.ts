/** The loopback host names the run's browser may reach the owned server by. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Tells whether a script a browser announced is the module sealed at an owned-origin address, ignoring the query (`?t=` of a hot update) and the fragment.
 *
 * Why it exists: the sealed address uses `127.0.0.1` where the server listens, while the browser opens `localhost`, so the two spellings must name one module. Called by {@link ConfiguredBrowserRun} for every parsed script through the Vite adapter.
 *
 * @param sealedUrl - The address the module was sealed at.
 * @param announcedUrl - The script URL the browser's debugger announced.
 * @returns `true` when both are loopback addresses of the same port and path.
 * @example
 * isViteScriptOfModule('http://127.0.0.1:3010/src/a.tsx', 'http://localhost:3010/src/a.tsx?t=1730') // => true
 * isViteScriptOfModule('http://127.0.0.1:3010/src/a.tsx', 'http://localhost:3010/src/b.tsx') // => false
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
      announced.pathname === sealed.pathname
    )
  } catch {
    return false
  }
}
