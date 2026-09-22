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

/** Models multiple viewport listeners on one reader so {@link viewportHarness} can verify shared lease retirement. @example const renderer = viewportPanel() */
function viewportPanel() {
  const messages: Record<string, unknown>[] = [];
  const receivers = new Set<(message: unknown) => void>(), visibility = new Set<() => void>(), disposal = new Set<() => void>();
  const posted = new Set<(message: Record<string, unknown>) => void>();
  let panelDisposals = 0;
  const panel = {
    visible: true,
    reveal() { panel.visible = true; for (const callback of visibility) callback(); },
    dispose() { if (panelDisposals) return; panelDisposals++; for (const callback of [...disposal]) callback(); },
    onDidDispose(callback: () => void) { disposal.add(callback); return { dispose() { disposal.delete(callback); } }; },
    onDidChangeViewState(callback: () => void) { visibility.add(callback); return { dispose() { visibility.delete(callback); } }; },
    webview: {
      html: '',
      onDidReceiveMessage(callback: (message: unknown) => void) { receivers.add(callback); return { dispose() { receivers.delete(callback); } }; },
      postMessage(message: Record<string, unknown>) { messages.push(message); for (const callback of [...posted]) callback(message); return Promise.resolve(true); },
    },
  };
  return {
    panel, messages, disposals: () => panelDisposals,
    callbacks: () => ({ receivers: [...receivers], visibility: [...visibility], disposal: [...disposal] }),
    hide() { panel.visible = false; for (const callback of visibility) callback(); },
    receive(message: unknown) { for (const callback of [...receivers]) callback(message); },
    nextFrame(): Promise<Record<string, unknown>> {
      return new Promise(resolve => {
        const callback = (message: Record<string, unknown>) => { if (message.type !== 'frame') return; posted.delete(callback); resolve(message); };
        posted.add(callback);
      });
    },
    ready(epoch: string) {
      for (const callback of receivers) {
        callback({ type: 'ready', epoch });
        callback({ type: 'ready', epoch, requestId: messages.findLast(message => message.type === 'requestReady')?.requestId });
      }
    },
  };
}

/** Drives actual {@link BrowserViewport} through editor lifecycle boundaries without pretending to verify native paint. @example await viewportHarness('normal') */
async function viewportHarness(scenario: Scenario, leased = false, observer?: ViewportModule.ViewportRecordingObserver, mode: 'live' | 'recording' = 'live', renderer = viewportPanel()) {
  const filename = join(__dirname, '../browserViewport.js');
  const nativeRequire = createRequire(filename);
  const exports: Partial<typeof ViewportModule> = {};
  const { panel } = renderer;
  let leaseReleases = 0;
  const failures: string[] = [];
  runInNewContext(await readFile(filename, 'utf8'), {
    exports, Buffer,
    require: (name: string) => name === 'vscode' ? { window: { createWebviewPanel: () => panel }, ViewColumn: { One: 1 } } : nativeRequire(name),
  }, { filename });
  assert.ok(exports.BrowserViewport);
  const events: { type: string; detail: unknown }[] = [];
  const viewport: ViewportModule.BrowserViewport = runInNewContext('new Viewport("owned-run", record, fail, scenario, lease, observer, mode)', {
    Viewport: exports.BrowserViewport, scenario, observer, mode, record: (type: string, detail: unknown) => events.push({ type, detail }), fail: (reason: string) => failures.push(reason), lease: leased ? { panel, released() { leaseReleases++; } } : undefined,
  });
  return {
    ...renderer, viewport, events, failures, counts: () => ({ panelDisposals: renderer.disposals(), leaseReleases }),
    rebind(replacement: ReturnType<typeof viewportPanel>, signal = new AbortController().signal) {
      runInNewContext('viewport.rebindPanel(panel, signal)', { viewport, panel: replacement.panel, signal });
    },
  };
}

test('closing a shared application panel ends both live and replay leases unless each lease has transferred', async () => {
  // Arrange
  const renderer = viewportPanel(), closes: boolean[] = [];
  const live = await viewportHarness('normal', true, { elapsedMs: () => 123, frame() {}, closed: event => closes.push(event.expected) }, 'live', renderer);
  live.viewport.showHistory('<p>Independent live session hidden by replay</p>');
  const replay = await viewportHarness('normal', true, undefined, 'recording', renderer);
  // Act
  renderer.panel.dispose();
  // Assert
  assert.deepEqual(live.failures, ['Owned viewport closed before cleanup']);
  assert.deepEqual(replay.failures, ['Owned viewport closed before cleanup']);
  assert.deepEqual(closes, [false]);
  live.viewport.close(); replay.viewport.close();
});

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

