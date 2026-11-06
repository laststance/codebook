import {
  HTTP_REDIRECT_STATUS_END,
  REACT_SCRIPTS_ENTRY_LIMIT_BYTES,
  SINGLE_BUNDLE_ERROR_BODY_LIMIT_BYTES,
} from '../constants'
import type { SingleBundleProfile } from '../singleBundleProfile'

import { fetchOwnedServer } from './fetchOwnedServer'
import { readCappedBody } from './readCappedBody'
import { readErrorBodyHead } from './readErrorBodyHead'

/** The `src` of each `<script>` tag of an HTML text. */
const SCRIPT_SOURCE = /<script\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi

/**
 * Yields each `<script src>` of an HTML text that lies on the entry page's origin, resolved against the page, in document order.
 * A malformed address is skipped, not thrown.
 * @param html - The entry page.
 * @param entryUrl - The address the page was read at.
 * @returns A generator of same-origin script addresses.
 * @example [...ownOriginScripts('<script src="/a.js"></script>', new URL('http://h:1/'))].map(String) // => ['http://h:1/a.js']
 */
function* ownOriginScripts(html: string, entryUrl: URL): Generator<URL> {
  for (const [, source] of html.matchAll(SCRIPT_SOURCE)) {
    // A `src` that is no URL against the page is not a usable script: skipped, so it never counts as a bundle.
    const candidate = URL.parse(source!, entryUrl)
    if (candidate !== null && candidate.origin === entryUrl.origin)
      yield candidate
  }
}

/** What reading the entry page found: the bundle's address, nothing usable yet (poll again), the server's own error answer, or a page that does not name exactly one bundle (only for a profile that opts in). */
export type SingleBundleEntryResult =
  | { kind: 'found'; url: string }
  | { kind: 'pending' }
  | { kind: 'failed'; status: number; body: string | undefined }
  | { kind: 'unclear'; count: number }

/**
 * Reads the entry page of the owned dev server at its entry path and returns the address of the development bundle the profile picks from its `<script src>` tags.
 *
 * Why it exists: a `homepage` or `PUBLIC_URL` moves react-scripts' bundle and Metro puts its query in the bundle's address, so the address comes from the page the server serves, not from a constant. Called by {@link readSingleServedBundle}.
 * A redirect is "not ready yet" (it is never followed), the body is read capped, and only a script on the owned origin counts. A profile that opts in (`quoteErrorBody`, `unclearEntryPage`) gets the server's error answer and a page with zero or several bundles as their own results instead of "not ready yet".
 * @param origin - The owned origin, `http://127.0.0.1:<port>`.
 * @param entryPath - The path the entry page is served at (`/` or `/app/`).
 * @param profile - The adapter's profile; its `selectBundleScript` picks the bundle.
 * @param signal - Ends the read when the run is cancelled.
 * @param timeoutMs - The most the request may take.
 * @returns `found` with the bundle's absolute address; `failed` for an error status (4xx or 5xx) of a quoting profile; `unclear` for a page naming zero or several bundles under a profile that opts in; otherwise `pending` (failed request, redirect, any status for a profile that does not quote, unreadable page, unaccepted scripts).
 * @example await findSingleBundleUrl('http://127.0.0.1:3000', '/app/', REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE, signal, 15_000) // => { kind: 'found', url: 'http://127.0.0.1:3000/app/static/js/bundle.js' }
 */
export async function findSingleBundleUrl(
  origin: string,
  entryPath: string,
  profile: SingleBundleProfile,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<SingleBundleEntryResult> {
  const entryUrl = new URL(entryPath, origin)
  try {
    const response = await fetchOwnedServer(
      entryUrl,
      profile.requestHostOf?.(origin),
      AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    )
    if (!response.ok) {
      // Only a profile that quotes the server's error reads its body; the others cancel it unread.
      // A redirect (never followed) is "not ready yet" for every profile; only an error status is the server's error answer.
      if (
        profile.quoteErrorBody !== true ||
        response.status < HTTP_REDIRECT_STATUS_END
      ) {
        await response.body?.cancel()
        return { kind: 'pending' }
      }
      const body = await readErrorBodyHead(
        response,
        SINGLE_BUNDLE_ERROR_BODY_LIMIT_BYTES,
      )
      return { kind: 'failed', status: response.status, body }
    }
    const html = await readCappedBody(response, REACT_SCRIPTS_ENTRY_LIMIT_BYTES)
    if (html === undefined) return { kind: 'pending' }
    const url = profile.selectBundleScript(
      ownOriginScripts(html, entryUrl),
    )?.href
    if (url !== undefined) return { kind: 'found', url }
    const count = profile.unclearEntryPage?.count(
      ownOriginScripts(html, entryUrl),
    )
    return count === undefined
      ? { kind: 'pending' }
      : { kind: 'unclear', count }
  } catch {
    // A cancelled run stays cancelled; any other failure means the server is not serving yet.
    signal.throwIfAborted()
    return { kind: 'pending' }
  }
}
