import { createConnection, createServer } from 'node:net'

import { DEVELOPMENT_PORT_PROBE_CONNECT_TIMEOUT_MS } from '../constants'
import { StudyError } from '../errors'

import type { DeclaredDevelopmentPort } from './readDeclaredDevelopmentPort'

/** Connect errors that prove nothing listens there (or that the host has no such loopback address). */
const NOT_LISTENING_CODES = new Set([
  'ECONNREFUSED',
  'EADDRNOTAVAIL',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAFNOSUPPORT',
])

/**
 * Asks whether something accepts a TCP connection on one loopback address.
 * A listener bound to `::` or `::1` (the learner's `next dev`) does not stop a bind to 127.0.0.1, so binding alone cannot see it.
 * @returns `true` for a connection or a timeout (a filtered loopback port is treated as taken); `false` when the connect is refused or the address does not exist.
 * @throws An unexpected socket error.
 * @example await isListeningAt('::1', 3165) // true while the learner's dev server runs
 */
function isListeningAt(host: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port })
    socket.setTimeout(DEVELOPMENT_PORT_PROBE_CONNECT_TIMEOUT_MS)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy()
      if (error.code && NOT_LISTENING_CODES.has(error.code)) resolve(false)
      else reject(error)
    })
  })
}

/** Tries to bind the address Codebook's `next dev` binds; `true` when the bind fails because the port is taken or not allowed. */
async function isBindRefused(port: number): Promise<boolean> {
  const probe = createServer()
  const failure = await new Promise<NodeJS.ErrnoException | undefined>(
    (resolve) => {
      probe.once('error', resolve)
      probe.listen({ host: '127.0.0.1', port }, () =>
        probe.close(() => resolve(undefined)),
      )
    },
  )
  if (!failure) return false
  if (failure.code !== 'EADDRINUSE' && failure.code !== 'EACCES') throw failure
  return true
}

/**
 * Refuses the start when something already listens on the project's own port, so the run never falls back to another port.
 *
 * Called during repository-browser preparation by {@link ConfiguredBrowserRun}, before the app is started.
 * A listener is found by connecting to `127.0.0.1` and `[::1]` (a wildcard or IPv6 listener does not block a bind) and by binding the address Codebook uses.
 *
 * @param declared - The port and where it was declared ({@link readDeclaredDevelopmentPort}).
 * @throws `PREREQUISITE_MISSING` naming the port, why it matters and the recovery, when the port is in use or cannot be bound.
 *
 * @example
 * ```ts
 * await assertDevelopmentPortFree({ port: 3165, source: 'the dev script in package.json' })
 * ```
 */
export async function assertDevelopmentPortFree(
  declared: DeclaredDevelopmentPort,
): Promise<void> {
  const isTaken =
    (await isListeningAt('127.0.0.1', declared.port)) ||
    (await isListeningAt('::1', declared.port)) ||
    (await isBindRefused(declared.port))
  if (!isTaken) return
  throw new StudyError(
    'PREREQUISITE_MISSING',
    `Port ${declared.port} is in use on this machine, and the project declares it (${declared.source}): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Ask the learner to stop the process that listens on port ${declared.port} (often their own dev server), then start again.`,
  )
}
