import {
  REACT_SCRIPTS_BUNDLE_PATH,
  REACT_SCRIPTS_ENTRY_LIMIT_BYTES,
} from '../constants'

import { readCappedBody } from './readCappedBody'

/** The `src` of each `<script>` tag of an HTML text. */
const SCRIPT_SOURCE = /<script\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi

/**
 * Reads the entry page of the owned react-scripts server at its public path and returns the address of the development bundle its `<script src>` names.
 *
 * Why it exists: a `homepage` or `PUBLIC_URL` moves the bundle (`/app/static/js/bundle.js`), so the address comes from the page the server serves, not from a constant. Called by {@link readReactScriptsServedBundle}.
 * A redirect is "not ready yet" (it is never followed), the body is read capped, and only a script on the owned origin counts.
 * @param origin - The owned origin, `http://127.0.0.1:<port>`.
 * @param publicPath - The public path the app is served at (`/` or `/app/`).
 * @param signal - Ends the read when the run is cancelled.
 * @param timeoutMs - The most the request may take.
 * @returns The bundle's absolute address, or `undefined` for a failed request, a redirect, a non-success status, an unreadable page or a page that names no bundle.
 * @example await findReactScriptsBundleUrl('http://127.0.0.1:3000', '/app/', signal, 15_000) // => 'http://127.0.0.1:3000/app/static/js/bundle.js'
 */
export async function findReactScriptsBundleUrl(
  origin: string,
  publicPath: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string | undefined> {
  const entryUrl = new URL(publicPath, origin)
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
    for (const [, source] of html.matchAll(SCRIPT_SOURCE)) {
      const candidate = new URL(source!, entryUrl)
      if (
        candidate.origin === entryUrl.origin &&
        candidate.pathname.endsWith(REACT_SCRIPTS_BUNDLE_PATH)
      )
        return candidate.href
    }
    return undefined
  } catch {
    // A cancelled run stays cancelled; any other failure means the server is not serving yet.
    signal.throwIfAborted()
    return undefined
  }
}
