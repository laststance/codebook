import { HTTP_METHOD_NAMES } from '../constants'

import { routeHandlerPathMatches } from './routeHandlerPathMatches'

/** One app-origin API request the browser sent, as the run's `Network` tracker keeps it. */
export type RouteHandlerBrowserRequest = {
  /** The tracker's id of the request (the CDP request id). */
  id: string
  method: string
  pathname: string
  /** The operation window the request started in: the number of operations whose input had been dispatched. */
  window: number
  /** Whether this stop already claimed the request (a stop claims at most one). */
  claimed: boolean
}

/** Why a route-handler hit is resumed instead of published. */
export type RouteHandlerResumeReason =
  | 'before-operation'
  | 'other-method'
  | 'other-path'
  | 'no-browser-request'
  | 'after-retired'
  | 'unclassified'

/** What {@link routeHandlerHitVerdictOf} decides for one hit of an armed route-handler stop. */
export type RouteHandlerHitVerdict =
  | { action: 'publish'; request: RouteHandlerBrowserRequest }
  | { action: 'resume'; reason: RouteHandlerResumeReason }

/**
 * Decides whether a hit at a route-handler stop is the learner's pause: the identity contract of Cycle 0087 as a pure function.
 *
 * Why it exists: a route handler also runs for the entry load, polling and the server's own fetches, and only the request the page sent after the stop's operation is the one to show. Called by {@link ConfiguredBrowserRun} for each hit, again while it waits for the browser's `Network` event to arrive.
 * @param input.stopRoute - The stop's route pattern (`/api/todos`).
 * @param input.hitRoute - The route the work store reports on the paused frame; `undefined` when unreadable.
 * @param input.handlerName - The handler frame's function name; `undefined` when the stack is no route-handler stack. It only rejects a contradicting HTTP method name; an alias has no method name and is accepted.
 * @param input.operationIndex - The stop's `afterOperation`.
 * @param input.requests - The tracked browser requests, with this stop's claims.
 * @returns
 * - `publish` with the first unclaimed request of the operation's window that matches the route and the method
 * - `resume` with the one reason otherwise
 * @example
 * routeHandlerHitVerdictOf({ stopRoute: '/api/todos', hitRoute: '/api/todos', handlerName: 'POST', operationIndex: 2, requests: [{ id: '1', method: 'POST', pathname: '/api/todos', window: 2, claimed: false }] })
 * // => { action: 'publish', request: { id: '1', method: 'POST', pathname: '/api/todos', window: 2, claimed: false } }
 */
export function routeHandlerHitVerdictOf(input: {
  stopRoute: string
  hitRoute: string | undefined
  handlerName: string | undefined
  operationIndex: number
  requests: readonly RouteHandlerBrowserRequest[]
}): RouteHandlerHitVerdict {
  const { stopRoute, hitRoute, handlerName, operationIndex, requests } = input
  if (handlerName === undefined)
    return { action: 'resume', reason: 'unclassified' }
  if (hitRoute !== undefined && hitRoute !== stopRoute)
    return { action: 'resume', reason: 'other-path' }
  const inWindow = requests.filter(
    (request) => request.window === operationIndex,
  )
  const matching = inWindow.filter((request) =>
    routeHandlerPathMatches(stopRoute, request.pathname),
  )
  if (matching.length === 0) {
    // A request to this route that started before the operation reached the handler late.
    if (
      requests.some(
        (request) =>
          request.window < operationIndex &&
          routeHandlerPathMatches(stopRoute, request.pathname),
      )
    )
      return { action: 'resume', reason: 'before-operation' }
    return {
      action: 'resume',
      reason: inWindow.length > 0 ? 'other-path' : 'no-browser-request',
    }
  }
  const isMethodName = (HTTP_METHOD_NAMES as readonly string[]).includes(
    handlerName,
  )
  const sameMethod = matching.filter(
    (request) => !isMethodName || request.method === handlerName,
  )
  if (sameMethod.length === 0)
    return { action: 'resume', reason: 'other-method' }
  const unclaimed = sameMethod.find((request) => !request.claimed)
  return unclaimed
    ? { action: 'publish', request: unclaimed }
    : { action: 'resume', reason: 'after-retired' }
}
