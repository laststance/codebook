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
  CURSOR_MCP_BRIDGE_REQUEST_TIMEOUT_MS,
  EXTENSION_VERSION,
} from './constants'
import { BRIDGE_INPUT_CLOCK } from './utils/bridgeInputClock'
import { BRIDGE_RELEASE_BOUND } from './utils/bridgeReleaseBound'
import { holdBridgeInput, type BridgeInputHold } from './utils/holdBridgeInput'
import {
  readBridgeDescriptor,
  type DescriptorExpectation,
} from './utils/readBridgeDescriptor'
import { runUnderAbortSignal } from './utils/runUnderAbortSignal'

/** The error of a request refused because the bridge's stop began, and the reason its stop signal carries. */
const BRIDGE_CLOSED_SENTENCE = 'Codebook Cursor MCP bridge has closed.'

/** The error of a handshake that did not finish within its time limit. */
const HANDSHAKE_TIMEOUT_SENTENCE = 'Codebook connection did not finish in time.'

/**
 * Connects `client` over `http` and bounds the whole handshake (initialize, then the initialized notification) by `timeoutMs`, and ends the wait at once when the bridge's stop begins; called by {@link runCursorMcpBridge} for its first connection and for every reconnect.
 * The bundled SDK applies its `timeout` to the initialize request alone, so a server that answers initialize and then holds the notification would otherwise keep the bridge waiting past its deadline. The SDK is not given `stop`: the handshake keeps running until the caller closes the client.
 * A handshake that completes only after `timeoutMs`, before the limit's timer ran (Node runs a due timer only on a later turn of its event loop), did not finish in time either: it is measured on {@link BRIDGE_INPUT_CLOCK}, the clock {@link BridgeInputHold.settleHandshake} judges the same limit on, so a first handshake past its own limit keeps that limit's outcome against the wait at the startup input limit (Cycle 0147 review round).
 * @param client - The MCP client to connect.
 * @param http - The HTTP transport to the instance.
 * @param timeoutMs - The budget for the complete handshake; the SDK's own request timeout applies when left out.
 * @param stop - The bridge's stop signal; once it fires, the wait ends with its reason.
 * @throws When the handshake fails or does not finish in time, also when it completed after `timeoutMs`; with `stop`'s reason when the stop began before or during it. The caller closes the client.
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
  const startedAtMs = BRIDGE_INPUT_CLOCK.now()
  try {
    await runUnderAbortSignal(
      () =>
        Promise.race([
          client.connect(http, { timeout: timeoutMs }),
          sleep(timeoutMs, undefined, { signal: timer.signal }).then(() => {
            throw new Error(HANDSHAKE_TIMEOUT_SENTENCE)
          }),
        ]),
      stop,
    )
    // A continuation that ran past the limit before its timer did: the handshake still did not finish in time.
    if (BRIDGE_INPUT_CLOCK.now() - startedAtMs >= timeoutMs)
      throw new Error(HANDSHAKE_TIMEOUT_SENTENCE)
  } finally {
    timer.abort()
  }
}

/**
 * Releases the upstream session a transport holds (one a failed or cut handshake may have allocated, or one {@link runCursorMcpBridge} ends), without waiting longer than {@link CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS} ({@link BRIDGE_RELEASE_BOUND}) for a server that no longer answers; called by {@link runCursorMcpBridge} after it closed a failed client and when it closes a session.
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
  const releaseEnded = new AbortController()
  try {
    await Promise.race([
      release.terminateSession().catch(() => undefined),
      // Unreferenced, so a finished release never keeps the process alive.
      BRIDGE_RELEASE_BOUND.wait(releaseEnded.signal),
    ])
  } finally {
    // A DELETE answered first ends the bound's timer too, so a running bridge keeps none per release.
    releaseEnded.abort()
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
 * Runs a bridge's first handshake while it watches for the client ending the bridge: the end of stdin, a read error on it, SIGTERM or SIGINT, and, once stdin reached its startup input limit, the end of the wait at that limit; called by {@link runCursorMcpBridge} once, after its descriptor read.
 * Before this the first handshake could not be stopped: nothing read stdin before the stdio transport started, and the signal handlers came after the handshake, so a client that closed the bridge meanwhile kept it waiting (Cursor's bridge has no deadline for the handshake) and a signal ended it before it released its session (Cycle 0146 /ship pass 1).
 * Past {@link BRIDGE_STARTUP_INPUT_LIMIT_BYTES} the bridge no longer reads stdin, so it cannot see the client close it; the wait at that limit ({@link BRIDGE_STARTUP_INPUT_FULL_WAIT_MS}, from the first time a hold of stdin reached it) stands in for that end, also while the client is still connected (Cycle 0147 task 8). The handshake's settlement decides against that wait ({@link BridgeInputHold.settleHandshake}): one that settled after the wait ended is a stop, one that settled within it keeps its outcome while its cleanup runs.
 * A stop marks the bridge closed, which cuts the handshake short; its client is closed and the session the server named is released by `connect` itself (a best-effort DELETE for the id the bridge knows). The signal handlers stay until that release settled, so a second signal meets them instead of the default action.
 * Not watched during the descriptor read before it: no session can exist yet, so a signal's default action loses nothing, and an end of input that came then is seen as soon as this starts.
 * @param connect - Makes the handshake under the bridge's stop signal; it closes the client and releases any session itself when it fails or is cut. It calls `settleHandshake` as soon as the handshake settled, before it accepts the connection and before its cleanup, and treats the handshake as cut when that answers `true`.
 * @param markClosed - Begins the bridge's stop; idempotent.
 * @param stop - The bridge's stop signal, aborted by `markClosed`.
 * @returns `'stopped'` when the stop began during the handshake, whatever the cut handshake threw: stdin is left paused and not reading and nothing is kept, so the process can end. Otherwise the connection and `handOver`, which the caller runs once its serving stop listens: it puts what was read from stdin back for the stdio transport (paused, each chunk whole and in order) and removes the signal handlers.
 * @throws What the handshake threw when it failed without a stop; stdin then holds what was read, paused and not reading, for the next reader, and no handler is left.
 * @example
 * const first = await connectFirstUpstream((settleHandshake) => connectUpstream(budget, settleHandshake), markClosed, shutdownStarted.signal)
 */
