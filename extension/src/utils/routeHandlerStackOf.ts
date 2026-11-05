/** The part of a `Debugger.paused` call frame that {@link routeHandlerStackOf} reads. */
export interface RouteHandlerFrame {
  functionName?: string
  location?: { scriptId: string } | null
}

/** Next's route module frame that calls a route handler (recorded in E1: `AppRouteRouteModule.do`). */
const ROUTE_MODULE_FRAME = /AppRouteRouteModule\.do$/
/** The async-context frame Next puts between the handler and its route module (`AsyncLocalStorage.run`). */
const ASYNC_CONTEXT_FRAME = /(?:^|\.)run$/

/**
 * Reads the handler frame of a route-handler stack, or `undefined` when the stack is no route-handler call.
 *
 * Why it exists: the same line of a route file only is a route-handler hit when the handler was called by Next's route module, and the handler's function name is the evidence for the method. Called by {@link ConfiguredBrowserRun} for each hit of an armed route-handler stop; a stack Next changed is resumed as `unclassified`, never published.
 * @param frames - The paused event's call frames, top frame first.
 * @param moduleScriptId - The id of the route file's script (the top frame must be in it).
 * @returns `{ handlerName }` when the frames from the top down to the handler are in the route file and the handler sits directly above `AsyncLocalStorage.run` and `AppRouteRouteModule.do`; `undefined` otherwise.
 * @example
 * routeHandlerStackOf(
 *   [
 *     { functionName: 'POST', location: { scriptId: '12' } },
 *     { functionName: 'AsyncLocalStorage.run', location: { scriptId: '4' } },
 *     { functionName: 'AppRouteRouteModule.do', location: { scriptId: '5' } },
 *   ],
 *   '12',
 * ) // => { handlerName: 'POST' }
 */
export function routeHandlerStackOf(
  frames: readonly RouteHandlerFrame[],
  moduleScriptId: string,
): { handlerName: string } | undefined {
  if (frames[0]?.location?.scriptId !== moduleScriptId) return undefined
  const routeModuleIndex = frames.findIndex((frame) =>
    ROUTE_MODULE_FRAME.test(frame.functionName ?? ''),
  )
  if (routeModuleIndex < 1) return undefined
  // The async-context frames sit between the handler and Next's route module.
  let handlerIndex = routeModuleIndex - 1
  while (
    handlerIndex > 0 &&
    ASYNC_CONTEXT_FRAME.test(frames[handlerIndex]?.functionName ?? '')
  )
    handlerIndex--
  // Every frame from the top down to the handler is the route file's own code.
  const isRouteFileCode = frames
    .slice(0, handlerIndex + 1)
    .every((frame) => frame.location?.scriptId === moduleScriptId)
  return isRouteFileCode
    ? { handlerName: frames[handlerIndex]?.functionName ?? '' }
    : undefined
}
