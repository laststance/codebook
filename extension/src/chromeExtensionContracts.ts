import type { ReplayDebugSnapshot } from './replayDebugSchemas'

/** The execution context a declared chrome-extension stop names: the surface page or the extension's service worker. */
export type ExtensionStopContext = 'page' | 'service-worker'

/** The surface a chrome-extension run opens: the manifest's action popup or one extension page. */
export type ExtensionSurfaceKind = 'popup' | 'page'

/**
 * One declared stop after the pre-launch checks, with the source identity pinned at `starting` (ER20).
 * Produced by the configuration resolver; consumed by the debugger, which arms it in the session of its context.
 */
export interface ResolvedExtensionStop {
  /** 1-based position among the declared stops (SR25). */
  index: number
  /** Path relative to the extension root, forward slashes. */
  path: string
  /** Canonical absolute path inside the repository. */
  absolutePath: string
  /** 1-based line. */
  line: number
  context: ExtensionStopContext
  /** SHA-256 of the file's bytes when the run started. */
  sha256: string
}

/** One declared click after validation (DR2, CR8, TZ11). */
export interface ResolvedExtensionClick {
  /** 1-based position among the declared clicks. */
  index: number
  title: string
  selector: string
  kind: 'click' | 'dblclick'
  /** How a JavaScript dialog the step opens is answered; absent means an opened dialog fails the run (`DIALOG_UNDECLARED`). */
  dialog?: 'accept' | 'dismiss'
  /** Text inserted into the surface just before this click, in order. */
  inputs: readonly { selector: string; text: string }[]
}

/** One node of the seeded bookmark tree (written under "Other bookmarks"). */
export interface ExtensionSeedBookmark {
  title: string
  url?: string
  children?: readonly ExtensionSeedBookmark[]
}

/** What the run observes after its last click (CR9). */
export type ExtensionObservation =
  | { kind: 'text'; selector: string }
  | { kind: 'storage'; key: string }
  | { kind: 'popup' }

/**
 * Everything the pre-launch checks establish, handed to the launch, the debugger and the executor.
 * Built by the configuration resolver from a parsed configuration and the repository; nothing here is read again from the configuration later.
 */
export interface ResolvedExtensionRun {
  /** Canonical absolute extension root (realpath), the exact string passed to `Extensions.loadUnpacked` (SR28). */
  root: string
  /** The id Chrome must answer for the root (path rule or manifest key). */
  extensionId: string
  manifestName: string
  permissions: readonly string[]
  hostPermissions: readonly string[]
  surface: { kind: ExtensionSurfaceKind; path: string }
  /** `chrome-extension://<id>/<surface path>`. */
  surfaceUrl: string
  /** The manifest's `background.service_worker`, relative to the root, when declared. */
  workerPath?: string
  stops: readonly ResolvedExtensionStop[]
  clicks: readonly ResolvedExtensionClick[]
  seed: {
    bookmarks: readonly ExtensionSeedBookmark[]
    storage: Readonly<Record<string, unknown>>
  }
  observe: ExtensionObservation
  /** SHA-256 per pinned file (manifest, surface HTML, every stop file), keyed by absolute path (ER20). */
  pinnedHashes: Readonly<Record<string, string>>
}

/**
 * A browser-level CDP connection that routes flattened target sessions (`sessionId`), used for the browser Codebook owns.
 * Implemented by {@link WebSocketFlatCdp} (a separate client from the js-debug page proxy's `Cdp`); the launch, the debugger, the executor, the observation and the Application view depend only on this shape.
 */
