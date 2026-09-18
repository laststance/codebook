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
import type { inspectParticipant } from '../inspectParticipant';
import type { ProfileId } from '../constants';
import { NetworkEvidence } from '../networkEvidence';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';

/** Loads the actual paired coordinator with only native VS Code replaced for lifecycle tests. @example const { run, directory } = await harness() */
async function harness(profile?: ProfileId, inspector?: typeof inspectParticipant) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-paired-lifecycle-'));
  const filename = join(__dirname, '../run.js'), nativeRequire = createRequire(filename);
  const exports: Partial<typeof RunModule> = {};
  const nativeDebug = { stopDebugging: async () => true, removeBreakpoints: () => undefined };
  class SourceInput { constructor(readonly uri: { fsPath: string }) {} }
  const sourceTabs: { input: SourceInput }[] = [];
  const tabGroups = { all: [{ tabs: sourceTabs }], close: async (tabs: typeof sourceTabs) => { for (const tab of tabs) sourceTabs.splice(sourceTabs.indexOf(tab), 1); return true; } };
  runInNewContext(await readFile(filename, 'utf8'), { exports, AbortController, Buffer, performance, process, setInterval, clearInterval,
    require: (name: string) => name === 'vscode' ? { version: 'test', extensions: { getExtension: () => undefined }, debug: nativeDebug, TabInputText: SourceInput, window: { tabGroups } }
      : name === 'codebook-cycle-0001/dist/hostBrowser' ? {} : name === './inspectParticipant' && inspector ? { inspectParticipant: inspector } : nativeRequire(name),
  }, { filename });
  assert.ok(exports.PairedRun);
  const run = new exports.PairedRun({ artifactRoot: directory, templateRoot: directory, descriptorPath: '', profile, revision: 'test', dirty: true, sourceHash: 'test', nodeExecutable: '/node', host: { id: 'vscode', productVersion: 'test', apiVersion: 'test', commit: 'test' } }, 'normal');
  return { run, directory, nativeDebug, sourceTabs, SourceInput };
}

for (const fault of [false, true]) {
  test(`${fault ? 'automatic failure cleanup' : 'explicit cleanup'} drains a late source tab and prevents post-release evidence`, async () => {
    // Arrange
    const { run, directory, sourceTabs, SourceInput } = await harness();
    const sourcePath = join(directory, 'source.mts'); run.participants.server.source = { sourcePath, source: '', javascript: '', sourceMap: '', breakpointLine: 1 };
    let entered = false, release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const revealing = run.ownSourceReveal(async check => { entered = true; await barrier; sourceTabs.push({ input: new SourceInput({ fsPath: sourcePath }) }); check(); run.evidence.record('agent.source-revealed'); });
    const cancellation = fault ? /Injected debugger failure/ : /Run cleanup/;
    const rejected = assert.rejects(revealing, cancellation);
    try {
      await waitUntil(() => entered, 'source tab acquisition', 1_000);
      // Act
      if (fault) run.fail('Injected debugger failure');
      const cleanup = run.cleanup(); await Promise.resolve(); assert.equal(run.view().resourcesReleased, false);
      release(); await rejected; await cleanup;
      // Assert
      assert.equal(sourceTabs.length, 0); assert.equal(run.view().resourcesReleased, true); assert.equal(run.view().cleaned, true);
      assert.equal(run.evidence.events.some(event => event.type === 'agent.source-revealed'), false);
      assert.throws(() => run.ownSourceReveal(async () => {}), cancellation);
    } finally { release(); await run.cleanup(); await rm(directory, { recursive: true }); }
  });
}

/** Supplies a historical snapshot reference at the inspector boundary, without pretending to validate a real debugger. @example snapshot({ sessionId: 'server', threadId: 0, generation: 1 }) */
function snapshot(pause: PauseIdentity): ParticipantSnapshot {
  return { id: 'server:1', participant: 'server', itemId: 'paired-cart-demo/server', actionId: 'add-to-cart', capturePhase: 'paused-server', pause, frame: { id: 1, name: 'addProduct', line: 1, column: 1 }, values: { operationId: 'run', cartId: 'selected', productId: 'tote-01', price: 24, cartCount: 0, admittedCount: 2 }, evaluations: [], source: { scriptId: 'script', scriptLocation: { scriptId: 'script', lineNumber: 0 }, mapping: { generatedLine: 0, generatedColumn: 0, originalSource: 'server.mts', originalLine: 0, originalColumn: 0 }, typescriptHash: 'typescript', javascriptHash: 'javascript', sourceMapHash: 'map' } };
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
    assert.equal(partial.cleaned, false); assert.equal(partial.resourcesReleased, false); assert.match(partial.failures.join('\n'), /server CDP close/);
    assert.equal(run.view().cleaned, true); assert.equal(run.view().resourcesReleased, true);
  } finally { failClose = false; await run.cleanup(); await rm(directory, { recursive: true }); }
});