test('a held viewport transfers its paused pixels without letting the retired panel close or acknowledge the session', async () => {
  // Arrange
  const closes: boolean[] = [], observed: string[] = [];
  const harness = await viewportHarness('normal', true, { elapsedMs: () => 123, frame: frame => observed.push(frame.data), closed: event => closes.push(event.expected) });
  const oldEpoch = '11111111-1111-1111-1111-111111111111', newEpoch = '22222222-2222-2222-2222-222222222222';
  harness.ready(oldEpoch);
  const firstFrame = harness.nextFrame(), capture = harness.viewport.present('cGF1c2U=', 'paused-1');
  const original = await firstFrame; harness.receive({ type: 'painted', epoch: oldEpoch, id: original.id }); await capture;
  const retiredCallbacks = harness.callbacks(), replacement = viewportPanel(), signal = new AbortController().signal;
  const release = await harness.viewport.holdPlacement(signal);
  // Act
  harness.rebind(replacement); harness.panel.dispose();
  for (const callback of retiredCallbacks.disposal) callback();
  assert.deepEqual(harness.failures, []); assert.deepEqual(closes, []);
  assert.equal(replacement.panel.webview.html, '');
  release();
  const nextFrame = replacement.nextFrame(); let restored = false;
  const restoration = harness.viewport.restorePlacement(signal).then(() => { restored = true; });
  replacement.ready(newEpoch); const next = await nextFrame;
  for (const callback of retiredCallbacks.receivers) callback({ type: 'painted', epoch: newEpoch, id: next.id });
  replacement.receive({ type: 'painted', epoch: oldEpoch, id: original.id });
  await delay(0);
  // Assert
  assert.equal(restored, false); assert.equal(next.data, 'cGF1c2U='); assert.equal(next.epoch, newEpoch);
  assert.equal(harness.events.filter(event => event.type === 'viewport.acknowledged').length, 1);
  const confirmedFrame = replacement.nextFrame(); replacement.receive({ type: 'painted', epoch: newEpoch, id: next.id });
  const confirmed = await confirmedFrame; replacement.receive({ type: 'painted', epoch: newEpoch, id: confirmed.id }); await restoration;
  harness.viewport.recordCapture('bGF0ZXI=', 'after'); assert.deepEqual(observed, ['bGF0ZXI=']);
  assert.equal(restored, true); assert.deepEqual(harness.failures, []); assert.deepEqual(closes, []);
  replacement.panel.dispose(); replacement.panel.dispose();
  assert.deepEqual(harness.failures, ['Owned viewport closed before cleanup']); assert.deepEqual(closes, [false]);
  harness.viewport.close(); assert.deepEqual(harness.counts(), { panelDisposals: 1, leaseReleases: 1 });
});

test('pane handoff waits for the accepted required paint before detaching its old acknowledgement listener', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true), replacement = viewportPanel(), signal = new AbortController().signal;
  const epoch = '11111111-1111-1111-1111-111111111111'; harness.ready(epoch);
  const nextFrame = harness.nextFrame(), pending = harness.viewport.present('cGF1c2U=', 'paused-1'), frame = await nextFrame;
  // Act
  const holding = harness.viewport.holdPlacement(signal);
  assert.throws(() => harness.rebind(replacement), /current drained lease placement/);
  harness.receive({ type: 'painted', epoch, id: frame.id }); await pending;
  const release = await holding; harness.rebind(replacement); release(); harness.panel.dispose();
  // Assert
  assert.deepEqual(harness.failures, []);
  assert.equal(harness.callbacks().receivers.length, 0);
  assert.equal(replacement.callbacks().receivers.length, 1);
  harness.viewport.close(); assert.equal(replacement.callbacks().receivers.length, 0);
});

test('pane handoff refuses unleased, unreserved, aborted and already closed viewport ownership', async () => {
  // Arrange
  const unleased = await viewportHarness('normal'), leased = await viewportHarness('normal', true), replacement = viewportPanel();
  const signal = new AbortController().signal, aborted = new AbortController(); aborted.abort(new Error('Learner cancelled handoff'));
  const releaseUnleased = await unleased.viewport.holdPlacement(signal);
  // Act
  assert.throws(() => unleased.rebind(replacement), /current drained lease placement/);
  assert.throws(() => leased.rebind(replacement), /current drained lease placement/);
  const release = await leased.viewport.holdPlacement(signal);
  assert.throws(() => leased.rebind(replacement, aborted.signal), /Learner cancelled handoff/);
  leased.viewport.close(); assert.throws(() => leased.rebind(replacement), /current drained lease placement/);
  // Assert
  assert.equal(replacement.panel.webview.html, ''); assert.equal(replacement.callbacks().receivers.length, 0);
  assert.equal(replacement.disposals(), 0); assert.equal(leased.events.some(event => event.type === 'viewport.panel-rebound'), false);
  release(); releaseUnleased(); unleased.viewport.close();
});

