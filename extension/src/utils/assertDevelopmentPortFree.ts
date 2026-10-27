import { createConnection, createServer, type Socket } from 'node:net'

import {
  DEVELOPMENT_PORT_PROBE_CONNECT_TIMEOUT_MS,
  DEVELOPMENT_PORT_RELEASE_POLL_MS,
  DEVELOPMENT_PORT_RELEASE_WAIT_MS,
} from '../constants'
import { StudyError } from '../errors'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  isOwnedDevelopmentPortReleasing,
  ownedDevelopmentPortState,
  type OwnedDevelopmentPortState,
} from './ownedDevelopmentPorts'
import type { DeclaredDevelopmentPort } from './readDeclaredDevelopmentPort'

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

/** Why a port cannot be used, for a caller that words the refusal itself ({@link PortCheckOptions.refuse}). */
export type PortRefusal = {
  port: number
  reason: 'in-use' | 'not-permitted' | 'held-by-codebook' | 'unreadable'
  /** For `held-by-codebook`: whether the earlier run still runs or is stopping. */
  heldBy?: OwnedDevelopmentPortState
  /** For `unreadable`: the operating system's error code of the bind probe. */
  errorCode?: string
}

/**
 * Asks whether something accepts a TCP connection on one loopback address.
 * A listener bound to `::` or `::1` (the learner's `next dev`) does not stop a bind to 127.0.0.1, so binding alone cannot see it.
 * @param signal - The run's cancellation; an abort ends the pending connect at once instead of after its timeout (F456).
 * @returns `true` only for an accepted connection; `false` for every error (refused, no such address, EPERM…) and for a timeout (Windows reports a refused loopback connect only after 1 to 2 s of SYN retries, so a timeout proves nothing); the bind probe decides.
 * @throws The signal's reason when the run is cancelled.
 * @example await isListeningAt(createConnection, '::1', 3165) // true while the learner's dev server runs
 */
