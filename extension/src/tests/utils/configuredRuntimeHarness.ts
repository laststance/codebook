import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import type { DebugSession } from 'vscode';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
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
  let emitInputPause = true, removedAck = true, bound = false, ready = true, inputResolve = () => {}, inputReject = (_error: Error) => {}, onClose = () => {}, heldPhase: string | undefined, releaseCapture = () => {}, captureEntered = () => {};
  let run: ConfiguredBrowserRun;
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
        run.onEvent(selected, { type: 'event', seq: ++requestSequence, event: 'continued', body: { threadId: 1 } });
        listeners.get('Debugger.resumed')?.({}); inputResolve(); return {};
      }
      throw new Error(`Unexpected DAP command: ${command}`);
    }, getDebugProtocolBreakpoint: async breakpoint => bound && breakpoints.some(candidate => candidate.id === breakpoint.id) ? { id: 1, verified: true, line: 1, column: 1 } : undefined };
  const emitPause = () => {
    listeners.get('Debugger.paused')?.({ reason: 'other', callFrames: [{ callFrameId: 'selected-frame', location: { scriptId: 'actual', lineNumber: 0, columnNumber: 0 } }] });
    run.onEvent(selected, { seq: ++requestSequence, type: 'event', event: 'stopped', body: { threadId: 1, reason: 'breakpoint' } });
  };
  const proxy = {
    closed: false, get onClose() { return onClose; }, set onClose(listener: () => void) { onClose = listener; },
    on(event: string, listener: (value: unknown) => void) { listeners.set(event, listener); }, async subscribe() {}, aggregateScreencastTelemetry() {},
    close() { if (this.closed) return; this.closed = true; releases.push('cdp'); inputReject(new Error('CDP disconnected')); onClose(); },
    async request(method: string, parameters?: { expression?: string; type?: string }, timeout?: number) {
      if (method === 'Runtime.evaluate') return { result: { value: parameters?.expression === 'location.href' ? 'about:blank' : parameters?.expression === 'location.origin' ? 'http://127.0.0.1:4321' : { ready, x: 12, y: 18 } } };
      if (method === 'Page.navigate') { bound = true; listeners.get('Debugger.scriptParsed')?.({ scriptId: 'actual', url: bundle.scriptUrl, executionContextId: 1 }); return {}; }
      if (method === 'Debugger.getScriptSource') return { scriptSource: javascript };
      if (method === 'Debugger.evaluateOnCallFrame') return { result: { value: parameters?.expression === 'nextTheme' ? 'dark' : parameters?.expression === 'typeof setTheme' ? 'function' : parameters?.expression === 'enabled' ? false : parameters?.expression === 'selection' ? null : undefined } };
      if (method === 'Page.captureScreenshot') return { data: Buffer.from('synthetic pixels').toString('base64') };
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
      async attachViewport() {} async reveal() {} resumeViewport() {}
      async presentCapture(data: string, phase: string) { if (phase === heldPhase) { captureEntered(); await new Promise<void>(resolve => { releaseCapture = resolve; }); } return { epoch: 'test', id: 1, hash: sha256(Buffer.from(data, 'base64')) }; }
      async drainAcquisitions() { releases.push('acquisitions'); } async close() { releases.push('browser'); }
    } },
    'codebook-cycle-0001/dist/cdp': { Cdp: { connect: async () => proxy } },
    './utils/readDevelopmentBundle': { readDevelopmentBundle: async () => ({ bundle, discovery: {} }) },
    './utils/assertDevelopmentWorkspace': { assertDevelopmentWorkspace: async () => undefined },
    './utils/launchDevelopmentServer': { launchDevelopmentServer: () => ({ ready: async () => { releases.push('application acquired'); return 'http://127.0.0.1:4321'; }, close: async () => { releases.push('application'); } }) },
  }, { setTimeout: (callback: () => void, delay: number) => { const id = ++timerId; timers.set(id, { at: clock + delay, callback }); return id; }, clearTimeout: (id: number) => { timers.delete(id); } });
  run = owned = new runtimeModule.ConfiguredBrowserRun({ directory: join(repository.directory, '.runtime'), workspace: repository.directory, node: process.execPath, host: { id: 'vscode', productVersion: 'test', apiVersion: 'test', commit: 'test' }, definition, control, assertWorkspace() {}, revealSource: async () => { releases.push('captured source'); } });
  return { ...repository, run, definition, documents, breakpoints, userBreakpoint, mouse, commands, releases, emitPause,
    suppressInputPause() { emitInputPause = false; },
    manualResume() { listeners.get('Debugger.resumed')?.({}); },
    setReady(value: boolean) { ready = value; }, suppressRetirementAck() { removedAck = false; },
    holdCapture(phase: string) { heldPhase = phase; const started = new Promise<void>(resolve => { captureEntered = resolve; }); return { started, release: () => { heldPhase = undefined; releaseCapture(); } }; },
    advance(milliseconds: number) { clock += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); } },
  };
}
