import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

import {
  API_VERSION,
  DYNAMIC_PORT,
  HTTP_BODY_LIMIT_BYTES,
  HTTP_HEADER_LIMIT_BYTES,
  HTTP_READ_TIMEOUT_MS,
  LOOPBACK_ADDRESS,
  MAINTENANCE_INTERVAL_MS,
  MAX_IN_FLIGHT_REQUESTS,
  MAX_SESSIONS,
  SESSION_IDLE_TIMEOUT_MS,
  TOKEN_BYTES,
} from './constants'
import { DEVIN_BRIDGE_NOT_SET_UP_SENTENCE } from './devinWindowSentences'
import { createProtocol } from './protocol'
import type { StudyService } from './service'
import { isDevinBridgeRequestRefused } from './utils/isDevinBridgeRequestRefused'

interface Session {
  transport: StreamableHTTPServerTransport
  protocol: ReturnType<typeof createProtocol>
  lastSeen: number
  active: number
}
export interface ConnectionDescriptor {
  url: string
  token: string
  instanceId: string
  workspace: string
  apiVersion: string
}

/** Returns fixed HTTP failures before the MCP boundary without echoing credentials. @example rejectHttp(response, 401, 'Unauthorized') */
function rejectHttp(
  response: ServerResponse,
  status: number,
  reason: string,
): void {
  if (response.headersSent || response.destroyed) return
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    connection: 'close',
  })
  response.end(JSON.stringify({ error: reason }))
}

/**
 * Enforces an absolute bounded body read; called only after authorization.
 * @param request - The authorized request.
 * @param response - Receives the 4xx failure of a bad body.
 * @param onChunk - Test seam: called with each received chunk, so a test can wait until the server has the start of a body.
 * @example await readBody(request, response, onBodyChunk)
 */
async function readBody(
  request: IncomingMessage,
  response: ServerResponse,
  onChunk?: () => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0,
      settled = false
    const finish = (error?: Error, value?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('error', onError)
      request.removeListener('aborted', onAbort)
      if (error) reject(error)
      else resolve(value)
    }
    const onError = (error: Error): void => finish(error)
    const onAbort = (): void => finish(new Error('Request aborted'))
    const onData = (chunk: Buffer): void => {
      onChunk?.()
      size += chunk.length
      if (size > HTTP_BODY_LIMIT_BYTES) {
        rejectHttp(response, 413, 'Request body too large')
        request.resume()
        finish(new Error('Body limit'))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = (): void => {
      try {
        finish(undefined, JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        rejectHttp(response, 400, 'Invalid JSON')
        finish(new Error('Invalid JSON'))
      }
    }
    const timer = setTimeout(() => {
      rejectHttp(response, 408, 'Request body deadline exceeded')
      finish(new Error('Body timeout'))
      request.destroy()
    }, HTTP_READ_TIMEOUT_MS)
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onAbort)
  })
}

const SESSION_LIMIT_SENTENCE =
  'MCP session limit exceeded; every session has a request in flight. Retry after one completes.'

/**
 * Tells whether any session has no request in flight, so an initialization at the session limit can replace one.
 * @param sessions - The live sessions by id.
 * @returns `true` when at least one session is idle.
 * @example hasIdleSession(new Map()) // => false
 */
function hasIdleSession(sessions: ReadonlyMap<string, Session>): boolean {
  return [...sessions.values()].some((candidate) => !candidate.active)
}

/**
 * Takes room for one admitted initialization in a single synchronous step: at the session limit the least recently seen idle session leaves `sessions` at once, so a request for it answers Unknown MCP session and no two initializations pick the same one.
 * @param sessions - The live sessions by id; the picked one is deleted from it.
 * @param admittedCount - Reserved sessions that already took their slot and are not in `sessions` yet.
 * @returns
 * - `undefined` when there is room and nobody was replaced
 * - The picked session, already removed from `sessions`, which the caller closes
 * - `'full'` when every session has a request in flight
 * @example takeSessionRoom(new Map(), 0) // => undefined
 */
