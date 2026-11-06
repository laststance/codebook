/** The part of a `Debugger.paused` call frame that {@link routeHandlerStackOf} reads. */
export interface RouteHandlerFrame {
  functionName?: string
  location?: { scriptId: string } | null
}

/** The part of an async stack frame (`Debugger.paused`'s `asyncStackTrace.callFrames`) that {@link routeHandlerStackOf} reads. */
export interface RouteHandlerAsyncFrame {
  functionName?: string
  url?: string
}

/** The part of `Debugger.paused`'s `asyncStackTrace` that {@link routeHandlerStackOf} reads: one segment's frames and the segment before it. */
export interface RouteHandlerAsyncStack {
  callFrames: readonly RouteHandlerAsyncFrame[]
  parent?: RouteHandlerAsyncStack
}

/** Which Next frame calls the handler: the App Router's route module or the Pages API's `apiResolver` (Cycle 0088). */
export interface RouteHandlerCaller {
  /** The caller frame's method name. */
  method: string
  /** The caller's script address pattern, applied when the address is known. */
  script: RegExp
  /** Whether Next's async-context `run` frames stand between the handler and the caller (App Router) or the caller sits directly below (Pages API). */
  skipsAsyncContext: boolean
}

/** Next's route module method that calls a route handler: CDP names it `do` (E2, Cycle 0087, Next 16.2 `next dev --webpack`); a debugger's display adds the class (`AppRouteRouteModule.do`). */
const ROUTE_MODULE_METHOD = 'do'
/** The async-context frame Next puts between the handler and its route module: CDP's `run` (`AsyncLocalStorage.run` in a debugger's display). */
const ASYNC_CONTEXT_METHOD = 'run'
/** The script of Next's route module: the compiled `app-route` runtime (`next/dist/compiled/next-server/app-route.runtime.dev.js`) or its source module (`route-modules/app-route/module`). */
const ROUTE_MODULE_SCRIPT = /app-route|route-modules/
/** The App Router caller: `do` of the `app-route` module behind `run` frames (E2, Cycle 0087). */
export const APP_ROUTE_CALLER: RouteHandlerCaller = {
  method: ROUTE_MODULE_METHOD,
  script: ROUTE_MODULE_SCRIPT,
  skipsAsyncContext: true,
}
/** The Pages API caller: `apiResolver` of `pages-api.runtime.dev.js`, directly below the handler or heading the first async segment after an `await` (E1, Cycle 0088, Next 16.2.2). */
export const PAGES_API_CALLER: RouteHandlerCaller = {
  method: 'apiResolver',
  script: /pages-api|api-utils/,
  skipsAsyncContext: false,
}
/** The Node frames that resume an async function after an `await`: the microtask queue (E2: `processTicksAndRejections`) or a timer or immediate that settled the awaited promise; nothing of the caller is left on the synchronous stack. */
const CONTINUATION_FRAME =
  /^(?:process\.)?(?:processTicksAndRejections|runMicrotasks|runNextTicks|listOnTimeout|processTimers|processImmediate)$/
/** The address prefix of Node's own scripts (`node:internal/timers`). */
const NODE_INTERNAL_SCRIPT = 'node:'

/**
 * Gives a frame name's method part: `AppRouteRouteModule.do` and `do` both read `do`.
 * @param name - A frame's function name.
 * @returns The part after the last `.`, or the whole name.
 * @example methodOf('AsyncLocalStorage.run') // => 'run'
 */
function methodOf(name: string | undefined): string {
  return (name ?? '').split('.').at(-1) ?? ''
}

/**
 * Says whether a frame is Next's route module calling the handler: its method is `do` and its script, when known, is Next's `app-route` code.
 * @param name - The frame's function name.
 * @param url - The frame's script address; `undefined` or empty when unknown.
 * @param caller - Which Next frame is the expected caller.
 * @returns `true` for the route module frame.
 * @example isRouteModuleFrame('do', 'file:///app/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js', APP_ROUTE_CALLER) // => true
 */
function isRouteModuleFrame(
  name: string | undefined,
  url: string | undefined,
  caller: RouteHandlerCaller,
): boolean {
  return methodOf(name) === caller.method && (!url || caller.script.test(url))
}

