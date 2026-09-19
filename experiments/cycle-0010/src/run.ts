import * as vscode from 'vscode';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DebugProtocol } from '@vscode/debugprotocol';
import type { Protocol } from 'devtools-protocol';
import { Cdp } from 'codebook-cycle-0001/dist/cdp';
import { Evidence } from 'codebook-cycle-0001/dist/evidence';
import { HostBrowser, type HostConfiguration } from 'codebook-cycle-0001/dist/hostBrowser';
import { PauseGate, type PauseIdentity } from 'codebook-cycle-0001/dist/pauseGate';
import { ACTIVE_TIMEOUT_MS, CAPTURE_TIMEOUT_MS, RESUME_COMMANDS } from 'codebook-cycle-0001/dist/constants';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { settleCleanup } from 'codebook-cycle-0001/dist/utils/settleCleanup';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { EVIDENCE_EVENT_LIMIT, EVIDENCE_LIMIT_BYTES, EXPECTED_VALUES, OPTIONAL_EXPRESSIONS, RUN_TIMEOUT_MS, SCRIPT_DIAGNOSTIC_LIMIT, SETUP_TIMEOUT_MS, STACK_FRAME_LIMIT, TARGET_SOURCE_COLUMN, TARGET_SOURCE_LINE } from './constants';
import { createBundleVerifier } from './utils/createBundleVerifier';
import { readDevelopmentBundle } from './utils/readDevelopmentBundle';
import { launchDevelopmentServer } from './utils/launchDevelopmentServer';
import { sameScriptUrl } from './utils/sameScriptUrl';

export interface RepositoryConfig { directory: string; target: string; node: string; host: HostConfiguration; revision: string; sourceFingerprint: string }
type Source = Awaited<ReturnType<typeof readDevelopmentBundle>>['bundle'];
interface Snapshot { id: string; pause: PauseIdentity; frame: DebugProtocol.StackFrame; values: Record<string, unknown>; evaluations: { expression: string; response: Protocol.Debugger.EvaluateOnCallFrameResponse }[]; source: ReturnType<ReturnType<typeof createBundleVerifier>['verify']> }

/** Owns one unchanged repository action for the private bootstrap; actual debugger events alone grant pause authority. @example await new RepositoryRun(config).prepare() */
export class RepositoryRun {
  readonly id = randomUUID();
  readonly gate = new PauseGate();
  readonly evidence: Evidence;
  readonly sessions = new Map<string, vscode.DebugSession>();
  private readonly activeSessions = new Set<string>();
  private readonly activities = new Set<Promise<void>>();
  private readonly acquisitions = new Set<Promise<unknown>>();
  private readonly abort = new AbortController();
  private readonly browser: HostBrowser;
  private app?: ReturnType<typeof launchDevelopmentServer>;
  private preparation?: Promise<void>;
  private cleanupPromise?: Promise<void>;
  private selected?: vscode.DebugSession;
  private cdp?: Cdp;
  private source?: Source;
  private verifier?: ReturnType<typeof createBundleVerifier>;
  private script?: Protocol.Debugger.ScriptParsedEvent;
  private stopped?: { event: Protocol.Debugger.PausedEvent; generation?: number };
  private breakpoint?: vscode.SourceBreakpoint;
  private continuation?: PauseIdentity;
  private expectedResumeRequests = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private cleaning = false;
  private cleaned = false;
  private drifted = false;
  private status = 'preparing';
  private origin?: string;
  private operation?: { key: string; acknowledged: boolean };
  private snapshot?: Snapshot;
  private readonly failures: string[] = [];
  private readonly captures: Record<string, { file: string; hash: string; renderer?: { epoch: string; id: number; hash: string } }> = {};

