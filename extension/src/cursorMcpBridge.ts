import { setTimeout as sleep } from 'node:timers/promises'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import {
  CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS,
  CURSOR_MCP_BRIDGE_REQUEST_TIMEOUT_MS,
  EXTENSION_VERSION,
} from './constants'
import {
  readBridgeDescriptor,
  type DescriptorExpectation,
} from './utils/readBridgeDescriptor'

/**
 * Connects `client` over `http` and bounds the whole handshake (initialize, then the initialized notification) by `timeoutMs`; called by {@link runCursorMcpBridge}.
 * The bundled SDK applies its `timeout` to the initialize request alone, so a server that answers initialize and then holds the notification would otherwise keep the bridge waiting past its deadline.
 * @param client - The MCP client to connect.
 * @param http - The HTTP transport to the instance.
 * @param timeoutMs - The budget for the complete handshake; the SDK's own request timeout applies when left out.
 * @throws When the handshake fails or does not finish in time; the caller closes the transport.
 * @example
 * await connectWithin(client, http, 3_000)
 */
async function connectWithin(
  client: Client,
  http: StreamableHTTPClientTransport,
  timeoutMs: number | undefined,
): Promise<void> {
  if (timeoutMs === undefined) return client.connect(http)
  const timer = new AbortController()
  try {
    await Promise.race([
      client.connect(http, { timeout: timeoutMs }),
      sleep(timeoutMs, undefined, { signal: timer.signal }).then(() => {
        throw new Error('Codebook connection did not finish in time.')
      }),
    ])
  } finally {
    timer.abort()
  }
}

/**
 * Releases an upstream session (one a failed handshake may have allocated, or one {@link runCursorMcpBridge} ends), without waiting longer than {@link CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS} for a server that no longer answers; called by {@link runCursorMcpBridge} before it closes a failed client and when it closes a session.
 * @param http - The transport whose session is released.
 * @example
 * await releaseHalfOpenSession(http)
 */
async function releaseHalfOpenSession(
  http: StreamableHTTPClientTransport,
): Promise<void> {
  // Initialize may have allocated a server session before the later initialized notification fails.
  await Promise.race([
    http.terminateSession().catch(() => undefined),
    // Unreferenced, so a finished release never keeps the process alive.
    sleep(CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS, undefined, { ref: false }),
  ])
}

/**
 * Says whether a failed request is the server's exact answer for a session it no longer knows, the one failure that is safe to retry once because the server rejects it before dispatch; called by {@link runCursorMcpBridge}'s forwarding.
 * @param error - What the request threw.
 * @returns `true` for HTTP 404 `Unknown MCP session`.
 * @example
 * isUnknownSession(new StreamableHTTPError(404, 'Unknown MCP session')) // => true
 */
function isUnknownSession(error: unknown): boolean {
  return (
    error instanceof StreamableHTTPError &&
    error.code === 404 &&
    error.message.includes('Unknown MCP session')
  )
}

/**
 * Says whether a failed request is the server refusing the bridge's credentials or its window (HTTP 401 or 403), the answers a removed setup and a rotated token produce before any session lookup; called by {@link runCursorMcpBridge}'s forwarding.
 * @param error - What the request threw.
 * @returns `true` for an HTTP 401 or 403.
 * @example
 * isRefusal(new StreamableHTTPError(403, 'Forbidden')) // => true
 */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof StreamableHTTPError &&
    (error.code === 401 || error.code === 403)
  )
}

/**
 * Bridges Cursor's stdio MCP transport to the authenticated instance selected by its extension window.
 * @param descriptorPath - The private connection descriptor of the instance.
 * @param connectTimeoutMs - Longest wait for reading the descriptor and the whole connection handshake together (initialize and the initialized notification); the Devin Desktop bridge passes its remaining startup budget. The SDK's own request timeout applies when left out.
 * @param expected - What the Devin Desktop bridge's selection validated; the descriptor read for the connection must still say the same, else nothing is sent. Cursor's bridge passes none.
 * @param extraHeader - A request header sent on every request to the server, beside the bearer token; the Devin Desktop bridge marks its requests with it ({@link DEVIN_BRIDGE_HEADER_NAME}). Cursor's bridge passes none.
 * @param onClosed - Called once the bridge's cleanup has completed after stdin closed or the stdio transport closed; the Devin Desktop bridge entry ends its process there, so a lookup that never settles cannot keep it alive. Cursor's bridge passes none and ends with its event loop.
 * @param beforeUpstream - Check run before every upstream reinitialization after the first connection (an expired session); when it resolves `false` the bridge ends (cleanup, then `onClosed`) instead of reconnecting, and when it rejects only that request fails. The Devin Desktop bridge passes its receipts check; Cursor's bridge passes none.
 * @param onRefused - Check run when the server refuses a request with HTTP 401 or 403 (a removed setup unmarks the window, a take-back rotates the token). When it resolves `false` the bridge ends as for `beforeUpstream`; when it resolves `true` or rejects, only that request fails; the request is never sent again, because only the exact 404 `Unknown MCP session` is safe to retry. The Devin Desktop bridge passes the same check as `beforeUpstream`; Cursor's bridge passes none and a refusal fails the request as before.
 * @throws When the descriptor is not private, is no valid descriptor (one fixed sentence, never its content), names a url that is not Codebook's loopback endpoint, differs from `expected`, the server does not finish the handshake in time or refuses the connection.
 * @example await runCursorMcpBridge('/private/current.connection.json')
 */
