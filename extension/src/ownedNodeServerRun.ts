import type { ConfiguredDescriptor } from './configuredStudySchemas'
import {
  MS_PER_MINUTE,
  NODE_SERVER_DEBUGGER_DISCONNECT_NOTICE,
  NODE_SERVER_READY_TIMEOUT_MS,
  NODE_SERVER_REQUEST_TIMEOUT_MS,
  NODE_SERVER_REQUEST_WALL_LIMIT_MS,
} from './constants'
import { StudyError } from './errors'
import {
  NodeProcessRun,
  type NodeProcessRunDependencies,
  type NodeProcessSnapshot,
  type OwnedNodeProcess,
} from './nodeProcessRun'
import type { NodeServerConfiguration } from './nodeServerConfigSchemas'
import type { NodeServerHistorySink } from './nodeServerHistorySink'
import type {
  NodeServerResponse,
  NodeServerRuntime,
  NodeServerSentRequest,
  NodeServerState,
  NodeServerView,
} from './runtime'
import type { PauseIdentity } from './runtimeSupport/pauseGate'
import type { ProcessOutputEvent } from './utils/captureProcessOutput'
import {
  sanitizeRunCause,
  serverExitedError,
  serverNotListeningError,
  stepFailedError,
} from './utils/describeNodeServerRunFailure'
import type { PortOccupant } from './utils/findPortOccupant'
import {
  beginReleaseOfOwnedDevelopmentPort,
  claimOwnedDevelopmentPort,
  releaseOwnedDevelopmentPort,
  type OwnedDevelopmentPortClaim,
} from './utils/ownedDevelopmentPorts'
import type { resolveNodeServerLaunch } from './utils/resolveNodeServerLaunch'
import type { resolveNodeServerStops } from './utils/resolveNodeServerStops'
import { RunningTimeLimit, type RunClock } from './utils/runningTimeLimit'
import { hidePrivateRoots } from './utils/sanitizeCause'
import type { CauseRoots } from './utils/sanitizeCause'

/** The loopback endpoint readiness selected. */
type ServerAddress = { host: '127.0.0.1' | '::1'; port: number }

/** What a run needs from outside, injected so the whole state machine runs against fakes: the process core's dependencies ({@link NodeProcessRunDependencies}) and the utilities of the request and listener parts. */
export type NodeServerRunDependencies = NodeProcessRunDependencies & {
  resolveLaunch: typeof resolveNodeServerLaunch
  resolveStops: typeof resolveNodeServerStops
  /** Refuses with `PORT_UNAVAILABLE` while the declared port is taken. */
  assertPortFree(input: { port: number; signal: AbortSignal }): Promise<void>
  findPortOccupant(port: number): Promise<PortOccupant | undefined>
  waitForReadiness(input: {
    port: number
    hasTimeLeft: () => boolean
    signal: AbortSignal
  }): Promise<{ host: '127.0.0.1' | '::1'; bothAccept: boolean } | undefined>
  verifyListener(input: {
    port: number
    selectedHost: '127.0.0.1' | '::1'
    ownerPid: number
    processGroup: number
    acceptedWithoutListener?: boolean
  }): Promise<
    | { owned: true }
    | {
        owned: false
        code: 'LISTENER_NOT_OWNED' | 'PORT_OWNER_UNKNOWN'
        message: string
      }
  >
  readConnectionServerPid(input: {
    clientPort: number
    serverPort: number
  }): Promise<number[]>
  sendRequest(input: {
    host: '127.0.0.1' | '::1'
    port: number
    request: NodeServerConfiguration['request']
    runId: string
    verifyPeer: (connection: {
      localPort: number
      remotePort: number
    }) => Promise<void>
    signal: AbortSignal
    /** Hides private roots in the response body before it is cut for display. */
    sanitize?: (text: string) => string
  }): { written: Promise<void>; response: Promise<NodeServerResponse> }
}

