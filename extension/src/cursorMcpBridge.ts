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
 * Releases the session a failed handshake may have allocated, without waiting longer than {@link CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS} for a server that no longer answers; called by {@link runCursorMcpBridge} before it closes a failed client.
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
 * Bridges Cursor's stdio MCP transport to the authenticated instance selected by its extension window.
 * @param descriptorPath - The private connection descriptor of the instance.
 * @param connectTimeoutMs - Longest wait for the whole connection handshake (initialize and the initialized notification); the Devin Desktop bridge passes its remaining startup budget. The SDK's own request timeout applies when left out.
 * @param expected - What the Devin Desktop bridge's selection validated; the descriptor read for the connection must still say the same, else nothing is sent. Cursor's bridge passes none.
 * @throws When the descriptor is not private, is no valid descriptor (one fixed sentence, never its content), names a url that is not Codebook's loopback endpoint, differs from `expected`, the server does not finish the handshake in time or refuses the connection.
 * @example await runCursorMcpBridge('/private/current.connection.json')
 */
export async function runCursorMcpBridge(
  descriptorPath: string,
  connectTimeoutMs?: number,
  expected?: DescriptorExpectation,
): Promise<void> {
  const descriptor = await readBridgeDescriptor(descriptorPath, expected)
  const connectUpstream = async () => {
    const client = new Client({
      name: 'codebook-cursor-bridge',
      version: EXTENSION_VERSION,
    })
    const http = new StreamableHTTPClientTransport(new URL(descriptor.url), {
      requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
    })
    try {
      await connectWithin(client, http, connectTimeoutMs)
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
    // Releasing the HTTP session immediately keeps short Cursor restarts below the server's session limit.
    try {
      await connection.http.terminateSession()
    } catch {
      /* The session may already have expired. */
    }
    await connection.client.close()
  }
  let active = await connectUpstream()
  let reconnecting: Promise<void> | undefined,
    closed = false
  const forward = async <Value>(
    request: (client: Client) => Promise<Value>,
  ): Promise<Value> => {
    const previous = active
    try {
      return await request(previous.client)
    } catch (error) {
      // The local server rejects an expired session before dispatch, so this exact 404 is safe to retry once.
      if (
        !(error instanceof StreamableHTTPError) ||
        error.code !== 404 ||
        !error.message.includes('Unknown MCP session')
      )
        throw error
      if (active === previous) {
        reconnecting ??= (async () => {
          const next = await connectUpstream()
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
      return request(active.client)
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
  stdio.onclose = (): void => {
    void shutdown().catch(() => undefined)
  }
  try {
    await server.connect(stdio)
  } catch (error) {
    await closeUpstream(active)
    throw error
  }
  // The SDK stdio transport does not close itself on stdin EOF, so release the HTTP session explicitly.
  process.stdin.once('end', () => {
    void shutdown().catch(() => undefined)
  })
  const stopForSignal = (): void => {
    void shutdown().then(
      () => {
        process.exitCode = 0
      },
      () => {
        process.exitCode = 1
      },
    )
  }
  process.once('SIGTERM', stopForSignal)
  process.once('SIGINT', stopForSignal)
}
