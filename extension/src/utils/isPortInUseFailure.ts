/** Node's `EADDRINUSE` error text and Vite's `strictPort` sentence ("Port 5173 is already in use"). */
const PORT_IN_USE_PATTERN =
  /\bEADDRINUSE\b|\bis already in use\b|\baddress already in use\b/i

/**
 * Tells whether a launcher failure of the listen phase means another process took the port after the free-port check.
 *
 * Why it exists: the port is checked free before the listen command, and another process can take it in between; that race is a busy port (`VITE_PORT_UNAVAILABLE`), not a launcher failure. Called by {@link launchViteDevelopmentServer} on a failed report.
 *
 * @param failure - The launcher's failed report: its phase and the first line of the error.
 * @returns `true` for a listen-phase failure whose line names a port in use.
 * @example
 * isPortInUseFailure({ phase: 'listen', firstLine: 'listen EADDRINUSE: address already in use 127.0.0.1:3010' }) // => true
 * isPortInUseFailure({ phase: 'config', firstLine: 'EADDRINUSE' }) // => false
 */
export function isPortInUseFailure(failure: {
  phase: string
  firstLine: string
}): boolean {
  return (
    failure.phase === 'listen' && PORT_IN_USE_PATTERN.test(failure.firstLine)
  )
}
