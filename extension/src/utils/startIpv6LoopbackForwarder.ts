import { createConnection, createServer, type Socket } from 'node:net'

import { StudyError } from '../errors'

/** The listener Codebook holds on `[::1]` for one run; closing it frees the port. */
export type Ipv6LoopbackForwarder = {
  close: () => Promise<void>
}

/** Test seam of {@link startIpv6LoopbackForwarder}; production passes none. */
export type Ipv6LoopbackForwarderOptions = {
  /** The IPv6 address to listen on; `::1` unless a test needs an address the host lacks. */
  bindHost?: string
}

/**
 * Owns `[::1]:<port>` for one repository-browser run, as a byte-for-byte TCP forwarder to `127.0.0.1:<port>` where the owned `next dev` listens.
 *
 * Called by {@link ConfiguredBrowserRun} once the app is ready (D66, F427). The browser opens `localhost`, which a host may resolve to `::1` first; with this listener no other process can take that endpoint while the run lasts, and the browser still reaches Codebook's own server.
 *
 * @param port - The project's own port, where the server listens on `127.0.0.1`.
 * @param options - Test seam: the address to listen on.
 * @returns The forwarder, closed with the run; `undefined` on a host without IPv6 loopback (the caller then does not accept `[::1]` as owned).
 * @throws `PREREQUISITE_MISSING` naming `[::1]` when another process holds `[::1]:<port>`, as for a busy port.
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
  const server = createServer((client) => {
    const upstream = createConnection({ host: '127.0.0.1', port })
    for (const socket of [client, upstream]) {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      // Either side failing or closing ends both, so no half-open pair outlives the run.
      socket.on('error', () =>
        (socket === client ? upstream : client).destroy(),
      )
      socket.once('close', () =>
        (socket === client ? upstream : client).destroy(),
      )
    }
    client.pipe(upstream)
    upstream.pipe(client)
  })
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
    if (failure.code === 'EADDRINUSE' || failure.code === 'EACCES')
      throw new StudyError(
        'PREREQUISITE_MISSING',
        `Port ${port} is in use on this machine at [::1], and Codebook must own every loopback address that localhost reaches during the run: the app's own origin, such as AUTH_URL, points to localhost:${port}, so Codebook never starts it on another port. Ask the learner to stop the process that listens on [::1]:${port}, then start again.`,
      )
    throw failure
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