async function connectFirstUpstream<Connection>(
  connect: (
    settleHandshake: BridgeInputHold['settleHandshake'],
  ) => Promise<Connection>,
  markClosed: () => void,
  stop: AbortSignal,
): Promise<{ connection: Connection; handOver: () => void } | 'stopped'> {
  const input = holdBridgeInput(process.stdin, markClosed)
  process.on('SIGTERM', markClosed)
  process.on('SIGINT', markClosed)
  const stopWatching = (): void => {
    process.off('SIGTERM', markClosed)
    process.off('SIGINT', markClosed)
  }
  try {
    const connection = await connect(input.settleHandshake)
    return {
      connection,
      handOver: (): void => {
        input.handOver()
        stopWatching()
      },
    }
  } catch (error) {
    stopWatching()
    // A stop that began during the handshake ends the bridge as a stop, whatever the cut handshake threw.
    if (stop.aborted) {
      input.release()
      return 'stopped'
    }
    input.putBack()
    throw error
  }
}

/**
 * Registers a serving bridge's stop listeners, each once, as the bridge has always had them: the end of stdin, SIGTERM and SIGINT; called by {@link runCursorMcpBridge} before the first handshake's watch lets go of the signals, so a signal never meets the default action between the two.
 * @param onInputEnd - The bridge's stop for the end of its input.
 * @param onSignal - The bridge's stop for a signal.
 * @returns Removes the three listeners again, for a stdio attachment that failed, so the Devin bridge's next attempt finds none of this one's.
 * @example
 * const stopListening = listenForServingStop(() => shutdownThenNotify(), stopForSignal)
 */
function listenForServingStop(
  onInputEnd: () => void,
  onSignal: () => void,
): () => void {
  process.stdin.once('end', onInputEnd)
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)
  return (): void => {
    process.stdin.off('end', onInputEnd)
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
  }
}

