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
import { runUnderAbortSignal } from './utils/runUnderAbortSignal'

/** The error of a request refused because the bridge's stop began, and the reason its stop signal carries. */
const BRIDGE_CLOSED_SENTENCE = 'Codebook Cursor MCP bridge has closed.'

/**
 * Connects `client` over `http` and bounds the whole handshake (initialize, then the initialized notification) by `timeoutMs`, and ends the wait at once when the bridge's stop begins; called by {@link runCursorMcpBridge} for its first connection and for every reconnect.
 * The bundled SDK applies its `timeout` to the initialize request alone, so a server that answers initialize and then holds the notification would otherwise keep the bridge waiting past its deadline. The SDK is not given `stop`: the handshake keeps running until the caller closes the client.
 * @param client - The MCP client to connect.
 * @param http - The HTTP transport to the instance.
 * @param timeoutMs - The budget for the complete handshake; the SDK's own request timeout applies when left out.
 * @param stop - The bridge's stop signal; once it fires, the wait ends with its reason.
 * @throws When the handshake fails or does not finish in time; with `stop`'s reason when the stop began before or during it. The caller closes the client.
 * @example
 * await connectWithin(client, http, 3_000, stopping.signal)
 */
async function connectWithin(
  client: Client,
  http: StreamableHTTPClientTransport,
  timeoutMs: number | undefined,
  stop: AbortSignal,
): Promise<void> {
  if (timeoutMs === undefined)
    return runUnderAbortSignal(() => client.connect(http), stop)
  const timer = new AbortController()
  try {
    await runUnderAbortSignal(
      () =>
        Promise.race([
          client.connect(http, { timeout: timeoutMs }),
          sleep(timeoutMs, undefined, { signal: timer.signal }).then(() => {
            throw new Error('Codebook connection did not finish in time.')
          }),
        ]),
      stop,
    )
  } finally {
    timer.abort()
  }
}

/**
 * Releases the upstream session a transport holds (one a failed or cut handshake may have allocated, or one {@link runCursorMcpBridge} ends), without waiting longer than {@link CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS} for a server that no longer answers; called by {@link runCursorMcpBridge} after it closed a failed client and when it closes a session.
 * The DELETE goes through a transport of its own: when a handshake fails the SDK aborts the handshake's transport at once (`void this.close()` in `Client.connect`), which would abort a DELETE sent through it before it leaves. It carries the same headers (bearer token, the Devin Desktop header, session id and protocol version).
 * The release is best effort: once a take-back rotated the access token, the server refuses this DELETE with 401 before it looks the session up, and the session stays until it expires after {@link SESSION_IDLE_TIMEOUT_MS}.
 * @param http - The transport whose session is released; it may be closed already, which keeps its session id.
 * @param openTransport - Makes a transport to the same instance for a session id, as the bridge's own connections do.
 * @example
 * await releaseHalfOpenSession(http, (sessionId) => new StreamableHTTPClientTransport(url, { sessionId }))
 */