/** What {@link createOwnedNodeServerRun} is given. */
export type NodeServerRunInput = {
  /** The opened repository's real root. */
  workspace: string
  configuration: NodeServerConfiguration
  /** Journals the run's `node-server.*` events. */
  record: (type: string, detail?: unknown) => unknown
  /** The article's text of every source the selected node cites (the debugger refuses a start while the editor holds other text). */
  citedSources: ConfiguredDescriptor['sources']
  /** The service's run id: sent as `x-codebook-run`, named in the debug session and the orphan record. */
  runId: string
  /** Where the run reports what a saved server replay records; absent when no history started. It is told synchronously and never awaited, and nothing it does reaches the run. */
  history?: NodeServerHistorySink
  /** The private roots the service hides everywhere (storage, learning directory, workspace, home), frozen for this run: used for the server's output and the response body, so both read the same placeholders as the history, which hides with the same snapshot; absent in tests, where the workspace and the home directory are used. */
  privateRoots?: CauseRoots
  dependencies: NodeServerRunDependencies
}

/**
 * The node-server run the service drives (Issue #139 tasks 9–10): it launches the repository's server under the debugger, arms the declared stops, sends the declared request once, captures its hits and stops the server.
 * Its state is derived from what happened (lifecycle, held pauses, current pause, request outcome), so a state "returns to what it was" when a held pause is continued.
 * The process, its pauses and its stop belong to the composition core ({@link NodeProcessRun}); this class keeps the declared port, readiness, listener verification and the request.
 */
class OwnedNodeServerRun implements NodeServerRuntime {
  readonly id: string
  private readonly listeners = new Set<() => void>()
  private readonly clock: RunClock
  private readonly readiness: RunningTimeLimit
  private readonly requestLimit: RunningTimeLimit
  private readonly core: NodeProcessRun
  private portClaim?: OwnedDevelopmentPortClaim
  private address?: ServerAddress
  // The declared request.
  private request?: NodeServerSentRequest
  private requestAbort = new AbortController()
  private requestToken = 0
  private requestEnded = false
  private cancelWall?: () => void
  private response?: NodeServerResponse
  private requestFailure?: NodeServerView['requestFailure']

  constructor(private readonly input: NodeServerRunInput) {
    this.id = input.runId
    this.clock = input.dependencies.clock
    this.readiness = new RunningTimeLimit(
      NODE_SERVER_READY_TIMEOUT_MS,
      this.clock,
      () => undefined,
    )
    this.requestLimit = new RunningTimeLimit(
      NODE_SERVER_REQUEST_TIMEOUT_MS,
      this.clock,
      () => this.timeOutRequest('running-time'),
    )
    this.core = new NodeProcessRun({
      workspace: input.workspace,
      runId: input.runId,
      record: input.record,
      citedSources: input.citedSources,
      declaredPort: input.configuration.port,
      privateRoots: input.privateRoots,
      dependencies: input.dependencies,
      notify: () => this.notify(),
      hooks: {
        inWindow: () => this.inRequestWindow(),
        holdLimits: () => {
          this.readiness.hold()
          this.requestLimit.hold()
        },
        releaseLimits: () => {
          this.readiness.release()
          this.requestLimit.release()
        },
        onStopAdmitted: () => this.cancelRequestAndTimers(),
        onProcessOutput: (event) => this.onServerOutput(event),
        onStopCaptured: (elapsedMs, pause, generation, read) =>
          this.input.history?.stop(elapsedMs, pause, generation, read),
        onCaptureBudgetExhausted: () =>
          this.input.history?.markCaptureBudgetExhausted(),
        onReleaseBegin: () => {
          if (this.portClaim) beginReleaseOfOwnedDevelopmentPort(this.portClaim)
        },
        onReleased: () => {
          if (this.portClaim) releaseOwnedDevelopmentPort(this.portClaim)
        },
        onStopped: () => this.reportForeignListener(),
      },
    })
  }

  private get dependencies(): NodeServerRunDependencies {
    return this.input.dependencies
  }

  /** Journals one event of the run. */
  private record(type: string, detail?: unknown): void {
    this.input.record(type, detail)
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  /** Tells every listener the view changed; a listener that throws never breaks the run. */
  private notify(): void {
    for (const listener of this.listeners)
      try {
        listener()
      } catch {
        // The service's listener failing is its own matter.
      }
  }

