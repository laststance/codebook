import { URL } from 'node:url'

/**
 * Splits the `req.url` an API-route handler holds into its pathname and its target (pathname plus query), the two forms the pause names and the browser requests are compared by.
 *
 * Why it exists: Node's `req.url` is a path with a query (`/api/data?clear=1`), and the tracker keeps the browser's requests in the same normalised form ({@link RouteHandlerRequests}). Called by {@link ConfiguredBrowserRun} when it matches an API-route hit and names the pause.
 * @param url - The `req.url` value.
 * @returns `{ pathname, target }`; `undefined` when the value does not parse as a request target.
 * @example
 * pagesApiTargetOf('/api/data?clear=1') // => { pathname: '/api/data', target: '/api/data?clear=1' }
 * pagesApiTargetOf('//api/data') // => { pathname: '//api/data', target: '//api/data' }
 */
export function pagesApiTargetOf(
  url: string,
): { pathname: string; target: string } | undefined {
  try {
    // An origin-form target (`/api/data`, `//api/data`) is appended to a base, never resolved, so `//` stays part of the path.
    const parsed = url.startsWith('/')
      ? new URL(`http://localhost${url}`)
      : new URL(url, 'http://localhost')
    return {
      pathname: parsed.pathname,
      target: `${parsed.pathname}${parsed.search}`,
    }
  } catch {
    return undefined
  }
}
