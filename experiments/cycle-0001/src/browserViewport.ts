import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { Cdp } from './cdp';
import { FrameDelivery, type ViewFrame } from './frameDelivery';
import { ACTIVE_TIMEOUT_MS, CAPTURE_TIMEOUT_MS, STREAM_TELEMETRY_INTERVAL_MS, VIEWPORT_HEIGHT_PX, VIEWPORT_WIDTH_PX, type Scenario } from './constants';
import { sha256 } from './utils/sha256';
import { waitUntil } from './utils/waitUntil';
import { viewportHtml } from './utils/viewportHtml';

export interface ViewportLease { panel: vscode.WebviewPanel; released(): void }
export type BrowserViewportFactory = (runId: string, record: (type: string, detail?: unknown) => unknown, fail: (reason: string) => void, scenario: Scenario) => BrowserViewport;
export interface ViewportRecordingObserver {
  elapsedMs(): number;
  frame(input: { data: string; elapsedMs: number; kind: 'stream' | 'phase'; phase?: string; browserTimestamp?: number }): void;
  closed(input: { elapsedMs: number; expected: boolean }): void;
}

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
  private observerFailed = false;
  private observerClosed = false;
  private summaryAt = 0;
  private readonly liveCounts = new Map<string, number>();
  private missingReceipt?: { epoch: string; id: string };

  constructor(runId: string, private readonly record: (type: string, detail?: unknown) => unknown, private readonly fail: (reason: string) => void, private readonly scenario: Scenario, private readonly lease?: ViewportLease, private readonly observer?: ViewportRecordingObserver, private readonly mode: 'live' | 'recording' = 'live') {
    this.panel = lease?.panel ?? vscode.window.createWebviewPanel('codebook.scopedBrowser', `codebook ${runId.slice(0, 8)}`, vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
    this.delivery = new FrameDelivery(message => this.panel.webview.postMessage(message), (type, detail) => this.recordDelivery(type, detail));
    this.listeners.push(this.panel.onDidDispose(() => {
      this.closed = true;
      this.delivery.dispose();
      this.record('viewport.disposed', { expected: this.closing });
      this.closeObserver(this.closing);
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
      else if (message.type === 'missing-painted' && 'id' in message && typeof message.id === 'string' && this.mode === 'recording' && message.epoch === this.epoch) this.missingReceipt = { epoch: message.epoch, id: message.id };
    }));
    this.panel.webview.html = viewportHtml(this.mode);
  }

  /** Uses js-debug's selected-target event sharing, keeping Chrome ACKs independent from slow renderer delivery. @example await viewport.attach(cdp, signal) */
  async attach(cdp: Cdp, signal: AbortSignal): Promise<void> {
    if (this.observer) cdp.aggregateScreencastTelemetry(() => this.observerTime());
    cdp.on('Page.screencastFrame', frame => {
      if (this.closed) return;
      void cdp.request('Page.screencastFrameAck', { sessionId: frame.sessionId }, CAPTURE_TIMEOUT_MS).catch(error => this.record('viewport.stream-ack-failed', { error: String(error) }));
      this.observe(() => this.observer!.frame({ data: frame.data, elapsedMs: this.observer!.elapsedMs(), kind: 'stream', browserTimestamp: frame.metadata.timestamp }));
      this.latestLive = { data: frame.data, hash: sha256(Buffer.from(frame.data, 'base64')), phase: 'live', required: false, delayAck: false };
      if (this.observer) this.aggregateLive('viewport.stream-received');
      else this.record('viewport.stream-received', { hash: this.latestLive.hash, metadata: frame.metadata, sessionId: frame.sessionId, withheld: Boolean(this.pinnedPause) });
      if (this.epoch && !this.pinnedPause) this.offerLiveOrRestored(this.latestLive);
    });
    await cdp.subscribe(['Debugger.paused', 'Debugger.resumed', 'Page.screencastFrame']);
    signal.throwIfAborted();
    await cdp.request('Emulation.setDeviceMetricsOverride', { width: VIEWPORT_WIDTH_PX, height: VIEWPORT_HEIGHT_PX, deviceScaleFactor: 1, mobile: false });
    await cdp.request('Page.enable', undefined);
    await cdp.request('Page.startScreencast', { format: 'png', maxWidth: VIEWPORT_WIDTH_PX, maxHeight: VIEWPORT_HEIGHT_PX, everyNthFrame: 1 });
    await this.reveal(signal);
  }

  /** Observes explicit phase pixels at CDP response receipt, before disk/reveal delays; it grants no paint or pause confirmation. @example viewport.recordCapture(png, 'before') */
  recordCapture(data: string, phase: string): void { this.observe(() => this.observer!.frame({ data, phase, kind: 'phase', elapsedMs: this.observer!.elapsedMs() })); }

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
      this.panel.webview.html = viewportHtml(this.mode);
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
    this.closeObserver(true);
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
    this.historical = false; this.panel.webview.html = viewportHtml(this.mode); await this.reveal(signal);
  }

  /** Clears a superseded recorded presentation before a seek/pause can load another bundle; it has no debugger effect. @example viewport.clearRecorded() */
  clearRecorded(): void {
    if (this.mode !== 'recording' || this.closed) return;
    this.presentationRevision++; this.delivery.resume(); this.missingReceipt = undefined;
    if (this.epoch) void this.panel.webview.postMessage({ type: 'reset', epoch: this.epoch, clear: true });
  }

  /** Displays an explicit recorded gap with no substituted PNG or fabricated frame receipt. @example await viewport.presentMissing('Missing recorded interval') */
  async presentMissing(reason: string, signal?: AbortSignal): Promise<void> {
    if (this.mode !== 'recording' || this.closed || !this.epoch) throw new Error('Recorded viewport is not ready.');
    this.clearRecorded();
    const epoch = this.epoch, id = randomUUID(), revision = this.presentationRevision;
    if (!await this.panel.webview.postMessage({ type: 'missing', epoch, id, reason })) throw new Error('Recorded gap message was rejected.');
    await waitUntil(() => {
      if (revision !== this.presentationRevision || this.closed || epoch !== this.epoch) throw new Error('Recorded gap presentation invalidated.');
      return this.missingReceipt?.epoch === epoch && this.missingReceipt.id === id;
    }, 'recorded gap presentation', CAPTURE_TIMEOUT_MS, signal);
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
    void this.delivery.offer(frame).catch(error => this.recordDelivery('viewport.live-frame-unconfirmed', { phase: frame.phase, error: String(error) }));
  }

  /** Contains optional recorder exceptions so no failed observer can prevent input, rendering or cleanup. @example this.observe(() => observer.frame(frame)) */
  private observe(callback: () => void): void {
    if (!this.observer || this.observerFailed || this.observerClosed) return;
    try { callback(); } catch (error) { this.observerFailed = true; this.record('recording.observer-failed', { reason: String(error) }); }
  }

  /** Retires capture once without coupling asynchronous disk finalization to viewport ownership. @example this.closeObserver(true) */
  private closeObserver(expected: boolean): void {
    if (this.observerClosed) return;
    this.observe(() => this.observer!.closed({ elapsedMs: this.observer!.elapsedMs(), expected }));
    this.observerClosed = true; this.flushLiveSummary(true);
  }

  /** Keeps required phase receipts exact while aggregating disposable live delivery for recording-enabled runs. @example this.recordDelivery('viewport.sent', detail) */
  private recordDelivery(type: string, detail?: unknown): void {
    if (this.observer && detail && typeof detail === 'object' && 'phase' in detail && detail.phase === 'live') this.aggregateLive(type);
    else this.record(type, detail);
  }

  /** Accumulates only bounded live event names; sampled frame detail lives in the recording journal. @example this.aggregateLive('viewport.stream-received') */
  private aggregateLive(type: string): void { this.liveCounts.set(type, (this.liveCounts.get(type) ?? 0) + 1); this.flushLiveSummary(); }

  /** Flushes interval counts on frame traffic and close, preserving event-budget headroom for debugger facts. @example this.flushLiveSummary(true) */
  private flushLiveSummary(final = false): void {
    if (!this.observer || !this.liveCounts.size) return;
    const now = this.observerTime();
    if (!final && now - this.summaryAt < STREAM_TELEMETRY_INTERVAL_MS) return;
    this.record('viewport.live-summary', { sinceMs: this.summaryAt, untilMs: now, counts: Object.fromEntries(this.liveCounts) });
    this.summaryAt = now; this.liveCounts.clear();
  }

  /** Contains a broken optional telemetry clock; fallback zero is used only for aggregation, never frame receipts. @example this.observerTime() */
  private observerTime(): number {
    try { return this.observer?.elapsedMs() ?? 0; }
    catch (error) { if (!this.observerFailed) this.record('recording.observer-failed', { reason: String(error) }); this.observerFailed = true; return 0; }
  }
}
