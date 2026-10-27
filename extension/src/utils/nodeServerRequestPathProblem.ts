import { NODE_SERVER_REQUEST_PATH_LIMIT_CHARS } from '../constants'

/**
 * Names the first rule a declared node-server request path breaks, so that the request can only reach a path of the declared local server and node's HTTP client never refuses or rewrites it.
 * The percent-encoded dot, slash and backslash rule applies to the path before `?` only: a query string may carry an encoded slash (`?next=%2Fhome`) without walking the server's path.
 * Called by the request refinement of {@link nodeServerConfigSchema}; its clause completes the sentence `expected a path on the server starting with "/", <clause>.`
 * @param path - The declaration's `request.path`.
 * @returns
 * - `undefined` for an acceptable path
 * - The clause naming the broken rule otherwise (length, printable ASCII, no URL or host, no backslash, no fragment, no encoded dot or slash, no `..` segment), checked in that order
 * @example
 * nodeServerRequestPathProblem('/api/post_list?page=1') // => undefined
 * nodeServerRequestPathProblem('/api/../admin')         // => 'without ".." segments'
 * nodeServerRequestPathProblem('http://localhost/api')  // => 'not a URL or "//host"'
 */
export function nodeServerRequestPathProblem(path: string): string | undefined {
  if (path.length > NODE_SERVER_REQUEST_PATH_LIMIT_CHARS)
    return `at most ${NODE_SERVER_REQUEST_PATH_LIMIT_CHARS} characters`
  // node's HTTP client refuses spaces, control characters (CR and LF included) and characters above U+00FF; non-ASCII text is percent-encoded instead.
  if (!/^[\x21-\x7e]*$/.test(path))
    return 'in printable ASCII without spaces or line breaks (percent-encode other characters)'
  if (!path.startsWith('/') || path.startsWith('//'))
    return 'not a URL or "//host"'
  if (path.includes('\\')) return 'without "\\"'
  if (path.includes('#')) return 'without a "#" fragment'
  const pathBeforeQuery = path.split('?', 1)[0] ?? ''
  if (/%(?:2e|2f|5c)/i.test(pathBeforeQuery))
    return 'without percent-encoded dots, slashes or backslashes (%2e, %2f, %5c) before "?"'
  if (pathBeforeQuery.split('/').includes('..')) return 'without ".." segments'
  return undefined
}
