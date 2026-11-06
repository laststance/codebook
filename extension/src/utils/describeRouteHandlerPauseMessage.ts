import type { ConfiguredRuntimeSnapshot } from '../runtime'

/**
 * Words the run resource's message for a held route-handler pause, so the chat reads which handler paused, for which request and after which operation, and never a server render or a page load.
 * Called by {@link describeRenderRunMessage} when the run resource's message is built for a held route-handler pause.
 * @param pause - The pause's `routeHandler` object and the operation it was observed after.
 * @returns `Paused in the route handler <METHOD> <route> (request <path>), observed after operation <k>`.
 * @example
 * describeRouteHandlerPauseMessage({ routeHandler: { method: 'POST', route: '/api/todos', path: '/api/todos' }, operationIndex: 2 })
 * // => 'Paused in the route handler POST /api/todos (request /api/todos), observed after operation 2'
 */
export function describeRouteHandlerPauseMessage(
  pause: Required<
    Pick<ConfiguredRuntimeSnapshot, 'routeHandler' | 'operationIndex'>
  >,
): string {
  const { method, route, path } = pause.routeHandler
  return `Paused in the route handler ${method} ${route} (request ${path}), observed after operation ${pause.operationIndex}`
}
