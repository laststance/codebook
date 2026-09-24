import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { TestContext } from 'node:test';
import type { DebugSession } from 'vscode';
import type { ViewportRecordingObserver } from 'codebook-cycle-0001/dist/browserViewport';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { configuredDefinitionSchema } from '../../configuredStudySchemas';
import type { ConfiguredBrowserRun } from '../../configuredBrowserRun';
import type { RuntimeControl } from '../../runtime';
import type { BundleSource } from '../../repositoryBundle';
import { createConfiguredStudy } from './createConfiguredStudy';
import { repositoryHarness } from './repositoryHarness';
import { loadModule } from './loadModule';

/** Drives the product coordinator with real Git/source/evidence and controlled native protocol events, never claiming actual-editor proof. @example const harness = await configuredRuntimeHarness(context); await harness.run.prepare() */
export async function configuredRuntimeHarness(context: TestContext, control?: RuntimeControl) {
  let owned: ConfiguredBrowserRun | undefined;
  context.after(async () => { await owned?.stop(); });
  const repository = await repositoryHarness(context), reference = createConfiguredStudy();
  for (const source of reference.descriptor!.sources) await repository.track(source.path, source.text);
  const definition = configuredDefinitionSchema.parse({ configuration: reference.configuration, configurationHash: reference.configurationHash, descriptor: reference.descriptor });
  const sourcePath = join(repository.directory, definition.configuration.source.path), source = reference.descriptor!.sources[0]!.text, javascript = 'const nextTheme = "dark";';
  const bundle: BundleSource = { sourcePath, source, javascript, sourceMap: JSON.stringify({ version: 3, sources: [sourcePath], sourcesContent: [source], names: [], mappings: 'AAAA' }), mapSource: sourcePath, scriptUrl: 'webpack-internal:///(app-pages-browser)/./src/theme.ts', chunkPath: join(repository.directory, '.next/dev/chunk.js'), chunkHash: '0'.repeat(64) };
  const releases: string[] = [], mouse: { type?: string; timeout?: number }[] = [], commands: string[] = [], listeners = new Map<string, (event: unknown) => void>();
  const timers = new Map<number, { at: number; callback: () => void }>(); let clock = 0, timerId = 0, requestSequence = 0;
  let emitInputPause = true, emitPreparationResume = false, stopAtStartupBreakpoint = false, removedAck = true, bound = false, rejectBinding = false, ready = true, inputResolve = () => {}, inputReject = (_error: Error) => {}, onClose = () => {}, heldPhase: string | undefined, releaseCapture = () => {}, captureEntered = () => {};
  let run: ConfiguredBrowserRun;
  let recordingObserver = (): ViewportRecordingObserver | undefined => undefined;
  let rejectedCapture: string | undefined, requiredValueUnavailable = false;
  let hideViewportAtPause = false, viewportReady = true;
  let controlledContinuation = false, continuationEntered = () => {}, acknowledgeContinuation = () => {}, rejectContinuation = (_error: Error) => {};
  type TestBreakpoint = { id: string; location: { uri: { fsPath: string }; range: { start: { line: number; character: number } } } };
  const userBreakpoint: TestBreakpoint = { id: 'learner-owned', location: { uri: { fsPath: sourcePath }, range: { start: { line: 10, character: 0 } } } };
  const breakpoints: TestBreakpoint[] = [userBreakpoint];
  const root: DebugSession = { id: 'owned-root', type: 'pwa-chrome', name: 'owned', workspaceFolder: undefined, configuration: { type: 'pwa-chrome', name: 'owned', request: 'launch' }, customRequest: async () => undefined, getDebugProtocolBreakpoint: async () => undefined };
  const selected: DebugSession = { ...root, id: 'browser-session', parentSession: root,
    customRequest: async (command, arguments_) => {
      commands.push(command);
      if (command === 'requestCDPProxy') return { host: 'localhost', port: 1234, path: '/owned' };
      if (command === 'stackTrace') return { stackFrames: [{ id: 1, name: 'configured', source: { path: sourcePath }, line: 1, column: 1 }] };
      if (command === 'continue') {
        run.onRequest(selected, { type: 'request', seq: ++requestSequence, command, arguments: arguments_ });
        // Controlled cases deliver response, DAP, CDP and input receipts independently.
        if (controlledContinuation) {
          const response = new Promise<void>((resolve, reject) => { acknowledgeContinuation = resolve; rejectContinuation = reject; });
          continuationEntered(); await response; return {};
        }
        run.onEvent(selected, { type: 'event', seq: ++requestSequence, event: 'continued', body: { threadId: 1 } });
        listeners.get('Debugger.resumed')?.({}); inputResolve(); return {};
      }
      throw new Error(`Unexpected DAP command: ${command}`);
    }, getDebugProtocolBreakpoint: async breakpoint => bound && breakpoints.some(candidate => candidate.id === breakpoint.id) ? { id: 1, verified: true, line: 1, column: 1 } : undefined };
  const emitCdpPause = () => {
    listeners.get('Debugger.paused')?.({ reason: 'other', hitBreakpoints: ['mapped-source'], callFrames: [{ callFrameId: 'selected-frame', location: { scriptId: 'actual', lineNumber: 0, columnNumber: 0 } }] });
  };
  const emitPause = () => {
    // A real debugger may reveal an existing source tab over the leased application panel.
    if (hideViewportAtPause) viewportReady = false;
    emitCdpPause();
    run.onEvent(selected, { seq: ++requestSequence, type: 'event', event: 'stopped', body: { threadId: 1, reason: 'breakpoint' } });
  };
  const proxy = {
    closed: false, get onClose() { return onClose; }, set onClose(listener: () => void) { onClose = listener; },
    on(event: string, listener: (value: unknown) => void) { listeners.set(event, listener); }, async subscribe() {}, aggregateScreencastTelemetry() {},
    close() { if (this.closed) return; this.closed = true; releases.push('cdp'); inputReject(new Error('CDP disconnected')); rejectContinuation(new Error('DAP disconnected')); onClose(); },
    async request(method: string, parameters?: { expression?: string; type?: string }, timeout?: number) {
      if (method === 'Runtime.evaluate') return { result: { value: parameters?.expression === 'location.href' ? 'about:blank' : parameters?.expression === 'location.origin' ? 'http://127.0.0.1:4321'
        : ready ? { ready: true, x: 12, y: 18 } : { ready: false, failure: { conditionIndex: 0, reason: 'not-visible' } } } };
      if (method === 'Page.navigate') {
        bound = !rejectBinding;
        // VS Code can surface a bound source stop during hydration when Codebook arms its breakpoint too early.
        if (stopAtStartupBreakpoint && breakpoints.some(breakpoint => breakpoint.id === 'owned-breakpoint')) {
          run.onEvent(selected, { seq: ++requestSequence, type: 'event', event: 'stopped', body: { threadId: 1, reason: 'breakpoint' } });
        }
        // js-debug can resume internal source-map stops without exposing a DAP stop.
        if (emitPreparationResume) emitCdpPause();
        listeners.get('Debugger.scriptParsed')?.({ scriptId: 'actual', url: bundle.scriptUrl, executionContextId: 1 });
        if (emitPreparationResume) { listeners.get('Debugger.resumed')?.({}); emitCdpPause(); listeners.get('Debugger.resumed')?.({}); }
        return {};
      }
      if (method === 'Debugger.getScriptSource') return { scriptSource: javascript };
      if (method === 'Debugger.evaluateOnCallFrame') {
        try { return { result: { value: runInNewContext(parameters?.expression ?? '', { nextTheme: requiredValueUnavailable ? undefined : 'dark', setTheme() {}, enabled: false, selection: null }) } }; }
        catch { return { result: { type: 'undefined' }, exceptionDetails: { exceptionId: 1, text: 'Unavailable test local', lineNumber: 0, columnNumber: 0 } }; }
      }
      if (method === 'Page.captureScreenshot') return { data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=' };
      if (method === 'Input.dispatchMouseEvent') {
        mouse.push({ type: parameters?.type, timeout });
        if (parameters?.type === 'mousePressed') return {};
        const pending = new Promise<void>((resolve, reject) => { inputResolve = resolve; inputReject = reject; }); if (emitInputPause) emitPause(); return pending;
      }
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return {};
      throw new Error(`Unexpected CDP request: ${method}`);
    },
  };
  const documents = [{ uri: { scheme: 'file', fsPath: sourcePath }, isDirty: false, text: source, getText() { return this.text; } }];
  const vscode = {
    workspace: { textDocuments: documents },
    debug: { breakpoints, addBreakpoints(added: TestBreakpoint[]) { breakpoints.push(...added); },
      removeBreakpoints(removed: TestBreakpoint[]) {
        for (const breakpoint of removed) { const index = breakpoints.findIndex(candidate => candidate.id === breakpoint.id); if (index >= 0) breakpoints.splice(index, 1); }
        releases.push('owned breakpoint');
        const sequence = ++requestSequence;
        run.onRequest(selected, { seq: sequence, type: 'request', command: 'setBreakpoints', arguments: { source: { path: sourcePath }, breakpoints: breakpoints.map(breakpoint => ({ line: breakpoint.location.range.start.line + 1, column: breakpoint.location.range.start.character + 1 })) } });
        if (removedAck) queueMicrotask(() => run.onResponse(selected, { seq: ++requestSequence, type: 'response', command: 'setBreakpoints', request_seq: sequence, success: true, body: { breakpoints: [{ line: 11, column: 1 }] } }));
      },
      stopDebugging: async () => { releases.push('debugger'); run.terminated(root); run.terminated(selected); } },
    Uri: { file: (path: string) => ({ scheme: 'file', fsPath: path }) },
    Position: class { constructor(readonly line: number, readonly character: number) {} },
    Location: class { readonly range; constructor(readonly uri: unknown, position: unknown) { this.range = { start: position }; } },
    SourceBreakpoint: class { readonly id = 'owned-breakpoint'; constructor(readonly location: unknown) {} },
  };
  const breakpointModule = await loadModule<typeof import('../../ownedRepositoryBreakpoint')>(resolve(__dirname, '../../ownedRepositoryBreakpoint.js'), { vscode });
  const runtimeModule = await loadModule<typeof import('../../configuredBrowserRun')>(resolve(__dirname, '../../configuredBrowserRun.js'), {
    vscode, './ownedRepositoryBreakpoint': breakpointModule,
    'codebook-cycle-0001/dist/hostBrowser': { HostBrowser: class {
      async launch(configuration: DebugSession['configuration']) { root.configuration.name = configuration.name; run.addSession(root); run.addSession(selected); }
      async attachViewport() {} async reveal() { viewportReady = true; } resumeViewport() {}
      recordCapture(data: string, phase: string) { const observer = recordingObserver(); observer?.frame({ data, phase, kind: 'phase', elapsedMs: observer.elapsedMs() }); }
      async presentCapture(data: string, phase: string) { if (!viewportReady) throw new Error('Webview is not ready'); if (phase === heldPhase) { captureEntered(); await new Promise<void>(resolve => { releaseCapture = resolve; }); } if (phase === rejectedCapture) return undefined; return { epoch: 'test', id: 1, hash: sha256(Buffer.from(data, 'base64')) }; }
      async drainAcquisitions() { releases.push('acquisitions'); } async close() { releases.push('browser'); }
    } },
    'codebook-cycle-0001/dist/cdp': { Cdp: { connect: async () => proxy } },
    './utils/readDevelopmentBundle': { readDevelopmentBundle: async () => ({ bundle, discovery: {} }) },
    './utils/assertDevelopmentWorkspace': { assertDevelopmentWorkspace: async () => undefined },
    './utils/launchDevelopmentServer': { launchDevelopmentServer: () => ({ ready: async () => { releases.push('application acquired'); return 'http://127.0.0.1:4321'; }, close: async () => { releases.push('application'); } }) },
    'codebook-cycle-0001/dist/utils/waitUntil': { waitUntil: async <Value>(read: () => Value | Promise<Value>, description: string, timeoutMs?: number, signal?: AbortSignal) => {
      // A deliberately disabled readiness condition is stable; inspect it once, then use the real timeout contract.
      if (!ready && description.startsWith('configured before conditions')) {
        signal?.throwIfAborted();
        const value = await read();
        signal?.throwIfAborted();
        if (value) return value;
        return waitUntil(read, description, 0, signal);
      }
      if (rejectBinding && description.startsWith('exact repository breakpoint binding')) {
        signal?.throwIfAborted();
        await read();
        signal?.throwIfAborted();
        return waitUntil(read, description, 0, signal);
      }
      return waitUntil(read, description, timeoutMs, signal);
    } },
  }, { setTimeout: (callback: () => void, delay: number) => { const id = ++timerId; timers.set(id, { at: clock + delay, callback }); return id; }, clearTimeout: (id: number) => { timers.delete(id); } });
  run = owned = new runtimeModule.ConfiguredBrowserRun({ directory: join(repository.directory, '.runtime'), workspace: repository.directory, node: process.execPath, host: { id: 'vscode', productVersion: 'test', apiVersion: 'test', commit: 'test' }, definition, control, assertWorkspace() {}, revealSource: async () => { releases.push('captured source'); } });
  return { ...repository, run, definition, documents, breakpoints, userBreakpoint, mouse, commands, releases, emitPause, emitCdpPause,
    rejectBreakpointBinding() { rejectBinding = true; },
    observeRecording(observer: () => ViewportRecordingObserver | undefined) { recordingObserver = observer; },
    rejectCapture(phase: string) { rejectedCapture = phase; }, requireUnavailableValue() { requiredValueUnavailable = true; },
    suppressInputPause() { emitInputPause = false; },
    resumeDuringPreparation() { emitPreparationResume = true; },
    stopOnStartupWhenOwnedBreakpointPresent() { stopAtStartupBreakpoint = true; },
    hideViewportOnPause() { hideViewportAtPause = true; },
    manualResume() { listeners.get('Debugger.resumed')?.({}); },
    holdContinuation() {
      controlledContinuation = true;
      const started = new Promise<void>(resolve => { continuationEntered = resolve; });
      return { started, response: () => acknowledgeContinuation(), input: () => inputResolve(),
        dap: (threadId = 1) => run.onEvent(selected, { type: 'event', seq: ++requestSequence, event: 'continued', body: { threadId } }),
        cdp: () => listeners.get('Debugger.resumed')?.({}) };
    },
    setReady(value: boolean) { ready = value; }, suppressRetirementAck() { removedAck = false; },
    holdCapture(phase: string) { heldPhase = phase; const started = new Promise<void>(resolve => { captureEntered = resolve; }); return { started, release: () => { heldPhase = undefined; releaseCapture(); } }; },
    advance(milliseconds: number) { clock += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); } },
  };
}
