import * as vscode from 'vscode';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { DebugProtocol } from '@vscode/debugprotocol';
import type { Protocol } from 'devtools-protocol';
import { Cdp } from 'codebook-cycle-0001/dist/cdp';
import { Evidence } from 'codebook-cycle-0001/dist/evidence';
import { HostBrowser, type HostConfiguration } from 'codebook-cycle-0001/dist/hostBrowser';
import { PauseGate, type PauseIdentity } from 'codebook-cycle-0001/dist/pauseGate';
import type { SealedSource } from 'codebook-cycle-0001/dist/inspect';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { settleCleanup } from 'codebook-cycle-0001/dist/utils/settleCleanup';
import { isEndpointClosed } from 'codebook-cycle-0001/dist/utils/isEndpointClosed';
import { ACTIVE_TIMEOUT_MS, CAPTURE_TIMEOUT_MS, RUN_TIMEOUT_MS, WATCHDOG_INTERVAL_MS, MAX_BODY_BYTES, MAX_NETWORK_BUFFER_BYTES, FAULT_DELAY_MS, RESUME_COMMANDS, PARTICIPANTS, REQUIRED_CAPTURE_PHASES, type ParticipantName, type Scenario } from './constants';
import { VIEWPORT_WIDTH_PX, VIEWPORT_HEIGHT_PX, FOCUS_ATTEMPT_LIMIT, INJECTED_DELAY_MS } from 'codebook-cycle-0001/dist/constants';
import { PauseBudget } from './pauseBudget';
import { NetworkEvidence } from './networkEvidence';
import { inspectParticipant, type ParticipantSnapshot } from './inspectParticipant';
import { sealFixture } from './utils/sealFixture';
import { readBackendEndpoint, type BackendEndpoint } from './utils/readBackendEndpoint';
import { backendProcesses } from './utils/backendProcesses';

export interface HarnessConfig {
  artifactRoot: string; templateRoot: string; descriptorPath: string;
  revision: string; dirty: boolean; sourceHash: string; nodeExecutable: string;
  host: HostConfiguration;
}
interface Participant {
  gate: PauseGate; selected?: vscode.DebugSession; cdp?: Cdp; source?: SealedSource;
  breakpoint?: vscode.SourceBreakpoint; binding?: vscode.DebugProtocolBreakpoint;
  stopped?: Protocol.Debugger.PausedEvent; snapshot?: ParticipantSnapshot;
  expectedRequests: number; continuation?: PauseIdentity; continued?: PauseIdentity;
}
interface Capture { status: 'pending' | 'captured' | 'failed'; file?: string; error?: string; renderer?: { epoch: string; id: number; hash: string } }
interface CausalLink { id: string; status: 'unknown' | 'observed' | 'ambiguous' | 'mismatched'; evidence: string[] }

/** Owns two explicitly identified debug participants and one complete request set; the HTTP harness delegates bounded operations. @example const run = new PairedRun(config, 'normal'); await run.prepare() */
export class PairedRun {
  readonly id = randomUUID();
  readonly evidence: Evidence;
  readonly participants: Record<ParticipantName, Participant> = {
    server: { gate: new PauseGate(), expectedRequests: 0 }, browser: { gate: new PauseGate(), expectedRequests: 0 },
  };
  readonly sessions = new Map<string, { session: vscode.DebugSession; name: ParticipantName }>();
  readonly activeSessions = new Set<string>();
  readonly failures: string[] = [];
  readonly captures: Record<string, Capture> = {};
  readonly startedMs = performance.now();
  readonly budget = new PauseBudget(this.startedMs);
  readonly links: CausalLink[] = ['intent-request', 'request-server', 'server-response', 'response-browser', 'browser-screen'].map(id => ({ id, status: 'unknown', evidence: [] }));
  status = 'preparing';
  operation?: { id: string; key: string; inputAcknowledged: boolean };
  endpoint?: BackendEndpoint;
  network?: NetworkEvidence;
  observed?: { cartCount: number; completedClicks: number };
  private browser?: HostBrowser;
  private readonly abort = new AbortController();
  private readonly activities = new Set<Promise<void>>();
  private preparePromise?: Promise<void>;
  private nodeLaunch?: Promise<boolean>;
  private cleanupPromise?: Promise<void>;
  private cleaning = false;
  private cleaned = false;
  private finalizing = false;
  private readonly watchdog: ReturnType<typeof setInterval>;

  constructor(readonly config: HarnessConfig, readonly scenario: Scenario) {
    this.evidence = new Evidence(join(config.artifactRoot, this.id));
    this.watchdog = setInterval(() => {
      if (this.cleaning || ['failed', 'completed'].includes(this.status)) return;
      const now = performance.now();
      if (now - this.startedMs > RUN_TIMEOUT_MS || this.budget.activeMs(now) > ACTIVE_TIMEOUT_MS) this.fail('Application progress deadline exceeded; no request retry or automatic continuation');
    }, WATCHDOG_INTERVAL_MS);
  }