  /**
   * Derives the state from what happened, in the order a reader needs: the end of the run first, then a held pause, a declared-stop pause, the request's outcome, the request in flight, readiness.
   * @param snapshot - The core's state.
   * @returns The state of the run's table.
   * @example this.currentState(this.core.snapshot()) // => 'request-in-flight' after the request was sent and nothing answered
   */
  private currentState(snapshot: NodeProcessSnapshot): NodeServerState {
    if (snapshot.lifecycle !== 'live') return snapshot.lifecycle
    if (snapshot.heldPause)
      return snapshot.heldPause.kind === 'learner'
        ? 'learner-paused'
        : 'unattributed'
    if (snapshot.pause) return 'paused'
    if (this.requestFailure) return 'request-failed'
    if (this.response) return 'responded'
    if (this.request) return 'request-in-flight'
    return snapshot.prepared ? 'ready' : 'preparing'
  }

  view(): NodeServerView {
    const snapshot = this.core.snapshot()
    return {
      state: this.currentState(snapshot),
      pid: snapshot.pid,
      address: this.address && { ...this.address },
      stops: snapshot.stops,
      stopsHitAtStart: snapshot.stopsHitAtStart,
      stopsReached: snapshot.stopsReached,
      pauseGeneration: snapshot.pauseGeneration,
      pause: snapshot.pause,
      heldPause: snapshot.heldPause,
      request: this.request && { ...this.request },
      response: this.response,
      requestFailure: this.requestFailure && { ...this.requestFailure },
      captures: snapshot.captures,
      captureBudgetExhausted: snapshot.captureBudgetExhausted,
      runFailure: snapshot.runFailure,
      failedStops: snapshot.failedStops,
    }
  }

  // ---------------------------------------------------------------- preparation

  prepare(): Promise<void> {
    const { workspace, configuration } = this.input
    return this.core.prepare({
      resolveStops: () =>
        this.dependencies.resolveStops(workspace, configuration),
      resolveLaunch: () =>
        this.dependencies.resolveLaunch(workspace, configuration),
      beforeLaunch: (signal) =>
        this.dependencies.assertPortFree({ port: configuration.port, signal }),
      // The server's port is claimed from the launch on.
      afterLaunch: () => {
        this.portClaim = claimOwnedDevelopmentPort(configuration.port)
      },
      beforeRelease: () => this.readiness.start(),
      afterRelease: () => this.becomeReady(),
    })
  }

  /** A stop was admitted: the request still checking its connection writes nothing, and every running-time limit and the wall limit stop. */
  private cancelRequestAndTimers(): void {
    // A request still checking its connection writes nothing once the stop is admitted.
    this.requestAbort.abort(
      new StudyError(
        'RUN_NOT_READY',
        'The run was stopped before its request was written, so nothing was sent.',
      ),
    )
    this.readiness.stop()
    this.requestLimit.stop()
    this.cancelWall?.()
  }

  /**
   * Journals one chunk of the server's output. Node's own notice on stderr that only the attached debugger keeps a finished program alive lets the run's debugger go, so the exit follows and is reported as one.
   * The notice must be a line of stderr by itself, outside the request, and the process must listen on nothing but its inspector: output an application logs (stdout, a request's body, a database value) never counts.
   * @param event - The stamped chunk.
   */
  private async onServerOutput(event: ProcessOutputEvent): Promise<void> {
    if (
      event.channel === 'stderr' &&
      this.core.lifecycle === 'live' &&
      !this.inRequestWindow() &&
      event.text
        .split('\n')
        .some(
          (line) =>
            line.trim().replace(/\.+$/, '') ===
            NODE_SERVER_DEBUGGER_DISCONNECT_NOTICE,
        )
    )
      await this.core.releaseFinishedServer()
    this.input.history?.output(event.elapsedMs, event.channel, event.text)
    this.record('node-server.output', {
      sequence: event.sequence,
      elapsedMs: event.elapsedMs,
      channel: event.channel,
      text: event.text,
    })
  }

