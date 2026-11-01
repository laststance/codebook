import { normalizedSignInPathname } from './normalizedSignInPathname'
import { isOwnedApplicationOrigin } from './ownedApplicationOrigin'

/** A page as the run sees it: the absolute URL a navigation reports, or the origin and pathname the page reports (a parsed `URL` is one). */
export type SignInPageLocation = string | { origin: string; pathname: string }

/**
 * Finds which declared sign-in path a page on the run's own application origin is on, so a run can answer `SIGN_IN_REQUIRED` the moment its page lands there.
 *
 * The declared paths are same-origin paths: a page on another origin (an external sign-in page such as `https://github.com/login`, or Chrome's error page) is never on one of them, whatever its pathname. An absolute URL is parsed as a whole, never as a reference against a base, and a pathname is compared as it is, so `//x/login` is not `/login`; one trailing slash is removed and both sides are written as the browser writes `location.pathname` ({@link normalizedSignInPathname}). The match is exact and case-sensitive, and `/en/login` is its own entry. Called by the configured browser run for every main-frame navigation and page read, and by {@link describeNextEntryResponse} for a redirect target.
 * @param page - The navigation's absolute URL, or the page's origin and pathname; a query never takes part, and a string that is no absolute URL is on no sign-in path.
 * @param ownedOrigin - The origin of the server Codebook started; `localhost`, `127.0.0.1` and (with `ipv6`) `[::1]` at its port are the same origin.
 * @param signInPaths - The configuration's `signInPaths`; absent means the run detects nothing.
 * @param ipv6 - Whether the run owns `[::1]` at the port; `true` by default.
 * @returns The declared path that matched (as the configuration spells it), or `undefined`.
 * @example
 * matchSignInPath('http://localhost:3000/login/?callbackUrl=%2Fdashboard', 'http://127.0.0.1:3000', ['/login']) // => '/login'
 * matchSignInPath('https://github.com/login', 'http://127.0.0.1:3000', ['/login']) // => undefined
 * matchSignInPath({ origin: 'http://localhost:3000', pathname: '//x/login' }, 'http://127.0.0.1:3000', ['/login']) // => undefined
 */
export function matchSignInPath(
  page: SignInPageLocation,
  ownedOrigin: string,
  signInPaths: readonly string[] | undefined,
  ipv6 = true,
): string | undefined {
  if (!signInPaths?.length) return undefined
  const location = typeof page === 'string' ? absoluteLocationOf(page) : page
  // A page on another origin left the run's app: the navigation rules judge it, never the sign-in paths (E4).
  if (
    !location ||
    !isOwnedApplicationOrigin(location.origin, ownedOrigin, ipv6) ||
    !location.pathname.startsWith('/')
  )
    return undefined
  const normalized = normalizedSignInPathname(location.pathname)
  return signInPaths.find(
    (declared) => normalizedSignInPathname(declared) === normalized,
  )
}

/**
 * Reads the origin and pathname of an absolute URL, with no base, so a string that is no absolute URL names no page.
 * @param url - What a navigation reported.
 * @returns The origin and pathname, or `undefined`.
 * @example absoluteLocationOf('/login') // => undefined
 */
function absoluteLocationOf(
  url: string,
): { origin: string; pathname: string } | undefined {
  try {
    const parsed = new URL(url)
    return { origin: parsed.origin, pathname: parsed.pathname }
  } catch {
    return undefined
  }
}
