import type { PortListener } from './readPortListeners'
import { splitListenerAddress } from './splitListenerAddress'

/**
 * Reads the listening sockets iproute2's `ss -H -l -t -n -p sport = :<port>` printed: one line per socket (`LISTEN 0 511 *:4100 *:* users:(("node",pid=1234,fd=18))`), its local endpoint in the fourth column and the processes holding it in the `users:` part.
 * An IPv6 endpoint holds a colon in its address, bracketed or not (older ss prints `:::4100`), or is `*` (a socket that also accepts IPv4); one without process details (a socket of another user) has no pid.
 * Called by {@link readPortListeners} with the output of an `ss` query on Linux.
 * @param output - What `ss` printed on its standard output.
 * @returns One listener per socket and holding process, in the printed order; `undefined` when a line is not of that form.
 * @example
 * parseSsListeners('LISTEN 0 511 *:4100 *:* users:(("node",pid=1234,fd=18))\n')
 * // => [{ family: 'IPv6', address: '*', port: 4100, pid: 1234 }]
 */
export function parseSsListeners(output: string): PortListener[] | undefined {
  const listeners: PortListener[] = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const columns = line.trim().split(/\s+/)
    const localEndpoint = columns[3]
    if (columns[0] !== 'LISTEN' || localEndpoint === undefined) return undefined
    const endpoint = splitListenerAddress(localEndpoint)
    if (!endpoint) return undefined
    // An IPv6 address holds a colon, bracketed or not (older ss prints `:::4100`); `*` is a socket that also accepts IPv4.
    const family =
      endpoint.address === '*' || endpoint.address.includes(':')
        ? 'IPv6'
        : 'IPv4'
    const pids = [
      ...columns
        .slice(5)
        .join(' ')
        .matchAll(/pid=(\d+)/g),
    ].map((match) => Number(match[1]))
    // A socket another user holds shows no process; its pid stays unknown rather than absent.
    if (!pids.length) listeners.push({ family, ...endpoint, pid: undefined })
    for (const pid of pids) listeners.push({ family, ...endpoint, pid })
  }
  return listeners
}