function takeSessionRoom(
  sessions: Map<string, Session>,
  admittedCount: number,
): Session | undefined | 'full' {
  if (sessions.size + admittedCount < MAX_SESSIONS) return undefined
  // Clients that end without DELETE leave idle sessions behind; only busy sessions refuse.
  let oldest: [string, Session] | undefined
  for (const entry of sessions) {
    if (!entry[1].active && (!oldest || entry[1].lastSeen < oldest[1].lastSeen))
      oldest = entry
  }
  if (!oldest) return 'full'
  sessions.delete(oldest[0])
  return oldest[1]
}

/**
 * Hosts authenticated SDK sessions separately from application runs; editor commands own its lifetime.
 * @param service - The study service the sessions talk to.
 * @param now - The clock; tests replace it.
 * @param isDevinChatEnabled - Tells whether this window's Devin AI chat mark is on; a request that carries the Devin bridge header is refused with 403 while it says `false`. Left out, no request is refused for its header (Cursor's window, tests).
 * @param onBodyChunk - Test seam: called whenever a request body chunk arrives.
 * @example const endpoint = await startServer(service)
 */
export async function startServer(
  service: StudyService,
  now = Date.now,
  isDevinChatEnabled?: () => boolean,
  onBodyChunk?: () => void,
) {
  let token = randomBytes(TOKEN_BYTES).toString('hex')
  let expected = Buffer.from(`Bearer ${token}`)
  let generation = 0
  const sessions = new Map<string, Session>()
  const pendingSessions = new Set<Session>()
  // Reserved sessions whose initialization passed the dispatch-time gate and took its slot: with the live sessions they never exceed MAX_SESSIONS.
  const admittedSessions = new Set<Session>()
  let origin = '',
    stopping = false,
    inFlight = 0
  // Compares against the token current now: a rotation committed while a body was read changes the answer.
  const hasCurrentToken = (authorization: string | undefined): boolean => {
    const supplied = Buffer.from(authorization ?? '')
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    )
  }
  const rejectUnauthorized = (response: ServerResponse): void =>
    rejectHttp(
      response,
      401,
      'Unauthorized. Copy the current connection from the editor after restart.',
    )
  // HTTP session close -> release transport. Only service.shutdown() releases application runs.
  const server = createServer(
    {
      maxHeaderSize: HTTP_HEADER_LIMIT_BYTES,
      headersTimeout: HTTP_READ_TIMEOUT_MS,
      requestTimeout: HTTP_READ_TIMEOUT_MS,
      connectionsCheckingInterval: MAINTENANCE_INTERVAL_MS,
    },
    (request, response) => {
      void (async () => {
        if (!hasCurrentToken(request.headers.authorization)) {
          rejectUnauthorized(response)
          return
        }
        if (
          request.headers.host !== new URL(origin).host ||
          (request.headers.origin !== undefined &&
            request.headers.origin !== origin)
        ) {
          rejectHttp(response, 403, 'Host or Origin is not allowed')
          return
        }
        if (request.url !== '/mcp') {
          rejectHttp(response, 404, 'Unknown endpoint')
          return
        }
        if (stopping) {
          rejectHttp(response, 503, 'Server stopping')
          return
        }
        if (!['POST', 'DELETE'].includes(request.method ?? '')) {
          response.setHeader('allow', 'POST, DELETE')
          rejectHttp(response, 405, 'No standalone notification stream')
          return
        }
        if (inFlight >= MAX_IN_FLIGHT_REQUESTS) {
          rejectHttp(response, 429, 'Concurrent request limit exceeded')
          return
        }
        inFlight += 1
        let session: Session | undefined
        try {
          const body =
            request.method === 'POST'
              ? await readBody(request, response, onBodyChunk)
              : undefined
          if (stopping) {
            rejectHttp(response, 503, 'Server stopping')
            return
          }
          // A token committed during the body read (a rolled-back setup) refuses this request before any session is reserved.
          if (!hasCurrentToken(request.headers.authorization)) {
            rejectUnauthorized(response)
            return
          }
          const sessionId = request.headers['mcp-session-id']
          if (typeof sessionId === 'string') session = sessions.get(sessionId)
          else if (
            sessionId === undefined &&
            request.method === 'POST' &&
            isInitializeRequest(body)
          ) {
            // Before any session is reserved or evicted: a refused Devin initialization must not push another client's idle session out at MAX_SESSIONS.
            if (
              isDevinBridgeRequestRefused(request.headers, isDevinChatEnabled)
            ) {
              rejectHttp(response, 403, DEVIN_BRIDGE_NOT_SET_UP_SENTENCE)
              return
            }
            // Early refusal only: the room is taken synchronously at dispatch, so a request that finds no idle session at MAX_SESSIONS does not build a transport.
            if (
              sessions.size + admittedSessions.size >= MAX_SESSIONS &&
              !hasIdleSession(sessions)
            ) {
              rejectHttp(response, 429, SESSION_LIMIT_SENTENCE)
              return
            }
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: randomUUID,
              enableJsonResponse: true,
              onsessioninitialized: (sessionId) => {
                if (session) {
                  pendingSessions.delete(session)
                  admittedSessions.delete(session)
                  sessions.set(sessionId, session)
                }
              },
              onsessionclosed: (sessionId) => {
                sessions.delete(sessionId)
              },
              allowedHosts: [new URL(origin).host],
              allowedOrigins: [origin],
              enableDnsRebindingProtection: true,
            })
            session = {
              transport,
              protocol: createProtocol(service),
              lastSeen: now(),
              active: 0,
            }
            pendingSessions.add(session)
            try {
              await session.protocol.connect(transport)
            } catch (error) {
              // One scope from the reserved slot to the connected session: whatever fails in between gives the slot back.
              pendingSessions.delete(session)
              admittedSessions.delete(session)
              await session.protocol.close()
              throw error
            }
            const ownedSession = session,
              priorClose = transport.onclose
            transport.onclose = (): void => {
              priorClose?.()
              pendingSessions.delete(ownedSession)
              admittedSessions.delete(ownedSession)
              if (transport.sessionId) sessions.delete(transport.sessionId)
            }
          }
          if (!session) {
            rejectHttp(
              response,
              404,
              'Unknown MCP session. Initialize a new transport, then read codebook_status.',
            )
            return
          }
          if (stopping) {
            await session.protocol.close()
            rejectHttp(response, 503, 'Server stopping')
            return
          }
          // Right before dispatch, after the body was read: a Devin bridge request is refused once this window's AI chat mark is off, also one whose body was held open across the unmark.
          const isInitialization = pendingSessions.has(session)
          // Re-checked with no await up to the dispatch: a rotation committed while the transport connected must not let the old token through.
          if (!hasCurrentToken(request.headers.authorization)) {
            if (isInitialization) {
              pendingSessions.delete(session)
              // Best effort: a failed close of the reserved session must not turn the refusal into a 500.
              await session.protocol.close().catch(() => undefined)
            }
            rejectUnauthorized(response)
            return
          }
          if (
            isDevinBridgeRequestRefused(
              request.headers,
              isDevinChatEnabled,
              request.method,
            )
          ) {
            // An initialization of this request reserved the session (it has no id yet): give the slot back.
            if (isInitialization) {
              pendingSessions.delete(session)
              await session.protocol.close().catch(() => undefined)
            }
            rejectHttp(response, 403, DEVIN_BRIDGE_NOT_SET_UP_SENTENCE)
            return
          }
          if (isInitialization) {
            // One synchronous step, no await between choosing and deleting: the least recently seen idle session leaves at once (a request for it now answers Unknown MCP session) and the new one takes its slot.
            const room = takeSessionRoom(sessions, admittedSessions.size)
            if (room === 'full') {
              pendingSessions.delete(session)
              await session.protocol.close().catch(() => undefined)
              rejectHttp(response, 429, SESSION_LIMIT_SENTENCE)
              return
            }
            const replaced = room
            admittedSessions.add(session)
            // Best effort close, not awaited: no client can reach it any more, its failed close must not refuse the new client, and an await here would let the final checks go stale before dispatch.
            void replaced?.protocol.close().catch(() => undefined)
          }
          session.lastSeen = now()
          session.active += 1
          try {
            await session.transport.handleRequest(request, response, body)
          } finally {
            session.active -= 1
            session.lastSeen = now()
            if (!session.transport.sessionId) {
              pendingSessions.delete(session)
              admittedSessions.delete(session)
              await session.protocol.close()
            }
          }
        } finally {
          inFlight -= 1
        }
      })().catch(() =>
        rejectHttp(
          response,
          500,
          'MCP request failed; reconnect and inspect existing run state.',
        ),
      )
    },
  )
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(DYNAMIC_PORT, LOOPBACK_ADDRESS, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing loopback address')
  origin = `http://${LOOPBACK_ADDRESS}:${address.port}`
  const expire = async (): Promise<void> => {
    await Promise.allSettled(
      [...sessions.values()]
        .filter(
          (session) =>
            !session.active &&
            now() - session.lastSeen >= SESSION_IDLE_TIMEOUT_MS,
        )
        .map((session) => session.protocol.close()),
    )
  }
  const timer = setInterval(() => {
    void expire()
  }, MAINTENANCE_INTERVAL_MS)
  timer.unref()
  const descriptor: ConnectionDescriptor = {
    url: `${origin}/mcp`,
    token,
    instanceId: service.instanceId,
    workspace: service.environment.workspace,
    apiVersion: API_VERSION,
  }
  let closePromise: Promise<void> | undefined
  return {
    descriptor,
    expire,
    /**
     * Prepares the next bearer token without switching to it, so the caller can write it into the connection descriptor first and switch only once that write carried it; called by the extension when a failed Devin Desktop setup is taken back, because a bridge of an earlier build sends no Devin header and only the token can stop it.
     * `commit` makes the server refuse the old token with 401 and accept the new one, and counts one more {@link tokenGeneration}; a prepared token that is never committed changes nothing.
     * @returns The next token and the `commit` that switches to it.
     * @example const next = endpoint.prepareTokenRotation(); await writeIt(next.token); next.commit()
     */
    prepareTokenRotation(): { token: string; commit: () => void } {
      const nextToken = randomBytes(TOKEN_BYTES).toString('hex')
      return {
        token: nextToken,
        commit: (): void => {
          token = nextToken
          expected = Buffer.from(`Bearer ${token}`)
          descriptor.token = token
          generation += 1
        },
      }
    },
    /** How many times the bearer token was switched; the VS Code MCP definition's version includes it, so a client re-resolves the definition (and its bearer) after a switch. Never the token or a hash of it. */
    get tokenGeneration(): number {
      return generation
    },
    get listening(): boolean {
      return server.listening && !stopping
    },
    get resourcesReleased(): boolean {
      return service.resourcesReleased
    },
    /** Closes transport independently of owned cleanup failures; editor commands can retry service release. @example await endpoint.close() */
    async close(): Promise<void> {
      stopping = true
      clearInterval(timer)
      const attempt = (closePromise ??= (async () => {
        const results = await Promise.allSettled([
          service.shutdown(),
          ...[...sessions.values(), ...pendingSessions].map((session) =>
            session.protocol.close(),
          ),
        ])
        await new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        })
        const failures = results.flatMap((result) =>
          result.status === 'rejected' ? [String(result.reason)] : [],
        )
        if (failures.length) throw new Error(failures.join('; '))
      })())
      try {
        await attempt
      } catch (error) {
        closePromise = undefined
        throw error
      }
    },
  }
}
