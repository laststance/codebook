import type { ConfiguredDescriptor } from './configuredStudySchemas'
import {
  NODE_SCRIPT_RUN_TIMEOUT_MS,
  NODE_SERVER_EXIT_SETTLE_MS,
  NODE_SERVER_STOP_DEADLINE_MS,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
} from './constants'
import { StudyError } from './errors'
import {
  NodeProcessRun,
  type NodeProcessRunDependencies,
  type OwnedNodeProcess,
} from './nodeProcessRun'
import type { NodeScriptConfiguration } from './nodeScriptConfigSchemas'
import type { NodeScriptHistorySink } from './nodeScriptHistorySink'
import type {
  NodeScriptConfirmation,
  NodeScriptEndView,
  NodeScriptRuntime,
  NodeScriptState,
  NodeScriptView,
} from './nodeScriptRuntimeTypes'
import type { PauseIdentity } from './runtimeSupport/pauseGate'
import type { ProcessOutputEvent } from './utils/captureProcessOutput'
import {
  describeNodeScriptEnd,
  type NodeScriptEndCause,
} from './utils/describeNodeScriptEnd'
import {
  assertNodeScriptStopsInPackage,
  describeNodeScriptRefusal,
} from './utils/describeNodeScriptRefusal'
import type { NodeServerExit } from './utils/launchNodeServer'
import { createNodeRunHistoryHooks } from './utils/nodeRunHistoryHooks'
import type { resolveNodeServerLaunch } from './utils/resolveNodeServerLaunch'
import type { resolveNodeServerStops } from './utils/resolveNodeServerStops'
import { RunChangeListeners } from './utils/RunChangeListeners'
import { RunningTimeLimit } from './utils/runningTimeLimit'
import type { CauseRoots } from './utils/sanitizeCause'

/** What the editor's confirmation dialog names, so the learner decides on exactly this script. */
export type NodeScriptRunQuestion = {
  runId: string
  /** The script file, repository-relative to the package root. */
  entry: string
  /** The package folder the script runs in, repository-relative. */
  packageRoot: string
}

/** What a script run needs from outside beyond the process core: the shared resolvers and the learner's confirmation, injected so the whole run executes against fakes. */
export type NodeScriptRunDependencies = NodeProcessRunDependencies & {
  resolveLaunch: typeof resolveNodeServerLaunch
  resolveStops: typeof resolveNodeServerStops
  /**
   * Asks the learner in the editor to run the script once.
   * @returns `true` only when the learner chose to run it; `false` for Cancel or a dismissal. An answer that arrives after `signal` aborted is the asker's to ignore.
   */
  confirmRun(
    question: NodeScriptRunQuestion,
    signal: AbortSignal,
  ): Promise<boolean>
}

/** What {@link createOwnedNodeScriptRun} is given. */
export type NodeScriptRunInput = {
  /** The opened repository's real root. */
  workspace: string
  configuration: NodeScriptConfiguration
  /** Journals the run's `node-server.*` events (the process core's journal). */
  record: (type: string, detail?: unknown) => unknown
  /** The article's text of every source the selected node cites. */
  citedSources: ConfiguredDescriptor['sources']
  /** The service's run id: named in the dialog, the debug session and the orphan record. */
  runId: string
  /** Where the run reports what a saved script replay records; absent when no history started. */
  history?: NodeScriptHistorySink
  /** The private roots hidden everywhere, frozen for this run. */
  privateRoots?: CauseRoots
  /** Where an unexpected failure points the chat to reconcile what the script did (the run's history resource). */
  traceUri?: string
  dependencies: NodeScriptRunDependencies
}

/** The pause holds, limits and failures that end a run by Codebook's own cause, and the core failures that are a script's own natural exit. */
const CORE_EXIT_CODE = 'SERVER_EXITED'
const CORE_PAUSE_HOLD_CODE = 'PAUSE_HOLD_EXPIRED'

/**
 * The node-script run the service drives: it checks the script's source, asks the learner to confirm one run, launches the repository's script under the debugger, arms the declared stops, captures their hits and ends with the script's own exit, a limit Codebook enforces or `codebook_stop`.
 * The process, its pauses and its stop belong to the composition core ({@link NodeProcessRun}); this class keeps the confirmation, the time limits and the end report.
 * Created by {@link createOwnedNodeScriptRun}.
 */
