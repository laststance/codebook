import { createConnection, createServer, type Socket } from 'node:net'

import {
  DEVELOPMENT_PORT_PROBE_CONNECT_TIMEOUT_MS,
  DEVELOPMENT_PORT_RELEASE_POLL_MS,
  DEVELOPMENT_PORT_RELEASE_WAIT_MS,
} from '../constants'
import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { ownedDevelopmentPortState } from './ownedDevelopmentPorts'
import type { DeclaredDevelopmentPort } from './readDeclaredDevelopmentPort'

/** Connect errors that prove nothing listens there (or that the host has no such loopback address). */
const NOT_LISTENING_CODES = new Set([
  'ECONNREFUSED',
  'EADDRNOTAVAIL',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAFNOSUPPORT',
])

/** Opens one loopback connection attempt; {@link createConnection} in production, a stand-in in tests. */
export type ConnectLoopback = (options: {
  host: string
  port: number
}) => Socket

/** Tries to bind the address Codebook uses and returns the failure, if any; `undefined` when the port can be bound. */
export type BindProbe = (
  port: number,
) => Promise<NodeJS.ErrnoException | undefined>

/** What one look at a port found. */
type PortState = 'free' | 'in-use' | 'not-permitted'

/**
 * Asks whether something accepts a TCP connection on one loopback address.
 * A listener bound to `::` or `::1` (the learner's `next dev`) does not stop a bind to 127.0.0.1, so binding alone cannot see it.
 * @returns `true` only for an accepted connection; `false` when the connect is refused, the address does not exist, or the connect times out (Windows reports a refused loopback connect only after 1 to 2 s of SYN retries, so a timeout proves nothing and the bind probe decides).
 * @throws An unexpected socket error.
 * @example await isListeningAt(createConnection, '::1', 3165) // true while the learner's dev server runs
 */
function isListeningAt(
  connect: ConnectLoopback,
  host: string,
  port: number,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port })
    socket.setTimeout(DEVELOPMENT_PORT_PROBE_CONNECT_TIMEOUT_MS)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy()
      if (error.code && NOT_LISTENING_CODES.has(error.code)) resolve(false)
      else reject(error)
    })
  })
}

/** Tries to bind the address Codebook's `next dev` binds and returns the failure; the production {@link BindProbe}. */
const tryBind: BindProbe = async (port) => {
  const probe = createServer()
  return new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
    probe.once('error', resolve)
    probe.listen({ host: '127.0.0.1', port }, () =>
      probe.close(() => resolve(undefined)),
    )
  })
}

/** Looks once at a port: a connection to either loopback address or a refused bind means taken; EACCES means the host does not let Codebook listen there. */
async function lookAtPort(
  port: number,
  connect: ConnectLoopback,
  bind: BindProbe,
): Promise<PortState> {
  if (
    (await isListeningAt(connect, '127.0.0.1', port)) ||
    (await isListeningAt(connect, '::1', port))
  )
    return 'in-use'
  const failure = await bind(port)
  if (!failure) return 'free'
  if (failure.code === 'EADDRINUSE') return 'in-use'
  if (failure.code === 'EACCES') return 'not-permitted'
  throw failure
}

/** Test seams of {@link assertDevelopmentPortFree}; production passes none. */
export type PortCheckOptions = {
  connect?: ConnectLoopback
  bind?: BindProbe
  /** Replaces {@link DEVELOPMENT_PORT_RELEASE_WAIT_MS}. */
  releaseWaitMs?: number
}

/**
 * Refuses the start when something already listens on the project's own port, so the run never falls back to another port.
 *
 * Called during repository-browser preparation by {@link ConfiguredBrowserRun}, before the app is started.
 * A listener is found by connecting to `127.0.0.1` and `[::1]` (a wildcard or IPv6 listener does not block a bind) and by binding the address Codebook uses.
 * A port that Codebook's own earlier run is still releasing is waited for within {@link DEVELOPMENT_PORT_RELEASE_WAIT_MS}; if it stays busy the refusal names that run, not the learner's dev server.
 *
 * @param declared - The port and where it was declared ({@link readDeclaredDevelopmentPort}).
 * @param options - Test seams: the connect, the bind and the release wait.
 * @throws `PREREQUISITE_MISSING` naming the port, why it matters and the recovery, when the port is in use, held by a Codebook run, or not permitted to Codebook.
 *
 * @example
 * ```ts
 * await assertDevelopmentPortFree({ port: 3165, source: 'the dev script in package.json' })
 * ```
 */
export async function assertDevelopmentPortFree(
  declared: DeclaredDevelopmentPort,
  options: PortCheckOptions = {},
): Promise<void> {
  const connect = options.connect ?? createConnection
  const bind = options.bind ?? tryBind
  const { port, source } = declared
  let state = await lookAtPort(port, connect, bind)
  if (state === 'free') return
  const owned = ownedDevelopmentPortState(port)
  // A run Codebook is stopping releases the port within moments; wait for it before judging.
  if (state === 'in-use' && owned === 'stopping') {
    const latest: { state: PortState } = { state }
    await waitUntil(
      async () =>
        (latest.state = await lookAtPort(port, connect, bind)) !== 'in-use',
      `port ${port} released by Codebook's earlier run`,
      options.releaseWaitMs ?? DEVELOPMENT_PORT_RELEASE_WAIT_MS,
      undefined,
      DEVELOPMENT_PORT_RELEASE_POLL_MS,
    ).catch(() => undefined)
    if (latest.state === 'free') return
    state = latest.state
  }
  const pinned = `the project declares it (${source}): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port.`
  if (state === 'not-permitted')
    throw new StudyError(
      'PREREQUISITE_MISSING',
      `Port ${port} is not permitted for Codebook on this machine (the operating system refuses to let this program listen on it, as for a port below 1024 without administrator rights or a port range the system reserves), and ${pinned} Ask the learner to declare a port from 1024 up for the project (the dev script's -p/--port or PORT in an env file), or to allow listening on port ${port}, then start again.`,
    )
  if (owned !== undefined)
    throw new StudyError(
      'PREREQUISITE_MISSING',
      `Port ${port} is still held by an earlier Codebook repository-browser run${owned === 'stopping' ? ' that has not finished stopping' : ' that is still running'}, and ${pinned} Stop that run (codebook_stop) and wait for it to finish stopping, then start again.`,
    )
  throw new StudyError(
    'PREREQUISITE_MISSING',
    `Port ${port} is in use on this machine, and ${pinned} Ask the learner to stop the process that listens on port ${port} (often their own dev server), then start again.`,
  )
}
