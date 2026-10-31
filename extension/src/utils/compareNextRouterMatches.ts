import { appRouteSegmentsOf } from './appRouteSegmentsOf'
import { compareNextRoutePrecedence } from './compareNextRoutePrecedence'
import { nextRoutePrecedenceOf } from './nextRoutePrecedenceOf'

/**
 * Orders an App route and a Pages route that both match an entry path by Next's segment precedence, so a project with both routers is refused as conflicting only when the two are equally specific; called by {@link readNextRouteManifests}.
 * The App key is read by {@link appRouteSegmentsOf}: only a key with a terminal `/page` names a page, and route groups (`(marketing)`) are dropped, as Next drops them.
 * @param appKey - The App manifest key, e.g. `/about/page` or `/(site)/about/page`.
 * @param pagesRoute - The Pages manifest key, e.g. `/[...slug]`.
 * @param entryPath - The entry path both routes match.
 * @returns
 * - `'app'` when the App route is more specific
 * - `'pages'` when the Pages route is more specific
 * - `'equal'` when neither is, the pair Next refuses as a conflict; also when a side cannot be read (an App key without `/page`) or does not match
 * @example
 * compareNextRouterMatches('/about/page', '/[...slug]', '/about') // => 'app'
 * compareNextRouterMatches('/[slug]/page', '/about', '/about')    // => 'pages'
 * compareNextRouterMatches('/about/page', '/about', '/about')     // => 'equal'
 */
export function compareNextRouterMatches(
  appKey: string,
  pagesRoute: string,
  entryPath: string,
): 'app' | 'pages' | 'equal' {
  const appSegments = appRouteSegmentsOf(appKey)
  const appPrecedence =
    appSegments && nextRoutePrecedenceOf(`/${appSegments.join('/')}`, entryPath)
  const pagesPrecedence = nextRoutePrecedenceOf(pagesRoute, entryPath)
  // A side the shared matcher cannot read keeps the pair a conflict, as before.
  if (!appPrecedence || !pagesPrecedence) return 'equal'
  const order = compareNextRoutePrecedence(appPrecedence, pagesPrecedence)
  if (order < 0) return 'app'
  return order > 0 ? 'pages' : 'equal'
}
