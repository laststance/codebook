import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import type * as ViewportModule from '../browserViewport';
import type { Scenario } from '../constants';
import { Cdp } from '../cdp';

/** Drives actual {@link BrowserViewport} through editor lifecycle boundaries without pretending to verify native paint. @example await viewportHarness('normal') */
async function viewportHarness(scenario: Scenario, leased = false, observer?: ViewportModule.ViewportRecordingObserver, mode: 'live' | 'recording' = 'live') {
  const filename = join(__dirname, '../browserViewport.js');
  const nativeRequire = createRequire(filename);
  const exports: Partial<typeof ViewportModule> = {};
  const messages: Record<string, unknown>[] = [];
  let receive: (message: unknown) => void = () => undefined;
  let visibilityChanged = () => undefined;
  let disposed = () => undefined;
  let panelDisposals = 0, leaseReleases = 0;
  const panel = {
    visible: true,
    reveal() { panel.visible = true; visibilityChanged(); },
    dispose() { panelDisposals++; disposed(); },
    onDidDispose(callback: () => undefined) { disposed = callback; return { dispose() { disposed = () => undefined; } }; },
    onDidChangeViewState(callback: () => undefined) { visibilityChanged = callback; return { dispose() { visibilityChanged = () => undefined; } }; },
    webview: {
      html: '',
      onDidReceiveMessage(callback: (message: unknown) => void) { receive = callback; return { dispose() { receive = () => undefined; } }; },
      postMessage(message: Record<string, unknown>) { messages.push(message); return Promise.resolve(true); },
    },
  };
  runInNewContext(await readFile(filename, 'utf8'), {
    exports, Buffer,
    require: (name: string) => name === 'vscode' ? { window: { createWebviewPanel: () => panel }, ViewColumn: { One: 1 } } : nativeRequire(name),
  }, { filename });
  assert.ok(exports.BrowserViewport);
  const events: { type: string; detail: unknown }[] = [];
  const viewport: ViewportModule.BrowserViewport = runInNewContext('new Viewport("owned-run", record, () => undefined, scenario, lease, observer, mode)', {
    Viewport: exports.BrowserViewport, scenario, observer, mode, record: (type: string, detail: unknown) => events.push({ type, detail }), lease: leased ? { panel, released() { leaseReleases++; } } : undefined,
  });
  return {
    viewport, messages, panel, events, counts: () => ({ panelDisposals, leaseReleases }),
    hide() { panel.visible = false; visibilityChanged(); },
    ready(epoch: string) {
      receive({ type: 'ready', epoch });
      receive({ type: 'ready', epoch, requestId: messages.findLast(message => message.type === 'requestReady')?.requestId });
    },
    receive: (message: unknown) => receive(message),
  };
}

test('revealing a destroyed renderer cannot confirm an image using its old readiness response', async () => {
  // Arrange
  const harness = await viewportHarness('normal');
  const firstEpoch = '11111111-1111-1111-1111-111111111111';
  const secondEpoch = '22222222-2222-2222-2222-222222222222';
  harness.ready(firstEpoch);
  const oldRequest = harness.messages.findLast(message => message.type === 'requestReady');
  harness.hide();
  let revealed = false;
  const reveal = harness.viewport.reveal(new AbortController().signal).then(() => { revealed = true; });
  // Act
  harness.receive({ type: 'ready', epoch: firstEpoch, requestId: oldRequest?.requestId });
  await delay(0);
  // Assert
  assert.equal(revealed, false);
  harness.ready(secondEpoch);
  await reveal;
  const capture = harness.viewport.present('YWZ0ZXI=', 'after');
  await delay(0);
  const sent = harness.messages.findLast(message => message.type === 'frame');
  assert.equal(sent?.epoch, secondEpoch);
  harness.receive({ type: 'painted', epoch: secondEpoch, id: sent?.id });
  assert.equal((await capture).epoch, secondEpoch);
  harness.viewport.close();
});

test('a recorded seek clears pending pixels and rejects their late acknowledgement before a replacement image', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true, undefined, 'recording'), epoch = '11111111-1111-1111-1111-111111111111';
  harness.ready(epoch); const original = harness.viewport.present('b2xk', 'Recorded 0.10 s'), rejected = assert.rejects(original, /invalidated/);
  await delay(0); const first = harness.messages.findLast(message => message.type === 'frame');
  // Act
  harness.viewport.clearRecorded(); harness.receive({ type: 'painted', epoch, id: first?.id });
  const replacement = harness.viewport.present('bmV3', 'Recorded 0.20 s'); await delay(0);
  const second = harness.messages.findLast(message => message.type === 'frame'); harness.receive({ type: 'painted', epoch, id: second?.id });
  // Assert
  await rejected; assert.equal((await replacement).id, 2);
  assert.equal(harness.messages.some(message => message.type === 'reset' && message.clear === true), true);
  assert.equal(harness.events.filter(event => event.type === 'viewport.acknowledged').length, 1); harness.viewport.close();
});

