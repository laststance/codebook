import * as vscode from 'vscode';
import type { Cdp } from './cdp';
import { FrameDelivery, type ViewFrame } from './frameDelivery';
import { ACTIVE_TIMEOUT_MS, CAPTURE_TIMEOUT_MS, VIEWPORT_HEIGHT_PX, VIEWPORT_WIDTH_PX, type Scenario } from './constants';
import { sha256 } from './utils/sha256';
import { waitUntil } from './utils/waitUntil';
import { viewportHtml } from './utils/viewportHtml';

/** Displays actual selected-page pixels for {@link HostBrowser}; it cannot select targets or resume the debugger. @example await viewport.attach(cdp, signal) */
export class BrowserViewport {
  private readonly panel: vscode.WebviewPanel;
  private readonly delivery: FrameDelivery;
  private epoch?: string;
  private latestLive?: ViewFrame;
  private pinnedPause?: ViewFrame;
  private closed = false;
  private closing = false;

  constructor(runId: string, private readonly record: (type: string, detail?: unknown) => unknown, private readonly fail: (reason: string) => void, private readonly scenario: Scenario) {
    this.panel = vscode.window.createWebviewPanel('codebook.scopedBrowser', `codebook ${runId.slice(0, 8)}`, vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
    this.delivery = new FrameDelivery(message => this.panel.webview.postMessage(message), record);
    this.panel.onDidDispose(() => {
      this.closed = true;
      this.delivery.dispose();
      this.record('viewport.disposed', { expected: this.closing });
      if (!this.closing) this.fail('Owned viewport closed before cleanup');
    });
    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== 'object' || !('epoch' in message) || typeof message.epoch !== 'string' || !/^[\da-f-]{36}$/.test(message.epoch) || !('type' in message)) return;
      if (message.type === 'ready') {
        this.epoch = message.epoch;
        this.delivery.begin(message.epoch);
        this.record('viewport.ready', { epoch: this.epoch });
        const latest = this.pinnedPause ?? this.latestLive;
        if (latest) this.offerLiveOrRestored(latest);
      } else if (message.type === 'painted' && 'id' in message && typeof message.id === 'number') this.delivery.acknowledge(message.epoch, message.id);
    });
    this.panel.webview.html = viewportHtml();
  }

  /** Uses js-debug's selected-target event sharing, keeping Chrome ACKs independent from slow renderer delivery. @example await viewport.attach(cdp, signal) */
  async attach(cdp: Cdp, signal: AbortSignal): Promise<void> {
    cdp.on('Page.screencastFrame', frame => {
      void cdp.request('Page.screencastFrameAck', { sessionId: frame.sessionId }, CAPTURE_TIMEOUT_MS).catch(error => this.record('viewport.stream-ack-failed', { error: String(error) }));
      this.latestLive = { data: frame.data, hash: sha256(Buffer.from(frame.data, 'base64')), phase: 'live', required: false, delayAck: false };
      this.record('viewport.stream-received', { hash: this.latestLive.hash, metadata: frame.metadata, sessionId: frame.sessionId, withheld: Boolean(this.pinnedPause) });
      if (this.epoch && !this.pinnedPause) this.offerLiveOrRestored(this.latestLive);
    });
    await cdp.subscribe(['Debugger.paused', 'Debugger.resumed', 'Page.screencastFrame']);
    signal.throwIfAborted();
    await cdp.request('Emulation.setDeviceMetricsOverride', { width: VIEWPORT_WIDTH_PX, height: VIEWPORT_HEIGHT_PX, deviceScaleFactor: 1, mobile: false });
    await cdp.request('Page.enable', undefined);
    await cdp.request('Page.startScreencast', { format: 'png', maxWidth: VIEWPORT_WIDTH_PX, maxHeight: VIEWPORT_HEIGHT_PX, everyNthFrame: 1 });
    await this.reveal(signal);
  }

  /** Brings the owned viewport into view and awaits its renderer, called by preparation/completion. @example await viewport.reveal(signal) */
  async reveal(signal: AbortSignal): Promise<void> {
    if (this.closed) throw new Error('Owned viewport is closed');
    this.panel.reveal(vscode.ViewColumn.One, false);
    await waitUntil(() => this.panel.visible && this.epoch, 'owned viewport ready', ACTIVE_TIMEOUT_MS, signal);
  }

  /** Pins and confirms the exact evidence PNG; required images bypass live coalescing. @example await viewport.present(png, 'paused-1') */
  async present(data: string, phase: string): Promise<{ epoch: string; id: number; hash: string }> {
    if (phase.startsWith('paused') && this.scenario === 'viewport-close') { this.panel.dispose(); throw new Error('Owned viewport closed by injected fault'); }
    if (phase.startsWith('paused') && this.scenario === 'viewport-reload') {
      const oldEpoch = this.epoch;
      this.epoch = undefined;
      this.record('fault.viewport-reload', { oldEpoch });
      this.panel.webview.html = viewportHtml();
      await waitUntil(() => this.epoch && this.epoch !== oldEpoch, 'reloaded viewport epoch', CAPTURE_TIMEOUT_MS);
    }
    const frame: ViewFrame = { data, hash: sha256(Buffer.from(data, 'base64')), phase, required: true, delayAck: phase.startsWith('paused') && this.scenario === 'viewport-timeout' };
    if (phase.startsWith('paused')) {
      this.pinnedPause = frame;
      this.delivery.freeze();
      if (this.epoch) void this.panel.webview.postMessage({ type: 'reset', epoch: this.epoch });
    }
    if (frame.delayAck) this.record('fault.viewport-ack-delayed', { phase });
    return this.delivery.offer(frame);
  }

  /** Retires pause presentation before DAP continuation and invalidates delayed renderer work. @example viewport.resume() */
  resume(): void {
    if (!this.pinnedPause || this.closed) return;
    this.pinnedPause = undefined;
    this.delivery.resume();
    if (this.epoch) void this.panel.webview.postMessage({ type: 'reset', epoch: this.epoch });
    if (this.latestLive) this.offerLiveOrRestored(this.latestLive);
  }

  /** Disposes only the owned panel during run cleanup; transport closure remains the coordinator's job. @example viewport.close() */
  close(): void {
    this.closing = true;
    this.panel.dispose();
    if (!this.closed) throw new Error('Owned viewport disposal was not observed');
  }

  /** Absorbs expected live coalescing while retaining delivery failure evidence. @example this.offerLiveOrRestored(frame) */
  private offerLiveOrRestored(frame: ViewFrame): void {
    void this.delivery.offer(frame).catch(error => this.record('viewport.live-frame-unconfirmed', { phase: frame.phase, error: String(error) }));
  }
}
