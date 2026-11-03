import type { Protocol } from 'devtools-protocol'

import { NEXT_DATA_REQUEST_PATH_PREFIX } from '../constants'

/** A request the browser has sent and not yet received an answer for. */
export type OutstandingPageRequest = {
  url: string
  resourceType: Protocol.Network.ResourceType
}

/** Matches the path of Next's data request for a Pages navigation: `/_next/data/<build id>/<asset path>.json`. */
const DATA_REQUEST_PATH = new RegExp(
  `^${NEXT_DATA_REQUEST_PATH_PREFIX}[^/]+/(.+)\\.json$`,
)

/** The segment that Next puts in front of the data path of the root and of every route that is or starts with `/index`. */
const INDEX_SEGMENT = 'index'

/**
 * Gives the page route a data request path (without its `.json`) stands for, by undoing Next's `getAssetPathFromRoute`.
 *
 * Next builds the data path with `getAssetPathFromRoute` (`next/dist/shared/lib/router/utils/get-asset-path-from-route.js`): the route `/` becomes `/index`, a route that is `/index` or starts with `/index/` gets one more `/index` in front, any other route is kept. So `/` is `index`, `/index` is `index/index`, `/index/foo` is `index/index/foo` and `/products/1` is `products/1`. Called by {@link pagesRequestPathOf} for a data request.
 * @param assetPath - The data path between the build id and `.json`, with no leading slash.
 * @returns The route: `/` for `index`, the path without its first `index` segment when it starts with `index/`, else the path with a leading slash.
 * @example
 * routeOfDataAssetPath('index') // => '/'
 * routeOfDataAssetPath('index/index/foo') // => '/index/foo'
 * routeOfDataAssetPath('products/1') // => '/products/1'
 */
function routeOfDataAssetPath(assetPath: string): string {
  if (assetPath === INDEX_SEGMENT) return '/'
  // The extra leading `index` segment is Next's, so one segment is dropped, never more.
  if (assetPath.startsWith(`${INDEX_SEGMENT}/`))
    return assetPath.slice(INDEX_SEGMENT.length)
  return `/${assetPath}`
}

/**
 * Gives the page path a request asks for when it is a page request, the document or Next's data request of a navigation, and nothing for any other request.
 *
 * Why it exists: when the stack of a hit names no page, the browser's one outstanding page request says which page the browser waits for, which backs or contradicts a page-module frame, but images, scripts and API calls must not count as page requests. Called by {@link readPagesRenderedPage} for each outstanding request.
 * @param request - An outstanding request: its URL and its resource type.
 * @returns The path of a document request (`/products/1`); the route a data request stands for, with Next's extra `index` segment taken off (`/_next/data/b1/products/1.json` is `/products/1`, `…/index.json` is `/`, `…/index/index.json` is `/index`, `…/index/index/foo.json` is `/index/foo`); `undefined` for every other request and for a URL that does not parse.
 * @example
 * pagesRequestPathOf({ url: 'http://localhost:3000/products/1?x=1', resourceType: 'Document' }) // => '/products/1'
 * pagesRequestPathOf({ url: 'http://localhost:3000/_next/data/b1/index.json?page=2', resourceType: 'Fetch' }) // => '/'
 * pagesRequestPathOf({ url: 'http://localhost:3000/_next/data/b1/index/index/foo.json', resourceType: 'Fetch' }) // => '/index/foo'
 * pagesRequestPathOf({ url: 'http://localhost:3000/logo.png', resourceType: 'Image' }) // => undefined
 */
export function pagesRequestPathOf(
  request: OutstandingPageRequest,
): string | undefined {
  let pathname: string
  try {
    pathname = new URL(request.url, 'http://codebook.invalid').pathname
  } catch {
    // A URL that does not parse is no page request.
    return undefined
  }
  const dataAssetPath = DATA_REQUEST_PATH.exec(pathname)?.[1]
  if (dataAssetPath !== undefined) return routeOfDataAssetPath(dataAssetPath)
  return request.resourceType === 'Document' ? pathname : undefined
}
