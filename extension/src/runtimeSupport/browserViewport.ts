import { randomUUID } from 'node:crypto'
// Explicit Node clock/timer bindings keep this module runnable in the viewport tests' vm context, which has no Node globals.
import { performance } from 'node:perf_hooks'
import { clearTimeout, setTimeout } from 'node:timers'

import * as vscode from 'vscode'

import { MILLISECONDS_PER_SECOND } from '../constants'
import { settledWithin } from '../utils/settledWithin'

import type { Cdp } from './cdp'
import {
  ACTIVE_TIMEOUT_MS,
  CAPTURE_TIMEOUT_MS,
  KEYBOARD_OWNER_ANSWER_TIMEOUT_MS,
  STREAM_TELEMETRY_INTERVAL_MS,
  VIEWPORT_HEIGHT_PX,
  VIEWPORT_WIDTH_PX,
  type Scenario,
} from './constants'
import { FrameDelivery, type ViewFrame } from './frameDelivery'
import { awaitResponse } from './utils/awaitResponse'
import { isStackFrameItem } from './utils/isStackFrameItem'
import { sha256 } from './utils/sha256'
import { unpaintedApplicationReason } from './utils/unpaintedApplicationReason'
import { ViewportAckTimeoutError } from './utils/viewportAckTimeoutError'
import { viewportHtml } from './utils/viewportHtml'
import { waitUntil } from './utils/waitUntil'

export interface ViewportLease {
  panel: vscode.WebviewPanel
  released(): void
  /**
   * Refuses unsafe native effects before asking the keyboard owner and again at {@link BrowserViewport.revealPanel}'s final reveal boundary.
   * @param panel - The actual current renderer, including an admitted replacement from {@link BrowserViewport.rebindPanel}.
   * @throws When the current panel, group or displayed tab no longer belongs to this presentation.
   * @example assertCanReveal(panel) // throws before a learner's replacement tab can be hidden
   */
  assertCanReveal?(panel: vscode.WebviewPanel): void
  /**
   * Asked right before the leased pane is revealed over the active text editor of its group ({@link BrowserViewport.coversActiveTextEditor}): the pane's owner says whether the pane is to come to the front without the keyboard. The owner knows what the viewport cannot read: whether the editor's debugger gave that editor the keyboard at a stop, whether it gave the keyboard back to whoever had it before the pause (a chat), whether the learner selected the frame in the Call Stack view, and whether the learner gave a sign of working in that editor, at a pause or while a session runs. The owner is asked before the reveal and not told after it, because a webview's focus cannot be awaited: it reaches the pane's frame some time after `reveal()` returned, and a focus command run right behind the reveal could be undone by it.
   * @returns `true` when the pane must not take the keyboard, `false` when it has to take it.
   */
  comesWithoutKeyboard?(): Promise<boolean>
  /** Called right after the leased pane took the keyboard from that editor, so the owner can tell the learner where it is. */
  tookKeyboardFromEditor?(): void
}
/**
 * Prepares an owned App viewport before {@link HostBrowser.launch} starts its debugger; asynchronous factories retain the run's cancellation signal.
 * @returns The ready viewport, directly or after native preparation completes.
 * @example const viewport = await createViewport(runId, record, fail, 'normal', signal)
 */
export type BrowserViewportFactory = (
  runId: string,
  record: (type: string, detail?: unknown) => unknown,
  fail: (reason: string) => void,
  scenario: Scenario,
  signal?: AbortSignal,
) => BrowserViewport | Promise<BrowserViewport>
export interface ViewportRecordingObserver {
  elapsedMs(): number
  frame(input: {
    data: string
    elapsedMs: number
    kind: 'stream' | 'phase'
    phase?: string
    browserTimestamp?: number
  }): void
  closed(input: { elapsedMs: number; expected: boolean }): void
}

/**
 * Tells {@link BrowserViewport.coversActiveTextEditor} whether a tab group shows the text editor that is the editor's active one.
 * @param group - The group that would be covered by the pane.
 * @returns `true` when the group's active tab is a text editor and the active text editor sits in the group's view column.
 * @example showsActiveTextEditor(vscode.window.tabGroups.activeTabGroup) // => false while the group's active tab is the Application pane
 */
function showsActiveTextEditor(group: vscode.TabGroup): boolean {
  return (
    group.activeTab?.input instanceof vscode.TabInputText &&
    vscode.window.activeTextEditor?.viewColumn === group.viewColumn
  )
}

/**
 * Tells {@link BrowserViewport.showsFocusingPause} whether the editor gives the paused file the keyboard focus at a breakpoint.
 * @returns Whether the effective `debug.focusEditorOnBreak` preference enables source keyboard focus.
 * @example isFocusEditorOnBreakOn() // => false with the normal Codebook default
 */
function isFocusEditorOnBreakOn(): boolean {
  return (
    vscode.workspace
      .getConfiguration('debug')
      .get<boolean>('focusEditorOnBreak') !== false
  )
}