  constructor(readonly config: RepositoryConfig) {
    this.evidence = new Evidence(join(config.directory, this.id), { maxEvents: EVIDENCE_EVENT_LIMIT, retainedBytes: EVIDENCE_LIMIT_BYTES, queuedBytes: EVIDENCE_LIMIT_BYTES });
    this.browser = new HostBrowser(config.host, this.id, 'about:blank', (type, detail) => this.evidence.record(type, detail), 'normal', reason => this.fail(reason));
  }

  /** Limits tracker ownership to a configured root and descendants, never editor focus. @example run.owns(unrelated) // false */
  owns(session: vscode.DebugSession): boolean {
    for (let ancestor: vscode.DebugSession | undefined = session; ancestor; ancestor = ancestor.parentSession) if (ancestor.configuration.name === `codebook repository ${this.id}`) return true;
    return false;
  }

  /** Adopts late acquired owned sessions so cancelled preparation cannot leak a debugger. @example run.addSession(child) */
  addSession(session: vscode.DebugSession): void {
    this.sessions.set(session.id, session); this.activeSessions.add(session.id);
    this.evidence.record('session.started', { sessionId: session.id, parentId: session.parentSession?.id });
    if (this.cleaning) this.track(Promise.resolve(vscode.debug.stopDebugging(session)));
  }

  /** Shares one preparation and preserves its settlement handle for cancellation. @example await run.prepare() */
  prepare(): Promise<void> { return this.preparation ??= this.prepareOwned(); }

