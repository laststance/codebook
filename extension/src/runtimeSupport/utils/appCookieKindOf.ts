import type { AppCookieKind } from '../savedSessionTypes'

/**
 * Reduces a `Storage.getCookies` answer to the kind of the app's cookies, keeping no name, value or domain.
 * Why it exists: the setup must know whether the app keeps its sign-in across a browser restart (`session-cookie-only` otherwise) without any cookie value leaving the CDP response handler.
 * Called inside the response handler of {@link launchSignInBrowser}'s cookie read, before any promise resolves.
 * @param result - The raw CDP answer; read defensively, since it comes from a browser.
 * @param host - The app's host, for example `localhost`; a cookie counts when the browser sends it to that host: a host-only cookie (CDP writes its domain without a dot) of exactly the host, or a domain cookie (written with a leading dot) of the host or a parent domain.
 * @returns
 * - `persistent`: at least one cookie of the host outlives the browser session
 * - `session-only`: the host has cookies and every one is a session cookie
 * - `none`: the host has no cookie
 * @example
 * appCookieKindOf({ cookies: [{ domain: 'localhost', session: false }] }, 'localhost') // => 'persistent'
 * appCookieKindOf({ cookies: [{ domain: 'github.com', session: false }] }, 'localhost') // => 'none'
 * appCookieKindOf({ cookies: [{ domain: 'localhost', session: false }] }, 'app.localhost') // => 'none' (host-only cookie of the parent)
 */
export function appCookieKindOf(
  result: Record<string, unknown>,
  host: string,
): Exclude<AppCookieKind, 'unknown'> {
  const cookies = Array.isArray(result.cookies) ? result.cookies : []
  let hasCookie = false
  for (const cookie of cookies) {
    if (typeof cookie !== 'object' || cookie === null) continue
    const domain = Reflect.get(cookie, 'domain')
    if (typeof domain !== 'string' || !isDomainOfHost(domain, host)) continue
    hasCookie = true
    // Chrome marks a cookie that dies with the browser session as `session: true`.
    if (Reflect.get(cookie, 'session') === false) return 'persistent'
  }
  return hasCookie ? 'session-only' : 'none'
}

/** Says whether the browser sends a cookie of this CDP domain to the host. */
function isDomainOfHost(domain: string, host: string): boolean {
  // A leading dot marks a domain cookie, sent to that domain and every subdomain.
  if (domain.startsWith('.'))
    return host === domain.slice(1) || host.endsWith(domain)
  // Without the dot the cookie is host-only: sent to exactly that host, never to its subdomains.
  return host === domain
}
