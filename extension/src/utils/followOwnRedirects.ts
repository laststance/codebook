import {
  HTTP_REDIRECT_STATUS_END,
  HTTP_REDIRECT_STATUS_MIN,
  REVERSE_PROXY_OWN_REDIRECT_HOP_LIMIT,
} from '../constants'

/**
 * Resolves where a redirect answer points.
 * @param response - An answer to a request sent with `redirect: 'manual'`.
 * @param requestUrl - The URL that was requested, the base of a relative `Location`.
 * @returns The target URL; `undefined` when the answer is no redirect, has no `Location` or the `Location` is no URL.
 * @example
 * redirectTargetOf(new Response(null, { status: 302, headers: { location: '/en' } }), 'http://127.0.0.1:4310/')?.href // => 'http://127.0.0.1:4310/en'
 */
function redirectTargetOf(
  response: Response,
  requestUrl: string,
): URL | undefined {
  const location = response.headers.get('location')
  if (
    response.status < HTTP_REDIRECT_STATUS_MIN ||
    response.status >= HTTP_REDIRECT_STATUS_END ||
    location === null
  )
    return undefined
  try {
    return new URL(location, requestUrl)
  } catch {
    return undefined
  }
}

/**
 * Asks a URL and follows its redirects by hand, only while they stay on the dev server's own loopback origin.
 *
 * Why it exists: the global `fetch` would resolve a redirect to the declared host through the operating system's resolver and trust store, outside the address the proof checked. So no request of Codebook leaves the dev server's loopback address except the proof and the browser probe. Called by `rootAnswer` in {@link launchDevelopmentServer} for a run that declares `reverseProxy`.
 *
 * The walk stops at the first target on another origin: a stop at the declared origin counts as an answer (the server is up; the status of that redirect is not judged) and is returned as a synthetic `200`; a stop at any other origin, or after the hop limit, returns the redirect answer itself, which the caller reads as a failed root.
 * @param startUrl - The loopback URL to ask first.
 * @param declaredOrigin - The origin the run declared in `reverseProxy.origin`.
 * @param send - Sends one request with `redirect: 'manual'` and returns its answer.
 * @returns The final answer, or a synthetic `200` when the walk stopped at the declared origin.
 * @example
 * await followOwnRedirects('http://127.0.0.1:4310/', 'https://app.example.test', (url) => fetch(url, { redirect: 'manual' }))
 */
export async function followOwnRedirects(
  startUrl: string,
  declaredOrigin: string,
  send: (url: string) => Promise<Response>,
): Promise<Response> {
  const ownOrigin = new URL(startUrl).origin
  let url = startUrl
  let response = await send(url)
  for (let hop = 0; hop < REVERSE_PROXY_OWN_REDIRECT_HOP_LIMIT; hop += 1) {
    const target = redirectTargetOf(response, url)
    // Not a redirect: this is the final answer.
    if (target === undefined) return response
    // The server redirects to the public host: it is up, the 3xx is not judged.
    if (target.origin === declaredOrigin) {
      await response.body?.cancel()
      return new Response(null, { status: 200 })
    }
    // Any other origin is never asked; the caller reads the redirect as a failed root.
    if (target.origin !== ownOrigin) return response
    await response.body?.cancel()
    url = target.href
    response = await send(url)
  }
  return response
}
