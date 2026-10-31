import { appRouteSegmentsOf } from './appRouteSegmentsOf'
import { mostSpecificNextRouteOf } from './mostSpecificNextRouteOf'

/** The App page an entry path resolves to: its App paths manifest key and its generated client reference manifest. */
type NextClientManifest = {
  /** The App paths manifest key, e.g. `/login/page`. */
  key: string
  /** The client reference manifest, workspace-relative, e.g. `.next/dev/server/app/login/page_client-reference-manifest.js`. */
  path: string
}

/**
 * Finds the App page Next serves for an entry path in its generated App paths manifest, and that page's client reference manifest, without evaluating manifests or inventing a source route.
 * Called by {@link readNextRouteManifests} to know whether an App route serves the entry path, and by {@link readDevelopmentBundle} for the App run's page. The route is chosen by Next's segment precedence ({@link mostSpecificNextRouteOf}), the rule {@link resolveNextPagesRoute} applies to Pages routes, so `/a/[y]` beats `/[x]/b` for `/a/b`. Manifest data is untrusted: an entry is kept only for a key with a terminal `/page` ({@link appRouteSegmentsOf}) and a contained `app/…/page.js` value.
 * @param routes - The parsed `app-paths-manifest.json`: keys to compiled page paths.
 * @param entryPath - The configured entry path; its query, fragment and trailing slash are ignored and each segment is percent-decoded.
 * @returns The App page's manifest key and its client reference manifest.
 * @throws When no App page matches the entry path, or two match with equal precedence (a pair Next refuses when it builds).
 * @example
 * resolveNextClientManifest({ '/a/[y]/page': 'app/a/[y]/page.js', '/[x]/b/page': 'app/[x]/b/page.js' }, '/a/b')
 * // => { key: '/a/[y]/page', path: '.next/dev/server/app/a/[y]/page_client-reference-manifest.js' }
 */
export function resolveNextClientManifest(
  routes: Record<string, string>,
  entryPath: string,
): NextClientManifest {
  const pages = Object.entries(routes).flatMap(
    ([key, path]): [string, NextClientManifest][] => {
      const segments = appRouteSegmentsOf(key)
      // A key that names no page, or a value outside app/…/page.js, is never followed.
      if (!segments || !isSafeCompiledAppPagePath(path)) return []
      return [
        [
          `/${segments.join('/')}`,
          {
            key,
            path: `.next/dev/server/${path.slice(0, -'.js'.length)}_client-reference-manifest.js`,
          },
        ],
      ]
    },
  )
  const page = mostSpecificNextRouteOf(pages, entryPath)
  if (!page)
    throw new Error(
      'Selected route has no unique compiled Next page. Check its path and redirects.',
    )
  return page
}

/**
 * Says whether an App paths manifest value is a compiled page Codebook may follow: under `app/`, ending in `/page.js`, without `..` or `.` segments or backslashes. Called by {@link resolveNextClientManifest} for every manifest entry.
 * @param compiledPath - A value of the App paths manifest.
 * @returns Whether the value is safe to keep.
 * @example
 * isSafeCompiledAppPagePath('app/login/page.js')            // => true
 * isSafeCompiledAppPagePath('app/../../elsewhere/page.js')  // => false
 */
function isSafeCompiledAppPagePath(compiledPath: string): boolean {
  return (
    compiledPath.startsWith('app/') &&
    compiledPath.endsWith('/page.js') &&
    !compiledPath.includes('\\') &&
    compiledPath
      .split('/')
      .every((segment) => segment !== '..' && segment !== '.')
  )
}
