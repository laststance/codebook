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
import { createProtocol } from './protocol'
import type { StudyService } from './service'

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

/** Enforces an absolute bounded body read; called only after authorization. @example await readBody(request, response) */
async function readBody(
  request: IncomingMessage,
  response: ServerResponse,
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

/** Hosts authenticated SDK sessions separately from application runs; editor commands own its lifetime. @example const endpoint = await startServer(service) */
export async function startServer(service: StudyService, now = Date.now) {
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  const sessions = new Map<string, Session>()
  const pendingSessions = new Set<Session>()
  let origin = '',
    stopping = false,
    inFlight = 0
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
        const supplied = Buffer.from(request.headers.authorization ?? '')
        if (
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        ) {
          rejectHttp(
            response,
            401,
            'Unauthorized. Copy the current connection from the editor after restart.',
          )
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
              ? await readBody(request, response)
              : undefined
          if (stopping) {
            rejectHttp(response, 503, 'Server stopping')
            return
          }
          const sessionId = request.headers['mcp-session-id']
          if (typeof sessionId === 'string') session = sessions.get(sessionId)
          else if (
            sessionId === undefined &&
            request.method === 'POST' &&
            isInitializeRequest(body)
          ) {
            if (sessions.size + pendingSessions.size >= MAX_SESSIONS) {
              rejectHttp(
                response,
                429,
                'MCP session limit exceeded; close idle clients.',
              )
              return
            }
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: randomUUID,
              enableJsonResponse: true,
              onsessioninitialized: (sessionId) => {
                if (session) {
                  pendingSessions.delete(session)
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
              pendingSessions.delete(session)
              await session.protocol.close()
              throw error
            }
            const ownedSession = session,
              priorClose = transport.onclose
            transport.onclose = (): void => {
              priorClose?.()
              pendingSessions.delete(ownedSession)
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
          session.lastSeen = now()
          session.active += 1
          try {
            await session.transport.handleRequest(request, response, body)
          } finally {
            session.active -= 1
            session.lastSeen = now()
            if (!session.transport.sessionId) {
              pendingSessions.delete(session)
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
