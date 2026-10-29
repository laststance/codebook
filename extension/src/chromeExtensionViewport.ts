import type {
  ChromeExtensionViewport,
  ExtensionViewportIdentity,
  FlatCdpConnection,
} from './chromeExtensionContracts'
import {
  EXTENSION_SCREENCAST_STOP_TIMEOUT_MS,
  EXTENSION_VIEW_PROVENANCE,
} from './constants'
import type {
  BrowserViewport,
  ScreencastCdp,
} from './runtimeSupport/browserViewport'
import { formatCapturedTime } from './runtimeSupport/utils/formatCapturedTime'
import { readScreencastFrame } from './runtimeSupport/utils/readScreencastFrame'
import type { ExtensionPaneState } from './runtimeSupport/utils/viewportHtml'

/** The members of {@link BrowserViewport} the extension view drives; a fake of exactly these runs it in tests. */
export type ExtensionPaneViewport = Pick<
  BrowserViewport,
  'attach' | 'present' | 'resume' | 'close' | 'setExtensionPane' | 'lastFrameAt'
>

/** What {@link ChromeExtensionViewportView} needs besides the pane it drives. */
export interface ChromeExtensionViewportOptions {
  /** Called once when the view reaches its last content (the run ended or failed before a surface): the owner then keeps the pane after the lease is released (ER22). */
  onFinal?: () => void
}

/**
 * Adapts one flat session of the owned browser's connection to the minimal connection {@link BrowserViewport.attach} needs (SR6).
 * Only events of that session reach the viewport (the frame's own `sessionId` is the acknowledgement number, not this session); every listener it added is removed by the returned `dispose`.
 * @param flat - The run's browser-level connection, shared with the executor and the debugger.
 * @param sessionId - The surface target's flat session.
 * @returns The connection for the viewport and the function that removes its listeners.
 * @example const { cdp, dispose } = flatSessionScreencast(flat, 'SESSION-1')
 */
function flatSessionScreencast(
  flat: FlatCdpConnection,
  sessionId: string,
): { cdp: ScreencastCdp; dispose: () => void } {
  const unsubscribers: (() => void)[] = []
  const cdp: ScreencastCdp = {
    on(method, listener) {
      const unsubscribe = flat.on(method, (params, eventSessionId) => {
        // The connection is the browser's: frames of any other target must never reach this pane.
        if (eventSessionId !== sessionId) return
        const frame = readScreencastFrame(params)
        if (frame) listener(frame)
      })
      unsubscribers.push(unsubscribe)
    },
    request: (method, params, timeoutMs) =>
      flat.request(method, params ?? {}, sessionId, timeoutMs),
    // The flat session delivers its events without a js-debug subscription.
    subscribe: async () => undefined,
  }
  return {
    cdp,
    dispose: (): void => {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
    },
  }
}

/**
 * The Application view of one chrome-extension run: header, preparing and failure texts, the surface's screencast, pinned pause frames, the lost and ended states (DR1–DR8, DR13, ER22).
 * Created by {@link StudyWorkspace}'s `createChromeExtensionViewport` over a leased pane; driven by the chrome-extension run, which calls exactly one of {@link surfaceLost} / {@link end} and then {@link close}.
 * @example
 * const view = new ChromeExtensionViewportView(browserViewport)
 * view.setIdentity({ manifestName: 'Notes', surface: { kind: 'popup', path: 'popup.html' }, clickTitles: ['Add'] })
 */
export class ChromeExtensionViewportView implements ChromeExtensionViewport {
  private identity?: ExtensionViewportIdentity
  private phase = 'Preparing the extension'
  private message = ''
  private detail = ''
  private dimmed = false
  private closed = false
  private flatSession?: {
    flat: FlatCdpConnection
    sessionId: string
    dispose: () => void
  }
  private readonly aborted = new AbortController()

