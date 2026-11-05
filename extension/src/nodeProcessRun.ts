import type { ConfiguredDescriptor } from './configuredStudySchemas'
import {
  NODE_SERVER_EXIT_SETTLE_MS,
  NODE_SERVER_REQUEST_CAPTURE_LIMIT,
  NODE_SERVER_STOP_DEADLINE_MS,
  NODE_TEST_ATTACH_TIMEOUT_MS,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
} from './constants'
import { StudyError } from './errors'
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
  NodeServerStop,
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
  stepFailedError,
  stopFailedError,
} from './utils/describeNodeServerRunFailure'
import { isGroupCertainlyGone } from './utils/isGroupCertainlyGone'
import type { isProcessGone } from './utils/isProcessGone'
import type { isProcessGroupGone } from './utils/isProcessGroupGone'
import type { launchNodeServer, NodeServerExit } from './utils/launchNodeServer'
import type { ResolvedNodeServerLaunch } from './utils/resolveNodeServerLaunch'
import type { RunClock } from './utils/runningTimeLimit'
import type { CauseRoots } from './utils/sanitizeCause'
import type { signalProcessGroup } from './utils/signalProcessGroup'

/** The process the launcher started ({@link launchNodeServer}). */
export type OwnedNodeProcess = Awaited<ReturnType<typeof launchNodeServer>>

