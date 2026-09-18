import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import type * as RunModule from '../run';
import type { PauseIdentity } from 'codebook-cycle-0001/dist/pauseGate';
import type { ParticipantSnapshot } from '../inspectParticipant';

/** Loads the actual paired coordinator with only native VS Code replaced for lifecycle tests. @example const { run, directory } = await harness() */
async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-paired-lifecycle-'));
  const filename = join(__dirname, '../run.js'), nativeRequire = createRequire(filename);
  const exports: Partial<typeof RunModule> = {};
  const nativeDebug = { stopDebugging: async () => true, removeBreakpoints: () => undefined };
  runInNewContext(await readFile(filename, 'utf8'), { exports, AbortController, performance, process, setInterval, clearInterval,
    require: (name: string) => name === 'vscode' ? { version: 'test', extensions: { getExtension: () => undefined }, debug: nativeDebug, window: { tabGroups: { all: [] } } }
      : name === 'codebook-cycle-0001/dist/hostBrowser' ? {} : nativeRequire(name),
  }, { filename });
  assert.ok(exports.PairedRun);
  const run = new exports.PairedRun({ artifactRoot: directory, templateRoot: directory, descriptorPath: '', revision: 'test', dirty: true, sourceHash: 'test', nodeExecutable: '/node', host: { id: 'vscode', productVersion: 'test', apiVersion: 'test', commit: 'test' } }, 'normal');
  return { run, directory, nativeDebug };
}

/** Supplies a historical snapshot reference at the inspector boundary, without pretending to validate a real debugger. @example snapshot({ sessionId: 'server', threadId: 0, generation: 1 }) */
function snapshot(pause: PauseIdentity): ParticipantSnapshot {
  return { id: 'server:1', participant: 'server', pause, frame: { id: 1, name: 'addProduct', line: 1, column: 1 }, values: { operationId: 'run', cartId: 'selected', productId: 'tote-01', price: 24, cartCount: 0, admittedCount: 2 }, evaluations: [], source: { scriptId: 'script', scriptLocation: { scriptId: 'script', lineNumber: 0 }, mapping: { generatedLine: 0, generatedColumn: 0, originalSource: 'server.mts', originalLine: 0, originalColumn: 0 }, typescriptHash: 'typescript', javascriptHash: 'javascript', sourceMapHash: 'map' } };
}

test('two concurrent continuation calls dispatch once and a foreign participant cannot consume the pause', async () => {
  // Arrange
  const { run, directory } = await harness(); let sent = 0; let release: () => void = () => undefined;
  const session = { id: 'server', name: 'server', type: 'pwa-node', configuration: { name: 'server', type: 'pwa-node', request: 'launch' }, workspaceFolder: undefined,
    customRequest: async () => { sent++; run.onRequest(session, { seq: 1, type: 'request', command: 'continue' }); return new Promise<void>(resolve => { release = resolve; }); }, getDebugProtocolBreakpoint: async () => undefined };
  run.participants.server.selected = session; const pause = run.participants.server.gate.stop('server', 0); run.participants.server.snapshot = snapshot(pause); run.status = 'paused-server';
  try {
    // Act
    const first = run.continue('server', pause);
    await assert.rejects(run.continue('server', pause), /conflict/); await assert.rejects(run.continue('browser', pause), /conflict/);
    release(); await first; run.onEvent(session, { seq: 2, type: 'event', event: 'continued', body: { threadId: 0 } });
    // Assert
    assert.equal(sent, 1); assert.deepEqual({ ...run.participants.server.continued }, { sessionId: 'server', threadId: 0, generation: 1 }); assert.equal(run.participants.server.gate.current, undefined);
    await assert.rejects(run.continue('server', pause), /conflict/);
  } finally { release(); await run.cleanup(); await rm(directory, { recursive: true }); }
});

