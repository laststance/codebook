/** The loopback host names the run's browser may reach the owned server by. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Gives the path of an address with a trailing `/` read as the folder's `index.html`, the file the static server answers it with.
 * @param pathname - A URL path.
 * @returns The path with `index.html` appended after a trailing slash.
 * @example indexPathOf('/') // => '/index.html'
 */
function indexPathOf(pathname: string): string {
  return pathname.endsWith('/') ? `${pathname}index.html` : pathname
}

/**
 * Tells whether a script a browser announced is the module sealed for a stop of a `static-page` run.
 *
 * Why it exists: the sealed address of a page script uses `127.0.0.1` where the static server listens, while the browser opens `localhost`, and the entry page may be asked as `/` or as `/index.html`; a library file keeps the CDN address the page wrote. Called by {@link ConfiguredBrowserRun} for each script the page's debugger announces.
 * @param sealedUrl - The address the module was sealed at.
 * @param announcedUrl - The script URL the browser's debugger announced.
 * @returns For a CDN address, `true` when both are the same address without its fragment; for a loopback address, `true` when the announced one is a loopback address of the same port and path (`/` equal to `/index.html`, query ignored).
 * @example
 * isStaticPageScriptOfModule('http://127.0.0.1:4310/', 'http://localhost:4310/index.html') // => true
 * isStaticPageScriptOfModule('https://unpkg.com/lib@1/a.mjs', 'https://unpkg.com/lib@1/a.mjs#x') // => true
 * isStaticPageScriptOfModule('http://127.0.0.1:4310/a.js', 'http://localhost:4310/b.js') // => false
 */
export function isStaticPageScriptOfModule(
  sealedUrl: string,
  announcedUrl: string,
): boolean {
  try {
    const sealed = new URL(sealedUrl),
      announced = new URL(announcedUrl)
    if (sealed.protocol === 'https:')
      return (
        announced.protocol === 'https:' &&
        announced.host === sealed.host &&
        announced.pathname === sealed.pathname &&
        announced.search === sealed.search
      )
    return (
      LOOPBACK_HOSTS.has(announced.hostname) &&
      announced.protocol === sealed.protocol &&
      announced.port === sealed.port &&
      indexPathOf(announced.pathname) === indexPathOf(sealed.pathname)
    )
  } catch {
    return false
  }
}
