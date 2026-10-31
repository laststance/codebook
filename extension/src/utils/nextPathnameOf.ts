/**
 * Decodes one path segment; a segment that is no valid percent-encoding stays as written, so two such paths still compare by their text.
 * @param segment - One segment of a pathname.
 * @returns The decoded segment.
 * @example
 * decodedSegmentOf('caf%C3%A9') // => 'café'
 * decodedSegmentOf('%E0%A4%A')  // => '%E0%A4%A'
 */
function decodedSegmentOf(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Normalizes a path the way a Pages run compares the entry path with the page it ended on: the query and fragment dropped, empty segments and a trailing slash dropped (`/` stays `/`), each segment percent-decoded.
 *
 * Why it exists: the final-path check and the pathname check before the first input must not refuse a page only because the browser shows `/posts/` or `/caf%C3%A9` for an entry path written `/posts` or `/café`. Called by the configured browser run for the entry path and for each `location.pathname` it reads. It applies the normalization {@link resolveNextPagesRoute} applies to the entry path.
 * @param path - An entry path or a page's `location.pathname`, without an origin.
 * @returns The normalized path, starting with `/`.
 * @example
 * nextPathnameOf('/posts/?tab=1') // => '/posts'
 * nextPathnameOf('/caf%C3%A9')    // => '/café'
 * nextPathnameOf('/')             // => '/'
 */
export function nextPathnameOf(path: string): string {
  const segments = new URL(path, 'http://codebook.invalid').pathname
    .split('/')
    .filter(Boolean)
    .map(decodedSegmentOf)
  return `/${segments.join('/')}`
}
