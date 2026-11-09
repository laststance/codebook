import type { ApiProcessState } from './readApiProcessState'

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
  'api-route-before-operation': `Set the stop's afterOperation to the operation after which the page sends the request (1 or more; afterOperation exists only in a version 3 configuration with operations, so a version 2 configuration moves to version 3): an API-route stop pauses only for a request the page sends after an operation, never for one sent while the page loads. When the page sends that request only while it loads, no afterOperation reaches it: explain the handler from its source and say so. Otherwise recovery: fix the configuration, then one new start. ${ROUTE_HANDLER_REFUSAL_CLOSING}`,
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

/**
 * The possibilities a `SERVER_STOP_NOT_REACHED` of a stop in the app's own Node API server names (Cycle 0099), always as possibilities and never as the established cause.
 * Served in the error text; the API's group was ended with the run. The deadline possibility comes from the native checks: an app's own request deadline keeps running while an earlier stop holds the request, so a long pause ends the request before a later stop of it.
 */
export const API_SERVER_NOT_REACHED_POSSIBILITIES =
  "For a stop in the app's own API these are possibilities, never the established cause: after the operation the page sent no request that reached the line (client-side validation, a cached answer, a request to another handler); the line sits in a branch that did not run; or a request that reached it ended before the line: an authentication or validation check answered it, or the app's own request deadline ran out while an earlier stop held the request (the API's output after the continue may say so)."

/**
 * Words what the run measured of the API process when an API stop's not-reached deadline ran out (API 1.44), for the failure text that leads its possibilities with it.
 * Called by the run when it words `SERVER_STOP_NOT_REACHED` for a stop in the app's own API; the sentence states the measured state and names no cause the run did not observe.
 *
 * @param apiProcess - The state {@link readApiProcessState} read.
 * @returns One sentence: running (not paused at any breakpoint), paused with its place or outside the repository's own files, or that the state could not be read.
 * @example
 * ```ts
 * apiProcessSentence({ state: 'paused', at: { path: 'apps/api/src/a.ts', line: 12 } })
 * // => 'When the deadline ran out, the API process was paused at apps/api/src/a.ts:12.'
 * ```
 */
export function apiProcessSentence(apiProcess: ApiProcessState): string {
  // Each state says only what was measured.
  if (apiProcess.state === 'not-paused')
    return 'When the deadline ran out, the API process was running, not paused at any breakpoint. If the request reached the API, it may be waiting inside the app, for example on its database or another service it calls; or no request reached the line.'
  if (apiProcess.state === 'paused')
    return `When the deadline ran out, the API process was paused ${apiProcess.at ? `at ${apiProcess.at.path}:${apiProcess.at.line}` : "at a place outside the repository's own files"}.`
  return 'Codebook could not read whether the API process was paused when the deadline ran out.'
}
