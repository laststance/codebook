/**
 * The reasons of a route-handler-style `NEXT_STOP_NOT_SEALED` refusal: the values of `details.reason` for a stop in an App Router `route.ts` (Cycle 0087) and, since Cycle 0088, for a stop in a Pages API route.
 */
export type RouteHandlerRefusalReason =
  | 'route-handler-before-operation'
  | 'route-handler-edge-runtime'
  | 'route-handler-not-app-source'
  | 'api-route-before-operation'
  | 'api-route-edge-runtime'

/** The shared closing of every route-handler refusal recovery: nothing was started, so the fix is one configuration change and one new start. */
const ROUTE_HANDLER_REFUSAL_CLOSING =
  'Nothing was started: no server, no browser and no input (details.sideEffects is none). See codebook://help/repository-browser#NEXT_STOP_NOT_SEALED.'

/**
 * Static recovery text of each route-handler refusal reason, so the refusal builder in `nextRefusals.ts` and the help read one wording.
 * Used as the `recovery` override of a `NEXT_STOP_NOT_SEALED` raised at configuration resolution; it names fields, never values, because a recovery override reaches MCP unsanitized.
 *
 * @example
 * ```ts
 * ROUTE_HANDLER_REFUSAL_RECOVERY['route-handler-before-operation'].startsWith('Set the stop')
 * // => true
 * ```
 */
export const ROUTE_HANDLER_REFUSAL_RECOVERY: Record<
  RouteHandlerRefusalReason,
  string
> = {
  'route-handler-before-operation': `Set the stop's afterOperation to the operation after which the page sends the request (1 or more; afterOperation exists only in a version 3 configuration with operations, so a version 2 configuration moves to version 3): a route-handler stop pauses only for a request the page sends after an operation, never for one sent while the page loads. When the page sends that request only while it loads, no afterOperation reaches it: explain the handler from its source and say so. Otherwise recovery: fix the configuration, then one new start. ${ROUTE_HANDLER_REFUSAL_CLOSING}`,
  'route-handler-edge-runtime': `The route file declares the edge runtime, which Codebook cannot pause in, and no configuration change fixes that: explain the handler from its source and say it cannot be paused. ${ROUTE_HANDLER_REFUSAL_CLOSING}`,
  'api-route-before-operation': `Set the stop's afterOperation to the operation after which the page sends the request (1 or more; afterOperation exists only in a version 3 configuration with operations, so a version 2 configuration moves to version 3): an API-route stop pauses only for a request the page sends after an operation. ${ROUTE_HANDLER_REFUSAL_CLOSING}`,
  'api-route-edge-runtime': `The API route declares the edge runtime in its exported config, which Codebook cannot pause in, and no configuration change fixes that: explain the handler from its source and say it cannot be paused. ${ROUTE_HANDLER_REFUSAL_CLOSING}`,
  'route-handler-not-app-source': `Declare route-handler stops only in a route file of the app's own source: this file (details.file) lies in node_modules or in a workspace library inside the app's packageRoot. Choose a route file of the app, or explain this one from source. Recovery: fix the configuration, then one new start. ${ROUTE_HANDLER_REFUSAL_CLOSING}`,
}

/**
 * The possibilities a `SERVER_STOP_NOT_REACHED` of a route-handler stop names, always as possibilities and never as the established cause.
 * Served by the help so the chat repeats them; the error text carries the same list.
 */
export const ROUTE_HANDLER_NOT_REACHED_POSSIBILITIES =
  'For a route-handler stop (details.routeHandler names its route and method) these are possibilities, never the established cause: after the operation the page sent no request with that method to that route (client-side validation, a cached answer, a request to another path); the page sent the request before the operation, so its hit was resumed (details.resumedHits reason before-operation); or the line sits in a branch that did not run.'

/**
 * The possibilities a `SERVER_STOP_NOT_REACHED` of a Pages API-route stop names (DX-5 of Cycle 0088): the route-handler possibilities, worded for `details.apiRoute`, plus the two causes only an API route has.
 * Served by the help so the chat repeats them; the error text carries the same list.
 */
export const API_ROUTE_NOT_REACHED_POSSIBILITIES = `For an API-route stop (details.apiRoute names its route) these are possibilities, never the established cause: after the operation the page sent no request that reached the handler with that method and URL (client-side validation, a cached answer, a request to another path); the page sent the request before the operation, so its hit was resumed (details.resumedHits reason before-operation); or the line sits in a branch that did not run. A line outside the handler (module scope) never pauses for a request, and unclassified hits mean Codebook did not recognise Next's apiResolver as the caller.`
