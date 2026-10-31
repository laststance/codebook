/** One entry of Next's Pages manifest (`.next/dev/server/pages-manifest.json`) that serves an entry path. */
export type NextPagesRoute = {
  /** The manifest key, e.g. `/posts/[id]`. */
  route: string
  /** The manifest value, the compiled page, e.g. `pages/posts/[id].js`. */
  compiledPath: string
}

/** What {@link resolveNextPagesRoute} found for an entry path in Next's Pages manifest. */
export type NextPagesRouteResolution =
  ({ kind: 'matched' } & NextPagesRoute) | { kind: 'unmatched' }

/** Precedence of a route segment's kind at one position, lower first, as Next sorts its routes: static, then `[x]`, then `[...x]`, then `[[...x]]`. */
const SEGMENT_PRECEDENCE = {
  static: 0,
  dynamic: 1,
  catchAll: 2,
  optionalCatchAll: 3,
} as const

type SegmentPrecedence =
  (typeof SEGMENT_PRECEDENCE)[keyof typeof SEGMENT_PRECEDENCE]

/** Manifest keys Next lists for its own documents and error pages, which a browser never enters as a page. */
const NON_ENTRY_ROUTES: ReadonlySet<string> = new Set([
  '/_app',
  '/_document',
  '/_error',
  '/404',
  '/500',
])

/**
 * Resolves an entry path against Next's Pages manifest the way Next's router does: per segment, deciding at the first differing segment (static before `[x]` before `[...x]` before `[[...x]]`).
 * Called by {@link readNextRouteManifests} on each read of the Pages manifest while it waits for the route after the readiness GET. Unlike {@link resolveNextClientManifest}'s additive score, a static segment wins wherever it differs, so `/a/[y]` beats `/[x]/b` for `/a/b`.
 * @param pagesManifest - The parsed `pages-manifest.json`: route keys to compiled page paths. Untrusted: a value is kept only when it is a safe `pages/….js` path.
 * @param entryPath - The configured entry path; its query, fragment and trailing slash are ignored and each segment is percent-decoded.
 * @returns
 * - `matched` with the manifest key and its compiled path for the one route of highest precedence
 * - `unmatched` when no entry route matches, or when two match with equal precedence (Next refuses such a pair when it builds, so the manifest cannot choose)
 * @example
 * resolveNextPagesRoute({ '/a/[y]': 'pages/a/[y].js', '/[x]/b': 'pages/[x]/b.js' }, '/a/b')
 * // => { kind: 'matched', route: '/a/[y]', compiledPath: 'pages/a/[y].js' }
 * resolveNextPagesRoute({ '/_app': 'pages/_app.js' }, '/_app') // => { kind: 'unmatched' }
 */
export function resolveNextPagesRoute(
  pagesManifest: Readonly<Record<string, string>>,
  entryPath: string,
): NextPagesRouteResolution {
  const requested = requestedSegmentsOf(entryPath)
  let best:
    | { route: string; compiledPath: string; precedence: SegmentPrecedence[] }
    | undefined
  let tied = false
  for (const [route, compiledPath] of Object.entries(pagesManifest)) {
    if (NON_ENTRY_ROUTES.has(route) || !isSafeCompiledPagePath(compiledPath))
      continue
    const precedence = matchedPrecedenceOf(route, requested)
    if (!precedence) continue
    const order = best ? comparePrecedence(precedence, best.precedence) : -1
    // A better route replaces the best and clears an earlier tie; an equal one leaves the choice open.
    if (order < 0) {
      best = { route, compiledPath, precedence }
      tied = false
    } else if (order === 0) tied = true
  }
  if (!best || tied) return { kind: 'unmatched' }
  return { kind: 'matched', route: best.route, compiledPath: best.compiledPath }
}

/**
 * Splits an entry path into the decoded path segments a route is matched against; called by {@link resolveNextPagesRoute} and {@link compareNextRouterMatches}.
 * @param entryPath - The configured entry path.
 * @returns The segments without query, fragment, empty segments or trailing slash; `/` has none.
 * @example
 * requestedSegmentsOf('/posts/caf%C3%A9/?tab=1') // => ['posts', 'café']
 */
function requestedSegmentsOf(entryPath: string): string[] {
  return new URL(entryPath, 'http://codebook.invalid').pathname
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
}