  /** Freezes the served module before navigation/input, called only through {@link prepare}. @example await this.prepareOwned() */
  private async prepareOwned(): Promise<void> {
    this.timer = setTimeout(() => this.fail('Setup deadline exceeded'), SETUP_TIMEOUT_MS);
    await this.evidence.initialize(); this.alive();
    this.app = launchDevelopmentServer(this.config.target, this.config.node, (type, detail) => this.evidence.record(type, detail));
    this.origin = await this.app.ready(this.abort.signal); this.alive();
    const acquired = await readDevelopmentBundle(this.config.target); this.alive();
    this.source = acquired.bundle; this.verifier = createBundleVerifier(this.source);
    await this.evidence.save('sealed-source.tsx', this.source.source);
    await this.evidence.save('sealed-module.js', this.source.javascript);
    await this.evidence.save('sealed-module.map.json', this.source.sourceMap);
    this.evidence.record('source.sealed', { ...this.verifier.hashes, discovery: acquired.discovery, scriptUrl: this.source.scriptUrl, chunkHash: this.source.chunkHash });
    this.alive();
    await this.acquire(vscode.window.showTextDocument(vscode.Uri.file(this.source.sourcePath), { viewColumn: vscode.ViewColumn.Two, preserveFocus: true, preview: false }));
    this.alive();
    this.breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(this.source.sourcePath), new vscode.Position(TARGET_SOURCE_LINE - 1, TARGET_SOURCE_COLUMN - 1)));
    vscode.debug.addBreakpoints([this.breakpoint]);
    await this.browser.launch({ name: `codebook repository ${this.id}`, type: 'pwa-chrome', request: 'launch', url: 'about:blank', webRoot: this.config.target,
      sourceMaps: true, sourceMapPathOverrides: { 'webpack://_N_E/./*': `${this.config.target}/*` }, timeout: ACTIVE_TIMEOUT_MS }, this.abort.signal);
    this.alive();
    await this.selectPage(); this.alive();
    const cdp = this.requireCdp();
    cdp.onClose = () => { if (!this.cleaning) this.fail('Selected CDP closed'); };
    let observedScripts = 0;
    cdp.on('Debugger.scriptParsed', event => {
      // Bound diagnostic metadata identifies the actual emitted URL without retaining unrelated source bodies.
      if (observedScripts++ < SCRIPT_DIAGNOSTIC_LIMIT) this.evidence.record('script.observed', { scriptId: event.scriptId, url: event.url, executionContextId: event.executionContextId });
      if (!event.url || !sameScriptUrl(this.source!.scriptUrl, event.url)) return;
      if (this.script && this.script.scriptId !== event.scriptId) { this.fail('Selected module changed after sealing'); return; }
      this.script = event; this.evidence.record('script.selected', { scriptId: event.scriptId, url: event.url, executionContextId: event.executionContextId });
    });
    cdp.on('Debugger.paused', event => { this.stopped = { event }; });
    cdp.on('Debugger.resumed', () => { this.stopped = undefined; });
    await cdp.subscribe(['Debugger.scriptParsed', 'Debugger.paused', 'Debugger.resumed']);
    await this.browser.attachViewport(cdp, this.abort.signal); this.alive();
    await cdp.request('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.origin === ${JSON.stringify(this.origin)}) localStorage.setItem('theme', 'light');` });
    await cdp.request('Page.navigate', { url: `${this.origin}/` });
    await waitUntil(() => this.script, 'selected repository module', ACTIVE_TIMEOUT_MS, this.abort.signal);
    await waitUntil(async () => (await cdp.request('Runtime.evaluate', { expression: 'Boolean(document.querySelector(\'button[aria-label="Switch to dark theme"]\')) && document.documentElement.classList.contains("light")', returnByValue: true })).result.value === true, 'hydrated light theme', ACTIVE_TIMEOUT_MS, this.abort.signal);
    const executed = await cdp.request('Debugger.getScriptSource', { scriptId: this.script!.scriptId }); this.alive();
    if (sha256(executed.scriptSource) !== this.verifier.hashes.javascript) throw new Error('Pre-input executed module differs from sealed bundle');
    const binding = await waitUntil(async () => { const result = await awaitResponse(this.selected!.getDebugProtocolBreakpoint(this.breakpoint!), 'repository binding', this.abort.signal); return result && 'verified' in result && result.verified === true ? result : undefined; }, 'repository breakpoint binding', ACTIVE_TIMEOUT_MS, this.abort.signal);
    this.evidence.record('breakpoint.bound', binding);
    this.evidence.record('target.selected', { sessionId: this.selected!.id, target: await cdp.request('Target.getTargetInfo', {}), scriptId: this.script!.scriptId, origin: this.origin });
    await this.browser.reveal(this.abort.signal);
    await vscode.commands.executeCommand('notifications.hideToasts');
    await this.capture('before'); this.alive();
    clearTimeout(this.timer); this.timer = setTimeout(() => this.fail('Run deadline exceeded without input retry'), RUN_TIMEOUT_MS);
    this.status = 'ready'; await this.persist();
  }

  /** Adopts only a unique owned blank page; setup navigates it after event subscriptions exist. @example await this.selectPage() */
  private async selectPage(): Promise<void> {
    await waitUntil(async () => {
      const matches: { session: vscode.DebugSession; cdp: Cdp }[] = [];
      for (const session of this.sessions.values()) {
        if (!session.parentSession) continue;
        let candidate: Cdp | undefined;
        try {
          const proxy: { host: string; port: number; path: string } = await awaitResponse(session.customRequest('requestCDPProxy'), 'owned proxy', this.abort.signal);
          candidate = await this.acquire(Cdp.connect(`ws://${proxy.host}:${proxy.port}${proxy.path}`, (type, detail) => this.evidence.record(type, detail))); this.alive();
          const result = await candidate.request('Runtime.evaluate', { expression: 'location.href', returnByValue: true }); this.alive();
          if (result.result.value === 'about:blank') matches.push({ session, cdp: candidate });
        } catch (error) { if (this.abort.signal.aborted) throw error; }
        finally { if (candidate && !matches.some(match => match.cdp === candidate)) candidate.close(); }
      }
      if (matches.length !== 1) { for (const match of matches) match.cdp.close(); if (matches.length > 1) throw new Error('Ambiguous owned page'); return false; }
      this.selected = matches[0]!.session; this.cdp = matches[0]!.cdp; return true;
    }, 'unique owned page', ACTIVE_TIMEOUT_MS, this.abort.signal);
  }

  /** Accepts one idempotent input without waiting for a handler paused in Chrome. @example run.click('toggle-once') */
  click(key: string) {
    if (this.operation?.key === key) return { accepted: false, key };
    if (this.operation || this.cleaning || this.status !== 'ready') throw new Error('conflict: input already exists or run unavailable');
    this.operation = { key, acknowledged: false }; this.status = 'acting';
    this.evidence.record('input.accepted', { key }); this.track(this.dispatchInput());
    return { accepted: true, key };
  }

  /** Sends one real pointer press/release to the existing button after {@link click} reserves it. @example await this.dispatchInput() */
  private async dispatchInput(): Promise<void> {
    const cdp = this.requireCdp();
    const result = await cdp.request('Runtime.evaluate', { expression: 'JSON.stringify((() => { const button = document.querySelector(\'button[aria-label="Switch to dark theme"]\'); const rect = button.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })())', returnByValue: true });
    const coordinates: { x: number; y: number } = JSON.parse(result.result.value);
    this.alive(); if (!Number.isFinite(coordinates.x) || !Number.isFinite(coordinates.y)) throw new Error('Invalid button coordinates');
    this.evidence.record('input.dispatched', { ...coordinates, key: this.operation!.key });
    await cdp.request('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...coordinates }, RUN_TIMEOUT_MS);
    this.alive();
    await cdp.request('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...coordinates }, RUN_TIMEOUT_MS);
    this.alive(); this.operation!.acknowledged = true; this.evidence.record('input.acknowledged');
  }

  /** Invalidates authority before unexpected outgoing DAP resume requests can change execution. @example run.onRequest(selected, request) */
  onRequest(session: vscode.DebugSession, request: DebugProtocol.Request): void {
    if (session.id !== this.selected?.id || !RESUME_COMMANDS.has(request.command)) return;
    const expected = request.command === 'continue' && this.expectedResumeRequests > 0;
    if (expected) this.expectedResumeRequests -= 1;
    this.gate.invalidate(!expected); this.browser.resumeViewport();
    if (!expected) this.fail('Manual or competing resume invalidated live pause');
  }

  /** Pairs actual selected DAP stops with source-matching CDP events, independent of input ACKs. @example run.onEvent(selected, stopped) */
  onEvent(session: vscode.DebugSession, event: DebugProtocol.Event): void {
    if (this.cleaning || session.id !== this.selected?.id) return;
    if (event.event === 'stopped') {
      const body: DebugProtocol.StoppedEvent['body'] = event.body;
      if (!Number.isInteger(body.threadId) || !this.operation) { this.fail('Unexpected repository stop'); return; }
      this.status = 'paused'; const pause = this.gate.stop(session.id, body.threadId!);
      this.evidence.record('dap.stopped', { ...pause, reason: body.reason });
      this.track(this.inspect(pause));
    } else if (event.event === 'continued' && this.operation) {
      if (!this.continuation || this.continuation.threadId !== event.body?.threadId || this.continuation.generation !== this.gate.generation) { this.fail('Unowned continuation invalidated live pause'); return; }
      this.continuation = undefined; this.gate.invalidate(); this.status = 'resuming'; this.browser.resumeViewport();
      this.track(this.observeAfter());
    }
  }

  /** Retires disappearing owned sessions and fails unexpected target termination. @example run.terminated(child) */
  terminated(session: vscode.DebugSession): void {
    this.activeSessions.delete(session.id); this.evidence.record('session.terminated', { sessionId: session.id });
    if (!this.cleaning && session.id === this.selected?.id) this.fail('Selected debugger terminated');
  }

  /** Captures exact source and actual closure primitives only while the same pause remains current. @example await this.inspect(pause) */
  private async inspect(pause: PauseIdentity): Promise<void> {
    const stopped = await waitUntil(() => {
      const candidate = this.stopped, frame = candidate?.event.callFrames[0];
      return candidate && candidate.generation === undefined && candidate.event.reason !== 'instrumentation' && frame?.location.scriptId === this.script?.scriptId ? candidate : undefined;
    }, 'source-bound CDP stop', CAPTURE_TIMEOUT_MS, this.abort.signal);
    const current = () => { this.alive(); if (!this.gate.matches(pause) || this.stopped !== stopped) throw new Error('Pause changed during inspection'); };
    current(); stopped.generation = pause.generation;
    const stack: DebugProtocol.StackTraceResponse['body'] = await awaitResponse(this.selected!.customRequest('stackTrace', { threadId: pause.threadId, startFrame: 0, levels: STACK_FRAME_LIMIT }), 'repository stack', this.abort.signal); current();
    const frame = stack.stackFrames[0], callFrame = stopped.event.callFrames[0]!;
    if (!frame?.source?.path || resolve(frame.source.path) !== this.source!.sourcePath || frame.line !== TARGET_SOURCE_LINE) throw new Error('DAP frame differs from exact repository source');
    const executed = await this.requireCdp().request('Debugger.getScriptSource', { scriptId: callFrame.location.scriptId }); current();
    const local = await readFile(this.source!.sourcePath, 'utf8'); current();
    const source = this.verifier!.verify(executed.scriptSource, local, callFrame.location, this.script!.scriptId, frame.line, frame.column);
    const values: Snapshot['values'] = {}, evaluations: Snapshot['evaluations'] = [];
    for (const [expression, expected] of Object.entries(EXPECTED_VALUES)) {
      const response = await this.requireCdp().request('Debugger.evaluateOnCallFrame', { callFrameId: callFrame.callFrameId, expression, returnByValue: true, throwOnSideEffect: true }); current();
      evaluations.push({ expression, response });
      if (response.exceptionDetails || response.result.value !== expected) throw new Error(`Required captured ${expression} is unavailable or differs from expectation`);
      values[expression] = response.result.value;
    }
    // Surrounding render locals may be optimized away; record absence instead of substituting source/DOM inference.
    for (const expression of OPTIONAL_EXPRESSIONS) {
      const response = await this.requireCdp().request('Debugger.evaluateOnCallFrame', { callFrameId: callFrame.callFrameId, expression, returnByValue: true, throwOnSideEffect: true }); current();
      evaluations.push({ expression, response });
      values[expression] = response.exceptionDetails ? { unavailable: response.exceptionDetails.text } : response.result.value ?? { unavailable: 'No primitive value at this frame' };
    }
    const snapshot: Snapshot = { id: randomUUID(), pause, frame, source, values, evaluations };
    await this.evidence.save('snapshot.json', snapshot); current(); this.snapshot = snapshot;
    this.evidence.record('snapshot.committed', { snapshotId: snapshot.id, pause });
    await this.capture('paused-1', pause); current(); await this.persist();
  }

  /** Reserves exact authority synchronously, then checks raw source again before continuing once. @example await run.continue(currentPause) */
  async continue(pause: PauseIdentity): Promise<void> {
    if (this.cleaning || !this.snapshot || !this.gate.reserve(pause)) throw new Error('conflict: stale, foreign or already reserved pause');
    const local = await readFile(this.source!.sourcePath, 'utf8'); this.alive();
    if (sha256(local) !== this.verifier!.hashes.typescript || this.gate.phase !== 'resume-requested' || this.gate.current?.generation !== pause.generation) { this.fail('Source or pause changed before continue'); throw new Error('conflict: changed source or pause'); }
    this.continuation = pause; this.expectedResumeRequests += 1;
    this.evidence.record('continue.accepted', pause);
    try { await awaitResponse(this.selected!.customRequest('continue', { threadId: pause.threadId }), 'repository continue', this.abort.signal); }
    catch (error) { this.fail(`Continue uncertain: ${String(error)}`); throw error; }
  }

  /** Confirms the existing DOM after the owned continuation, then records its actual pixels. @example await this.observeAfter() */
  private async observeAfter(): Promise<void> {
    await waitUntil(async () => (await this.requireCdp().request('Runtime.evaluate', { expression: 'document.documentElement.classList.contains("dark") && Boolean(document.querySelector(\'button[aria-label="Switch to light theme"]\'))', returnByValue: true })).result.value === true, 'visible dark theme', ACTIVE_TIMEOUT_MS, this.abort.signal);
    await waitUntil(() => this.operation?.acknowledged, 'single input acknowledgement', ACTIVE_TIMEOUT_MS, this.abort.signal);
    await this.capture('after'); this.alive(); this.status = 'observed'; await this.persist();
  }

  /** Saves a phase image and exact native renderer receipt, called before, during and after the action. @example await this.capture('before') */
  private async capture(phase: string, pause?: PauseIdentity): Promise<void> {
    const result = await this.requireCdp().request('Page.captureScreenshot', { format: 'png' }, CAPTURE_TIMEOUT_MS); this.alive();
    if (pause && !this.gate.matches(pause)) throw new Error('Pause image is stale');
    const file = `${phase}.png`; await this.evidence.save(file, Buffer.from(result.data, 'base64'));
    const renderer = await this.browser.presentCapture(result.data, phase); this.alive();
    if (pause && !this.gate.matches(pause)) throw new Error('Rendered pause image is stale');
    this.captures[phase] = { file, hash: sha256(Buffer.from(result.data, 'base64')), renderer };
    this.evidence.record('capture.committed', { phase, ...this.captures[phase] });
  }

  /** Runs deliberate native interference only through private QA commands. @example await run.interfere('manual-resume') */
  async interfere(action: 'manual-resume' | 'source-drift'): Promise<void> {
    if (!this.gate.current || !this.snapshot) throw new Error('Interference requires a captured pause');
    if (action === 'manual-resume') await this.selected!.customRequest('continue', { threadId: this.gate.current.threadId });
    else { this.drifted = true; await writeFile(this.source!.sourcePath, `${this.source!.source}\n// Isolated source-drift negative test.\n`); }
  }

  /** Exposes bounded historical/current facts to the private command bootstrap. @example run.view().status */
  view() {
    return { runId: this.id, status: this.status, cleaned: this.cleaned, pause: this.gate.current, snapshot: this.snapshot,
      operation: this.operation, captures: this.captures, failures: [...this.failures], artifactDirectory: this.evidence.directory,
      resources: { activeSessionIds: [...this.activeSessions], cdpOpen: Boolean(this.cdp && !this.cdp.closed) }, origin: this.origin };
  }

  /** Revokes live control and starts owned cleanup once, preserving historical partial evidence. @example run.fail('map changed') */
  fail(reason: string): void {
    if (this.cleaning) return;
    this.failures.push(reason); this.status = 'failed'; this.gate.invalidate(true); this.evidence.record('run.failed', { reason });
    // Yield until the failing activity can settle; cleanup never waits on protocol work before closing CDP.
    queueMicrotask(() => { void this.cleanup().catch(error => this.failures.push(String(error))); });
  }

  /** Shares cleanup so cancellation can reject pending input before awaiting its settlement. @example await run.cleanup() */
  cleanup(): Promise<void> { return this.cleanupPromise ??= this.cleanupOwned(); }

  /** Executes the reviewed acquisition → close → settlement ordering and publishes success only after persistence. @example await this.cleanupOwned() */
  private async cleanupOwned(): Promise<void> {
    this.cleaning = true; this.abort.abort(); this.gate.invalidate(); this.browser.resumeViewport(); clearTimeout(this.timer);
    if (!['failed', 'observed'].includes(this.status)) this.status = 'cancelled';
    const failures = await settleCleanup([
      { description: 'preparation settle', release: () => awaitResponse(this.preparation?.catch(() => undefined) ?? Promise.resolve(), 'repository preparation') },
      { description: 'browser acquisitions', release: () => this.browser.drainAcquisitions() },
      { description: 'source/proxy acquisitions', release: () => awaitResponse(Promise.allSettled(this.acquisitions), 'repository acquisitions') },
      { description: 'selected CDP close', release: () => this.cdp?.close() },
      { description: 'owned breakpoint', release: () => { if (this.breakpoint) vscode.debug.removeBreakpoints([this.breakpoint]); } },
    ]);
    failures.push(...await settleCleanup([...this.sessions.values()].filter(session => !session.parentSession && this.activeSessions.has(session.id)).map(session => ({ description: 'owned debugger stop', release: () => awaitResponse(vscode.debug.stopDebugging(session), 'repository debugger stop') }))));
    failures.push(...await settleCleanup([
      { description: 'owned application stop', release: () => this.app?.close() },
      { description: 'protocol activities settle', release: () => awaitResponse(Promise.allSettled(this.activities), 'repository protocol activities') },
      { description: 'owned browser close', release: () => this.browser.close() },
      { description: 'owned source editor close', release: async () => {
        const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === this.source?.sourcePath);
        if (tabs.length && !await awaitResponse(vscode.window.tabGroups.close(tabs), 'repository source tabs')) throw new Error('Owned source editor remains');
      } },
      { description: 'owned sessions exit', release: () => waitUntil(() => !this.activeSessions.size, 'repository sessions exit', ACTIVE_TIMEOUT_MS) },
      { description: 'source drift restoration', release: async () => { if (this.drifted && this.source) await writeFile(this.source.sourcePath, this.source.source); } },
    ]));
    this.failures.push(...failures); this.cleaned = failures.length === 0;
    if (failures.length) this.status = 'failed';
    this.evidence.record('cleanup.completed', { released: this.cleaned, failures });
    try { await this.persist(); }
    catch (error) { this.cleaned = false; this.status = 'failed'; this.failures.push(`Final evidence persistence failed: ${String(error)}`); throw error; }
    if (failures.length) throw new Error(failures.join('; '));
  }

  /** Writes host-qualified evidence without upgrading observed to demonstrated before release/flush. @example await this.persist() */
  private async persist(): Promise<void> {
    await this.evidence.save('manifest.json', { ...this.view(), config: this.config, host: { appName: vscode.env.appName, apiVersion: vscode.version, node: process.versions.node, electron: process.versions.electron, debugger: vscode.extensions.getExtension('ms-vscode.js-debug')?.packageJSON.version }, expected: EXPECTED_VALUES, hashes: this.verifier?.hashes });
    await this.evidence.flush();
  }

  /** Rejects further work when cancelled or failed, used around every native/protocol await. @example this.alive() */
  private alive(): void { this.abort.signal.throwIfAborted(); if (this.cleaning || this.status === 'failed') throw new Error('Repository run is unavailable'); }

  /** Keeps protocol activities separate from non-cancellable acquisition handles for teardown. @example this.track(this.inspect(pause)) */
  private track(activity: Promise<void>): void { const tracked = activity.catch(error => { if (!this.cleaning) this.fail(String(error)); }).finally(() => this.activities.delete(tracked)); this.activities.add(tracked); }

  /** Retains raw acquisition settlement beyond cancellation for exact resource ownership. @example await this.acquire(showTextDocument(uri)) */
  private acquire<Value>(promise: PromiseLike<Value>): Promise<Value> { const pending = Promise.resolve(promise); this.acquisitions.add(pending); void pending.then(() => this.acquisitions.delete(pending), () => this.acquisitions.delete(pending)); return pending; }

  /** Requires the adopted page proxy instead of relying on editor focus. @example this.requireCdp().closed */
  private requireCdp(): Cdp { if (!this.cdp) throw new Error('Selected CDP unavailable'); return this.cdp; }
}
