import { createConnection, createServer, type Socket } from 'node:net'
import { pipeline } from 'node:stream'

import { StudyError } from '../errors'

/** The listener Codebook holds on `[::1]` for one run; closing it frees the port. */
export type Ipv6LoopbackForwarder = {
  close: () => Promise<void>
}

/** Test seam of {@link startIpv6LoopbackForwarder}; production passes none. */
export type Ipv6LoopbackForwarderOptions = {
  /** The IPv6 address to listen on; `::1` unless a test needs an address the host lacks. */
  bindHost?: string
  /** Replaces {@link createServer} so a test can make the listen fail with an error code the host will not raise on demand (EACCES). */
  createServer?: typeof createServer
}

/**
 * Owns `[::1]:<port>` for one repository-browser run, as a byte-for-byte TCP forwarder to `127.0.0.1:<port>` where the owned `next dev` listens.
 *
 * Called by {@link ConfiguredBrowserRun} in this order (D66, F427, F457): the owned `next dev` is launched, `ready()` resolves once Next has printed its `Local:` line (the server is bound), and only then is the forwarder started. When `ready()` fails or is cancelled the forwarder is never started, and a forwarder that was started is closed with the run. The browser opens `localhost`, which a host may resolve to `::1` first; with this listener no other process can take that endpoint while the run lasts, and the browser still reaches Codebook's own server.
 *
 * Each connection keeps both sockets half-open: when one side ends, the other side is ended (not destroyed) after the bytes already buffered, so a client that half-closes still gets the reply and a reply that follows the upstream's close arrives whole. An error on either side destroys both.
 *
 * @param port - The project's own port, where the server listens on `127.0.0.1`.
 * @param options - Test seam: the address to listen on.
 * @returns The forwarder, closed with the run; `undefined` on a host without IPv6 loopback (the caller then does not accept `[::1]` as owned).
 * @throws `PREREQUISITE_MISSING` naming `[::1]` when another process holds `[::1]:<port>` (as for a busy port), when the system does not permit listening there, or for any other listen failure (the cause names the error code only).
 *
 * @example
 * ```ts
 * const forwarder = await startIpv6LoopbackForwarder(3165)
 * await forwarder?.close()
 * ```
 */
export async function startIpv6LoopbackForwarder(
  port: number,
  options: Ipv6LoopbackForwarderOptions = {},
): Promise<Ipv6LoopbackForwarder | undefined> {
  const sockets = new Set<Socket>()
  const server = (options.createServer ?? createServer)(
    { allowHalfOpen: true },
    (client) => {
      const upstream = createConnection({
        host: '127.0.0.1',
        port,
        allowHalfOpen: true,
      })
      for (const socket of [client, upstream]) {
        // Forward each small write at once: Nagle's delay would add latency to every request/response of the learner's app (F555).
        socket.setNoDelay(true)
        sockets.add(socket)
        socket.once('close', () => sockets.delete(socket))
      }
      // pipeline ends the peer as its source ends and destroys both sockets only on an error.
      pipeline(client, upstream, () => undefined)
      pipeline(upstream, client, () => undefined)
    },
  )
  const failure = await new Promise<NodeJS.ErrnoException | undefined>(
    (resolve) => {
      server.once('error', resolve)
      server.listen(
        { host: options.bindHost ?? '::1', port, ipv6Only: true },
        () => resolve(undefined),
      )
    },
  )
  if (failure) {
    // No IPv6 loopback on this host: `localhost` cannot reach `::1` either.
    if (failure.code === 'EADDRNOTAVAIL' || failure.code === 'EAFNOSUPPORT')
      return undefined
    const ownership = `Codebook must own every loopback address that localhost reaches during the run: the app's own origin, such as AUTH_URL, points to localhost:${port}, so Codebook never starts it on another port.`
    if (failure.code === 'EADDRINUSE')
      throw new StudyError(
        'PREREQUISITE_MISSING',
        `Port ${port} is in use on this machine at [::1], and ${ownership} Ask the learner to stop the process that listens on [::1]:${port}, then start again.`,
      )
    if (failure.code === 'EACCES')
      throw new StudyError(
        'PREREQUISITE_MISSING',
        `Port ${port} is not permitted for Codebook at [::1] on this machine (the operating system refuses to let this program listen on it), and ${ownership} Ask the learner to allow listening on [::1]:${port} or to declare another port for the project (the -p/--port of next dev or a PORT= in the dev script), then start again.`,
      )
    // Any other errno keeps its error code only, so the cause carries no private text.
    const code = /^[A-Z0-9_]{1,32}$/.test(failure.code ?? '')
      ? failure.code
      : 'unknown error'
    throw new StudyError(
      'PREREQUISITE_MISSING',
      `Codebook could not listen on [::1]:${port} (${code}), and ${ownership} Ask the learner to free [::1]:${port} or to declare another port for the project, then start again.`,
      `listen ${code} on [::1]:${port}`,
    )
  }
  // After the listener is up a late error must not become uncaught.
  server.on('error', () => undefined)
  return {
    close: (): Promise<void> =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}