  /** Waits for the server to accept on its declared port, verifies the listener and publishes `ready`. */
  private async becomeReady(): Promise<void> {
    const server = this.requireServer()
    const { port } = this.input.configuration
    const accepted = await this.awaitAcceptance(server, port)
    const { pid, processGroup } = this.core.identityOf(server)
    const verdict = await this.dependencies.verifyListener({
      port,
      selectedHost: accepted.host,
      ownerPid: pid,
      processGroup,
      acceptedWithoutListener: true,
    })
    if (!verdict.owned) throw new StudyError(verdict.code, verdict.message)
    this.readiness.stop()
    this.address = { host: accepted.host, port }
    this.core.markPrepared()
    this.record('node-server.ready', { host: accepted.host, port })
    this.notify()
  }

  /** The launched server, which exists from the launch on. */
  private requireServer(): OwnedNodeProcess {
    const server = this.core.launched
    if (!server) throw new Error('The run has no server yet.')
    return server
  }

  /**
   * Polls the declared port until it accepts, within the readiness budget of running time, or until the server exits first.
   * @returns The accepted loopback address.
   * @throws `SERVER_EXITED` when the server exited first; `SERVER_NOT_LISTENING` when the budget passed (naming the port the launched process listens on instead, if any); the run's failure when a pause hold expired.
   */
  private async awaitAcceptance(
    server: OwnedNodeProcess,
    port: number,
  ): Promise<{ host: '127.0.0.1' | '::1'; bothAccept: boolean }> {
    const exited = server.whenExited()
    const outcome = await Promise.race([
      this.dependencies.waitForReadiness({
        port,
        hasTimeLeft: () => this.readiness.hasTimeLeft(),
        signal: this.core.signal,
      }),
      exited.then((exit) => ({ exit })),
    ])
    if (outcome && 'exit' in outcome)
      throw serverExitedError(
        outcome.exit,
        server.output(),
        this.input.workspace,
      )
    if (outcome) return outcome
    if (this.core.runFailure) throw this.core.runFailure
    throw serverNotListeningError(port, await this.listeningElsewhere(server))
  }

  /** Finds the port the launched process listens on other than the declared one and the inspector's. */
  private async listeningElsewhere(
    server: OwnedNodeProcess,
  ): Promise<number | undefined> {
    if (server.pid === undefined) return undefined
    const ports = await this.dependencies
      .readListeningPorts(server.pid)
      .catch(() => [])
    return ports.find(
      (port) =>
        port !== this.input.configuration.port &&
        port !== this.core.inspectorPort,
    )
  }

  /** Whether the declared request is under way: sent, and not answered or failed yet. */
  private inRequestWindow(): boolean {
    return this.request !== undefined && !this.requestEnded
  }

  continue(identity: PauseIdentity): Promise<void> {
    return this.core.continue(identity)
  }

  // ---------------------------------------------------------------- the declared request

  async sendRequest(key: string): Promise<void> {
    this.core.assertNoHeldPause()
    if (this.request)
      throw new StudyError(
        'REQUEST_ALREADY_SENT',
        'This run already sent its request; read the run for its outcome.',
      )
    const server = this.core.launched
    if (
      this.currentState(this.core.snapshot()) !== 'ready' ||
      !this.address ||
      !server
    )
      throw new StudyError(
        'RUN_NOT_READY',
        'The server is not ready for its request yet.',
      )
    const { host, port } = this.address
    const declared = this.input.configuration.request
    const token = ++this.requestToken
    this.openRequestWindow(key, host, port, declared)
    let handle: ReturnType<NodeServerRunDependencies['sendRequest']>
    try {
      handle = this.dependencies.sendRequest({
        host,
        port,
        request: declared,
        runId: this.input.runId,
        verifyPeer: (connection) => this.verifyPeer(connection, server, port),
        signal: this.requestAbort.signal,
        // The body is the server's own text: only private roots are hidden, its spacing and lines stay.
        sanitize: (text) => hidePrivateRoots(text, this.core.privateRoots()),
      })
    } catch (error) {
      // The sender never started: the window closes and the request may be tried again.
      this.closeRequestWindow(
        token,
        error instanceof StudyError ? error.code : undefined,
      )
      throw error instanceof StudyError
        ? error
        : new StudyError(
            'REQUEST_FAILED',
            `The request could not be started: ${sanitizeRunCause(error, this.input.workspace)}`,
          )
    }
    handle.response.then(
      (response) => this.onResponse(response, token),
      (error: unknown) => void this.onRequestError(error, token),
    )
    try {
      await handle.written
      this.recordSentRequest(token)
    } catch (error) {
      // Any other failure is reported by the response promise, which rejects with it too.
      // A listener that is not the server, or a stop admitted before the first byte: nothing was sent.
      if (
        error instanceof StudyError &&
        (error.code === 'LISTENER_NOT_OWNED' ||
          error.code === 'PORT_OWNER_UNKNOWN' ||
          error.code === 'RUN_NOT_READY')
      ) {
        this.closeRequestWindow(token, error.code)
        throw error
      }
    }
  }