test('a recorded gap requires its own current renderer receipt and never certifies a PNG', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true, undefined, 'recording'), epoch = '11111111-1111-1111-1111-111111111111';
  harness.ready(epoch); let confirmed = false;
  // Act
  const pending = harness.viewport.presentMissing('Stream lost').then(() => { confirmed = true; }); await delay(0);
  const missing = harness.messages.findLast(message => message.type === 'missing');
  harness.receive({ type: 'missing-painted', epoch: '22222222-2222-2222-2222-222222222222', id: missing?.id }); await delay(0);
  assert.equal(confirmed, false); harness.receive({ type: 'missing-painted', epoch, id: missing?.id }); await pending;
  // Assert
  assert.equal(confirmed, true); assert.equal(harness.messages.some(message => message.type === 'frame'), false);
  assert.equal(harness.events.some(event => event.type === 'viewport.acknowledged'), false); harness.viewport.close();
});

test('recording receives a stream frame only after its CDP acknowledgement is sent and observer failure cannot stop rendering', async () => {
  // Arrange
  const requests: string[] = [], order: string[] = [], observed: number[] = [];
  class RespondingSocket extends EventTarget {
    send(value: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      const message = JSON.parse(String(value)); requests.push(message.method);
      if (message.method === 'Page.screencastFrameAck') order.push('ack');
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: message.id, result: {} }) })));
    }
    close(): void { this.dispatchEvent(new Event('close')); }
  }
  const socket = new RespondingSocket(), cdp = new Cdp(socket, () => undefined);
  const harness = await viewportHarness('normal', false, { elapsedMs: () => 75, frame(input) { order.push('observer'); observed.push(input.elapsedMs); throw new Error('injected recorder error'); }, closed() {} });
  const attaching = harness.viewport.attach(cdp, new AbortController().signal);
  await delay(0); harness.ready('11111111-1111-1111-1111-111111111111'); await attaching;
  // Act
  for (let index = 0; index < 2; index++) socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method: 'Page.screencastFrame', params: { data: 'cGl4ZWxz', sessionId: index + 1, metadata: { timestamp: 1234 } } }) }));
  await delay(0);
  // Assert
  assert.deepEqual(order, ['ack', 'observer', 'ack']); assert.deepEqual(observed, [75]);
  assert.equal(requests.filter(method => method === 'Page.screencastFrameAck').length, 2);
  assert.equal(harness.events.filter(event => event.type === 'recording.observer-failed').length, 1);
  assert.equal(harness.messages.some(message => message.type === 'frame'), true);
  harness.viewport.close(); cdp.close();
});

test('recorded phase receipt precedes presentation and hidden history never earns a renderer confirmation', async () => {
  // Arrange
  const observed: Parameters<ViewportModule.ViewportRecordingObserver['frame']>[0][] = [];
  const closes: Parameters<ViewportModule.ViewportRecordingObserver['closed']>[0][] = [];
  const harness = await viewportHarness('normal', true, { elapsedMs: () => 123, frame: frame => observed.push(frame), closed: event => closes.push(event) });
  harness.viewport.showHistory('<p>Historical study</p>');
  // Act
  harness.viewport.recordCapture('cGl4ZWxz', 'paused-server');
  await assert.rejects(harness.viewport.present('cGl4ZWxz', 'paused-server'), /viewing history/);
  harness.viewport.close(); harness.viewport.close();
  // Assert
  assert.equal(observed.length, 1); assert.equal(observed[0]?.elapsedMs, 123); assert.equal(observed[0]?.kind, 'phase');
  assert.equal(harness.events.some(event => event.type === 'viewport.acknowledged'), false);
  assert.equal(closes.length, 1); assert.equal(closes[0]?.expected, true);
});

