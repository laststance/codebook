import type { ConfiguredDescriptor } from './configuredStudySchemas'
import {
  NODE_SCRIPT_RUN_TIMEOUT_MS,
  NODE_SCRIPT_RUN_WORDS,
  NODE_SERVER_EXIT_SETTLE_MS,
  NODE_SERVER_STOP_DEADLINE_MS,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
} from './constants'
import { StudyError } from './errors'
import {
  LibraryPackageCancelled,
  type LibraryPackage,
  type LibraryPackageFacts,
} from './libraryPackage'
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
  LibraryRunView,
  NodeScriptPrepareLimits,
  NodeScriptRuntime,
  NodeScriptState,
  NodeScriptView,
} from './nodeScriptRuntimeTypes'
import type { PauseIdentity } from './runtimeSupport/pauseGate'
import type { ProcessOutputEvent } from './utils/captureProcessOutput'
import { createLibraryBuildError } from './utils/createLibraryBuildError'
import {
  describeNodeScriptEnd,
  type NodeScriptEndCause,
} from './utils/describeNodeScriptEnd'
import {
  assertNodeScriptStopsInPackage,
  describeNodeScriptRefusal,
} from './utils/describeNodeScriptRefusal'
import { serverExitedError } from './utils/describeNodeServerRunFailure'
import type { NodeServerExit } from './utils/launchNodeServer'
import type { RepositoryPackageCopy } from './utils/listRepositoryPackageCopies'
import { createNodeRunHistoryHooks } from './utils/nodeRunHistoryHooks'
import type { LibraryObservation } from './utils/readLibraryObservation'
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
  /** A run with `library`: what the dialog adds, because the build runs the project's own scripts before the script starts. */
  library?: {
    /** The library's package name (the declared folder while the name is unknown). */
    package: string
    /** The declared `library.packageRoot`. */
    packageRoot: string
    /** The repository's package manager name, as the dialog says `<pm> run build`. */
    packageManager: string
  }
}