/** What a run needs from outside to own a Node process under the debugger, injected so the whole state machine runs against fakes. */
export type NodeProcessRunDependencies = {
  clock: RunClock
  /** The external Node executable and its version. */
  node: { executable: string; version: string }
  createDebugger(input: NodeServerDebuggerInput): NodeServerDebugger
  launch: typeof launchNodeServer
  signalGroup: typeof signalProcessGroup
  isGroupGone: typeof isProcessGroupGone
  /** Whether no process has an id (signal 0 to the pid), to tell the survivors of a leader that exited from a group that took its id ({@link confirmLaunchedGroup}). */
  isProcessGone: typeof isProcessGone
  readProcessStart(pid: number): Promise<string | undefined>
  /** Reads a process's working-folder realpath, to confirm a group is still the launched one before a retried stop signals it. */
  readProcessCwd(pid: number): Promise<string | undefined>
  /** The ports a process listens on, to tell a finished process (its inspector only) from a serving one. */
  readListeningPorts(pid: number): Promise<number[]>
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

/** The lifecycle of a run: it lives, its stop was admitted, its stop completed. */
export type NodeProcessLifecycle = 'live' | 'stopping' | 'stopped'

/** What the owner of a run hooks into the core: the parts of the run that are not about the process itself. */
export type NodeProcessRunHooks = {
  /** Whether a native pause now is inside the window the owner treats as its capture window (the server's request window; a script run answers `true` once released). */
  inWindow(): boolean
  /** The owner's running-time limits stop counting while a native pause is held. */
  holdLimits(): void
  /** The owner's running-time limits count again after the last native hold ended. */
  releaseLimits(): void
  /** A stop was admitted: the owner aborts what it started and cancels its own timers. */
  onStopAdmitted(): void
  /** The launcher's output, delivered at once, in arrival order. */
  onProcessOutput(event: ProcessOutputEvent): void | Promise<void>
  /** A declared stop was captured; queued in the same turn, ahead of the pause being published. */
  onStopCaptured?(
    elapsedMs: number,
    pause: NodeServerDebuggerPause,
    generation: number,
    read: NodeServerStopCapture,
  ): void
  /** The capture budget was spent at this hit. */
  onCaptureBudgetExhausted?(): void
  /** A release began: the owner's resources (a port claim) start to be given back. */
  onReleaseBegin?(): void
  /** The release finished: the owner gives its resources back for good. */
  onReleased?(): void
  /** The stop completed; the owner may report what it finds apart (never delays or fails the stop). */
  onStopped?(): Promise<void>
}

/** What a run's owner fixes when it creates the core. */
export type NodeProcessRunInput = {
  /** The opened repository's real root. */
  workspace: string
  /** The service's run id: named in the debug session and the orphan record. */
  runId: string
  /** Journals the run's `node-server.*` events. */
  record: (type: string, detail?: unknown) => unknown
  /** The article's text of every source the selected node cites. */
  citedSources: ConfiguredDescriptor['sources']
  /** The port recorded with the orphan record and named by a failed stop; `0` when the run declares none. */
  declaredPort: number
  /** The private roots hidden everywhere, frozen for the run; the workspace and the home directory when absent. */
  privateRoots?: CauseRoots
  dependencies: NodeProcessRunDependencies
  /** Tells the owner's listeners the view changed. */
  notify: () => void
  hooks: NodeProcessRunHooks
}

/** What one preparation does that depends on what is run. */
export type NodeProcessPreparation = {
  /** Resolves the declared stops (checks that need no process). */
  resolveStops(): Promise<NodeServerStopTarget[]>
  /** Resolves the checked real paths to launch. */
  resolveLaunch(): Promise<ResolvedNodeServerLaunch>
  /** Runs after the launch input is resolved and before anything is spawned (the server's port check). */
  beforeLaunch?(signal: AbortSignal): Promise<void>
  /** Runs once the process exists (the server claims its port). */
  afterLaunch?(process: OwnedNodeProcess): void
  /** Runs after every stop is armed and right before the entry release (the server starts its readiness clock). */
  beforeRelease?(): void
  /** Runs after the entry release, inside the same guarded preparation (the server's readiness and listener check). */
  afterRelease(): Promise<void>
}

/** What a run shows its owner: the state a view is derived from. */
export type NodeProcessSnapshot = {
  lifecycle: NodeProcessLifecycle
  prepared: boolean
  pid?: number
  stops: NodeServerStop[]
  stopsHitAtStart: number[]
  stopsReached: number[]
  pauseGeneration: number
  pause?: PauseIdentity & {
    declaredStopIndex: number
    stopNumber: number
    captureIndex: number
  }
  heldPause?: NodeServerHeldPause
  captures: NodeServerCapture[]
  captureBudgetExhausted: boolean
  runFailure?: StudyError
  failedStops: number
}

/** A stop's release that detaches the debugger before it signals (no kill-first), while its close is under way: whether it is a retry, and whether a late pause already asked to end the group. */
type DetachRelease = { isRetry: boolean; killed: boolean }

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
 * The composition core of a run that owns one Node process under the editor's debugger: it prepares (checks, launch, attach, ownership, arming, orphan record, release), classifies and holds pauses, captures declared stops within the capture budget, continues them and stops the whole process group.
 * Why: the server run and a script run share the hard-won pause and stop logic; the owner keeps what is about its own kind of run (the server's port, readiness and request) behind {@link NodeProcessRunHooks} and {@link NodeProcessPreparation}.
 * Created by {@link OwnedNodeServerRun}; a script run constructs it the same way with its own hooks.
 * @example
 * const core = new NodeProcessRun({ workspace, runId, record, citedSources, declaredPort: 0, dependencies, notify, hooks })
 * await core.prepare({ resolveStops, resolveLaunch, afterRelease })
 * await core.stop()
 */
export class NodeProcessRun {
  private readonly abort = new AbortController()
  private readonly clock: RunClock
  private preparation?: Promise<void>
  private server?: OwnedNodeProcess
  private debug?: NodeServerDebugger
  private currentInspectorPort?: number
  private stopViews: NodeServerStop[] = []
  private prepared = false
  private currentLifecycle: NodeProcessLifecycle = 'live'
  private stopAttempt?: Promise<void>
  private failedStops = 0
  private currentRunFailure?: StudyError
  private holdExpired = false
  /** D14 v3, decided when the stop was admitted: the process group is killed before its debugger lets go. */
  private killFirst = false
  /** The clock's time when the current stop was admitted, which its detach, grace and group wait are counted from. */
  private stopAdmittedAtMs = 0
  /** The time since launch when the run's end was first known (a stop admitted, or a failure that ends it); `elapsedSinceLaunchMs` answers it from then on, so a seal delayed or retried after the end still carries the end's own time. */
  private frozenElapsedMs?: number
  /** How many releases the run has begun; a later one is a retry that must confirm the group before it signals. */
  private releaseAttempts = 0
  /** The launched leader's start as read after the spawn (read again before the attach when that failed), kept for the identity check of a retried stop. */
  private launchedStartedAt?: string
  /** The release that detaches the debugger before it signals (no kill-first), while its close is under way; a pause reported meanwhile ends the group at once. */
  private detachRelease?: DetachRelease
  private frozenPrivateRoots?: CauseRoots
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
  private readonly captures: NodeServerCapture[] = []
  private captureBudgetExhausted = false

  constructor(private readonly input: NodeProcessRunInput) {
    this.clock = input.dependencies.clock
  }

  private get dependencies(): NodeProcessRunDependencies {
    return this.input.dependencies
  }

  private get hooks(): NodeProcessRunHooks {
    return this.input.hooks
  }

  /** Journals one event of the run. */
  private record(type: string, detail?: unknown): void {
    this.input.record(type, detail)
  }

  private notify(): void {
    this.input.notify()
  }

  /** Aborts when a stop is admitted or a failure ends a preparation; the owner's own waits listen to it. */
  get signal(): AbortSignal {
    return this.abort.signal
  }

  /** The launched process, once the launch returned. */
  get launched(): OwnedNodeProcess | undefined {
    return this.server
  }

  /** The inspector's port, once the endpoint was announced. */
  get inspectorPort(): number | undefined {
    return this.currentInspectorPort
  }

  get lifecycle(): NodeProcessLifecycle {
    return this.currentLifecycle
  }

  /** The failure that ended the run, if any. */
  get runFailure(): StudyError | undefined {
    return this.currentRunFailure
  }

  /** The debugger once the stops are resolved; the owner reads it for its window and its breakpoint retirement. */
  get debuggerSession(): NodeServerDebugger | undefined {
    return this.debug
  }

  /**
   * Declares the run prepared: pauses after it are classified by the owner's window, a process exit is the run's failure, and a failure stops the run instead of aborting a preparation.
   * Called by the owner when its own readiness is complete (the server after its listener check; a script run at its release).
   */
  markPrepared(): void {
    this.prepared = true
  }

  /** The run's state as the owner derives its view from. */
  snapshot(): NodeProcessSnapshot {
    const pause = this.pause
    return {
      lifecycle: this.currentLifecycle,
      prepared: this.prepared,
      pid: this.server?.pid,
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
      captures: [...this.captures],
      captureBudgetExhausted: this.captureBudgetExhausted,
      runFailure: this.currentRunFailure,
      failedStops: this.failedStops,
    }
  }

  // ---------------------------------------------------------------- preparation

  /**
   * Prepares the run once: later calls share the first.
   * @param preparation - What the owner does around the shared steps ({@link NodeProcessPreparation}).
   * @returns Resolves when the owner's `afterRelease` did; rejects with the typed failure of the first failing step, after what the start began was closed.
   */
  prepare(preparation: NodeProcessPreparation): Promise<void> {
    this.preparation ??= this.prepareOwned(preparation).catch(
      async (error: unknown) => {
        throw await this.endPreparationWith(error)
      },
    )
    return this.preparation
  }

  /**
   * Closes everything a failed preparation started and names its failure; a stop requested meanwhile ends it without a run failure.
   * @param error - What the preparation threw.
   * @returns The typed error `prepare()` rejects with.
   * @example await this.endPreparationWith(new Error('refused')) // => RUNTIME_FAILED 'The node-server run failed while preparing: refused.'
   */
  private async endPreparationWith(error: unknown): Promise<StudyError> {
    if (this.currentLifecycle !== 'live')
      return new StudyError(
        'RUNTIME_FAILED',
        'The run was stopped while it was preparing.',
      )
    const failure = await this.explainPreparationFailure(error)
    this.currentRunFailure ??= failure
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
    if (this.currentRunFailure) return this.currentRunFailure
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

  /**
   * Waits briefly for the process's exit, for a failure whose cause may be that exit.
   * @returns How the process ended, or `undefined` while it runs.
   */
  settledExit(): Promise<NodeServerExit | undefined> {
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
   * The preparation in the order of decision D5: the checks that spawn nothing, then launch, attach, ownership, arming, the orphan record, release, and the owner's own steps after it.
   * @param preparation - What the owner does around the shared steps.
   * @throws The typed error of the first failing step.
   */
  private async prepareOwned(
    preparation: NodeProcessPreparation,
  ): Promise<void> {
    const signal = this.abort.signal
    const stops = await this.checkBeforeSpawning(preparation, signal)
    const launched = await preparation.resolveLaunch()
    signal.throwIfAborted()
    await preparation.beforeLaunch?.(signal)
    const server = await this.launchServer(launched, preparation)
    const attachSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(NODE_TEST_ATTACH_TIMEOUT_MS),
    ])
    const debug = this.requireDebugger()
    await this.attachAndArm(server, launched.packageRoot, stops, attachSignal)
    preparation.beforeRelease?.()
    await this.step('releasing the server', () => debug.releaseEntry(signal))
    await preparation.afterRelease()
  }

  /**
   * The debugger, which exists once the stops are resolved.
   * @returns The run's debugger.
   * @throws When the stops are not resolved yet.
   */
  requireDebugger(): NodeServerDebugger {
    if (!this.debug) throw new Error('The run has no debugger yet.')
    return this.debug
  }

  /**
   * Checks everything that needs no process: the cited sources on disk and in the editor (D12), and creates the run's debugger.
   * @returns The declared stops as the debugger arms them.
   */
  private async checkBeforeSpawning(
    preparation: NodeProcessPreparation,
    signal: AbortSignal,
  ): Promise<NodeServerStopTarget[]> {
    const { workspace, runId } = this.input
    const stops = await preparation.resolveStops()
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

  /**
   * The roots hidden in the process's output and the owner's text: the service's full set, else the workspace and the home directory. Computed once and frozen for the run, so the output stage, the response sanitizer and the history all hide one set (a folder added mid-run is hidden from the next run on).
   * @returns The frozen roots.
   */
  privateRoots(): CauseRoots {
    this.frozenPrivateRoots ??=
      this.input.privateRoots ?? causeRootsFor([], this.input.workspace)
    return this.frozenPrivateRoots
  }

  /** Starts the process and the watch on its exit; the owner's claim on its resources starts from here. */
  private async launchServer(
    launched: ResolvedNodeServerLaunch,
    preparation: NodeProcessPreparation,
  ): Promise<OwnedNodeProcess> {
    const server = await this.dependencies.launch(
      {
        ...launched,
        workspace: this.input.workspace,
        node: this.dependencies.node,
        // The workspace and the home directory are hidden in the server's output even where a chunk boundary cuts one.
        privateRoots: this.privateRoots(),
      },
      (type, detail) => this.record(type, detail),
      (event) => this.hooks.onProcessOutput(event),
    )
    this.server = server
    preparation.afterLaunch?.(server)
    void server.whenExited().then((exit) => this.onServerExit(exit))
    // The leader's start identifies the group for a retried stop; it is read while the server still waits paused for the debugger, and read again before the attach when this read fails.
    this.launchedStartedAt =
      server.pid === undefined
        ? undefined
        : await this.dependencies
            .readProcessStart(server.pid)
            .catch(() => undefined)
    return server
  }

  /**
   * The launched process's pid and process group.
   * @param server - The launched process.
   * @returns Its pid and process group.
   * @throws `RUNTIME_FAILED` when the process never started and has none.
   */
  identityOf(server: OwnedNodeProcess): {
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
   * Lets the debugger go of a process that printed Node's notice, when it is really finished: it listens on nothing but its inspector. A lookup that cannot answer lets nothing go.
   * Called by the owner when its output stage saw the notice.
   */
  async releaseFinishedServer(): Promise<void> {
    const pid = this.server?.pid
    if (pid === undefined) return
    const ports = await this.dependencies
      .readListeningPorts(pid)
      .catch(() => undefined)
    if (!ports || ports.some((port) => port !== this.currentInspectorPort))
      return
    await this.debug?.release().catch(() => undefined)
  }

  /** Attaches the debugger, verifies the inspector, listens to its pauses and arms every declared stop. */
  private async attachAndArm(
    server: OwnedNodeProcess,
    packageRoot: string,
    stops: NodeServerStopTarget[],
    signal: AbortSignal,
  ): Promise<void> {
    const debug = this.requireDebugger()
    const { pid, processGroup } = this.identityOf(server)
    const endpoint = await this.step('waiting for the inspector endpoint', () =>
      server.inspectorEndpoint(signal),
    )
    this.currentInspectorPort = Number(new URL(endpoint).port)
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
    server: OwnedNodeProcess,
    packageRoot: string,
  ): Promise<void> {
    const { pid, processGroup } = this.identityOf(server)
    const leaderStartedAt =
      this.launchedStartedAt ?? (await this.dependencies.readProcessStart(pid))
    this.launchedStartedAt = leaderStartedAt
    if (leaderStartedAt === undefined) return
    await this.step('recording the launched process', () =>
      this.dependencies.rememberProcess({
        runId: this.input.runId,
        pid,
        processGroup,
        leaderStartedAt,
        cwd: packageRoot,
        inspectorPort: this.currentInspectorPort ?? 0,
        declaredPort: this.input.declaredPort,
      }),
    )
  }

  // ---------------------------------------------------------------- failures

  /**
   * The process exited by itself (or its debug session ended): before readiness the preparation reports it, afterwards it is the run's failure.
   * @param exit - How the process ended.
   */
  onServerExit(exit: NodeServerExit): void {
    if (this.currentLifecycle !== 'live' || !this.prepared || !this.server)
      return
    this.failRun(
      serverExitedError(exit, this.server.output(), this.input.workspace),
    )
  }

  /** The debug session ended while the run lived: an exit of the server explains it, else the session was ended from outside. */
  private async onDebuggerEnd(reason: string): Promise<void> {
    if (this.currentLifecycle !== 'live') return
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
  failRun(error: StudyError): void {
    if (this.currentRunFailure || this.currentLifecycle !== 'live') return
    this.currentRunFailure = error
    this.freezeElapsed()
    this.record('node-server.failure', {
      code: error.code,
      cause: error.causeDetail,
    })
    this.notify()
    if (this.prepared) void this.stop().catch(() => undefined)
    else this.abort.abort(error)
  }

  /** Milliseconds since the launch, the one clock every entry of the history carries; the seal reads it for the end entry's time. It stops moving once the run's end is known (a stop admitted, or the failure that ends the run). */
  elapsedSinceLaunchMs(): number {
    return this.frozenElapsedMs ?? this.server?.elapsedMs() ?? 0
  }

  /** Freezes the run's clock at the first moment its end is known; later calls keep the first time. */
  private freezeElapsed(): void {
    this.frozenElapsedMs ??= this.server?.elapsedMs() ?? 0
  }

  // ---------------------------------------------------------------- pauses

  /**
   * Starts holding for a native pause: the running-time limits stop counting and the pause-hold bound runs.
   * @param token - The native pause.
   */
  private beginHold(token: number): void {
    this.hooks.holdLimits()
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
    this.hooks.releaseLimits()
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

  /**
   * Tells which kind of pause a native pause is.
   * @param pause - The debugger's report.
   * @returns
   * - `learner` for a pause that is no hit of a declared stop
   * - `start-hit` for a declared stop hit before the run was prepared
   * - `request-hit` for one hit inside the owner's window
   * - `unattributed` for one hit outside it
   */
  private classify(
    pause: NodeServerDebuggerPause,
  ): 'learner' | 'start-hit' | 'request-hit' | 'unattributed' {
    if (pause.declaredStopIndex === undefined) return 'learner'
    if (!this.prepared) return 'start-hit'
    return this.hooks.inWindow() ? 'request-hit' : 'unattributed'
  }

  /** A native pause after the entry pause (the debugger's `onPause`). */
  private onDebuggerPause(pause: NodeServerDebuggerPause): void {
    // D14 v3 for a pause that arrives after the stop was admitted: whatever it is (a declared stop, the learner's, inside the request or not), the detach would resume it, so the group is killed first.
    if (this.currentLifecycle === 'stopping') {
      this.killFirst = true
      // A detach already under way would resume this pause: the group is ended now.
      this.killDuringDetach()
    }
    if (this.currentLifecycle !== 'live') return
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
    this.requireDebugger()
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
   * Captures a declared stop hit inside the window, up to the capture limit; the hit beyond it retires the owned breakpoints and goes on uncaptured.
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
      const read = await this.requireDebugger().capture(
        pause,
        this.abort.signal,
      )
      // A pause the learner resumed while it was captured is no pause any more.
      if (!this.nativeHolds.has(pause.token)) return
      this.acceptCapture(pause, generation, read)
    } catch (error) {
      if (
        this.currentLifecycle !== 'live' ||
        !this.nativeHolds.has(pause.token)
      )
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
    // Queued in this turn, ahead of the pause being published: the history never delays the live run.
    this.hooks.onStopCaptured?.(
      this.elapsedSinceLaunchMs(),
      pause,
      generation,
      read,
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
    this.hooks.onCaptureBudgetExhausted?.()
    this.record('node-server.capture-budget-exhausted', {
      limit: NODE_SERVER_REQUEST_CAPTURE_LIMIT,
    })
    const debug = this.requireDebugger()
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

  /**
   * Refuses while the learner holds a pause: Codebook never resumes it.
   * @throws `LEARNER_PAUSED` naming who paused.
   */
  assertNoHeldPause(): void {
    if (this.heldPauses.size === 0) return
    const held = this.heldPauses.values().next().value
    throw new StudyError(
      'LEARNER_PAUSED',
      held?.kind === 'unattributed'
        ? 'The server stopped at a declared line outside the request; Codebook never resumes it. Ask the learner to continue it in the debugger.'
        : 'The learner paused the server; Codebook never resumes it. Ask the learner to continue it in the debugger.',
    )
  }

  /**
   * Continues the current declared-stop pause: reserves its generation atomically, then resumes.
   * @param identity - The pause the caller read.
   * @throws `STALE_PAUSE`, `NO_PAUSE`, `LEARNER_PAUSED`, or the debugger's failure typed as a step failure.
   */
  async continue(identity: PauseIdentity): Promise<void> {
    // A run that is ending or ended has only historical pauses, even a held one (the state × call table).
    if (this.currentLifecycle !== 'live')
      throw new StudyError(
        'STALE_PAUSE',
        'The run is stopping or stopped, so this pause is historical.',
      )
    // A held pause is the learner's: before every other refusal of a live run.
    this.assertNoHeldPause()
    const pause = this.pause
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
      this.requireDebugger().assertSourcesUnchanged()
      this.ownResumes.add(pause.token)
      await this.requireDebugger().resume(pause.native, this.abort.signal)
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

  // ---------------------------------------------------------------- stop

  /**
   * Stops the run: the first call starts it, concurrent and later calls share it.
   * @returns Resolves when the process group, the debug session and the orphan record are released.
   * @throws The retryable `RUNTIME_FAILED` naming the owned pid or port that remains.
   */
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
    this.freezeElapsed()
    this.currentLifecycle = 'stopping'
    this.abort.abort()
    this.hooks.onStopAdmitted()
    for (const cancel of this.nativeHolds.values()) cancel()
    this.nativeHolds.clear()
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
    this.currentLifecycle = 'stopped'
    this.pause = undefined
    this.heldPauses.clear()
    this.record('node-server.stopped', { pid: this.server?.pid })
    this.notify()
    // Reported apart: a slow lookup never delays or fails a complete stop.
    void this.hooks.onStopped?.().catch(() => undefined)
  }

  /** Lets a preparation under way unwind (it was aborted at admission), then releases what it started. */
  private async releaseAfterPreparation(
    afterPreparation: boolean,
  ): Promise<void> {
    if (afterPreparation) await this.preparation?.catch(() => undefined)
    await this.releaseOwned()
  }

  /** The error of a stop that ran out of time: it names the owned pid that remains, or the port when only the debug session does. */
  private remainingError(): StudyError {
    const pid = this.server?.processGroup
    const alive =
      pid !== undefined && !this.safeGroupGone(pid)
        ? this.server?.pid
        : undefined
    return stopFailedError(
      { pid: alive, port: this.input.declaredPort },
      this.failedStops + 1,
    )
  }

  /** Whether the group has no member left; an unreadable group counts as still there ({@link isGroupCertainlyGone}). */
  private safeGroupGone(processGroup: number): boolean {
    return isGroupCertainlyGone(this.dependencies.isGroupGone, processGroup)
  }

  /**
   * Releases everything the run owns: the process group (killed first while its request is under way or it is paused in the debugger, D14 v3; otherwise the debugger detaches, SIGTERM, SIGKILL by 5 s), the debug session, the orphan record and the owner's resources. A foreign listener on the port never keeps the run from stopping; the owner reports it apart.
   */
  private async releaseOwned(): Promise<void> {
    const server = this.server
    const isRetry = this.releaseAttempts++ > 0
    this.hooks.onReleaseBegin?.()
    if (server?.processGroup !== undefined) {
      // A stop the editor reported after the admission and is still reading may be inside the request too.
      if (this.debug?.hasUnreportedPause()) this.killFirst = true
      // The paused code must not run on: the group dies before the debugger lets go of it.
      if (this.killFirst && (await this.maySignal(server, isRetry)))
        this.dependencies.signalGroup(server.processGroup, 'SIGKILL')
      // The detach is under way from here until the close returns: a pause reported meanwhile is killed.
      if (!this.killFirst) this.detachRelease = { isRetry, killed: false }
      try {
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
      } finally {
        this.detachRelease = undefined
      }
    }
    await this.debug?.release()
    await this.dependencies
      .forgetProcess(this.input.runId)
      .catch((error: unknown) =>
        this.record('node-server.orphan-record-kept', {
          cause: sanitizeRunCause(error, this.input.workspace),
        }),
      )
    this.hooks.onReleased?.()
  }

  /**
   * Reads whether the group is still the launched one: the leader's start and folder against the launch's ({@link confirmLaunchedGroup}).
   * @param server - The launched server.
   * @returns The verdict; `unverifiable` when the launch start was never read (a folder alone identifies nothing) or the server has no pid.
   */
  private async confirmLaunchedGroup(
    server: OwnedNodeProcess,
  ): Promise<LaunchedGroupVerdict> {
    if (server.pid === undefined) return 'unverifiable'
    return confirmLaunchedGroup({
      pid: server.pid,
      startedAt: this.launchedStartedAt,
      leaderExited: server.exited() !== undefined,
      readProcessStart: this.dependencies.readProcessStart,
      readProcessCwd: this.dependencies.readProcessCwd,
      isGroupGone: this.dependencies.isGroupGone,
      isProcessGone: this.dependencies.isProcessGone,
    })
  }

  /**
   * Decides whether the run's own SIGKILL may be sent: the first release always, a retried one only while the group is still the launched one, so a reused group id never receives it.
   * @param server - The launched server.
   * @param isRetry - Whether an earlier release of this run already began.
   * @returns `true` to signal, `false` when the group has no member left or its id belongs to another process now (nothing is signalled; the launcher's close finds the same).
   * @throws When a retry cannot tell whose group it is: the stop fails retryably and names the pid.
   */
  private async maySignal(
    server: OwnedNodeProcess,
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

  /**
   * Ends the group at once when a pause is reported while a stop's detach (no kill-first) is under way: the detach would resume the paused code and let it run until SIGTERM.
   * A first release signals at once; a retry signals as soon as the identity check answers `launched` (an unverifiable group receives nothing; the release's own failure path then applies). The close goes on with its own SIGTERM sequence meanwhile.
   * Called by {@link NodeProcessRun.onDebuggerPause} once per release.
   */
  private killDuringDetach(): void {
    const release = this.detachRelease
    const server = this.server
    if (!release || release.killed || server?.processGroup === undefined) return
    const { pid, processGroup } = server
    release.killed = true
    if (!release.isRetry) {
      this.sendLateKill(release, pid, processGroup)
      return
    }
    // A retry confirms the group first; a check that fails or cannot tell sends nothing.
    void this.maySignal(server, true).then(
      (confirmed) => confirmed && this.sendLateKill(release, pid, processGroup),
      () => undefined,
    )
  }

  /**
   * Sends SIGKILL to the group for a pause reported during the detach and journals it, only while that release's close is still under way and the group still has members.
   * Why: once the close returned, or the group ended, nothing of the run is left to end and the group id may be another group's; a signal the system refuses is left to the close's own sequence. Called by {@link NodeProcessRun.killDuringDetach}, at once on a first release and after the identity check on a retry.
   * @param release - The release the pause was reported during; another or none under way now means its close already returned.
   * @param pid - The leader's pid, journaled with the event.
   * @param processGroup - The group to end.
   * @example this.sendLateKill(release, 4242, 4242) // SIGKILL to group 4242 and `node-server.late-pause-killed` { pid: 4242 }
   */
  private sendLateKill(
    release: DetachRelease,
    pid: number | undefined,
    processGroup: number,
  ): void {
    // The close returned meanwhile, or the group ended: the id may be another group's now.
    if (this.detachRelease !== release || this.safeGroupGone(processGroup))
      return
    try {
      this.dependencies.signalGroup(processGroup, 'SIGKILL')
      this.record('node-server.late-pause-killed', { pid })
    } catch {
      // The close still signals the group with SIGTERM and SIGKILL on its own.
    }
  }

  /** D14 v3: a server paused in the debugger (a declared stop, the learner's own pause, or a stop the run has not classified yet), whose request is under way (paused or not: a stop it reaches during the detach would be resumed by it) or whose pause hold expired, is killed before its debugger lets go; a server that is not paused takes Stop v2. */
  private mustKillFirst(): boolean {
    if (this.holdExpired) return true
    if (this.hooks.inWindow()) return true
    if (this.debug?.hasUnreportedPause()) return true
    // Every native pause the run holds (declared, learner's, unattributed) is code the detach would resume.
    return this.nativeHolds.size > 0 || this.heldPauses.size > 0
  }
}
