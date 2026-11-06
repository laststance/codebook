import { NEXT_PAGES_SOURCE_EXTENSIONS } from '../constants'

/**
 * Gives the route pattern of a Next Pages API route file, or `undefined` when the file is none.
 *
 * Why it exists: a Pages API route stop is recognised from its file path alone, before any process starts, and the pause names the pattern (`/api/users/[id]`). Called by {@link ConfiguredBrowserRun} for the lexical collection of API-route stops and for the hit classification, beside {@link routeHandlerRouteOf} for the App Router's route handlers.
 * Pages has no route groups or private folders, so only the file name rules apply: `index` is the folder itself, and `[id]`, `[...slug]` and `[[...slug]]` stay in the pattern.
 * @param packageRelative - The stop file's path relative to the Next app's package root, with `/` separators.
 * @param pagesFolder - The app's Pages folder relative to the package root (`pages` or `src/pages`).
 * @returns
 * - `{ route }` with a leading `/` for `<pages>/api.<ext>` and every file under `<pages>/api/` with one of the four default extensions
 * - `undefined` for a file outside `<pages>/api`, a file with another extension, and a path inside a `node_modules` folder
 * @example
 * pagesApiRouteOf('src/pages/api/data.ts', 'src/pages') // => { route: '/api/data' }
 * pagesApiRouteOf('pages/api/users/[id].js', 'pages') // => { route: '/api/users/[id]' }
 * pagesApiRouteOf('src/pages/api/index.tsx', 'src/pages') // => { route: '/api' }
 * pagesApiRouteOf('src/pages/index.tsx', 'src/pages') // => undefined
 */
export function pagesApiRouteOf(
  packageRelative: string,
  pagesFolder: string,
): { route: string } | undefined {
  const prefix = `${pagesFolder}/`
  if (!packageRelative.startsWith(prefix)) return undefined
  const segments = packageRelative.slice(prefix.length).split('/')
  const file = segments.pop() ?? ''
  const dot = file.lastIndexOf('.')
  const extension = dot < 0 ? '' : file.slice(dot + 1)
  const stem = dot < 0 ? file : file.slice(0, dot)
  if (
    !(NEXT_PAGES_SOURCE_EXTENSIONS as readonly string[]).includes(extension) ||
    segments.includes('node_modules')
  )
    return undefined
  // `api.<ext>` directly under the Pages folder is `/api`; everything else must sit under `api/`.
  const folders = [...segments, stem]
  if (folders[0] !== 'api') return undefined
  // `index` is the folder itself.
  if (folders.length > 1 && folders.at(-1) === 'index') folders.pop()
  return { route: `/${folders.join('/')}` }
}
