/**
 * Splits a listening socket's local endpoint as `lsof` and `ss` print it (`*:4100`, `127.0.0.1:4100`, `[::1]:4100`, `0.0.0.0%lo:4100`) into its address and port.
 * Called by {@link parseLsofListeners} and {@link parseSsListeners}.
 * @param endpoint - The printed endpoint.
 * @returns
 * - `{ address, port }` with brackets and a `%<interface>` scope removed (`*` stays `*`)
 * - `undefined` when the text after the last `:` is no port from 1 to 65535
 * @example
 * splitListenerAddress('[::1]:4100')     // => { address: '::1', port: 4100 }
 * splitListenerAddress('*:4000')         // => { address: '*', port: 4000 }
 * splitListenerAddress('127.0.0.1:http') // => undefined
 */
export function splitListenerAddress(
  endpoint: string,
): { address: string; port: number } | undefined {
  const separator = endpoint.lastIndexOf(':')
  const portText = endpoint.slice(separator + 1)
  if (separator <= 0 || !/^\d{1,5}$/.test(portText)) return undefined
  const port = Number(portText)
  if (port < 1 || port > 65_535) return undefined
  const address = endpoint
    .slice(0, separator)
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/%.*$/, '')
  return address ? { address, port } : undefined
}
