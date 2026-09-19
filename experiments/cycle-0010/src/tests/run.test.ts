import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import type * as RuntimeModule from '../run';
import type { DebugSession } from 'vscode';
import type { BundleSource } from '../bundleSource';

/** Loads the real coordinator with controlled native/build boundaries and optional timers for lifecycle tests. @example const harness = await loadRun(); await harness.run.cleanup() */
async function loadRun(provisionalProxy?: { request: () => Promise<unknown>; close: () => void }, stopped?: () => void, prepareNative = false) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-real-runtime-'));
  const filename = join(__dirname, '../run.js'), nativeRequire = createRequire(filename), exports: Partial<typeof RuntimeModule> = {};
  const releases: string[] = [];
  const sourcePath = join(directory, 'theme.tsx'), source = `${'\n'.repeat(18)}    setTheme(otherTheme);\n`, javascript = '    setTheme(otherTheme);';
  const bundle: BundleSource = { sourcePath, source, javascript, sourceMap: JSON.stringify({ version: 3, sources: [sourcePath], sourcesContent: [source], names: [], mappings: 'IAkBI' }),
    mapSource: sourcePath, scriptUrl: 'webpack-internal:///theme.tsx', chunkPath: join(directory, 'app.js'), chunkHash: '0'.repeat(64) };
  if (prepareNative) await writeFile(sourcePath, source);
  const timers = new Map<number, { atMs: number; callback: () => void }>(), listeners = new Map<string, (event: unknown) => void>();
  const mouseEvents: { type: string | undefined; timeoutMs: number | undefined }[] = [];
  let elapsedMs = 0, nextTimerId = 0, inputPending = false, rejectInput = (_error: Error) => {}, onClose = () => {};
  const root: DebugSession = { id: 'owned-root', type: 'pwa-chrome', name: 'owned', workspaceFolder: undefined,
    configuration: { type: 'pwa-chrome', name: 'owned', request: 'launch' }, customRequest: async () => undefined, getDebugProtocolBreakpoint: async () => undefined };
  const selected: DebugSession = { ...root, id: 'owned-page', parentSession: root,
    customRequest: async command => {
      if (command === 'requestCDPProxy') return { host: 'localhost', port: 1234, path: '/owned' };
      if (command === 'stackTrace') return { stackFrames: [{ id: 1, name: 'toggle', source: { path: sourcePath }, line: 19, column: 5 }] };
      throw new Error(`Unexpected debugger request: ${command}`);
    }, getDebugProtocolBreakpoint: async () => ({ verified: true }) };
  const proxy = {
    closed: false,
    get onClose() { return onClose; }, set onClose(listener: () => void) { onClose = listener; },
    on(event: string, listener: (value: unknown) => void) { listeners.set(event, listener); },
    async subscribe() {},
    close() { if (this.closed) return; this.closed = true; releases.push('cdp'); if (inputPending) rejectInput(new Error('CDP disconnected')); onClose(); },
    async request(method: string, parameters?: { expression?: string; type?: string }, timeoutMs?: number) {
      if (method === 'Runtime.evaluate') return { result: { value: parameters?.expression === 'location.href' ? 'about:blank' : parameters?.expression?.startsWith('JSON.stringify') ? '{"x":12,"y":18}' : true } };
      if (method === 'Page.navigate') { listeners.get('Debugger.scriptParsed')?.({ scriptId: 'actual', url: bundle.scriptUrl, executionContextId: 1 }); return {}; }
      if (method === 'Debugger.getScriptSource') return { scriptSource: javascript };
      if (method === 'Debugger.evaluateOnCallFrame') return { result: { value: parameters?.expression === 'otherTheme' ? 'dark' : parameters?.expression === 'typeof setTheme' ? 'function' : undefined } };
      if (method === 'Page.captureScreenshot') return { data: Buffer.from('captured pixels').toString('base64') };
      if (method === 'Input.dispatchMouseEvent') {
        mouseEvents.push({ type: parameters?.type, timeoutMs });
        if (parameters?.type === 'mousePressed') return {};
        // The real dispatch waits here while the actual coordinator captures the corresponding DAP/CDP pause.
        inputPending = true;
        const pending = new Promise<never>((_resolve, reject) => { rejectInput = reject; });
        listeners.get('Debugger.paused')?.({ reason: 'other', callFrames: [{ callFrameId: 'current', location: { scriptId: 'actual', lineNumber: 0, columnNumber: 4 } }] });
        run.onEvent(selected, { seq: 1, type: 'event', event: 'stopped', body: { threadId: 7, reason: 'breakpoint' } });
        return pending.finally(() => { inputPending = false; releases.push('input settled'); });
      }
      if (method === 'Page.addScriptToEvaluateOnNewDocument' || method === 'Target.getTargetInfo') return {};
      throw new Error(`Unexpected browser request: ${method}`);
    },
  };
  runInNewContext(await readFile(filename, 'utf8'), {
    exports, AbortController, AbortSignal, performance, process, Buffer, queueMicrotask,
    setTimeout: prepareNative ? (callback: () => void, delayMs: number) => { const timerId = ++nextTimerId; timers.set(timerId, { atMs: elapsedMs + delayMs, callback }); return timerId; } : setTimeout,
    clearTimeout: prepareNative ? (timerId: number) => { timers.delete(timerId); } : clearTimeout,
    require(name: string) {
      if (name === 'vscode') return { debug: { addBreakpoints() {}, removeBreakpoints: () => releases.push('breakpoint'), stopDebugging: async (session: DebugSession) => { releases.push('debugger'); run.terminated(session); if (prepareNative) run.terminated(selected); stopped?.(); } },
        window: { tabGroups: { all: [] }, showTextDocument: async () => ({}) }, Uri: { file: (path: string) => ({ fsPath: path }) }, ViewColumn: { Two: 2 },
        Position: class {}, Location: class {}, SourceBreakpoint: class {}, commands: { executeCommand: async () => undefined },
        env: { appName: 'test' }, version: 'test', extensions: { getExtension: () => undefined } };
      if (name === 'codebook-cycle-0001/dist/hostBrowser') return { HostBrowser: class {
        async launch() { run.addSession(root); run.addSession(selected); }
        async attachViewport() {} async reveal() {} resumeViewport() {}
        async presentCapture(data: string) { return { epoch: 'test-renderer', id: 1, hash: sha256(Buffer.from(data, 'base64')) }; }
        async drainAcquisitions() { releases.push('acquisitions'); } async close() { releases.push('browser'); }
      } };
      if (name === 'codebook-cycle-0001/dist/cdp' && (provisionalProxy || prepareNative)) return { Cdp: { connect: async () => provisionalProxy ?? proxy } };
      if (name === './utils/readDevelopmentBundle' && prepareNative) return { readDevelopmentBundle: async () => ({ bundle, discovery: {} }) };
      if (name === './utils/launchDevelopmentServer' && prepareNative) return { launchDevelopmentServer: () => ({ ready: async () => 'http://127.0.0.1:4321', close: async () => { releases.push('application'); } }) };
      return nativeRequire(name);
    },
  }, { filename });
  assert.ok(exports.RepositoryRun);
  const run = new exports.RepositoryRun({ directory, target: directory, node: process.execPath, revision: 'test', sourceFingerprint: 'test', host: { id: 'vscode', productVersion: 'test', apiVersion: 'test', commit: 'test' } });
  return { run, directory, releases, mouseEvents, rejectInput: (error: Error) => rejectInput(error),
    advanceTime(milliseconds: number) {
      elapsedMs += milliseconds;
      // Only registered coordinator timers advance; native promises and evidence writes settle normally.
      for (const [timerId, timer] of [...timers].sort((left, right) => left[1].atMs - right[1].atMs)) {
        if (timer.atMs <= elapsedMs) { timers.delete(timerId); timer.callback(); }
      }
    } };
}

