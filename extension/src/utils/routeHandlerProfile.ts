import { pathToFileURL } from 'node:url'

import {
  APP_ROUTE_CALLER,
  PAGES_API_CALLER,
  type RouteHandlerCaller,
} from './routeHandlerStackOf'

/** The forms of server stop that pause in a request handler the run arms by source: an App Router route handler and a Pages API route (Next compiles both on demand), and a handler of the app's own Node API server (Cycle 0099, `apiServer`). */
export type RouteHandlerKind = 'app-route' | 'pages-api' | 'node-api'

/** What differs between {@link RouteHandlerKind}s; everything else (arming, holding, sealing, identity) is one machinery (E-0, Cycle 0088). */
export interface RouteHandlerProfile {
  /** The webpack layer of the route file's script address (`webpack-internal:///(<layer>)/./<file>`); `node` for a plain module the Node API loads from disk. */
  layer: 'rsc' | 'api-node' | 'node'
  /** The Next frame that calls the handler; none for an API server stop, which is not found by a framework frame. */
  caller: RouteHandlerCaller | undefined
  /** The `execution` the pause reports. */
  execution: 'route-handler' | 'api-route' | 'server-action'
  /** The run resource field that names the request; an API server stop names it in `apiRequest` instead. */
  field: 'routeHandler' | 'apiRoute' | undefined
  /** Where the pause's method comes from: the handler's exported name, the request object the handler holds, or nowhere (the page's request is judged by time). */
  methodSource: 'handler-name' | 'request-object' | 'none'
  /** How a pause is matched to the stop's script: Next's webpack address, or the module's `file://` URL plus the acknowledged breakpoint id (D19). */
  scriptMatch: 'webpack-address' | 'file-url-and-breakpoint'
  /** Which lines of the stop's file the debugger may bind the stop to: any line from the declared one to the end of its citation, or the requested line only. */
  linePolicy: 'citation-range' | 'requested-line'
}

/** The profile of a kind whose script is a webpack module (not `node-api`), narrowed so its Next caller and field are present. */
export type WebpackRouteHandlerProfile = RouteHandlerProfile & {
  layer: 'rsc' | 'api-node'
  caller: RouteHandlerCaller
  field: 'routeHandler' | 'apiRoute'
}

/**
 * The per-kind profile constants of the route-handler machinery.
 *
 * Why it exists: Cycle 0087's route-handler path is reused for Pages API routes, and in Cycle 0099 for the app's own Node API server, with one table of differences instead of a parallel path. Read by {@link ConfiguredBrowserRun} wherever it arms, classifies, seals or publishes such a stop.
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
    scriptMatch: 'webpack-address',
    linePolicy: 'citation-range',
  },
  'pages-api': {
    layer: 'api-node',
    caller: PAGES_API_CALLER,
    execution: 'api-route',
    field: 'apiRoute',
    methodSource: 'request-object',
    scriptMatch: 'webpack-address',
    linePolicy: 'citation-range',
  },
  'node-api': {
    layer: 'node',
    caller: undefined,
    execution: 'server-action',
    field: undefined,
    methodSource: 'none',
    scriptMatch: 'file-url-and-breakpoint',
    linePolicy: 'requested-line',
  },
}

/**
 * Gives the profile of a webpack-addressed kind with its Next caller and field present.
 * Called by the Next route-handler path of {@link ConfiguredBrowserRun}, which never sees an API server stop.
 * @param kind - A kind other than `node-api`.
 * @returns The narrowed profile.
 * @throws For `node-api`, which has no webpack address and is never judged by the Next path (a programming error).
 * @example
 * webpackProfileOf('pages-api').caller === PAGES_API_CALLER // => true
 */
export function webpackProfileOf(
  kind: RouteHandlerKind,
): WebpackRouteHandlerProfile {
  const profile = ROUTE_HANDLER_PROFILES[kind]
  if (
    profile.layer === 'node' ||
    profile.caller === undefined ||
    profile.field === undefined
  )
    throw new Error(`The ${kind} profile has no webpack address`)
  return {
    ...profile,
    layer: profile.layer,
    caller: profile.caller,
    field: profile.field,
  }
}

/**
 * Tells whether a server pause is an API server stop's hit: the paused script is the stop file's module by its `file://` URL and the pause names the stop's own acknowledged breakpoint (D19, E-1).
 * Why it exists: Next's address (`webpack-internal:///…`) never matches a tsx-loaded module, and a file that sign-in or an earlier operation also runs must not pause for a breakpoint some other stop owns.
 * Called by the run when it looks for the stop a server pause belongs to.
 * @param input - The stop file's real path, the paused script's address, the id the adapter acknowledged for the stop's breakpoint and the ids the pause names.
 * @returns `true` only when the address equals the real path's `file://` URL and the acknowledged id is among the hit ids; a pause that names no id never matches.
 * @example
 * isNodeApiHit({ realSourcePath: '/repo/apps/api/src/a.ts', scriptUrl: 'file:///repo/apps/api/src/a.ts', acknowledgedId: 41, hitIds: [41] }) // => true
 */
export function isNodeApiHit(input: {
  realSourcePath: string
  scriptUrl: string | undefined
  acknowledgedId: number | undefined
  hitIds: readonly number[]
}): boolean {
  return (
    input.scriptUrl === pathToFileURL(input.realSourcePath).href &&
    input.acknowledgedId !== undefined &&
    input.hitIds.includes(input.acknowledgedId)
  )
}

/**
 * Tells whether a line the debugger bound is a place of a route-handler stop, by the kind's line policy (D19).
 * Why it exists: a Next route handler accepts any line from the declared one to the end of its citation (the compile moves a breakpoint within the handler), while an API server stop is requested on one line of a file the debugger loads as written and accepts that line only; js-debug's bound column is not part of the policy.
 * Called by the run when it arms a route-handler stop's provisional breakpoint.
 * @param kind - The stop's kind.
 * @param line - The line the debugger bound.
 * @param place - The stop's declared line, the line its breakpoint is requested on and the last line of its citation.
 * @returns `true` when the line is a place of the stop.
 * @example
 * routeHandlerAcceptsLine('node-api', 8, { declaredLine: 7, requestedLine: 7, citationEndLine: 20 }) // => false
 * routeHandlerAcceptsLine('app-route', 8, { declaredLine: 7, requestedLine: 7, citationEndLine: 20 }) // => true
 */
export function routeHandlerAcceptsLine(
  kind: RouteHandlerKind,
  line: number,
  place: {
    declaredLine: number
    requestedLine: number
    citationEndLine: number
  },
): boolean {
  if (ROUTE_HANDLER_PROFILES[kind].linePolicy === 'requested-line')
    return line === place.requestedLine
  return line >= place.declaredLine && line <= place.citationEndLine
}