  /** Opens the request window before any byte is written: the state reads `request-in-flight` and the limits run. */
  private openRequestWindow(
    key: string,
    host: ServerAddress['host'],
    port: number,
    declared: NodeServerConfiguration['request'],
  ): void {
    this.requestAbort = new AbortController()
    this.requestEnded = false
    this.request = {
      key,
      method: declared.method,
      path: declared.path,
      bodyBytes: Buffer.byteLength(declared.body ?? ''),
      address: host === '::1' ? `[::1]:${port}` : `${host}:${port}`,
      sentAtMs: this.core.launched?.elapsedMs() ?? 0,
    }
    this.requestLimit.start()
    this.cancelWall = this.clock.set(
      () => this.timeOutRequest('wall-time'),
      NODE_SERVER_REQUEST_WALL_LIMIT_MS,
    )
    this.core.requireDebugger().setRequestWindow(true)
    this.input.history?.openRequest(this.elapsedSinceLaunchMs(), {
      method: declared.method,
      path: declared.path,
      bodyBytes: this.request.bodyBytes,
    })
    this.notify()
  }

  /** Milliseconds since the launch, the one clock every entry of the history carries; the seal reads it for the end entry's time. It stops moving once the run's end is known (a stop admitted, or the failure that ends the run). */
  elapsedSinceLaunchMs(): number {
    return this.core.elapsedSinceLaunchMs()
  }

  /** Journals the request once its bytes were handed to the socket, so a refused or stopped request never reads as sent. */
  private recordSentRequest(token: number): void {
    if (token !== this.requestToken || !this.request) return
    this.input.history?.markRequestSent(this.elapsedSinceLaunchMs())
    this.record('node-server.request', {
      method: this.request.method,
      path: this.request.path,
      bodyBytes: this.request.bodyBytes,
      address: this.request.address,
    })
  }

  /** Takes the window back when the request was refused before its bytes were written. */
  private closeRequestWindow(token: number, code = 'REQUEST_NOT_SENT'): void {
    if (token !== this.requestToken) return
    this.input.history?.withdrawRequest(this.elapsedSinceLaunchMs(), code)
    this.requestToken += 1
    this.request = undefined
    this.requestLimit.stop()
    this.cancelWall?.()
    this.core.requireDebugger().setRequestWindow(false)
    this.notify()
  }

  /** Reads which process the connected socket reaches and refuses unless it is the launched server. */
  private async verifyPeer(
    connection: { localPort: number; remotePort: number },
    server: OwnedNodeProcess,
    port: number,
  ): Promise<void> {
    const holders = await this.dependencies.readConnectionServerPid({
      clientPort: connection.localPort,
      serverPort: connection.remotePort,
    })
    if (holders.length === 0)
      throw new StudyError(
        'PORT_OWNER_UNKNOWN',
        `Codebook could not read which process answers on port ${port}, so it sent nothing.`,
      )
    // Exactly the launched server may hold the connection's server end; a socket it shares with another process does not pass.
    const others = holders.filter((pid) => pid !== server.pid)
    if (others.length > 0)
      throw new StudyError(
        'LISTENER_NOT_OWNED',
        `Process ${others.join(', ')} answers on port ${port}, not the server Codebook started alone (process ${server.pid}); nothing was sent.`,
      )
  }