  /** Identifies only run-named ancestry before a child proxy exists, used by pre-registered trackers. @example run.owner(unrelatedSession) // undefined */
  owner(session: vscode.DebugSession): ParticipantName | undefined {
    for (let ancestor: vscode.DebugSession | undefined = session; ancestor; ancestor = ancestor.parentSession) {
      for (const name of PARTICIPANTS) if (ancestor.configuration.name === `codebook ${this.id} ${name}`) return name;
    }
    return undefined;
  }

  /** Retains a newly acquired owned session even after cancellation so teardown can release it. @example run.addSession(child) */
  addSession(session: vscode.DebugSession): void {
    const name = this.owner(session);
    if (!name) return;
    this.sessions.set(session.id, { session, name }); this.activeSessions.add(session.id);
    this.evidence.record('session.started', { participant: name, sessionId: session.id, parentId: session.parentSession?.id });
    if (this.cleaning) this.track(Promise.resolve(vscode.debug.stopDebugging(session)));
  }

  /** Serializes setup once while the external create request returns immediately. @example await run.prepare() */
  async prepare(): Promise<void> { this.preparePromise ??= this.prepareOwned(); await this.preparePromise; }

  /** Acquires sealed sources, Node, selected proxies and managed browser in dependency order. @example await this.prepareOwned() */
  private async prepareOwned(): Promise<void> {
    await this.evidence.initialize();
    this.evidence.record('run.created', { runId: this.id, scenario: this.scenario, expectedRequests: 2, expectedLinks: this.links.map(link => link.id) });
    const sources = await sealFixture(this.config.templateRoot, this.evidence.directory, this.id, this.scenario);
    for (const name of PARTICIPANTS) {
      const participant = this.participants[name]; participant.source = sources[name];
      participant.breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(sources[name].sourcePath), new vscode.Position(sources[name].breakpointLine - 1, 0)), true, name === 'server' ? "tuple.cartId === 'selected'" : undefined);
      vscode.debug.addBreakpoints([participant.breakpoint]);
      this.evidence.record('breakpoint.requested', { participant: name, source: sources[name].sourcePath, line: sources[name].breakpointLine });
      // Keep both debugger source reveals outside the owned browser group, as in the synchronous coordinator.
      await vscode.window.showTextDocument(vscode.Uri.file(sources[name].sourcePath), { viewColumn: vscode.ViewColumn.Two, preview: false, preserveFocus: true });
    }
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    this.assertAlive();
    this.nodeLaunch = Promise.resolve(vscode.debug.startDebugging(undefined, {
      type: 'pwa-node', request: 'launch', name: `codebook ${this.id} server`, runtimeExecutable: this.config.nodeExecutable,
      program: join(this.evidence.directory, 'build/server.mjs'), cwd: this.evidence.directory, console: 'internalConsole', stopOnEntry: false,
      autoAttachChildProcesses: false, sourceMaps: true, outFiles: [join(this.evidence.directory, 'build/*.mjs')],
      resolveSourceMapLocations: [join(this.evidence.directory, '**')], env: { CODEBOOK_RUN_ID: this.id },
    }));
    if (this.scenario === 'cancel-launch') {
      this.evidence.record('fault.launch-held');
      await delay(ACTIVE_TIMEOUT_MS, undefined, { signal: this.abort.signal });
    }
    if (!await awaitResponse(this.nodeLaunch, 'owned Node launch')) throw new Error('Host rejected owned Node launch');
    this.assertAlive();
    this.endpoint = await waitUntil(() => readBackendEndpoint(this.evidence.directory, this.id), 'backend listener', ACTIVE_TIMEOUT_MS, this.abort.signal);
    this.evidence.record('backend.endpoint', this.endpoint);
    await this.selectProxy('server');
    const url = `${this.endpoint.origin}/runs/${this.id}/index.html`;
    this.browser = new HostBrowser(this.config.host, this.id, url, (type, detail) => this.evidence.record(type, detail), 'normal', reason => this.fail(reason));
    await this.browser.launch({ type: 'pwa-chrome', request: 'launch', name: `codebook ${this.id} browser`, url, webRoot: this.evidence.directory,
      // Browser source maps are fetched by URL; the local-only Node allowlist would silently exclude them.
      outFiles: [join(this.evidence.directory, 'build/*.mjs')], sourceMaps: true, resolveSourceMapLocations: [join(this.evidence.directory, '**'), `${this.endpoint.origin}/runs/${this.id}/*.mjs.map`], sourceMapPathOverrides: { '../fixture/*': join(this.evidence.directory, 'fixture/*') }, timeout: ACTIVE_TIMEOUT_MS }, this.abort.signal);
    await this.selectProxy('browser');
    const cdp = this.requireCdp('browser');
    await this.browser.attachViewport(cdp, this.abort.signal);
    await waitUntil(async () => (await cdp.request('Runtime.evaluate', { expression: 'document.documentElement.dataset.ready', returnByValue: true })).result.value === 'true', 'paired fixture ready', ACTIVE_TIMEOUT_MS, this.abort.signal);
    for (const name of PARTICIPANTS) {
      const participant = this.participants[name];
      this.evidence.record('target.loaded-sources', { participant: name, sources: await awaitResponse(participant.selected!.customRequest('loadedSources'), 'participant loaded sources', this.abort.signal) });
      participant.binding = await waitUntil(async () => { const binding = await awaitResponse(participant.selected!.getDebugProtocolBreakpoint(participant.breakpoint!), 'participant breakpoint binding', this.abort.signal); return binding && 'verified' in binding && binding.verified ? binding : undefined; }, `${name} source breakpoint binding`, ACTIVE_TIMEOUT_MS, this.abort.signal);
      this.evidence.record('breakpoint.bound', { participant: name, binding: participant.binding });
    }
    await this.observeNetwork();
    await this.browser.reveal(this.abort.signal);
    await cdp.request('Emulation.setDeviceMetricsOverride', { width: VIEWPORT_WIDTH_PX, height: VIEWPORT_HEIGHT_PX, deviceScaleFactor: 1, mobile: false });
    await this.capture('before');
    this.assertAlive(); this.status = 'ready'; this.evidence.record('run.ready'); await this.persist();
  }

  /** Adopts exactly one child whose runtime identity matches the owned Node process or exact page URL. @example await this.selectProxy('server') */
  private async selectProxy(name: ParticipantName): Promise<void> {
    const participant = this.participants[name];
    const match = await waitUntil(async () => {
      const matching: { session: vscode.DebugSession; cdp: Cdp }[] = [];
      for (const { session, name: owner } of this.sessions.values()) {
        // js-debug launch parents coordinate children but do not own a target CDP endpoint.
        if (owner !== name || !session.parentSession || !this.activeSessions.has(session.id)) continue;
        let candidate: Cdp | undefined;
        try {
          const proxy: { host: string; port: number; path?: string } = await awaitResponse(session.customRequest('requestCDPProxy'), 'participant CDP proxy', this.abort.signal);
          this.assertAlive();
          candidate = await Cdp.connect(`ws://${proxy.host}:${proxy.port}${proxy.path ?? ''}`, (type, detail) => this.evidence.record(type, { participant: name, detail }));
          this.assertAlive();
          const expression = name === 'server' ? 'JSON.stringify({runId:process.env.CODEBOOK_RUN_ID,pid:process.pid,executable:process.execPath})' : 'location.href';
          const result = await candidate.request('Runtime.evaluate', { expression, returnByValue: true });
          this.assertAlive();
          const expected = name === 'server' ? JSON.stringify({ runId: this.id, pid: this.endpoint!.pid, executable: this.endpoint!.executable }) : `${this.endpoint!.origin}/runs/${this.id}/index.html`;
          if (result.result.value === expected) matching.push({ session, cdp: candidate });
        } catch (error) { this.evidence.record('target.probe-failed', { participant: name, sessionId: session.id, reason: String(error) }); }
        finally { if (candidate && !matching.some(match => match.cdp === candidate)) candidate.close(); }
      }
      if (matching.length > 1) { for (const match of matching) match.cdp.close(); throw new Error('Ambiguous owned participant targets'); }
      return matching[0];
    }, `owned ${name} target`, ACTIVE_TIMEOUT_MS, this.abort.signal);
    participant.selected = match.session; participant.cdp = match.cdp;
    this.evidence.record('target.selected', { participant: name, sessionId: match.session.id, parentId: match.session.parentSession?.id });
    match.cdp.onClose = () => { if (!this.cleaning) this.fail(`${name} CDP disconnected`); };
    match.cdp.on('Debugger.paused', event => { participant.stopped = event; this.evidence.record('cdp.paused', { participant: name, location: event.callFrames[0]?.location }); });
    match.cdp.on('Debugger.resumed', () => {
      participant.stopped = undefined;
      if (participant.gate.phase === 'paused') { participant.gate.invalidate(true); this.fail(`${name} resumed outside its owned continuation`); }
    });
    await match.cdp.subscribe(['Debugger.paused', 'Debugger.resumed']);
  }

  /** Subscribes before input; body reads begin only after loadingFinished and never wait on DAP inspection. @example await this.observeNetwork() */
  private async observeNetwork(): Promise<void> {
    const cdp = this.requireCdp('browser');
    const prefix = `${this.endpoint!.origin}/runs/${this.id}/`;
    const network = this.network = new NetworkEvidence(this.id, `${prefix}api/cart`, `${prefix}client.mjs`);
    cdp.on('Network.requestWillBeSent', event => { const sequence = this.evidence.record('network.request', event).sequence; network.request(event, sequence); this.networkChanged(); });
    cdp.on('Network.responseReceived', event => { this.evidence.record('network.response', event); network.response(event); this.networkChanged(); });
    cdp.on('Network.loadingFailed', event => { if (network.requests.has(event.requestId)) { network.errors.push(`Network loadingFailed: ${event.errorText}`); this.networkChanged(); } });
    cdp.on('Network.loadingFinished', event => {
      const sequence = this.evidence.record('network.finished', event).sequence;
      if (!network.finished(event.requestId, sequence)) return;
      this.track((async () => {
        const result = await cdp.request('Network.getResponseBody', { requestId: event.requestId });
        if (this.cleaning) return;
        network.body(event.requestId, result); this.evidence.record('network.body', { requestId: event.requestId, result }); this.networkChanged();
      })());
    });
    await cdp.subscribe(['Debugger.paused', 'Debugger.resumed', 'Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed']);
    await cdp.request('Network.enable', { maxTotalBufferSize: MAX_NETWORK_BUFFER_BYTES, maxResourceBufferSize: MAX_BODY_BYTES, maxPostDataSize: MAX_BODY_BYTES });
    await cdp.request('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.request('Network.setBypassServiceWorker', { bypass: true });
  }

  /** Re-evaluates all retained observations without starting a wall-clock application waiter. @example this.networkChanged() */
  private networkChanged(): void {
    this.network?.settled();
    if (this.network?.errors.length) {
      // Teardown can still receive queued observations before CDP closes; retain contradictions to a candidate outcome.
      if (this.cleaning) { this.status = 'failed'; this.failures.push(...this.network.errors.filter(error => !this.failures.includes(error))); }
      else this.fail(this.network.errors.join('; '));
      return;
    }
    this.track(this.tryComplete());
  }

  /** Accepts one idempotent input immediately; actual dispatch proceeds in an independent lane. @example run.acceptAction('one-click') */
  acceptAction(key: string) {
    if (this.operation?.key === key && !this.cleaning) return this.operation;
    if (this.status !== 'ready' || this.operation) throw new Error('conflict: one action already active or run not ready');
    this.operation = { id: randomUUID(), key, inputAcknowledged: false }; this.status = 'running';
    this.evidence.record('action.accepted', this.operation); this.track(this.click()); return this.operation;
  }

  /** Dispatches one physical click through the owned page, never retries after a deadline. @example await this.click() */
  private async click(): Promise<void> {
    const cdp = this.requireCdp('browser');
    const result = await cdp.request('Runtime.evaluate', { expression: 'JSON.stringify((()=>{const rect=document.querySelector("#add").getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2}})())', returnByValue: true });
    const coordinates: { x: number; y: number } = JSON.parse(result.result.value);
    this.assertAlive(); this.evidence.record('input.dispatched', { operationId: this.operation!.id });
    await cdp.request('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...coordinates }, RUN_TIMEOUT_MS);
    await cdp.request('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...coordinates }, RUN_TIMEOUT_MS);
    this.assertAlive(); this.operation!.inputAcknowledged = true; this.evidence.record('input.acknowledged');
  }

  /** Detects competing DAP requests instead of attributing manual control to the agent. @example run.onRequest(session, request) */
  onRequest(session: vscode.DebugSession, message: DebugProtocol.Request): void {
    if (this.cleaning || !RESUME_COMMANDS.has(message.command)) return;
    const name = PARTICIPANTS.find(name => this.participants[name].selected?.id === session.id);
    if (!name) return;
    const participant = this.participants[name];
    if (!participant.gate.generation) return;
    const expected = message.command === 'continue' && participant.expectedRequests > 0;
    if (expected) participant.expectedRequests -= 1;
    else this.fail('Manual or competing DAP continuation detected');
    participant.gate.invalidate(!expected);
    this.evidence.record('dap.resume-request', { participant: name, expected, command: message.command });
  }

  /** Routes real events by selected session identity; startup instrumentation resumes do not invent learner stops. @example run.onEvent(session, event) */
  onEvent(session: vscode.DebugSession, message: DebugProtocol.Event): void {
    if (this.cleaning) return;
    const name = PARTICIPANTS.find(name => this.participants[name].selected?.id === session.id);
    if (!name) return;
    const participant = this.participants[name];
    if (message.event === 'stopped') {
      const body: DebugProtocol.StoppedEvent['body'] = message.body;
      if (!Number.isInteger(body.threadId) || participant.gate.generation > 0) { this.fail('Missing thread ID or unexpected additional stop'); return; }
      const pause = participant.gate.stop(session.id, body.threadId!);
      this.budget.stop(name, performance.now()); this.browser?.resumeViewport();
      this.evidence.record('dap.stopped', { participant: name, ...pause, reason: body.reason });
      if (this.status !== 'failed') this.status = `paused-${name}`;
      this.track(this.inspect(name, pause)); this.track(this.capture(`paused-${name}`, name, pause));
    } else if (message.event === 'continued') {
      if (participant.gate.generation && (!participant.continuation || participant.continuation.threadId !== message.body?.threadId || participant.continuation.generation !== participant.gate.generation)) { participant.gate.invalidate(true); this.fail('Continued event has no matching owned reservation'); }
      else if (participant.continuation) participant.continued = participant.continuation;
      participant.continuation = undefined; participant.gate.invalidate(); this.budget.resume(name, performance.now()); this.browser?.resumeViewport();
      this.evidence.record('dap.continued', { participant: name, identity: participant.continued });
      if (this.status !== 'failed' && this.operation) this.status = 'running';
      this.track(this.tryComplete());
    } else if (message.event === 'terminated') this.terminated(session);
  }

  /** Fails a disappearing participant while preserving already captured historical snapshots. @example run.terminated(session) */
  terminated(session: vscode.DebugSession): void {
    this.activeSessions.delete(session.id); this.evidence.record('session.terminated', { sessionId: session.id });
    if (!this.cleaning && PARTICIPANTS.some(name => this.participants[name].selected?.id === session.id)) this.fail('Selected participant terminated before teardown');
  }

  /** Captures fixed values/source around generation guards and commits only an unchanged pause. @example await this.inspect('server', pause) */
  private async inspect(name: ParticipantName, pause: PauseIdentity): Promise<void> {
    const participant = this.participants[name];
    const assertCurrent = () => { this.assertAlive(); if (!participant.gate.matches(pause)) throw new Error('Pause invalidated during participant inspection'); };
    const stopped = await waitUntil(() => participant.stopped, 'paired CDP stop', CAPTURE_TIMEOUT_MS, this.abort.signal);
    assertCurrent();
    const snapshot = await inspectParticipant(name, participant.selected!, this.requireCdp(name), pause, stopped, participant.source!, assertCurrent, this.abort.signal, this.evidence);
    assertCurrent();
    const expected = { operationId: this.id, cartId: 'selected', productId: 'tote-01', price: 24, cartCount: name === 'server' ? 0 : 1, admittedCount: 2 };
    if (JSON.stringify(snapshot.values) !== JSON.stringify(expected)) throw new Error('Paused identity or values differ from the frozen expectation');
    await this.evidence.save(`${name}-snapshot.json`, snapshot); assertCurrent();
    participant.snapshot = snapshot; this.evidence.record('snapshot.committed', { participant: name, snapshotId: snapshot.id });
    await this.evidence.save(`${name}-explanation.md`, `# ${name} captured stop\n\nSnapshot ${snapshot.id}; source ${participant.source!.breakpointLine}.\n\nOperation ${snapshot.values.operationId} selected cart ${snapshot.values.cartId}, product ${snapshot.values.productId}, price ${snapshot.values.price}. Captured cart count ${snapshot.values.cartCount}; admitted requests ${snapshot.values.admittedCount}. ${name === 'server' ? 'The next statement mutates the selected server cart.' : 'The response has arrived; the next statement updates the displayed count.'}\n\nOnly this verified frame is described. Request correspondence remains pending until the complete network observation set is closed.\n`);
    await this.persist();
    if (name === 'server' && this.scenario === 'decoy') {
      // Force the native focus precondition; participant identity never comes from this focus.
      for (let attempt = 0; attempt < FOCUS_ATTEMPT_LIMIT * PARTICIPANTS.length; attempt += 1) {
        const focused = vscode.debug.activeDebugSession;
        if (focused && this.owner(focused)) break;
        await vscode.commands.executeCommand('workbench.action.debug.nextConsole');
        await waitUntil(() => vscode.debug.activeDebugSession?.id !== focused?.id, 'paired debug focus change', CAPTURE_TIMEOUT_MS, this.abort.signal);
        assertCurrent();
      }
      if (!vscode.debug.activeDebugSession || !this.owner(vscode.debug.activeDebugSession)) throw new Error('Could not focus the owned decoy participant');
      this.evidence.record('focus.verified', { sessionId: vscode.debug.activeDebugSession.id });
    }
    if (name === 'server' && this.scenario === 'manual-resume') {
      await delay(FAULT_DELAY_MS, undefined, { signal: this.abort.signal });
      this.evidence.record('fault.manual-resume'); await participant.selected!.customRequest('continue', { threadId: pause.threadId });
    }
    this.track(this.tryComplete());
  }

  /** Reserves the exact participant stop before the first await; another request cannot reuse it. @example await run.continue('server', pause) */
  async continue(name: ParticipantName, identity: PauseIdentity): Promise<void> {
    const participant = this.participants[name];
    if (this.cleaning || this.status === 'failed' || !participant.snapshot || participant.snapshot.pause.generation !== identity.generation || !participant.gate.reserve(identity)) throw new Error('conflict: stale, foreign, uninspected or already reserved pause');
    participant.expectedRequests += 1; participant.continuation = { ...identity }; this.browser?.resumeViewport();
    this.evidence.record('continue.accepted', { participant: name, ...identity });
    try { await awaitResponse(participant.selected!.customRequest('continue', { threadId: identity.threadId }), 'participant continuation', this.abort.signal); }
    catch (error) { this.fail(`Participant continuation failed: ${String(error)}`); throw error; }
  }

  /** Attempts completion only after both actual continuations and the closed two-request set exist. @example await this.tryComplete() */
  private async tryComplete(): Promise<void> {
    if (this.cleaning || this.status === 'failed' || this.status === 'completed' || this.finalizing) return;
    const server = this.participants.server, browser = this.participants.browser;
    const network = this.network?.settled();
    if (!network || !server.snapshot || !browser.snapshot || !server.continued || !browser.continued) return;
    this.finalizing = true;
    try {
      if (JSON.stringify(browser.snapshot.values) !== JSON.stringify(network.selected.body)) throw new Error('Actual browser pause disagrees with the exact network response');
      const result = await this.requireCdp('browser').request('Runtime.evaluate', { expression: 'JSON.stringify({cartCount:Number(document.querySelector("#count").textContent),completedClicks:Number(document.querySelector("#clicks").textContent)})', returnByValue: true });
      this.assertAlive(); const observed: { cartCount: number; completedClicks: number } = JSON.parse(result.result.value);
      if (observed.cartCount !== 1 || observed.completedClicks !== 1) throw new Error('Visible result differs from one completed cart click');
      this.network!.closeSet(); this.observed = observed;
      const screen = this.evidence.record('screen.observed', { sessionId: browser.selected!.id, snapshotId: browser.snapshot.id, observed });
      const references = [[this.operation!.id, network.selected.requestId], [network.selected.requestId, server.snapshot.id], [server.snapshot.id, network.selected.bodyHash!], [network.selected.bodyHash!, browser.snapshot.id], [browser.snapshot.id, `event:${screen.sequence}`]];
      this.links.forEach((link, index) => { link.status = 'observed'; link.evidence = references[index]!; });
      await this.browser?.reveal(this.abort.signal); this.assertAlive();
      await this.capture('after'); this.assertAlive();
      this.status = 'completed'; this.evidence.record('run.candidate-completed', { expectedSetClosed: true, observed }); await this.persist();
    } finally { this.finalizing = false; }
  }

  /** Captures current pixels independently of protocol input and invalidates references when its pause changes. @example await this.capture('paused-server', 'server', pause) */
  private async capture(phase: string, name?: ParticipantName, pause?: PauseIdentity): Promise<void> {
    const capture: Capture = this.captures[phase] = { status: 'pending' };
    const assertCurrent = () => { this.assertAlive(); if (name && pause && !this.participants[name].gate.matches(pause)) throw new Error('Captured frame no longer belongs to its pause'); };
    this.evidence.record('capture.requested', { phase, pause });
    try {
      const result = await this.requireCdp('browser').request('Page.captureScreenshot', { format: 'png' }, CAPTURE_TIMEOUT_MS, this.scenario === 'capture-timeout' && phase === 'paused-server' ? INJECTED_DELAY_MS : 0);
      assertCurrent(); await this.evidence.save(`${phase}.png`, Buffer.from(result.data, 'base64')); assertCurrent();
      capture.file = `${phase}.png`; this.evidence.record('capture.pixels-saved', { phase, pause, file: capture.file });
      await this.browser?.reveal(this.abort.signal); assertCurrent();
      capture.renderer = await this.browser?.presentCapture(result.data, phase); assertCurrent();
      capture.status = 'captured'; capture.file = `${phase}.png`; this.evidence.record('capture.received', { phase, pause, renderer: capture.renderer });
    } catch (error) { capture.status = 'failed'; capture.error = String(error); capture.renderer = undefined; this.evidence.record('capture.failed', { phase, reason: String(error) }); }
  }

  /** Returns explicit participant identities and immutable references for the control runner, without tokens. @example run.view().participants.server.pause */
  view() {
    const participantView = (name: ParticipantName) => { const participant = this.participants[name]; return { sessionId: participant.selected?.id, pause: participant.gate.current, phase: participant.gate.phase, snapshot: participant.snapshot, continued: participant.continued, conflict: participant.gate.conflict }; };
    const runtimeOutcome = this.status === 'completed' && !this.failures.length ? 'demonstrated' : 'not-demonstrated';
    const captureOutcome = REQUIRED_CAPTURE_PHASES.every(phase => this.captures[phase]?.status === 'captured' && this.captures[phase]?.file && this.captures[phase]?.renderer) ? 'demonstrated' : 'incomplete';
    const finalOutcome = !this.cleaned ? 'pending-teardown' : runtimeOutcome !== 'demonstrated' ? 'not-demonstrated' : captureOutcome === 'demonstrated' ? 'demonstrated' : 'partial';
    return { runId: this.id, scenario: this.scenario, status: this.status, cleaned: this.cleaned, runtimeOutcome, captureOutcome, finalOutcome, participants: { server: participantView('server'), browser: participantView('browser') }, operation: this.operation, observed: this.observed, network: this.network && { requests: [...this.network.requests.values()], closed: this.network.closed, errors: this.network.errors }, links: this.links, captures: this.captures, failures: this.failures, events: this.evidence.events, artifactDirectory: this.evidence.directory, activeSessionIds: [...this.activeSessions], backend: this.endpoint };
  }

  /** Prevents incomplete or contradictory observations becoming a final success, including late extras after candidate completion. @example run.fail('ambiguous request') */
  fail(reason: string): void {
    if (this.cleaning) return;
    if (!this.failures.includes(reason)) { this.failures.push(reason); this.evidence.record('run.failed', { reason }); }
    this.status = 'failed'; this.abort.abort(new Error(reason)); this.browser?.resumeViewport();
    for (const name of PARTICIPANTS) this.participants[name].gate.invalidate();
    for (const link of this.links) if (link.status !== 'observed') link.status = reason.includes('Ambiguous') ? 'ambiguous' : 'mismatched';
    void this.persist().catch(error => { this.evidence.failure = String(error); });
    // Client loss must not leave a failed owned debugger/browser alive; explicit DELETE can retry a failed release.
    this.evidence.record('cleanup.auto-requested');
    void this.cleanup().catch(error => console.error('Automatic paired cleanup incomplete', error));
  }

  /** Persists qualified evidence; final outcome requires settled owned teardown, not only candidate completion. @example await run.persist() */
  async persist(): Promise<void> {
    await this.evidence.save('manifest.json', { ...this.view(), events: undefined, environment: { host: this.config.host, api: vscode.version, node: process.versions.node, jsDebug: vscode.extensions.getExtension('ms-vscode.js-debug')?.packageJSON.version }, revision: this.config.revision, dirty: this.config.dirty, sourceHash: this.config.sourceHash, nativePresentationVerified: false });
    await this.evidence.flush();
  }

  /** Shares simultaneous deletes, allowing a later retry if cleanup remains incomplete. @example await run.cleanup() */
  async cleanup(): Promise<void> {
    const attempt = this.cleanupPromise ??= this.cleanupOwned();
    try { await attempt; } catch (error) { if (this.cleanupPromise === attempt) this.cleanupPromise = undefined; throw error; }
  }

  /** Drains acquisitions and independently releases both selected targets; teardown never resumes another debugger. @example await this.cleanupOwned() */
  private async cleanupOwned(): Promise<void> {
    this.cleaning = true; clearInterval(this.watchdog); this.abort.abort(new Error('Run cleanup'));
    if (!['completed', 'failed'].includes(this.status)) this.status = 'cancelled';
    for (const name of PARTICIPANTS) this.participants[name].gate.invalidate();
    this.browser?.resumeViewport(); this.evidence.record('cleanup.started');
    const failures = await settleCleanup([
      { description: 'preparation settlement', release: () => awaitResponse(this.preparePromise?.catch(() => undefined) ?? Promise.resolve(), 'preparation settlement') },
      { description: 'Node acquisition', release: () => awaitResponse<unknown>(this.nodeLaunch?.catch(() => undefined) ?? Promise.resolve(), 'Node acquisition') },
      { description: 'browser acquisitions', release: () => this.browser?.drainAcquisitions() },
    ]);
    failures.push(...await settleCleanup([{ description: 'backend identity recovery', release: async () => {
      // A cancelled prepare may never adopt the listener file even though its launch succeeded.
      if (this.nodeLaunch && !this.endpoint) {
        this.endpoint = await readBackendEndpoint(this.evidence.directory, this.id);
        if (this.endpoint) this.evidence.record('backend.endpoint-recovered', this.endpoint);
      }
    } }]));
    if (this.scenario === 'late-request' && this.status === 'completed') {
      // Send one fixed fixture fault while observers still exist, proving final teardown can revoke a candidate.
      failures.push(...await settleCleanup([{ description: 'late-request fault observation', release: async () => {
        this.evidence.record('fault.late-request');
        await this.requireCdp('browser').request('Runtime.evaluate', { expression: 'void fetch("api/cart", {method:"POST", headers:{"content-type":"application/json","x-codebook-operation":document.documentElement.dataset.runId},body:JSON.stringify({cartId:"selected",productId:"tote-01",price:24})})' });
        await waitUntil(() => this.network?.errors.some(error => error.includes('after the expected observation set closed')), 'late request invalidation', CAPTURE_TIMEOUT_MS);
      } }]));
    }
    failures.push(...await settleCleanup(PARTICIPANTS.flatMap(name => [
      { description: `${name} CDP close`, release: () => this.participants[name].cdp?.close() },
      { description: `${name} breakpoint removal`, release: () => { const breakpoint = this.participants[name].breakpoint; if (breakpoint) vscode.debug.removeBreakpoints([breakpoint]); } },
    ])));
    failures.push(...await settleCleanup([...this.sessions.values()].filter(({ session }) => !session.parentSession && this.activeSessions.has(session.id)).map(({ session }) => ({ description: 'owned debug root stop', release: () => awaitResponse(vscode.debug.stopDebugging(session), 'owned root stop') }))));
    const sourcePaths = PARTICIPANTS.map(name => this.participants[name].source?.sourcePath);
    failures.push(...await settleCleanup([{ description: 'owned source editors close', release: async () => {
      const sourceTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText && sourcePaths.includes(tab.input.uri.fsPath));
      // Resolve all tab handles in one host call; closing one tab can replace the remaining API objects.
      if (sourceTabs.length && !await awaitResponse(vscode.window.tabGroups.close(sourceTabs), 'owned source editors close')) throw new Error('Host did not close owned source tabs');
      if (vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && sourcePaths.includes(tab.input.uri.fsPath)))) throw new Error('Owned source tab remains after close');
    } }]));
    failures.push(...await settleCleanup([
      { description: 'owned browser close', release: () => this.browser?.close() },
      { description: 'runtime activities settle', release: () => awaitResponse(Promise.all(this.activities), 'runtime activities') },
      { description: 'all owned sessions exit', release: () => waitUntil(() => this.activeSessions.size === 0, 'owned sessions exit', CAPTURE_TIMEOUT_MS) },
      { description: 'backend listener exit', release: async () => {
        if (this.nodeLaunch && !this.endpoint) this.endpoint = await readBackendEndpoint(this.evidence.directory, this.id);
        if (this.endpoint) await waitUntil(() => isEndpointClosed(this.endpoint!.origin), 'backend listener refused');
      } },
      { description: 'backend process exit', release: async () => {
        if (this.endpoint) await waitUntil(() => { try { process.kill(this.endpoint!.pid, 0); return false; } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') return true; throw error; } }, 'owned backend PID absent');
        if (this.nodeLaunch) {
          await waitUntil(async () => (await backendProcesses(join(this.evidence.directory, 'build/server.mjs'))).length === 0, 'owned backend program absent');
          this.evidence.record('backend.program-absent', { program: 'build/server.mjs', endpointPublished: Boolean(this.endpoint) });
        }
      } },
    ]));
    if (failures.length) { this.failures.push(...failures.map(reason => `Cleanup incomplete: ${reason}`)); this.evidence.record('cleanup.failed', { failures }); }
    else this.evidence.record('cleanup.completed', { backendObservation: this.endpoint ? 'pid-and-program-verified' : this.nodeLaunch ? 'program-verified-endpoint-unpublished' : 'not-launched', backendProcessAbsent: this.endpoint || this.nodeLaunch ? true : undefined, backendListenerRefused: this.endpoint ? true : undefined });
    this.cleaned = failures.length === 0; await this.persist();
    if (failures.length) throw new Error(failures.join('; '));
  }

  /** Rejects stale asynchronous work after any failed or cancelled lifecycle. @example this.assertAlive() */
  private assertAlive(): void { this.abort.signal.throwIfAborted(); if (this.cleaning || this.status === 'failed') throw new Error('Run is no longer active'); }
  /** Requires an explicitly adopted participant proxy at call sites. @example this.requireCdp('server') */
  private requireCdp(name: ParticipantName): Cdp { const cdp = this.participants[name].cdp; if (!cdp) throw new Error(`Missing selected ${name} CDP`); return cdp; }
  /** Tracks independent lanes for complete teardown and routes their failures to the run. @example this.track(this.click()) */
  private track(activity: Promise<unknown>): void {
    const tracked = activity.then(() => undefined, error => this.fail(String(error))).finally(() => this.activities.delete(tracked));
    this.activities.add(tracked);
  }
}