function isListeningAt(
  connect: ConnectLoopback,
  host: string,
  port: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    // A run already cancelled opens no connection.
    if (signal?.aborted) return reject(signal.reason)
    const socket = connect({ host, port })
    const onAbort = (): void => {
      socket.destroy()
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    socket.once('close', () => signal?.removeEventListener('abort', onAbort))
    socket.setTimeout(DEVELOPMENT_PORT_PROBE_CONNECT_TIMEOUT_MS)
    socket.once('connect', () => {
      signal?.removeEventListener('abort', onAbort)
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      signal?.removeEventListener('abort', onAbort)
      socket.destroy()
      resolve(false)
    })
    // Any connect error (refused, EPERM, ETIMEDOUT, ECONNRESET…) proves no accepted connection; the bind probe decides.
    socket.once('error', () => {
      signal?.removeEventListener('abort', onAbort)
      socket.destroy()
      resolve(false)
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

/** Looks once at a port: a connection to either loopback address or a refused bind means taken; EACCES means the host does not let Codebook listen there.
 * @throws `PREREQUISITE_MISSING` naming the port and the error code only, for any other bind failure (F559). */
async function lookAtPort(
  port: number,
  connect: ConnectLoopback,
  bind: BindProbe,
  signal?: AbortSignal,
  refuse?: PortCheckOptions['refuse'],
): Promise<PortState> {
  if (
    (await isListeningAt(connect, '127.0.0.1', port, signal)) ||
    (await isListeningAt(connect, '::1', port, signal))
  )
    return 'in-use'
  const failure = await bind(port)
  // A cancel during the bind probe is honored as soon as the probe returns.
  signal?.throwIfAborted()
  if (!failure) return 'free'
  if (failure.code === 'EADDRINUSE') return 'in-use'
  if (failure.code === 'EACCES') return 'not-permitted'
  // Any other bind failure is a typed refusal naming the port and the error code only (as F453 does for [::1]).
  const code = /^[A-Z0-9_]{1,32}$/.test(failure.code ?? '')
    ? failure.code
    : 'unknown error'
  if (refuse)
    throw await refuse({ port, reason: 'unreadable', errorCode: code })
  throw new StudyError(
    'PREREQUISITE_MISSING',
    `Codebook could not check whether port ${port} is free (${code}), and the project declares it, so Codebook never starts the app on another port. Ask the learner to resolve the network problem on this machine or to declare another port for the project, then start again.`,
    `bind ${code} on 127.0.0.1:${port}`,
  )
}

/**
 * Waits, within the release budget, for a Codebook run that is stopping to let go of a port, looking at the port again on each poll.
 * @param port - The declared port.
 * @param first - What the first look found.
 * @param look - Looks at the port once.
 * @param options - The release wait and the run's cancellation.
 * @returns The last look; a wait that ran out of budget is not an error here, the caller refuses on what was last seen.
 * @example await waitForOwnedRelease(3165, 'in-use', look, {}) // => 'free' once the earlier run has released it
 */
async function waitForOwnedRelease(
  port: number,
  first: PortState,
  look: () => Promise<PortState>,
  options: PortCheckOptions,
): Promise<PortState> {
  const latest: { state: PortState } = { state: first }
  await waitUntil(
    async () => {
      latest.state = await look()
      return !isOwnedDevelopmentPortReleasing(port) && latest.state !== 'in-use'
    },
    `port ${port} released by Codebook's earlier run`,
    options.releaseWaitMs ?? DEVELOPMENT_PORT_RELEASE_WAIT_MS,
    options.signal,
    DEVELOPMENT_PORT_RELEASE_POLL_MS,
  ).catch((error: unknown) => {
    // Only the end of the budget is expected; a cancel or a probe failure surfaces.
    if (!(error instanceof WaitTimeoutError)) throw error
  })
  return latest.state
}

/**
 * Names why a port that is not free cannot be used, for a caller that words the refusal itself.
 * @param port - The declared port.
 * @param state - What the last look found.
 * @param owned - Whether a Codebook run holds the port, and in which state.
 * @returns The reason: not permitted, in use by someone else, or held by a Codebook run.
 * @example refusalOf(3165, 'in-use', undefined) // => { port: 3165, reason: 'in-use' }
 */
function refusalOf(
  port: number,
  state: PortState,
  owned: OwnedDevelopmentPortState | undefined,
): PortRefusal {
  if (state === 'not-permitted') return { port, reason: 'not-permitted' }
  if (owned === undefined) return { port, reason: 'in-use' }
  return { port, reason: 'held-by-codebook', heldBy: owned }
}

/** Test seams of {@link assertDevelopmentPortFree}; production passes none. */
export type PortCheckOptions = {
  connect?: ConnectLoopback
  bind?: BindProbe
  /** Replaces {@link DEVELOPMENT_PORT_RELEASE_WAIT_MS}. */
  releaseWaitMs?: number
  /** Ends the wait for a stopping run when the run is cancelled. */
  signal?: AbortSignal
  /** Words the refusal in place of the Next wording and error code, as the node-server run does with `PORT_UNAVAILABLE`; the check itself is the same. */
  refuse?: (refusal: PortRefusal) => StudyError | Promise<StudyError>
}

/**
 * Refuses the start when something already listens on the project's own port, so the run never falls back to another port.
 *
 * Called during repository-browser preparation by {@link ConfiguredBrowserRun}, before the app is started.
 * A listener is found by connecting to `127.0.0.1` and `[::1]` (a wildcard or IPv6 listener does not block a bind) and by binding the address Codebook uses.
 * A port that another Codebook run has claimed and still runs is refused even when the probe reads it free, because that run's `next dev` may not have bound yet (F449).
 * A port that Codebook's own earlier run is still releasing is waited for within {@link DEVELOPMENT_PORT_RELEASE_WAIT_MS}; if it stays busy the refusal names that run, not the learner's dev server.
 *
 * @param declared - The port and where it was declared ({@link readDeclaredDevelopmentPort}).
 * @param options - Test seams: the connect, the bind and the release wait; and `refuse`, which words the refusal for another profile.
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
  const look = (): Promise<PortState> =>
    lookAtPort(port, connect, bind, options.signal, options.refuse)
  let state = await look()
  // A run Codebook is stopping releases the port within moments, and a new listener would break its listener check; wait for the release whatever the first look found.
  if (isOwnedDevelopmentPortReleasing(port))
    state = await waitForOwnedRelease(port, state, look, options)
  const owned = ownedDevelopmentPortState(port)
  // A free port holds no listener, whatever a stuck (stopping) claim says. Another run's live claim still refuses: that run has claimed the port and its `next dev` has not bound yet, so a free probe only means it is early (F449).
  if (state === 'free' && owned !== 'running') return
  if (options.refuse) throw await options.refuse(refusalOf(port, state, owned))
  const pinned = `the project declares it (${source}): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port.`
  if (state === 'not-permitted')
    throw new StudyError(
      'PREREQUISITE_MISSING',
      `Port ${port} is not permitted for Codebook on this machine (the operating system refuses to let this program listen on it, as for a port below 1024 without administrator rights or a port range the system reserves), and ${pinned} Ask the learner to declare a port from 1024 up for the project (the -p/--port of next dev or a PORT= in the dev script), or to allow listening on port ${port}, then start again.`,
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
