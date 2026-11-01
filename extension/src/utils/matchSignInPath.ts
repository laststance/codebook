import { normalizedSignInPathname } from './normalizedSignInPathname'

/**
 * Finds which declared sign-in path a location is on, so a run can answer `SIGN_IN_REQUIRED` the moment its page lands there.
 *
 * Compares the location's pathname with each declared path after one trailing slash is removed on both sides; the query and fragment never take part, the match is exact and case-sensitive, and `/en/login` is its own entry. Called by the configured browser run for every main-frame navigation and pathname read, and by {@link describeNextEntryResponse} for a redirect target.
 * @param location - An absolute URL, a path with or without a query, or a bare pathname.
 * @param signInPaths - The configuration's `signInPaths`; absent means the run detects nothing.
 * @returns The declared path that matched (as the configuration spells it), or `undefined`. The query is never returned.
 * @example
 * matchSignInPath('http://localhost:3000/login/?callbackUrl=%2Fdashboard', ['/login']) // => '/login'
 * matchSignInPath('/en/login', ['/login']) // => undefined
 */
export function matchSignInPath(
  location: string,
  signInPaths: readonly string[] | undefined,
): string | undefined {
  if (!signInPaths?.length) return undefined
  let pathname: string
  try {
    // The base only places a bare path; an absolute URL keeps its own pathname.
    pathname = new URL(location, 'http://localhost').pathname
  } catch {
    return undefined
  }
  const normalized = normalizedSignInPathname(pathname)
  return signInPaths.find(
    (declared) => normalizedSignInPathname(declared) === normalized,
  )
}
