import {
  APP_ROUTE_CALLER,
  PAGES_API_CALLER,
  type RouteHandlerCaller,
} from './routeHandlerStackOf'

/** The two forms of server stop that pause in a request handler Next compiles on demand: an App Router route handler and a Pages API route. */
export type RouteHandlerKind = 'app-route' | 'pages-api'

/** What differs between {@link RouteHandlerKind}s; everything else (arming, holding, sealing, identity) is one machinery (E-0, Cycle 0088). */
export interface RouteHandlerProfile {
  /** The webpack layer of the route file's script address (`webpack-internal:///(<layer>)/./<file>`). */
  layer: 'rsc' | 'api-node'
  /** The Next frame that calls the handler. */
  caller: RouteHandlerCaller
  /** The `execution` the pause reports. */
  execution: 'route-handler' | 'api-route'
  /** The run resource field that names the request. */
  field: 'routeHandler' | 'apiRoute'
  /** Where the pause's method comes from: the handler's exported name, or the request object the handler holds. */
  methodSource: 'handler-name' | 'request-object'
}

/**
 * The per-kind profile constants of the route-handler machinery.
 *
 * Why it exists: Cycle 0087's route-handler path is reused for Pages API routes with one table of differences instead of a parallel path. Read by {@link ConfiguredBrowserRun} wherever it arms, classifies, seals or publishes such a stop.
 * @example
 * ROUTE_HANDLER_PROFILES['pages-api'].layer // => 'api-node'
 */
export const ROUTE_HANDLER_PROFILES: Record<
  RouteHandlerKind,
  RouteHandlerProfile
> = {
  'app-route': {
    layer: 'rsc',
    caller: APP_ROUTE_CALLER,
    execution: 'route-handler',
    field: 'routeHandler',
    methodSource: 'handler-name',
  },
  'pages-api': {
    layer: 'api-node',
    caller: PAGES_API_CALLER,
    execution: 'api-route',
    field: 'apiRoute',
    methodSource: 'request-object',
  },
}
