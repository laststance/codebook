import type { ConfiguredDescriptor } from './configuredStudySchemas'
import {
  MS_PER_MINUTE,
  NODE_SERVER_DEBUGGER_DISCONNECT_NOTICE,
  NODE_SERVER_EXIT_SETTLE_MS,
  NODE_SERVER_READY_TIMEOUT_MS,
  NODE_SERVER_REQUEST_CAPTURE_LIMIT,
  NODE_SERVER_REQUEST_TIMEOUT_MS,
  NODE_SERVER_REQUEST_WALL_LIMIT_MS,
  NODE_SERVER_STOP_DEADLINE_MS,
  NODE_TEST_ATTACH_TIMEOUT_MS,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
} from './constants'
import { StudyError } from './errors'
import type { NodeServerConfiguration } from './nodeServerConfigSchemas'
import type {
  NodeServerArmedStop,
  NodeServerDebugger,
  NodeServerDebuggerInput,
  NodeServerDebuggerPause,
  NodeServerStopCapture,
  NodeServerStopTarget,
} from './nodeServerDebugger'
import type {
  NodeServerCapture,
  NodeServerHeldPause,
  NodeServerResponse,
  NodeServerRuntime,
  NodeServerSentRequest,
  NodeServerState,
  NodeServerStop,
  NodeServerView,
} from './runtime'
import type { PauseIdentity } from './runtimeSupport/pauseGate'
import type { ProcessOutputEvent } from './utils/captureProcessOutput'
import { causeRootsFor } from './utils/causeRootsFor'
import {
  confirmLaunchedGroup,
  type LaunchedGroupVerdict,
} from './utils/confirmLaunchedGroup'
import {
  sanitizeRunCause,
  serverExitedError,
  serverNotListeningError,
  stepFailedError,
  stopFailedError,
} from './utils/describeNodeServerRunFailure'
import type { PortOccupant } from './utils/findPortOccupant'
import { isGroupCertainlyGone } from './utils/isGroupCertainlyGone'
import type { isProcessGroupGone } from './utils/isProcessGroupGone'
import type { launchNodeServer, NodeServerExit } from './utils/launchNodeServer'
import {
  beginReleaseOfOwnedDevelopmentPort,
  claimOwnedDevelopmentPort,
  releaseOwnedDevelopmentPort,
  type OwnedDevelopmentPortClaim,
} from './utils/ownedDevelopmentPorts'
import type { resolveNodeServerLaunch } from './utils/resolveNodeServerLaunch'
import type { resolveNodeServerStops } from './utils/resolveNodeServerStops'
import { RunningTimeLimit, type RunClock } from './utils/runningTimeLimit'
import { sanitizeCause } from './utils/sanitizeCause'
import type { signalProcessGroup } from './utils/signalProcessGroup'

/** The server the launcher started ({@link launchNodeServer}). */
type OwnedNodeServer = Awaited<ReturnType<typeof launchNodeServer>>

/** The loopback endpoint readiness selected. */
type ServerAddress = { host: '127.0.0.1' | '::1'; port: number }

/** What a run needs from outside, injected so the whole state machine runs against fakes: the debugger, the launcher, the clock and the utilities of the request, listener and orphan-record parts. */
export type NodeServerRunDependencies = {
  clock: RunClock
  /** The external Node executable and its version. */
  node: { executable: string; version: string }
  createDebugger(input: NodeServerDebuggerInput): NodeServerDebugger
  resolveLaunch: typeof resolveNodeServerLaunch
  resolveStops: typeof resolveNodeServerStops
  /** Refuses with `PORT_UNAVAILABLE` while the declared port is taken. */
  assertPortFree(input: { port: number; signal: AbortSignal }): Promise<void>
  launch: typeof launchNodeServer
  signalGroup: typeof signalProcessGroup
  isGroupGone: typeof isProcessGroupGone
  readProcessStart(pid: number): Promise<string | undefined>
  /** Reads a process's working-folder realpath, to confirm a group is still the launched one before a retried stop signals it. */
  readProcessCwd(pid: number): Promise<string | undefined>
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
  readListeningPorts(pid: number): Promise<number[]>
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
  rememberProcess(record: {
    runId: string
    pid: number
    processGroup: number
    leaderStartedAt: string
    cwd: string
    inspectorPort: number
    declaredPort: number
  }): Promise<void>
  forgetProcess(runId: string): Promise<void>
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
  dependencies: NodeServerRunDependencies
}

/** A pause of the debugger that the run reports as the current declared-stop pause. */
type OwnedPause = {
  identity: PauseIdentity
  token: number
  native: NodeServerDebuggerPause
  declaredStopIndex: number
  captureIndex: number
}

/**
 * Builds the captured view of an owned pause from what the debugger read.
 * @param read - What the debugger captured.
 * @param pause - The pause and its run-wide generation.
 * @param capturedAtMs - Milliseconds since the launch.
 * @returns The capture kept in memory for the run's lifetime.
 * @example toCapture(read, { index: 0, generation: 1 }, 812).stopNumber // => 1
 */