  constructor(
    private readonly viewport: ExtensionPaneViewport,
    private readonly options: ChromeExtensionViewportOptions = {},
  ) {}

  setIdentity(identity: ExtensionViewportIdentity): void {
    this.identity = identity
    this.publish()
  }

  showPreparing(step: number, steps: number, sentence: string): void {
    this.message = `Preparing the extension · step ${step} of ${steps}: ${sentence}`
    this.publish()
  }

  async attachSurface(
    cdp: FlatCdpConnection,
    sessionId: string,
  ): Promise<void> {
    // Never the owned blank tab: only the surface's own flat session is shown.
    const adapter = flatSessionScreencast(cdp, sessionId)
    this.flatSession = { flat: cdp, sessionId, ...adapter }
    this.message = ''
    this.publish()
    await this.viewport.attach(
      adapter.cdp,
      this.aborted.signal,
      this.identity?.surface.kind === 'popup' ? 'popup' : 'page',
    )
  }

  setPhase(text: string): void {
    this.phase = text
    this.publish()
  }

  setAccessibleDetail(detail: string): void {
    this.detail = detail
    this.publish()
  }

  async pinPause(pngBase64: string, phaseText: string): Promise<void> {
    this.phase = phaseText
    this.publish()
    await this.viewport.present(pngBase64, 'paused-extension')
  }

  resumeLive(): void {
    this.viewport.resume()
  }

  showFailure(sentence: string, nextStep: string): void {
    this.message = `${sentence}\n${nextStep}`
    this.publish()
    this.options.onFinal?.()
  }

  surfaceLost(): void {
    this.dimmed = true
    this.phase =
      this.identity?.surface.kind === 'popup' ? 'Popup closed' : 'Page closed'
    this.stopScreencast()
    this.publish()
    // The dimmed last frame is the run's final view: the pane is kept after the run, as an ended run's is (ER22).
    this.options.onFinal?.()
  }

  end(resultLine: string): void {
    const capturedAt = this.viewport.lastFrameAt()
    this.phase =
      capturedAt === undefined
        ? 'Run ended · no view was captured'
        : `Run ended · last captured view ${formatCapturedTime(capturedAt)}`
    this.message = resultLine
    this.stopScreencast()
    this.publish()
    this.options.onFinal?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.stopScreencast()
    this.aborted.abort()
    this.viewport.close()
  }

  /** Removes the frame listeners and asks the browser to stop the screencast; the last frame stays painted. @example this.stopScreencast() */
  private stopScreencast(): void {
    const session = this.flatSession
    if (!session) return
    this.flatSession = undefined
    session.dispose()
    // The browser may already be gone: the view is final either way.
    void session.flat
      .request(
        'Page.stopScreencast',
        {},
        session.sessionId,
        EXTENSION_SCREENCAST_STOP_TIMEOUT_MS,
      )
      .catch(() => undefined)
  }

  /** Sends the pane's complete text state to the renderer; called after every change above. @example this.publish() */
  private publish(): void {
    const identity = this.identity
    const name = identity?.manifestName ?? 'extension'
    const isPopup = identity?.surface.kind !== 'page'
    const surfaceLabel = isPopup
      ? 'Extension popup'
      : `Extension page ${identity?.surface.path ?? ''}`
    const clicks = identity?.clickTitles.length
      ? `Declared clicks: ${identity.clickTitles.join('; ')}.`
      : ''
    const pane: ExtensionPaneState = {
      surface: isPopup ? 'popup' : 'page',
      title: `codebook · ${name} · ${surfaceLabel}`,
      phase: this.phase,
      provenance: EXTENSION_VIEW_PROVENANCE,
      message: this.message,
      imageAlt: `${surfaceLabel} of ${name}, captured from the test browser`,
      detail: [clicks, this.detail].filter(Boolean).join(' '),
      dimmed: this.dimmed,
    }
    this.viewport.setExtensionPane(pane)
  }
}
