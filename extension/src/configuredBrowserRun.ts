import * as vscode from 'vscode';
import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DebugProtocol } from '@vscode/debugprotocol';
import type { Protocol } from 'devtools-protocol';
import { Cdp } from 'codebook-cycle-0001/dist/cdp';
import { Evidence } from 'codebook-cycle-0001/dist/evidence';
import { HostBrowser, type HostConfiguration } from 'codebook-cycle-0001/dist/hostBrowser';
import type { BrowserViewportFactory } from 'codebook-cycle-0001/dist/browserViewport';
import { PauseGate, type PauseIdentity } from 'codebook-cycle-0001/dist/pauseGate';
import { CAPTURE_TIMEOUT_MS, RESUME_COMMANDS } from 'codebook-cycle-0001/dist/constants';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { settleCleanup } from 'codebook-cycle-0001/dist/utils/settleCleanup';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { ACTIVE_TIMEOUT_MS, CONFIGURED_CAPTURE_PHASES, MAX_EVENTS, MAX_QUEUED_EVIDENCE_BYTES, MAX_RETAINED_EVENT_BYTES, REPOSITORY_BROWSER_ACTION, REPOSITORY_BROWSER_PROFILE, REPOSITORY_PAUSE_HOLD_TIMEOUT_MS, REPOSITORY_RUN_TIMEOUT_MS, REPOSITORY_SCRIPT_DIAGNOSTIC_LIMIT, REPOSITORY_SETUP_TIMEOUT_MS, REPOSITORY_STACK_FRAME_LIMIT } from './constants';
import { configuredDefinitionSchema, type ConfiguredDefinition } from './configuredStudySchemas';
import type { ConfiguredRuntimeSnapshot, ConfiguredRuntimeView, RuntimeAction, RuntimeControl, RuntimeSnapshot, StudyRuntime } from './runtime';
import type { BundleSource } from './repositoryBundle';
import { RepositorySourceService } from './repositorySource';
import { OwnedRepositoryBreakpoint } from './ownedRepositoryBreakpoint';
import { StudyError } from './errors';
import { assertConfiguredDescriptor } from './utils/assertConfiguredDescriptor';
import { assertConfiguredSourceDocuments } from './utils/assertConfiguredSourceDocuments';
import { assertDevelopmentWorkspace, type DevelopmentLockIdentity } from './utils/assertDevelopmentWorkspace';
import { createBundleVerifier } from './utils/createBundleVerifier';
import { readDevelopmentBundle } from './utils/readDevelopmentBundle';
import { launchDevelopmentServer } from './utils/launchDevelopmentServer';
import { sameScriptUrl } from './utils/sameScriptUrl';
import { inspectConfiguredValues } from './utils/inspectConfiguredValues';
import { configuredDomExpression } from './utils/configuredDomExpression';

interface ConfiguredBrowserOptions {
  directory: string; workspace: string; node: string; host: HostConfiguration; definition: ConfiguredDefinition;
  assertWorkspace(): void; createViewport?: BrowserViewportFactory;
  revealSource(snapshot: ConfiguredRuntimeSnapshot): Promise<void>;
  control?: RuntimeControl;
}
type Continuation = { pause: PauseIdentity; response: boolean; dap: boolean; cdp: boolean; afterStarted: boolean };
const domResultSchema = z.object({ ready: z.boolean(), x: z.number().finite().optional(), y: z.number().finite().optional() });
const bindingSchema = z.object({ verified: z.literal(true), line: z.number().int(), column: z.number().int() });

/** Owns one configured browser operation and its exact source/pause receipts through the shared Study lifecycle. @example await new ConfiguredBrowserRun(options).prepare() */
export class ConfiguredBrowserRun implements StudyRuntime {
  readonly id = randomUUID();
  readonly evidence: Evidence;
  readonly definition: ConfiguredDefinition;
  readonly activeSessions = new Set<string>();
  private readonly sessions = new Map<string, vscode.DebugSession>();
  private readonly gate = new PauseGate();
  private readonly activities = new Set<Promise<void>>();
  private readonly acquisitions = new Set<Promise<unknown>>();
  private readonly abort = new AbortController();
  private readonly browser: HostBrowser;
  private readonly sources: RepositorySourceService;
  private preparedSources?: Awaited<ReturnType<RepositorySourceService['prepare']>>;
  private app?: ReturnType<typeof launchDevelopmentServer>;
  private ownedDevelopmentLock?: DevelopmentLockIdentity;
  private preparation?: Promise<void>;
  private cleanupPromise?: Promise<void>;
  private selected?: vscode.DebugSession;
  private cdp?: Cdp;
  private bundle?: BundleSource;
  private verifier?: ReturnType<typeof createBundleVerifier>;
  private manifest?: ConfiguredRuntimeView['manifest'];
  private script?: Protocol.Debugger.ScriptParsedEvent;
  private stopped?: { event: Protocol.Debugger.PausedEvent; generation?: number };
  private breakpoint?: OwnedRepositoryBreakpoint;
  private continuation?: Continuation;
  private acceptedStop = false;
  private expectedResumeRequests = 0;
  private progressTimer?: ReturnType<typeof setTimeout>;
  private runTimer?: ReturnType<typeof setTimeout>;
  private cleaning = false;
  private cleaned = false;
  private resourcesReleased = false;
  private status = 'preparing';
  private origin?: string;
  private operation?: ConfiguredRuntimeView['operation'];
  private snapshot?: ConfiguredRuntimeSnapshot;
  private snapshotReady = false;
  private readonly failures: string[] = [];
  private readonly captures: ConfiguredRuntimeView['captures'] = {};
  private readonly cancel = () => { void this.stop().catch(error => this.failures.push(String(error))); };

