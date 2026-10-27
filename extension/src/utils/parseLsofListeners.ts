import type { PortListener } from './readPortListeners'
import { splitListenerAddress } from './splitListenerAddress'

/** The process and socket family the lines read so far open, which an `n` line completes into a listener. */
type LsofCursor = { pid?: number; family?: PortListener['family'] }

/**
 * Applies one `lsof -F` line to the cursor, adding a listener when an `n` line completes a socket.
 * @param cursor - The open process and socket family, updated in place.
 * @param line - One non-empty output line: a field letter, then its value.
 * @param listeners - The listeners read so far, appended to in place.
 * @returns `false` for a line that is not of the expected form.
 * @example readLsofLine({ pid: 48633, family: 'IPv6' }, 'n*:4100', listeners) // => true, listeners gains { family: 'IPv6', address: '*', port: 4100, pid: 48633 }
 */
function readLsofLine(
  cursor: LsofCursor,
  line: string,
  listeners: PortListener[],
): boolean {
  const value = line.slice(1)
  switch (line[0]) {
    case 'p':
      cursor.pid = /^\d+$/.test(value) ? Number(value) : undefined
      return cursor.pid !== undefined
    case 'f':
      // Each file descriptor is a new socket; its family follows.
      cursor.family = undefined
      return true
    case 't':
      cursor.family = value === 'IPv4' || value === 'IPv6' ? value : undefined
      return cursor.family !== undefined
    case 'n': {
      const endpoint = splitListenerAddress(value)
      if (!endpoint || cursor.pid === undefined || !cursor.family) return false
      listeners.push({ family: cursor.family, ...endpoint, pid: cursor.pid })
      return true
    }
    default:
      return false
  }
}

/**
 * Reads the listening sockets `lsof -nP -iTCP:<port> -sTCP:LISTEN -Fptn` printed: a `p<pid>` line opens a process, each `f<fd>` line one of its sockets, whose `t<type>` (`IPv4` or `IPv6`) and `n<address>:<port>` lines follow.
 * Called by {@link readPortListeners} with the output of an `lsof` query.
 * @param output - What `lsof` printed on its standard output.
 * @returns One listener per socket, in the printed order; `undefined` when a line is not of that form (the reading is then no answer).
 * @example
 * parseLsofListeners('p48633\nf18\ntIPv6\nn*:4100\n')
 * // => [{ family: 'IPv6', address: '*', port: 4100, pid: 48633 }]
 */
export function parseLsofListeners(output: string): PortListener[] | undefined {
  const listeners: PortListener[] = []
  const cursor: LsofCursor = {}
  for (const line of output.split('\n'))
    if (line && !readLsofLine(cursor, line, listeners)) return undefined
  return listeners
}
