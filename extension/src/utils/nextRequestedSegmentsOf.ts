/**
 * Splits an entry path into the decoded path segments Next matches its routes against, once per resolve, so each candidate route is matched against the same segments without parsing the entry path again.
 * Called by {@link mostSpecificNextRouteOf} before it walks a router's candidate routes and by {@link compareNextRouterMatches} before it matches both routers' routes; {@link nextRoutePrecedenceOf} takes the result.
 * @param entryPath - The configured entry path, already a valid same-origin path (its schema refuses a segment that is no valid percent-encoding).
 * @returns The segments without query, fragment, empty segments or trailing slash, each percent-decoded; `/` has none.
 * @example
 * nextRequestedSegmentsOf('/posts/caf%C3%A9/?tab=1') // => ['posts', 'café']
 * nextRequestedSegmentsOf('/')                       // => []
 */
export function nextRequestedSegmentsOf(entryPath: string): string[] {
  return new URL(entryPath, 'http://codebook.invalid').pathname
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
}