class OwnedNodeScriptRun implements NodeScriptRuntime {
  readonly id: string
  private readonly listeners = new RunChangeListeners()
  private readonly runningTime: RunningTimeLimit
  private readonly core: NodeProcessRun
  private readonly confirmAbort = new AbortController()
  private confirmation?: NodeScriptConfirmation
  private cause?: NodeScriptEndCause
  /** The process's own exit event, once it fired. */
  private exit?: NodeServerExit
  private end?: NodeScriptEndView
  private cancelRunDeadline?: () => void
  private cancelSettle?: () => void
  private cancelExitDeadline?: () => void

  constructor(private readonly input: NodeScriptRunInput) {
    this.id = input.runId
    const { clock } = input.dependencies
    this.runningTime = new RunningTimeLimit(
      NODE_SCRIPT_RUN_TIMEOUT_MS,
      clock,
      () => this.endWithLimit('running-time'),
    )
    this.core = new NodeProcessRun({
      workspace: input.workspace,
      runId: input.runId,
      record: (type, detail) => this.recordFromCore(type, detail),
      citedSources: input.citedSources,
      declaredPort: 0,
      privateRoots: input.privateRoots,
      dependencies: input.dependencies,
      notify: () => this.onCoreChange(),
      options: {
        confirmEverySignalAfterNaturalExit: true,
        killFirstUnlessReleased: true,
      },
      hooks: {
        // Once the process exited its group is cleaned up by the detach path; before, every stop kills first.
        inWindow: () => this.exit === undefined,
        holdLimits: () => this.runningTime.hold(),
        releaseLimits: () => this.runningTime.release(),
        onStopAdmitted: () => this.cancelTimers(),
        onProcessOutput: (event) => this.onScriptOutput(event),
        ...createNodeRunHistoryHooks(input.history),
        onDebuggerSessionEnded: () => this.boundExitAfterSession(),
      },
    })
  }

  private get dependencies(): NodeScriptRunDependencies {
    return this.input.dependencies
  }

  onDidChange(listener: () => void): { dispose(): void } {
    return this.listeners.add(listener)
  }

  private notify(): void {
    this.listeners.notify()
  }

  /** Journals the core's events, except the failure that is only the script's own exit, which is an end and not a failure. */
  private recordFromCore(type: string, detail?: unknown): void {
    if (
      type === 'node-server.failure' &&
      typeof detail === 'object' &&
      detail !== null &&
      'code' in detail &&
      detail.code === CORE_EXIT_CODE
    )
      return
    this.input.record(type, detail)
  }

  /** The core changed: once its stop completed the run's end is known and reported. */
  private onCoreChange(): void {
    this.finalizeIfStopped()
    this.notify()
  }

  elapsedSinceLaunchMs(): number {
    return this.core.elapsedSinceLaunchMs()
  }

  // ---------------------------------------------------------------- view

  /**
   * Derives the state from what happened: the end first, then a stop under way, then a pause, then the preparation steps.
   * @returns The run's state word.
   * @example this.currentState() // => 'paused' while a declared stop is held
   */
  private currentState(): NodeScriptState {
    const snapshot = this.core.snapshot()
    if (snapshot.lifecycle === 'stopped')
      return this.end && this.end.kind !== 'stopped' ? 'ended' : 'stopped'
    if (snapshot.lifecycle === 'stopping' || this.visibleFailure())
      return 'stopping'
    if (snapshot.pause || snapshot.heldPause) return 'paused'
    if (snapshot.prepared) return 'running'
    return this.confirmation === 'awaiting-learner' ? 'confirming' : 'preparing'
  }

  /** The core's failure unless it is only the script's exit or a pause hold, which end the run as its `end`. */
  private visibleFailure(): StudyError | undefined {
    const failure = this.core.runFailure
    if (!failure) return undefined
    if (
      failure.code === CORE_EXIT_CODE ||
      failure.code === CORE_PAUSE_HOLD_CODE
    )
      return undefined
    return this.withUnknownSideEffects(failure)
  }

  /** A failure after the spawn: side effects are unknown, and the chat is pointed to the trace to reconcile from. */
  private withUnknownSideEffects(failure: StudyError): StudyError {
    if (failure.details?.sideEffects) return failure
    return new StudyError(
      failure.code,
      failure.message,
      failure.causeDetail,
      failure.recoveryOverride,
      failure,
      {
        ...failure.details,
        sideEffects: 'unknown',
        ...(this.input.traceUri ? { trace: this.input.traceUri } : {}),
      },
    )
  }