/**
 * Says whether a manifest value is a compiled page path Codebook may follow: under `pages/`, a `.js` file, without `..` or `.` segments or backslashes. Called by {@link resolveNextPagesRoute} for every manifest entry.
 * @param compiledPath - A value of the Pages manifest.
 * @returns Whether the value is safe to keep.
 * @example
 * isSafeCompiledPagePath('pages/index.js')       // => true
 * isSafeCompiledPagePath('pages/../../secret.js') // => false
 */
function isSafeCompiledPagePath(compiledPath: string): boolean {
  return (
    compiledPath.startsWith('pages/') &&
    compiledPath.endsWith('.js') &&
    !compiledPath.includes('\\') &&
    compiledPath
      .split('/')
      .every((segment) => segment !== '..' && segment !== '.')
  )
}

/**
 * Names the kind of one route segment by its brackets; called by {@link matchedPrecedenceOf}.
 * @param segment - One segment of a manifest key.
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
 * Matches one manifest key against the requested segments and reads the precedence of each of its segments; called by {@link resolveNextPagesRoute} and {@link compareNextRouterMatches}.
 * A catch-all must be the last segment and takes one or more requested segments; an optional catch-all takes zero or more, so it also matches its parent path.
 * @param route - A manifest key, e.g. `/docs/[...slug]`.
 * @param requested - The decoded requested segments.
 * @returns The precedence of each route segment when the route matches, `undefined` otherwise.
 * @example
 * matchedPrecedenceOf('/docs/[...slug]', ['docs', 'a', 'b']) // => [0, 2]
 * matchedPrecedenceOf('/[[...slug]]', [])                    // => [3]
 * matchedPrecedenceOf('/docs/[...slug]', ['docs'])           // => undefined
 */
function matchedPrecedenceOf(
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
 * Says whether a catch-all segment at a position ends a matching route; called by {@link matchedPrecedenceOf}.
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

/**
 * Orders an App route and a Pages route that both match an entry path by Next's segment precedence, so a project with both routers is refused as conflicting only when the two are equally specific; called by {@link readNextRouteManifests}.
 * Route groups (`(marketing)`) name no URL segment and are dropped from the App key, as Next drops them.
 * @param appKey - The App manifest key, e.g. `/about/page` or `/(site)/about/page`.
 * @param pagesRoute - The Pages manifest key, e.g. `/[...slug]`.
 * @param entryPath - The entry path both routes match.
 * @returns
 * - `'app'` when the App route is more specific
 * - `'pages'` when the Pages route is more specific
 * - `'equal'` when neither is, the pair Next refuses as a conflict
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
  const requested = requestedSegmentsOf(entryPath)
  const appSegments = appKey
    .slice(0, -'/page'.length)
    .split('/')
    .filter(
      (segment) =>
        segment && !(segment.startsWith('(') && segment.endsWith(')')),
    )
  const appPrecedence = matchedPrecedenceOf(
    `/${appSegments.join('/')}`,
    requested,
  )
  const pagesPrecedence = matchedPrecedenceOf(pagesRoute, requested)
  // A side the shared matcher cannot read keeps the pair a conflict, as before.
  if (!appPrecedence || !pagesPrecedence) return 'equal'
  const order = comparePrecedence(appPrecedence, pagesPrecedence)
  if (order < 0) return 'app'
  return order > 0 ? 'pages' : 'equal'
}

/**
 * Orders two matching routes by their segments' precedence, deciding at the first position where they differ; called by {@link resolveNextPagesRoute} and {@link compareNextRouterMatches}.
 * A route that has run out of segments ranks as an optional catch-all there: two matching routes can differ in length only by a trailing `[[...x]]`, a pair Next refuses as equally specific.
 * @param left - Precedence of the first route's segments.
 * @param right - Precedence of the second route's segments.
 * @returns A negative number when `left` wins, a positive one when `right` wins, `0` when they are equal.
 * @example
 * comparePrecedence([0, 1], [1, 0]) // => -1: `/a/[y]` wins over `/[x]/b`
 * comparePrecedence([], [3])        // => 0: `/` and `/[[...slug]]`
 */
function comparePrecedence(
  left: readonly SegmentPrecedence[],
  right: readonly SegmentPrecedence[],
): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference =
      (left[index] ?? SEGMENT_PRECEDENCE.optionalCatchAll) -
      (right[index] ?? SEGMENT_PRECEDENCE.optionalCatchAll)
    if (difference) return difference
  }
  return 0
}