test('rebinding both live-history and replay leases preserves the independent recorder and paints only the chosen presentation', async () => {
  // Arrange
  const original = viewportPanel(), replacement = viewportPanel(), closes: boolean[] = [];
  const live = await viewportHarness('normal', true, { elapsedMs: () => 123, frame() {}, closed: event => closes.push(event.expected) }, 'live', original);
  live.viewport.showHistory('<p>Preserved live history</p>');
  const replay = await viewportHarness('normal', true, undefined, 'recording', original), signal = new AbortController().signal;
  const releaseLive = await live.viewport.holdPlacement(signal), releaseReplay = await replay.viewport.holdPlacement(signal);
  // Act
  live.rebind(replacement); replay.rebind(replacement); original.panel.dispose(); releaseLive(); releaseReplay();
  assert.equal(replacement.panel.webview.html, '');
  const revealing = replay.viewport.reveal(signal); replacement.ready('22222222-2222-2222-2222-222222222222'); await revealing;
  const replayHtml = replacement.panel.webview.html;
  await assert.rejects(live.viewport.present('Y3VycmVudA==', 'paused-2'), /viewing history/);
  // Assert
  assert.equal(replacement.panel.webview.html, replayHtml); assert.notEqual(replayHtml, '<p>Preserved live history</p>');
  assert.deepEqual(live.failures, []); assert.deepEqual(replay.failures, []); assert.deepEqual(closes, []);
  replay.viewport.close(); await live.viewport.restorePlacement(signal);
  assert.equal(replacement.panel.webview.html, '<p>Preserved live history</p>');
  live.viewport.close(); live.viewport.close(); assert.deepEqual(closes, [true]);
  assert.equal(replacement.disposals(), 0); assert.equal(replacement.callbacks().receivers.length, 0);
});

test('closing the current panel releases a reserved placement and rejects waiting capture without later cleanup', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true), release = await harness.viewport.holdPlacement(new AbortController().signal);
  const queued = harness.viewport.present('cXVldWVk', 'paused-1').then(() => 'painted', () => 'closed');
  // Act
  harness.panel.dispose();
  const outcome = await Promise.race([queued, delay(100).then(() => 'still waiting for cleanup')]);
  // Assert
  try { assert.equal(outcome, 'closed'); assert.equal(harness.messages.some(message => message.type === 'frame'), false); }
  finally { release(); harness.viewport.close(); await queued; }
});

test('a rebound live viewport keeps one CDP stream and records later frames without closing the recorder', async () => {
  // Arrange
  const requests: string[] = [], observed: string[] = [], closes: boolean[] = [];
  class RespondingSocket extends EventTarget {
    send(value: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      const message = JSON.parse(String(value)); requests.push(message.method);
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: message.id, result: {} }) })));
    }
    close(): void { this.dispatchEvent(new Event('close')); }
  }
  const socket = new RespondingSocket(), cdp = new Cdp(socket, () => undefined), replacement = viewportPanel(), signal = new AbortController().signal;
  const harness = await viewportHarness('normal', true, { elapsedMs: () => 123, frame: frame => observed.push(frame.data), closed: event => closes.push(event.expected) });
  const attaching = harness.viewport.attach(cdp, signal); await delay(0); harness.ready('11111111-1111-1111-1111-111111111111'); await attaching;
  const originalFrame = harness.nextFrame();
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method: 'Page.screencastFrame', params: { data: 'Zmlyc3Q=', sessionId: 1, metadata: { timestamp: 1234 } } }) }));
  const first = await originalFrame; harness.receive({ type: 'painted', epoch: first.epoch, id: first.id });
  // Act
  const release = await harness.viewport.holdPlacement(signal); harness.rebind(replacement); harness.panel.dispose(); release();
  const restoredFrame = replacement.nextFrame(), revealing = harness.viewport.reveal(signal);
  replacement.ready('22222222-2222-2222-2222-222222222222'); await revealing;
  const restored = await restoredFrame; replacement.receive({ type: 'painted', epoch: restored.epoch, id: restored.id });
  const laterFrame = replacement.nextFrame();
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method: 'Page.screencastFrame', params: { data: 'c2Vjb25k', sessionId: 2, metadata: { timestamp: 1235 } } }) }));
  const later = await laterFrame; replacement.receive({ type: 'painted', epoch: later.epoch, id: later.id });
  // Assert
  assert.equal(later.data, 'c2Vjb25k'); assert.deepEqual(observed, ['Zmlyc3Q=', 'c2Vjb25k']);
  assert.equal(requests.filter(method => method === 'Page.startScreencast').length, 1);
  assert.equal(requests.filter(method => method === 'Page.screencastFrameAck').length, 2);
  assert.deepEqual(harness.failures, []); assert.deepEqual(closes, []);
  harness.viewport.close(); cdp.close(); assert.deepEqual(closes, [true]);
});