function toCapture(
  read: NodeServerStopCapture,
  pause: { index: number; generation: number },
  capturedAtMs: number,
): NodeServerCapture {
  return {
    declaredStopIndex: pause.index,
    stopNumber: pause.index + 1,
    pauseGeneration: pause.generation,
    path: read.path,
    line: read.line,
    sourceHash: read.sourceHash,
    // Keyed by mode and path (`value:user.id`, `type:user.id`), as the other profiles' captures are, so both kinds of one path stay.
    facts: Object.fromEntries(
      read.facts.map((fact) => [`${fact.mode}:${fact.path}`, fact.display]),
    ),
    unavailable: read.unavailable.map((required) => ({
      path: required,
      reason: 'The debugger could not read this required value at the stop.',
    })),
    snapshot: read.snapshot,
    capturedAtMs,
    attribution: 'timing',
  }
}

/**
 * The node-server run the service drives (Issue #139 tasks 9–10): it launches the repository's server under the debugger, arms the declared stops, sends the declared request once, captures its hits and stops the server.
 * Its state is derived from what happened (lifecycle, held pauses, current pause, request outcome), so a state "returns to what it was" when a held pause is continued.
 */
class OwnedNodeServerRun implements NodeServerRuntime {
  readonly id: string
  private readonly abort = new AbortController()
  private readonly listeners = new Set<() => void>()
  private readonly clock: RunClock
  private readonly readiness: RunningTimeLimit
  private readonly requestLimit: RunningTimeLimit
  private preparation?: Promise<void>
  private server?: OwnedNodeServer
  private debug?: NodeServerDebugger
  private portClaim?: OwnedDevelopmentPortClaim
  private inspectorPort?: number
  private address?: ServerAddress
  private stopViews: NodeServerStop[] = []
  private prepared = false
  private lifecycle: 'live' | 'stopping' | 'stopped' = 'live'
  private stopAttempt?: Promise<void>
  private failedStops = 0
  private runFailure?: StudyError
  private holdExpired = false
  /** D14 v3, decided when the stop was admitted: the process group is killed before its debugger lets go. */
  private killFirst = false
  /** The clock's time when the current stop was admitted, which its detach, grace and group wait are counted from. */
  private stopAdmittedAtMs = 0
  /** How many releases the run has begun; a later one is a retry that must confirm the group before it signals. */
  private releaseAttempts = 0
  /** The launched leader's start (when readable) and folder, kept for the identity check of a retried stop. */
  private launchedLeader?: { startedAt?: string; cwd: string }
  // Pauses.
  private generation = 0
  private pause?: OwnedPause
  private reservedGeneration?: number
  private readonly heldPauses = new Map<number, NodeServerHeldPause>()
  private readonly nativeHolds = new Map<number, () => void>()
  private readonly ownResumes = new Set<number>()
  private readonly ownedHits = new Map<number, number>()
  private readonly stopsHitAtStart: number[] = []
  private readonly stopsReached: number[] = []
  // The declared request.
  private request?: NodeServerSentRequest
  private requestAbort = new AbortController()
  private requestToken = 0
  private requestEnded = false
  private cancelWall?: () => void
  private response?: NodeServerResponse
  private requestFailure?: NodeServerView['requestFailure']
  private readonly captures: NodeServerCapture[] = []
  private captureBudgetExhausted = false

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
   * @returns The state of the run's table.
   * @example this.currentState() // => 'request-in-flight' after the request was sent and nothing answered
   */
  private currentState(): NodeServerState {
    if (this.lifecycle !== 'live') return this.lifecycle
    const held = this.heldPauses.values().next().value
    if (held) return held.kind === 'learner' ? 'learner-paused' : 'unattributed'
    if (this.pause) return 'paused'
    if (this.requestFailure) return 'request-failed'
    if (this.response) return 'responded'
    if (this.request) return 'request-in-flight'
    return this.prepared ? 'ready' : 'preparing'
  }

  view(): NodeServerView {
    const pause = this.pause
    return {
      state: this.currentState(),
      pid: this.server?.pid,
      address: this.address && { ...this.address },
      stops: this.stopViews.map((stop) => ({ ...stop })),
      stopsHitAtStart: [...this.stopsHitAtStart],
      stopsReached: [...this.stopsReached],
      pauseGeneration: this.generation,
      pause: pause && {
        ...pause.identity,
        declaredStopIndex: pause.declaredStopIndex,
        stopNumber: pause.declaredStopIndex + 1,
        captureIndex: pause.captureIndex,
      },
      heldPause: this.heldPauses.values().next().value,
      request: this.request && { ...this.request },
      response: this.response,
      requestFailure: this.requestFailure && { ...this.requestFailure },
      captures: [...this.captures],
      captureBudgetExhausted: this.captureBudgetExhausted,
      runFailure: this.runFailure,
      failedStops: this.failedStops,
    }
  }

  // ---------------------------------------------------------------- preparation

  prepare(): Promise<void> {
    this.preparation ??= this.prepareOwned().catch(async (error: unknown) => {
      throw await this.endPreparationWith(error)
    })
    return this.preparation
  }

  /**
   * Closes everything a failed preparation started and names its failure; a stop requested meanwhile ends it without a run failure.
   * @param error - What the preparation threw.
   * @returns The typed error `prepare()` rejects with.
   * @example await this.endPreparationWith(new Error('refused')) // => RUNTIME_FAILED 'The node-server run failed while preparing: refused.'
   */
  private async endPreparationWith(error: unknown): Promise<StudyError> {
    if (this.lifecycle !== 'live')
      return new StudyError(
        'RUNTIME_FAILED',
        'The run was stopped while it was preparing.',
      )
    const failure = await this.explainPreparationFailure(error)
    this.runFailure ??= failure
    this.record('node-server.failure', {
      code: failure.code,
      cause: failure.causeDetail,
    })
    // Whatever the start began is closed before the failure is reported.
    await this.beginStop(false).catch(() => undefined)
    return failure
  }

