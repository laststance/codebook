import * as vscode from 'vscode';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { DebugProtocol } from '@vscode/debugprotocol';
import type { Protocol } from 'devtools-protocol';
import { Cdp } from './cdp';
import { ACTIVE_TIMEOUT_MS, CAPTURE_TIMEOUT_MS, EXPECTED_VALUES, FOCUS_ATTEMPT_LIMIT, INJECTED_DELAY_MS, INTERFERENCE_DELAY_MS, RESUME_COMMANDS, RUN_TIMEOUT_MS, WATCHDOG_INTERVAL_MS, type Scenario } from './constants';
import { Evidence } from './evidence';
import { inspectPause, type SealedSource, type Snapshot } from './inspect';
import { PauseGate, type PauseIdentity } from './pauseGate';
import { sha256 } from './utils/sha256';
import { waitUntil } from './utils/waitUntil';
import { awaitResponse } from './utils/awaitResponse';
import { HostBrowser, type HostConfiguration } from './hostBrowser';
import { settleCleanup } from './utils/settleCleanup';

export interface HarnessConfig {
  artifactRoot: string;
  templateRoot: string;
  fixtureOrigin: string;
  descriptorPath: string;
  revision: string;
  workingTreeDirty: boolean;
  sourceHash: string;
  extensionHash: string;
  host: HostConfiguration;
}
interface Capture {
  phase: string;
  generation?: number;
  requestSequence: number;
  responseSequence?: number;
  status: 'pending' | 'captured' | 'failed';
  file?: string;
  error?: string;
}
interface Operation {
  id: string;
  key: string;
  inputAcknowledged: boolean;
  completed: boolean;
}

/** Owns one fixed-fixture experiment; HTTP delegates operations while DAP/CDP independently report evidence. @example const run = new ExperimentRun(config, 'normal'); await run.prepare() */
export class ExperimentRun {
  readonly id = randomUUID();
  readonly gate = new PauseGate();
  readonly evidence: Evidence;
  readonly url: string;
  readonly sessions = new Map<string, vscode.DebugSession>();
  readonly captures: Record<string, Capture> = {};
  readonly failures: string[] = [];
  readonly snapshots: Snapshot[] = [];
  readonly startedMs = performance.now();
  status = 'preparing';
  selected?: vscode.DebugSession;
  operation?: Operation;
  source?: SealedSource;
  breakpoint?: vscode.SourceBreakpoint;
  binding?: vscode.DebugProtocolBreakpoint;
  cdp?: Cdp;
  snapshot?: Snapshot;
  observed?: { cartCount: number; completedClicks: number };
  private cdpPause?: Protocol.Debugger.PausedEvent;
  private pausedAtMs?: number;
  private pausedDurationMs = 0;
  private expectedResumeRequests = 0;
  private expectedContinuation?: PauseIdentity;
  private cleaning = false;
  private cleanupComplete = false;
  private cleanupPromise?: Promise<void>;
  private preparePromise?: Promise<void>;
  private readonly abort = new AbortController();
  private readonly browser: HostBrowser;
  private readonly activities = new Set<Promise<void>>();
  private readonly activeSessionIds = new Set<string>();
  private readonly watchdog: ReturnType<typeof setInterval>;

  constructor(readonly config: HarnessConfig, readonly scenario: Scenario) {
    this.evidence = new Evidence(join(config.artifactRoot, this.id));
    this.url = `${config.fixtureOrigin}/runs/${this.id}/index.html`;
    this.browser = new HostBrowser(config.host, this.id, this.url, (type, detail) => this.evidence.record(type, detail), scenario);
    this.watchdog = setInterval(() => {
      if (this.cleaning || ['completed', 'failed'].includes(this.status)) return;
      const elapsedMs = performance.now() - this.startedMs;
      const pausedMs = this.pausedDurationMs + (this.pausedAtMs === undefined ? 0 : performance.now() - this.pausedAtMs);
      if (elapsedMs > RUN_TIMEOUT_MS || elapsedMs - pausedMs > ACTIVE_TIMEOUT_MS) this.fail(`Watchdog exceeded ${elapsedMs > RUN_TIMEOUT_MS ? 'whole-run' : 'active'} deadline; no input retry or automatic resume`);
    }, WATCHDOG_INTERVAL_MS);
  }