/** What a run with `library` asks to have built and packed. */
export type NodeScriptLibraryRequest = {
  configuration: NodeScriptConfiguration
  /** The Example's package folder, as a real path inside the repository. */
  examplePackageRoot: string
  /** Aborting it ends the build and pack (the run's stop or limit). */
  signal: AbortSignal
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
  /**
   * A run with `library` only: builds and packs the checked-out library into the run's private folder and prepares the resolve hook ({@link prepareLibraryPackage} with the run's private folder).
   * @throws `LIBRARY_BUILD_UNSUPPORTED` or `LIBRARY_BUILD_FAILED`; {@link LibraryPackageCancelled} when the stop ended the build and the sources are verified unchanged.
   */
  prepareLibrary?(request: NodeScriptLibraryRequest): Promise<LibraryPackage>
  /** A run with `library` only: the library's package name and the repository's package manager name, read best-effort for the dialog and the status line; `undefined` when either cannot be read. */
  describeLibrary?(
    declaredPackageRoot: string,
  ): Promise<{ package: string; packageManager: string } | undefined>
  /** A run without `library` only: the installed copies of the opened repository's own packages that the Example depends on, compared with the repository's `origin` remote; empty when it has none. */
  listPackageCopies?(
    examplePackageRoot: string,
    signal?: AbortSignal,
  ): Promise<RepositoryPackageCopy[]>
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

/**
 * Picks the build facts the run resource shows from a built library's facts.
 * @param facts - The facts {@link prepareLibraryPackage} returned.
 * @returns The view fields for a prepared library.
 * @example libraryFactsView(facts).version // => '2.14.0'
 */
function libraryFactsView(facts: LibraryPackageFacts): Partial<LibraryRunView> {
  return {
    version: facts.version,
    revision: facts.revision,
    dirty: facts.dirty,
    packageManager: facts.packageManager,
    buildMs: facts.buildMs,
    packMs: facts.packMs,
    tarballSha256: facts.tarballSha256,
    installedVersion: facts.installedVersion,
    ...(facts.reachedThrough === undefined
      ? {}
      : {
          reachedThrough: facts.reachedThrough,
          reachedThroughCount: facts.reachedThroughCount,
        }),
  }
}

/**
 * Words what the script was seen to load for the run resource: a complete observation reports every count; an incomplete one reports only a positive (counts are lower bounds) and an unreadable one none, so a missing file never reads as "not loaded".
 * @param seen - The observation, or `undefined` until it was read.
 * @returns `observation` always, and the load facts the observation supports.
 * @example libraryObservationView(undefined) // => { observation: 'pending' }
 */
function libraryObservationView(
  seen: LibraryObservation | undefined,
): Pick<LibraryRunView, 'observation'> & Partial<LibraryRunView> {
  if (!seen) return { observation: 'pending' }
  const isComplete = seen.observation === 'complete'
  return {
    observation: seen.observation,
    ...(isComplete || seen.loaded
      ? { loaded: seen.loaded, loadCount: seen.loadCount }
      : {}),
    ...(isComplete || seen.otherCopyLoaded
      ? { publishedCopyLoaded: seen.otherCopyLoaded }
      : {}),
    ...(seen.otherCopyPath ? { publishedCopyPath: seen.otherCopyPath } : {}),
  }
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
  /** Whether the debugger's ownership window was already closed at the run's end. */
  private didCloseWindow = false
  private cancelRunDeadline?: () => void
  private cancelSettle?: () => void
  private cancelExitDeadline?: () => void
  // ---- the library route (a run with `library` only)
  /** The library's name and the package manager's name, read for the dialog and the status line. */
  private libraryPlan?: { package: string; packageManager: string }
  /** The Example's package folder as a real path, once the source checks resolved it. */
  private examplePackageRoot?: string
  /** True while the library is built and packed. */
  private building = false
  /** The built and packed library, once the build handed it over; the run releases its private folder. */
  private libraryPackage?: LibraryPackage
  /** Whether `library.prepared` was reported to the history. */
  private preparedReported = false
  /** Settles (never rejects) when the build ended, however it ended. */
  private buildSettled?: Promise<void>
  /** Rejects the wait for the build, so a stop whose bound passed does not hold the preparation. */
  private abandonBuild?: (error: unknown) => void
  private wasBuildAbandoned = false
  private readonly buildAbort = new AbortController()
  /** The pending wait of the first stop that found the build under way; a later stop joins it. */
  private buildStopWait?: Promise<void>
  /** When the first stop was asked, on the run's clock; the folder removal waits for what is left of the stop bound. */
  private stopAskedAt?: number
  private libraryObservation?: LibraryObservation
  private libraryCleanup?: 'removed' | 'pending'
  /** The ending of a run with `library`: the observation, the history's end and the folder removal, in that order. */
  private libraryEnding?: Promise<void>
  /** True once the ending finished its steps (the end reported, or none for a failure); the state reads `stopping` until then. */
  private libraryEnded = false
  /** Aborted by a stop or a limit: ends the installed-copy scan. */
  private readonly disclosureAbort = new AbortController()
  private libraryRelease?: Promise<void>
  /** A run without `library`: the installed copies of the repository's own packages the Example loads. */
  private packageCopies?: RepositoryPackageCopy[]

  constructor(private readonly input: NodeScriptRunInput) {
    this.id = input.runId
    const { clock } = input.dependencies
    this.runningTime = new RunningTimeLimit(
      NODE_SCRIPT_RUN_TIMEOUT_MS,
      clock,
      () => this.endWithLimit('running-time'),
    )
    const historyHooks = createNodeRunHistoryHooks(input.history)
    this.core = new NodeProcessRun({
      workspace: input.workspace,
      runId: input.runId,
      record: (type, detail) => this.recordFromCore(type, detail),
      citedSources: input.citedSources,
      declaredPort: 0,
      words: NODE_SCRIPT_RUN_WORDS,
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
        ...historyHooks,
        onStopCaptured: (elapsedMs, pause, generation, read) => {
          historyHooks.onStopCaptured?.(elapsedMs, pause, generation, read)
          // The stop's verdict is in the stop ledger: the script's next stop is Codebook's again only after the run itself continues, so a learner's own Continue hands the keyboard back.
          this.setRequestWindow(false)
        },
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

  /** Whether the entry release was sent: only from then on is the script's own exit an end and not a failure. */
  private get released(): boolean {
    return this.core.snapshot().prepared
  }

  /** Journals the core's events, except (once released) the failure that is only the script's own exit, which is an end and not a failure. */
  private recordFromCore(type: string, detail?: unknown): void {
    if (
      this.released &&
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
    // A library run whose process tree ended still reads its observation and ends its history.
    if (this.libraryEnding && !this.libraryEnded) return 'stopping'
    if (snapshot.lifecycle === 'stopped')
      return this.end && this.end.kind !== 'stopped' ? 'ended' : 'stopped'
    if (snapshot.lifecycle === 'stopping' || this.visibleFailure())
      return 'stopping'
    if (snapshot.pause || snapshot.heldPause) return 'paused'
    if (snapshot.prepared) return 'running'
    // The build is under way; a stop waiting for it reads stopping.
    if (this.building) return this.buildStopWait ? 'stopping' : 'building'
    return this.confirmation === 'awaiting-learner' ? 'confirming' : 'preparing'
  }

  /** The core's failure unless it is only the script's exit or a pause hold, which end the run as its `end`. */
  private visibleFailure(): StudyError | undefined {
    const failure = this.core.runFailure
    if (!failure) return undefined
    // A process that exited before the release never started the run: that is a failure, not an end.
    if (
      (failure.code === CORE_EXIT_CODE && this.released) ||
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
      ...(this.input.configuration.library
        ? { library: this.libraryView() }
        : {}),
      ...(this.packageCopies
        ? { repositoryPackageCopies: this.packageCopies }
        : {}),
    }
  }

  /**
   * Says what the run knows of its declared library: the identity, the build facts once built and packed, what the script was seen to load once the observation was read, and the folder's removal.
   * An observation that is `incomplete` reports only a positive (a load or another copy seen), with counts that are lower bounds; an `unreadable` one reports none, so a missing file never reads as "not loaded".
   * @returns The library view, or `undefined` for a run without `library`.
   * @example this.libraryView()?.observation // => 'pending' while the script runs
   */
  private libraryView(): LibraryRunView | undefined {
    const declared = this.input.configuration.library
    if (!declared) return undefined
    const facts = this.preparedReported ? this.libraryPackage?.facts : undefined
    return {
      package:
        facts?.package ?? this.libraryPlan?.package ?? declared.packageRoot,
      packageRoot: declared.packageRoot,
      prepared: facts !== undefined,
      ...(facts ? libraryFactsView(facts) : {}),
      ...libraryObservationView(this.libraryObservation),
      ...(this.libraryCleanup ? { cleanup: this.libraryCleanup } : {}),
    }
  }

  // ---------------------------------------------------------------- preparation

  async prepare(limits: NodeScriptPrepareLimits = {}): Promise<void> {
    // The service's absolute deadline can only shorten the run's own limit.
    this.cancelRunDeadline = this.dependencies.clock.set(
      () => this.endWithLimit('run-deadline'),
      Math.min(REPOSITORY_RUN_TIMEOUT_MS, limits.runTimeoutMs ?? Infinity),
    )
    try {
      await this.checkSource()
      await this.askLearner()
      this.assertStillLive()
      // After the confirmation: a declined or stopped run reads nothing from the installed dependencies.
      await this.discloseInstalledCopies()
      this.assertStillLive()
      await this.buildLibrary()
      await this.core.prepare({
        resolveStops: () => this.resolveStops(),
        resolveLaunch: () => this.resolveLaunch(),
        afterLaunch: (process) => this.watchExit(process),
        // A stop on the entry's first statement is captured, not taken as a start hit.
        beforeRelease: () => {
          this.core.markPrepared()
          this.runningTime.start()
          // Everything the script does from here on is chat-driven: a declared stop is Codebook's, so the chat keeps its focus.
          this.core.requireDebugger().setRequestWindow(true)
        },
        afterRelease: async () => undefined,
      })
    } catch (error) {
      // A script that finished while it was being released ended by itself; that is its end, not a failed start. A crash before the release stays a failure.
      if (this.released && this.exit !== undefined && !this.visibleFailure())
        return
      this.cancelTimers()
      // A library built for a script that never started is removed with the failure.
      if (!this.core.launched) await this.releaseLibrary()
      throw this.core.launched ? this.afterSpawn(error) : error
    }
  }

  /** Throws the stop's own wording when the run was stopped while the learner was asked. */
  private assertStillLive(): void {
    if (this.core.lifecycle !== 'live') throw this.preparationEndedError()
  }

  /**
   * Says why the preparation ended early: a time limit in its own words, anything else as the stop.
   * @returns The error the preparation rejects with.
   */
  private preparationEndedError(): StudyError {
    if (this.cause?.kind === 'limit')
      return new StudyError(
        'RUNTIME_FAILED',
        `The run's time limit (${this.cause.limit}) was reached while it was preparing.`,
      )
    return new StudyError(
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
      const launch = await this.dependencies.resolveLaunch(
        workspace,
        configuration,
      )
      // The library's resolve hook loads after the tsx loader.
      return this.libraryPackage
        ? { ...launch, libraryArguments: this.libraryPackage.nodeArguments }
        : launch
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
    this.examplePackageRoot = launch.packageRoot
  }

  /**
   * A run without `library`: lists the installed copies of the opened repository's own packages the Example depends on, so the run resource can say their correspondence to the checked-out source is unverified.
   * Best effort: a failure lists nothing, and no `origin` remote lists nothing.
   */
  private async discloseInstalledCopies(): Promise<void> {
    const list = this.dependencies.listPackageCopies
    if (this.input.configuration.library || !list || !this.examplePackageRoot)
      return
    const copies = await list(
      this.examplePackageRoot,
      this.disclosureAbort.signal,
    ).catch((): RepositoryPackageCopy[] => [])
    if (copies.length > 0) this.packageCopies = copies
  }

  /**
   * Builds and packs the declared library after the learner confirmed, in the `building` phase, then reports `library.prepared` to the history. A run without `library` does nothing here.
   * A stop that arrives while it builds is waited for within the stop bound ({@link OwnedNodeScriptRun.stop}); a build that settles after the run abandoned it removes its own folder.
   * @throws `LIBRARY_BUILD_UNSUPPORTED` or `LIBRARY_BUILD_FAILED` as the build raised them; `RUNTIME_FAILED` when the stop ended the build with the sources verified unchanged.
   */
  private async buildLibrary(): Promise<void> {
    const { configuration } = this.input
    if (!configuration.library) return
    const { prepareLibrary } = this.dependencies
    if (!prepareLibrary || !this.examplePackageRoot)
      throw new StudyError(
        'PREREQUISITE_MISSING',
        'The library route is unavailable in this editor.',
        undefined,
        undefined,
        undefined,
        { sideEffects: 'none' },
      )
    this.assertStillLive()
    this.building = true
    this.notify()
    const build = prepareLibrary({
      configuration,
      examplePackageRoot: this.examplePackageRoot,
      signal: this.buildAbort.signal,
    })
    // The first observer of the build: the package is held before anyone else sees the build settle.
    this.buildSettled = build.then(
      (built) => {
        this.libraryPackage = built
        // A build the run no longer waits for removes its own folder.
        if (this.wasBuildAbandoned) void this.releaseLibrary()
      },
      () => undefined,
    )
    const abandoned = new Promise<never>((_resolve, reject) => {
      this.abandonBuild = reject
    })
    // The race below observes it; this keeps an unobserved rejection from surfacing.
    abandoned.catch(() => undefined)
    try {
      await Promise.race([build, abandoned])
    } catch (error) {
      throw this.describeLibraryFailure(error)
    } finally {
      this.building = false
      this.notify()
    }
    this.assertStillLive()
    const facts = this.libraryPackage?.facts
    if (!facts) return
    // Reported once, before the script's own entries.
    this.input.history?.libraryPrepared(this.core.elapsedSinceLaunchMs(), {
      package: facts.package,
      version: facts.version,
      packageRoot: facts.packageRoot,
      revision: facts.revision,
      dirty: facts.dirty,
      packageManager: facts.packageManager.name,
      buildMs: facts.buildMs,
      packMs: facts.packMs,
      tarballSha256: facts.tarballSha256,
      installedVersion: facts.installedVersion,
    })
    this.preparedReported = true
    this.notify()
  }

  /**
   * Turns what the build raised into the run's failure and keeps the folder's removal state: a stop's cancellation reads as the stop, and a build error keeps its own code, reason and details.
   * @param error - What the build raised.
   * @returns The error the preparation rejects with.
   */
  private describeLibraryFailure(error: unknown): unknown {
    if (error instanceof LibraryPackageCancelled) {
      this.libraryCleanup = error.cleanup
      return this.preparationEndedError()
    }
    const cleanup = error instanceof StudyError && error.details?.cleanup
    if (cleanup === 'removed' || cleanup === 'pending')
      this.libraryCleanup = cleanup
    return error
  }

  /**
   * Removes the library's private folder once, waiting at most what is left of the stop bound when a stop was asked (the library's default bound otherwise); a removal that outlasts the wait continues in the background and reads `pending`.
   * Called at every ending and by a failed or stopped preparation; safe to call again.
   * @returns Resolves when the removal finished or the wait passed; never rejects.
   */
  private releaseLibrary(): Promise<void> {
    const built = this.libraryPackage
    // Nothing to remove yet: a build that settles later removes its own folder.
    if (!built) return Promise.resolve()
    this.libraryRelease ??= (async () => {
      const left =
        this.stopAskedAt === undefined
          ? undefined
          : Math.max(
              0,
              NODE_SERVER_STOP_DEADLINE_MS -
                (this.dependencies.clock.now() - this.stopAskedAt),
            )
      try {
        this.libraryCleanup = (await built.dispose(left)).cleanup
      } catch {
        this.libraryCleanup = 'pending'
      }
      this.notify()
    })()
    return this.libraryRelease
  }

  /**
   * Waits for the build a stop found under way, within the stop bound: the build's own tree end and source comparison decide its error. A build still unsettled at the bound is abandoned and the preparation rejects with `tracked-files-unverified`, because the comparison did not finish; the build removes its own folder when it ends (D21, D27).
   * @returns Resolves once the build settled or the bound passed; never rejects.
   */
  private waitForBuild(): Promise<void> {
    if (!this.buildSettled || !this.building) return Promise.resolve()
    this.buildStopWait ??= (async () => {
      this.buildAbort.abort()
      this.notify()
      let cancel = (): void => undefined
      const bound = new Promise<false>((resolve) => {
        cancel = this.dependencies.clock.set(
          () => resolve(false),
          NODE_SERVER_STOP_DEADLINE_MS,
        )
      })
      const settled = await Promise.race([
        this.buildSettled?.then(() => true as const),
        bound,
      ])
      cancel()
      if (settled) return
      this.wasBuildAbandoned = true
      this.libraryCleanup = 'pending'
      this.abandonBuild?.(
        createLibraryBuildError(
          'LIBRARY_BUILD_FAILED',
          'tracked-files-unverified',
          "The library build's processes could not be confirmed ended within the stop's bound, so the repository's files could not be checked.",
          { cleanup: 'pending' },
        ),
      )
    })()
    return this.buildStopWait
  }

  /**
   * Asks the learner in the editor and waits at most the pause hold; a cancel, a dismissal or no answer ends the run before anything is spawned.
   * @throws `SCRIPT_NOT_CONFIRMED` with `sideEffects: none`.
   */
  private async askLearner(): Promise<void> {
    const { configuration, runId } = this.input
    const declared = configuration.library
    // The dialog names the library and its package manager when it can read them (best effort).
    if (declared && this.dependencies.describeLibrary)
      this.libraryPlan = await this.dependencies
        .describeLibrary(declared.packageRoot)
        .catch(() => undefined)
    this.confirmation = 'awaiting-learner'
    this.notify()
    const answered = new Promise<boolean>((resolve) => {
      this.dependencies
        .confirmRun(
          {
            runId,
            entry: configuration.entry,
            packageRoot: configuration.packageRoot,
            ...(declared
              ? {
                  library: {
                    package: this.libraryPlan?.package ?? declared.packageRoot,
                    packageRoot: declared.packageRoot,
                    packageManager:
                      this.libraryPlan?.packageManager ?? 'the package manager',
                  },
                }
              : {}),
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
    // A stop or limit answers no at once, whether or not the asker honours the signal.
    const aborted = new Promise<false>((resolve) => {
      const { signal } = this.confirmAbort
      if (signal.aborted) resolve(false)
      else
        signal.addEventListener('abort', () => resolve(false), { once: true })
    })
    const confirmed = await Promise.race([answered, timedOut, aborted])
    cancelWait()
    // The dialog cannot be closed; its asker ignores a late answer once this signal aborted.
    this.confirmAbort.abort()
    this.confirmation = confirmed ? 'confirmed' : 'declined'
    this.notify()
    // A stop or limit that cut the wait short is reported in its own words, not as the learner's refusal.
    if (!confirmed) this.assertStillLive()
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
      // An exit before the release never started the run: the preparation fails with the exit, and no end is reported.
      if (!this.released)
        this.core.failRun(
          serverExitedError(fact, process.output(), this.input.workspace),
        )
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
        // Before the release the failing preparation closes the run itself; a stop here would hide the exit behind a generic message.
        if (this.released) void this.core.stop().catch(() => undefined)
      })
      this.notify()
    })
  }

  /**
   * The debug session ended while the process lives: once released it gets the stop deadline to exit before the run ends with the `exit-deadline` limit.
   * @returns `false` before the release, so the core fails the run (kill first, with the session's reason); `true` once the deadline is set.
   */
  private boundExitAfterSession(): boolean {
    if (!this.released) return false
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

  async continue(identity: PauseIdentity): Promise<void> {
    // The run's own continuation: the declared stop the script reaches next is Codebook's.
    this.setRequestWindow(true)
    try {
      await this.core.continue(identity)
    } catch (error) {
      // A continuation that failed leaves the thread where it was, so a later resume is the learner's.
      this.setRequestWindow(false)
      throw error
    }
  }

  /**
   * Opens or closes the debugger's ownership window, which decides whether the stop ledger records the script's next stop as Codebook's or the learner's.
   * Called at a captured stop (closed) and by {@link OwnedNodeScriptRun.continue} (opened); a run with no bound debugger changes nothing.
   * @param open - Whether the next stop is Codebook's.
   * @example this.setRequestWindow(true) // before the run's own continue
   */
  private setRequestWindow(open: boolean): void {
    this.core.debuggerSession?.setRequestWindow(open)
  }

  // ---------------------------------------------------------------- the end

  /** Ends the run with a limit Codebook enforces; the first cause stands. */
  private endWithLimit(
    limit: 'running-time' | 'run-deadline' | 'exit-deadline',
  ): void {
    if (this.cause || this.exit !== undefined) return
    this.cause = { kind: 'limit', limit }
    // A limit reached while the learner is asked ends the wait too.
    this.confirmAbort.abort()
    this.disclosureAbort.abort()
    // A limit reached while the library builds ends the build like a stop does.
    void (this.building ? this.stop() : this.core.stop()).catch(() => undefined)
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
    // The run is over: the debugger's ownership window closes so a later pause of the learner stays theirs.
    if (this.core.lifecycle === 'stopped' && !this.didCloseWindow) {
      this.didCloseWindow = true
      this.setRequestWindow(false)
    }
    if (this.libraryPackage && this.core.lifecycle === 'stopped') {
      // A library whose script never started is released here.
      if (!this.core.launched) void this.releaseLibrary()
      // A launched run that failed visibly still reads the observation and appends it before the release (D24).
      else if (this.visibleFailure()) this.endLibraryRun(undefined)
    }
    if (
      this.end ||
      this.libraryEnding ||
      this.core.lifecycle !== 'stopped' ||
      !this.core.launched
    )
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
      groupNotSignalled: this.core.unsignalledGroup(),
      output: this.core.launched.output(),
      roots: this.core.privateRoots(),
    })
    if (this.libraryPackage) {
      this.endLibraryRun(view)
      return
    }
    this.end = view
    const { output: _output, ...historyEnd } = view
    this.input.history?.end(this.core.elapsedSinceLaunchMs(), historyEnd)
  }

  /**
   * Ends a run with `library` in one order, whatever ended it (the script's exit, a stop, a limit, a visible failure): the process tree is already confirmed ended, then the observation file is read, `library.observed` is appended, the history ends, and last the private folder is removed (D24, D27).
   * Why the order: the history takes no entry after its end, and the folder holds the observation file; the removal's state (`removed` or `pending`) reaches the run resource beside the stop's own answer.
   * Called by {@link OwnedNodeScriptRun.finalizeIfStopped} once the core's stop completed for a launched run. The steps run under a `finally`: a step that throws still sets the end and releases the folder, and never rejects the stop.
   * @param view - The run's end, already described; `undefined` for a visible failure, which reports no end of its own (the history is sealed with the failure).
   */
  private endLibraryRun(view: NodeScriptEndView | undefined): void {
    const built = this.libraryPackage
    if (!built || this.libraryEnding) return
    this.libraryEnding = (async () => {
      const elapsedMs = this.core.elapsedSinceLaunchMs()
      try {
        // A file that cannot be read (or is gone) is an unreadable observation, never a negative.
        const seen = await built
          .finishObservation()
          .catch((): LibraryObservation => ({
            loaded: false,
            loadCount: 0,
            otherCopyLoaded: false,
            observation: 'unreadable',
          }))
        this.libraryObservation = seen
        this.input.history?.libraryObserved(elapsedMs, {
          loaded: seen.loaded,
          loadCount: seen.loadCount,
          otherCopyLoaded: seen.otherCopyLoaded,
          ...(seen.otherCopyPath === undefined
            ? {}
            : { otherCopyPath: seen.otherCopyPath }),
          observation: seen.observation,
        })
        if (view) {
          const { output: _output, ...historyEnd } = view
          this.input.history?.end(elapsedMs, historyEnd)
        }
      } catch {
        // A step that threw must not keep the end or the folder: the finally below completes the ending.
      } finally {
        if (view) this.end = view
        this.libraryEnded = true
        this.notify()
        await this.releaseLibrary()
      }
    })()
  }

  async stop(): Promise<void> {
    // A script that already ended, or a limit already under way, keeps its own cause.
    if (!this.cause && this.exit === undefined && !this.end)
      this.cause = { kind: 'stopped' }
    this.stopAskedAt ??= this.dependencies.clock.now()
    this.confirmAbort.abort()
    this.disclosureAbort.abort()
    // A stop that finds the library building waits for the build's own ending within the stop bound.
    await this.waitForBuild()
    await this.core.stop()
    this.finalizeIfStopped()
    await this.libraryEnding
    // A library built for a script that never ended is removed with the stop.
    if (this.libraryPackage && !this.end) await this.releaseLibrary()
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
