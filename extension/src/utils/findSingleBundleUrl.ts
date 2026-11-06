import { REACT_SCRIPTS_ENTRY_LIMIT_BYTES } from '../constants'
import type { SingleBundleProfile } from '../singleBundleProfile'

import { readCappedBody } from './readCappedBody'

/** The `src` of each `<script>` tag of an HTML text. */
const SCRIPT_SOURCE = /<script\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi

/**
 * Yields each `<script src>` of an HTML text that lies on the entry page's origin, resolved against the page, in document order.
 * Lazy on purpose: a malformed address throws only when the consumer reaches it, as the react-scripts scan always did.
 * @param html - The entry page.
 * @param entryUrl - The address the page was read at.
 * @returns A generator of same-origin script addresses.
 * @example [...ownOriginScripts('<script src="/a.js"></script>', new URL('http://h:1/'))].map(String) // => ['http://h:1/a.js']
 */
function* ownOriginScripts(html: string, entryUrl: URL): Generator<URL> {
  for (const [, source] of html.matchAll(SCRIPT_SOURCE)) {
    const candidate = new URL(source!, entryUrl)
    if (candidate.origin === entryUrl.origin) yield candidate
  }
}

/**
 * Reads the entry page of the owned dev server at its entry path and returns the address of the development bundle the profile picks from its `<script src>` tags.
 *
 * Why it exists: a `homepage` or `PUBLIC_URL` moves react-scripts' bundle and Metro puts its query in the bundle's address, so the address comes from the page the server serves, not from a constant. Called by {@link readSingleServedBundle}.
 * A redirect is "not ready yet" (it is never followed), the body is read capped, and only a script on the owned origin counts.
 * @param origin - The owned origin, `http://127.0.0.1:<port>`.
 * @param entryPath - The path the entry page is served at (`/` or `/app/`).
 * @param profile - The adapter's profile; its `selectBundleScript` picks the bundle.
 * @param signal - Ends the read when the run is cancelled.
 * @param timeoutMs - The most the request may take.
 * @returns The bundle's absolute address, or `undefined` for a failed request, a redirect, a non-success status, an unreadable page or a page whose scripts the profile does not accept.
 * @example await findSingleBundleUrl('http://127.0.0.1:3000', '/app/', REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE, signal, 15_000) // => 'http://127.0.0.1:3000/app/static/js/bundle.js'
 */
export async function findSingleBundleUrl(
  origin: string,
  entryPath: string,
  profile: SingleBundleProfile,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string | undefined> {
  const entryUrl = new URL(entryPath, origin)
  try {
    const response = await fetch(entryUrl, {
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return undefined
    }
    const html = await readCappedBody(response, REACT_SCRIPTS_ENTRY_LIMIT_BYTES)
    if (html === undefined) return undefined
    return profile.selectBundleScript(ownOriginScripts(html, entryUrl))?.href
  } catch {
    // A cancelled run stays cancelled; any other failure means the server is not serving yet.
    signal.throwIfAborted()
    return undefined
  }
}
