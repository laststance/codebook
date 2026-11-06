/** One cookie to send: its name, value and the path it is scoped to. */
export type SessionCookie = {
  name: string
  value: string
  /** The `Path` attribute when it starts with `/`, else the default path of the request that set it (RFC 6265 5.1.4). */
  path: string
}

/** The cookies a sign-in produced: what to send, and every value ever seen (for masking). */
export type SessionCookies = {
  /** Cookies by name and path (a name may exist under several paths), in insertion order. */
  send: ReadonlyMap<string, SessionCookie>
  /** Every non-empty value ever seen, replaced and deleted ones included; no duplicates. */
  seenValues: readonly string[]
}

/**
 * Tells whether a parsed Set-Cookie header deletes its cookie.
 * @param value - The cookie value.
 * @param attributes - The attribute segments after the first `;`.
 * @param nowMs - The current time in epoch milliseconds.
 * @returns True for an empty value, `Max-Age` <= 0, or an `Expires` date before `nowMs`.
 * @example isDeletion('', [], 0) // => true
 */
function isDeletion(
  value: string,
  attributes: readonly string[],
  nowMs: number,
): boolean {
  if (value === '') return true
  let maxAge: number | undefined
  let expires: number | undefined
  for (const attribute of attributes) {
    const separator = attribute.indexOf('=')
    const name = (separator === -1 ? attribute : attribute.slice(0, separator))
      .trim()
      .toLowerCase()
    const attributeValue =
      separator === -1 ? '' : attribute.slice(separator + 1).trim()
    if (name === 'max-age' && /^-?\d+$/.test(attributeValue))
      maxAge = Number(attributeValue)
    else if (name === 'expires') {
      const parsed = Date.parse(attributeValue)
      if (!Number.isNaN(parsed)) expires = parsed
    }
  }
  // Max-Age wins over Expires (RFC 6265).
  if (maxAge !== undefined) return maxAge <= 0
  return expires !== undefined && expires < nowMs
}

/**
 * Strips the query and fragment from a request target.
 * @param target - A request path, possibly with `?query` or `#fragment`.
 * @returns The path alone.
 * @example pathOnly('/a/b?x=1') // => '/a/b'
 */
function pathOnly(target: string): string {
  const end = target.search(/[?#]/)
  return end === -1 ? target : target.slice(0, end)
}

/**
 * Computes the default cookie path of a request path (RFC 6265 5.1.4).
 * @param requestPath - The path of the request whose response set the cookie.
 * @returns `/` when the path is empty, relative or holds one `/`, else the path up to its rightmost `/`.
 * @example defaultPathOf('/api/auth/sign-in/email') // => '/api/auth/sign-in'
 */
function defaultPathOf(requestPath: string): string {
  const path = pathOnly(requestPath)
  if (!path.startsWith('/')) return '/'
  const last = path.lastIndexOf('/')
  return last === 0 ? '/' : path.slice(0, last)
}

/**
 * Reads the `Path` attribute of a parsed Set-Cookie header; the last one wins (RFC 6265 5.3 step 7).
 * @param attributes - The attribute segments after the first `;`.
 * @returns The last `Path` value when it starts with `/`, else undefined (the default path applies).
 * @example
 * pathAttributeOf(['Path=/api']) // => '/api'
 * pathAttributeOf(['Path=/login', 'Path=/']) // => '/'
 * pathAttributeOf(['Path=/', 'Path=api']) // => undefined
 */
function pathAttributeOf(attributes: readonly string[]): string | undefined {
  let path: string | undefined
  for (const attribute of attributes) {
    const separator = attribute.indexOf('=')
    // An attribute without `=` is a name with an empty value (RFC 6265 5.2).
    const name = separator === -1 ? attribute : attribute.slice(0, separator)
    if (name.trim().toLowerCase() !== 'path') continue
    const value = separator === -1 ? '' : attribute.slice(separator + 1).trim()
    // A Path that is empty or does not start with `/` stands for the default path, like a browser reads it.
    path = value.startsWith('/') ? value : undefined
  }
  return path
}

/**
 * Tells whether a cookie path path-matches a request path (RFC 6265 5.1.4).
 * @param cookiePath - The cookie's path.
 * @param requestPath - The request path, without query.
 * @returns True for the same path, or a prefix that ends at a `/` boundary.
 * @example pathMatches('/api', '/api/rpc/x') // => true
 */
function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === requestPath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  return (
    cookiePath.endsWith('/') || requestPath.charAt(cookiePath.length) === '/'
  )
}

/**
 * Applies raw `Set-Cookie` header values, in order, to the session's cookies.
 *
 * Why it exists: the sign-in response sets the session cookie, which Codebook keeps in memory only and sends with the declared request.
 * Called by the node-server run for the sign-in response's headers and for the declared response's headers.
 * Cookies are keyed by name and path, so the same name under two paths is two cookies. Domain, Secure, SameSite and HttpOnly are ignored (one server).
 *
 * @param headers - The raw `Set-Cookie` header values.
 * @param nowMs - The current time in epoch milliseconds, for `Expires`.
 * @param previous - The cookies so far, if any; it is not mutated.
 * @param requestPath - The path of the request whose response set the headers; its directory is the path of a cookie without a `Path` attribute.
 * @returns The updated cookies.
 * @example
 * cookieHeaderOf(applySetCookies(['sid=abc123; Path=/; HttpOnly'], 0), '/x') // => 'sid=abc123'
 */
export function applySetCookies(
  headers: readonly string[],
  nowMs: number,
  previous?: SessionCookies,
  requestPath = '/',
): SessionCookies {
  const send = new Map(previous?.send)
  const seen = new Set(previous?.seenValues)
  for (const header of headers) {
    const [pair = '', ...attributes] = header.split(';')
    const separator = pair.indexOf('=')
    // A line without `=` or with an empty name is ignored.
    if (separator === -1) continue
    const name = pair.slice(0, separator).trim()
    if (name === '') continue
    const value = pair.slice(separator + 1).trim()
    if (value !== '') seen.add(value)
    const path = pathAttributeOf(attributes) ?? defaultPathOf(requestPath)
    // A cookie is one (name, path) pair: a deletion removes only that pair.
    const key = `${path}\u0000${name}`
    if (isDeletion(value, attributes, nowMs)) send.delete(key)
    else send.set(key, { name, value, path })
  }
  return { send, seenValues: [...seen] }
}

/**
 * Formats the cookies that apply to a request path as a `Cookie` request header value.
 * @param cookies - The session's cookies.
 * @param requestPath - The path of the request that carries the header (a query is ignored).
 * @returns `name=value; name2=value2` for the cookies whose path path-matches, longer paths first and then insertion order, or undefined when none applies.
 * @example cookieHeaderOf(applySetCookies(['a=1', 'b=2'], 0), '/') // => 'a=1; b=2'
 */
export function cookieHeaderOf(
  cookies: SessionCookies,
  requestPath: string,
): string | undefined {
  const path = pathOnly(requestPath)
  const matching = [...cookies.send.values()]
    .filter((cookie) => pathMatches(cookie.path, path))
    // Array sort is stable, so equal paths keep insertion order.
    .sort((a, b) => b.path.length - a.path.length)
  if (matching.length === 0) return undefined
  return matching.map(({ name, value }) => `${name}=${value}`).join('; ')
}