/**
 * Says whether a list of frames, from a given start, reads `run`* then Next's route module.
 * @param frames - The frames with their names and script addresses.
 * @param expected - Which Next frame is the expected caller.
 * @returns `true` when, after any async-context frames (App Router), the next frame is the caller.
 * @example calledByRouteModule([{ name: 'run' }, { name: 'do', url: '…/app-route.runtime.dev.js' }], APP_ROUTE_CALLER) // => true
 */
function calledByRouteModule(
  frames: readonly { name?: string; url?: string }[],
  expected: RouteHandlerCaller,
): boolean {
  let index = 0
  // The async-context frames sit between the handler and Next's route module (App Router only).
  if (expected.skipsAsyncContext)
    while (methodOf(frames[index]?.name) === ASYNC_CONTEXT_METHOD) index++
  const caller = frames[index]
  return (
    caller !== undefined &&
    isRouteModuleFrame(caller.name, caller.url, expected)
  )
}

/**
 * Says whether a frame is Node's own work that resumes an awaiting function: a continuation frame by name, or any frame of Node's own scripts.
 * @param name - The frame's function name.
 * @param url - The frame's script address; `undefined` or empty when unknown.
 * @returns `true` for Node's continuation work.
 * @example isContinuationFrame('listOnTimeout', 'node:internal/timers') // => true
 */
function isContinuationFrame(
  name: string | undefined,
  url: string | undefined,
): boolean {
  return (
    CONTINUATION_FRAME.test(name ?? '') ||
    Boolean(url?.startsWith(NODE_INTERNAL_SCRIPT))
  )
}

/**
 * Gives the first async stack segment that holds a caller: segments of only Node's continuation work (a timer list that resumed the awaiting function) are passed over, and so are the leading frames of the route file itself (a handler awaiting its helper).
 *
 * Why it exists: a stop in an async helper after the helper's own `await` has only the helper on the synchronous stack; the awaiting handler is the async chain's first frame and Next's caller comes after it (Cycle 0088, Codex outside voice). Called by {@link routeHandlerStackOf}.
 * @param stack - The paused event's async stack; `undefined` when the event has none.
 * @param routeUrl - The route file's script address; `undefined` when unknown (no frame is then taken for the route file's).
 * @returns
 * - `frames`: the segment's frames after the route file's own leading frames, with their names and script addresses; empty when no segment holds a caller
 * - `routeFrameName`: the function name of the outermost route-file frame skipped; `undefined` when none was
 * @example firstCallerSegment({ callFrames: [{ functionName: 'POST', url: 'file:///app/route.ts' }, { functionName: 'do', url: '…/app-route.runtime.dev.js' }] }, 'file:///app/route.ts') // => { frames: [{ name: 'do', url: '…/app-route.runtime.dev.js' }], routeFrameName: 'POST' }
 */
function firstCallerSegment(
  stack: RouteHandlerAsyncStack | undefined,
  routeUrl: string | undefined,
): {
  frames: { name?: string; url?: string }[]
  routeFrameName?: string
} {
  let routeFrameName: string | undefined
  // The chain is short (Node's default async stack depth); each segment is read once.
  for (let segment = stack; segment; segment = segment.parent) {
    const frames = segment.callFrames.map((frame) => ({
      name: frame.functionName,
      url: frame.url,
    }))
    // The awaiting route-file frames lead the segment; the last one skipped is the outermost.
    let start = 0
    while (routeUrl && frames[start]?.url === routeUrl) {
      routeFrameName = frames[start]?.name
      start++
    }
    const rest = frames.slice(start)
    if (rest.some((frame) => !isContinuationFrame(frame.name, frame.url)))
      return { frames: rest, routeFrameName }
  }
  return { frames: [] }
}