/** Displays actual selected-page pixels for {@link HostBrowser}; it cannot select targets or resume the debugger. @example await viewport.attach(cdp, signal) */
export class BrowserViewport {
  private panel: vscode.WebviewPanel
  private readonly delivery: FrameDelivery
  private rendererVisible = true
  private paintElapsedMs = 0
  private paintStartedMs = performance.now()
  private epoch?: string
  private readinessRequest = randomUUID()
  private presentationRevision = 0
  private latestLive?: ViewFrame
  private pinnedPause?: ViewFrame
  private closed = false
  private closing = false
  private historical = false
  private historicalHtml?: string
  private rendererAttached = true
  private readonly listeners: vscode.Disposable[] = []
  private observerFailed = false
  private observerClosed = false
  private summaryAt = 0
  private readonly liveCounts = new Map<string, number>()
  private missingReceipt?: { epoch: string; id: string }
  private readonly gapWakers = new Set<() => void>()
  private readonly rendererOperations = new Set<Promise<unknown>>()
  private placement?: {
    released: Promise<void>
    ready: boolean
    release(): void
  }

  constructor(
    runId: string,
    private readonly record: (type: string, detail?: unknown) => unknown,
    private readonly fail: (reason: string) => void,
    private readonly scenario: Scenario,
    private readonly lease?: ViewportLease,
    private readonly observer?: ViewportRecordingObserver,
    private readonly mode: 'live' | 'recording' = 'live',
  ) {
    this.panel =
      lease?.panel ??
      vscode.window.createWebviewPanel(
        'codebook.scopedBrowser',
        `codebook ${runId.slice(0, 8)}`,
        vscode.ViewColumn.One,
        { enableScripts: true, localResourceRoots: [] },
      )
    this.delivery = new FrameDelivery(
      (message) => this.panel.webview.postMessage(message),
      (type, detail) => this.recordDelivery(type, detail),
      CAPTURE_TIMEOUT_MS,
      () => this.paintTime(),
    )
    this.bindPanel()
    this.panel.webview.html = viewportHtml(this.mode)
  }

  /** Binds only the current renderer for construction and {@link rebindPanel}; retired callbacks cannot close the session. @example this.bindPanel() */
  private bindPanel(): void {
    const panel = this.panel
    this.listeners.push(
      panel.onDidDispose(() => {
        if (panel !== this.panel || this.closed) return
        this.closed = true
        this.wakeGapWaits()
        // Current closure releases queued work; retired panels cannot release the replacement's hold.
        this.placement?.release()
        this.delivery.dispose()
        this.record('viewport.disposed', { expected: this.closing })
        this.closeObserver(this.closing)
        if (!this.closing) this.fail('Owned viewport closed before cleanup')
      }),
    )
    this.listeners.push(
      panel.onDidChangeViewState(() => {
        if (panel !== this.panel || this.closed) return
        if (!panel.visible) this.suspendRenderer()
        else this.requestReadiness()
      }),
    )
    this.listeners.push(
      panel.webview.onDidReceiveMessage((message: unknown) => {
        if (
          panel !== this.panel ||
          this.closed ||
          this.historical ||
          !this.rendererAttached
        )
          return
        if (
          !message ||
          typeof message !== 'object' ||
          !('epoch' in message) ||
          typeof message.epoch !== 'string' ||
          !/^[\da-f-]{36}$/.test(message.epoch) ||
          !('type' in message)
        )
          return
        if (message.type === 'ready') {
          // Startup announces a renderer; only the current request can prove reveal readiness.
          if (!('requestId' in message)) {
            this.requestReadiness()
            return
          }
          if (
            !this.panel.visible ||
            message.requestId !== this.readinessRequest ||
            message.epoch === this.epoch
          )
            return
          this.epoch = message.epoch
          this.wakeGapWaits()
          this.delivery.begin(message.epoch)
          this.setRendererVisibility(
            !('visibility' in message) || message.visibility !== 'hidden',
          )
          this.record('viewport.ready', { epoch: this.epoch })
          const latest = this.pinnedPause ?? this.latestLive
          if (latest && !this.placement) this.offerLiveOrRestored(latest)
        } else if (
          message.type === 'visibility' &&
          message.epoch === this.epoch &&
          'visibility' in message &&
          (message.visibility === 'visible' || message.visibility === 'hidden')
        ) {
          // Native panel visibility does not describe macOS occlusion of the inner document.
          this.setRendererVisibility(message.visibility === 'visible')
        } else if (
          message.type === 'frame-stage' &&
          message.epoch === this.epoch &&
          'id' in message &&
          typeof message.id === 'number' &&
          Number.isSafeInteger(message.id) &&
          'stage' in message &&
          typeof message.stage === 'string' &&
          [
            'received',
            'decoded',
            'decode-failed',
            'paint-queued',
            'first-frame',
          ].includes(message.stage) &&
          'visibility' in message &&
          (message.visibility === 'visible' ||
            message.visibility === 'hidden') &&
          'hasArea' in message &&
          typeof message.hasArea === 'boolean'
        ) {
          // Required-frame stages are private diagnostics only; they never authorize a painted receipt.
          this.record('viewport.frame-stage', {
            id: message.id,
            stage: message.stage,
            visibility: message.visibility,
            hasArea: message.hasArea,
          })
        }
        // A hidden recording document cannot have painted; its receipts are refused so only visible pixels confirm history. Live capture keeps wall-clock ACKs.
        else if (
          message.type === 'painted' &&
          'id' in message &&
          typeof message.id === 'number' &&
          (this.mode !== 'recording' || this.rendererVisible)
        )
          this.delivery.acknowledge(message.epoch, message.id)
        else if (
          message.type === 'missing-painted' &&
          'id' in message &&
          typeof message.id === 'string' &&
          this.mode === 'recording' &&
          this.rendererVisible &&
          message.epoch === this.epoch
        ) {
          this.missingReceipt = { epoch: message.epoch, id: message.id }
          this.wakeGapWaits()
        }
      }),
    )
  }