test('historical reading rejects hidden current captures and releases the runtime without closing its reader panel', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true), epoch = '11111111-1111-1111-1111-111111111111';
  harness.ready(epoch);
  // Act
  harness.viewport.showHistory('<p>Server observation history</p>');
  await assert.rejects(harness.viewport.present('cGF1c2U=', 'paused-browser'), /viewing history/);
  harness.receive({ type: 'ready', epoch: '22222222-2222-2222-2222-222222222222' });
  harness.viewport.close();
  const messagesAfterClose = harness.messages.length;
  harness.receive({ type: 'ready', epoch });
  // Assert
  assert.equal(harness.panel.webview.html, '<p>Server observation history</p>');
  assert.deepEqual(harness.counts(), { panelDisposals: 0, leaseReleases: 1 });
  assert.equal(harness.messages.length, messagesAfterClose);
});

test('continuation during renderer reload prevents the retired pause from being displayed or acknowledged', async () => {
  // Arrange
  const harness = await viewportHarness('viewport-reload');
  harness.ready('11111111-1111-1111-1111-111111111111');
  const capture = harness.viewport.present('cGF1c2U=', 'paused-1');
  const rejected = assert.rejects(capture, /presentation invalidated/);
  // Act
  harness.viewport.resume();
  harness.ready('22222222-2222-2222-2222-222222222222');
  await rejected;
  // Assert
  assert.equal(harness.messages.some(message => message.type === 'frame' && message.phase === 'paused-1'), false);
  harness.viewport.close();
});

test('invalidating a displayed pause rejects its late acknowledgement before any newer image can be certified', async () => {
  // Arrange
  const harness = await viewportHarness('normal');
  const epoch = '11111111-1111-1111-1111-111111111111';
  harness.ready(epoch);
  const capture = harness.viewport.present('cGF1c2U=', 'paused-1');
  const rejected = assert.rejects(capture, /Pause display invalidated/);
  await delay(0);
  const sent = harness.messages.findLast(message => message.type === 'frame');
  // Act
  harness.viewport.resume();
  harness.receive({ type: 'painted', epoch, id: sent?.id });
  // Assert
  await rejected;
  assert.equal(harness.messages.at(-1)?.type, 'reset');
  harness.viewport.close();
});

test('native placement drains the current required image and holds newer image delivery until release', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true), epoch = '11111111-1111-1111-1111-111111111111';
  harness.ready(epoch);
  const first = harness.viewport.present('Zmlyc3Q=', 'paused-1'); await delay(0);
  const firstFrame = harness.messages.findLast(message => message.type === 'frame');
  let acquired = false;
  // Act
  const placement = harness.viewport.holdPlacement(new AbortController().signal).then(release => { acquired = true; return release; });
  const next = harness.viewport.present('bmV4dA==', 'paused-2'); await delay(0);
  // Assert
  assert.equal(acquired, false); assert.equal(harness.messages.filter(message => message.type === 'frame').length, 1);
  harness.receive({ type: 'painted', epoch, id: firstFrame?.id }); await first;
  const release = await placement; await delay(0);
  assert.equal(acquired, true); assert.equal(harness.messages.filter(message => message.type === 'frame').length, 1);
  release(); await delay(0);
  const nextFrame = harness.messages.findLast(message => message.type === 'frame');
  assert.equal(harness.messages.filter(message => message.type === 'frame').length, 2); assert.equal(nextFrame?.data, 'bmV4dA==');
  harness.receive({ type: 'painted', epoch, id: nextFrame?.id }); await next;
  harness.viewport.close();
});

test('closing a viewport releases held placement without delivering a queued historical image', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true); harness.ready('11111111-1111-1111-1111-111111111111');
  const release = await harness.viewport.holdPlacement(new AbortController().signal);
  const queued = harness.viewport.present('cXVldWVk', 'paused-1'), rejected = assert.rejects(queued, /closed/);
  // Act
  harness.viewport.close(); release(); await rejected;
  // Assert
  assert.equal(harness.messages.filter(message => message.type === 'frame').length, 0);
  assert.deepEqual(harness.counts(), { panelDisposals: 0, leaseReleases: 1 });
});

test('manual continuation while placement drains invalidates the old paint and releases waiting work', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true), epoch = '11111111-1111-1111-1111-111111111111'; harness.ready(epoch);
  const first = harness.viewport.present('cGF1c2U=', 'paused-1'), rejected = assert.rejects(first, /invalidated/); await delay(0);
  const placement = harness.viewport.holdPlacement(new AbortController().signal), placementRejected = assert.rejects(placement, /invalidated/);
  // Act
  harness.viewport.resume(); await rejected; await placementRejected;
  const next = harness.viewport.present('YWZ0ZXI=', 'after'); await delay(0);
  const frame = harness.messages.findLast(message => message.type === 'frame'); harness.receive({ type: 'painted', epoch, id: frame?.id });
  // Assert
  assert.equal((await next).epoch, epoch); harness.viewport.close();
});