/**
 * Bridges Cursor's stdio MCP transport to the authenticated instance selected by its extension window.
 * @param descriptorPath - The private connection descriptor of the instance.
 * @param connectTimeoutMs - Longest wait for reading the descriptor and the whole connection handshake together (initialize and the initialized notification); the Devin Desktop bridge passes its remaining startup budget. The SDK's own request timeout applies when left out.
 * @param expected - What the Devin Desktop bridge's selection validated; the descriptor read for the connection must still say the same, else nothing is sent. Cursor's bridge passes none.
 * @param extraHeader - A request header sent on every request to the server, beside the bearer token; the Devin Desktop bridge marks its requests with it ({@link DEVIN_BRIDGE_HEADER_NAME}). Cursor's bridge passes none.
 * @param onClosed - Called once the bridge's cleanup has completed after stdin closed or the stdio transport closed, also after a signal, which closes the stdio transport, and after a stop during the first handshake (see the return value); the Devin Desktop bridge entry ends its process there, so a lookup that never settles cannot keep it alive. Cursor's bridge passes none and ends with its event loop.
 * @param beforeUpstream - Check run before every upstream reinitialization after the first connection (an expired session); when it resolves `false` the bridge ends (cleanup, then `onClosed`) instead of reconnecting, and when it rejects only that request fails. A stop (end of input or a signal) cuts a replacement handshake short; after it no session opens and no request is sent, neither a new one nor a replay. The Devin Desktop bridge passes its receipts check; Cursor's bridge passes none.
 * @param onRefused - Check run when the server refuses a request with HTTP 401 or 403 (a removed setup unmarks the window, a take-back rotates the token). When it resolves `false` the bridge ends as for `beforeUpstream`; when it resolves `true` or rejects, only that request fails; the request is never sent again, because only the exact 404 `Unknown MCP session` is safe to retry. Also run when a stop cut a replacement handshake short, suppressed a request or interrupted one still in flight (the ones that come while such a check runs share it), so a setup removed or replaced meanwhile still ends the bridge with its line. The Devin Desktop bridge passes the same check as `beforeUpstream`; Cursor's bridge passes none and a refusal fails the request as before.
 * @returns
 * - `'serving'` once the first connection is up and the bridge serves its client (its later stop calls `onClosed`)
 * - `'stopped'` when the client ended the bridge during its first handshake (the end of stdin, a read error on it, SIGTERM or SIGINT), or its startup input stayed at {@link BRIDGE_STARTUP_INPUT_LIMIT_BYTES} for {@link BRIDGE_STARTUP_INPUT_FULL_WAIT_MS} without the first connection coming up (counted from the first time a hold of stdin reached that limit, across the Devin Desktop bridge's attempts): the handshake was cut, a best-effort DELETE went out for the session the server had named (none when no answer named one), and `onClosed` was called once; nothing is written and the exit code is left as it was
 * @throws When the descriptor is not private, is no valid descriptor (one fixed sentence, never its content), names a url that is not Codebook's loopback endpoint, differs from `expected`, the server does not finish the handshake in time or refuses the connection.
 * @example await runCursorMcpBridge('/private/current.connection.json') // => 'serving'
 */
export async function runCursorMcpBridge(
  descriptorPath: string,
  connectTimeoutMs?: number,
  expected?: DescriptorExpectation,
  extraHeader?: { name: string; value: string },
  onClosed?: () => void,
  beforeUpstream?: () => Promise<boolean>,
  onRefused?: () => Promise<boolean>,
): Promise<'serving' | 'stopped'> {
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
  // Fires once the bridge's stop began (end of input or a read error on it, a closed stdio transport, a signal, or a refusal that ended the bridge); every upstream handshake runs under it, the first one included.
  const shutdownStarted = new AbortController()
  let closed = false
  // Marks the stop as begun, synchronously: no session opens and no request is sent from here on, and a handshake in flight stops being waited for. Idempotent, so a repeated signal or end changes nothing.
  const markClosed = (): void => {
    closed = true
    shutdownStarted.abort(new Error(BRIDGE_CLOSED_SENTENCE))
  }
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
  // Reconnects settle no input hold: their handshake is never judged against the wait at the startup input limit.
  const connectUpstream = async (
    handshakeMs = connectTimeoutMs,
    settleHandshake: BridgeInputHold['settleHandshake'] = () => false,
  ) => {
    const client = new Client({
      name: 'codebook-cursor-bridge',
      version: EXTENSION_VERSION,
    })
    const http = openTransport()
    try {
      await connectWithin(client, http, handshakeMs, shutdownStarted.signal)
      // A first handshake that came up only after the wait at its startup input limit ended does not win: it is closed and released like one a stop cut.
      if (settleHandshake(handshakeMs)) shutdownStarted.signal.throwIfAborted()
    } catch (error) {
      // Settled before the cleanup below: the wait at the startup input limit cannot turn a first handshake that failed within it into a stop while its session is released, and one that failed after that wait ended is a stop.
      settleHandshake(handshakeMs)
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
  const first = await connectFirstUpstream(
    (settleHandshake) => connectUpstream(firstHandshakeMs, settleHandshake),
    markClosed,
    shutdownStarted.signal,
  )
  // The client ended the bridge during its first handshake (or its startup input stayed at its limit for the whole wait): that handshake was cut and the session it named released.
  if (first === 'stopped') {
    onClosed?.()
    return 'stopped'
  }
  let active = first.connection
  let reconnecting: Promise<void> | undefined,
    // Forwarded requests sent upstream and not settled yet; the stop's final close interrupts every one of them.
    requestsInFlight = 0
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
  // The SDK stdio transport does not close itself on stdin EOF, so release the HTTP session explicitly. Registered before the first handshake's watch lets go, so a signal never meets the default action in between.
  const stopListening = listenForServingStop(
    () => shutdownThenNotify(),
    stopForSignal,
  )
  // stdin goes to the stdio transport: what was read during the first handshake is put back first, each chunk whole and in order, and stdin stays paused until the transport listens.
  first.handOver()
  try {
    await server.connect(stdio)
  } catch (error) {
    // A failed attachment leaves none of this bridge's listeners behind for the Devin bridge's next attempt.
    stopListening()
    await closeUpstream(active)
    throw error
  }
  // Read only now: the transport's listeners are attached, so it gets the kept chunks first.
  process.stdin.resume()
  return 'serving'
}
