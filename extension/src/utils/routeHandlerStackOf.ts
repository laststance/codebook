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

/** Next's route module method that calls a route handler: CDP names it `do` (E2, Cycle 0087, Next 16.2 `next dev --webpack`); a debugger's display adds the class (`AppRouteRouteModule.do`). */
const ROUTE_MODULE_METHOD = 'do'
/** The async-context frame Next puts between the handler and its route module: CDP's `run` (`AsyncLocalStorage.run` in a debugger's display). */
const ASYNC_CONTEXT_METHOD = 'run'
/** The script of Next's route module: the compiled `app-route` runtime (`next/dist/compiled/next-server/app-route.runtime.dev.js`) or its source module (`route-modules/app-route/module`). */
const ROUTE_MODULE_SCRIPT = /app-route|route-modules/
/** The Node frames that resume an async function after an `await` (E2: `processTicksAndRejections`); nothing of the caller is left on the synchronous stack. */
const CONTINUATION_FRAME =
  /^(?:process\.)?(?:processTicksAndRejections|runMicrotasks)$/

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
 * @returns `true` for the route module frame.
 * @example isRouteModuleFrame('do', 'file:///app/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js') // => true
 */
function isRouteModuleFrame(
  name: string | undefined,
  url: string | undefined,
): boolean {
  return (
    methodOf(name) === ROUTE_MODULE_METHOD &&
    (!url || ROUTE_MODULE_SCRIPT.test(url))
  )
}

/**
 * Says whether a list of frames, from a given start, reads `run`* then Next's route module.
 * @param frames - The frames with their names and script addresses.
 * @returns `true` when, after any async-context frames, the next frame is the route module.
 * @example calledByRouteModule([{ name: 'run' }, { name: 'do', url: '…/app-route.runtime.dev.js' }]) // => true
 */
function calledByRouteModule(
  frames: readonly { name?: string; url?: string }[],
): boolean {
  let index = 0
  // The async-context frames sit between the handler and Next's route module.
  while (methodOf(frames[index]?.name) === ASYNC_CONTEXT_METHOD) index++
  const caller = frames[index]
  return caller !== undefined && isRouteModuleFrame(caller.name, caller.url)
}

/**
 * Reads the handler frame of a route-handler stack, or `undefined` when the stack is no route-handler call.
 *
 * Why it exists: the same line of a route file only is a route-handler hit when the handler was called by Next's route module, and the handler's function name is the evidence for the method. Called by {@link ConfiguredBrowserRun} for each hit of an armed route-handler stop; a stack Next changed is resumed as `unclassified`, never published.
 * E2 (Cycle 0087) recorded both shapes CDP gives: before the handler's first `await` the synchronous frames are the handler, `run` and `do`; after it they are the handler and `processTicksAndRejections`, and `run` and `do` lead the `asyncStackTrace`.
 * @param frames - The paused event's call frames, top frame first.
 * @param moduleScriptId - The id of the route file's script (the top frame must be in it).
 * @param asyncFrames - The first segment of the event's `asyncStackTrace` call frames; `undefined` when the event has none.
 * @param urlOf - Gives a synchronous frame's script address by its script id (CDP frames carry none); `undefined` when unknown.
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
 *   [{ functionName: 'run', url: 'node:internal/async_local_storage/async_context_frame' }, { functionName: 'do', url: 'file:///app/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js' }],
 * ) // => { handlerName: 'POST' }
 */
export function routeHandlerStackOf(
  frames: readonly RouteHandlerFrame[],
  moduleScriptId: string,
  asyncFrames?: readonly RouteHandlerAsyncFrame[],
  urlOf: (scriptId: string) => string | undefined = () => undefined,
): { handlerName: string } | undefined {
  if (frames[0]?.location?.scriptId !== moduleScriptId) return undefined
  // The handler is the last of the route file's own frames from the top.
  let handlerIndex = 0
  while (frames[handlerIndex + 1]?.location?.scriptId === moduleScriptId)
    handlerIndex++
  const handler = { handlerName: frames[handlerIndex]?.functionName ?? '' }
  const below = frames.slice(handlerIndex + 1)
  // Called synchronously: Next's frames follow the handler.
  const synchronousCallers = below.map((frame) => ({
    name: frame.functionName,
    url: frame.location ? urlOf(frame.location.scriptId) : undefined,
  }))
  if (calledByRouteModule(synchronousCallers)) return handler
  // Resumed after an `await`: only Node's continuation frames follow, and the caller leads the async stack.
  const isResumed = below.every((frame) =>
    CONTINUATION_FRAME.test(frame.functionName ?? ''),
  )
  const asyncCallers = (asyncFrames ?? []).map((frame) => ({
    name: frame.functionName,
    url: frame.url,
  }))
  return isResumed && calledByRouteModule(asyncCallers) ? handler : undefined
}