  /** Recognizes the run by an owned ancestor before the selected child exists. @example run.owns(unrelatedSession) // false */
  owns(session: vscode.DebugSession): boolean {
    let ancestor: vscode.DebugSession | undefined = session;
    while (ancestor) {
      if (ancestor.configuration.name === `codebook ${this.id}`) return true;
      ancestor = ancestor.parentSession;
    }
    return false;
  }

  /** Records only owned sessions when the extension's pre-registered tracker starts. @example run.addSession(child) */
  addSession(session: vscode.DebugSession): void {
    this.sessions.set(session.id, session);
    this.activeSessionIds.add(session.id);
    this.evidence.record('session.started', { sessionId: session.id, parentId: session.parentSession?.id, type: session.type, name: session.name });
    // A non-cancellable launch may report a session after its request or cleanup deadline.
    if (this.cleaning) this.track(Promise.resolve(vscode.debug.stopDebugging(session)));
  }

  /** Seals fixture bytes, launches the real integrated browser, then resolves its child by ancestry and URL. @example await run.prepare() */
  async prepare(): Promise<void> {
    this.preparePromise ??= this.prepareOwned();
    await this.preparePromise;
  }

  /** Acquires this run's fixture/debug resources once, called by {@link prepare}. @example await this.prepareOwned() */
  private async prepareOwned(): Promise<void> {
    await this.evidence.initialize();
    this.evidence.record('run.created', { runId: this.id, scenario: this.scenario });
    for (const directory of ['fixture', 'build']) await mkdir(join(this.evidence.directory, directory));
    const source = await readFile(join(this.config.templateRoot, 'fixture/cart.ts'), 'utf8');
    const javascript = await readFile(join(this.config.templateRoot, 'build/cart.js'), 'utf8');
    const sourceMap = await readFile(join(this.config.templateRoot, 'build/cart.js.map'), 'utf8');
    const sourcePath = join(this.evidence.directory, 'fixture/cart.ts');
    const breakpointLine = source.split('\n').findIndex(line => line.includes('CODEBOOK_BREAKPOINT')) + 1;
    if (!breakpointLine) throw new Error('Fixture breakpoint marker is missing');
    this.source = { sourcePath, source, javascript, sourceMap, breakpointLine };
    await writeFile(sourcePath, source);
    await writeFile(join(this.evidence.directory, 'build/cart.js'), javascript);
    await writeFile(join(this.evidence.directory, 'build/cart.js.map'), sourceMap);
    await writeFile(join(this.evidence.directory, 'build/served.js'), javascript + (this.scenario === 'stale-script' ? '\n// Deliberate stale deployment: different executable bytes.\n' : ''));
    const html = await readFile(join(this.config.templateRoot, 'fixture/index.html'), 'utf8');
    await writeFile(join(this.evidence.directory, 'index.html'), html.replace('codebook • one cart action', `codebook ${this.id.slice(0, 8)}`));
    const breakpointSource = this.scenario === 'unbound' ? join(this.evidence.directory, 'fixture/never-loaded.ts') : sourcePath;
    if (this.scenario === 'unbound') await writeFile(breakpointSource, source);
    this.abort.signal.throwIfAborted();
    // Keep the browser mounted when the debugger reveals this exact source on a stop.
    await vscode.window.showTextDocument(vscode.Uri.file(sourcePath), { viewColumn: vscode.ViewColumn.Two, preview: false, preserveFocus: true });
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    this.abort.signal.throwIfAborted();
    this.breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(breakpointSource), new vscode.Position(breakpointLine - 1, 0)));
    vscode.debug.addBreakpoints([this.breakpoint]);
    this.evidence.record('breakpoint.requested', { id: this.breakpoint.id, sourcePath: breakpointSource, line: breakpointLine });
    if (this.scenario === 'cancel-prepare') {
      this.evidence.record('fault.preparation-held');
      await delay(INTERFERENCE_DELAY_MS, undefined, { signal: this.abort.signal });
    }
    this.abort.signal.throwIfAborted();
    await this.browser.launch({
      type: 'editor-browser', request: 'launch', name: `codebook ${this.id}`, url: this.url,
      webRoot: this.evidence.directory, outFiles: [join(this.evidence.directory, 'build/*.js')],
      sourceMaps: true, sourceMapPathOverrides: { '../fixture/*': join(this.evidence.directory, 'fixture/*') },
      timeout: ACTIVE_TIMEOUT_MS,
    }, this.abort.signal);
    this.abort.signal.throwIfAborted();
    this.selected = await waitUntil(async () => {
      // The launcher is not the page; probe only descendants belonging to this run.
      const matching: { session: vscode.DebugSession; cdp: Cdp }[] = [];
      for (const session of this.sessions.values()) {
        if (!session.parentSession) continue;
        let candidate: Cdp | undefined;
        try {
          const proxy: { host: string; port: number; path: string } = await awaitResponse(session.customRequest('requestCDPProxy'), 'CDP proxy', this.abort.signal);
          this.abort.signal.throwIfAborted();
          candidate = await Cdp.connect(`ws://${proxy.host}:${proxy.port}${proxy.path}`, (type, detail) => this.evidence.record(type, detail));
          this.abort.signal.throwIfAborted();
          const location = await awaitResponse(candidate.request('Runtime.evaluate', { expression: 'location.href', returnByValue: true }), 'candidate URL', this.abort.signal);
          this.abort.signal.throwIfAborted();
          if (location.result.value === this.url) matching.push({ session, cdp: candidate });
        } catch (error) { this.evidence.record('target.probe-failed', { sessionId: session.id, error: String(error) }); }
        finally { if (candidate && !matching.some(match => match.cdp === candidate)) candidate.close(); }
      }
      if (matching.length > 1) { for (const match of matching) match.cdp.close(); throw new Error('Ambiguous owned DAP page targets'); }
      const match = matching[0];
      if (match) { this.cdp = match.cdp; return match.session; }
      return undefined;
    }, 'owned page child', ACTIVE_TIMEOUT_MS, this.abort.signal);
    this.evidence.record('target.selected', { sessionId: this.selected.id, parentId: this.selected.parentSession?.id, url: this.url });
    const cdp = this.requireCdp();
    cdp.onClose = () => { if (!this.cleaning) this.fail('Selected CDP connection closed; partial evidence retained'); };
    cdp.on('Debugger.paused', paused => {
      this.cdpPause = paused;
      this.evidence.record('cdp.paused', { scriptLocation: paused.callFrames[0]?.location, reason: paused.reason });
    });
    cdp.on('Debugger.resumed', () => { this.cdpPause = undefined; this.evidence.record('cdp.resumed'); });
    await cdp.subscribe(['Debugger.paused', 'Debugger.resumed']);
    await waitUntil(async () => (await cdp.request('Runtime.evaluate', { expression: 'document.documentElement.dataset.ready', returnByValue: true })).result.value === 'true', 'fixture ready', ACTIVE_TIMEOUT_MS, this.abort.signal);
    this.binding = await waitUntil(async () => {
      const binding = await awaitResponse(this.selected!.getDebugProtocolBreakpoint(this.breakpoint!), 'breakpoint binding', this.abort.signal);
      return binding && 'verified' in binding && binding.verified === true ? binding : undefined;
    }, 'verified breakpoint', this.scenario === 'unbound' ? CAPTURE_TIMEOUT_MS : ACTIVE_TIMEOUT_MS, this.abort.signal);
    this.evidence.record('breakpoint.bound', this.binding);
    this.evidence.record('browser.tabs-before-reveal', vscode.window.tabGroups.all.map(group => ({ column: group.viewColumn, tabs: group.tabs.map(tab => ({ label: tab.label, isActive: tab.isActive, input: tab.input })) })));
    if (this.scenario === 'source-drift') {
      await writeFile(sourcePath, source + '\n// Deliberate local edit after sealing.\n');
      this.evidence.record('fault.source-drift');
    }
    // Integrated-browser navigation can finish before it has a visible viewport.
    await this.browser.reveal(this.abort.signal);
    // VS Code hides native browser views while notification toasts overlap them.
    await vscode.commands.executeCommand('notifications.hideToasts');
    this.abort.signal.throwIfAborted();
    await cdp.request('Page.bringToFront', undefined);
    const initialLayout = await cdp.request('Page.getLayoutMetrics', undefined);
    this.evidence.record('page.initial-layout', initialLayout);
    if (!initialLayout.cssLayoutViewport.clientWidth || !initialLayout.cssLayoutViewport.clientHeight) {
      // Resize the real workbench pane; do not emulate a viewport or resend input.
      await vscode.commands.executeCommand('workbench.action.togglePanel');
      this.evidence.record('browser.layout-requested');
    }
    const layout = await waitUntil(async () => {
      const metrics = await cdp.request('Page.getLayoutMetrics', undefined);
      return metrics.cssLayoutViewport.clientWidth > 0 && metrics.cssLayoutViewport.clientHeight > 0 ? metrics : undefined;
    }, 'visible integrated browser viewport', ACTIVE_TIMEOUT_MS, this.abort.signal);
    this.evidence.record('page.visible-layout', layout);
    await vscode.commands.executeCommand('workbench.action.closePanel');
    await this.capture('before');
    this.abort.signal.throwIfAborted();
    if (this.status !== 'failed') this.status = 'ready';
    await this.persist();
  }

  /** Accepts one idempotent action synchronously and lets its browser response complete independently. @example run.acceptAction('add-once') // same operation for the same key */
  acceptAction(key: string): { accepted: boolean; operation: Operation } {
    if (this.operation?.key === key) return { accepted: false, operation: this.operation };
    if (this.cleaning || this.operation || this.status !== 'ready') throw new Error('conflict: another action exists or run is not ready');
    this.operation = { id: randomUUID(), key, inputAcknowledged: false, completed: false };
    this.status = 'acting';
    this.evidence.record('action.accepted', { operationId: this.operation.id, key });
    this.track(this.click());
    return { accepted: true, operation: this.operation };
  }

  /** Reserves an exact pause before yielding; external DAP races remain detectable, not atomically preventable. @example await run.continue({ sessionId, threadId, generation }) */
  async continue(identity: PauseIdentity): Promise<void> {
    if (this.cleaning || !this.selected || this.status === 'failed' || !this.gate.reserve(identity)) throw new Error('conflict: stale, foreign, or already reserved pause');
    this.status = 'resuming';
    this.expectedResumeRequests += 1;
    this.expectedContinuation = { ...identity };
    this.evidence.record('continue.accepted', identity);
    try {
      await awaitResponse(this.selected.customRequest('continue', { threadId: identity.threadId }), 'continue response', this.abort.signal);
      this.evidence.record('continue.response', identity);
    } catch (error) { this.fail(`Continue failed; state is uncertain: ${String(error)}`); throw error; }
  }

  /** Watches outbound resume commands to invalidate captures before DAP's later continued event. @example run.onRequest(session, request) */
  onRequest(session: vscode.DebugSession, message: DebugProtocol.Request): void {
    if (session.id !== this.selected?.id || !RESUME_COMMANDS.has(message.command)) return;
    const expected = message.command === 'continue' && this.expectedResumeRequests > 0;
    if (expected) this.expectedResumeRequests -= 1;
    else this.fail('Manual or competing DAP resume detected; atomic ownership cannot be guaranteed');
    this.gate.invalidate(!expected);
    this.evidence.record('dap.resume-request', { sessionId: session.id, command: message.command, expected });
  }

  /** Receives the selected child's DAP events independently of HTTP/browser awaits. @example run.onEvent(session, stoppedEvent) */
  onEvent(session: vscode.DebugSession, message: DebugProtocol.Event): void {
    if (this.cleaning && message.event !== 'terminated') return;
    if (session.id !== this.selected?.id) {
      if (message.event === 'stopped') this.evidence.record('unselected.stopped', { sessionId: session.id });
      return;
    }
    if (message.event === 'stopped') {
      const body: DebugProtocol.StoppedEvent['body'] = message.body;
      if (typeof body.threadId !== 'number') { this.fail('Stopped event has no unambiguous thread ID'); return; }
      const pause = this.gate.stop(session.id, body.threadId);
      this.pausedAtMs = performance.now();
      if (this.status !== 'failed') this.status = 'paused';
      this.evidence.record('dap.stopped', { ...pause, reason: body.reason, hitBreakpointIds: body.hitBreakpointIds });
      this.track(this.capture('paused', pause));
      this.track(this.inspect(pause));
    } else if (message.event === 'continued') {
      // js-debug also reports startup instrumentation resumes before any learner pause.
      if (this.gate.generation > 0 && !this.expectedContinuation) {
        this.gate.invalidate(true);
        this.fail('Continued without an owned continuation; external resume detected');
      } else if (this.expectedContinuation && (this.expectedContinuation.threadId !== message.body?.threadId || this.expectedContinuation.generation !== this.gate.generation)) {
        this.gate.invalidate(true);
        this.fail('Continued thread or pause generation does not match its reservation');
      }
      this.expectedContinuation = undefined;
      if (this.pausedAtMs !== undefined) this.pausedDurationMs += performance.now() - this.pausedAtMs;
      this.pausedAtMs = undefined;
      this.gate.invalidate();
      this.evidence.record('dap.continued', { sessionId: session.id, body: message.body });
      if (this.operation) this.track(this.observeCompletion());
    } else if (message.event === 'terminated') this.terminated(session);
  }

  /** Retains partial evidence when the selected session ends unexpectedly. @example run.terminated(selected) */
  terminated(session: vscode.DebugSession): void {
    this.activeSessionIds.delete(session.id);
    this.evidence.record('session.terminated', { sessionId: session.id });
    if (session.id === this.selected?.id && !this.cleaning && this.status !== 'completed') {
      this.gate.invalidate();
      this.fail('Selected session terminated before completion');
    }
  }

  /** Exposes immutable evidence references and current control identity to the fixed HTTP API. @example run.view().pause */
  view() {
    return { runId: this.id, scenario: this.scenario, status: this.status, cleaned: this.cleanupComplete, resources: { activeSessionIds: [...this.activeSessionIds], breakpointPresent: Boolean(this.breakpoint && vscode.debug.breakpoints.some(breakpoint => breakpoint.id === this.breakpoint!.id)), cdpOpen: Boolean(this.cdp && !this.cdp.closed) }, operation: this.operation, pause: this.gate.current, conflict: this.gate.conflict, sessionId: this.selected?.id, snapshot: this.snapshot, captures: this.captures, observed: this.observed, failures: this.failures, events: this.evidence.events, artifactDirectory: this.evidence.directory };
  }

  /** Marks uncertain runs without retrying input or resuming the debugger. @example run.fail('source mismatch') */
  fail(reason: string): void {
    if (this.cleaning) return;
    if (!this.failures.includes(reason)) { this.failures.push(reason); this.evidence.record('run.failed', { reason }); }
    this.status = 'failed';
    void this.persist().catch(error => { this.evidence.failure = String(error); });
  }

  /** Writes a token-free manifest; environment and hashes qualify every runtime claim. @example await run.persist() */
  async persist(): Promise<void> {
    await this.evidence.save('manifest.json', {
      ...this.view(), events: undefined,
      environment: { host: this.config.host.id, productVersion: this.config.host.productVersion, apiVersion: vscode.version, hostCommit: this.config.host.commit, node: process.versions.node, electron: process.versions.electron, jsDebug: vscode.extensions.getExtension('ms-vscode.js-debug')?.packageJSON.version },
      revision: this.config.revision, workingTreeDirty: this.config.workingTreeDirty, sourceHash: this.config.sourceHash, extensionHash: this.config.extensionHash,
      expected: { ...EXPECTED_VALUES, finalCartCount: 1, completedClicks: 1 },
      hashes: this.source && { typescript: sha256(this.source.source), javascript: sha256(this.source.javascript), sourceMap: sha256(this.source.sourceMap) },
      evidenceWriteFailure: this.evidence.failure,
      limits: ['Fixture only; not a production MCP service.', 'Receipt ordering is not a causal or simultaneous-paint guarantee.', 'DAP cannot atomically compare an expected suspension generation.'],
    });
    await this.evidence.flush();
  }

  /** Cleans up only owned sessions, breakpoints and connections after evidence is flushed. @example await run.cleanup() */
  async cleanup(): Promise<void> {
    const attempt = this.cleanupPromise ??= this.cleanupOwned();
    try { await attempt; }
    catch (error) {
      // Share concurrent DELETEs, but let a later request retry an incomplete release.
      if (this.cleanupPromise === attempt) this.cleanupPromise = undefined;
      throw error;
    }
  }

  /** Attempts every owned release and saves partial failures for each shared {@link cleanup} attempt. @example await this.cleanupOwned() */
  private async cleanupOwned(): Promise<void> {
    this.cleaning = true;
    if (!['completed', 'failed'].includes(this.status)) this.status = 'cancelled';
    this.abort.abort(new Error('Run cleanup requested'));
    this.gate.invalidate();
    clearInterval(this.watchdog);
    this.evidence.record('cleanup.started');
    const failures = await settleCleanup([
      { description: 'run preparation settlement', release: () => awaitResponse(this.preparePromise?.catch(() => undefined) ?? Promise.resolve(), 'run preparation settlement') },
      { description: 'selected CDP close', release: () => this.cdp?.close() },
      { description: 'owned breakpoint removal', release: () => { if (this.breakpoint) vscode.debug.removeBreakpoints([this.breakpoint]); } },
    ]);
    failures.push(...await settleCleanup([...this.sessions.values()].filter(session => !session.parentSession && this.activeSessionIds.has(session.id)).map(session => ({ description: `owned debug session ${session.id}`, release: () => awaitResponse(vscode.debug.stopDebugging(session), 'owned debug session stop') }))));
    // Browser cleanup releases its bridge and known tabs even while a native launch is unresolved.
    failures.push(...await settleCleanup([{ description: 'owned browser cleanup', release: () => this.browser.close() }]));
    const sourceTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === this.source?.sourcePath);
    failures.push(...await settleCleanup(sourceTabs.map(tab => ({ description: 'owned source editor close', release: () => awaitResponse(vscode.window.tabGroups.close(tab), 'owned source editor close') }))));
    failures.push(...await settleCleanup([
      { description: 'active inspections settled', release: () => awaitResponse(Promise.all(this.activities), 'active inspections settled') },
      { description: 'owned debug sessions terminated', release: () => waitUntil(() => this.activeSessionIds.size === 0, 'owned debug sessions terminated', CAPTURE_TIMEOUT_MS) },
    ]));
    this.cleanupComplete = failures.length === 0;
    if (failures.length) {
      this.failures.push(...failures.map(failure => `Cleanup incomplete: ${failure}`));
      this.evidence.record('cleanup.failed', { failures });
    } else this.evidence.record('cleanup.completed');
    try { await this.persist(); }
    catch (error) { this.cleanupComplete = false; throw error; }
    if (failures.length) throw new Error(`Run cleanup incomplete: ${failures.join('; ')}`);
  }

  /** Rejects control work without the explicitly adopted proxy, used by input/capture/inspection. @example this.requireCdp().closed */
  private requireCdp(): Cdp {
    if (!this.cdp) throw new Error('Selected page CDP is unavailable');
    return this.cdp;
  }

  /** Registers independent runtime work so {@link cleanupOwned} can drain it. @example this.track(this.click()) */
  private track(activity: Promise<void>): void {
    const tracked = activity.catch(error => this.fail(String(error))).finally(() => this.activities.delete(tracked));
    this.activities.add(tracked);
  }

  /** Dispatches one physical input after {@link acceptAction}; ACK never means application completion. @example await this.click() */
  private async click(): Promise<void> {
    const cdp = this.requireCdp();
    const result = await cdp.request('Runtime.evaluate', { expression: 'JSON.stringify((() => { const r = document.querySelector("#add").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })())', returnByValue: true });
    const coordinates: { x: number; y: number } = JSON.parse(result.result.value);
    if (this.cleaning || this.status === 'failed') throw new Error('Action cancelled before input dispatch');
    this.evidence.record('input.coordinates', coordinates);
    this.evidence.record('input.dispatched', { operationId: this.operation!.id });
    await cdp.request('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...coordinates }, RUN_TIMEOUT_MS);
    await cdp.request('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...coordinates }, RUN_TIMEOUT_MS, this.scenario === 'capture-timeout' ? INJECTED_DELAY_MS : 0);
    this.operation!.inputAcknowledged = true;
    this.evidence.record('input.acknowledged', { operationId: this.operation!.id });
  }

  /** Records a bounded frame when setup, a stop, or completion requests it; stale pauses lose their reference. @example await this.capture('paused', pause) */
  private async capture(phase: string, pause?: PauseIdentity): Promise<void> {
    const request = this.evidence.record('capture.requested', { phase, generation: pause?.generation, inputAcknowledged: this.operation?.inputAcknowledged });
    const capture: Capture = { phase, generation: pause?.generation, requestSequence: request.sequence, status: 'pending' };
    const captureKey = pause ? `${phase}-${pause.generation}` : phase;
    this.captures[captureKey] = capture;
    try {
      const pending = this.requireCdp().request('Page.captureScreenshot', { format: 'png' }, CAPTURE_TIMEOUT_MS, phase === 'paused' && this.scenario === 'capture-timeout' ? INJECTED_DELAY_MS : 0);
      if (phase === 'after' && this.scenario === 'disconnect-after') {
        this.evidence.record('fault.injected', { scenario: 'disconnect-after' });
        this.cdp!.close();
      }
      const result = await pending;
      if (pause && !this.gate.matches(pause)) throw new Error('Capture arrived after its pause was invalidated');
      capture.responseSequence = this.evidence.record('capture.received', { phase, generation: pause?.generation }).sequence;
      capture.file = `${captureKey}.png`;
      await this.evidence.save(capture.file, Buffer.from(result.data, 'base64'));
      if (pause && !this.gate.matches(pause)) throw new Error('Pause invalidated while saving its capture');
      capture.status = 'captured';
    } catch (error) {
      capture.status = 'failed';
      capture.file = undefined;
      capture.error = String(error);
      capture.responseSequence = this.evidence.record('capture.failed', { phase, error: capture.error, generation: pause?.generation }).sequence;
    }
  }

  /** Commits verified values/source for {@link onEvent}'s stop, checking identity across every await. @example await this.inspect(pause) */
  private async inspect(pause: PauseIdentity): Promise<void> {
    const assertCurrent = () => { if (!this.gate.matches(pause)) throw new Error('Pause changed during inspection; snapshot rejected'); };
    assertCurrent();
    const paused = await waitUntil(() => this.cdpPause, 'matching CDP pause', CAPTURE_TIMEOUT_MS);
    assertCurrent();
    const result = await inspectPause(this.selected!, this.requireCdp(), pause, paused, this.source!, assertCurrent, this.abort.signal, this.evidence);
    assertCurrent();
    await this.evidence.save(`snapshot-${pause.generation}.json`, result.snapshot);
    assertCurrent();
    this.snapshot = result.snapshot;
    this.snapshots.push(result.snapshot);
    this.evidence.record('snapshot.committed', { snapshotId: result.snapshot.id, pause });
    const values = result.snapshot.values;
    await this.evidence.save('explanation.md', `# Captured cart stop\n\nSnapshot: ${result.snapshot.id}\n\nThe click reached addToCart in cart.ts:${this.source!.breakpointLine}. At this stop, selectedProduct.id is ${values.productId}, its price is ${values.price}, and state.items.length is ${values.cartCount}. The next statement adds the selected product. The cart mutation and its visible update have not executed yet. Continuing this pause lets that statement run.\n\nThese statements describe this captured frame only. No checkout, backend request, or other path was observed.\n`);
    await this.persist();
    if (this.scenario === 'decoy') {
      // Exercise the real debug-focus UI without using focus to choose any control target.
      for (let attempt = 0; attempt < FOCUS_ATTEMPT_LIMIT; attempt += 1) {
        const focused = vscode.debug.activeDebugSession;
        if (focused && this.owns(focused)) break;
        await vscode.commands.executeCommand('workbench.action.debug.nextConsole');
        await waitUntil(() => vscode.debug.activeDebugSession?.id !== focused?.id, 'debug focus change', CAPTURE_TIMEOUT_MS, this.abort.signal);
      }
      if (!vscode.debug.activeDebugSession || !this.owns(vscode.debug.activeDebugSession)) throw new Error('Could not focus the decoy debug target');
      this.evidence.record('focus.verified', { sessionId: vscode.debug.activeDebugSession.id });
    }
    // Fixed scenario faults use the real VS Code control path, outside the HTTP reservation.
    if (pause.generation === 1 && ['manual-race', 'cdp-resume', 'disconnect', 'terminate'].includes(this.scenario)) {
      setTimeout(() => {
        if (this.cleaning) return;
        this.evidence.record('fault.injected', { scenario: this.scenario });
        if (this.scenario === 'disconnect') this.cdp?.close();
        else if (this.scenario === 'cdp-resume') this.track(this.requireCdp().request('Debugger.resume', undefined).then(() => undefined));
        else if (this.scenario === 'terminate') void vscode.debug.stopDebugging(this.selected).then(undefined, error => this.fail(String(error)));
        else if (vscode.debug.activeDebugSession?.id !== this.selected?.id) this.fail('Manual-race precondition failed: selected session is not focused');
        else void vscode.commands.executeCommand('workbench.action.debug.stepOver').then(undefined, error => this.fail(String(error)));
      }, INTERFERENCE_DELAY_MS);
    }
  }

  /** Checks the rendered result after an owned continued event; failures remain terminal. @example await this.observeCompletion() */
  private async observeCompletion(): Promise<void> {
    if (this.cleaning || this.gate.conflict || this.status === 'failed') return;
    const observed = await waitUntil(async () => {
      const result = await this.requireCdp().request('Runtime.evaluate', { expression: 'JSON.stringify({cartCount:Number(document.querySelector("#count").textContent),completedClicks:Number(document.querySelector("#clicks").textContent)})', returnByValue: true });
      const value: { cartCount: number; completedClicks: number } = JSON.parse(result.result.value);
      return value.cartCount === 1 ? value : undefined;
    }, 'cart count 1');
    if (this.cleaning || this.gate.conflict || this.status === 'failed') return;
    this.observed = observed;
    this.operation!.completed = true;
    this.evidence.record('application.updated', observed);
    // Return the owned app to view before its final frame; debugger focus remains explicit.
    await this.browser.reveal(this.abort.signal);
    if (this.cleaning || this.gate.conflict || this.status === 'failed') return;
    await this.requireCdp().request('Page.bringToFront', undefined);
    this.evidence.record('browser.revealed-for-completion');
    if (this.cleaning || this.gate.conflict || this.status === 'failed') return;
    await this.capture('after');
    if (this.cleaning || this.gate.conflict || this.status === 'failed') return;
    if (observed.completedClicks !== 1) this.fail('More than one click handler completed');
    else if (!this.snapshot) this.fail('Application updated without a verified snapshot');
    else { this.status = 'completed'; this.evidence.record('run.completed', { captureComplete: Object.values(this.captures).every(capture => capture.status === 'captured') }); }
    await this.persist();
  }
}
