import { compareNextRoutePrecedence } from './compareNextRoutePrecedence'
import {
  nextRoutePrecedenceOf,
  type SegmentPrecedence,
} from './nextRoutePrecedenceOf'

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
  let best:
    | { route: string; compiledPath: string; precedence: SegmentPrecedence[] }
    | undefined
  let tied = false
  for (const [route, compiledPath] of Object.entries(pagesManifest)) {
    if (NON_ENTRY_ROUTES.has(route) || !isSafeCompiledPagePath(compiledPath))
      continue
    const precedence = nextRoutePrecedenceOf(route, entryPath)
    if (!precedence) continue
    const order = best
      ? compareNextRoutePrecedence(precedence, best.precedence)
      : -1
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