  /** The response arrived: it is the request's outcome. */
  private onResponse(response: NodeServerResponse, token: number): void {
    if (token !== this.requestToken || !this.inRequestWindow()) return
    if (this.core.lifecycle !== 'live') return
    this.response = response
    this.input.history?.response(this.elapsedSinceLaunchMs(), response)
    this.record('node-server.response', {
      status: response.status,
      contentType: response.contentType,
      body: response.body,
      bodyBytes: response.bodyBytes,
      readCut: response.readCut,
      location: response.location,
      elapsedMs: response.elapsedMs,
    })
    void this.endRequest()
  }

  /** The request failed: a reset is `REQUEST_FAILED` unless the server exited meanwhile, which is the run's failure. */
  private async onRequestError(error: unknown, token: number): Promise<void> {
    if (token !== this.requestToken || !this.inRequestWindow()) return
    if (this.core.lifecycle !== 'live') return
    const exit = await this.core.settledExit()
    if (exit && this.core.launched) {
      this.core.onServerExit(exit)
      return
    }
    if (token !== this.requestToken || !this.inRequestWindow()) return
    this.failRequest(
      'REQUEST_FAILED',
      `The connection failed before a response: ${sanitizeRunCause(error, this.input.workspace)}`,
    )
  }

  /**
   * The request ran past a limit; each limit names itself in the message.
   * @param limit - `running-time` for the 30 s of running time (paused time excluded), `wall-time` for the 15-minute backstop (paused time included).
   */
  private timeOutRequest(limit: 'running-time' | 'wall-time'): void {
    this.failRequest(
      'REQUEST_TIMEOUT',
      limit === 'running-time'
        ? `The server did not answer within ${NODE_SERVER_REQUEST_TIMEOUT_MS / 1_000} s of running time.`
        : `The server did not answer within ${NODE_SERVER_REQUEST_WALL_LIMIT_MS / MS_PER_MINUTE} minutes of waiting, however long it was paused.`,
    )
  }

  /** Ends the request with a failure that is its outcome, not the run's (D1). */
  private failRequest(
    code: 'REQUEST_FAILED' | 'REQUEST_TIMEOUT',
    message: string,
  ): void {
    if (!this.inRequestWindow() || this.core.lifecycle !== 'live') return
    this.requestFailure = { code, message }
    this.input.history?.failRequest(this.elapsedSinceLaunchMs(), code, message)
    this.record('node-server.failure', { code, cause: message })
    this.requestAbort.abort(new Error(code))
    void this.endRequest()
  }

  /** The request ended: its window closes and every owned breakpoint is retired. */
  private async endRequest(): Promise<void> {
    this.requestEnded = true
    this.requestLimit.stop()
    this.cancelWall?.()
    this.core.debuggerSession?.setRequestWindow(false)
    this.notify()
    try {
      await this.core.debuggerSession?.retireStops(this.core.signal)
    } catch (error) {
      if (this.core.lifecycle === 'live')
        this.core.failRun(
          stepFailedError(
            'retiring the declared stops',
            error,
            this.input.workspace,
          ),
        )
    }
  }

  // ---------------------------------------------------------------- stop

  stop(): Promise<void> {
    return this.core.stop()
  }

  /** Reports a process that holds the declared port after the owned cleanup, apart from the stop's outcome. */
  private async reportForeignListener(): Promise<void> {
    const occupant = await this.dependencies
      .findPortOccupant(this.input.configuration.port)
      .catch(() => undefined)
    if (occupant)
      this.record('node-server.port-held-by-other', {
        port: this.input.configuration.port,
        pid: occupant.pid,
        command: occupant.command,
      })
  }
}

/**
 * Creates the run of one node-server declaration, to be prepared, sent a request, continued and stopped by the service.
 * Called by the environment's `createNodeServerRun` hook, which supplies the product's dependencies ({@link createProductNodeServerRunDependencies}); tests supply fakes.
 * @param input - The repository, the strictly parsed declaration, the event journal, the cited sources, the run id and the dependencies.
 * @returns The run, in state `preparing`; nothing is spawned until `prepare()` is called.
 * @example
 * const run = createOwnedNodeServerRun({ workspace, configuration, record, citedSources, runId, dependencies })
 * await run.prepare() // => resolves when run.view().state is 'ready'
 */
export function createOwnedNodeServerRun(
  input: NodeServerRunInput,
): NodeServerRuntime {
  return new OwnedNodeServerRun(input)
}