/**
 * Reads the handler frame of a route-handler stack, or `undefined` when the stack is no route-handler call.
 *
 * Why it exists: the same line of a route file only is a route-handler hit when the handler was called by Next's route module, and the handler's function name is the evidence for the method. Called by {@link ConfiguredBrowserRun} for each hit of an armed route-handler stop; a stack Next changed is resumed as `unclassified`, never published.
 * E2 (Cycle 0087) recorded both shapes CDP gives: before the handler's first `await` the synchronous frames are the handler, `run` and `do`; after it they are the handler and `processTicksAndRejections`, and `run` and `do` lead the `asyncStackTrace`. After an awaited timer (C87-2: `await new Promise((resolve) => setTimeout(resolve, 500))`) Node's timer frames may stand below the handler, and a segment of only those may come before the caller's.
 * @param frames - The paused event's call frames, top frame first.
 * @param moduleScriptId - The id of the route file's script (the top frame must be in it).
 * @param asyncStack - The event's `asyncStackTrace`; `undefined` when the event has none.
 * @param urlOf - Gives a synchronous frame's script address by its script id (CDP frames carry none); `undefined` when unknown. Its address for `moduleScriptId` also marks the route file's own frames on the async stack.
 * @param caller - Which Next frame calls the handler: {@link APP_ROUTE_CALLER} (default) or {@link PAGES_API_CALLER}.
 * @returns
 * - `{ handlerName }` when the frames from the top down to the handler are in the route file and the handler is called by Next's route module, on the synchronous stack or, after an `await`, at the head of the async stack
 * - `undefined` otherwise
 * @example
 * routeHandlerStackOf(
 *   [
 *     { functionName: 'POST', location: { scriptId: '12' } },
 *     { functionName: 'processTicksAndRejections', location: { scriptId: '32' } },
 *   ],
 *   '12',
 *   { callFrames: [{ functionName: 'run', url: 'node:internal/async_local_storage/async_context_frame' }, { functionName: 'do', url: 'file:///app/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js' }] },
 * ) // => { handlerName: 'POST' }
 */
export function routeHandlerStackOf(
  frames: readonly RouteHandlerFrame[],
  moduleScriptId: string,
  asyncStack?: RouteHandlerAsyncStack,
  urlOf: (scriptId: string) => string | undefined = () => undefined,
  caller: RouteHandlerCaller = APP_ROUTE_CALLER,
): { handlerName: string } | undefined {
  if (frames[0]?.location?.scriptId !== moduleScriptId) return undefined
  const handlerIndex = handlerFrameIndexOf(frames, moduleScriptId)
  const handler = { handlerName: frames[handlerIndex]?.functionName ?? '' }
  const below = frames.slice(handlerIndex + 1)
  // Called synchronously: Next's frames follow the handler.
  const synchronousCallers = below.map((frame) => ({
    name: frame.functionName,
    url: frame.location ? urlOf(frame.location.scriptId) : undefined,
  }))
  if (calledByRouteModule(synchronousCallers, caller)) return handler
  // Resumed after an `await`: only Node's continuation work follows, and the caller leads the async stack, behind the route file's own awaiting frames (a handler that awaited the helper the stop is in).
  const isResumed = synchronousCallers.every((frame) =>
    isContinuationFrame(frame.name, frame.url),
  )
  if (!isResumed) return undefined
  const segment = firstCallerSegment(asyncStack, urlOf(moduleScriptId))
  if (!calledByRouteModule(segment.frames, caller)) return undefined
  // The outermost route-file frame is the handler (an App Router method name), also when it only stands on the async stack.
  return segment.routeFrameName === undefined
    ? handler
    : { handlerName: segment.routeFrameName }
}

/**
 * Gives the index of the handler frame: the last of the route file's own frames counted from the top.
 *
 * Why it exists: a stop may sit in a helper of the route file, so the handler is not always the top frame; the Pages API request read (E-1) must look at the handler's local scope. Called by {@link routeHandlerStackOf} and by {@link ConfiguredBrowserRun} for an API-route hit.
 * @param frames - The paused event's call frames, top frame first.
 * @param moduleScriptId - The id of the route file's script.
 * @returns The index in `frames` of the outermost consecutive frame in the route file; 0 when only the top frame is.
 * @example handlerFrameIndexOf([{ location: { scriptId: '12' } }, { location: { scriptId: '12' } }, { location: { scriptId: '3' } }], '12') // => 1
 */
export function handlerFrameIndexOf(
  frames: readonly RouteHandlerFrame[],
  moduleScriptId: string,
): number {
  let handlerIndex = 0
  while (frames[handlerIndex + 1]?.location?.scriptId === moduleScriptId)
    handlerIndex++
  return handlerIndex
}