  view(): NodeScriptView {
    const snapshot = this.core.snapshot()
    return {
      state: this.currentState(),
      confirmation: this.confirmation,
      pid: snapshot.pid,
      stops: snapshot.stops,
      stopsReached: snapshot.stopsReached,
      pauseGeneration: snapshot.pauseGeneration,
      pause: snapshot.pause,
      heldPause: snapshot.heldPause,
      captures: snapshot.captures,
      captureBudgetExhausted: snapshot.captureBudgetExhausted,
      runFailure: this.visibleFailure(),
      failedStops: snapshot.failedStops,
      end: this.end,
    }
  }

  // ---------------------------------------------------------------- preparation

  async prepare(): Promise<void> {
    this.cancelRunDeadline = this.dependencies.clock.set(
      () => this.endWithLimit('run-deadline'),
      REPOSITORY_RUN_TIMEOUT_MS,
    )
    try {
      await this.checkSource()
      await this.askLearner()
      this.assertStillLive()
      await this.core.prepare({
        resolveStops: () => this.resolveStops(),
        resolveLaunch: () => this.resolveLaunch(),
        afterLaunch: (process) => this.watchExit(process),
        // A stop on the entry's first statement is captured, not taken as a start hit.
        beforeRelease: () => {
          this.core.markPrepared()
          this.runningTime.start()
        },
        afterRelease: async () => undefined,
      })
    } catch (error) {
      // A script that finished while it was being released ended by itself; that is its end, not a failed start.
      if (this.exit !== undefined && !this.core.runFailure) return
      this.cancelTimers()
      throw this.core.launched ? this.afterSpawn(error) : error
    }
  }

  /** Throws the stop's own wording when the run was stopped while the learner was asked. */
  private assertStillLive(): void {
    if (this.core.lifecycle !== 'live')
      throw new StudyError(
        'RUNTIME_FAILED',
        'The run was stopped while it was preparing.',
      )
  }

  /** Marks a failure after the spawn: its side effects are unknown. */
  private afterSpawn(error: unknown): unknown {
    return error instanceof StudyError
      ? this.withUnknownSideEffects(error)
      : error
  }

  /** Resolves the declared stops, refusing in the script's own words. */
  private async resolveStops() {
    const { workspace, configuration } = this.input
    try {
      return await this.dependencies.resolveStops(workspace, configuration)
    } catch (error) {
      throw describeNodeScriptRefusal(error)
    }
  }

  /** Resolves the real package root, entry and loader, refusing in the script's own words. */
  private async resolveLaunch() {
    const { workspace, configuration } = this.input
    try {
      return await this.dependencies.resolveLaunch(workspace, configuration)
    } catch (error) {
      throw describeNodeScriptRefusal(error)
    }
  }

  /**
   * Checks everything that needs no process before the learner is asked, so a run that cannot start is never offered: the package root, entry, loader and stops resolve, and every stop lies in the package's own source.
   * @throws `NODE_SCRIPT_SOURCE_REFUSED` (with `sideEffects: none`) or `SOURCE_CHANGED`.
   */
  private async checkSource(): Promise<void> {
    const [stops, launch] = [
      await this.resolveStops(),
      await this.resolveLaunch(),
    ]
    assertNodeScriptStopsInPackage(this.input.workspace, launch, stops)
  }

  /**
   * Asks the learner in the editor and waits at most the pause hold; a cancel, a dismissal or no answer ends the run before anything is spawned.
   * @throws `SCRIPT_NOT_CONFIRMED` with `sideEffects: none`.
   */
  private async askLearner(): Promise<void> {
    const { configuration, runId } = this.input
    this.confirmation = 'awaiting-learner'
    this.notify()
    const answered = new Promise<boolean>((resolve) => {
      this.dependencies
        .confirmRun(
          {
            runId,
            entry: configuration.entry,
            packageRoot: configuration.packageRoot,
          },
          this.confirmAbort.signal,
        )
        .then(resolve, () => resolve(false))
    })
    let cancelWait = (): void => undefined
    const timedOut = new Promise<false>((resolve) => {
      cancelWait = this.dependencies.clock.set(
        () => resolve(false),
        REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
      )
    })
    const confirmed = await Promise.race([answered, timedOut])
    cancelWait()
    // The dialog cannot be closed; its asker ignores a late answer once this signal aborted.
    this.confirmAbort.abort()
    this.confirmation = confirmed ? 'confirmed' : 'declined'
    this.notify()
    if (!confirmed)
      throw new StudyError(
        'SCRIPT_NOT_CONFIRMED',
        'The learner did not confirm running the script, so nothing was run.',
        undefined,
        undefined,
        undefined,
        { sideEffects: 'none', confirmation: 'declined' },
      )
  }

  // ---------------------------------------------------------------- the script's run