export async function runCursorMcpBridge(
  descriptorPath: string,
  connectTimeoutMs?: number,
  expected?: DescriptorExpectation,
  extraHeader?: { name: string; value: string },
  onClosed?: () => void,
  beforeUpstream?: () => Promise<boolean>,
  onRefused?: () => Promise<boolean>,
): Promise<void> {
  const startedAt = Date.now()
  // The read of the descriptor spends the same startup budget as the handshake.
  const descriptor = await readBridgeDescriptor(
    descriptorPath,
    expected,
    connectTimeoutMs,
  )
  const firstHandshakeMs =
    connectTimeoutMs === undefined
      ? undefined
      : Math.max(1, connectTimeoutMs - (Date.now() - startedAt))
  const connectUpstream = async (handshakeMs = connectTimeoutMs) => {
    const client = new Client({
      name: 'codebook-cursor-bridge',
      version: EXTENSION_VERSION,
    })
    const http = new StreamableHTTPClientTransport(new URL(descriptor.url), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${descriptor.token}`,
          ...(extraHeader && { [extraHeader.name]: extraHeader.value }),
        },
      },
    })
    try {
      await connectWithin(client, http, handshakeMs)
    } catch (error) {
      await releaseHalfOpenSession(http)
      await client.close()
      throw error
    }
    return { client, http }
  }
  const closeUpstream = async (
    connection: Awaited<ReturnType<typeof connectUpstream>>,
  ): Promise<void> => {
    // Releasing the HTTP session immediately keeps short Cursor restarts below the server's session limit; a server that accepted the DELETE and never answers must not keep the bridge alive, so the wait is bounded and failures (an expired session) are ignored.
    await releaseHalfOpenSession(connection.http)
    await connection.client.close()
  }
  let active = await connectUpstream(firstHandshakeMs)
  let reconnecting: Promise<void> | undefined,
    closed = false
  // Every refusal check that is still running (each bounded by its caller's own deadline); a stdin close drains them before `onClosed`, so the refusal line and its exit code are out first.
  const refusals = new Set<Promise<void>>()
  // Runs the refusal check of the Devin Desktop bridge: a setup that is gone ends the bridge; a standing setup, or a check that cannot answer, leaves it running.
  const endIfSetupGone = (): Promise<void> => {
    if (!onRefused) return Promise.resolve()
    const handling = onRefused()
      .catch(() => true)
      .then((stands) => {
        // The end path must not drain the set it belongs to: it would wait for itself.
        if (!stands) shutdownThenNotify(false)
      })
    refusals.add(handling)
    return handling.finally(() => refusals.delete(handling))
  }
  // Runs the refusal handling for a refused request (HTTP 401 or 403), then fails that request with the original error.
  const failAfterRefusal = async (error: unknown): Promise<never> => {
    if (isRefusal(error)) await endIfSetupGone()
    throw error
  }
  const forward = async <Value>(
    request: (client: Client) => Promise<Value>,
  ): Promise<Value> => {
    const previous = active
    try {
      return await request(previous.client)
    } catch (error) {
      // A refusal ends the bridge when its setup is gone; the request itself still fails and is not sent again.
      if (isRefusal(error)) await failAfterRefusal(error)
      // The local server rejects an expired session before dispatch, so this exact 404 is safe to retry once.
      if (!isUnknownSession(error)) throw error
      if (active === previous) {
        reconnecting ??= (async () => {
          // A setup removed elsewhere must not get a new session: end the bridge instead.
          if (beforeUpstream && !(await beforeUpstream())) {
            shutdownThenNotify(false)
            // True for a removed setup and a replaced one alike; the refusal line on stderr names which.
            throw new Error('Codebook setup changed; this bridge has ended.')
          }
          // A refused handshake runs the same refusal handling as a refused request.
          const next = await connectUpstream().catch(failAfterRefusal)
          if (closed) {
            await closeUpstream(next)
            throw new Error('Codebook Cursor MCP bridge has closed.')
          }
          active = next
          await closeUpstream(previous)
        })().finally(() => {
          reconnecting = undefined
        })
        await reconnecting
      } else if (reconnecting) await reconnecting
      // Only the 404 above authorizes this one replay; a refusal of it is handled like any other and is not replayed.
      return request(active.client).catch(failAfterRefusal)
    }
  }
  const capabilities = active.client.getServerCapabilities()
  const server = new Server(
    active.client.getServerVersion() ?? {
      name: 'codebook',
      version: EXTENSION_VERSION,
    },
    {
      capabilities: {
        tools: capabilities?.tools ?? {},
        resources: capabilities?.resources ?? {},
      },
      instructions: active.client.getInstructions(),
    },
  )
  server.setRequestHandler(ListToolsRequestSchema, (request, extra) =>
    forward((client) =>
      client.listTools(request.params, {
        signal: extra.signal,
        timeout: CURSOR_MCP_BRIDGE_REQUEST_TIMEOUT_MS,
      }),
    ),
  )
  // callTool takes its request options after the optional result schema, unlike discovery and resource reads.
  server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
    forward((client) =>
      client.callTool(request.params, undefined, {
        signal: extra.signal,
        timeout: CURSOR_MCP_BRIDGE_REQUEST_TIMEOUT_MS,
      }),
    ),
  )
  server.setRequestHandler(ListResourcesRequestSchema, (request, extra) =>
    forward((client) =>
      client.listResources(request.params, {
        signal: extra.signal,
        timeout: CURSOR_MCP_BRIDGE_REQUEST_TIMEOUT_MS,
      }),
    ),
  )
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    (request, extra) =>
      forward((client) =>
        client.listResourceTemplates(request.params, {
          signal: extra.signal,
          timeout: CURSOR_MCP_BRIDGE_REQUEST_TIMEOUT_MS,
        }),
      ),
  )
  server.setRequestHandler(ReadResourceRequestSchema, (request, extra) =>
    forward((client) =>
      client.readResource(request.params, {
        signal: extra.signal,
        timeout: CURSOR_MCP_BRIDGE_REQUEST_TIMEOUT_MS,
      }),
    ),
  )
  const stdio = new StdioServerTransport()
  let stopping: Promise<void> | undefined
  const shutdown = (): Promise<void> =>
    (stopping ??= (async () => {
      closed = true
      await reconnecting?.catch(() => undefined)
      try {
        await closeUpstream(active)
      } finally {
        await server.close()
      }
    })())
  // Waits until no refusal check is active; each check is bounded by its caller's own deadline.
  const drainActiveRefusals = async (): Promise<void> => {
    while (refusals.size > 0) await Promise.allSettled([...refusals])
  }
  // Runs the cleanup once, then tells the caller it is complete (never before).
  // One shared promise: stdin EOF during a reconnect check and the check's own refusal both reach it, and `onClosed` must run once.
  let notifying: Promise<void> | undefined
  // `drainRefusals` is false only on the refusal's own end path, which is itself one of the drained promises.
  const shutdownThenNotify = (drainRefusals = true): void => {
    notifying ??= Promise.allSettled(drainRefusals ? [...refusals] : [])
      .then(shutdown)
      .catch(() => undefined)
      // A refusal check can start while the upstream session is released; wait for those too (not on the refusal's own end path).
      .then(() => (drainRefusals ? drainActiveRefusals() : undefined))
      .then(() => onClosed?.())
  }
  stdio.onclose = (): void => shutdownThenNotify()
  try {
    await server.connect(stdio)
  } catch (error) {
    await closeUpstream(active)
    throw error
  }
  // The SDK stdio transport does not close itself on stdin EOF, so release the HTTP session explicitly.
  process.stdin.once('end', (): void => shutdownThenNotify())
  const stopForSignal = (): void => {
    void shutdown().then(
      () => {
        // A refusal's exit code 1 stays; only an unset code becomes 0.
        process.exitCode ??= 0
      },
      () => {
        process.exitCode = 1
      },
    )
  }
  process.once('SIGTERM', stopForSignal)
  process.once('SIGINT', stopForSignal)
}
