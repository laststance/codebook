import { nextRequestedSegmentsOf } from './nextRequestedSegmentsOf'
import { nextRoutePrecedenceOf } from './nextRoutePrecedenceOf'

/**
 * Says whether the browser's main frame shows a page of the entry route, for the unreadable-route rule (D18): the browser's path is matched to the entry route pattern with Next's own precedence rules, so `[id]`, `[...slug]` and `[[...slug]]` follow Next, and a query or fragment never decides.
 * Called by {@link ConfiguredBrowserRun} when a render hit's route cannot be read.
 * @param browserUrl - The main frame's current URL (absolute or a path).
 * @param entryPattern - The entry route's URL pattern ({@link entryRoutePatternOf}).
 * @returns `true` when the URL's path is a path of the pattern; `false` otherwise, also for an unreadable URL.
 * @example
 * isBrowserOnEntryRoute('http://localhost:3000/dashboard/invoices/abc/edit?x=1', '/dashboard/invoices/[id]/edit') // => true
 * isBrowserOnEntryRoute('http://localhost:3000/login', '/dashboard') // => false
 */
export function isBrowserOnEntryRoute(
  browserUrl: string,
  entryPattern: string,
): boolean {
  try {
    return (
      nextRoutePrecedenceOf(
        entryPattern,
        nextRequestedSegmentsOf(
          new URL(browserUrl, 'http://codebook.invalid').pathname,
        ),
      ) !== undefined
    )
  } catch {
    // A URL or a percent-encoding that does not parse is not the entry page.
    return false
  }
}
