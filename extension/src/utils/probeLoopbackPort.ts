import { connect } from 'node:net'

/** A loopback address a node-server run talks to. */
export type LoopbackHost = '127.0.0.1' | '::1'

/**
 * Tries one TCP connection to a loopback address and port and closes it again, so that readiness can tell which loopback address a server accepts on.
 * Called by {@link waitForServerReadiness} once per address and round.
 * @param host - The loopback address to connect to.
 * @param port - The declared port.
 * @param timeoutMs - How long the connection may take before it counts as refused.
 * @param signal - Aborts the probe: the socket is destroyed and the promise rejects with the signal's reason.
 * @returns
 * - `true` when the address accepted the connection
 * - `false` when it refused, failed or did not answer within `timeoutMs`
 * @throws The signal's reason when it aborts.
 * @example
 * await probeLoopbackPort('127.0.0.1', 4100, 250, signal) // => true while a server accepts on 127.0.0.1:4100
 */
export function probeLoopbackPort(
  host: LoopbackHost,
  port: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const socket = connect({ host, port })
    const finish = (accepted: boolean): void => {
      signal.removeEventListener('abort', onAbort)
      socket.destroy()
      resolve(accepted)
    }
    const onAbort = (): void => {
      socket.destroy()
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    // A refused or unreachable address is an answer, not a failure.
    socket.once('error', () => finish(false))
  })
}
