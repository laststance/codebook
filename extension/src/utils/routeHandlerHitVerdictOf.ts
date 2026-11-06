import { HTTP_METHOD_NAMES } from '../constants'

import { routeHandlerPathMatches } from './routeHandlerPathMatches'

/** One app-origin API request the browser sent, as the run's `Network` tracker keeps it. */
export type RouteHandlerBrowserRequest = {
  /** The tracker's id of the request (the CDP request id). */
  id: string
  method: string
  pathname: string
  /** The pathname plus the query as the browser sent it; absent means the pathname alone (an API-route hit compares it, E-2). */
  target?: string
  /** The wall time the request started, in epoch milliseconds, for the journal's latency row. */
  wallTimeMs?: number
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

/** The request an API-route hit read from the paused handler's `req` ({@link readPagesApiRequest}): its method and its target (pathname plus query). */
export type RouteHandlerHitRequest = { method: string; target: string }

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
 * @param input.handlerMethods - The HTTP methods the route file exports the handler under ({@link routeHandlerMethodsOf}); empty when the source names none. Used only when the handler name is no method name: with methods, only a request of one of them matches; without, the hit is published only when every unclaimed request of the window has one method.
 * @param input.operationIndex - The stop's `afterOperation`.
 * @param input.requests - The tracked browser requests, with this stop's claims.
 * @param input.kind - `pages-api` for a Pages API route (default `app-route`): its handler name says nothing about the method, so the hit is matched by `hitRequest` (E-2) or, when that is unreadable, by the operation window alone.
 * @param input.hitRequest - Pages API only: the method and target the paused handler's request carries; `undefined` when it could not be read.
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
  handlerMethods?: readonly string[]
  operationIndex: number
  requests: readonly RouteHandlerBrowserRequest[]
  kind?: 'app-route' | 'pages-api'
  hitRequest?: RouteHandlerHitRequest
}): RouteHandlerHitVerdict {
  if (input.kind === 'pages-api') return pagesApiHitVerdictOf(input)
  const {
    stopRoute,
    hitRoute,
    handlerName,
    handlerMethods = [],
    operationIndex,
    requests,
  } = input
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
  const sameMethod = matching.filter((request) =>
    isMethodName
      ? request.method === handlerName
      : handlerMethods.length === 0 || handlerMethods.includes(request.method),
  )
  if (sameMethod.length === 0)
    return { action: 'resume', reason: 'other-method' }
  const unclaimedRequests = sameMethod.filter((request) => !request.claimed)
  const unclaimed = unclaimedRequests[0]
  if (!unclaimed) return { action: 'resume', reason: 'after-retired' }
  // An alias the source does not tie to a method serves whatever method reached it: publish only when the window offers one method.
  if (
    !isMethodName &&
    handlerMethods.length === 0 &&
    unclaimedRequests.some((request) => request.method !== unclaimed.method)
  )
    return { action: 'resume', reason: 'unclassified' }
  return { action: 'publish', request: unclaimed }
}

/**
 * Decides whether a hit at a Pages API route stop is the learner's pause, by the request the paused handler holds (E-2, Cycle 0088).
 *
 * Why it exists: one default export serves every method and polling shares the click's route and method, so the pause's own `req.method` and target (path and query) are matched with the browser requests of the operation's window, earliest unclaimed first. Called by {@link routeHandlerHitVerdictOf} for `kind: 'pages-api'`.
 * @param input - The fields of {@link routeHandlerHitVerdictOf} (`handlerName` only says whether the stack was recognised).
 * @returns
 * - `publish` with the earliest unclaimed request of the window with the hit's method and target; without a readable request, the earliest unclaimed request of the window that matches the route
 * - `resume` with `unclassified` for an unrecognised stack, `after-retired` when every matching request was claimed, `before-operation` when only an earlier request matches, `other-method` or `other-path` when the window holds requests that differ, `no-browser-request` when it holds none
 * @example
 * pagesApiHitVerdictOf({ stopRoute: '/api/data', hitRoute: undefined, handlerName: 'x', operationIndex: 1, hitRequest: { method: 'GET', target: '/api/data?clear=1' }, requests: [{ id: '5', method: 'GET', pathname: '/api/data', target: '/api/data?clear=1', window: 1, claimed: false }] })
 * // => { action: 'publish', request: { id: '5', … } }
 */
function pagesApiHitVerdictOf(input: {
  stopRoute: string
  handlerName: string | undefined
  operationIndex: number
  requests: readonly RouteHandlerBrowserRequest[]
  hitRequest?: RouteHandlerHitRequest
}): RouteHandlerHitVerdict {
  const { stopRoute, handlerName, operationIndex, requests, hitRequest } = input
  if (handlerName === undefined)
    return { action: 'resume', reason: 'unclassified' }
  const forRoute = requests.filter((request) =>
    routeHandlerPathMatches(stopRoute, request.pathname),
  )
  // Without a readable request every request of the route stands for the hit; with one, method and target must be equal.
  const isHitsRequest = (request: RouteHandlerBrowserRequest): boolean =>
    hitRequest === undefined ||
    (request.method === hitRequest.method &&
      (request.target ?? request.pathname) === hitRequest.target)
  const candidates = forRoute.filter(isHitsRequest)
  const inWindow = candidates.filter(
    (request) => request.window === operationIndex,
  )
  const unclaimed = inWindow.find((request) => !request.claimed)
  if (unclaimed) return { action: 'publish', request: unclaimed }
  if (inWindow.length > 0) return { action: 'resume', reason: 'after-retired' }
  // Only a request that started before the operation matches: it reached the handler late.
  if (candidates.some((request) => request.window < operationIndex))
    return { action: 'resume', reason: 'before-operation' }
  const windowRequests = forRoute.filter(
    (request) => request.window === operationIndex,
  )
  if (windowRequests.length === 0)
    return { action: 'resume', reason: 'no-browser-request' }
  // The window holds requests for the route that are not this hit's: the method differs for the same target, else the target (the path or the query).
  const isOtherMethod = windowRequests.some(
    (request) =>
      hitRequest !== undefined &&
      (request.target ?? request.pathname) === hitRequest.target,
  )
  return {
    action: 'resume',
    reason: isOtherMethod ? 'other-method' : 'other-path',
  }
}