export interface FlatCdpConnection {
  /** Sends one command to the browser target (no `sessionId`) or to an attached target session. */
  request(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>
  /** Observes one event method on the browser or any session; the listener receives the event's session when it has one. */
  on(
    method: string,
    listener: (params: Record<string, unknown>, sessionId?: string) => void,
  ): () => void
  /** Tells once when the connection ended, whether the socket closed by itself or {@link FlatCdpConnection.close} was called; returns the unsubscribe. A listener added after the end is called at once. */
  onClose(listener: () => void): () => void
  close(): void
}

/**
 * The browser a chrome-extension run owns once the surface is open and every worker is stopped, ready for the js-debug attach (TZ1–TZ4).
 * Produced by the owned-browser launch; consumed by the debugger (attach port, surface identity) and the executor (CDP input).
 */
export interface OwnedExtensionBrowser {
  /** The browser's random local debugging port (`DevToolsActivePort`). */
  port: number
  extensionId: string
  cdp: FlatCdpConnection
  /** Target id of the open surface (popup or page). */
  surfaceTargetId: string
  /** A session of the run's own about:blank page, used for `ServiceWorker.*` commands. */
  controlSessionId: string
  /** Owner-marked profile folder. */
  profile: string
  /** Starts the extension's service worker (`ServiceWorker.startWorker`). */
  startWorker(): Promise<void>
  /** Stops every service worker and waits until none of the extension's remains, at most `boundMs`. */
  stopWorkers(boundMs: number): Promise<void>
  /**
   * Attaches a flat session to the surface target and enables `Page` and `Runtime` on it, for the executor's input and observation.
   * The run calls it after the debugger attached and before the first click.
   * @returns The surface's CDP session id.
   * @throws {@link StudyError} `BROWSER_LOST` when the connection is gone; the command's own error otherwise.
   */
  attachSurface(): Promise<string>
  /**
   * Registers a one-shot listener that fires once when the browser was lost after the launch: the CDP socket closed or the process exited without {@link OwnedExtensionBrowser.close} having begun. It never fires after `close()` began; the returned function removes the listener.
   */
  onLost(listener: () => void): () => void
  /**
   * Ends the browser and removes the profile; the run releases the debugger (the debugger's `release`) and calls `browserClosing` before it calls this, so the debugger never sees the browser vanish under an open pause.
   * Reports what could not be confirmed instead of throwing (ER18).
   */
  close(): Promise<{ profileLeft: boolean; exitConfirmed: boolean }>
}

/** One captured stop, ready for the run resource and the later save cycle (CR11). */
export interface CapturedExtensionStop {
  stopIndex: number
  context: ExtensionStopContext
  /** Incremented for each new worker child session; 0 for page stops. */
  workerGeneration: number
  targetUrl: string
  sha256: string
  capturedAtMs: number
  snapshot: ReplayDebugSnapshot
}

/** The preparation phases of a chrome-extension run reported through `onPhase`, named as the run phase state machine names them: the owned launch reports `launching`, `installing` and `opening`; the debugger reports `attaching`, `waking` and `arming`. */
export type ExtensionPreparationPhase =
  'launching' | 'installing' | 'opening' | 'attaching' | 'waking' | 'arming'

/** Reports that a preparation phase started, with the milliseconds on a monotonic clock since the preparation began; the run lifecycle journals it as `chrome-extension.phase` (CR15). */
export type ExtensionPhaseReporter = (
  name: ExtensionPreparationPhase,
  elapsedMs: number,
) => void

/** The surface identity and declared clicks the Application view's header and hidden text name (DR1, DR8). */
export type ExtensionViewportIdentity = {
  /** The manifest's `name`. */
  manifestName: string
  surface: { kind: ExtensionSurfaceKind; path: string }
  /** The declared click titles, in order (DR8's hidden text). */
  clickTitles: readonly string[]
}

/**
 * The Application view of one chrome-extension run (DR1–DR8, DR13, ER22), implemented over the leased Application panel ({@link StudyPresentation.createChromeExtensionViewport}).
 * The run drives it in order: identity, preparing steps, the surface's screencast, phase texts and pinned pause frames, then exactly one of `surfaceLost` / `end`; `close` at every ending releases the lease without closing the kept view of an ended run.
 */
export interface ChromeExtensionViewport {
  /** Writes the header: `codebook · <name> · Extension popup` (or `Extension page <path>`), then the provenance line `Operated by chat · Test profile · seeded data · Live only · replay unavailable` (DR1, C1, C2). */
  setIdentity(identity: ExtensionViewportIdentity): void
  /** Before the first frame: `Preparing the extension · step <k> of <N>: <sentence>` (DR4). */
  showPreparing(step: number, steps: number, sentence: string): void
  /**
   * Starts the screencast of the surface target on its flat session (SR6): a popup at its own CSS size with no device-metrics override, scrolled when the pane is smaller (DR7); a page with the existing 720 × 640 metrics and fit.
   * @param cdp - The run's browser-level connection.
   * @param sessionId - The surface's flat session ({@link OwnedExtensionBrowser.attachSurface}).
   */
  attachSurface(cdp: FlatCdpConnection, sessionId: string): Promise<void>
  /** The phase text of the header's status element (the C4 table), announced politely on a change only (DR8). */
  setPhase(text: string): void
  /** The hidden accessible text after the frame: the current context and the observation before and after once known (DR8). */
  setAccessibleDetail(detail: string): void
  /** Pins the surface's frame of a pause with its phase text, `Paused at stop <n> of <m> · <page|service worker>` (DR3); resolves once it was painted. */
  pinPause(pngBase64: string, phaseText: string): Promise<void>
  /** Lets the live frames show again after a pinned pause. */
  resumeLive(): void
  /** A failure before the surface opened: its refusal sentence and the DR10 next-step line (DR4). */
  showFailure(sentence: string, nextStep: string): void
  /** The surface closed or left the extension: the last frame stays dimmed with `Popup closed` or `Page closed` (DR4). */
  surfaceLost(): void
  /** The run ended: the last captured frame stays with `Run ended · last captured view <hh:mm:ss>` and the result line, without taking the keyboard, until the next run's view replaces it or the learner closes the tab (ER22). */
  end(resultLine: string): void
  /** Stops the screencast and releases the lease; the kept view of an ended run stays. Idempotent. */
  close(): void
}

/** Creates the Application view of a chrome-extension run, before its launch (the lease must exist before the first frame). */
export type ChromeExtensionViewportFactory = (
  runId: string,
  signal?: AbortSignal,
) => Promise<ChromeExtensionViewport>
