import { readCappedBody } from './readCappedBody'
import { redactNextEntryPath } from './redactNextEntryPath'
import type { NextPagesChunkFetcher } from './spendNextPagesDiscovery'

/**
 * Builds the HTTP fallback a Pages seal reads a listed chunk through when no file of it exists in `.next/dev`: a GET of `/_next/<chunkPath>` on the owned origin only, no redirect followed, the body capped, and a chunk path with a `.` or `..` segment refused unfetched.
 *
 * Why it exists: Next can serve a chunk from memory before it writes the file, and the build manifest lists it either way. Called by the Next adapter's `readBundle` for each Pages stop it seals with {@link readPagesDevelopmentBundle}; the discovery budget gives each fetch its byte bound and signal.
 * @param ownedOrigin - The origin the owned server listens on, e.g. `http://127.0.0.1:3000`.
 * @returns The fetcher; it throws for a chunk path with a `.` or `..` segment, a status other than 2xx, or a body past its byte bound.
 * @example
 * await nextServedChunkFetcher('http://127.0.0.1:3000')('static/chunks/pages/index.js', { limitBytes: 1_048_576, signal })
 * // => '(self["webpackChunk_N_E"] = …'
 */
export function nextServedChunkFetcher(
  ownedOrigin: string,
): NextPagesChunkFetcher {
  return async (chunkPath, { limitBytes, signal }) => {
    const segments = chunkPath.split('/')
    // `encodeURIComponent` keeps `.` and `..`, which `new URL` would resolve out of `/_next/` (to `/api/…`), so such a path is refused before any request.
    if (segments.some((segment) => segment === '.' || segment === '..'))
      throw new Error(
        `Declared chunk ${redactNextEntryPath(chunkPath)} has a "." or ".." segment and is not fetched`,
      )
    // Each segment is encoded, so a dynamic route's `[id]` reaches the server as one path segment, and with no dot segment nothing leaves the `/_next/` path.
    const url = new URL(
      `/_next/${segments.map(encodeURIComponent).join('/')}`,
      ownedOrigin,
    )
    const response = await fetch(url, { redirect: 'manual', signal })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(
        `Declared chunk ${redactNextEntryPath(chunkPath)} is absent from the selected build (the server answered status ${response.status})`,
      )
    }
    const text = await readCappedBody(response, limitBytes)
    if (text === undefined)
      throw new Error('Served build text exceeds byte limit')
    return text
  }
}
