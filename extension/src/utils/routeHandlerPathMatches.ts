/**
 * Tells whether a request pathname is served by a route pattern.
 *
 * Why it exists: the page's request is correlated with the route handler by its pathname against the file's pattern. Called by the route-handler request tracker and {@link routeHandlerHitVerdictOf}.
 * @param route - A pattern from {@link routeHandlerRouteOf}: static segments, `[id]`, `[...slug]`, `[[...slug]]`.
 * @param pathname - A request pathname such as `/api/boards/42`.
 * @returns `true` when the pathname matches the pattern.
 * @example
 * routeHandlerPathMatches('/api/boards/[id]', '/api/boards/42') // => true
 * routeHandlerPathMatches('/api/todos', '/api/todos/1') // => false
 */
export function routeHandlerPathMatches(
  route: string,
  pathname: string,
): boolean {
  const pattern = route.split('/').filter(Boolean)
  const parts = pathname.split('/').filter(Boolean)
  for (const [index, segment] of pattern.entries()) {
    // A catch-all takes the rest: one or more parts, or zero for the optional form.
    if (segment.startsWith('[[...')) return true
    if (segment.startsWith('[...')) return parts.length > index
    const part = parts[index]
    if (part === undefined) return false
    if (!segment.startsWith('[') && segment !== part) return false
  }
  return parts.length === pattern.length
}
