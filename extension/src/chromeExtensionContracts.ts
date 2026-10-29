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
 * Implemented over the existing WebSocket `Cdp` client; the debugger and executor depend only on this shape.
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
