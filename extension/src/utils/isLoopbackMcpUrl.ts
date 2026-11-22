/** Host names of this machine's loopback; a descriptor naming any other host is never connected to. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  '127.0.0.1',
  'localhost',
  '[::1]',
])

/**
 * Says whether a connection descriptor's url is Codebook's own endpoint on this machine, so a bridge never sends the descriptor's bearer token elsewhere.
 * Called by {@link runCursorMcpBridge} on the exact url it connects to (so a descriptor replaced after the Devin Desktop bridge selected it is refused too), and by the Devin Desktop bridge's descriptor scan ({@link selectDevinDescriptor}).
 * @param url - The `url` a connection descriptor names.
 * @returns `true` only for `http:` on 127.0.0.1, localhost or [::1], without credentials in the url, with the path `/mcp`; `false` otherwise.
 * @throws When `url` cannot be parsed.
 * @example
 * isLoopbackMcpUrl(`http://127.0.0.1:${port}/mcp`) // => true
 * isLoopbackMcpUrl('https://example.com/mcp')      // => false
 */
export function isLoopbackMcpUrl(url: string): boolean {
  const parsed = new URL(url)
  return (
    parsed.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(parsed.hostname) &&
    parsed.pathname === '/mcp' &&
    parsed.username === '' &&
    parsed.password === ''
  )
}
