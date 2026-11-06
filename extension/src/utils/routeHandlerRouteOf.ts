/** The folders under the package root that hold an App Router tree. */
const APP_ROOTS = ['app/', 'src/app/'] as const
import { ROUTE_HANDLER_FILE_NAME } from '../constants'

/**
 * Gives the route pattern of an App Router route handler file, or `undefined` when the file is none.
 *
 * Why it exists: a route-handler stop is recognised from its file path alone, before any process starts, and the pause names the pattern (`/api/boards/[id]`). Called by {@link ConfiguredBrowserRun} for the lexical refusals, the arming and the hit classification.
 * @param packageRelativePath - The stop file's path relative to the Next app's package root, with `/` separators.
 * @returns `{ route }` with route groups removed, dynamic segments kept and a leading `/`; `undefined` for a file that is not `route.ts|js|tsx|jsx` directly under `app/` or `src/app/` (a Pages folder, `lib/route.ts` and `node_modules` included).
 * @example
 * routeHandlerRouteOf('app/api/todos/route.ts') // => { route: '/api/todos' }
 * routeHandlerRouteOf('src/app/(shop)/api/boards/[id]/route.js') // => { route: '/api/boards/[id]' }
 * routeHandlerRouteOf('src/pages/api/hello.ts') // => undefined
 */
export function routeHandlerRouteOf(
  packageRelativePath: string,
): { route: string } | undefined {
  const root = APP_ROOTS.find((candidate) =>
    packageRelativePath.startsWith(candidate),
  )
  if (!root) return undefined
  const segments = packageRelativePath.slice(root.length).split('/')
  const file = segments.pop() ?? ''
  // A node_modules folder inside the app tree is no app source.
  if (!ROUTE_HANDLER_FILE_NAME.test(file) || segments.includes('node_modules'))
    return undefined
  // A route group `(name)` is no part of the URL.
  // A private folder `_name` is not routed by Next, so its route file is no route handler.
  if (segments.some((segment) => segment.startsWith('_'))) return undefined
  const kept = segments.filter(
    (segment) => !(segment.startsWith('(') && segment.endsWith(')')),
  )
  return { route: `/${kept.join('/')}` }
}

/**
 * Tells whether a path holds a route file under an App Router tree, wherever the tree sits in the path.
 *
 * Why it exists: a route file inside a workspace library or a node_modules package is refused as not the app's own source, but a helper named `route.ts` there (`packages/router/src/route.ts`) is no route handler and must keep its ordinary library stop path. Called by {@link ConfiguredBrowserRun} before it refuses such a stop.
 * @param path - A workspace-relative path with `/` separators.
 * @returns `true` when some suffix of the path starting at an `app/` folder is a route file by {@link routeHandlerRouteOf}'s rule.
 * @example
 * isRouteFileInAppTree('node_modules/pkg/app/api/x/route.ts') // => true
 * isRouteFileInAppTree('packages/router/src/route.ts') // => false
 */
export function isRouteFileInAppTree(path: string): boolean {
  const segments = path.split('/')
  // A suffix starting at `app` covers `src/app` as well.
  return segments.some(
    (segment, index) =>
      segment === 'app' &&
      routeHandlerRouteOf(segments.slice(index).join('/')) !== undefined,
  )
}
