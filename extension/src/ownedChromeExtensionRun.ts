import type {
  ChromeExtensionActionExecutor,
  ExtensionClickReceipt,
  ExtensionExecutorInput,
} from './chromeExtensionActionExecutor'
import type { ChromeExtensionConfiguration } from './chromeExtensionConfigSchemas'
import type {
  ChromeExtensionViewport,
  ChromeExtensionViewportFactory,
  ExtensionPreparationPhase,
  OwnedExtensionBrowser,
  ResolvedExtensionClick,
  ResolvedExtensionRun,
} from './chromeExtensionContracts'
import type {
  ChromeExtensionDebugger,
  ExtensionActionGuard,
  ExtensionContinueArguments,
  ExtensionDebuggerInput,
} from './chromeExtensionDebugger'
import {
  buildExtensionObserved,
  createExtensionObservationReader,
  extensionObservationResult,
  observeAfterLastClick,
  type ExtensionObservationReader,
} from './chromeExtensionObservation'
import {
  CHROME_EXTENSION_STOP_DEADLINE_MS,
  EXTENSION_OUTPUT_EVENT_LIMIT,
  EXTENSION_PIN_CAPTURE_TIMEOUT_MS,
  MILLISECONDS_PER_SECOND,
  REPOSITORY_RUN_TIMEOUT_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
} from './constants'
import { StudyError } from './errors'
import type { resolveChromeExtensionRun } from './resolveChromeExtensionRun'
import type {
  ChromeExtensionClickAnswer,
  ChromeExtensionObserved,
  ChromeExtensionOutputLine,
  ChromeExtensionPhase,
  ChromeExtensionRunInput,
  ChromeExtensionRuntime,
  ChromeExtensionView,
} from './runtime'
import type { OwnedBrowserLaunchOptions } from './runtimeSupport/ownedExtensionBrowser'
import {
  readCdpString,
  readCdpTargets,
} from './runtimeSupport/utils/cdpFieldReaders'
import { causeRootsFor } from './utils/causeRootsFor'
import { classifyChromeExtensionFailure } from './utils/classifyChromeExtensionFailure'
import {
  chromeExtensionFailureNextStep,
  describeChromeExtensionFailure,
  describeChromeExtensionViewStatus,
} from './utils/describeChromeExtensionStatus'
import type { ExtensionObservedRawRead } from './utils/maskExtensionObservedRead'
import type { StorageOwnerIdentity } from './utils/readRecordedOwner'
import { redactSecretText } from './utils/redactSecretText'
import type { RunClock } from './utils/runningTimeLimit'
import { hidePrivateRoots } from './utils/sanitizeCause'

/** What the run's own timings default to; a test names shorter ones. */
export type ChromeExtensionRunTimings = {
  /** The whole run's limit; {@link REPOSITORY_RUN_TIMEOUT_MS}. */
  runMs?: number
  /** The limit from the start to `ready`; {@link REPOSITORY_SETUP_TIMEOUT_MS}. */
  setupMs?: number
  settleMs?: number
  pollMs?: number
  boundMs?: number
  readTimeoutMs?: number
}

/** What the run needs from outside, injected so the whole state machine runs against fakes: the pre-launch checks, the owned browser, the debugger, the executor and the editor's view of sources and debug sessions. */
export type ChromeExtensionRunDependencies = {
  clock: RunClock
  resolveRun: typeof resolveChromeExtensionRun
  launchBrowser(
    options: OwnedBrowserLaunchOptions,
  ): Promise<OwnedExtensionBrowser>
  createDebugger(input: ExtensionDebuggerInput): ChromeExtensionDebugger
  createExecutor(input: ExtensionExecutorInput): ChromeExtensionActionExecutor
  /** Makes the check of ER20 for one resolved run: refuses with `SOURCE_CHANGED` while the disk or an open editor document differs from the pinned bytes. */
  createSourceCheck(run: ResolvedExtensionRun): () => void | Promise<void>
  /** Tells once when the learner (or the editor) ended the run's root debug session; returns the unsubscribe. */
  watchDebugSessionEnd(runId: string, listener: () => void): { dispose(): void }
  chromeExecutable: string
  profileRoot: string
  readOwner(): Promise<StorageOwnerIdentity>
  timings?: ChromeExtensionRunTimings
}

/** Everything {@link createOwnedChromeExtensionRun} is given. */
export type OwnedChromeExtensionRunInput = ChromeExtensionRunInput & {
  /** The opened repository's canonical folder. */
  workspace: string
  dependencies: ChromeExtensionRunDependencies
  /** Creates the Application view; absent → the run goes on without one. */
  createViewport?: ChromeExtensionViewportFactory
}

/** How a run ends; the first one wins. */
type RunEnding =
  | { kind: 'completed' }
  | { kind: 'stopped' }
  | { kind: 'failed'; error: StudyError }

/**
 * What the cleanup already closed; a stuck step that publishes a different one later gets that one closed.
 * Only the viewport and the browser can come late: {@link OwnedChromeExtensionRun}'s preparation publishes each just before an `assertAccepting` check, while the debugger, the executor and every cleanup handle follow such a check with no wait between.
 */
type HandledResources = {
  browser: OwnedExtensionBrowser | undefined
  viewport: ChromeExtensionViewport | undefined
}

/** The sentence of each preparation phase for the viewport's "Preparing" body (DR4). */
const PREPARING_SENTENCE: Record<ExtensionPreparationPhase, string> = {
  launching: 'Starting the test browser',
  installing: 'Installing the extension',
  opening: 'Opening the extension',
  attaching: 'Attaching the debugger',
  waking: 'Waiting for the service worker',
  arming: 'Setting stops',
}

/** The click errors that refuse one call and leave the run `ready` (nothing was consumed). */
const REFUSED_CLICK_CODES: readonly string[] = [
  'SELECTOR_NOT_FOUND',
  'SERVICE_WORKER_NOT_ATTACHED',
]

