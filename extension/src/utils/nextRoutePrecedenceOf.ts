/** Precedence of a route segment's kind at one position, lower first, as Next sorts its routes: static, then `[x]`, then `[...x]`, then `[[...x]]`. */
export const SEGMENT_PRECEDENCE = {
  static: 0,
  dynamic: 1,
  catchAll: 2,
  optionalCatchAll: 3,
} as const

/** One value of {@link SEGMENT_PRECEDENCE}. */
export type SegmentPrecedence =
  (typeof SEGMENT_PRECEDENCE)[keyof typeof SEGMENT_PRECEDENCE]

/**
 * Matches one route against an entry path's segments and reads the precedence of each of its segments, the way Next's router orders routes, so the Pages and App resolvers and the router contest share one matcher.
 * Called by {@link mostSpecificNextRouteOf} for each candidate route of either router and by {@link compareNextRouterMatches} for both sides of a path both routers match; each caller parses the entry path once ({@link nextRequestedSegmentsOf}) and passes the same segments for every route. A catch-all must be the last segment and takes one or more requested segments; an optional catch-all takes zero or more, so it also matches its parent path.
 * @param route - A route in URL form, e.g. `/docs/[...slug]`: a Pages manifest key, or the segments {@link appRouteSegmentsOf} read from an App key.
 * @param requested - The entry path's decoded segments, without query, fragment, empty segments or trailing slash ({@link nextRequestedSegmentsOf}).
 * @returns The precedence of each route segment when the route matches, `undefined` otherwise.
 * @example
 * nextRoutePrecedenceOf('/docs/[...slug]', ['docs', 'a', 'b']) // => [0, 2]
 * nextRoutePrecedenceOf('/[[...slug]]', [])                    // => [3]
 * nextRoutePrecedenceOf('/docs/[...slug]', ['docs'])           // => undefined
 */
export function nextRoutePrecedenceOf(
  route: string,
  requested: readonly string[],
): SegmentPrecedence[] | undefined {
  if (!route.startsWith('/')) return undefined
  const segments = route === '/' ? [] : route.slice(1).split('/')
  const precedence: SegmentPrecedence[] = []
  for (const [index, segment] of segments.entries()) {
    const kind = segmentPrecedenceOf(segment)
    precedence.push(kind)
    if (kind >= SEGMENT_PRECEDENCE.catchAll)
      return isCatchAllMatch(kind, index, segments.length, requested.length)
        ? precedence
        : undefined
    // A static segment matches only its own text; a dynamic one any present segment.
    if (
      index >= requested.length ||
      (kind === SEGMENT_PRECEDENCE.static && segment !== requested[index])
    )
      return undefined
  }
  return segments.length === requested.length ? precedence : undefined
}

/**
 * Names the kind of one route segment by its brackets; called by {@link nextRoutePrecedenceOf}.
 * @param segment - One segment of a route.
 * @returns The segment's precedence.
 * @example
 * segmentPrecedenceOf('[[...slug]]') // => 3
 * segmentPrecedenceOf('posts')       // => 0
 */
function segmentPrecedenceOf(segment: string): SegmentPrecedence {
  if (segment.startsWith('[[...') && segment.endsWith(']]'))
    return SEGMENT_PRECEDENCE.optionalCatchAll
  if (segment.startsWith('[...') && segment.endsWith(']'))
    return SEGMENT_PRECEDENCE.catchAll
  if (segment.startsWith('[') && segment.endsWith(']'))
    return SEGMENT_PRECEDENCE.dynamic
  return SEGMENT_PRECEDENCE.static
}

/**
 * Says whether a catch-all segment at a position ends a matching route; called by {@link nextRoutePrecedenceOf}.
 * @param kind - The segment's precedence, a catch-all or an optional catch-all.
 * @param index - The segment's position in the route.
 * @param routeLength - How many segments the route has; a catch-all elsewhere than last never matches.
 * @param requestedLength - How many requested segments there are.
 * @returns Whether the catch-all is the route's last segment and the remaining requested segments fit it.
 * @example
 * isCatchAllMatch(2, 1, 2, 1) // => false: `[...x]` needs at least one segment
 * isCatchAllMatch(3, 1, 2, 1) // => true: `[[...x]]` also matches its parent
 */
function isCatchAllMatch(
  kind: SegmentPrecedence,
  index: number,
  routeLength: number,
  requestedLength: number,
): boolean {
  if (index !== routeLength - 1) return false
  return kind === SEGMENT_PRECEDENCE.optionalCatchAll || requestedLength > index
}
