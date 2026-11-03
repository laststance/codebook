import { NEXT_PAGES_SOURCE_EXTENSIONS } from '../constants'

/** Matches the address webpack gives a module of the Pages server compile: an optional `webpack-internal:///`, the layer `(pages-dir-node)`, `./`, then the module path; an optional query is cut. */
const PAGES_MODULE_URL =
  /^(?:webpack-internal:\/\/\/)?\(pages-dir-node\)\/\.\/([^?#]+)(?:[?#].*)?$/

/** Matches a module path that sits in the pages folder (`pages/…` or `src/pages/…`) and keeps the part under it. */
const PAGES_FOLDER_PATH = /^(?:src\/)?pages\/(.+)$/

/** Matches a route whose first segment is `index`; Next puts one more `/index` before such a route (`normalizePagePath`). */
const ROUTE_STARTING_WITH_INDEX = /^\/index(?:\/|$)/

/** Matches a route with a segment that is one `[param]` (`isDynamicRoute`); Next leaves such a route without the extra `/index`. */
const ROUTE_WITH_DYNAMIC_SEGMENT = /\/\[[^/]+\](?=\/|$)/

/**
 * Names the compiled page (`pages/index.js`) that a script address of the Pages server compile stands for, or nothing when the script is no module of the pages folder.
 *
 * Why it exists: a frame inside the data function sits in the page's own module (`webpack-internal:///(pages-dir-node)/./pages/index.tsx`) while Next's `pages-manifest.json` lists the compiled page (`pages/index.js`), so the page of a hit is read by moving from one to the other. Called by {@link readPagesRenderedPage} for the frames inside the data-function call frame.
 * The move is Next's own page naming: the file's route drops a trailing `/index` (`pages/products/index.tsx` is the page `/products`), then the compiled path is the route's bundle path (the root is `index`, the page `/index` is `index/index`, a static route under `index/` gets one more `index/`).
 * @param url - A script address of a frame; `''` when the script was never announced.
 * @returns `pages/<route>.js` for a module under `pages/` or `src/pages/` of the `(pages-dir-node)` layer, its extension (`tsx`, `ts`, `jsx`, `js`) read as `.js`; `undefined` for another layer, for `node_modules`, for a library of the project and for an empty address.
 * @example
 * pagesCompiledPathOfModuleUrl('webpack-internal:///(pages-dir-node)/./src/pages/products/[id].tsx') // => 'pages/products/[id].js'
 * pagesCompiledPathOfModuleUrl('webpack-internal:///(pages-dir-node)/./pages/products/index.tsx')    // => 'pages/products.js'
 * pagesCompiledPathOfModuleUrl('(pages-dir-node)/./pages/index.js')                                  // => 'pages/index.js'
 * pagesCompiledPathOfModuleUrl('(pages-dir-node)/./lib/stats.js')                                    // => undefined
 */
export function pagesCompiledPathOfModuleUrl(url: string): string | undefined {
  const modulePath = PAGES_MODULE_URL.exec(url)?.[1]
  const pagePath = modulePath && PAGES_FOLDER_PATH.exec(modulePath)?.[1]
  if (!pagePath) return undefined
  const extension = NEXT_PAGES_SOURCE_EXTENSIONS.find((candidate) =>
    pagePath.endsWith(`.${candidate}`),
  )
  if (!extension) return undefined
  const pageStem = pagePath.slice(0, -(extension.length + 1))
  return `pages${bundlePathOfRoute(routeOfPagePath(pageStem))}.js`
}

/** Reads the route of a page file (Next's `getPageFromPath`): a trailing `/index` is dropped and the folder's own path is left, `/` for the root. */
function routeOfPagePath(pageStem: string): string {
  const route = `/${pageStem}`
  const withoutIndex = route.endsWith('/index')
    ? route.slice(0, -'/index'.length)
    : route
  return withoutIndex === '' ? '/' : withoutIndex
}

/** Reads the bundle path of a route (Next's `normalizePagePath`): the root is `/index`, and a static route that starts with `/index` gets one more `/index` before it. */
function bundlePathOfRoute(route: string): string {
  if (
    ROUTE_STARTING_WITH_INDEX.test(route) &&
    !ROUTE_WITH_DYNAMIC_SEGMENT.test(route)
  )
    return `/index${route}`
  return route === '/' ? '/index' : route
}
