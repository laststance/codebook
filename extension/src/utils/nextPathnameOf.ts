/** The escapes a decoded segment keeps: an encoded `/`, `\` or `%`, in either hex case; the capture keeps them as pieces of a split. */
const KEPT_ESCAPE = /(%(?:2f|5c|25))/i

/**
 * Decodes one path segment except an encoded `/`, `\` or `%`, which stay encoded with uppercase hex (`%2F`, `%5C`, `%25`); a segment that is no valid percent-encoding stays as written, so two such paths still compare by their text.
 *
 * Keeping those three encoded keeps the joined path's segment boundaries: `a%2Fb` is one segment and must not read as `a/b`, and a literal `%` stays `%25` so `a%252Fb` (the text `a%2Fb`) never reads as `a%2Fb` (an encoded `/`).
 * @param segment - One segment of a pathname.
 * @returns The decoded segment.
 * @example
 * decodedSegmentOf('caf%C3%A9') // => 'café'
 * decodedSegmentOf('a%2fb')     // => 'a%2Fb'
 * decodedSegmentOf('a%252Fb')   // => 'a%252Fb'
 * decodedSegmentOf('%E0%A4%A')  // => '%E0%A4%A'
 */
function decodedSegmentOf(segment: string): string {
  try {
    return (
      segment
        .split(KEPT_ESCAPE)
        // Odd pieces are the kept escapes; an even piece is decoded and throws when it is no valid percent-encoding.
        .map((piece, index) =>
          index % 2 === 1 ? piece.toUpperCase() : decodeURIComponent(piece),
        )
        .join('')
    )
  } catch {
    return segment
  }
}

/**
 * Normalizes a path the way a Pages run compares the entry path with the page it ended on: the query and fragment dropped, empty segments and a trailing slash dropped (`/` stays `/`), each segment percent-decoded except an encoded `/`, `\` or `%`.
 *
 * Why it exists: the final-path check and the pathname check before the first input must not refuse a page only because the browser shows `/posts/` or `/caf%C3%A9` for an entry path written `/posts` or `/café`, and must refuse a page at `/posts/a%2Fb` for an entry path `/posts/a/b`, which Next serves as another route. Called by the configured browser run for the entry path and for each `location.pathname` it reads. It splits and decodes as {@link resolveNextPagesRoute} does for the entry path, but keeps those three escapes so the joined path keeps its segments.
 * @param path - An entry path or a page's `location.pathname`, without an origin.
 * @returns The normalized path, starting with `/`.
 * @example
 * nextPathnameOf('/posts/?tab=1') // => '/posts'
 * nextPathnameOf('/caf%C3%A9')    // => '/café'
 * nextPathnameOf('/posts/a%2fb')  // => '/posts/a%2Fb'
 * nextPathnameOf('/')             // => '/'
 */
export function nextPathnameOf(path: string): string {
  const segments = new URL(path, 'http://codebook.invalid').pathname
    .split('/')
    .filter(Boolean)
    .map(decodedSegmentOf)
  return `/${segments.join('/')}`
}
