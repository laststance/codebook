/** The folders under the package root that hold an App Router tree. */
const APP_ROOTS = ['app/', 'src/app/'] as const
/** The file names of a route handler file. */
const ROUTE_FILE = /^route\.(?:ts|js|tsx|jsx)$/

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
  if (!ROUTE_FILE.test(file) || segments.includes('node_modules'))
    return undefined
  // A route group `(name)` is no part of the URL.
  const kept = segments.filter(
    (segment) => !(segment.startsWith('(') && segment.endsWith(')')),
  )
  return { route: `/${kept.join('/')}` }
}
