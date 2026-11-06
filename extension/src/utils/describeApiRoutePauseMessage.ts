import type { ConfiguredRuntimeSnapshot } from '../runtime'

/**
 * Words the run resource's message for a held Pages API route pause, so the chat reads which API route paused, for which request and after which operation, and never a route handler, a server render or a page load.
 * Called by {@link describeRenderRunMessage} when the run resource's message is built for a held API-route pause.
 * @param pause - The pause's `apiRoute` object and the operation it was observed after.
 * @returns `Paused in the API route <METHOD> <route> (request <path>), observed after operation <k>`.
 * @example
 * describeApiRoutePauseMessage({ apiRoute: { method: 'GET', route: '/api/data', path: '/api/data' }, operationIndex: 1 })
 * // => 'Paused in the API route GET /api/data (request /api/data), observed after operation 1'
 */
export function describeApiRoutePauseMessage(
  pause: Required<
    Pick<ConfiguredRuntimeSnapshot, 'apiRoute' | 'operationIndex'>
  >,
): string {
  const { method, route, path } = pause.apiRoute
  return `Paused in the API route ${method} ${route} (request ${path}), observed after operation ${pause.operationIndex}`
}