  /**
   * Chooses the typed error of a failed preparation: the run's own failure, a typed refusal as it is, a server that exited (whatever the step reported), else the step's failure.
   * @param error - What the preparation threw.
   * @returns The typed error.
   * @example await this.explainPreparationFailure(new Error('ws closed')) // => SERVER_EXITED when the server exited meanwhile
   */
  private async explainPreparationFailure(error: unknown): Promise<StudyError> {
    if (this.runFailure) return this.runFailure
    if (error instanceof StudyError && error.code !== 'RUNTIME_FAILED')
      return error
    const server = this.server
    const exit = server && (server.exited() ?? (await this.settledExit()))
    if (server && exit)
      return serverExitedError(exit, server.output(), this.input.workspace)
    return error instanceof StudyError
      ? error
      : stepFailedError('preparing', error, this.input.workspace)
  }

  /** Waits briefly for the server's exit, for a failure whose cause may be that exit. */
  private settledExit(): Promise<NodeServerExit | undefined> {
    return (
      this.server?.waitForExit(NODE_SERVER_EXIT_SETTLE_MS) ??
      Promise.resolve(undefined)
    )
  }

  /** Runs one preparation step; a failure that is not typed already becomes the step's `RUNTIME_FAILED`. */
  private async step<Value>(
    name: string,
    work: () => Promise<Value>,
  ): Promise<Value> {
    try {
      return await work()
    } catch (error) {
      if (error instanceof StudyError) throw error
      throw stepFailedError(name, error, this.input.workspace)
    }
  }

