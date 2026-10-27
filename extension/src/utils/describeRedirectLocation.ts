import { redactSecretText } from './redactSecretText'

/** What a redirect to another origin shows instead of its address. */
const ANOTHER_ORIGIN = '(another origin)'

/**
 * Words a redirect's `Location` for the chat: a path when it stays on the server, `(another origin)` otherwise, so that no address outside the server is relayed.
 * Called by {@link sendDeclaredRequest} for a response that carries `Location`; redirects are never followed.
 * @param location - The `Location` header value.
 * @param port - The declared port; the server's origin is `localhost`, `127.0.0.1` or `[::1]` on it.
 * @returns The path with query and fragment (redacted) for a relative or same-origin location; `(another origin)` otherwise or when unparsable.
 * @example
 * describeRedirectLocation('http://localhost:4100/login?next=/a', 4100) // => '/login?next=/a'
 * describeRedirectLocation('https://example.com/', 4100)                // => '(another origin)'
 */
export function describeRedirectLocation(
  location: string,
  port: number,
): string {
  let target: URL
  try {
    target = new URL(location, `http://localhost:${port}`)
  } catch {
    return ANOTHER_ORIGIN
  }
  const sameOrigin =
    target.protocol === 'http:' &&
    Number(target.port || 80) === port &&
    ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  return sameOrigin
    ? redactSecretText(`${target.pathname}${target.search}${target.hash}`)
    : ANOTHER_ORIGIN
}