async function releaseHalfOpenSession(
  http: StreamableHTTPClientTransport,
  openTransport: (sessionId: string) => StreamableHTTPClientTransport,
): Promise<void> {
  const { sessionId, protocolVersion } = http
  // Initialize was never answered: the server named no session to release.
  if (sessionId === undefined) return
  const release = openTransport(sessionId)
  // Set only once initialize was answered in full; a release before that goes without it, as the SDK's own would.
  if (protocolVersion !== undefined) release.setProtocolVersion(protocolVersion)
  await release.start()
  try {
    await Promise.race([
      release.terminateSession().catch(() => undefined),
      // Unreferenced, so a finished release never keeps the process alive.
      sleep(CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS, undefined, { ref: false }),
    ])
  } finally {
    // Aborts a DELETE the server never answered, so it cannot keep the process alive.
    await release.close()
  }
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
 * @param onClosed - Called once the bridge's cleanup has completed after stdin closed or the stdio transport closed, also after a signal, which closes the stdio transport; the Devin Desktop bridge entry ends its process there, so a lookup that never settles cannot keep it alive. Cursor's bridge passes none and ends with its event loop.
 * @param beforeUpstream - Check run before every upstream reinitialization after the first connection (an expired session); when it resolves `false` the bridge ends (cleanup, then `onClosed`) instead of reconnecting, and when it rejects only that request fails. A stop (end of input or a signal) cuts a replacement handshake short; after it no session opens and no request is sent, neither a new one nor a replay. The Devin Desktop bridge passes its receipts check; Cursor's bridge passes none.
 * @param onRefused - Check run when the server refuses a request with HTTP 401 or 403 (a removed setup unmarks the window, a take-back rotates the token). When it resolves `false` the bridge ends as for `beforeUpstream`; when it resolves `true` or rejects, only that request fails; the request is never sent again, because only the exact 404 `Unknown MCP session` is safe to retry. Also run when a stop cut a replacement handshake short, suppressed a request or interrupted one still in flight (the ones that come while such a check runs share it), so a setup removed or replaced meanwhile still ends the bridge with its line. The Devin Desktop bridge passes the same check as `beforeUpstream`; Cursor's bridge passes none and a refusal fails the request as before.
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
  // Fires once the bridge's stop began (end of input, a closed stdio transport, a signal, or a refusal that ended the bridge); every upstream handshake runs under it, the first one included, which nothing can stop yet.
  const shutdownStarted = new AbortController()
  // Every transport to the instance carries the bearer token and the caller's header; a release names the session it ends.
  const openTransport = (sessionId?: string): StreamableHTTPClientTransport =>
    new StreamableHTTPClientTransport(new URL(descriptor.url), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${descriptor.token}`,
          ...(extraHeader && { [extraHeader.name]: extraHeader.value }),
        },
      },
      sessionId,
    })
  const connectUpstream = async (handshakeMs = connectTimeoutMs) => {
    const client = new Client({
      name: 'codebook-cursor-bridge',
      version: EXTENSION_VERSION,
    })
    const http = openTransport()
    try {
      await connectWithin(client, http, handshakeMs, shutdownStarted.signal)
    } catch (error) {
      // Closed before the release: a handshake that was cut short or timed out must not send its initialized notification once its answer arrives.
      await client.close()
      await releaseHalfOpenSession(http, openTransport)
      throw error
    }
    return { client, http }
  }
  const closeUpstream = async (
    connection: Awaited<ReturnType<typeof connectUpstream>>,
    beforeClose?: () => void,
  ): Promise<void> => {
    // Releasing the HTTP session immediately keeps short Cursor restarts below the server's session limit; a server that accepted the DELETE and never answers must not keep the bridge alive, so the wait is bounded and failures (an expired session) are ignored.
    await releaseHalfOpenSession(connection.http, openTransport)
    // Runs after the release and before the close, while the requests still in flight on this session are not interrupted yet.
    beforeClose?.()
    await connection.client.close()
  }
  let active = await connectUpstream(firstHandshakeMs)
  let reconnecting: Promise<void> | undefined,
    closed = false,
    // Forwarded requests sent upstream and not settled yet; the stop's final close interrupts every one of them.
    requestsInFlight = 0
  // Marks the stop as begun, synchronously: no session opens and no request is sent from here on, and a handshake in flight stops being waited for.
  const markClosed = (): void => {
    closed = true
    shutdownStarted.abort(new Error(BRIDGE_CLOSED_SENTENCE))
  }
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
  // The stop's setup check for the requests it suppresses or interrupts (a replay, a request still in flight, a cut handshake): such a request may have been a refusal, so a setup removed or replaced meanwhile still ends the bridge with its line. The requests that come while one runs share it; one that comes after it settled starts a fresh one, so a removal after an earlier check stood is still seen.
  let stopCheck: Promise<void> | undefined
  const checkSetupOnStop = (): Promise<void> =>
    (stopCheck ??= endIfSetupGone().finally(() => {
      stopCheck = undefined
    }))
  // Fails a request that the stop suppressed, after the stop's setup check.
  const failAfterStop = async (): Promise<never> => {
    await checkSetupOnStop()
    throw new Error(BRIDGE_CLOSED_SENTENCE)
  }
  // A replacement handshake that the stop cut short gets the stop's setup check; any failed handshake gets the refusal handling of a refused request.
  const failAfterHandshake = async (error: unknown): Promise<never> => {
    if (
      shutdownStarted.signal.aborted &&
      error === shutdownStarted.signal.reason
    )
      await checkSetupOnStop()
    return failAfterRefusal(error)
  }
  // Runs the reconnect's setup check (the Devin Desktop bridge passes one) and lists it with the refusal checks, so a stdin close that arrives meanwhile waits for its refusal line and exit code before `onClosed`.
  const setupStands = (): Promise<boolean> => {
    if (!beforeUpstream) return Promise.resolve(true)
    const checking = beforeUpstream()
    const tracked = checking.then(
      () => undefined,
      () => undefined,
    )
    refusals.add(tracked)
    void tracked.finally(() => refusals.delete(tracked))
    return checking
  }
  // Fails a request that would open a session after shutdown began: no replacement session outlives the bridge.
  const refuseIfClosed = (): void => {
    if (closed) throw new Error(BRIDGE_CLOSED_SENTENCE)
  }
  // Opens the replacement for an expired session and releases the old one; run by the first request that got the exact 404.
  const openReplacement = async (
    previous: Awaited<ReturnType<typeof connectUpstream>>,
  ): Promise<void> => {
    // A setup removed elsewhere must not get a new session: end the bridge instead.
    if (!(await setupStands())) {
      shutdownThenNotify(false)
      // True for a removed setup and a replaced one alike; the refusal line on stderr names which.
      throw new Error('Codebook setup changed; this bridge has ended.')
    }
    // Shutdown may have begun during the check (or while the old session was released).
    refuseIfClosed()
    // A refused handshake runs the same refusal handling as a refused request; one the stop cut short runs the stop's setup check.
    const next = await connectUpstream().catch(failAfterHandshake)
    // A refusal's end path can mark the stop between the handshake's end and this step.
    if (closed) {
      await closeUpstream(next)
      throw new Error(BRIDGE_CLOSED_SENTENCE)
    }
    active = next
    await closeUpstream(previous)
  }
  // Sends one forwarded request upstream unless the stop began (nothing is sent for a client that has gone), counted while it is in flight.
  const sendUpstream = async <Value>(
    request: (client: Client) => Promise<Value>,
    client: Client,
  ): Promise<Value> => {
    if (closed) return failAfterStop()
    requestsInFlight += 1
    try {
      return await request(client)
    } finally {
      requestsInFlight -= 1
    }
  }
  // The final close of the stop interrupts the requests still in flight; one may be a refusal whose answer was still being read, so the stop's setup check runs for them.
  const checkInterruptedRequests = (): void => {
    if (requestsInFlight > 0) void checkSetupOnStop()
  }
  const forward = async <Value>(
    request: (client: Client) => Promise<Value>,
  ): Promise<Value> => {
    const previous = active
    try {
      return await sendUpstream(request, previous.client)
    } catch (error) {
      // A refusal ends the bridge when its setup is gone; the request itself still fails and is not sent again.
      if (isRefusal(error)) await failAfterRefusal(error)
      // The local server rejects an expired session before dispatch, so this exact 404 is safe to retry once.
      if (!isUnknownSession(error)) throw error
      if (active === previous) {
        reconnecting ??= openReplacement(previous).finally(() => {
          reconnecting = undefined
        })
        await reconnecting
      } else if (reconnecting) await reconnecting
      // Only the 404 above authorizes this one replay; a stop that began while this request waited for the reconnect suppresses it, and a refusal of it is handled like any other and is not replayed.
      return sendUpstream(request, active.client).catch(failAfterRefusal)
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
      markClosed()
      // A replacement handshake in flight ends at once; a reconnect check still reading runs to its bound.
      await reconnecting?.catch(() => undefined)
      try {
        await closeUpstream(active, checkInterruptedRequests)
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
    // Synchronous, in the emit that ended the input: a check that answers while the drain waits finds the stop begun.
    markClosed()
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
