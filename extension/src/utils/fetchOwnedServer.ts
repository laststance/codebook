import { request as httpRequest, type IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

/** Statuses a `Response` must be built with a null body. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304])

/**
 * Turns a Node response into a standard `Response`, so the callers' status, header and body-cap logic stays the same for both transports.
 * @param message - The answer of an `http` request.
 * @returns A `Response` that streams the message's body.
 * @example toResponse(message).status // => 200
 */
function toResponse(message: IncomingMessage): Response {
  const headers = new Headers()
  for (const [name, value] of Object.entries(message.headers))
    for (const item of Array.isArray(value) ? value : [value])
      if (item !== undefined) headers.append(name, item)
  const status = message.statusCode ?? 502
  if (NULL_BODY_STATUSES.has(status)) {
    message.resume()
    return new Response(null, { status, headers })
  }
  return new Response(Readable.toWeb(message) as ReadableStream<Uint8Array>, {
    status,
    headers,
  })
}

/**
 * GETs a page of the owned dev server, never following a redirect, optionally naming another `Host` than the address it connects to.
 *
 * Why it exists: Metro writes the request's `Host` into the `sourceMappingURL` line of its bundle, so the bytes Chrome executes (it asked at `localhost:<port>`) differ from the bytes read at `127.0.0.1:<port>`. The global `fetch` ignores a `Host` header, so a profile that needs the browser's bytes reads through `node:http`. Without a host the global `fetch` is used unchanged. Called by {@link findSingleBundleUrl} and {@link readSingleServedBundle}.
 * The connection always goes to `url` (the owned origin); only the header differs.
 * @param url - The address on the owned origin.
 * @param host - The `Host` header to send (`localhost:4101`), or `undefined` for a plain `fetch`.
 * @param signal - Ends the request and its body.
 * @returns The answer as it came; a 3xx is returned, not followed.
 * @throws When the request fails, is aborted before the answer, or answers a status a `Response` cannot hold (outside 200-599).
 * @example await fetchOwnedServer(new URL('http://127.0.0.1:4101/'), 'localhost:4101', signal) // => Response 200
 */
export function fetchOwnedServer(
  url: URL | string,
  host: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  // No host to present: the global fetch, as before.
  if (host === undefined) return fetch(url, { redirect: 'manual', signal })
  const target = new URL(url)
  return new Promise<Response>((resolve, reject) => {
    const request = httpRequest(
      target,
      { method: 'GET', headers: { host }, agent: false, signal },
      (message) => {
        // `Response` refuses a status outside 200-599 (a server may send up to 999); reject instead of throwing in the listener.
        try {
          resolve(toResponse(message))
        } catch (error) {
          message.destroy()
          reject(error)
        }
      },
    )
    request.on('error', reject)
    request.end()
  })
}