test('a failed run releases owned resources without any external delete request', async () => {
  // Arrange
  const { run, directory, nativeDebug } = await harness(); const released: string[] = [];
  Reflect.set(run.participants.server, 'cdp', { close() { released.push('server'); } });
  Reflect.set(run.participants.browser, 'cdp', { close() { released.push('browser'); } });
  Reflect.set(run, 'browser', { resumeViewport() {}, async drainAcquisitions() {}, async close() { released.push('viewport'); } });
  const session = { id: 'owned', name: 'owned', type: 'pwa-node', configuration: { type: 'pwa-node', request: 'launch', name: 'owned' }, workspaceFolder: undefined, customRequest: async () => undefined, getDebugProtocolBreakpoint: async () => undefined };
  run.sessions.set('owned', { session, name: 'server' }); run.activeSessions.add('owned');
  nativeDebug.stopDebugging = async () => { released.push('debugger'); run.activeSessions.clear(); return true; };
  try {
    // Act: no cleanup call occurs before the externally observable resource state is checked.
    run.fail('Missing operation identity');
    await waitUntil(() => run.view().cleaned, 'automatic failure cleanup', 1_000);
    // Assert
    assert.deepEqual(released, ['server', 'browser', 'debugger', 'viewport']);
    assert.equal(run.view().status, 'failed'); assert.equal(run.view().finalOutcome, 'not-demonstrated'); assert.deepEqual([...run.failures], ['Missing operation identity']);
  } finally { await run.cleanup(); await rm(directory, { recursive: true }); }
});

test('pending or failed final evidence persistence never publishes a demonstrated run', async () => {
  // Arrange: intercept only the real Evidence writer; the coordinator and cleanup flow stay intact.
  const { run, directory } = await harness(); run.status = 'completed';
  for (const phase of ['before', 'paused-server', 'paused-browser', 'after']) run.captures[phase] = { status: 'captured', file: `${phase}.png`, renderer: { epoch: 'epoch', id: 1, hash: 'hash' } };
  const save = run.evidence.save.bind(run.evidence);
  let entered = false; let rejectWrite: (error: Error) => void = () => undefined;
  run.evidence.save = async () => { entered = true; await new Promise<void>((_, reject) => { rejectWrite = reject; }); };
  try {
    // Act
    const cleanup = run.cleanup(); const rejected = assert.rejects(cleanup, /ENOSPC: final evidence write/);
    await waitUntil(() => entered, 'final manifest write started', 1_000);
    const pending = run.view(); rejectWrite(new Error('ENOSPC: final evidence write')); await rejected;
    // Assert
    assert.equal(pending.cleaned, false); assert.equal(pending.finalOutcome, 'pending-teardown');
    assert.equal(run.view().cleaned, false); assert.equal(run.view().resourcesReleased, true); assert.equal(run.view().status, 'failed');
    assert.equal(run.view().runtimeOutcome, 'not-demonstrated'); assert.equal(run.view().finalOutcome, 'pending-teardown');
    assert.match(run.view().failures.join('\n'), /Final evidence persistence failed: Error: ENOSPC/);
  } finally { run.evidence.save = save; await run.cleanup(); await rm(directory, { recursive: true }); }
});

test('an earlier evidence write failure blocks the final manifest before success bytes are written', async () => {
  // Arrange
  const { run, directory } = await harness(); run.status = 'completed';
  const save = run.evidence.save.bind(run.evidence); let writes = 0;
  run.evidence.save = async (...arguments_) => { writes++; await save(...arguments_); };
  run.evidence.failure = 'ENOSPC: event append';
  try {
    // Act
    await assert.rejects(run.cleanup(), /ENOSPC: event append/);
    // Assert
    assert.equal(writes, 0); assert.equal(run.view().cleaned, false); assert.equal(run.view().resourcesReleased, true); assert.equal(run.view().status, 'failed');
    assert.match(run.view().failures.join('\n'), /Final evidence persistence failed/);
  } finally { run.evidence.failure = undefined; await run.cleanup(); await rm(directory, { recursive: true }); }
});

