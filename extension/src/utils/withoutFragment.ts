/**
 * Drops the fragment of a url, so a page that routes by hash still compares equal to the url it was opened at; the query stays significant.
 * Used by the surface tie of the extension debugger and by the owned launch when it closes the extension's own copies of the surface page.
 * @param url - A target's url as Chrome lists it.
 * @returns The url without `#…`, or the url itself when it has no fragment.
 * @example
 * withoutFragment('chrome-extension://abc/fullpage.html#split') // => 'chrome-extension://abc/fullpage.html'
 * withoutFragment('chrome-extension://abc/page.html?tab=2') // => 'chrome-extension://abc/page.html?tab=2'
 */
export function withoutFragment(url: string): string {
  const hash = url.indexOf('#')
  return hash < 0 ? url : url.slice(0, hash)
}
