import { appRouteSegmentsOf } from './appRouteSegmentsOf'

/**
 * Converts the App paths manifest key the run resolved for the entry into the URL pattern Next's work store reports as `route`.
 *
 * Why it exists: the work store holds the route in URL form without route groups (`/dashboard`, `/dashboard/invoices/[id]/edit`), while the manifest key is `/dashboard/(overview)/page`; the entry-route check compares the two in one form. {@link appRouteSegmentsOf} reads manifest keys only, so the store value is never passed to it. Called by {@link ConfiguredBrowserRun} once the entry route is resolved.
 * @param manifestKey - An App paths manifest key such as `/dashboard/(overview)/page`.
 * @returns The URL pattern (`/dashboard`), `/` for the root page, `undefined` for a key that names no page.
 * @example
 * entryRoutePatternOf('/dashboard/(overview)/page') // => '/dashboard'
 * entryRoutePatternOf('/page') // => '/'
 * entryRoutePatternOf('/api/hello/route') // => undefined
 */
export function entryRoutePatternOf(manifestKey: string): string | undefined {
  const segments = appRouteSegmentsOf(manifestKey)
  return segments === undefined ? undefined : `/${segments.join('/')}`
}