/** Turns anything thrown into the run's typed error. */
function asStudyError(error: unknown): StudyError {
  return error instanceof StudyError
    ? error
    : new StudyError(
        'RUNTIME_FAILED',
        'The extension run failed.',
        error instanceof Error ? error.message : String(error),
      )
}

/**
 * The lifecycle of one chrome-extension run (Cycle 0061 pt2): resolves and checks the declaration, launches the owned Chrome, attaches the editor's debugger, arms the stops, performs one declared click per call, observes the result and cleans up through one path.
 * Created by {@link createOwnedChromeExtensionRun}; the service drives it through {@link ChromeExtensionRuntime} and reads {@link OwnedChromeExtensionRun.view}.
 */
class OwnedChromeExtensionRun implements ChromeExtensionRuntime {
  readonly id: string
  private readonly listeners = new Set<() => void>()
  private readonly abort = new AbortController()
  private readonly observationAbort = new AbortController()
  private readonly roots: ReturnType<typeof causeRootsFor>
  /** Why the Application view could not be opened, masked and root-hidden; absent while it opened or no editor offers one. */
  private viewUnavailable?: string
  private readonly timings: ChromeExtensionRunTimings
  private readonly outputs: ChromeExtensionOutputLine[] = []
  private readonly captures: ChromeExtensionView['captures'] = []
  private readonly pinnedGenerations = new Set<number>()
  private stage: ChromeExtensionPhase = 'starting'
  private launchedAtMs: number | undefined
  /** Settles when a cleanup left a step that ignored its abort behind at the stop bound, so {@link OwnedChromeExtensionRun.prepare} answers then instead of waiting on that step. */
  private readonly stepsLeftBehind: Promise<void>
  private resolveStepsLeftBehind: () => void = () => undefined
  private resolved: ResolvedExtensionRun | undefined
  private browser: OwnedExtensionBrowser | undefined
  private debug: ChromeExtensionDebugger | undefined
  private executor: ChromeExtensionActionExecutor | undefined
  private reader: ExtensionObservationReader | undefined
  private viewport: ChromeExtensionViewport | undefined
  private surfaceSessionId: string | undefined
  private surfaceAttached = false
  private surfaceGone = false
  private sourceCheck: (() => void | Promise<void>) | undefined
  private actionGuard: ExtensionActionGuard | undefined
  private lastReceipt: ExtensionClickReceipt | undefined
  private clicksPerformed = 0
  private clickInFlight: number | undefined
  private workPending = false
  private beforeRead: ExtensionObservedRawRead | undefined
  private observed: ChromeExtensionObserved | null | undefined
  private result: 'complete' | 'partial' | undefined
  private runFailure: StudyError | undefined
  private cleanupResult: ChromeExtensionView['cleanup']
  private outputsDropped = 0
  private ending: RunEnding | undefined
  private endingPromise: Promise<void> | undefined
  private stepsPromise: Promise<void> | undefined
  private cancelRunTimer: (() => void) | undefined
  private cancelSetupTimer: (() => void) | undefined
  /** The cancels of the pause pins' capture timers still running; the cleanup ends them. */
  private readonly pinTimerCancels = new Set<() => void>()
  private lastViewportText: string | undefined
  private readonly cleanups: { dispose(): void }[] = []

  constructor(private readonly input: OwnedChromeExtensionRunInput) {
    this.stepsLeftBehind = new Promise<void>((resolve) => {
      this.resolveStepsLeftBehind = resolve
    })
    this.id = input.runId
    this.roots = input.privateRoots ?? causeRootsFor([], input.workspace)
    this.timings = input.dependencies.timings ?? {}
  }

  // ------------------------------------------------------------------ view

  /** What the run shows the service. */
  view(): ChromeExtensionView {
    const pauses = this.debug?.pauses() ?? []
    const declaredCount =
      this.resolved?.stops.length ?? this.input.configuration.stops.length
    return {
      phase: this.derivedPhase(pauses.length > 0),
      ...this.extensionView(),
      procedure: this.procedureView(),
      ...(this.lastReceipt && { lastClick: this.answerOf(this.lastReceipt) }),
      pauses,
      captures: [...this.captures],
      stopsDeclared: declaredCount,
      stopsNotReached:
        this.debug?.stopsNotReached() ??
        Array.from({ length: declaredCount }, (_unused, index) => index + 1),
      ...(this.result && { result: this.result }),
      ...(this.observed !== undefined && { observed: this.observed }),
      claimable: this.isClaimable(),
      interventions: this.debug?.interventions() ?? [],
      outputs: [...this.outputs],
      outputsDropped: this.outputsDropped,
      ...(this.viewUnavailable !== undefined && {
        viewUnavailable: this.viewUnavailable,
      }),
      ...(this.runFailure && { runFailure: this.runFailure }),
      ...(this.cleanupResult && { cleanup: this.cleanupResult }),
    }
  }

  /** The phase the service reads: `paused` while any pause is open after `ready`. */
  private derivedPhase(hasOpenPause: boolean): ChromeExtensionPhase {
    const isLive = this.stage === 'ready' || this.stage === 'observing'
    return isLive && hasOpenPause ? 'paused' : this.stage
  }

  /** The extension block, once the pre-launch checks resolved it. */
  private extensionView(): Pick<ChromeExtensionView, 'extension'> {
    const { resolved } = this
    if (resolved === undefined) return {}
    return {
      extension: {
        id: resolved.extensionId,
        surface: { ...resolved.surface, url: resolved.surfaceUrl },
        manifest: {
          name: resolved.manifestName,
          permissions: resolved.permissions,
          hostPermissions: resolved.hostPermissions,
        },
      },
    }
  }

  /** Clicks performed of declared, and the click whose call has not settled. */
  private procedureView(): ChromeExtensionView['procedure'] {
    return {
      clicksDeclared:
        this.resolved?.clicks.length ?? this.input.configuration.clicks.length,
      clicksPerformed: this.clicksPerformed,
      ...(this.clickInFlight === undefined
        ? {}
        : { clickInFlight: this.clickInFlight }),
      ...(this.workPending && { clickWorkPending: true }),
    }
  }

