import { SERVER_RENDER_ROUTE_MAX_CHARS } from '../constants'

import type { RenderedRoute } from './serverRenderHitVerdictOf'

/**
 * Reads the answer of the route expression (a DAP `evaluate` result) as the route Next renders.
 *
 * Why it exists: the adapter prints a string result with quotes (`'/dashboard'`), and an absent store, an exception or a timeout has no route; the classification needs one plain verdict. Called by {@link ConfiguredBrowserRun} after the route read of a render hit.
 * @param answer - The evaluate result text, or `undefined` when no answer came in time or the request failed.
 * @returns `{ state: 'read', route }` for a quoted or bare URL-form pattern that starts with `/` and is at most {@link SERVER_RENDER_ROUTE_MAX_CHARS} long; `{ state: 'unreadable' }` for everything else (`undefined`, `null`, an error text, an over-long answer).
 * @example
 * renderedRouteOf("'/dashboard/invoices'") // => { state: 'read', route: '/dashboard/invoices' }
 * renderedRouteOf('undefined') // => { state: 'unreadable' }
 * renderedRouteOf(`/${'a'.repeat(3000)}`) // => { state: 'unreadable' }
 */
export function renderedRouteOf(answer: string | undefined): RenderedRoute {
  const text = answer?.trim().replace(/^(['"`])(.*)\1$/s, '$2')
  return text !== undefined &&
    text.startsWith('/') &&
    text.length <= SERVER_RENDER_ROUTE_MAX_CHARS &&
    !/\s/.test(text)
    ? { state: 'read', route: text }
    : { state: 'unreadable' }
}
