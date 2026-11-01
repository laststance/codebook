import {
  HTTP_REDIRECT_STATUS_END,
  HTTP_REDIRECT_STATUS_MIN,
} from '../constants'

import { matchSignInPath } from './matchSignInPath'
import { isOwnedApplicationOrigin } from './ownedApplicationOrigin'
import { redactNextEntryPath } from './redactNextEntryPath'

/** Where a redirect of the entry page points: a redacted path on the owned origin, or another origin, which is never named or fetched. */
export type NextEntryLocation =
  { sameOrigin: true; path: string } | { sameOrigin: false }

/** What the owned Next server answered to the entry path, read without following a redirect. */
export type NextEntryResponse = {
  status: number
  /** Present for a redirect status with a `Location` header. */
  location?: NextEntryLocation
  /** Present when the redirect points at the same path and query that were asked for: a redirect loop. */
  redirectsToItself?: true
  /** The declared sign-in path (`signInPaths`) the same-origin redirect points at; the query never leaves. */
  redirectsToSignIn?: string
}

/**
 * Describes the answer of the owned Next server to the entry path, for the Pages run's refusals, without keeping any raw `Location`.
 *
 * Why it exists: a redirect of the entry page is refused (`NEXT_ENTRY_REDIRECTED`) with both paths named, but a `Location` may carry a token in its query or point at another site; so only a redacted same-origin path, or the fact of another origin, is kept. Called by the launcher's structured entry check ({@link launchDevelopmentServer}) after its `redirect: 'manual'` GET; nothing here fetches.
 * @param status - The HTTP status of the entry page.
 * @param location - The response's `Location` header, or `null`.
 * @param requestUrl - The absolute URL that was asked for (`<owned origin><entryPath>`), which a relative `Location` resolves against.
 * @param ownedOrigin - The origin the owned server listens on; `localhost`, `127.0.0.1` and `[::1]` at its port count as the same origin.
 * @param signInPaths - The configuration's `signInPaths`; a same-origin redirect to one of them adds `redirectsToSignIn: <declared path>` (the query is compared away, never kept).
 * @returns
 * - `{ status }` for a status outside 3xx, or a 3xx without `Location`
 * - `{ status, location: { sameOrigin: true, path } }` with the redacted origin-less path for a same-origin target, plus `redirectsToItself: true` when it is the path and query asked for
 * - `{ status, location: { sameOrigin: false } }` for another origin or a `Location` that is no URL
 * @example
 * describeNextEntryResponse(307, '/login?token=SECRET', 'http://127.0.0.1:3000/dashboard', 'http://127.0.0.1:3000')
 * // => { status: 307, location: { sameOrigin: true, path: '/login?token=<redacted>' } }
 * describeNextEntryResponse(302, 'https://accounts.example.com/o/oauth', 'http://127.0.0.1:3000/', 'http://127.0.0.1:3000')
 * // => { status: 302, location: { sameOrigin: false } }
 */
export function describeNextEntryResponse(
  status: number,
  location: string | null,
  requestUrl: string,
  ownedOrigin: string,
  signInPaths?: readonly string[],
): NextEntryResponse {
  const isRedirect =
    status >= HTTP_REDIRECT_STATUS_MIN && status < HTTP_REDIRECT_STATUS_END
  if (!isRedirect || location === null) return { status }
  let target: URL
  try {
    target = new URL(location, requestUrl)
  } catch {
    // A target that is no URL names no path Codebook could show.
    return { status, location: { sameOrigin: false } }
  }
  if (!isOwnedApplicationOrigin(target.origin, ownedOrigin))
    return { status, location: { sameOrigin: false } }
  const requested = new URL(requestUrl)
  const path = redactNextEntryPath(
    `${target.pathname}${target.search}${target.hash}`,
  )
  // The raw path and query are compared here and dropped; only the verdict leaves.
  const loops =
    target.pathname === requested.pathname && target.search === requested.search
  const signIn = matchSignInPath(target.pathname, signInPaths)
  const described: NextEntryResponse = {
    status,
    location: { sameOrigin: true, path },
  }
  if (loops) described.redirectsToItself = true
  if (signIn !== undefined) described.redirectsToSignIn = signIn
  return described
}