  /** Uses js-debug's selected-target event sharing, keeping Chrome ACKs independent from slow renderer delivery. @example await viewport.attach(cdp, signal) */
  async attach(cdp: Cdp, signal: AbortSignal): Promise<void> {
    if (this.observer)
      cdp.aggregateScreencastTelemetry(() => this.observerTime())
    cdp.on('Page.screencastFrame', (frame) => {
      if (this.closed) return
      void cdp
        .request(
          'Page.screencastFrameAck',
          { sessionId: frame.sessionId },
          CAPTURE_TIMEOUT_MS,
        )
        .catch((error) =>
          this.record('viewport.stream-ack-failed', { error: String(error) }),
        )
      this.observe(() =>
        this.observer!.frame({
          data: frame.data,
          elapsedMs: this.observer!.elapsedMs(),
          kind: 'stream',
          browserTimestamp: frame.metadata.timestamp,
        }),
      )
      this.latestLive = {
        data: frame.data,
        hash: sha256(Buffer.from(frame.data, 'base64')),
        phase: 'live',
        required: false,
        delayAck: false,
      }
      if (this.observer) this.aggregateLive('viewport.stream-received')
      else
        this.record('viewport.stream-received', {
          hash: this.latestLive.hash,
          metadata: frame.metadata,
          sessionId: frame.sessionId,
          withheld: Boolean(this.pinnedPause),
        })
      if (this.epoch && !this.pinnedPause && !this.placement)
        this.offerLiveOrRestored(this.latestLive)
    })
    await cdp.subscribe([
      'Debugger.paused',
      'Debugger.resumed',
      'Page.screencastFrame',
    ])
    signal.throwIfAborted()
    await cdp.request('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT_WIDTH_PX,
      height: VIEWPORT_HEIGHT_PX,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await cdp.request('Page.enable', undefined)
    await cdp.request('Page.startScreencast', {
      format: 'png',
      maxWidth: VIEWPORT_WIDTH_PX,
      maxHeight: VIEWPORT_HEIGHT_PX,
      everyNthFrame: 1,
    })
    await this.reveal(signal)
  }

  /** Observes explicit phase pixels at CDP response receipt, before disk/reveal delays; it grants no paint or pause confirmation. @example viewport.recordCapture(png, 'before') */
  recordCapture(data: string, phase: string): void {
    this.observe(() =>
      this.observer!.frame({
        data,
        phase,
        kind: 'phase',
        elapsedMs: this.observer!.elapsedMs(),
      }),
    )
  }

  /** Brings the owned viewport into view and awaits its renderer, called by preparation/completion. @example await viewport.reveal(signal) */
  reveal(signal: AbortSignal): Promise<void> {
    return this.withRenderer(() => this.revealNow(signal))
  }

  /** Reserves placement before draining required paints; {@link StudyWorkspace} releases it before post-move verification. @example const release = await viewport.holdPlacement(signal) */
  async holdPlacement(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    if (this.closed || this.placement)
      throw new Error('Viewport placement is unavailable.')
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const placement = {
      released,
      ready: false,
      release: (): void => {
        if (this.placement === placement) this.placement = undefined
        release()
      },
    }
    this.placement = placement
    try {
      // New required operations wait outside this set; already accepted paints drain before any native move.
      // A bounded drain rejects with its own cancellation error; surface the caller's abort reason instead.
      await awaitResponse(
        Promise.all([...this.rendererOperations]),
        'viewport placement drain',
        signal,
      ).catch((error: unknown) => {
        signal.throwIfAborted()
        throw error
      })
      signal.throwIfAborted()
      if (this.closed) throw new Error('Viewport closed before placement.')
      placement.ready = true
      return placement.release
    } catch (error) {
      placement.release()
      throw error
    }
  }

  /** Transfers a drained leased renderer for {@link StudyWorkspace} without ending CDP or recording; only the selected lease later paints. @example viewport.rebindPanel(replacement, signal) */
  rebindPanel(panel: vscode.WebviewPanel, signal: AbortSignal): void {
    signal.throwIfAborted()
    if (
      !this.lease ||
      this.closed ||
      this.closing ||
      !this.placement?.ready ||
      this.rendererOperations.size
    )
      throw new Error(
        'Viewport handoff requires a current drained lease placement.',
      )
    if (panel === this.panel) return
    // Drain -> retire old epoch/listeners -> bind replacement -> release -> confirm selected pixels.
    this.suspendRenderer()
    this.missingReceipt = undefined
    for (const listener of this.listeners.splice(0)) listener.dispose()
    this.panel = panel
    this.rendererAttached = false
    this.bindPanel()
    this.record('viewport.panel-rebound')
  }

  /** Reconfirms retained pixels after native relocation without recapturing the application; called outside the placement lock. @example await viewport.restorePlacement(signal) */
  async restorePlacement(signal: AbortSignal): Promise<void> {
    if (this.historical) {
      await this.withRenderer(async () => {
        signal.throwIfAborted()
        this.restorePanelContents()
      })
      return
    }
    await this.reveal(signal)
    signal.throwIfAborted()
    const retained = this.pinnedPause ?? this.latestLive
    if (retained)
      await this.withRenderer(() =>
        this.delivery.offer({ ...retained, required: true }),
      )
    signal.throwIfAborted()
  }

  /** Serializes admission against an owned move without holding the native layout lock during renderer ACKs. @example this.withRenderer(() => this.presentNow(data, phase)) */
  private withRenderer<Value>(operation: () => Promise<Value>): Promise<Value> {
    if (this.closed)
      return Promise.reject(new Error('Owned viewport is closed'))
    if (this.placement)
      return this.placement.released.then(() => this.withRenderer(operation))
    const pending = operation()
    this.rendererOperations.add(pending)
    return pending.finally(() => this.rendererOperations.delete(pending))
  }

  /** Performs an admitted reveal after {@link withRenderer} has excluded native placement. @example await this.revealNow(signal) */
  private async revealNow(signal: AbortSignal): Promise<void> {
    this.throwIfClosed()
    if (this.historical) return
    signal.throwIfAborted()
    this.restorePanelContents()
    this.suspendRenderer()
    // Refresh a visible renderer without reselecting its native tab over the learner's Study focus.
    if (!this.panel.visible) {
      // Already unsafe ownership cannot authorize an asynchronous focus return before final admission refuses it.
      this.assertLeaseAllowsReveal()
      const takesKeyboard = this.takesKeyboardAtReveal()
      // Only an owner that was asked is waited for: every other reveal stays in this turn.
      if (typeof takesKeyboard === 'boolean') this.revealPanel(takesKeyboard)
      else await this.revealPanelOnceOwnerAnswered(takesKeyboard, signal)
    }
    this.requestReadiness()
    await waitUntil(
      () => this.panel.visible && this.epoch,
      'owned viewport ready',
      ACTIVE_TIMEOUT_MS,
      signal,
    )
  }

  /**
   * Refuses work on a viewport whose lease was released or whose panel is gone; called by {@link revealNow} before it touches the panel and by {@link revealPanel} after the owner was asked.
   * @throws "Owned viewport is closed" once {@link close} ran.
   * @example this.throwIfClosed()
   */
  private throwIfClosed(): void {
    if (this.closed) throw new Error('Owned viewport is closed')
  }

  /**
   * Decides whether the pane takes the keyboard when {@link revealNow} brings it to the front; called once before each reveal.
   * A leased pane leaves the keyboard where it is, except over a text editor that has it: hiding that editor would leave the keyboard on no element. Whether the active text editor of the pane's group has it is the owner's to say ({@link ViewportLease.comesWithoutKeyboard}), so the owner is asked whenever the pane would cover that editor ({@link coversActiveTextEditor}), at a pause and while a session runs. Without an owner to ask, the viewport judges by what it can read itself ({@link showsFocusingPause}).
   * @returns
   * - `false` at once when the pane covers no active text editor.
   * - At once what {@link showsFocusingPause} says, when the lease has no owner to ask.
   * - Otherwise a promise of whether the pane has to take the keyboard by the owner's answer ({@link takesKeyboardByOwnersAnswer}).
   * @example const takesKeyboard = this.takesKeyboardAtReveal()
   */
  private takesKeyboardAtReveal(): boolean | Promise<boolean> {
    if (!this.coversActiveTextEditor()) return false
    const asked = this.lease?.comesWithoutKeyboard?.()
    if (!asked) return this.showsFocusingPause()
    return this.takesKeyboardByOwnersAnswer(asked)
  }

  /**
   * Waits for the owner's answer about the keyboard, for at most {@link KEYBOARD_OWNER_ANSWER_TIMEOUT_MS}; the step of {@link takesKeyboardAtReveal} for a lease whose owner was asked.
   * @param asked - The owner's pending answer: `true` when the pane is to come without the keyboard.
   * @returns `false` when the owner answered in time that the pane must not take the keyboard, and `true` when it answered that the pane has to take it. When its answer failed or did not come within the bound, what the viewport reads itself ({@link showsFocusingPause}), `true` at a pause that gave the covered file the keyboard: the reveal then goes on as if the keyboard had been given to nobody, so that one command the editor does not answer cannot hold the reveal and every placement behind it.
   * @example return this.takesKeyboardByOwnersAnswer(asked)
   */
  private async takesKeyboardByOwnersAnswer(
    asked: Promise<boolean>,
  ): Promise<boolean> {
    // An owner that fails or stays silent leaves the viewport's own reading: only a pause that focused the covered file makes the pane take the keyboard.
    let keepsKeyboard = !this.showsFocusingPause()
    await settledWithin(
      asked.then(
        (keeps) => {
          keepsKeyboard = keeps
        },
        () => undefined,
      ),
      KEYBOARD_OWNER_ANSWER_TIMEOUT_MS,
    )
    return !keepsKeyboard
  }

  /**
   * Brings the pane to the front once its owner answered about the keyboard, unless the reveal was called off meanwhile; the step of {@link revealNow} for a reveal that had to ask.
   * @param takesKeyboard - What {@link takesKeyboardAtReveal} is waiting for.
   * @param signal - The reveal's cancellation.
   * @throws The signal's reason when the reveal was aborted while its owner was asked: the pane then stays as it is, takes no keyboard and tells nothing. "Owned viewport is closed" when the viewport was closed meanwhile.
   * @example await this.revealPanelOnceOwnerAnswered(takesKeyboard, signal)
   */
  private async revealPanelOnceOwnerAnswered(
    takesKeyboard: Promise<boolean>,
    signal: AbortSignal,
  ): Promise<void> {
    const takes = await takesKeyboard
    signal.throwIfAborted()
    this.revealPanel(takes)
  }

  /**
   * Brings the pane to the front of its group for {@link revealNow}, with or without the keyboard, and tells the lease's owner when the pane took it.
   * A pane without a lease is the run's own tab in the first group and takes the focus as before.
   * @param takesKeyboard - What {@link takesKeyboardAtReveal} answered.
   * @throws "Owned viewport is closed" when the viewport was closed while its owner was asked.
   * @example this.revealPanel(false) // a leased pane comes to the front and the keyboard stays where it is
   */
  private revealPanel(takesKeyboard: boolean): void {
    this.throwIfClosed()
    if (!this.lease) {
      this.panel.reveal(vscode.ViewColumn.One, false)
      return
    }
    // This rejection stays outside the boolean owner's fallback and leaves no await before the native effect.
    this.assertLeaseAllowsReveal()
    this.panel.reveal(this.panel.viewColumn, !takesKeyboard)
    if (takesKeyboard) this.lease.tookKeyboardFromEditor?.()
  }

  /**
   * Checks the current lease for {@link revealNow} before asking its keyboard owner and for {@link revealPanel} immediately before the native effect.
   * @throws The owner's refusal when the current panel or group is no longer safe to reveal.
   * @example this.assertLeaseAllowsReveal() // refuses before covering a learner's newer tab
   */
  private assertLeaseAllowsReveal(): void {
    this.lease?.assertCanReveal?.(this.panel)
  }

  /**
   * Says whether revealing the leased pane would hide the active text editor; called by {@link takesKeyboardAtReveal}.
   * Cursor can report the paused text editor while its active tab group still names the chat's separate editor part. Resolve the group from the active text editor itself: hiding that editor without asking the owner can leave the keyboard on the document body.
   * @returns `true` while the window is focused and the pane's group shows the active text editor.
   * @example if (!this.coversActiveTextEditor()) return false
   */
  private coversActiveTextEditor(): boolean {
    const column = vscode.window.activeTextEditor?.viewColumn
    // No text editor can lose its keyboard to this reveal while none is active.
    if (column === undefined) return false
    const group = vscode.window.tabGroups.all.find(
      (candidate) => candidate.viewColumn === column,
    )
    return (
      group !== undefined &&
      this.isFocusedPaneGroup(group) &&
      showsActiveTextEditor(group)
    )
  }

  /**
   * Says whether the editor's debugger gave the file of the frame it shows the keyboard, as far as the viewport can read it; the judgment of {@link takesKeyboardAtReveal} for a lease without an owner, and of {@link takesKeyboardByOwnersAnswer} for an owner that does not answer.
   * The viewport cannot tell an editor that holds the keyboard from one that is merely the active editor while the learner types in a side-view chat (VS Code's, and Cursor's Agent pane in the secondary side bar). At a pause the debugger gave the paused file the keyboard, whoever had it before. A pause is told by a frame only ({@link isStackFrameItem}): once the session runs again the editor reports its thread. What the learner did since (a frame selected in the Call Stack view, a click into a file) only the lease's owner knows.
   * @returns `true` only while Run and Debug's active stack item is a frame and `debug.focusEditorOnBreak` is not turned off.
   * @example if (!asked) return this.showsFocusingPause()
   */
  private showsFocusingPause(): boolean {
    return (
      isStackFrameItem(vscode.debug.activeStackItem) && isFocusEditorOnBreakOn()
    )
  }

  /**
   * Tells {@link coversActiveTextEditor} whether the text editor's group is the leased pane's own, in a window that has the focus.
   * @param group - The group containing the active text editor.
   * @returns `true` when the window is focused and the group sits in the pane's view column.
   * @example this.isFocusedPaneGroup(vscode.window.tabGroups.activeTabGroup) // => false while another window has the focus
   */
  private isFocusedPaneGroup(group: vscode.TabGroup): boolean {
    return (
      vscode.window.state.focused && group.viewColumn === this.panel.viewColumn
    )
  }

  /** Pins and confirms the exact evidence PNG; required images bypass live coalescing. @example await viewport.present(png, 'paused-1') */
  present(
    data: string,
    phase: string,
  ): Promise<{ epoch: string; id: number; hash: string }> {
    return this.withRenderer(() => this.presentNow(data, phase))
  }

  /** Offers one admitted evidence image while {@link holdPlacement} drains its exact receipt. @example await this.presentNow(png, 'paused-1') */
  private async presentNow(
    data: string,
    phase: string,
  ): Promise<{ epoch: string; id: number; hash: string }> {
    if (this.historical)
      throw new Error(
        'Learner is viewing history; current capture was not displayed.',
      )
    const revision = this.presentationRevision
    if (phase.startsWith('paused') && this.scenario === 'viewport-close') {
      this.panel.dispose()
      throw new Error('Owned viewport closed by injected fault')
    }
    if (phase.startsWith('paused') && this.scenario === 'viewport-reload') {
      const oldEpoch = this.epoch
      this.suspendRenderer()
      this.record('fault.viewport-reload', { oldEpoch })
      this.panel.webview.html = viewportHtml(this.mode)
      await waitUntil(
        () => this.epoch && this.epoch !== oldEpoch,
        'reloaded viewport epoch',
        CAPTURE_TIMEOUT_MS,
      )
    }
    // Resume, termination or a newer stop can retire this presentation during renderer recreation.
    if (this.closed || revision !== this.presentationRevision)
      throw new Error('Viewport presentation invalidated')
    const frame: ViewFrame = {
      data,
      hash: sha256(Buffer.from(data, 'base64')),
      phase,
      required: true,
      delayAck:
        phase.startsWith('paused') && this.scenario === 'viewport-timeout',
    }
    if (phase.startsWith('paused')) {
      this.pinnedPause = frame
      this.delivery.freeze()
      if (this.epoch)
        void this.panel.webview.postMessage({
          type: 'reset',
          epoch: this.epoch,
        })
    }
    if (frame.delayAck) this.record('fault.viewport-ack-delayed', { phase })
    // A replay keeps the delivery's own reason, which its same-frame retry reads.
    if (this.mode === 'recording') return this.delivery.offer(frame)
    // A live run ends with this capture, so its reason says what was observed and what the reader does next.
    return this.delivery.offer(frame).catch((error: unknown) => {
      if (!(error instanceof ViewportAckTimeoutError)) throw error
      throw new Error(
        unpaintedApplicationReason(
          CAPTURE_TIMEOUT_MS / MILLISECONDS_PER_SECOND,
        ),
      )
    })
  }

  /** Retires pause presentation before DAP continuation and invalidates delayed renderer work. @example viewport.resume() */
  resume(): void {
    this.presentationRevision++
    if (!this.pinnedPause || this.closed) return
    this.pinnedPause = undefined
    this.delivery.resume()
    if (this.epoch)
      void this.panel.webview.postMessage({ type: 'reset', epoch: this.epoch })
    if (this.latestLive) this.offerLiveOrRestored(this.latestLive)
  }

  /** Releases delivery/listeners during run cleanup, retaining leased readers and disposing only internally owned panels. @example viewport.close() */
  close(): void {
    if (this.closing && this.closed) return
    this.closing = true
    this.placement?.release()
    this.closeObserver(true)
    if (this.lease) {
      this.closed = true
      this.delivery.dispose()
      this.wakeGapWaits()
      for (const listener of this.listeners) listener.dispose()
      this.record('viewport.lease-released')
      this.lease.released()
      return
    }
    this.panel.dispose()
    for (const listener of this.listeners) listener.dispose()
    if (!this.closed)
      throw new Error('Owned viewport disposal was not observed')
  }

  /** Pins learner-selected history without allowing hidden current frames to earn paint receipts. @example viewport.showHistory(capturedHtml) */
  showHistory(html: string): void {
    if (this.closed) throw new Error('Viewport lease is released')
    this.historical = true
    this.historicalHtml = html
    this.presentationRevision++
    this.suspendRenderer()
    this.panel.webview.html = html
    this.rendererAttached = true
  }

  /**
   * Keeps the restore copy of the shown history current without writing the document again: a test replay's later moments reach its document as messages (EN3), and a replacement panel restores this copy ({@link restorePanelContents}). Called by the Study workspace after each posted moment; nothing happens while the viewport is live or released.
   * @param html - The history's document at its latest moment.
   * @example viewport.updateHistory(capturedAppHtml(message))
   */
  updateHistory(html: string): void {
    if (this.closed || !this.historical) return
    this.historicalHtml = html
  }

  /** Reconnects the same target presentation when the learner explicitly follows its current pause. @example await viewport.showLive(signal) */
  async showLive(signal: AbortSignal): Promise<void> {
    if (this.closed) throw new Error('Viewport lease is released')
    // A refused placement can leave the selected live lease on an empty replacement; refresh content without revealing its tab.
    if (!this.historical) {
      signal.throwIfAborted()
      this.restorePanelContents()
      return
    }
    this.historical = false
    this.historicalHtml = undefined
    this.panel.webview.html = viewportHtml(this.mode)
    this.rendererAttached = true
    await this.reveal(signal)
  }

  /** Clears a superseded recorded presentation before a seek/pause can load another bundle; it has no debugger effect. @example viewport.clearRecorded() */
  clearRecorded(): void {
    if (this.mode !== 'recording' || this.closed) return
    this.presentationRevision++
    this.delivery.resume()
    this.missingReceipt = undefined
    this.wakeGapWaits()
    if (this.epoch)
      void this.panel.webview.postMessage({
        type: 'reset',
        epoch: this.epoch,
        clear: true,
      })
  }

  /** Displays an explicit recorded gap with no substituted PNG or fabricated frame receipt. @example await viewport.presentMissing('Missing recorded interval') */
  presentMissing(reason: string, signal?: AbortSignal): Promise<void> {
    return this.withRenderer(() => this.presentMissingNow(reason, signal))
  }

  /** Confirms a recorded gap within an admitted renderer operation, so placement cannot interrupt its ACK. @example await this.presentMissingNow('Missing interval', signal) */
  private async presentMissingNow(
    reason: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.mode !== 'recording' || this.closed || !this.epoch)
      throw new Error('Recorded viewport is not ready.')
    this.clearRecorded()
    const epoch = this.epoch,
      id = randomUUID(),
      revision = this.presentationRevision
    if (
      !(await this.panel.webview.postMessage({
        type: 'missing',
        epoch,
        id,
        reason,
      }))
    )
      throw new Error('Recorded gap message was rejected.')
    const deadlineMs = this.paintTime() + CAPTURE_TIMEOUT_MS
    // The explicit visible-time deadline bounds painting; revision/closure/epoch, and an optional AbortSignal, release hidden waits.
    for (;;) {
      signal?.throwIfAborted()
      if (
        revision !== this.presentationRevision ||
        this.closed ||
        epoch !== this.epoch
      )
        throw new Error('Recorded gap presentation invalidated.')
      if (this.missingReceipt?.epoch === epoch && this.missingReceipt.id === id)
        return
      const remainingMs = deadlineMs - this.paintTime()
      if (remainingMs <= 0)
        throw new Error('Timed out waiting for recorded gap presentation')
      // A hidden document cannot paint, so it sleeps without polling until a receipt, visibility or ownership change wakes it.
      await this.gapChange(
        this.rendererVisible ? remainingMs : undefined,
        signal,
      )
    }
  }

