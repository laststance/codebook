import type {
  CapturedExtensionStop,
  ExtensionStopContext,
} from './chromeExtensionContracts'
import type { ChromeExtensionObserved } from './runtime'
import type { ViewportRecordingObserver } from './runtimeSupport/browserViewport'

/** The identity of one declared pause as the history journals it. */
export type ExtensionHistoryPause = {
  /** Run id, pause generation, context and stop index, joined: unique in the run. */
  pauseId: string
  generation: number
  context: ExtensionStopContext
  /** 1-based index of the declared stop. */
  stopIndex: number
  /** The surface URL for a page stop; `chrome-extension://<id>/<workerPath>` for a worker stop. */
  targetUrl: string
  /** Incremented for each new worker child session; 0 for page stops. */
  workerGeneration: number
}

/**
 * What a chrome-extension run tells its history while it lives. Every method returns at once, never throws and never waits for a disk: a history that fails leaves the live run exactly as it is.
 * Implemented by {@link ChromeExtensionHistoryRecorder}; the service passes it into the run, and the run calls it where it already notices a pause, a capture, a continue, the surface ending and the result.
 */
export interface ChromeExtensionHistorySink {
  /** Receives the surface's screencast frames; give it to the Application view. */
  readonly frameObserver: ViewportRecordingObserver
  /** A declared stop paused. */
  pauseOpened(pause: ExtensionHistoryPause): void
  /** The pause's asynchronous capture finished. */
  captured(pauseId: string, capture: CapturedExtensionStop): void
  /** The pause ended on its own account: it was continued, or its worker went away. */
  pauseClosed(pauseId: string, reason: 'continue' | 'worker-lost'): void
  /** The run read its observation. */
  resultObserved(observed: ChromeExtensionObserved): void
  /** The surface or the test browser ended while the run lived. */
  surfaceEnded(): void
}

/** What the history's header names of the run, known once its declaration resolved. */
export type ExtensionHistoryIdentity = {
  extension: { id: string; name: string; version: string }
  surface: { kind: 'popup' | 'page'; path: string }
  declaredStops: readonly {
    index: number
    path: string
    line: number
    context: ExtensionStopContext
  }[]
  /** The Chrome that runs the extension, as `--version` reports it. */
  chromeVersion: string
}