test('a rejected debugger continuation fails immediately instead of leaving an unresumable run until its whole-run deadline', async () => {
  // Arrange
  const { run, directory } = await harness();
  run.participants.server.selected = { id: 'server', name: 'server', type: 'pwa-node', configuration: { name: 'server', type: 'pwa-node', request: 'launch' }, workspaceFolder: undefined, customRequest: async () => { throw new Error('Debug adapter disconnected'); }, getDebugProtocolBreakpoint: async () => undefined };
  const pause = run.participants.server.gate.stop('server', 0); run.participants.server.snapshot = snapshot(pause); run.status = 'paused-server';
  try {
    // Act
    await assert.rejects(run.continue('server', pause), /Debug adapter disconnected/);
    // Assert
    assert.equal(run.status, 'failed'); assert.equal(run.participants.server.gate.current, undefined); assert.match(run.failures[0]!, /Participant continuation failed/);
  } finally { await run.cleanup(); await rm(directory, { recursive: true }); }
});

test('a late contradictory request during teardown invalidates a candidate success rather than disappearing with the connection', async () => {
  // Arrange
  const { run, directory } = await harness(); run.status = 'completed';
  Object.defineProperty(run, 'cleaning', { value: true, writable: true });
  Object.defineProperty(run, 'network', { value: { settled: () => undefined, errors: ['Unexpected request after observation closure'], requests: new Map(), closed: true } });
  const changed = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(run), 'networkChanged')?.value;
  try {
    // Act
    changed.call(run); await run.cleanup();
    const manifest = JSON.parse(await readFile(join(run.evidence.directory, 'manifest.json'), 'utf8'));
    // Assert
    assert.equal(run.status, 'failed'); assert.equal(manifest.finalOutcome, 'not-demonstrated'); assert.deepEqual([...run.failures], ['Unexpected request after observation closure']);
  } finally { await rm(directory, { recursive: true }); }
});

test('a completed runtime with one missing image remains partial after owned teardown', async () => {
  // Arrange
  const { run, directory } = await harness(); run.status = 'completed';
  for (const phase of ['before', 'paused-browser', 'after']) run.captures[phase] = { status: 'captured', file: `${phase}.png`, renderer: { epoch: 'epoch', id: 1, hash: 'hash' } };
  run.captures['paused-server'] = { status: 'failed', error: 'Screenshot timed out' };
  try {
    // Act
    await run.cleanup(); const manifest = JSON.parse(await readFile(join(run.evidence.directory, 'manifest.json'), 'utf8'));
    // Assert
    assert.equal(manifest.runtimeOutcome, 'demonstrated'); assert.equal(manifest.captureOutcome, 'incomplete'); assert.equal(manifest.finalOutcome, 'partial');
    const cleanup = run.evidence.events.find(event => event.type === 'cleanup.completed');
    assert.equal(JSON.stringify(cleanup?.detail), '{"backendObservation":"not-launched"}');
  } finally { await rm(directory, { recursive: true }); }
});

test('one participant release failure still releases the other debugger and browser and preserves retryable cleanup evidence', async () => {
  // Arrange
  const { run, directory, nativeDebug } = await harness(); const released: string[] = []; let failClose = true;
  Reflect.set(run.participants.server, 'cdp', { close() { released.push('server'); if (failClose) throw new Error('injected close failure'); } });
  Reflect.set(run.participants.browser, 'cdp', { close() { released.push('browser'); } });
  Reflect.set(run, 'browser', { resumeViewport() {}, async drainAcquisitions() {}, async close() { released.push('viewport'); } });
  const session = { id: 'owned', name: 'owned', type: 'pwa-node', configuration: { type: 'pwa-node', request: 'launch', name: 'owned' }, workspaceFolder: undefined, customRequest: async () => undefined, getDebugProtocolBreakpoint: async () => undefined };
  run.sessions.set('owned', { session, name: 'server' }); run.activeSessions.add('owned');
  nativeDebug.stopDebugging = async () => { released.push('debugger'); run.activeSessions.clear(); return true; };
  try {
    // Act
    await assert.rejects(run.cleanup(), /injected close failure/);
    const partial = JSON.parse(await readFile(join(run.evidence.directory, 'manifest.json'), 'utf8'));
    failClose = false; await run.cleanup();
    // Assert
    assert.deepEqual(released.slice(0, 4), ['server', 'browser', 'debugger', 'viewport']);
    assert.equal(partial.cleaned, false); assert.match(partial.failures.join('\n'), /server CDP close/); assert.equal(run.view().cleaned, true);
  } finally { failClose = false; await run.cleanup(); await rm(directory, { recursive: true }); }
});