  /** Follows the process's own exit event: the end fact, then output until both pipes close or the settle passes. */
  private watchExit(process: OwnedNodeProcess): void {
    void process.whenExitEvent?.().then((fact) => {
      this.exit = fact
      this.cancelExitDeadline?.()
      this.cancelTimers()
      const closed = process.whenExited()
      let resolveSettle = (): void => undefined
      const settled = new Promise<void>((resolve) => {
        resolveSettle = resolve
        this.cancelSettle = this.dependencies.clock.set(
          resolve,
          NODE_SERVER_EXIT_SETTLE_MS,
        )
      })
      void Promise.race([closed, settled]).then(() => {
        resolveSettle()
        void this.core.stop().catch(() => undefined)
      })
      this.notify()
    })
  }

  /** The debug session ended while the process lives: it gets the stop deadline to exit before the run ends with the `exit-deadline` limit. */
  private boundExitAfterSession(): boolean {
    if (this.exit !== undefined || this.cancelExitDeadline) return true
    this.cancelExitDeadline = this.dependencies.clock.set(
      () => this.endWithLimit('exit-deadline'),
      NODE_SERVER_STOP_DEADLINE_MS,
    )
    return true
  }

  /** Journals and records one chunk of the script's output. */
  private onScriptOutput(event: ProcessOutputEvent): void {
    this.input.history?.output(event.elapsedMs, event.channel, event.text)
    this.input.record('node-server.output', {
      sequence: event.sequence,
      elapsedMs: event.elapsedMs,
      channel: event.channel,
      text: event.text,
    })
  }

  continue(identity: PauseIdentity): Promise<void> {
    return this.core.continue(identity)
  }

  // ---------------------------------------------------------------- the end

  /** Ends the run with a limit Codebook enforces; the first cause stands. */
  private endWithLimit(
    limit: 'running-time' | 'run-deadline' | 'exit-deadline',
  ): void {
    if (this.cause || this.exit !== undefined) return
    this.cause = { kind: 'limit', limit }
    void this.core.stop().catch(() => undefined)
  }

  /** Stops every timer of the run's own. */
  private cancelTimers(): void {
    this.runningTime.stop()
    this.cancelRunDeadline?.()
    this.cancelSettle?.()
    this.cancelExitDeadline?.()
  }

  /**
   * Reports the end once the process group is released: the cause Codebook started, else the pause hold, else the process's own exit. A run that failed unexpectedly, or never launched, reports none.
   * Called whenever the core changes.
   */
  private finalizeIfStopped(): void {
    if (this.end || this.core.lifecycle !== 'stopped' || !this.core.launched)
      return
    if (this.visibleFailure()) return
    const cause =
      this.cause ??
      (this.core.runFailure?.code === CORE_PAUSE_HOLD_CODE
        ? ({ kind: 'limit', limit: 'pause-hold' } as const)
        : undefined)
    const accounting = this.core.captureAccounting()
    const view = describeNodeScriptEnd({
      cause,
      exit: this.exit,
      declaredStopIndices: this.core
        .snapshot()
        .stops.map((stop) => stop.declaredStopIndex),
      stopsReached: accounting.stopsReached,
      captureBudgetExhausted: accounting.captureBudgetExhausted,
      output: this.core.launched.output(),
      roots: this.core.privateRoots(),
    })
    this.end = view
    const { output: _output, ...historyEnd } = view
    this.input.history?.end(this.core.elapsedSinceLaunchMs(), historyEnd)
  }

  async stop(): Promise<void> {
    // A script that already ended, or a limit already under way, keeps its own cause.
    if (!this.cause && this.exit === undefined && !this.end)
      this.cause = { kind: 'stopped' }
    this.confirmAbort.abort()
    await this.core.stop()
    this.finalizeIfStopped()
  }
}

/**
 * Creates the run of one node-script declaration, to be prepared (checks, confirmation, launch), continued and stopped by the service.
 * Called by the environment's `createNodeScriptRun` hook, which supplies the product's dependencies; tests supply fakes.
 * @param input - The repository, the strictly parsed declaration, the event journal, the cited sources, the run id and the dependencies.
 * @returns The run; nothing is spawned until `prepare()` is called and the learner confirms.
 * @example
 * const run = createOwnedNodeScriptRun({ workspace, configuration, record, citedSources, runId, dependencies })
 * await run.prepare() // resolves when run.view().state is 'running'
 */
export function createOwnedNodeScriptRun(
  input: NodeScriptRunInput,
): NodeScriptRuntime {
  return new OwnedNodeScriptRun(input)
}