  constructor(readonly options: ConfiguredBrowserOptions) {
    options.control?.signal.throwIfAborted();
    this.definition = configuredDefinitionSchema.parse(options.definition);
    assertConfiguredDescriptor(this.definition.configuration, this.definition.descriptor);
    if (sha256(JSON.stringify(this.definition.configuration)) !== this.definition.configurationHash) throw new Error('Configured intent hash changed');
    this.evidence = new Evidence(join(options.directory, this.id), { maxEvents: MAX_EVENTS, retainedBytes: MAX_RETAINED_EVENT_BYTES, queuedBytes: MAX_QUEUED_EVIDENCE_BYTES });
    this.sources = new RepositorySourceService(options.workspace);
    this.browser = new HostBrowser(options.host, this.id, 'about:blank', (type, detail) => this.evidence.record(type, detail), 'normal', reason => this.fail(reason), options.createViewport);
    options.control?.signal.addEventListener('abort', this.cancel, { once: true });
  }

  /** Limits tracking to this launch's exact root and descendants, never the focused session. @example run.owner(unrelated) // false */
  owner(session: vscode.DebugSession): boolean {
    for (let ancestor: vscode.DebugSession | undefined = session; ancestor; ancestor = ancestor.parentSession) if (ancestor.configuration.name === `codebook repository ${this.id}`) return true;
    return false;
  }
  /** Supplies the exact Next lock only while this configured app is still running; status can recheck other prerequisites. @example run.ownsDevelopmentLock() // { dev, ino } */
  ownsDevelopmentLock(): DevelopmentLockIdentity | undefined {
    return !this.cleaning && !this.cleaned && this.app?.isRunning() ? this.ownedDevelopmentLock : undefined;
  }
  /** Adopts late debugger acquisitions before cancellation can finish. @example run.addSession(child) */
  addSession(session: vscode.DebugSession): void {
    this.sessions.set(session.id, session); this.activeSessions.add(session.id);
    this.evidence.record('session.started', { sessionId: session.id, parentId: session.parentSession?.id });
    if (this.cleaning) this.track(Promise.resolve(vscode.debug.stopDebugging(session)));
  }
  /** Retains one preparation barrier for service cancellation and final cleanup. @example await run.prepare() */
  prepare(): Promise<void> { return this.preparation ??= this.prepareOwned(); }