  /**
   * The preparation in the order of decision D5: the checks that spawn nothing, then launch, attach, ownership, arming, the orphan record, release, readiness and the listener check.
   * @throws The typed error of the first failing step.
   */
  private async prepareOwned(): Promise<void> {
    const { workspace, configuration } = this.input
    const signal = this.abort.signal
    const stops = await this.checkBeforeSpawning(signal)
    const launched = await this.dependencies.resolveLaunch(
      workspace,
      configuration,
    )
    signal.throwIfAborted()
    await this.dependencies.assertPortFree({ port: configuration.port, signal })
    const server = await this.launchServer(launched)
    const attachSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(NODE_TEST_ATTACH_TIMEOUT_MS),
    ])
    const debug = this.debugger()
    await this.attachAndArm(server, launched.packageRoot, stops, attachSignal)
    this.readiness.start()
    await this.step('releasing the server', () => debug.releaseEntry(signal))
    await this.becomeReady(server)
  }

  /** The debugger, which exists once the stops are resolved. */
  private debugger(): NodeServerDebugger {
    if (!this.debug) throw new Error('The run has no debugger yet.')
    return this.debug
  }

  /**
   * Checks everything that needs no process: the cited sources on disk and in the editor (D12), and creates the run's debugger.
   * @returns The declared stops as the debugger arms them.
   */
  private async checkBeforeSpawning(
    signal: AbortSignal,
  ): Promise<NodeServerStopTarget[]> {
    const { workspace, configuration, runId } = this.input
    const stops = await this.dependencies.resolveStops(workspace, configuration)
    signal.throwIfAborted()
    this.stopViews = stops.map((stop) => ({
      declaredStopIndex: stop.declaredStopIndex,
      path: stop.path,
      declaredLine: stop.line,
    }))
    this.debug = this.dependencies.createDebugger({
      runId,
      workspace,
      citedSources: this.input.citedSources,
      stops,
      record: (type, detail) => this.record(type, detail),
    })
    // An editor document that differs from the article's cited source refuses the start before anything is spawned.
    this.debug.assertSourcesUnchanged()
    return stops
  }

  /** Starts the server and the watch on its exit; its port is claimed from here on. */
  private async launchServer(
    launched: Awaited<ReturnType<typeof resolveNodeServerLaunch>>,
  ): Promise<OwnedNodeServer> {
    const server = await this.dependencies.launch(
      {
        ...launched,
        workspace: this.input.workspace,
        node: this.dependencies.node,
      },
      (type, detail) => this.record(type, detail),
      (event) => this.onServerOutput(event),
    )
    this.server = server
    this.portClaim = claimOwnedDevelopmentPort(this.input.configuration.port)
    void server.whenExited().then((exit) => this.onServerExit(exit))
    return server
  }

  /** The launched server's pid and process group; a process that never started has none. */
  private identityOf(server: OwnedNodeServer): {
    pid: number
    processGroup: number
  } {
    const { pid, processGroup } = server
    if (pid === undefined || processGroup === undefined)
      throw new StudyError(
        'RUNTIME_FAILED',
        'The node-server run failed while starting the server: the process has no pid.',
      )
    return { pid, processGroup }
  }

  /**
   * Journals one chunk of the server's output. Node's own notice on stderr that only the attached debugger keeps a finished program alive lets the run's debugger go, so the exit follows and is reported as one.
   * The notice must be a line of stderr by itself, outside the request, and the process must listen on nothing but its inspector: output an application logs (stdout, a request's body, a database value) never counts.
   * @param event - The stamped chunk.
   */
  private async onServerOutput(event: ProcessOutputEvent): Promise<void> {
    if (
      event.channel === 'stderr' &&
      this.lifecycle === 'live' &&
      !this.inRequestWindow() &&
      event.text
        .split('\n')
        .some(
          (line) =>
            line.trim().replace(/\.+$/, '') ===
            NODE_SERVER_DEBUGGER_DISCONNECT_NOTICE,
        )
    )
      await this.releaseFinishedServer()
    this.record('node-server.output', {
      sequence: event.sequence,
      elapsedMs: event.elapsedMs,
      channel: event.channel,
      text: event.text,
    })
  }

  /** Lets the debugger go of a server that printed Node's notice, when it is really finished: it listens on nothing but its inspector. A lookup that cannot answer lets nothing go. */
  private async releaseFinishedServer(): Promise<void> {
    const pid = this.server?.pid
    if (pid === undefined) return
    const ports = await this.dependencies
      .readListeningPorts(pid)
      .catch(() => undefined)
    if (!ports || ports.some((port) => port !== this.inspectorPort)) return
    await this.debug?.release().catch(() => undefined)
  }

  /** Attaches the debugger, verifies the inspector, listens to its pauses and arms every declared stop. */
  private async attachAndArm(
    server: OwnedNodeServer,
    packageRoot: string,
    stops: NodeServerStopTarget[],
    signal: AbortSignal,
  ): Promise<void> {
    const debug = this.debugger()
    const { pid, processGroup } = this.identityOf(server)
    const endpoint = await this.step('waiting for the inspector endpoint', () =>
      server.inspectorEndpoint(signal),
    )
    this.inspectorPort = Number(new URL(endpoint).port)
    // The record is written before the attach, while the server waits paused: a window that dies now leaves a record the next activation reaps.
    await this.rememberLaunchedProcess(server, packageRoot)
    await this.step('attaching the debugger', () =>
      debug.attach({ endpoint, packageRoot, pid, processGroup, signal }),
    )
    this.record('node-server.attached', { pid })
    debug.subscribe({
      onPause: (pause) => this.onDebuggerPause(pause),
      onResume: (token) => this.onDebuggerResume(token),
      onEnd: (reason) => void this.onDebuggerEnd(reason),
    })
    // Every declared stop is armed before the server is released (D7).
    const armed = await this.step('arming the declared stops', () =>
      debug.armStops(stops, signal),
    )
    this.applyBoundLines(armed)
  }

  /** Copies the lines the debugger bound the stops to into the view. */
  private applyBoundLines(armed: NodeServerArmedStop[]): void {
    for (const stop of armed) {
      const view = this.stopViews[stop.declaredStopIndex]
      if (view && stop.boundLine !== undefined) view.boundLine = stop.boundLine
    }
  }

  /** Records the launched process for the orphan sweep of the next activation; a start time that cannot be read leaves no record, which the sweep could not match. */
  private async rememberLaunchedProcess(
    server: OwnedNodeServer,
    packageRoot: string,
  ): Promise<void> {
    const { pid, processGroup } = this.identityOf(server)
    const leaderStartedAt = await this.dependencies.readProcessStart(pid)
    this.launchedLeader = { startedAt: leaderStartedAt, cwd: packageRoot }
    if (leaderStartedAt === undefined) return
    await this.step('recording the launched process', () =>
      this.dependencies.rememberProcess({
        runId: this.input.runId,
        pid,
        processGroup,
        leaderStartedAt,
        cwd: packageRoot,
        inspectorPort: this.inspectorPort ?? 0,
        declaredPort: this.input.configuration.port,
      }),
    )
  }

  /** Waits for the server to accept on its declared port, verifies the listener and publishes `ready`. */
  private async becomeReady(server: OwnedNodeServer): Promise<void> {
    const { port } = this.input.configuration
    const accepted = await this.awaitAcceptance(server, port)
    const { pid, processGroup } = this.identityOf(server)
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
    this.prepared = true
    this.record('node-server.ready', { host: accepted.host, port })
    this.notify()
  }

  /**
   * Polls the declared port until it accepts, within the readiness budget of running time, or until the server exits first.
   * @returns The accepted loopback address.
   * @throws `SERVER_EXITED` when the server exited first; `SERVER_NOT_LISTENING` when the budget passed (naming the port the launched process listens on instead, if any); the run's failure when a pause hold expired.
   */
  private async awaitAcceptance(
    server: OwnedNodeServer,
    port: number,
  ): Promise<{ host: '127.0.0.1' | '::1'; bothAccept: boolean }> {
    const exited = server.whenExited()
    const outcome = await Promise.race([
      this.dependencies.waitForReadiness({
        port,
        hasTimeLeft: () => this.readiness.hasTimeLeft(),
        signal: this.abort.signal,
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
    if (this.runFailure) throw this.runFailure
    throw serverNotListeningError(port, await this.listeningElsewhere(server))
  }

  /** Finds the port the launched process listens on other than the declared one and the inspector's. */
  private async listeningElsewhere(
    server: OwnedNodeServer,
  ): Promise<number | undefined> {
    if (server.pid === undefined) return undefined
    const ports = await this.dependencies
      .readListeningPorts(server.pid)
      .catch(() => [])
    return ports.find(
      (port) =>
        port !== this.input.configuration.port && port !== this.inspectorPort,
    )
  }

  // ---------------------------------------------------------------- failures

  /** The server exited by itself (or its debug session ended): before readiness the preparation reports it, afterwards it is the run's failure. */
  private onServerExit(exit: NodeServerExit): void {
    if (this.lifecycle !== 'live' || !this.prepared || !this.server) return
    this.failRun(
      serverExitedError(exit, this.server.output(), this.input.workspace),
    )
  }

  /** The debug session ended while the run lived: an exit of the server explains it, else the session was ended from outside. */
  private async onDebuggerEnd(reason: string): Promise<void> {
    if (this.lifecycle !== 'live') return
    const exit = await this.settledExit()
    if (exit && this.server) {
      this.onServerExit(exit)
      return
    }
    this.failRun(
      stepFailedError(
        'watching the debug session',
        new Error(`The debug session ended: ${reason}`),
        this.input.workspace,
      ),
    )
  }

  /**
   * Records a failure that ends the run; the first one stands. After readiness the run closes itself (the service stops it too); before, the preparation reports it.
   * @param error - The typed failure.
   * @example this.failRun(new StudyError('PAUSE_HOLD_EXPIRED', '…'))
   */
  private failRun(error: StudyError): void {
    if (this.runFailure || this.lifecycle !== 'live') return
    this.runFailure = error
    this.record('node-server.failure', {
      code: error.code,
      cause: error.causeDetail,
    })
    this.notify()
    if (this.prepared) void this.stop().catch(() => undefined)
    else this.abort.abort(error)
  }

  // ---------------------------------------------------------------- pauses

  /**
   * Starts holding for a native pause: the running-time limits stop counting and the pause-hold bound runs.
   * @param token - The native pause.
   */
  private beginHold(token: number): void {
    this.readiness.hold()
    this.requestLimit.hold()
    this.nativeHolds.set(
      token,
      this.clock.set(() => this.expireHold(), REPOSITORY_PAUSE_HOLD_TIMEOUT_MS),
    )
  }

  /** Ends the hold of a native pause; `false` when it held nothing. */
  private endHold(token: number): boolean {
    const cancel = this.nativeHolds.get(token)
    if (!cancel) return false
    cancel()
    this.nativeHolds.delete(token)
    this.readiness.release()
    this.requestLimit.release()
    return true
  }

  /** A pause lasted past the hold bound: the run ends and, per D14, the paused code is killed, never resumed. */
  private expireHold(): void {
    this.holdExpired = true
    this.failRun(
      new StudyError(
        'PAUSE_HOLD_EXPIRED',
        `The server stayed paused for more than ${REPOSITORY_PAUSE_HOLD_TIMEOUT_MS / 1_000} s, so Codebook ended the run without resuming the paused code.`,
      ),
    )
  }

  /** Whether the declared request is under way: sent, and not answered or failed yet. */
  private inRequestWindow(): boolean {
    return this.request !== undefined && !this.requestEnded
  }

  /**
   * Tells which kind of pause a native pause is.
   * @param pause - The debugger's report.
   * @returns
   * - `learner` for a pause that is no hit of a declared stop
   * - `start-hit` for a declared stop hit before readiness
   * - `request-hit` for one hit inside the request window
   * - `unattributed` for one hit outside it
   */
  private classify(
    pause: NodeServerDebuggerPause,
  ): 'learner' | 'start-hit' | 'request-hit' | 'unattributed' {
    if (pause.declaredStopIndex === undefined) return 'learner'
    if (!this.prepared) return 'start-hit'
    return this.inRequestWindow() ? 'request-hit' : 'unattributed'
  }

  /** A native pause after the entry pause (the debugger's `onPause`). */
  private onDebuggerPause(pause: NodeServerDebuggerPause): void {
    // D14 v3 for a pause that arrives after the stop was admitted: whatever it is (a declared stop, the learner's, inside the request or not), the detach would resume it, so the group is killed first.
    if (this.lifecycle === 'stopping') this.killFirst = true
    if (this.lifecycle !== 'live') return
    this.generation += 1
    const kind = this.classify(pause)
    if (kind === 'start-hit') {
      this.continueStartHit(pause)
      return
    }
    this.beginHold(pause.token)
    if (pause.declaredStopIndex !== undefined)
      this.ownedHits.set(pause.token, pause.declaredStopIndex)
    if (kind === 'request-hit') void this.captureHit(pause, this.generation)
    else this.holdPause(kind, pause)
  }

  /** A declared stop hit before readiness is recorded and continued: the AI can say the request may not reach that line. */
  private continueStartHit(pause: NodeServerDebuggerPause): void {
    const index = pause.declaredStopIndex!
    if (!this.stopsHitAtStart.includes(index)) this.stopsHitAtStart.push(index)
    this.record('node-server.stop-hit-at-start', { declaredStopIndex: index })
    this.ownResumes.add(pause.token)
    this.debugger()
      .resume(pause, this.abort.signal)
      .catch((error: unknown) =>
        this.failRun(
          stepFailedError(
            'continuing a stop hit before readiness',
            error,
            this.input.workspace,
          ),
        ),
      )
    this.notify()
  }

  /** A pause that is the learner's, or an owned hit outside the request: held, never resumed. */
  private holdPause(
    kind: 'learner' | 'unattributed',
    pause: NodeServerDebuggerPause,
  ): void {
    this.heldPauses.set(pause.token, {
      kind,
      reason: pause.reason,
      sessionId: pause.sessionId,
      threadId: pause.threadId,
      path: pause.location?.path,
      line: pause.location?.line,
    })
    this.record('node-server.learner-paused', {
      kind,
      reason: pause.reason,
      path: pause.location?.path,
      line: pause.location?.line,
      declaredStopIndex: pause.declaredStopIndex,
    })
    this.notify()
  }

  /**
   * Captures a declared stop hit inside the request window, up to the capture limit; the hit beyond it retires the owned breakpoints and goes on uncaptured.
   * @param pause - The native pause.
   * @param generation - Its run-wide pause generation.
   */
  private async captureHit(
    pause: NodeServerDebuggerPause,
    generation: number,
  ): Promise<void> {
    try {
      if (this.captures.length >= NODE_SERVER_REQUEST_CAPTURE_LIMIT) {
        await this.continueUncaptured(pause)
        return
      }
      const read = await this.debugger().capture(pause, this.abort.signal)
      // A pause the learner resumed while it was captured is no pause any more.
      if (!this.nativeHolds.has(pause.token)) return
      this.acceptCapture(pause, generation, read)
    } catch (error) {
      if (this.lifecycle !== 'live' || !this.nativeHolds.has(pause.token))
        return
      this.failRun(
        error instanceof StudyError
          ? error
          : stepFailedError(
              'capturing a declared stop',
              error,
              this.input.workspace,
            ),
      )
    }
  }

  /** Publishes a captured hit as the run's current pause. */
  private acceptCapture(
    pause: NodeServerDebuggerPause,
    generation: number,
    read: NodeServerStopCapture,
  ): void {
    const index = pause.declaredStopIndex!
    this.captures.push(
      toCapture(read, { index, generation }, this.server?.elapsedMs() ?? 0),
    )
    this.stopsReached.push(index)
    this.pause = {
      identity: {
        sessionId: pause.sessionId,
        threadId: pause.threadId,
        generation,
      },
      token: pause.token,
      native: pause,
      declaredStopIndex: index,
      captureIndex: this.captures.length - 1,
    }
    this.record('node-server.pause', {
      declaredStopIndex: index,
      stopNumber: index + 1,
      pauseGeneration: generation,
    })
    this.notify()
  }

  /** The hit beyond the capture limit: every owned breakpoint is retired and the server continues uncaptured. */
  private async continueUncaptured(
    pause: NodeServerDebuggerPause,
  ): Promise<void> {
    this.captureBudgetExhausted = true
    this.record('node-server.capture-budget-exhausted', {
      limit: NODE_SERVER_REQUEST_CAPTURE_LIMIT,
    })
    const debug = this.debugger()
    await debug.retireStops(this.abort.signal)
    this.ownResumes.add(pause.token)
    await debug.resume(pause, this.abort.signal)
    this.endHold(pause.token)
    this.ownedHits.delete(pause.token)
    this.notify()
  }

  /** The paused thread ran on (the debugger's `onResume`): Codebook's own resume is its own business, a learner's Continue is journaled and the state returns to what it was. */
  private onDebuggerResume(token: number): void {
    // Codebook's own resume under way: continue() settles the pause when the adapter answers, or restores it when the adapter fails.
    if (
      this.reservedGeneration !== undefined &&
      this.pause?.token === token &&
      this.ownResumes.has(token)
    )
      return
    const ownResume = this.ownResumes.delete(token)
    const wasHeld = this.endHold(token)
    const declaredStopIndex = this.ownedHits.get(token)
    this.ownedHits.delete(token)
    this.heldPauses.delete(token)
    if (this.pause?.token === token) this.pause = undefined
    if (!wasHeld) return
    if (!ownResume && declaredStopIndex !== undefined)
      this.record('node-server.learner-resumed', { declaredStopIndex })
    this.notify()
  }

  async continue(identity: PauseIdentity): Promise<void> {
    // A held pause is the learner's: before every other refusal.
    if (this.heldPauses.size > 0)
      throw new StudyError('LEARNER_PAUSED', this.learnerPausedText())
    const pause = this.pause
    // A run that is ending or ended has only historical pauses (the state × call table).
    if (this.lifecycle !== 'live')
      throw new StudyError(
        'STALE_PAUSE',
        'The run is stopping or stopped, so this pause is historical.',
      )
    if (!pause)
      throw new StudyError(
        'NO_PAUSE',
        'The server is not paused at a declared stop.',
      )
    if (
      this.reservedGeneration !== undefined ||
      pause.identity.sessionId !== identity.sessionId ||
      pause.identity.threadId !== identity.threadId ||
      pause.identity.generation !== identity.generation
    )
      throw new StudyError(
        'STALE_PAUSE',
        'This pause is no longer the current one; read the run for the current pause.',
      )
    // The pause is claimed before any await, so a second continue of it is stale.
    this.reservedGeneration = pause.identity.generation
    try {
      this.debugger().assertSourcesUnchanged()
      this.ownResumes.add(pause.token)
      await this.debugger().resume(pause.native, this.abort.signal)
    } catch (error) {
      this.ownResumes.delete(pause.token)
      this.reservedGeneration = undefined
      throw error instanceof StudyError
        ? error
        : stepFailedError('continuing the server', error, this.input.workspace)
    }
    this.reservedGeneration = undefined
    if (this.pause === pause) this.pause = undefined
    this.endHold(pause.token)
    this.ownedHits.delete(pause.token)
    this.notify()
  }

  /** The `LEARNER_PAUSED` message for the held pause. */
  private learnerPausedText(): string {
    const held = this.heldPauses.values().next().value
    return held?.kind === 'unattributed'
      ? 'The server stopped at a declared line outside the request; Codebook never resumes it. Ask the learner to continue it in the debugger.'
      : 'The learner paused the server; Codebook never resumes it. Ask the learner to continue it in the debugger.'
  }

  // ---------------------------------------------------------------- the declared request

  async sendRequest(key: string): Promise<void> {
    if (this.heldPauses.size > 0)
      throw new StudyError('LEARNER_PAUSED', this.learnerPausedText())
    if (this.request)
      throw new StudyError(
        'REQUEST_ALREADY_SENT',
        'This run already sent its request; read the run for its outcome.',
      )
    if (this.currentState() !== 'ready' || !this.address || !this.server)
      throw new StudyError(
        'RUN_NOT_READY',
        'The server is not ready for its request yet.',
      )
    const { host, port } = this.address
    const server = this.server
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
        sanitize: (text) =>
          sanitizeCause(text, causeRootsFor([], this.input.workspace)),
      })
    } catch (error) {
      // The sender never started: the window closes and the request may be tried again.
      this.closeRequestWindow(token)
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
        this.closeRequestWindow(token)
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
      sentAtMs: this.server?.elapsedMs() ?? 0,
    }
    this.requestLimit.start()
    this.cancelWall = this.clock.set(
      () => this.timeOutRequest('wall-time'),
      NODE_SERVER_REQUEST_WALL_LIMIT_MS,
    )
    this.debugger().setRequestWindow(true)
    this.notify()
  }

  /** Journals the request once its bytes were handed to the socket, so a refused or stopped request never reads as sent. */
  private recordSentRequest(token: number): void {
    if (token !== this.requestToken || !this.request) return
    this.record('node-server.request', {
      method: this.request.method,
      path: this.request.path,
      bodyBytes: this.request.bodyBytes,
      address: this.request.address,
    })
  }

  /** Takes the window back when the request was refused before its bytes were written. */
  private closeRequestWindow(token: number): void {
    if (token !== this.requestToken) return
    this.requestToken += 1
    this.request = undefined
    this.requestLimit.stop()
    this.cancelWall?.()
    this.debugger().setRequestWindow(false)
    this.notify()
  }

  /** Reads which process the connected socket reaches and refuses unless it is the launched server. */
  private async verifyPeer(
    connection: { localPort: number; remotePort: number },
    server: OwnedNodeServer,
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
    if (this.lifecycle !== 'live') return
    this.response = response
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
    if (this.lifecycle !== 'live') return
    const exit = await this.settledExit()
    if (exit && this.server) {
      this.onServerExit(exit)
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
    if (!this.inRequestWindow() || this.lifecycle !== 'live') return
    this.requestFailure = { code, message }
    this.record('node-server.failure', { code, cause: message })
    this.requestAbort.abort(new Error(code))
    void this.endRequest()
  }

  /** The request ended: its window closes and every owned breakpoint is retired. */
  private async endRequest(): Promise<void> {
    this.requestEnded = true
    this.requestLimit.stop()
    this.cancelWall?.()
    this.debug?.setRequestWindow(false)
    this.notify()
    try {
      await this.debug?.retireStops(this.abort.signal)
    } catch (error) {
      if (this.lifecycle === 'live')
        this.failRun(
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
    return this.beginStop(true)
  }

  /**
   * Admits a stop: the first call starts it, concurrent and later calls share it, and a failed one is dropped so the next call retries.
   * @param afterPreparation - Whether the stop waits for a preparation that is still under way to unwind first (a stop asked from outside does; a preparation closing itself does not).
   */
  private beginStop(afterPreparation: boolean): Promise<void> {
    if (this.stopAttempt) return this.stopAttempt
    // D14 is decided at admission, before the holds are cleared.
    this.killFirst ||= this.mustKillFirst()
    this.stopAdmittedAtMs = this.clock.now()
    this.lifecycle = 'stopping'
    this.abort.abort()
    // A request still checking its connection writes nothing once the stop is admitted.
    this.requestAbort.abort(
      new StudyError(
        'RUN_NOT_READY',
        'The run was stopped before its request was written, so nothing was sent.',
      ),
    )
    this.cancelTimers()
    this.notify()
    const attempt = this.stopWithinDeadline(afterPreparation).catch(
      (error: unknown) => {
        // A failed stop is retryable: the next call runs again.
        if (this.stopAttempt === attempt) this.stopAttempt = undefined
        throw error
      },
    )
    this.stopAttempt = attempt
    return attempt
  }

  /**
   * Runs the release against the stop's one monotonic deadline; at the deadline the stop fails with what remains and the run reads `stopping`.
   * @throws The retryable `RUNTIME_FAILED` naming the owned pid or port that remains.
   */
  private async stopWithinDeadline(afterPreparation: boolean): Promise<void> {
    let cancelDeadline = (): void => undefined
    const deadline = new Promise<never>((_, reject) => {
      cancelDeadline = this.clock.set(
        () => reject(this.remainingError()),
        NODE_SERVER_STOP_DEADLINE_MS,
      )
    })
    const work = this.releaseAfterPreparation(afterPreparation)
    // The release goes on after a lost race; its later outcome is the next attempt's business.
    work.catch(() => undefined)
    try {
      await Promise.race([work, deadline])
    } catch (error) {
      this.failedStops += 1
      this.notify()
      throw error instanceof StudyError
        ? error
        : stepFailedError('stopping the server', error, this.input.workspace)
    } finally {
      cancelDeadline()
    }
    this.lifecycle = 'stopped'
    this.pause = undefined
    this.heldPauses.clear()
    this.record('node-server.stopped', { pid: this.server?.pid })
    this.notify()
    // Reported apart: a slow lookup never delays or fails a complete stop.
    void this.reportForeignListener().catch(() => undefined)
  }

  /** Lets a preparation under way unwind (it was aborted at admission), then releases what it started. */
  private async releaseAfterPreparation(
    afterPreparation: boolean,
  ): Promise<void> {
    if (afterPreparation) await this.preparation?.catch(() => undefined)
    await this.releaseOwned()
  }

  /** Cancels every timer of the run's limits and holds. */
  private cancelTimers(): void {
    this.readiness.stop()
    this.requestLimit.stop()
    this.cancelWall?.()
    for (const cancel of this.nativeHolds.values()) cancel()
    this.nativeHolds.clear()
  }

  /** The error of a stop that ran out of time: it names the owned pid that remains, or the port when only the debug session does. */
  private remainingError(): StudyError {
    const pid = this.server?.processGroup
    const alive =
      pid !== undefined && !this.safeGroupGone(pid)
        ? this.server?.pid
        : undefined
    return stopFailedError(
      { pid: alive, port: this.input.configuration.port },
      this.failedStops + 1,
    )
  }

  /** Whether the group has no member left; an unreadable group counts as still there ({@link isGroupCertainlyGone}). */
  private safeGroupGone(processGroup: number): boolean {
    return isGroupCertainlyGone(this.dependencies.isGroupGone, processGroup)
  }

  /**
   * Releases everything the run owns: the process group (killed first while its request is under way or it is paused in the debugger, D14 v3; otherwise the debugger detaches, SIGTERM, SIGKILL by 5 s), the debug session, the orphan record and the port claim. A foreign listener on the port never keeps the run from stopping; it is reported apart.
   */
  private async releaseOwned(): Promise<void> {
    const server = this.server
    const claim = this.portClaim
    const isRetry = this.releaseAttempts++ > 0
    if (claim) beginReleaseOfOwnedDevelopmentPort(claim)
    if (server?.processGroup !== undefined) {
      // A stop the editor reported after the admission and is still reading may be inside the request too.
      if (this.debug?.hasUnreportedPause()) this.killFirst = true
      // The paused code must not run on: the group dies before the debugger lets go of it.
      if (this.killFirst && (await this.maySignal(server, isRetry)))
        this.dependencies.signalGroup(server.processGroup, 'SIGKILL')
      await server.close(
        this.killFirst
          ? undefined
          : (): Promise<void> => this.debug?.release() ?? Promise.resolve(),
        {
          sinceAdmissionMs: () => this.clock.now() - this.stopAdmittedAtMs,
          confirmGroup: () => this.confirmLaunchedGroup(server),
          // An earlier stop may have signalled the group before its close ran (a SIGKILL that failed), so the close checks it from its first signal.
          retried: isRetry,
        },
      )
    }
    await this.debug?.release()
    await this.dependencies
      .forgetProcess(this.input.runId)
      .catch((error: unknown) =>
        this.record('node-server.orphan-record-kept', {
          cause: sanitizeRunCause(error, this.input.workspace),
        }),
      )
    if (claim) releaseOwnedDevelopmentPort(claim)
  }

  /**
   * Reads whether the group is still the launched one: the leader's start and folder against the launch's ({@link confirmLaunchedGroup}).
   * @param server - The launched server.
   * @returns The verdict; `unverifiable` when the launch left no identity or the server has no pid.
   */
  private async confirmLaunchedGroup(
    server: OwnedNodeServer,
  ): Promise<LaunchedGroupVerdict> {
    const leader = this.launchedLeader
    if (server.pid === undefined || !leader) return 'unverifiable'
    return confirmLaunchedGroup({
      pid: server.pid,
      startedAt: leader.startedAt,
      cwd: leader.cwd,
      leaderExited: server.exited() !== undefined,
      readProcessStart: this.dependencies.readProcessStart,
      readProcessCwd: this.dependencies.readProcessCwd,
      isGroupGone: this.dependencies.isGroupGone,
    })
  }

  /**
   * Decides whether the run's own SIGKILL may be sent: the first release always, a retried one only while the group is still the launched one, so a reused group id never receives it.
   * @param server - The launched server.
   * @param isRetry - Whether an earlier release of this run already began.
   * @returns `true` to signal, `false` when the group id belongs to another process now (nothing is signalled; the launcher's close finds the same).
   * @throws When a retry cannot tell whose group it is: the stop fails retryably and names the pid.
   */
  private async maySignal(
    server: OwnedNodeServer,
    isRetry: boolean,
  ): Promise<boolean> {
    if (!isRetry) return true
    const verdict = await this.confirmLaunchedGroup(server)
    if (verdict === 'unverifiable')
      throw new Error(
        'The server process group could not be confirmed as the one Codebook started, so it was not signalled again.',
      )
    return verdict === 'launched'
  }

  /** D14 v3: a server paused in the debugger (a declared stop, the learner's own pause, or a stop the run has not classified yet), whose request is under way (paused or not: a stop it reaches during the detach would be resumed by it) or whose pause hold expired, is killed before its debugger lets go; a server that is not paused takes Stop v2. */
  private mustKillFirst(): boolean {
    if (this.holdExpired) return true
    if (this.inRequestWindow()) return true
    if (this.debug?.hasUnreportedPause()) return true
    // Every native pause the run holds (declared, learner's, unattributed) is code the detach would resume.
    return this.nativeHolds.size > 0 || this.heldPauses.size > 0
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
