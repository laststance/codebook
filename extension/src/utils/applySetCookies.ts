/** The cookies a sign-in produced: what to send, and every value ever seen (for masking). */
export type SessionCookies = {
  /** Cookie name to value, in insertion order. */
  send: ReadonlyMap<string, string>
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
 * Applies raw `Set-Cookie` header values, in order, to the session's cookies.
 *
 * Why it exists: the sign-in response sets the session cookie, which Codebook keeps in memory only and sends with the declared request.
 * Called by the node-server run for the sign-in response's headers.
 * Only `name=value` matters; Path, Domain, Secure, SameSite and HttpOnly are ignored.
 *
 * @param headers - The raw `Set-Cookie` header values.
 * @param nowMs - The current time in epoch milliseconds, for `Expires`.
 * @param previous - The cookies so far, if any; it is not mutated.
 * @returns The updated cookies.
 * @example
 * applySetCookies(['sid=abc123; Path=/; HttpOnly'], 0).send.get('sid') // => 'abc123'
 */
export function applySetCookies(
  headers: readonly string[],
  nowMs: number,
  previous?: SessionCookies,
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
    if (isDeletion(value, attributes, nowMs)) send.delete(name)
    else send.set(name, value)
  }
  return { send, seenValues: [...seen] }
}

/**
 * Formats the cookies as a `Cookie` request header value.
 * @param cookies - The session's cookies.
 * @returns `name=value; name2=value2` in insertion order, or undefined when nothing is left.
 * @example cookieHeaderOf(applySetCookies(['a=1', 'b=2'], 0)) // => 'a=1; b=2'
 */
export function cookieHeaderOf(cookies: SessionCookies): string | undefined {
  if (cookies.send.size === 0) return undefined
  return [...cookies.send].map(([name, value]) => `${name}=${value}`).join('; ')
}
