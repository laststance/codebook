import type {
  CapturedExtensionStop,
  ExtensionPhaseReporter,
  ExtensionStopContext,
  ResolvedExtensionRun,
} from './chromeExtensionContracts'
import type { StudyError } from './errors'
import type { CauseRoots } from './utils/sanitizeCause'

/** The arguments the chat copies from the run resource to continue one extension pause (DXR5); a pause of a replaced worker or an earlier hold never matches again. */
export type ExtensionContinueArguments = {
  participant: 'extension'
  sessionId: string
  threadId: number
  generation: number
}

/** Where the capture of a pause stands; a learner pause is never captured. */
export type ExtensionPauseStatus =
  'capturing' | 'captured' | 'capture-failed' | 'not-captured'

/** One open pause as the run resource lists it (ER16). */
export type ExtensionPauseView = {
  /** Identifies this pause until it ends; also the `generation` of its continue arguments. */
  generation: number
  sessionId: string
  threadId: number
  context: ExtensionStopContext
  /** The adapter's stopped reason, such as `breakpoint`, `pause` or `exception`. */
  reason: string
  /** `declared` for the hit of a declared stop Codebook captures; `learner` for a pause that stays the learner's (ER13). */
  kind: 'declared' | 'learner'
  /** 1-based index of the declared stop; only for a declared pause. */
  stopIndex?: number
  status: ExtensionPauseStatus
  captured?: CapturedExtensionStop
  /** Why the capture failed. */
  captureFailure?: string
  /** Only a declared pause can be continued by Codebook. */
  continueArguments?: ExtensionContinueArguments
  pausedAtMs: number
}

/**
 * What the action executor asks the debugger while a click runs.
 * Implemented by the debugger over its pause set; injected into the action executor so the executor holds no global.
 */
export interface ExtensionPauseState {
  /** Whether any kept pause (declared or the learner's) is open, so a request cannot be answered. */
  isPaused(): boolean
  /** Whether a declared stop of the run is paused. */
  hasDeclaredPause(): boolean
  /** Hears every change of the pause set; returns the function that stops listening. */
  onChange(listener: () => void): () => void
}

/** What the run listens to. */
export type ExtensionDebuggerHandlers = {
  /** A pause opened, finished its capture or ended. */
  onChange(): void
  /** The run must end: a worker lost or restarted, a changed source, an expired hold. */
  onFailure(error: StudyError): void
}

/** Ends an action's watch over the worker generation. */
export type ExtensionActionGuard = {
  /** @throws a {@link StudyError} `SERVICE_WORKER_RESTARTED` once the worker restarted since the action began. */
  assertCurrent(): void
  end(): void
}

/** One Codebook intervention in the extension's lifecycle, listed in the run resource (CR10). */
export type ExtensionIntervention = { kind: string; time: string }

/**
 * The debugger of a chrome-extension run, behind a seam: the product binds the editor's js-debug attach session ({@link createVscodeChromeExtensionDebugger}), tests drive fake sessions.
 * The run calls it in a fixed order: subscribe, attach, wait for the worker, arm every stop, mark ready, then per click ensure the worker, begin an action, observe pauses and resume them; release at every ending.
 */
export interface ChromeExtensionDebugger {
  subscribe(handlers: ExtensionDebuggerHandlers): { dispose(): void }
  /** Starts the attach session and waits for the surface's child session. @throws `SURFACE_NOT_ATTACHED`. */
  attach(signal: AbortSignal): Promise<void>
  /** Waits for the extension's worker child session. @throws `SERVICE_WORKER_NOT_ATTACHED`. */
  waitForWorker(signal: AbortSignal): Promise<void>
  /** Adds every declared stop and waits until each is verified in a session of its context. @throws `STOP_NOT_BOUND`. */
  armStops(signal: AbortSignal): Promise<void>
  /** From now on a declared hit is a stop offered to the chat; before it, a hit is a prepare-pause that is resumed. */
  markReady(): void
  /** Before each click: the worker thread exists and its stops are verified, else the worker is started again (SR1). @throws `SERVICE_WORKER_NOT_ATTACHED`, `STOP_NOT_BOUND`. */
  ensureWorkerReady(signal: AbortSignal): Promise<void>
  /** Starts watching the worker generation for one action (ER17). */
  beginAction(): ExtensionActionGuard
  readonly pauseState: ExtensionPauseState
  /** Every open pause, in the order they began. */
  pauses(): ExtensionPauseView[]
  /** Continues one declared pause. @throws `STALE_PAUSE`, `LEARNER_PAUSED`, `SOURCE_CHANGED`. */
  resume(args: ExtensionContinueArguments, signal: AbortSignal): Promise<void>
  /** 1-based indexes of declared stops not yet reached. */
  stopsNotReached(): number[]
  workerGeneration(): number
  interventions(): readonly ExtensionIntervention[]
  /** Journals an intervention the run itself makes (`stop-all-workers`). */
  recordIntervention(kind: string): void
  /**
   * Tells the debugger the owned browser is about to close, so the sessions that end with it (a worker paused at a stop) are no failure.
   * The run calls it after `release` began and before `OwnedExtensionBrowser.close`.
   */
  browserClosing(): void
  /**
   * Removes the owned breakpoints and ends the sessions; safe to call again after a failure.
   * The run releases the debugger before it closes the browser, so no editor session outlives the browser it is attached to.
   */
  release(): Promise<void>
}

/** The pieces a debugger factory is given. */
export type ExtensionDebuggerInput = {
  runId: string
  /** The opened repository's folder, the workspace folder of the attach. */
  workspace: string
  run: Pick<
    ResolvedExtensionRun,
    'root' | 'extensionId' | 'surfaceUrl' | 'surface' | 'stops' | 'workerPath'
  >
  /** The owned browser's debugging port. */
  port: number
  /** Target id of the open surface (informational: js-debug's child sessions carry their own session ids, so the page child is found by the session tree). */
  surfaceTargetId: string
  /** Starts the extension's service worker (`ServiceWorker.startWorker`). */
  startWorker(): Promise<void>
  /** Refuses (`SOURCE_CHANGED`) while the disk or an open editor document differs from the pinned bytes (ER20). */
  assertSourcesUnchanged(): void | Promise<void>
  /** Private roots hidden from journaled output. */
  roots: CauseRoots
  record: (type: string, detail?: unknown) => unknown
  /** Clock for timestamps; defaults to `Date.now`. */
  now?: () => number
  /** Told when `attaching`, `waking` (only with a service-worker stop) and `arming` start, with the monotonic milliseconds since `phaseStartedAtMs`; a throwing callback is ignored (CR15). */
  onPhase?: ExtensionPhaseReporter
  /** The `performance.now()` reading of the run's launch start, so launch and debugger phases share one elapsed clock; the debugger's creation when omitted. */
  phaseStartedAtMs?: number
}