  /** Acquires source/build/browser in order while every returned resource remains owned across cancellation. @example await this.prepareOwned() */
  private async prepareOwned(): Promise<void> {
    const now = Date.now(), preparationDeadlineAt = this.options.control?.preparationDeadlineAt ?? now + REPOSITORY_SETUP_TIMEOUT_MS, deadlineAt = this.options.control?.deadlineAt ?? now + REPOSITORY_RUN_TIMEOUT_MS;
    if (now >= preparationDeadlineAt || now >= deadlineAt) throw new Error('Repository preparation deadline already expired');
    this.progressDeadline(preparationDeadlineAt - now, 'Repository setup deadline exceeded');
    this.runTimer = setTimeout(() => this.fail('Repository whole-run deadline exceeded'), deadlineAt - now);
    await this.evidence.initialize(); this.alive();
    this.preparedSources = await this.sources.prepare(this.definition.descriptor.anchors, { signal: this.abort.signal, deadlineAt }); this.alive();
    await this.verifySources(); await assertDevelopmentWorkspace(this.options.workspace, this.abort.signal); this.alive();
    this.app = launchDevelopmentServer(this.options.workspace, this.options.node, (type, detail) => this.evidence.record(type, detail));
    this.origin = await this.app.ready(this.abort.signal); this.alive();
    const developmentLock = await lstat(join(this.options.workspace, '.next/dev/lock')).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (developmentLock?.isFile() && !developmentLock.isSymbolicLink()) this.ownedDevelopmentLock = { dev: developmentLock.dev, ino: developmentLock.ino };
    const acquired = await readDevelopmentBundle(this.options.workspace, this.definition.configuration.source, this.abort.signal); this.alive();
    this.bundle = acquired.bundle; this.verifier = createBundleVerifier(this.bundle);
    await this.evidence.save('sealed-source.ts', this.bundle.source); this.alive();
    await this.evidence.save('sealed-module.js', this.bundle.javascript); this.alive();
    await this.evidence.save('sealed-module.map.json', this.bundle.sourceMap); this.alive();
    const { itemId, bookTitle, nodeTitle, anchors, citationContext } = this.definition.descriptor;
    const bound = { configurationHash: this.definition.configurationHash, configuration: this.definition.configuration, descriptor: { itemId, bookTitle, nodeTitle, anchors, citationContext }, itemId,
      sourceHash: this.verifier.hashes.typescript, javascriptHash: this.verifier.hashes.javascript, mapHash: this.verifier.hashes.sourceMap };
    this.manifest = { ...bound, hash: sha256(JSON.stringify(bound)) };
    this.evidence.record('source.sealed', { ...bound, discovery: acquired.discovery, scriptUrl: this.bundle.scriptUrl, chunkHash: this.bundle.chunkHash });
    // Raw source tabs are learner-owned; only a breakpoint is acquired here, never a file editor.
    const position = this.definition.configuration.source;
    this.breakpoint = new OwnedRepositoryBreakpoint(this.bundle.sourcePath, position.line, position.column);
    await this.browser.launch({ name: `codebook repository ${this.id}`, type: 'pwa-chrome', request: 'launch', url: 'about:blank', webRoot: this.options.workspace,
      sourceMaps: true, sourceMapPathOverrides: { 'webpack://_N_E/./*': `${this.options.workspace}/*` }, timeout: ACTIVE_TIMEOUT_MS }, this.abort.signal); this.alive();
    await this.selectPage(); this.alive();
    const cdp = this.requireCdp(); cdp.onClose = () => { if (!this.cleaning) this.fail('Selected CDP closed'); };
    cdp.aggregateScreencastTelemetry(() => this.evidence.elapsedMs());
    let observedScripts = 0;
    cdp.on('Debugger.scriptParsed', event => {
      if (observedScripts++ < REPOSITORY_SCRIPT_DIAGNOSTIC_LIMIT) this.evidence.record('script.observed', { scriptId: event.scriptId, url: event.url });
      if (!event.url || !sameScriptUrl(this.bundle!.scriptUrl, event.url)) return;
      if (this.script && this.script.scriptId !== event.scriptId) { this.fail('Selected module changed after sealing'); return; }
      this.script = event; this.evidence.record('script.selected', { scriptId: event.scriptId, url: event.url, executionContextId: event.executionContextId });
    });
    cdp.on('Debugger.paused', event => {
      if (this.cleaning) return;
      this.evidence.record('cdp.pause-observed', { reason: event.reason, scriptId: event.callFrames[0]?.location.scriptId, hitBreakpointCount: event.hitBreakpoints?.length, inputDispatched: this.operation?.inputDispatched ?? false });
      // Adapter setup stops have no learning operation; real pre-input DAP stops remain rejected by {@link onEvent}.
      if (event.reason === 'instrumentation' || !this.operation) return;
      if (this.stopped || this.snapshot || this.continuation) { this.fail('Additional browser stop invalidated the one-pause operation'); return; }
      this.stopped = { event };
    });
    cdp.on('Debugger.resumed', () => this.onCdpResumed());
    await cdp.subscribe(['Debugger.scriptParsed', 'Debugger.paused', 'Debugger.resumed']); this.alive();
    await this.browser.attachViewport(cdp, this.abort.signal); this.alive();
    const storage = this.definition.configuration.initialStorage ?? [];
    if (storage.length) { await cdp.request('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(this.origin)})for(const entry of ${JSON.stringify(storage)})localStorage.setItem(entry.key,entry.value);` }); this.alive(); }
    await cdp.request('Page.navigate', { url: `${this.origin}/` }); this.alive();
    await waitUntil(() => this.script, 'selected repository module', ACTIVE_TIMEOUT_MS, this.abort.signal);
    await this.waitForDom('before'); this.alive();
    const executed = await cdp.request('Debugger.getScriptSource', { scriptId: this.script!.scriptId }); this.alive();
    if (sha256(executed.scriptSource) !== this.verifier.hashes.javascript) throw new Error('Pre-input executed module differs from sealed bundle');
    const binding = await waitUntil(async () => {
      const result = await awaitResponse(this.selected!.getDebugProtocolBreakpoint(this.breakpoint!.breakpoint), 'repository binding', this.abort.signal);
      const parsed = bindingSchema.safeParse(result);
      return parsed.success && parsed.data.line === position.line && parsed.data.column === position.column ? parsed.data : undefined;
    }, 'exact repository breakpoint binding', ACTIVE_TIMEOUT_MS, this.abort.signal); this.alive();
    this.evidence.record('breakpoint.bound', binding); await this.verifySources();
    await this.browser.reveal(this.abort.signal); this.alive(); await this.capture('before'); this.alive();
    clearTimeout(this.progressTimer); this.status = 'ready'; await this.persist();
  }

  /** Selects exactly one blank descendant page and retains every provisional proxy until selection or release. @example await this.selectPage() */
  private async selectPage(): Promise<void> {
    await waitUntil(async () => {
      const matches: { session: vscode.DebugSession; cdp: Cdp }[] = [];
      try {
        for (const session of this.sessions.values()) {
          if (!session.parentSession || !this.activeSessions.has(session.id)) continue;
          let candidate: Cdp | undefined;
          try {
            const proxy: { host: string; port: number; path: string } = await awaitResponse(session.customRequest('requestCDPProxy'), 'owned proxy', this.abort.signal);
            candidate = await this.acquire(Cdp.connect(`ws://${proxy.host}:${proxy.port}${proxy.path}`, (type, detail) => this.evidence.record(type, detail))); this.alive();
            const result = await awaitResponse(candidate.request('Runtime.evaluate', { expression: 'location.href', returnByValue: true }), 'owned page identity', this.abort.signal); this.alive();
            if (result.result.value === 'about:blank') matches.push({ session, cdp: candidate });
          } catch (error) { if (this.abort.signal.aborted || this.cleaning) throw error; }
          finally { if (candidate && !matches.some(match => match.cdp === candidate)) candidate.close(); }
        }
        if (matches.length > 1) throw new Error('Ambiguous owned page');
        if (!matches[0]) return false;
        this.alive(); this.selected = matches[0].session; this.cdp = matches[0].cdp; return true;
      } finally { for (const match of matches) if (match.cdp !== this.cdp) match.cdp.close(); }
    }, 'unique owned page', ACTIVE_TIMEOUT_MS, this.abort.signal);
  }

  /** Reserves one declared input synchronously; its protocol ACK never blocks state or continuation. @example run.action('click-once', 'repository-click') */
  action(key: string, action: RuntimeAction) {
    if (this.operation?.key === key && action === REPOSITORY_BROWSER_ACTION) return { id: this.operation.id };
    if (action !== REPOSITORY_BROWSER_ACTION || this.operation || this.cleaning || this.status !== 'ready') throw new Error('conflict: wrong, repeated or unavailable input');
    this.alive(); this.operation = { id: randomUUID(), key, inputDispatched: false, inputAcknowledged: false, afterVerified: false }; this.status = 'acting';
    this.progressDeadline(ACTIVE_TIMEOUT_MS, 'Repository input reached no verified pause');
    this.evidence.record('input.accepted', { id: this.operation.id, key }); this.track(this.dispatchInput()); return { id: this.operation.id };
  }
  /** Verifies sources, exact origin and a unique enabled center immediately before the one mouse sequence. @example await this.dispatchInput() */
  private async dispatchInput(): Promise<void> {
    await this.verifySources();
    const target = await this.readDom('before'); this.alive();
    if (!target.ready || target.x === undefined || target.y === undefined) throw new Error('Click target or before conditions changed before input');
    this.operation!.inputDispatched = true; this.evidence.record('input.dispatched', { key: this.operation!.key, x: target.x, y: target.y });
    const cdp = this.requireCdp();
    await cdp.request('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: target.x, y: target.y }, REPOSITORY_RUN_TIMEOUT_MS); this.alive();
    await cdp.request('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: target.x, y: target.y }, REPOSITORY_RUN_TIMEOUT_MS); this.alive();
    this.operation!.inputAcknowledged = true; this.evidence.record('input.acknowledged');
  }

  /** Tracks owned removal requests while invalidating any unreserved selected-target resume. @example run.onRequest(session, request) */
  onRequest(session: vscode.DebugSession, request: DebugProtocol.Request): void {
    this.breakpoint?.onRequest(session, request);
    if (this.cleaning || session.id !== this.selected?.id || !RESUME_COMMANDS.has(request.command)) return;
    const expected = request.command === 'continue' && this.expectedResumeRequests > 0;
    if (expected) this.expectedResumeRequests--;
    this.gate.invalidate(!expected); this.browser.resumeViewport();
    if (!expected) this.fail('Manual or competing resume invalidated live pause');
  }
  /** Forwards real adapter ACKs to the owned breakpoint retirement barrier. @example run.onResponse(session, response) */
  onResponse(session: vscode.DebugSession, response: DebugProtocol.Response): void { this.breakpoint?.onResponse(session, response); }
  /** Reserves the sole stop before asynchronous inspection and requires the original authorized generation to resume. @example run.onEvent(selected, stopped) */
  onEvent(session: vscode.DebugSession, event: DebugProtocol.Event): void {
    if (this.cleaning || session.id !== this.selected?.id) return;
    if (event.event === 'stopped') {
      const body: DebugProtocol.StoppedEvent['body'] = event.body;
      if (!Number.isInteger(body.threadId) || !this.operation?.inputDispatched || this.acceptedStop) { this.fail('Unexpected or additional browser stop invalidated the one-pause operation'); return; }
      this.acceptedStop = true; const pause = this.gate.stop(session.id, body.threadId!); this.status = 'paused-browser';
      this.progressDeadline(REPOSITORY_PAUSE_HOLD_TIMEOUT_MS, 'Repository pause hold deadline exceeded');
      this.evidence.record('dap.stopped', { ...pause, reason: body.reason }); this.track(this.inspect(pause));
    } else if (event.event === 'continued' && this.operation) {
      const continuation = this.continuation;
      if (!continuation || continuation.dap || continuation.pause.threadId !== event.body?.threadId || continuation.pause.generation !== this.gate.generation) { this.fail('Unowned continuation invalidated live pause'); return; }
      continuation.dap = true; this.gate.invalidate(); this.browser.resumeViewport(); this.beginAfter(continuation);
    }
  }
  /** Correlates CDP resume with the captured generation before delayed DAP events can restore authority. @example run.onCdpResumed() */
  private onCdpResumed(): void {
    if (this.cleaning) return;
    const stopped = this.stopped; this.stopped = undefined;
    this.evidence.record('cdp.resumed', { generation: stopped?.generation });
    if (!stopped) return;
    const continuation = this.continuation;
    if (!continuation || stopped.generation !== continuation.pause.generation || continuation.cdp) { this.fail('Selected browser resumed outside its owned continuation'); return; }
    continuation.cdp = true; this.gate.invalidate(); this.browser.resumeViewport(); this.beginAfter(continuation);
  }
  /** Retires owned sessions and rejects unexpected loss of the selected browser target. @example run.terminated(child) */
  terminated(session: vscode.DebugSession): void {
    this.activeSessions.delete(session.id); this.evidence.record('session.terminated', { sessionId: session.id });
    if (!this.cleaning && session.id === this.selected?.id) this.fail('Selected debugger terminated');
  }

  /** Seals actual configured values and renderer pixels only while the exact source-bound pause remains current. @example await this.inspect(pause) */
  private async inspect(pause: PauseIdentity): Promise<void> {
    const stopped = await waitUntil(() => {
      const candidate = this.stopped;
      return candidate && candidate.generation === undefined && candidate.event.callFrames[0]?.location.scriptId === this.script?.scriptId ? candidate : undefined;
    }, 'source-bound CDP stop', CAPTURE_TIMEOUT_MS, this.abort.signal);
    const current = () => { this.alive(); if (!this.gate.matches(pause) || this.stopped !== stopped) throw new Error('Pause changed during inspection'); };
    current(); stopped.generation = pause.generation;
    const stack: DebugProtocol.StackTraceResponse['body'] = await awaitResponse(this.selected!.customRequest('stackTrace', { threadId: pause.threadId, startFrame: 0, levels: REPOSITORY_STACK_FRAME_LIMIT }), 'repository stack', this.abort.signal); current();
    const frame = stack.stackFrames[0], callFrame = stopped.event.callFrames[0]!, position = this.definition.configuration.source;
    if (!frame?.source?.path || resolve(frame.source.path) !== this.bundle!.sourcePath || frame.line !== position.line || frame.column !== position.column) throw new Error('DAP frame differs from exact configured source');
    await this.verifySources(); current();
    const executed = await this.requireCdp().request('Debugger.getScriptSource', { scriptId: callFrame.location.scriptId }); current();
    this.verifier!.verify(executed.scriptSource, this.bundle!.source, callFrame.location, this.script!.scriptId, frame.line, frame.column);
    const facts = await inspectConfiguredValues(parameters => this.requireCdp().request('Debugger.evaluateOnCallFrame', parameters), callFrame.callFrameId, this.definition.configuration.inspections, current); current();
    let inspectionFailure: Error | undefined;
    try {
      const missing = this.definition.configuration.inspections.find(inspection => inspection.required && facts.unavailableValues.some(value => value.path === `${inspection.mode}:${inspection.path}`));
      if (missing) throw new Error(`Required inspection ${missing.mode}:${missing.path} is unavailable; captured facts remain readable.`);
      await this.capture('paused-browser', current, pause); current();
      // The first stop is the only slot; retirement must be confirmed before publishing continuation authority.
      await this.breakpoint!.retire(this.selected!, this.abort.signal); current();
    } catch (error) {
      // A still-owned verified stop retains its facts even when its image or required inspection is incomplete.
      current(); inspectionFailure = error instanceof Error ? error : new Error(String(error));
    }
    const receipt = this.evidence.record('snapshot.committed', { snapshotId: `${pause.sessionId}:${pause.generation}` });
    const snapshot: ConfiguredRuntimeSnapshot = { id: `${pause.sessionId}:${pause.generation}`, itemId: this.definition.descriptor.itemId, actionId: REPOSITORY_BROWSER_ACTION, capturePhase: 'paused-browser', participant: 'browser',
      pause: { ...pause }, capturedAt: receipt.wallTime, elapsedMs: receipt.elapsedMs,
      source: { text: this.bundle!.source, hash: this.verifier!.hashes.typescript, line: frame.line, column: frame.column, javascriptHash: this.verifier!.hashes.javascript, mapHash: this.verifier!.hashes.sourceMap, scriptId: this.script!.scriptId, scriptUrl: this.script!.url, generated: { line: callFrame.location.lineNumber, column: callFrame.location.columnNumber ?? 0 } }, ...facts };
    try { await this.evidence.save('snapshot.json', snapshot); }
    catch (error) { current(); this.snapshot = snapshot; throw error; }
    current(); this.snapshot = snapshot;
    if (inspectionFailure) { this.gate.invalidate(true); throw inspectionFailure; }
    this.snapshotReady = true; await this.persist();
  }

  /** Reserves one exact tuple before source revalidation; only owned retired breakpoints can lead to an acknowledged continuation. @example await run.continue('browser', pause) */
  async continue(participant: 'server' | 'browser', pause: PauseIdentity): Promise<void> {
    if (participant !== 'browser' || this.cleaning || !this.snapshotReady || !this.snapshot || !this.breakpoint?.retired || !this.gate.matches(this.snapshot.pause) || !this.gate.reserve(pause)) throw new Error('conflict: stale, foreign or unverified pause');
    try {
      await this.verifySources(); this.alive();
      if (this.gate.phase !== 'resume-requested' || this.gate.current?.generation !== pause.generation) throw new Error('conflict: pause changed before continue');
      const continuation: Continuation = this.continuation = { pause: { ...pause }, response: false, dap: false, cdp: false, afterStarted: false };
      this.expectedResumeRequests++; this.evidence.record('continue.accepted', pause);
      this.progressDeadline(ACTIVE_TIMEOUT_MS, 'Repository continuation acknowledgement timed out');
      await awaitResponse(this.selected!.customRequest('continue', { threadId: pause.threadId }), 'repository continue', this.abort.signal); this.alive();
      continuation.response = true; this.beginAfter(continuation);
    } catch (error) { this.fail(`Continue uncertain: ${String(error)}`); throw error; }
  }
  /** Starts after verification once all three independent continuation acknowledgements name the original generation. @example this.beginAfter(continuation) */
  private beginAfter(continuation: Continuation): void {
    if (this.cleaning || continuation !== this.continuation || !continuation.response || !continuation.dap || !continuation.cdp || continuation.afterStarted) return;
    continuation.afterStarted = true; this.operation!.continuedPause = continuation.pause; this.status = 'resuming';
    this.progressDeadline(ACTIVE_TIMEOUT_MS, 'Repository after condition or input acknowledgement timed out');
    this.track(this.observeAfter(continuation));
  }
  /** Confirms input, declared DOM conditions and renderer ACK while no additional pause has invalidated the original completion. @example await this.observeAfter(continuation) */
  private async observeAfter(continuation: Continuation): Promise<void> {
    const current = () => { this.alive(); if (this.continuation !== continuation || this.gate.current || !continuation.dap || !continuation.cdp || !continuation.response) throw new Error('Original continuation no longer owns completion'); };
    current(); await this.waitForDom('after'); current();
    await waitUntil(() => this.operation?.inputAcknowledged, 'single input acknowledgement', ACTIVE_TIMEOUT_MS, this.abort.signal); current();
    await this.capture('after', current); current();
    this.operation!.afterVerified = true; this.status = 'completed'; clearTimeout(this.progressTimer);
    this.evidence.record('screen.observed', { snapshotId: this.snapshot!.id, pause: continuation.pause, actionId: REPOSITORY_BROWSER_ACTION }); await this.persist();
  }

  /** Evaluates owned DOM data only after origin verification; invalid selectors/conditions never dispatch input. @example await this.readDom('before') */
  private async readDom(phase: 'before' | 'after') {
    const cdp = this.requireCdp(), identity = await cdp.request('Runtime.evaluate', { expression: 'location.origin', returnByValue: true }); this.alive();
    if (identity.exceptionDetails || identity.result.value !== this.origin) throw new Error('Selected page left its owned application origin');
    const action = this.definition.configuration.action;
    const response = await cdp.request('Runtime.evaluate', { expression: configuredDomExpression(action[phase], phase === 'before' ? action.selector : undefined), returnByValue: true }); this.alive();
    if (response.exceptionDetails) throw new Error('Declared DOM conditions could not be evaluated');
    return domResultSchema.parse(response.result.value);
  }
  /** Polls conditions without repeating application input; setup and after verification call it. @example await this.waitForDom('after') */
  private async waitForDom(phase: 'before' | 'after'): Promise<void> { await waitUntil(async () => (await this.readDom(phase)).ready, `configured ${phase} conditions`, ACTIVE_TIMEOUT_MS, this.abort.signal); }
  /** Revalidates all cited disk identities and open buffers at effect/pause/continue boundaries without owning raw tabs. @example await this.verifySources() */
  private async verifySources(): Promise<void> {
    this.alive(); assertConfiguredSourceDocuments(this.options.workspace, this.definition, vscode.workspace.textDocuments);
    if (!this.preparedSources) throw new Error('Prepared sources are absent');
    await this.preparedSources.revalidate(); this.alive(); await this.preparedSources.verifyIdentities(); this.alive();
    assertConfiguredSourceDocuments(this.options.workspace, this.definition, vscode.workspace.textDocuments);
  }
  /** Retains exact pixels only after the source generation and native renderer both acknowledge the phase. @example await this.capture('paused-browser', current) */
  private async capture(phase: typeof CONFIGURED_CAPTURE_PHASES[number], current = () => this.alive(), pause?: PauseIdentity): Promise<void> {
    this.captures[phase] = { status: 'pending' };
    this.evidence.record('capture.requested', { phase, pause });
    try {
      const result = await this.requireCdp().request('Page.captureScreenshot', { format: 'png' }, CAPTURE_TIMEOUT_MS); current();
      const bytes = Buffer.from(result.data, 'base64'), hash = sha256(bytes);
      // Record receipt-time pixels before disk/renderer waits; only the later exact-pause receipt confirms correspondence.
      this.evidence.record('capture.response-received', { phase, pause, hash }); this.browser.recordCapture(result.data, phase);
      const file = `${phase}.png`; await this.evidence.save(file, bytes); current();
      // Native debugger focus can hide the leased panel; reacquire renderer readiness without closing the learner's source tab.
      await this.browser.reveal(this.abort.signal); current();
      const renderer = await this.browser.presentCapture(result.data, phase); current();
      if (!renderer || renderer.hash !== hash) throw new Error('Renderer did not acknowledge exact phase bytes');
      this.captures[phase] = { status: 'captured', file, renderer }; this.evidence.record('capture.received', { phase, pause, renderer });
    } catch (error) { this.captures[phase] = { status: 'failed', error: String(error) }; this.evidence.record('capture.failed', { phase, pause, reason: String(error) }); throw error; }
  }
  /** Reveals only the committed immutable source through the shared reader and drains its accepted presentation work on cleanup. @example await run.reveal(snapshot) */
  reveal(snapshot: RuntimeSnapshot): Promise<void> {
    this.alive();
    if (snapshot.actionId !== REPOSITORY_BROWSER_ACTION || snapshot !== this.snapshot) throw new StudyError('INVALID_REFERENCE', 'Snapshot does not belong to this configured runtime.');
    return this.acquire(this.options.revealSource(snapshot)).then(() => { this.alive(); this.evidence.record('agent.source-revealed', { snapshotId: snapshot.id, line: snapshot.source.line, sourceHash: snapshot.source.hash, capturedReader: true }); });
  }
  /** Returns only sealed bytes for this exact learning identity, independent of later files. @example run.source(itemId)?.javascript */
  source(item: string): BundleSource | undefined { return item === this.definition.descriptor.itemId ? this.bundle : undefined; }
  /** Exposes bounded descriptors and immutable references; service signatures never serialize full modules or maps. @example run.view().participants.browser.pause */
  view(): ConfiguredRuntimeView {
    const runtimeOutcome = this.operation?.afterVerified && !this.failures.length ? 'demonstrated' : 'not-demonstrated';
    const captureOutcome = CONFIGURED_CAPTURE_PHASES.every(phase => this.captures[phase]?.status === 'captured') ? 'complete' : 'incomplete';
    return { runId: this.id, profile: REPOSITORY_BROWSER_PROFILE, definition: this.definition, manifest: this.manifest, status: this.status, cleaned: this.cleaned, resourcesReleased: this.resourcesReleased,
      runtimeOutcome, captureOutcome, finalOutcome: !this.cleaned ? 'pending-teardown' : runtimeOutcome === 'demonstrated' ? captureOutcome === 'complete' ? 'demonstrated' : 'partial' : 'not-demonstrated',
      participants: { browser: { sessionId: this.selected?.id, pause: this.gate.current, phase: this.gate.phase, snapshot: this.snapshotReady ? this.snapshot : undefined, continued: this.operation?.continuedPause, conflict: this.gate.conflict } },
      snapshots: this.snapshot ? [this.snapshot] : [], operation: this.operation, nextAction: this.status === 'ready' && !this.operation ? REPOSITORY_BROWSER_ACTION : undefined,
      observed: this.operation?.afterVerified ? { afterVerified: true } : undefined, links: [], captures: this.captures, failures: [...this.failures], events: this.evidence.events, artifactDirectory: this.evidence.directory, activeSessionIds: [...this.activeSessions] };
  }
  /** Revokes every completion token immediately and schedules cleanup after the failing activity can settle. @example run.fail('source changed') */
  fail(reason: string): void {
    if (this.cleaning || this.status === 'failed') return;
    this.failures.push(reason); this.status = 'failed'; this.continuation = undefined; this.gate.invalidate(true); this.evidence.record('run.failed', { reason });
    queueMicrotask(() => { void this.stop().catch(error => this.failures.push(String(error))); });
  }
  /** Shares owned cleanup and permits explicit retry only after an incomplete release. @example await run.stop() */
  async stop(): Promise<void> {
    const attempt = this.cleanupPromise ??= this.cleanupOwned();
    try { await attempt; } catch (error) { if (this.cleanupPromise === attempt) this.cleanupPromise = undefined; throw error; }
  }
  /** Closes transports before draining acquisitions; raw tabs, dirty files and unrelated breakpoints are never cleanup targets. @example await this.cleanupOwned() */
  private async cleanupOwned(): Promise<void> {
    this.cleaning = true; this.abort.abort(); this.continuation = undefined; this.gate.invalidate(); this.browser.resumeViewport(); clearTimeout(this.progressTimer); clearTimeout(this.runTimer);
    this.options.control?.signal.removeEventListener('abort', this.cancel);
    if (!['failed', 'completed'].includes(this.status)) this.status = 'cancelled';
    const failures = await settleCleanup([{ description: 'selected CDP close', release: () => this.cdp?.close() }]);
    failures.push(...await this.stopKnownDebuggers());
    failures.push(...await settleCleanup([
      { description: 'browser acquisitions', release: () => this.browser.drainAcquisitions() },
      { description: 'source/proxy acquisitions', release: () => awaitResponse(Promise.allSettled(this.acquisitions), 'repository acquisitions') },
      { description: 'preparation settle', release: () => awaitResponse(this.preparation?.catch(() => undefined) ?? Promise.resolve(), 'repository preparation') },
      { description: 'owned breakpoint', release: () => this.breakpoint?.remove() },
    ]));
    failures.push(...await this.stopKnownDebuggers());
    failures.push(...await settleCleanup([
      { description: 'owned application stop', release: () => this.app?.close() },
      { description: 'protocol activities settle', release: () => awaitResponse(Promise.allSettled(this.activities), 'repository activities') },
      { description: 'owned browser close', release: () => this.browser.close() },
      { description: 'owned sessions exit', release: () => waitUntil(() => !this.activeSessions.size, 'repository sessions exit', ACTIVE_TIMEOUT_MS) },
    ]));
    this.failures.push(...failures); this.resourcesReleased = failures.length === 0; this.cleaned = this.resourcesReleased;
    if (failures.length) this.status = 'failed';
    this.evidence.record('cleanup.completed', { released: this.resourcesReleased, failures });
    try { await this.persist(); } catch (error) { this.cleaned = false; this.status = 'failed'; this.failures.push(`Final evidence persistence failed: ${String(error)}`); throw error; }
    if (failures.length) throw new Error(failures.join('; '));
  }
  /** Stops only acquired active roots before and after late acquisition draining. @example await this.stopKnownDebuggers() */
  private stopKnownDebuggers(): Promise<string[]> {
    return settleCleanup([...this.sessions.values()].filter(session => !session.parentSession && this.activeSessions.has(session.id)).map(session => ({ description: 'owned debugger stop', release: () => awaitResponse(vscode.debug.stopDebugging(session), 'repository debugger stop') })));
  }
  /** Saves private run/definition evidence without changing public storage or learner understanding. @example await this.persist() */
  private async persist(): Promise<void> { await this.evidence.save('runtime.json', { ...this.view(), definition: this.definition, host: this.options.host }); await this.evidence.flush(); }
  /** Applies the current active/hold/setup budget independently from the pending input's whole-run protocol timeout. @example this.progressDeadline(ACTIVE_TIMEOUT_MS, 'after timed out') */
  private progressDeadline(milliseconds: number, reason: string): void { clearTimeout(this.progressTimer); this.progressTimer = setTimeout(() => this.fail(reason), milliseconds); }
  /** Rejects work after cancellation, source authority failure or trusted-workspace replacement. @example this.alive() */
  private alive(): void { this.abort.signal.throwIfAborted(); if (this.cleaning || this.status === 'failed') throw new Error('Repository run is unavailable'); this.options.assertWorkspace(); }
  /** Retains protocol activities so cleanup can close their transports before awaiting them. @example this.track(this.inspect(pause)) */
  private track(activity: Promise<unknown>): void { const tracked = activity.then(() => undefined).catch(error => { if (!this.cleaning) this.fail(String(error)); }).finally(() => this.activities.delete(tracked)); this.activities.add(tracked); }
  /** Preserves non-cancellable native acquisition handles beyond abort for final ownership draining. @example await this.acquire(Cdp.connect(url, record)) */
  private acquire<Value>(promise: PromiseLike<Value>): Promise<Value> { const pending = Promise.resolve(promise); this.acquisitions.add(pending); void pending.then(() => this.acquisitions.delete(pending), () => this.acquisitions.delete(pending)); return pending; }
  /** Requires the explicitly selected page proxy rather than an active editor target. @example this.requireCdp().closed */
  private requireCdp(): Cdp { if (!this.cdp) throw new Error('Selected CDP unavailable'); return this.cdp; }
}
