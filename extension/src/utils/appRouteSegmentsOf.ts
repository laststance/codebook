/** The terminal segment of an App paths manifest key that names a page. */
const PAGE_KEY_SUFFIX = '/page'

/**
 * Reads the URL segments an App paths manifest key names, so App route matching and the router contest read a key the same way.
 * Called by {@link resolveNextClientManifest} for every App key and by {@link compareNextRouterMatches} for the App side of a path both routers match. Only a key ending in `/page` names a page, and only that terminal `/page` is cut; route groups (`(shop)`) name no URL segment and are dropped, as Next drops them; every other segment (a parallel `@slot` too) is kept as it is.
 * @param key - An App paths manifest key, e.g. `/(shop)/cart/[id]/page`.
 * @returns
 * - the URL segments, e.g. `['cart', '[id]']`; the root key `/page` gives none (the path `/`)
 * - `undefined` for a key without a terminal `/page`, such as a route handler's `/api/hello/route`
 * @example
 * appRouteSegmentsOf('/(shop)/cart/[id]/page') // => ['cart', '[id]']
 * appRouteSegmentsOf('/page')                   // => []
 * appRouteSegmentsOf('/api/hello/route')        // => undefined
 */
export function appRouteSegmentsOf(key: string): string[] | undefined {
  if (!key.endsWith(PAGE_KEY_SUFFIX)) return undefined
  return key
    .slice(0, -PAGE_KEY_SUFFIX.length)
    .split('/')
    .filter(
      (segment) =>
        segment && !(segment.startsWith('(') && segment.endsWith(')')),
    )
}