  /**
   * Resolves on the next {@link wakeGapWaits}, after `timeoutMs` of wall time when given, or on abort; {@link presentMissingNow} rechecks its state after each.
   * @param timeoutMs - Remaining visible paint budget, or `undefined` while the recording document is hidden.
   * @param signal - Optional caller cancellation.
   * @example await this.gapChange(this.rendererVisible ? remainingMs : undefined, signal)
   */
  private gapChange(
    timeoutMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const wake = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', wake)
        this.gapWakers.delete(wake)
        resolve()
      }
      if (timeoutMs !== undefined) timer = setTimeout(wake, timeoutMs)
      this.gapWakers.add(wake)
      signal?.addEventListener('abort', wake, { once: true })
    })
  }

  /** Wakes every pending {@link gapChange} after a gap receipt, renderer visibility, epoch, revision or closure change. @example this.wakeGapWaits() */
  private wakeGapWaits(): void {
    for (const wake of [...this.gapWakers]) wake()
  }

  /** Invalidates readiness across hide, reveal and reload so old renderer messages cannot qualify. @example this.suspendRenderer() */
  private suspendRenderer(): void {
    this.epoch = undefined
    this.wakeGapWaits()
    this.readinessRequest = randomUUID()
    this.delivery.suspend()
    // No current visibility receipt means an unresponsive replacement must retain a bounded timeout.
    this.setRendererVisibility(true)
  }

  /** Supplies {@link FrameDelivery} and gap paints with monotonic available time; live capture retains its wall-clock deadline. @example const deadline = this.paintTime() + CAPTURE_TIMEOUT_MS */
  private paintTime(): number {
    if (this.mode !== 'recording') return performance.now()
    return (
      this.paintElapsedMs +
      (this.rendererVisible ? performance.now() - this.paintStartedMs : 0)
    )
  }

  /**
   * Switches the recording paint clock between visible and hidden time; changes preserve consumed paint budget and never ACK pixels.
   *
   * {@link bindPanel} applies the current renderer's ready and visibility reports (a ready report without visibility counts as visible).
   * {@link suspendRenderer} resets it to visible so an unresponsive replacement renderer keeps a bounded deadline.
   *
   * @param visible - Whether the current recording document can paint.
   * @example this.setRendererVisibility(false)
   */
  private setRendererVisibility(visible: boolean): void {
    if (this.mode !== 'recording' || visible === this.rendererVisible) return
    this.paintElapsedMs = this.paintTime()
    this.paintStartedMs = performance.now()
    this.rendererVisible = visible
    this.delivery.refreshDeadlines()
    this.wakeGapWaits()
  }

  /** Rehydrates only an explicitly selected replacement after {@link rebindPanel}; background leases cannot overwrite replay. @example this.restorePanelContents() */
  private restorePanelContents(): void {
    if (this.rendererAttached) return
    if (this.historical) {
      if (this.historicalHtml === undefined)
        throw new Error('Historical viewport content is unavailable.')
      this.panel.webview.html = this.historicalHtml
    } else this.panel.webview.html = viewportHtml(this.mode)
    this.rendererAttached = true
  }

  /** Requests a correlated renderer response after visibility changes or startup. @example this.requestReadiness() */
  private requestReadiness(): void {
    if (
      this.closed ||
      this.historical ||
      !this.rendererAttached ||
      !this.panel.visible
    )
      return
    void Promise.resolve(
      this.panel.webview.postMessage({
        type: 'requestReady',
        requestId: this.readinessRequest,
      }),
    ).catch((error) =>
      this.record('viewport.ready-request-failed', { error: String(error) }),
    )
  }

  /** Absorbs expected live coalescing while retaining delivery failure evidence. @example this.offerLiveOrRestored(frame) */
  private offerLiveOrRestored(frame: ViewFrame): void {
    void this.delivery.offer(frame).catch((error) =>
      this.recordDelivery('viewport.live-frame-unconfirmed', {
        phase: frame.phase,
        error: String(error),
      }),
    )
  }

  /** Contains optional recorder exceptions so no failed observer can prevent input, rendering or cleanup. @example this.observe(() => observer.frame(frame)) */
  private observe(callback: () => void): void {
    if (!this.observer || this.observerFailed || this.observerClosed) return
    try {
      callback()
    } catch (error) {
      this.observerFailed = true
      this.record('recording.observer-failed', { reason: String(error) })
    }
  }

  /** Retires capture once without coupling asynchronous disk finalization to viewport ownership. @example this.closeObserver(true) */
  private closeObserver(expected: boolean): void {
    if (this.observerClosed) return
    this.observe(() =>
      this.observer!.closed({
        elapsedMs: this.observer!.elapsedMs(),
        expected,
      }),
    )
    this.observerClosed = true
    this.flushLiveSummary(true)
  }

  /** Keeps required phase receipts exact while aggregating disposable live delivery for recording-enabled runs. @example this.recordDelivery('viewport.sent', detail) */
  private recordDelivery(type: string, detail?: unknown): void {
    if (
      this.observer &&
      detail &&
      typeof detail === 'object' &&
      'phase' in detail &&
      detail.phase === 'live'
    )
      this.aggregateLive(type)
    else this.record(type, detail)
  }

  /** Accumulates only bounded live event names; sampled frame detail lives in the recording journal. @example this.aggregateLive('viewport.stream-received') */
  private aggregateLive(type: string): void {
    this.liveCounts.set(type, (this.liveCounts.get(type) ?? 0) + 1)
    this.flushLiveSummary()
  }

  /** Flushes interval counts on frame traffic and close, preserving event-budget headroom for debugger facts. @example this.flushLiveSummary(true) */
  private flushLiveSummary(final = false): void {
    if (!this.observer || !this.liveCounts.size) return
    const now = this.observerTime()
    if (!final && now - this.summaryAt < STREAM_TELEMETRY_INTERVAL_MS) return
    this.record('viewport.live-summary', {
      sinceMs: this.summaryAt,
      untilMs: now,
      counts: Object.fromEntries(this.liveCounts),
    })
    this.summaryAt = now
    this.liveCounts.clear()
  }

  /** Contains a broken optional telemetry clock; fallback zero is used only for aggregation, never frame receipts. @example this.observerTime() */
  private observerTime(): number {
    try {
      return this.observer?.elapsedMs() ?? 0
    } catch (error) {
      if (!this.observerFailed)
        this.record('recording.observer-failed', { reason: String(error) })
      this.observerFailed = true
      return 0
    }
  }
}