/** Feeds independent hard-coded response facts to the real network reducer during coordinator tests. @example feedNetwork(network, 'selected', facts) */
function feedNetwork(network: NetworkEvidence, requestId: string, facts: ParticipantSnapshot['values']): void {
  network.request({ requestId, loaderId: 'page', documentURL: network.url, timestamp: 1, wallTime: 1, redirectHasExtraInfo: false,
    initiator: { type: 'script', stack: { callFrames: [{ functionName: 'request', scriptId: 'client', url: network.clientUrl, lineNumber: 1, columnNumber: 1 }] } },
    request: { url: network.url, method: 'POST', headers: { 'x-codebook-operation': facts.operationId }, postData: JSON.stringify(facts), initialPriority: 'High', referrerPolicy: 'no-referrer' } }, 1);
  network.response({ requestId, loaderId: 'page', timestamp: 2, type: 'Fetch', hasExtraInfo: false, response: { url: network.url, status: 200, statusText: 'OK', headers: {}, mimeType: 'application/json', charset: 'utf-8', connectionReused: false, connectionId: 1, encodedDataLength: 100, securityState: 'neutral' } });
  network.finished(requestId, 3); network.body(requestId, { body: JSON.stringify(facts), base64Encoded: false });
}

test('checkout keeps four observations in one session pair and never redispatches a retained action key', async () => {
  // Arrange: real coordinator/reducer/writer; only editor, CDP and inspector effects are synthetic.
  let runtimeId = '';
  const { run, directory } = await harness('checkout-demo', async (name, _session, _cdp, pause, _paused, _seal, check, _signal, _evidence, item) => {
    check();
    const values: ParticipantSnapshot['values'] = item.action === 'add-to-cart'
      ? { operationId: runtimeId, cartId: 'selected', productId: 'tote-01', price: 24, cartCount: name === 'server' ? 0 : 1, admittedCount: 2 }
      : { operationId: `${runtimeId}-checkout`, cartId: 'selected', productId: 'tote-01', price: 24, cartCount: 1, admittedCount: 2, cartOperationId: runtimeId, orderId: `order-${runtimeId}`, total: 24, orderCount: name === 'server' ? 0 : 1 };
    return { ...snapshot(pause), id: `${pause.sessionId}:${pause.generation}`, participant: name, itemId: item.id, actionId: item.action, capturePhase: item.capturePhase, values };
  });
  runtimeId = run.id;
  const inputs: string[] = [];
  const cdp = { close() {}, async request(method: string, parameters?: { expression?: string; type?: string }) {
    if (method === 'Input.dispatchMouseEvent') { inputs.push(parameters?.type ?? ''); return {}; }
    if (method === 'Page.captureScreenshot') return { data: Buffer.from('synthetic png bytes').toString('base64') };
    if (parameters?.expression?.includes('getBoundingClientRect')) return { result: { value: '{"x":10,"y":10}' } };
    return { result: { value: JSON.stringify(run.operation?.actionId === 'checkout' ? { cartCount: 1, completedClicks: 1, orderId: `order-${run.id}`, total: 24, status: 'confirmed', completedCheckouts: 1 } : { cartCount: 1, completedClicks: 1 }) } };
  } };
  Reflect.set(run, 'browser', { resumeViewport() {}, async reveal() {}, async drainAcquisitions() {}, async close() {}, async presentCapture() { return { epoch: 'test', id: 1, hash: 'test' }; } });
  for (const name of ['server', 'browser'] as const) {
    const session = { id: `${name}-session`, name, type: 'test', configuration: { name, type: 'test', request: 'launch' }, workspaceFolder: undefined,
      async customRequest(command: string, arguments_: { threadId: number }) { run.onRequest(session, { seq: 1, type: 'request', command }); run.onEvent(session, { seq: 2, type: 'event', event: 'continued', body: arguments_ }); }, getDebugProtocolBreakpoint: async () => undefined };
    run.participants[name].selected = session; Reflect.set(run.participants[name], 'cdp', cdp);
  }
  for (const item of run.profile.items) run.sources.set(item.id, { sourcePath: join(directory, item.file), source: '', javascript: '', sourceMap: '', breakpointLine: 1 });
  for (const action of run.profile.actions) run.networks.set(action.id, new NetworkEvidence(run.id, `http://localhost/${action.route}`, 'http://localhost/client.mjs', action.id));
  run.status = 'ready';
  const cartResponse = { operationId: run.id, cartId: 'selected', productId: 'tote-01', price: 24, cartCount: 1, admittedCount: 2 };
  const backgroundCart = { operationId: `${run.id}-background`, cartId: 'background', productId: 'background-02', price: 99, cartCount: 1, admittedCount: 2 };
  try {
    // Act / Assert: out-of-order input and key conflicts never reach CDP.
    assert.throws(() => run.acceptAction('early', 'checkout'), /expected add-to-cart/); assert.equal(inputs.length, 0);
    const first = run.acceptAction('cart-key'); assert.equal(run.acceptAction('cart-key').id, first.id);
    assert.throws(() => run.acceptAction('cart-key', 'checkout'), /idempotency key/);
    assert.throws(() => run.acceptAction('another-cart-key'), /conflict/);
    await waitUntil(() => first.inputAcknowledged, 'first input acknowledged', 1_000);
    feedNetwork(run.networks.get('add-to-cart')!, 'cart-selected', cartResponse); feedNetwork(run.networks.get('add-to-cart')!, 'cart-background', backgroundCart);
    const oldPauses: Partial<Record<'server' | 'browser', PauseIdentity>> = {};
    let firstSnapshotBytes = '';
    for (const [index, item] of run.profile.items.entries()) {
      if (index === 2) {
        await waitUntil(() => run.view().nextAction === 'checkout', 'second action admission', 1_000);
        firstSnapshotBytes = await readFile(join(run.evidence.directory, 'cart-mutation-snapshot.json'), 'utf8');
        assert.equal(run.acceptAction('cart-key').id, first.id);
        assert.throws(() => run.acceptAction('different-cart-key'), /conflict/);
        const second = run.acceptAction('order-key', 'checkout'); assert.equal(run.acceptAction('order-key', 'checkout').id, second.id);
        await waitUntil(() => second.inputAcknowledged, 'second input acknowledged', 1_000);
        feedNetwork(run.networks.get('checkout')!, 'order-background', { ...backgroundCart, operationId: `${run.id}-checkout-background`, cartOperationId: `${run.id}-background`, orderId: `order-${run.id}-background`, total: 99, orderCount: 1 });
        feedNetwork(run.networks.get('checkout')!, 'order-selected', { ...cartResponse, operationId: `${run.id}-checkout`, cartOperationId: run.id, orderId: `order-${run.id}`, total: 24, orderCount: 1 });
      }
      const participant = run.participants[item.participant];
      participant.stopped = { callFrames: [], reason: 'other' };
      run.onEvent(participant.selected!, { seq: index + 1, type: 'event', event: 'stopped', body: { threadId: 1, reason: 'breakpoint' } });
      await waitUntil(() => {
        assert.notEqual(run.status, 'failed', run.failures.join('\n'));
        assert.notEqual(run.captures[item.capturePhase]?.status, 'failed', run.captures[item.capturePhase]?.error);
        return run.snapshots.length === index + 1 && run.captures[item.capturePhase]?.status === 'captured';
      }, 'synthetic committed stop', 1_000);
      const pause = participant.gate.current!;
      if (index < 2) oldPauses[item.participant] = pause;
      else await assert.rejects(run.continue(item.participant, oldPauses[item.participant]!), /conflict/);
      assert.equal(pause.generation, index < 2 ? 1 : 2);
      await run.continue(item.participant, pause);
    }
    await waitUntil(() => run.status === 'completed', 'checkout candidate', 1_000);
    assert.equal(run.snapshots.length, 4); assert.equal(run.operations.length, 2);
    assert.deepEqual(inputs, ['mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased']);
    assert.equal(run.links.filter(link => link.status === 'observed').length, 11);
    assert.equal(run.networks.get('add-to-cart')!.closed, true); assert.equal(run.networks.get('checkout')!.closed, true);
    assert.equal(await readFile(join(run.evidence.directory, 'cart-mutation-snapshot.json'), 'utf8'), firstSnapshotBytes);
    assert.deepEqual(JSON.parse(JSON.stringify(run.observed)), { cartCount: 1, completedClicks: 1, orderId: `order-${run.id}`, total: 24, status: 'confirmed', completedCheckouts: 1 });
    await run.cleanup(); assert.equal(run.acceptAction('cart-key').id, first.id);
    assert.equal(run.view().captureOutcome, 'incomplete', 'No synthetic before image is promoted to native proof');
  } finally { await run.cleanup(); await rm(directory, { recursive: true }); }
});
