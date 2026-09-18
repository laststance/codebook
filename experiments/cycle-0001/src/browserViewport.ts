import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { Cdp } from './cdp';
import { FrameDelivery, type ViewFrame } from './frameDelivery';
import { ACTIVE_TIMEOUT_MS, CAPTURE_TIMEOUT_MS, VIEWPORT_HEIGHT_PX, VIEWPORT_WIDTH_PX, type Scenario } from './constants';
import { sha256 } from './utils/sha256';
import { waitUntil } from './utils/waitUntil';
import { viewportHtml } from './utils/viewportHtml';

export interface ViewportLease { panel: vscode.WebviewPanel; released(): void }
export type BrowserViewportFactory = (runId: string, record: (type: string, detail?: unknown) => unknown, fail: (reason: string) => void, scenario: Scenario) => BrowserViewport;

/** Displays actual selected-page pixels for {@link HostBrowser}; it cannot select targets or resume the debugger. @example await viewport.attach(cdp, signal) */
export class BrowserViewport {
  private readonly panel: vscode.WebviewPanel;
  private readonly delivery: FrameDelivery;
  private epoch?: string;
  private readinessRequest = randomUUID();
  private presentationRevision = 0;
  private latestLive?: ViewFrame;
  private pinnedPause?: ViewFrame;
  private closed = false;
  private closing = false;
  private historical = false;
  private readonly listeners: vscode.Disposable[] = [];

  constructor(runId: string, private readonly record: (type: string, detail?: unknown) => unknown, private readonly fail: (reason: string) => void, private readonly scenario: Scenario, private readonly lease?: ViewportLease) {
    this.panel = lease?.panel ?? vscode.window.createWebviewPanel('codebook.scopedBrowser', `codebook ${runId.slice(0, 8)}`, vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
    this.delivery = new FrameDelivery(message => this.panel.webview.postMessage(message), record);
    this.listeners.push(this.panel.onDidDispose(() => {
      this.closed = true;
      this.delivery.dispose();
      this.record('viewport.disposed', { expected: this.closing });
      if (!this.closing) this.fail('Owned viewport closed before cleanup');
    }));
    this.listeners.push(this.panel.onDidChangeViewState(() => {
      if (!this.panel.visible) this.suspendRenderer();
      else this.requestReadiness();
    }));
    this.listeners.push(this.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (this.closed || this.historical) return;
      if (!message || typeof message !== 'object' || !('epoch' in message) || typeof message.epoch !== 'string' || !/^[\da-f-]{36}$/.test(message.epoch) || !('type' in message)) return;
      if (message.type === 'ready') {
        // Startup announces a renderer; only the current request can prove reveal readiness.
        if (!('requestId' in message)) { this.requestReadiness(); return; }
        if (!this.panel.visible || message.requestId !== this.readinessRequest || message.epoch === this.epoch) return;
        this.epoch = message.epoch;
        this.delivery.begin(message.epoch);
        this.record('viewport.ready', { epoch: this.epoch });
        const latest = this.pinnedPause ?? this.latestLive;
        if (latest) this.offerLiveOrRestored(latest);
      } else if (message.type === 'painted' && 'id' in message && typeof message.id === 'number') this.delivery.acknowledge(message.epoch, message.id);
    }));
    this.panel.webview.html = viewportHtml();
  }

  /** Uses js-debug's selected-target event sharing, keeping Chrome ACKs independent from slow renderer delivery. @example await viewport.attach(cdp, signal) */
  async attach(cdp: Cdp, signal: AbortSignal): Promise<void> {
    cdp.on('Page.screencastFrame', frame => {
      if (this.closed) return;
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
    if (this.historical) return;
    this.suspendRenderer();
    this.panel.reveal(this.lease ? undefined : vscode.ViewColumn.One, Boolean(this.lease));
    this.requestReadiness();
    await waitUntil(() => this.panel.visible && this.epoch, 'owned viewport ready', ACTIVE_TIMEOUT_MS, signal);
  }

  /** Pins and confirms the exact evidence PNG; required images bypass live coalescing. @example await viewport.present(png, 'paused-1') */
  async present(data: string, phase: string): Promise<{ epoch: string; id: number; hash: string }> {
    if (this.historical) throw new Error('Learner is viewing history; current capture was not displayed.');
    const revision = this.presentationRevision;
    if (phase.startsWith('paused') && this.scenario === 'viewport-close') { this.panel.dispose(); throw new Error('Owned viewport closed by injected fault'); }
    if (phase.startsWith('paused') && this.scenario === 'viewport-reload') {
      const oldEpoch = this.epoch;
      this.suspendRenderer();
      this.record('fault.viewport-reload', { oldEpoch });
      this.panel.webview.html = viewportHtml();
      await waitUntil(() => this.epoch && this.epoch !== oldEpoch, 'reloaded viewport epoch', CAPTURE_TIMEOUT_MS);
    }
    // Resume, termination or a newer stop can retire this presentation during renderer recreation.
    if (this.closed || revision !== this.presentationRevision) throw new Error('Viewport presentation invalidated');
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
    this.presentationRevision++;
    if (!this.pinnedPause || this.closed) return;
    this.pinnedPause = undefined;
    this.delivery.resume();
    if (this.epoch) void this.panel.webview.postMessage({ type: 'reset', epoch: this.epoch });
    if (this.latestLive) this.offerLiveOrRestored(this.latestLive);
  }

  /** Releases delivery/listeners during run cleanup, retaining leased readers and disposing only internally owned panels. @example viewport.close() */
  close(): void {
    if (this.closing && this.closed) return;
    this.closing = true;
    if (this.lease) {
      this.closed = true; this.delivery.dispose();
      for (const listener of this.listeners) listener.dispose();
      this.record('viewport.lease-released'); this.lease.released(); return;
    }
    this.panel.dispose();
    for (const listener of this.listeners) listener.dispose();
    if (!this.closed) throw new Error('Owned viewport disposal was not observed');
  }

  /** Pins learner-selected history without allowing hidden current frames to earn paint receipts. @example viewport.showHistory(capturedHtml) */
  showHistory(html: string): void {
    if (this.closed) throw new Error('Viewport lease is released');
    this.historical = true; this.presentationRevision++; this.suspendRenderer(); this.panel.webview.html = html;
  }

  /** Reconnects the same target presentation when the learner explicitly follows its current pause. @example await viewport.showLive(signal) */
  async showLive(signal: AbortSignal): Promise<void> {
    if (this.closed) throw new Error('Viewport lease is released');
    if (!this.historical) return;
    this.historical = false; this.panel.webview.html = viewportHtml(); await this.reveal(signal);
  }

  /** Invalidates readiness across hide, reveal and reload so old renderer messages cannot qualify. @example this.suspendRenderer() */
  private suspendRenderer(): void {
    this.epoch = undefined;
    this.readinessRequest = randomUUID();
    this.delivery.suspend();
  }

  /** Requests a correlated renderer response after visibility changes or startup. @example this.requestReadiness() */
  private requestReadiness(): void {
    if (this.closed || this.historical || !this.panel.visible) return;
    void Promise.resolve(this.panel.webview.postMessage({ type: 'requestReady', requestId: this.readinessRequest })).catch(error => this.record('viewport.ready-request-failed', { error: String(error) }));
  }

  /** Absorbs expected live coalescing while retaining delivery failure evidence. @example this.offerLiveOrRestored(frame) */
  private offerLiveOrRestored(frame: ViewFrame): void {
    void this.delivery.offer(frame).catch(error => this.record('viewport.live-frame-unconfirmed', { phase: frame.phase, error: String(error) }));
  }
}