test('a held input automatically expires its registered run deadline and releases the pause without retrying the click', async () => {
  // Arrange: real preparation registers the deadline, and real inspection commits the paused source/value/image.
  const { run, directory, releases, mouseEvents, advanceTime } = await loadRun(undefined, undefined, true);
  try {
    await run.prepare(); assert.equal(run.view().status, 'ready');
    assert.equal(run.click('toggle-once').accepted, true);
    const snapshot = await waitUntil(() => run.view().snapshot, 'captured pause before run expiry');
    assert.equal(run.gate.matches(snapshot.pause), true); assert.equal(run.view().operation?.acknowledged, false);
    advanceTime(119_999);
    assert.equal(run.view().status, 'paused'); assert.equal(run.gate.matches(snapshot.pause), true);
    // Act: expire the callback registered by prepare, without calling fail or cleanup.
    advanceTime(1);
    assert.equal(run.view().status, 'failed'); assert.equal(run.gate.current, undefined);
    await setImmediate(); const automaticCleanup = Reflect.get(run, 'cleanupPromise'); assert.ok(automaticCleanup);
    await automaticCleanup;
    // Assert
    assert.equal(run.view().cleaned, true); assert.equal(run.view().resources.activeSessionIds.length, 0); assert.equal(run.view().resources.cdpOpen, false);
    assert.deepEqual([...run.view().failures], ['Run deadline exceeded without input retry']);
    assert.equal(run.view().operation?.acknowledged, false);
    assert.deepEqual(mouseEvents, [{ type: 'mousePressed', timeoutMs: 120_000 }, { type: 'mouseReleased', timeoutMs: 120_000 }]);
    assert.equal(run.evidence.events.filter(event => event.type === 'input.dispatched').length, 1);
    assert.equal(releases.indexOf('cdp') < releases.indexOf('input settled'), true);
    assert.equal(releases.includes('application'), true); assert.equal(releases.includes('browser'), true);
    assert.throws(() => run.click('retry-after-expiry'), /conflict/);
    await assert.rejects(run.continue(snapshot.pause), /conflict/);
  } finally { await run.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('a pending mouse input timeout automatically fails the captured pause and cleans up without redispatch', async () => {
  // Arrange
  const { run, directory, releases, mouseEvents, rejectInput } = await loadRun(undefined, undefined, true);
  try {
    await run.prepare(); assert.equal(run.view().status, 'ready');
    assert.equal(run.click('toggle-once').accepted, true);
    const snapshot = await waitUntil(() => run.view().snapshot, 'captured pause before input timeout');
    assert.equal(run.gate.matches(snapshot.pause), true);
    // Act: reject the actual dispatch's pending protocol request as the CDP deadline does.
    rejectInput(new Error('CDP Input.dispatchMouseEvent timed out'));
    await setImmediate(); const automaticCleanup = Reflect.get(run, 'cleanupPromise'); assert.ok(automaticCleanup);
    await automaticCleanup;
    // Assert
    assert.equal(run.view().status, 'failed'); assert.equal(run.view().cleaned, true); assert.equal(run.gate.current, undefined);
    assert.deepEqual([...run.view().failures], ['Error: CDP Input.dispatchMouseEvent timed out']);
    assert.equal(run.view().operation?.acknowledged, false);
    assert.deepEqual(mouseEvents, [{ type: 'mousePressed', timeoutMs: 120_000 }, { type: 'mouseReleased', timeoutMs: 120_000 }]);
    assert.equal(run.evidence.events.filter(event => event.type === 'input.dispatched').length, 1);
    assert.equal(releases.includes('input settled'), true); assert.equal(releases.includes('cdp'), true);
    assert.equal(run.view().resources.cdpOpen, false); assert.equal(run.view().resources.activeSessionIds.length, 0);
    assert.throws(() => run.click('retry-after-timeout'), /conflict/);
    await assert.rejects(run.continue(snapshot.pause), /conflict/);
  } finally { await run.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('cancelling a held input closes its protocol before waiting and releases only owned resources', async () => {
  // Arrange: this input cannot settle naturally; only closing the selected protocol can release it.
  const { run, directory, releases } = await loadRun();
  let settleInput = () => {};
  const input = new Promise<void>(resolve => { settleInput = () => { releases.push('input settled'); resolve(); }; });
  Reflect.set(run, 'activities', new Set([input]));
  Reflect.set(run, 'cdp', { closed: false, close() { releases.push('cdp'); this.closed = true; settleInput(); } });
  try {
    // Act
    await run.cleanup();
    // Assert
    assert.deepEqual(releases, ['cdp', 'input settled', 'acquisitions', 'browser']);
    assert.equal(run.view().cleaned, true); assert.equal(run.view().status, 'cancelled');
    assert.equal(run.evidence.events.some(event => event.type === 'input.dispatched'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cancelling preparation closes its selected protocol before waiting for protocol-dependent setup', async () => {
  // Arrange: setup already owns CDP, and its pending request only settles when that connection closes.
  const { run, directory, releases } = await loadRun(); let releasePreparation = () => {};
  const preparation = new Promise<void>(resolve => { releasePreparation = resolve; });
  Reflect.set(run, 'preparation', preparation);
  Reflect.set(run, 'cdp', { closed: false, close() { releases.push('cdp'); this.closed = true; releasePreparation(); } });
  let cleanup: Promise<void> | undefined;
  try {
    // Act
    cleanup = run.cleanup(); await setImmediate();
    // Assert: no setup deadline must elapse before releasing the protocol it depends on.
    assert.equal(releases.includes('cdp'), true);
    await cleanup; assert.equal(run.view().cleaned, true);
    assert.equal(run.view().status, 'cancelled');
  } finally { releasePreparation(); await cleanup; await rm(directory, { recursive: true, force: true }); }
});

test('cancelling page identification closes its unselected proxy without waiting for the protocol deadline', async () => {
  // Arrange: a connected page is not adopted until its identity response arrives.
  let rejectProbe = (_error: Error) => {}, signalProbe = () => {}, closed = false;
  const response = new Promise<never>((_resolve, reject) => { rejectProbe = reject; });
  const probeStarted = new Promise<void>(resolve => { signalProbe = resolve; });
  const proxy = { request: () => { signalProbe(); return response; }, close: () => { closed = true; rejectProbe(new Error('Proxy closed')); } };
  const { run, directory } = await loadRun(proxy);
  const root = { id: 'root', type: 'pwa-chrome', name: 'owned', workspaceFolder: undefined, configuration: { type: 'pwa-chrome', name: 'owned', request: 'launch' }, customRequest: async () => ({ host: 'localhost', port: 1234, path: '/owned' }), getDebugProtocolBreakpoint: async () => undefined };
  run.sessions.set('child', { ...root, id: 'child', parentSession: root });
  const preparation: Promise<void> = Reflect.get(run, 'selectPage').call(run); Reflect.set(run, 'preparation', preparation);
  void preparation.catch(() => undefined);
  let cleanup: Promise<void> | undefined;
  try {
    await probeStarted;
    // Act
    cleanup = run.cleanup(); await setImmediate();
    // Assert
    assert.equal(closed, true);
    await cleanup; assert.equal(run.view().cleaned, true); assert.equal(run.view().status, 'cancelled');
  } finally { proxy.close(); await preparation.catch(() => undefined); await cleanup; await rm(directory, { recursive: true, force: true }); }
});

test('cancelling an acquired debugger launch stops its known root before waiting for launch settlement', async () => {
  // Arrange: the native launch acknowledgement arrives only after its already-known root is stopped.
  let releaseLaunch = () => {};
  const launch = new Promise<void>(resolve => { releaseLaunch = resolve; });
  const { run, directory, releases } = await loadRun(undefined, () => releaseLaunch());
  const root = { id: 'owned-root', type: 'pwa-chrome', name: 'owned', workspaceFolder: undefined, configuration: { type: 'pwa-chrome', name: `codebook repository ${run.id}`, request: 'launch' }, customRequest: async () => undefined, getDebugProtocolBreakpoint: async () => undefined };
  run.addSession(root);
  Reflect.get(run, 'browser').drainAcquisitions = async () => { await launch; releases.push('acquisitions'); };
  let cleanup: Promise<void> | undefined;
  try {
    // Act
    cleanup = run.cleanup(); await setImmediate();
    // Assert
    assert.equal(releases.includes('debugger'), true);
    await cleanup; assert.equal(run.view().cleaned, true); assert.equal(run.view().resources.activeSessionIds.length, 0);
  } finally { releaseLaunch(); await cleanup; await rm(directory, { recursive: true, force: true }); }
});

test('a second stop retries incomplete browser cleanup without restoring live authority', async () => {
  // Arrange
  const { run, directory } = await loadRun(); let closeCount = 0;
  Reflect.get(run, 'browser').close = async () => { if (++closeCount === 1) throw new Error('Transient browser close failure'); };
  try {
    // Act
    await assert.rejects(run.cleanup(), /Transient browser close failure/);
    await run.cleanup();
    // Assert
    assert.equal(closeCount, 2); assert.equal(run.view().cleaned, true);
    assert.equal(run.gate.current, undefined); assert.equal(run.view().status, 'failed');
    assert.match(run.view().failures.join(' '), /Transient browser close failure/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('repeat input identity reuses its receipt and a conflicting click cannot dispatch twice', async () => {
  // Arrange
  const { run, directory } = await loadRun(); let dispatched = 0;
  Reflect.set(run, 'status', 'ready'); Reflect.set(run, 'dispatchInput', async () => { dispatched += 1; });
  try {
    // Act
    const first = run.click('one'), repeated = run.click('one');
    // Assert
    assert.equal(first.accepted, true); assert.equal(repeated.accepted, false); assert.equal(dispatched, 1);
    assert.throws(() => run.click('two'), /conflict/);
    assert.equal(dispatched, 1);
  } finally { await run.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('foreign or already reserved pause identities never receive continue authority', async () => {
  // Arrange
  const { run, directory } = await loadRun(); const pause = run.gate.stop('owned-session', 7);
  Reflect.set(run, 'snapshot', { id: 'historical', pause });
  try {
    // Act / Assert
    await assert.rejects(run.continue({ ...pause, sessionId: 'foreign-session' }), /conflict/);
    assert.equal(run.gate.reserve(pause), true);
    await assert.rejects(run.continue(pause), /conflict/);
    assert.equal(run.evidence.events.some(event => event.type === 'continue.accepted'), false);
  } finally { await run.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('failed final persistence cannot report clean observed completion after resources release', async () => {
  // Arrange
  const { run, directory, releases } = await loadRun(); Reflect.set(run, 'status', 'observed');
  run.evidence.failure = 'disk unavailable';
  try {
    // Act / Assert
    await assert.rejects(run.cleanup(), /disk unavailable/);
    assert.deepEqual(releases, ['acquisitions', 'browser']);
    assert.equal(run.view().cleaned, false); assert.equal(run.view().status, 'failed');
    assert.match(run.view().failures.join(' '), /Final evidence persistence failed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a previous snapshot cannot authorize a newer stop before its inspection completes', async () => {
  // Arrange
  const { run, directory } = await loadRun();
  const previous = run.gate.stop('owned-session', 7);
  const sourcePath = join(directory, 'theme.tsx'); await writeFile(sourcePath, 'setTheme(otherTheme);\n');
  let continueRequests = 0;
  Reflect.set(run, 'snapshot', { id: 'previous', pause: previous });
  Reflect.set(run, 'source', { sourcePath });
  Reflect.set(run, 'verifier', { hashes: { typescript: '83d6b787fc37b4a5d141c20f07d11088b5b36b3aed36cd21210f9e795e2e75b9' } });
  const selected = { id: 'owned-session', type: 'pwa-chrome', name: 'owned', workspaceFolder: undefined, configuration: { type: 'pwa-chrome', name: 'owned', request: 'attach' }, customRequest: async () => { continueRequests++; }, getDebugProtocolBreakpoint: async () => undefined };
  Reflect.set(run, 'selected', selected); Reflect.set(run, 'operation', { key: 'one', acknowledged: false });
  Reflect.set(run, 'inspect', async () => {});
  try {
    // Act: a real coordinator event changes generation before the replacement inspection supplies evidence.
    run.onEvent(selected, { seq: 1, type: 'event', event: 'stopped', body: { threadId: 7, reason: 'breakpoint' } });
    const current = run.gate.current; assert.ok(current);
    // Assert
    await assert.rejects(run.continue(current), /conflict/);
    assert.equal(continueRequests, 0);
    assert.equal(run.gate.phase, 'paused');
    assert.equal(run.view().snapshot?.pause.generation, 1);
  } finally { await run.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('a captured stop cannot resume until its paused image has a renderer acknowledgement', async () => {
  // Arrange: the source and values arrive before the native paused frame is painted.
  const { run, directory } = await loadRun(); const sourcePath = join(directory, 'theme.tsx');
  await writeFile(sourcePath, 'setTheme(otherTheme);\n');
  let releaseCapture = () => {}, signalCapture = () => {};
  const capturePending = new Promise<void>(resolve => { releaseCapture = resolve; });
  const captureStarted = new Promise<void>(resolve => { signalCapture = resolve; });
  const frame = { id: 1, name: 'toggle', source: { path: sourcePath }, line: 19, column: 5 };
  const selected = { id: 'owned-session', type: 'pwa-chrome', name: 'owned', workspaceFolder: undefined, configuration: { type: 'pwa-chrome', name: 'owned', request: 'attach' }, customRequest: async () => ({ stackFrames: [frame] }), getDebugProtocolBreakpoint: async () => undefined };
  Reflect.set(run, 'selected', selected); Reflect.set(run, 'source', { sourcePath });
  Reflect.set(run, 'operation', { key: 'one', acknowledged: false }); Reflect.set(run, 'script', { scriptId: 'actual' });
  Reflect.set(run, 'stopped', { event: { reason: 'other', callFrames: [{ callFrameId: 'current', location: { scriptId: 'actual', lineNumber: 0, columnNumber: 0 } }] } });
  Reflect.set(run, 'verifier', { verify: () => ({}) });
  Reflect.set(run, 'capture', async () => { signalCapture(); await capturePending; });
  Reflect.set(run, 'cdp', { closed: false, close() { this.closed = true; }, async request(method: string, parameters: { expression?: string }) {
    if (method === 'Debugger.getScriptSource') return { scriptSource: 'setTheme(otherTheme);' };
    return { result: { value: parameters.expression === 'otherTheme' ? 'dark' : parameters.expression === 'typeof setTheme' ? 'function' : undefined } };
  } });
  try {
    // Act
    run.onEvent(selected, { seq: 1, type: 'event', event: 'stopped', body: { threadId: 7, reason: 'breakpoint' } });
    await captureStarted; const pause = run.gate.current; assert.ok(pause);
    // Assert: unacknowledged pixels cannot grant authority or invalidate the pending capture.
    assert.equal(run.view().snapshot, undefined);
    await assert.rejects(run.continue(pause), /conflict/);
    assert.equal(run.gate.phase, 'paused');
    releaseCapture(); await Promise.all(Reflect.get(run, 'activities'));
    assert.equal(run.view().snapshot?.pause.generation, 1);
    assert.equal(run.view().failures.length, 0);
  } finally { releaseCapture(); await run.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('an external Chrome resume revokes a continue reserved while source validation is pending', async () => {
  // Arrange
  const { run, directory } = await loadRun(); const pause = run.gate.stop('owned-session', 7);
  const sourcePath = join(directory, 'theme.tsx'); await writeFile(sourcePath, 'setTheme(otherTheme);\n');
  let continueRequests = 0;
  Reflect.set(run, 'snapshot', { id: 'current', pause }); Reflect.set(run, 'source', { sourcePath });
  Reflect.set(run, 'verifier', { hashes: { typescript: '83d6b787fc37b4a5d141c20f07d11088b5b36b3aed36cd21210f9e795e2e75b9' } });
  Reflect.set(run, 'selected', { customRequest: async () => { continueRequests++; } });
  Reflect.set(run, 'stopped', { generation: 1 });
  try {
    // Act: the external protocol resumes before DAP reports it and before source I/O completes.
    const continuation = run.continue(pause); run.onCdpResumed();
    // Assert
    await assert.rejects(continuation);
    await run.cleanup();
    assert.equal(continueRequests, 0); assert.equal(run.gate.phase, 'running');
    assert.equal(run.view().status, 'failed'); assert.equal(run.view().cleaned, true);
    assert.match(run.view().failures.join(' '), /resumed outside its owned continuation/);
  } finally { await run.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('a delayed Chrome resume for an older generation cannot invalidate the next DAP stop', async () => {
  // Arrange
  const { run, directory } = await loadRun(); run.gate.stop('owned-session', 7);
  Reflect.set(run, 'stopped', { generation: 1 }); run.gate.invalidate();
  const current = run.gate.stop('owned-session', 7);
  try {
    // Act
    run.onCdpResumed();
    // Assert
    assert.equal(run.gate.matches(current), true); assert.equal(current.generation, 2);
    assert.equal(run.view().failures.length, 0);
  } finally { await run.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('an oversized source replacement cannot allocate an unbounded continue validation or resume execution', async () => {
  // Arrange
  const { run, directory } = await loadRun(); const pause = run.gate.stop('owned-session', 7);
  const sourcePath = join(directory, 'theme.tsx'); await writeFile(sourcePath, Buffer.alloc(1_048_577));
  Reflect.set(run, 'snapshot', { id: 'current', pause }); Reflect.set(run, 'status', 'paused');
  Reflect.set(run, 'source', { sourcePath });
  try {
    // Act
    await assert.rejects(run.continue(pause), /exceeds byte limit/);
    await run.cleanup();
    // Assert
    assert.equal(run.view().status, 'failed'); assert.equal(run.view().cleaned, true);
    assert.match(run.view().failures.join(' '), /exceeds byte limit/);
    assert.equal(run.evidence.events.some(event => event.type === 'continue.accepted'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a missing source during continue invalidates the pause and cleans up without a DAP request', async () => {
  // Arrange
  const { run, directory } = await loadRun(); const pause = run.gate.stop('owned-session', 7);
  Reflect.set(run, 'snapshot', { id: 'current', pause }); Reflect.set(run, 'status', 'paused');
  Reflect.set(run, 'source', { sourcePath: join(directory, 'missing.tsx') });
  try {
    // Act
    await assert.rejects(run.continue(pause), /ENOENT/);
    await run.cleanup();
    // Assert
    assert.equal(run.view().status, 'failed'); assert.equal(run.view().cleaned, true);
    assert.match(run.view().failures.join(' '), /ENOENT/);
    assert.equal(run.gate.phase, 'running');
    assert.equal(run.evidence.events.some(event => event.type === 'continue.accepted'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