  /** `true` only for a completed run whose observation was read (DXR7). */
  private isClaimable(): boolean {
    return (
      this.stage === 'completed' &&
      Boolean(this.observed) &&
      this.observed !== null &&
      this.observed !== undefined &&
      extensionObservationResult(this.observed) !== 'unavailable'
    )
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: (): void => void this.listeners.delete(listener) }
  }

  /** Tells every listener and the viewport that the view changed. */
  private changed(): void {
    this.syncViewport()
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // A listener that throws must not break the run's own state machine.
      }
    }
  }

  /** The answer of a click receipt as it stands now. */
  private answerOf(receipt: ExtensionClickReceipt): ChromeExtensionClickAnswer {
    const progress = receipt.progress()
    return {
      clickIndex: receipt.clickIndex,
      outcome: receipt.outcome,
      inputsApplied: progress.inputsApplied,
      clickDispatched: progress.clickDispatched,
      inputEffects: progress.inputEffects,
      clickEffect: progress.clickEffect,
    }
  }

  /** The declared click titles, in order. */
  private clickTitles(): string[] {
    return (
      this.resolved?.clicks.map((click) => click.title) ??
      this.input.configuration.clicks.map((click) => click.title)
    )
  }

  /** Writes the phase text to the viewport when it differs from the last one written. */
  private syncViewport(): void {
    if (this.viewport === undefined || this.ending !== undefined) return
    const text = describeChromeExtensionViewStatus(
      this.view(),
      this.clickTitles(),
    ).viewportPhase
    if (text === this.lastViewportText) return
    this.lastViewportText = text
    this.viewport.setPhase(text)
  }

  /** Milliseconds since the launch began; 0 before. */
  private elapsedMs(): number {
    return this.launchedAtMs === undefined
      ? 0
      : Math.round(performance.now() - this.launchedAtMs)
  }

  // ------------------------------------------------------------------ journal

  /** Journals one event and, for the extension's console output, keeps the line for the view (C3). */
  private readonly record = (type: string, detail?: unknown): void => {
    if (
      type === 'chrome-extension.output' &&
      typeof detail === 'object' &&
      detail !== null
    ) {
      this.keepOutputLine(detail)
    } else if (
      type === 'chrome-extension.output-dropped' &&
      typeof detail === 'object' &&
      detail !== null &&
      typeof Reflect.get(detail, 'count') === 'number'
    ) {
      this.outputsDropped += Number(Reflect.get(detail, 'count'))
    }
    try {
      this.input.record(type, detail)
    } catch {
      // A journal that throws must not end the run.
    }
  }

  /** Keeps one console line, up to the run's output limit. */
  private keepOutputLine(detail: object): void {
    const text = Reflect.get(detail, 'text')
    const context = Reflect.get(detail, 'context')
    if (
      typeof text !== 'string' ||
      this.outputs.length >= EXTENSION_OUTPUT_EVENT_LIMIT
    )
      return
    this.outputs.push({
      context: context === 'service-worker' ? 'service-worker' : 'page',
      text,
      atMs: this.elapsedMs(),
    })
    this.changed()
  }

  /** Enters a phase: journals it, updates the viewport's preparing body and tells the listeners. */
  private enterPhase(name: ChromeExtensionPhase, elapsedMs?: number): void {
    if (this.ending !== undefined) return
    this.stage = name
    this.record('chrome-extension.phase', {
      name,
      elapsedMs: elapsedMs ?? this.elapsedMs(),
    })
    if (name in PREPARING_SENTENCE) this.showPreparing(name)
    this.changed()
  }

  /** Shows `Preparing the extension · step k of N` for a preparation phase (DR4). */
  private showPreparing(name: string): void {
    if (this.viewport === undefined || this.surfaceAttached) return
    const steps: string[] = [
      'installing',
      'opening',
      ...(this.resolved?.stops.some((stop) => stop.context === 'service-worker')
        ? ['waking']
        : []),
      'arming',
    ]
    // Launching belongs to the installing step, attaching to the opening step.
    const stepName =
      name === 'launching'
        ? 'installing'
        : name === 'attaching'
          ? 'opening'
          : name
    const step = Math.max(1, steps.indexOf(stepName) + 1)
    const sentence = PREPARING_SENTENCE[name as ExtensionPreparationPhase]
    this.viewport.showPreparing(
      step,
      steps.length,
      name === 'opening'
        ? `${sentence} ${this.resolved?.surface.kind ?? 'popup'}`
        : sentence,
    )
  }

  // ------------------------------------------------------------------ prepare

  async prepare(): Promise<void> {
    this.armDeadlines()
    this.stepsPromise = this.prepareSteps()
    try {
      // A step the cleanup left behind at the stop bound is not waited for: the ended run answers, so the service's stop returns and frees the run slot.
      await Promise.race([this.stepsPromise, this.stepsLeftBehind])
      // A stop, deadline or failure accepted at the very end still ends the run.
      this.assertAccepting()
    } catch (error) {
      // A stop, a deadline or a lost browser that was accepted first names the failure; otherwise the step's own error does.
      await this.endRun({ kind: 'failed', error: asStudyError(error) })
      throw this.runFailure ?? asStudyError(error)
    }
  }

  /** Arms the whole-run limit and the limit up to `ready`. */
  private armDeadlines(): void {
    const { clock } = this.input.dependencies
    const runMs = this.timings.runMs ?? REPOSITORY_RUN_TIMEOUT_MS
    const setupMs = this.timings.setupMs ?? REPOSITORY_SETUP_TIMEOUT_MS
    this.cancelRunTimer = clock.set(
      () =>
        this.fail(
          new StudyError(
            'RUNTIME_FAILED',
            `The extension run reached its limit of ${Math.round(runMs / MILLISECONDS_PER_SECOND)} s and was ended.`,
          ),
        ),
      runMs,
    )
    this.cancelSetupTimer = clock.set(
      () =>
        this.fail(
          new StudyError(
            'RUNTIME_FAILED',
            `The extension run was not ready within ${Math.round(setupMs / MILLISECONDS_PER_SECOND)} s and was ended.`,
          ),
        ),
      setupMs,
    )
  }

  /** Throws the accepted ending's error once a stop, the deadline or a failure was accepted, so no further step starts (CR14). */
  private assertAccepting(): void {
    if (this.ending === undefined) return
    throw (
      this.runFailure ??
      this.abort.signal.reason ??
      new StudyError('RUNTIME_FAILED', 'The extension run was stopped.')
    )
  }

  /** `starting` through `ready`. */
  private async prepareSteps(): Promise<void> {
    const { dependencies, workspace, configuration } = this.input
    this.enterPhase('starting', 0)
    this.viewport = await this.openViewport()
    this.assertAccepting()
    const resolved = await dependencies.resolveRun({
      repositoryRoot: workspace,
      // The learner's acknowledgement comes with the start, not with the declaration.
      configuration: {
        ...configuration,
        acknowledgedPermissions: [...this.input.acknowledgedPermissions],
      } satisfies ChromeExtensionConfiguration,
    })
    this.resolved = resolved
    this.sourceCheck = dependencies.createSourceCheck(resolved)
    await this.sourceCheck()
    this.assertAccepting()
    this.viewport?.setIdentity({
      manifestName: resolved.manifestName,
      surface: resolved.surface,
      clickTitles: resolved.clicks.map((click) => click.title),
    })
    this.changed()
    const launchStartedAtMs = performance.now()
    this.launchedAtMs = launchStartedAtMs
    const browser = await dependencies.launchBrowser({
      chromeExecutable: dependencies.chromeExecutable,
      run: resolved,
      profileRoot: dependencies.profileRoot,
      owner: await dependencies.readOwner(),
      signal: this.abort.signal,
      onPhase: (name, elapsedMs) => this.enterPhase(name, elapsedMs),
    })
    this.browser = browser
    this.assertAccepting()
    this.cleanups.push({ dispose: browser.onLost(() => this.onBrowserLost()) })
    await this.attachDebugger(resolved, browser, launchStartedAtMs)
    await this.becomeReady(resolved, browser)
  }

  /** Creates the Application view; a view the editor refuses (its layout guard, for example a foreign preview tab where the pane would go) leaves the run without one and says why, in the view and the journal (DR6). */
  private async openViewport(): Promise<ChromeExtensionViewport | undefined> {
    try {
      return await this.input.createViewport?.(this.id, this.abort.signal)
    } catch (error) {
      this.reportViewUnavailable(error)
      return undefined
    }
  }

  /**
   * Records why the run goes on without its Application view (DR6): in {@link ChromeExtensionView.viewUnavailable} and the journal.
   * Called when the editor refuses to create the view, and when the created view cannot show the surface (a learner's tab opened in its group).
   * @param error - The editor's refusal; its text can name the learner's files, so it is masked and root-hidden like every journaled text.
   */
  private reportViewUnavailable(error: unknown): void {
    this.viewUnavailable = hidePrivateRoots(
      redactSecretText(error instanceof Error ? error.message : String(error)),
      this.roots,
    )
    this.record('chrome-extension.view-unavailable', {
      message: this.viewUnavailable,
    })
  }

  /** `attaching`, `waking` and `arming`: the debugger reports its own phases. */
  private async attachDebugger(
    resolved: ResolvedExtensionRun,
    browser: OwnedExtensionBrowser,
    phaseStartedAtMs: number,
  ): Promise<void> {
    const { dependencies } = this.input
    const debug = dependencies.createDebugger({
      runId: this.id,
      workspace: this.input.workspace,
      run: resolved,
      port: browser.port,
      surfaceTargetId: browser.surfaceTargetId,
      readTargets: async () =>
        readCdpTargets(await browser.cdp.request('Target.getTargets', {})),
      startWorker: () => browser.startWorker(),
      assertSourcesUnchanged: () => this.sourceCheck?.(),
      roots: this.roots,
      record: this.record,
      onPhase: (name, elapsedMs) => this.enterPhase(name, elapsedMs),
      phaseStartedAtMs,
    })
    this.debug = debug
    this.cleanups.push(
      debug.subscribe({
        onChange: () => this.onDebuggerChange(),
        onFailure: (error) => this.fail(error),
      }),
      dependencies.watchDebugSessionEnd(this.id, () =>
        this.fail(
          new StudyError(
            'RUNTIME_FAILED',
            'The debug session of the extension run ended.',
          ),
        ),
      ),
    )
    // The launch stopped every worker so the debugger could attach; the run discloses it (CR10).
    debug.recordIntervention('stop-all-workers')
    await debug.attach(this.abort.signal)
    this.assertAccepting()
    if (resolved.stops.some((stop) => stop.context === 'service-worker')) {
      await debug.waitForWorker(this.abort.signal)
      this.assertAccepting()
    }
    await debug.armStops(this.abort.signal)
    this.assertAccepting()
  }

  /** `ready`: the surface's session, the executor, the baseline read and the debugger's ready mark. */
  private async becomeReady(
    resolved: ResolvedExtensionRun,
    browser: OwnedExtensionBrowser,
  ): Promise<void> {
    const debug = this.debug
    if (debug === undefined) return
    const sessionId = await browser.attachSurface()
    this.surfaceSessionId = sessionId
    this.assertAccepting()
    try {
      await this.viewport?.attachSurface(browser.cdp, sessionId)
    } catch (error) {
      // A view that cannot show the surface leaves the run without one, as a refused view does (DR6).
      this.reportViewUnavailable(error)
      this.safely(() => this.viewport?.close())
      this.viewport = undefined
    }
    this.assertAccepting()
    this.surfaceAttached = true
    this.watchSurface(resolved, browser)
    this.executor = this.input.dependencies.createExecutor({
      cdp: browser.cdp,
      surfaceSessionId: sessionId,
      extensionId: resolved.extensionId,
      pauseState: debug.pauseState,
      assertActionCurrent: () => {
        this.assertAccepting()
        this.actionGuard?.assertCurrent()
      },
      assertSourcesUnchanged: () => this.sourceCheck?.(),
      record: this.record,
      roots: this.roots,
      ...(this.timings.settleMs === undefined
        ? {}
        : { settleMs: this.timings.settleMs }),
    })
    this.reader = createExtensionObservationReader({
      cdp: browser.cdp,
      extensionId: resolved.extensionId,
      observe: resolved.observe,
      surfaceSessionId: () =>
        this.surfaceGone ? undefined : this.surfaceSessionId,
      ...(this.timings.readTimeoutMs === undefined
        ? {}
        : { readTimeoutMs: this.timings.readTimeoutMs }),
    })
    this.beforeRead = await this.reader.read()
    this.assertAccepting()
    debug.markReady()
    this.cancelSetupTimer?.()
    this.enterPhase('ready')
  }

  // ------------------------------------------------------------------ surface and browser loss

  /** Listens for the surface target closing or leaving the extension (SR26, ER26). */
  private watchSurface(
    resolved: ResolvedExtensionRun,
    browser: OwnedExtensionBrowser,
  ): void {
    const { cdp } = browser
    const prefix = `chrome-extension://${resolved.extensionId}/`
    this.cleanups.push(
      {
        dispose: cdp.on('Target.targetDestroyed', (params) => {
          if (params.targetId === browser.surfaceTargetId)
            void this.onSurfaceLost(resolved)
        }),
      },
      {
        dispose: cdp.on('Target.targetInfoChanged', (params) => {
          const info = params.targetInfo
          if (
            typeof info === 'object' &&
            info !== null &&
            Reflect.get(info, 'targetId') === browser.surfaceTargetId &&
            !String(Reflect.get(info, 'url')).startsWith(prefix)
          )
            void this.onSurfaceLost(resolved)
        }),
      },
    )
    // Target events only arrive once discovery is on; a failure here only means the loss goes unnoticed until a read fails.
    void cdp
      .request('Target.setDiscoverTargets', { discover: true })
      .catch(() => undefined)
  }

  /** The surface is gone before the observation completed: journal it, read what can still be read, fail the run (SR26). */
  private async onSurfaceLost(resolved: ResolvedExtensionRun): Promise<void> {
    if (this.ending !== undefined || this.surfaceGone) return
    if (this.stage !== 'ready' && this.stage !== 'observing') return
    this.surfaceGone = true
    this.observationAbort.abort()
    this.record('chrome-extension.surface-lost', {
      surface: resolved.surface.kind,
    })
    // Only a run whose last click was performed has an observation to read: a text or popup read finds no context, a storage read still completes.
    if (
      this.reader !== undefined &&
      this.beforeRead !== undefined &&
      this.clicksPerformed >= resolved.clicks.length
    ) {
      const observedAfterLoss = await this.reader.read()
      // A stop accepted during the read already ended the run and kept its own observed result.
      if (this.ending !== undefined) return
      this.setObserved(observedAfterLoss)
    }
    this.fail(
      new StudyError(
        'SURFACE_LOST',
        'The extension surface closed or left the extension.',
      ),
    )
  }

  /** The browser's CDP connection or process ended without the run's own close. */
  private onBrowserLost(): void {
    this.fail(
      new StudyError(
        'BROWSER_LOST',
        "The extension's browser stopped unexpectedly.",
      ),
    )
  }

  // ------------------------------------------------------------------ debugger changes and pauses

  /** A pause opened, finished its capture or ended. */
  private onDebuggerChange(): void {
    if (this.ending !== undefined) return
    for (const pause of this.debug?.pauses() ?? []) {
      if (
        pause.kind === 'declared' &&
        pause.captured !== undefined &&
        !this.captures.some(
          (capture) =>
            capture.stopIndex === pause.captured?.stopIndex &&
            capture.workerGeneration === pause.captured.workerGeneration,
        )
      )
        this.captures.push(pause.captured)
      if (
        pause.kind === 'declared' &&
        !this.pinnedGenerations.has(pause.generation)
      ) {
        this.pinnedGenerations.add(pause.generation)
        void this.pinPause(pause.generation, pause.stopIndex, pause.context)
      }
    }
    if (!this.debug?.pauses().some((pause) => pause.kind === 'declared'))
      this.viewport?.resumeLive()
    this.changed()
  }

  /** Pins the surface's frame of a declared pause under its phase text (DR3); a paused page may not answer the capture, then the live frame stays. */
  private async pinPause(
    generation: number,
    stopIndex: number | undefined,
    context: 'page' | 'service-worker',
  ): Promise<void> {
    const sessionId = this.surfaceSessionId
    const browser = this.browser
    if (
      this.viewport === undefined ||
      sessionId === undefined ||
      browser === undefined
    )
      return
    let cancelTimer: (() => void) | undefined
    try {
      const shot = await Promise.race([
        browser.cdp.request(
          'Page.captureScreenshot',
          { format: 'png' },
          sessionId,
          EXTENSION_PIN_CAPTURE_TIMEOUT_MS,
        ),
        new Promise<never>((_resolve, reject) => {
          const cancelClockTimer = this.input.dependencies.clock.set(
            () => reject(new Error('screenshot timed out')),
            EXTENSION_PIN_CAPTURE_TIMEOUT_MS,
          )
          // A cancel (cleanup or the finally) also settles the race: a paused page may never answer the capture, and a cancelled timer alone would leave the race pending forever.
          cancelTimer = (): void => {
            cancelClockTimer()
            reject(new Error('screenshot cancelled'))
          }
          this.pinTimerCancels.add(cancelTimer)
        }),
      ])
      if (this.ending !== undefined || !this.isPauseOpen(generation)) return
      const text = `Paused at stop ${stopIndex ?? '?'} of ${this.view().stopsDeclared} · ${context === 'service-worker' ? 'service worker' : 'page'}`
      await this.viewport.pinPause(readCdpString(shot, 'data'), text)
      // A continue answered while the frame was being pinned found nothing pinned: the live frame returns now.
      if (
        !this.isPauseOpen(generation) &&
        !this.debug?.pauses().some((open) => open.kind === 'declared')
      )
        this.viewport?.resumeLive()
    } catch {
      // The live frame stays; the phase text already names the pause.
    } finally {
      // The capture's timer must not outlive the capture (it would keep a stopped run's timer alive).
      if (cancelTimer !== undefined) {
        cancelTimer()
        this.pinTimerCancels.delete(cancelTimer)
      }
    }
  }

  /** Whether the declared pause of this generation is still open; a screenshot answered after its continue must not pin it (the live frame would stay frozen). */
  private isPauseOpen(generation: number): boolean {
    return Boolean(
      this.debug
        ?.pauses()
        .some(
          (open) => open.kind === 'declared' && open.generation === generation,
        ),
    )
  }

  // ------------------------------------------------------------------ clicks

  async click(): Promise<ChromeExtensionClickAnswer> {
    const resolved = this.assertCanClick()
    const click = resolved.clicks[this.clicksPerformed]
    if (click === undefined) throw this.noMoreActions()
    this.clickInFlight = click.index
    this.changed()
    let receipt: ExtensionClickReceipt
    try {
      receipt = await this.dispatchClick(click)
      // A settled click's steps have ended: its failure is this call's failure, and nothing is pending when the call answers.
      if (receipt.outcome === 'settled') await receipt.completed
    } catch (error) {
      throw await this.settleClickFailure(error)
    } finally {
      this.clickInFlight = undefined
    }
    this.clicksPerformed = click.index
    this.lastReceipt = receipt
    const isLastClick = click.index >= resolved.clicks.length
    if (receipt.outcome === 'settled') this.afterClickWork(isLastClick)
    else {
      this.workPending = true
      this.followClickWork(receipt, isLastClick)
    }
    this.changed()
    return this.answerOf(receipt)
  }

  /** The refusals that consume nothing and say why a click cannot start now (SR2, SR12). */
  private assertCanClick(): ResolvedExtensionRun {
    const { resolved, debug, executor } = this
    const isAlive = this.stage === 'ready' || this.stage === 'observing'
    // After the last declared click the run only observes; a completed run performed them all.
    if (
      resolved !== undefined &&
      this.clicksPerformed >= resolved.clicks.length &&
      (isAlive || this.stage === 'completed')
    )
      throw this.noMoreActions()
    // An accepted ending (stop, deadline, failure) refuses the call while its cleanup still runs.
    if (this.ending !== undefined)
      throw new StudyError(
        'RUN_NOT_READY',
        'The extension run is ending and takes no further click.',
      )
    if (
      !isAlive ||
      resolved === undefined ||
      debug === undefined ||
      executor === undefined
    )
      throw new StudyError(
        'RUN_NOT_READY',
        'The extension run is not ready for a click.',
      )
    if (debug.pauseState.isPaused())
      throw new StudyError(
        'RUN_PAUSED',
        'A stop is paused; continue it before the next click.',
      )
    if (this.clickInFlight !== undefined || this.workPending)
      throw new StudyError(
        'ACTION_IN_PROGRESS',
        'A click is still in progress.',
      )
    return resolved
  }

  private noMoreActions(): StudyError {
    return new StudyError(
      'NO_MORE_ACTIONS',
      'Every declared click was performed.',
    )
  }

  /** Readiness, source check and the executor for one declared click. */
  private async dispatchClick(
    click: ResolvedExtensionClick,
  ): Promise<ExtensionClickReceipt> {
    const { debug, executor } = this
    if (debug === undefined || executor === undefined)
      throw new StudyError(
        'RUN_NOT_READY',
        'The extension run is not ready for a click.',
      )
    // A refused readiness consumes nothing: the run stays `ready`.
    await debug.ensureWorkerReady(this.abort.signal)
    this.assertAccepting()
    await this.sourceCheck?.()
    this.actionGuard = debug.beginAction()
    this.record('chrome-extension.click', {
      clickIndex: click.index,
      selector: click.selector,
    })
    return executor.run(click)
  }

  /** Decides what a failed click call does to the run: a refusal leaves it `ready`, anything else fails and cleans it up first. */
  private async settleClickFailure(error: unknown): Promise<StudyError> {
    this.actionGuard?.end()
    this.actionGuard = undefined
    const failure = asStudyError(error)
    if (this.ending !== undefined) {
      await this.endingPromise
      return this.runFailure ?? failure
    }
    if (REFUSED_CLICK_CODES.includes(failure.code)) {
      this.viewport?.setPhase(
        describeChromeExtensionFailure(failure.message, 'refused-click'),
      )
      this.lastViewportText = undefined
      return failure
    }
    await this.endRun({ kind: 'failed', error: failure })
    return this.runFailure ?? failure
  }

  /** Follows the work of a click that was still going when its call answered (`paused` or `running`): a failure ends the run, the last one leads into the observation (SR23). */
  private followClickWork(
    receipt: ExtensionClickReceipt,
    isLastClick: boolean,
  ): void {
    void receipt.completed.then(
      () => {
        this.workPending = false
        this.afterClickWork(isLastClick)
        // The click's work ended after its call answered: the view offers the next step again.
        this.changed()
      },
      (error: unknown) => {
        this.workPending = false
        this.actionGuard?.end()
        this.actionGuard = undefined
        this.fail(asStudyError(error))
      },
    )
  }

  /** A click's steps ended: its action guard ends, a dialog that opened late fails the run, and the last click starts the observation. */
  private afterClickWork(isLastClick: boolean): void {
    this.actionGuard?.end()
    this.actionGuard = undefined
    if (this.ending !== undefined) return
    const late = this.executor?.lateDialogRefusal()
    if (late !== undefined) return this.fail(late)
    if (isLastClick) void this.observe()
  }

  // ------------------------------------------------------------------ continue

  async continue(args: ExtensionContinueArguments): Promise<void> {
    const debug = this.debug
    if (debug === undefined || this.ending !== undefined)
      throw new StudyError(
        'NO_PAUSE',
        'The extension run is not paused at a declared stop.',
      )
    if (!debug.pauses().some((pause) => pause.kind === 'declared'))
      throw new StudyError(
        'NO_PAUSE',
        'The extension run is not paused at a declared stop.',
      )
    try {
      await debug.resume(args, this.abort.signal)
    } catch (error) {
      const failure = asStudyError(error)
      // A changed source ends the run; the pause errors leave it as it is.
      if (failure.code === 'SOURCE_CHANGED')
        await this.endRun({ kind: 'failed', error: failure })
      throw this.runFailure ?? failure
    }
  }

  // ------------------------------------------------------------------ observation

  /** Reads the result after the last click and ends the run (CR9, SR23). */
  private async observe(): Promise<void> {
    const { reader, debug } = this
    if (reader === undefined || debug === undefined || this.surfaceGone) return
    try {
      const after = await observeAfterLastClick({
        read: () => reader.read(),
        pauseState: debug.pauseState,
        signal: AbortSignal.any([
          this.abort.signal,
          this.observationAbort.signal,
        ]),
        ...(this.timings.settleMs === undefined
          ? {}
          : { settleMs: this.timings.settleMs }),
        ...(this.timings.pollMs === undefined
          ? {}
          : { pollMs: this.timings.pollMs }),
        ...(this.timings.boundMs === undefined
          ? {}
          : { boundMs: this.timings.boundMs }),
        onReading: () => this.enterPhase('observing'),
      })
      if (this.ending !== undefined || this.surfaceGone) return
      this.setObserved(after)
      const word = this.observed
        ? extensionObservationResult(this.observed)
        : 'unavailable'
      if (word === 'unavailable' && 'unavailable' in after)
        this.runFailure = new StudyError(
          'OBSERVATION_UNAVAILABLE',
          `The result could not be read: ${hidePrivateRoots(redactSecretText(after.cause), this.roots)}.`,
        )
      await this.endRun({ kind: 'completed' })
    } catch (error) {
      // An accepted ending or a lost surface already decided the run; any other failure ends it.
      if (this.ending === undefined && !this.surfaceGone)
        await this.endRun({ kind: 'failed', error: asStudyError(error) })
    }
  }

  /** Builds and keeps the observation report from the baseline and an after read. */
  private setObserved(after: ExtensionObservedRawRead): void {
    const observe = this.resolved?.observe
    this.observed = buildExtensionObserved({
      kind: observe?.kind ?? 'text',
      ...(observe?.kind === 'storage' && { key: observe.key }),
      before: this.beforeRead ?? {
        unavailable: true,
        cause: 'no baseline was read',
      },
      after,
      observedAtMs: this.elapsedMs(),
      roots: this.roots,
    })
  }

  // ------------------------------------------------------------------ endings

  /** Fails the run with an error; the first ending wins. */
  private fail(error: StudyError): void {
    // A cleanup that rejects must not become an unhandled rejection; the failure is already recorded.
    this.endRun({ kind: 'failed', error }).catch(() => undefined)
  }

  async stop(): Promise<void> {
    if (this.endingPromise !== undefined) return this.endingPromise
    const beforeReady =
      this.stage !== 'ready' &&
      this.stage !== 'observing' &&
      this.stage !== 'paused'
    if (beforeReady)
      return this.endRun({
        kind: 'failed',
        error: new StudyError(
          'RUNTIME_FAILED',
          'The extension run was stopped before it was ready.',
        ),
      })
    return this.endRun({ kind: 'stopped' })
  }

  /** Accepts an ending once: no further step starts, and the one cleanup runs (CR14). */
  private endRun(ending: RunEnding): Promise<void> {
    if (this.endingPromise !== undefined) return this.endingPromise
    this.ending = ending
    const view = this.view()
    const stopsNotReached = view.stopsNotReached
    if (ending.kind === 'failed') this.runFailure = ending.error
    if (ending.kind === 'stopped') {
      this.result = 'partial'
      this.observed = null
    }
    if (ending.kind === 'completed')
      this.result = stopsNotReached.length > 0 ? 'partial' : 'complete'
    this.abort.abort(
      ending.kind === 'failed'
        ? ending.error
        : new StudyError('RUNTIME_FAILED', 'The extension run ended.'),
    )
    this.observationAbort.abort()
    this.endingPromise = this.cleanup(ending).then(() => {
      this.stage = ending.kind === 'failed' ? 'failed' : 'completed'
      // The last phase text and accessible detail stay readable after the run.
      this.changed()
    })
    return this.endingPromise
  }

  /** The one cleanup path: viewport result, then debugger, executor and browser in that order, then the lease (acceptance 5, ER18). */
  private async cleanup(ending: RunEnding): Promise<void> {
    this.cancelRunTimer?.()
    this.cancelSetupTimer?.()
    for (const cancelPinTimer of [...this.pinTimerCancels])
      this.safely(cancelPinTimer)
    this.pinTimerCancels.clear()
    // A step still in flight finishes (it was aborted) before anything is closed, so a browser that appears late is closed too; one that ignores the abort is left behind at the stop bound.
    const didStepsSettle = await this.waitForStepsWithinStopBound()
    this.showEnding(ending)
    for (const handle of this.cleanups.splice(0))
      this.safely(() => handle.dispose())
    const { debug, executor, browser } = this
    this.safely(() => debug?.browserClosing())
    await this.safelyAsync(() => debug?.release())
    this.safely(() => executor?.dispose())
    this.cleanupResult = browser
      ? await this.closeBrowser(browser)
      : didStepsSettle
        ? { profileLeft: false, exitConfirmed: true }
        : // A launch still under way may have made its profile and started Chrome before it hands back a browser: nothing is confirmed until it settles.
          { profileLeft: true, exitConfirmed: false }
    // The viewport is read once, after the waits above: the same one is closed here and named as handled, so a late check never closes it twice.
    const closedViewport = this.viewport
    this.safely(() => closedViewport?.close())
    // A step that settled only after the bound may have published a viewport or browser nobody closed: each is closed then.
    if (!didStepsSettle) {
      this.closeLateResources({ browser, viewport: closedViewport })
      this.resolveStepsLeftBehind()
    }
  }

  /** Closes the browser; a close that throws or rejects reads as a profile left behind. */
  private async closeBrowser(
    browser: OwnedExtensionBrowser,
  ): Promise<NonNullable<ChromeExtensionView['cleanup']>> {
    try {
      return await browser.close()
    } catch {
      return { profileLeft: true, exitConfirmed: false }
    }
  }

  /**
   * Waits for the in-flight preparation step, but never past {@link CHROME_EXTENSION_STOP_DEADLINE_MS}.
   * Called first by {@link OwnedChromeExtensionRun.cleanup}; a step that ignores its abort would otherwise hold the stop forever.
   * @returns `true` when the step settled (or none ran), `false` when the bound passed first.
   */
  private async waitForStepsWithinStopBound(): Promise<boolean> {
    if (this.stepsPromise === undefined) return true
    let cancelBound = (): void => undefined
    const bound = new Promise<false>((resolve) => {
      cancelBound = this.input.dependencies.clock.set(
        () => resolve(false),
        CHROME_EXTENSION_STOP_DEADLINE_MS,
      )
    })
    try {
      return await Promise.race([
        this.stepsPromise.then(
          () => true as const,
          () => true as const,
        ),
        bound,
      ])
    } finally {
      cancelBound()
    }
  }

  /** After a stop bound passed, closes what the stuck step published later than the cleanup read it (a resource the cleanup already handled is not handled twice). */
  private closeLateResources(handled: HandledResources): void {
    void this.stepsPromise?.then(
      () => this.closeIfNew(handled),
      () => this.closeIfNew(handled),
    )
  }

  private closeIfNew(handled: HandledResources): void {
    if (this.viewport !== undefined && this.viewport !== handled.viewport)
      this.safely(() => this.viewport?.close())
    const lateBrowser = this.browser
    if (lateBrowser === handled.browser) {
      // The stuck step settled without a browser before its launch began: nothing was made, so the unconfirmed cleanup is confirmed. A launch that began and failed made its profile and Chrome and keeps its own close result, so the cleanup stays unconfirmed.
      if (handled.browser === undefined && this.launchedAtMs === undefined) {
        this.cleanupResult = { profileLeft: false, exitConfirmed: true }
        this.changed()
      }
      return
    }
    if (lateBrowser === undefined) return
    void this.closeBrowser(lateBrowser).then((lateResult) => {
      // Without a browser the cleanup was left unconfirmed, so the late close's own result replaces it; after a closed browser a failed late close still reaches the run resource, never leaving a clean claim.
      const settled = this.cleanupResult
      this.cleanupResult =
        handled.browser === undefined
          ? lateResult
          : {
              profileLeft:
                (settled?.profileLeft ?? false) || lateResult.profileLeft,
              exitConfirmed:
                (settled?.exitConfirmed ?? true) && lateResult.exitConfirmed,
            }
      this.changed()
    })
  }

  /** Hands the last frame and the result line to the viewport (DR4, DR5, DR10, ER22). */
  private showEnding(ending: RunEnding): void {
    const viewport = this.viewport
    if (viewport === undefined) return
    this.safely(() => {
      if (ending.kind === 'failed') {
        if (ending.error.code === 'SURFACE_LOST') return viewport.surfaceLost()
        const text = describeChromeExtensionViewStatus(
          { ...this.view(), phase: 'failed', runFailure: ending.error },
          this.clickTitles(),
        ).viewportPhase
        if (this.surfaceAttached) return viewport.end(text)
        const kind = classifyChromeExtensionFailure(
          this.view(),
          ending.error.code,
        )
        return viewport.showFailure(
          ending.error.message,
          chromeExtensionFailureNextStep(kind),
        )
      }
      const view = this.view()
      const finished = describeChromeExtensionViewStatus(
        { ...view, phase: 'completed' },
        this.clickTitles(),
      ).viewportPhase
      viewport.setAccessibleDetail(this.accessibleDetail())
      viewport.end(
        ending.kind === 'stopped' ? `Run stopped · ${finished}` : finished,
      )
    })
  }

  /** The hidden text after the frame: the observation before and after once known (DR8). */
  private accessibleDetail(): string {
    const read = (
      value: ChromeExtensionObserved['before'] | undefined,
    ): string =>
      value === undefined
        ? 'not read'
        : 'missing' in value
          ? 'missing'
          : 'unavailable' in value
            ? 'unavailable'
            : JSON.stringify(value.value)
    return this.observed
      ? `Observation before: ${read(this.observed.before)}. After: ${read(this.observed.after)}.`
      : 'The result was not observed.'
  }

  /** Runs one cleanup step; a failure never stops the steps after it. */
  private safely(step: () => unknown): void {
    try {
      step()
    } catch {
      // Cleanup continues.
    }
  }

  private async safelyAsync(
    step: () => Promise<unknown> | undefined,
  ): Promise<void> {
    try {
      await step()
    } catch {
      // Cleanup continues.
    }
  }
}

/**
 * Creates a chrome-extension run for the service (Cycle 0061 pt2).
 * Called by the environment's `createChromeExtensionRun` hook; the service then calls `prepare`, `click`, `continue` and `stop` and reads `view`.
 * @param input - The run id, configuration, acknowledgement, journal, workspace, dependencies and optional Application view.
 * @returns A {@link ChromeExtensionRuntime} that has not started anything yet.
 * @example
 * const run = createOwnedChromeExtensionRun({ runId, configuration, acknowledgedPermissions: [], record, workspace, dependencies })
 * await run.prepare()
 */
export function createOwnedChromeExtensionRun(
  input: OwnedChromeExtensionRunInput,
): ChromeExtensionRuntime {
  return new OwnedChromeExtensionRun(input)
}
