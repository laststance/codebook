import type { SessionCookies } from './applySetCookies'

/** How the sign-in request ended. */
export type SignInOutcome =
  | { kind: 'signed-in' }
  | { kind: 'failed'; reason: 'rejected' | 'no-session-cookie' }

/**
 * Judges the sign-in response: signed in only when it succeeded and set a cookie to send.
 *
 * Why it exists: a 2xx without a session cookie signs nobody in, and a redirect or error means the server refused.
 * Called by the node-server run after the sign-in response arrives.
 *
 * @param status - The HTTP status of the sign-in response.
 * @param cookies - The cookies after applying the response's headers.
 * @returns `signed-in`, or `failed` with `no-session-cookie` (2xx, nothing to send) or `rejected` (any other status, 3xx included).
 * @example
 * signInOutcomeOf(302, cookies) // => { kind: 'failed', reason: 'rejected' }
 */
export function signInOutcomeOf(
  status: number,
  cookies: SessionCookies,
): SignInOutcome {
  if (status < 200 || status > 299)
    return { kind: 'failed', reason: 'rejected' }
  if (cookies.send.size === 0)
    return { kind: 'failed', reason: 'no-session-cookie' }
  return { kind: 'signed-in' }
}
