import { STATIC_PAGE_READINESS_POLL_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { readStaticPageHtml } from './readStaticPageHtml'

/**
 * Asks whether the served entry page answers HTML and every same-origin script it names answers JavaScript, once.
 * Called by {@link awaitStaticPageReady} on each poll.
 * @param entryUrl - The address of the entry page on the owned origin.
 * @param signal - Ends the requests when the run is cancelled.
 * @returns `true` when the page and all its same-origin scripts are served as such.
 * @example await isStaticPageServed('http://127.0.0.1:4310/', signal) // => true
 */
async function isStaticPageServed(
  entryUrl: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const page = await fetch(entryUrl, { redirect: 'manual', signal })
    if (
      page.status !== 200 ||
      !(page.headers.get('content-type') ?? '').includes('text/html')
    ) {
      await page.body?.cancel()
      return false
    }
    const { scriptSources } = readStaticPageHtml(await page.text())
    const origin = new URL(entryUrl).origin
    for (const source of scriptSources) {
      const url = new URL(source, entryUrl)
      // A script on another origin is the page's own business, not the server's.
      if (url.origin !== origin) continue
      const script = await fetch(url, { redirect: 'manual', signal })
      await script.body?.cancel()
      if (
        script.status !== 200 ||
        !/javascript|ecmascript/i.test(script.headers.get('content-type') ?? '')
      )
        return false
    }
    return true
  } catch {
    // A refused connection or a cancelled request is "not served yet"; the poll's budget ends the wait.
    return false
  }
}

/**
 * Waits until the static server serves the entry page and every same-origin script it names.
 *
 * Why it exists: readiness of a `static-page` run is proven by reading what the page needs, not by the listener alone. Called as the adapter's `waitForServerSettled` before the stops are sealed.
 * @param entryUrl - The address of the entry page on the owned origin.
 * @param timeoutMs - What is left of the preparation budget.
 * @param signal - Ends the wait when the run is cancelled.
 * @throws {@link WaitTimeoutError} when the budget passes first (the run words it as `STATIC_PAGE_SERVER_FAILED`).
 * @example await awaitStaticPageReady('http://127.0.0.1:4310/', 60_000, signal)
 */
export async function awaitStaticPageReady(
  entryUrl: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  await waitUntil(
    () => isStaticPageServed(entryUrl, signal),
    'the static page',
    timeoutMs,
    signal,
    STATIC_PAGE_READINESS_POLL_MS,
  )
}
