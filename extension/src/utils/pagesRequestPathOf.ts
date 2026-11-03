import type { Protocol } from 'devtools-protocol'

import { NEXT_DATA_REQUEST_PATH_PREFIX } from '../constants'

/** A request the browser has sent and not yet received an answer for. */
export type OutstandingPageRequest = {
  url: string
  resourceType: Protocol.Network.ResourceType
}

/** Matches the path of Next's data request for a Pages navigation: `/_next/data/<build id>/<route>.json`. */
const DATA_REQUEST_PATH = new RegExp(
  `^${NEXT_DATA_REQUEST_PATH_PREFIX}[^/]+/(.+)\\.json$`,
)

/**
 * Gives the page path a request asks for when it is a page request, the document or Next's data request of a navigation, and nothing for any other request.
 *
 * Why it exists: when the page of a hit cannot be read from the stack, the browser's one outstanding page request says which page the server is rendering, but images, scripts and API calls must not count as page requests. Called by {@link readPagesRenderedPage} for each outstanding request.
 * @param request - An outstanding request: its URL and its resource type.
 * @returns The path of a document request (`/products/1`); the path a data request stands for (`/_next/data/b1/products/1.json` is `/products/1`, `…/index.json` is `/`); `undefined` for every other request and for a URL that does not parse.
 * @example
 * pagesRequestPathOf({ url: 'http://localhost:3000/products/1?x=1', resourceType: 'Document' }) // => '/products/1'
 * pagesRequestPathOf({ url: 'http://localhost:3000/_next/data/b1/index.json?page=2', resourceType: 'Fetch' }) // => '/'
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
  const dataRoute = DATA_REQUEST_PATH.exec(pathname)?.[1]
  if (dataRoute !== undefined)
    return dataRoute === 'index' ? '/' : `/${dataRoute}`
  return request.resourceType === 'Document' ? pathname : undefined
}
