import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { FrameDelivery, type FrameMessage, type ViewFrame } from '../runtimeSupport/frameDelivery';

const live: ViewFrame = { data: 'pixels', hash: 'original-hash', phase: 'live', required: false, delayAck: false };
const pause: ViewFrame = { data: 'pause-pixels', hash: 'pause-hash', phase: 'paused-1', required: true, delayAck: false };

test('hidden renderers cannot acknowledge or receive evidence until readiness is re-established', async () => {
  // Arrange
  const delivery = new FrameDelivery(() => Promise.resolve(true), () => undefined);
  delivery.begin('hidden-view');
  const capture = delivery.offer(pause);
  const rejected = assert.rejects(capture, /renderer suspended/);
  await delay(0);
  // Act
  delivery.suspend();
  // Assert
  await rejected;
  assert.equal(delivery.acknowledge('hidden-view', 1), false);
  await assert.rejects(delivery.offer(pause), /not ready/);
  delivery.begin('restored-view');
  const restored = delivery.offer(pause);
  await delay(0);
  assert.equal(delivery.acknowledge('restored-view', 2), true);
  assert.deepEqual(await restored, { epoch: 'restored-view', id: 2, hash: 'pause-hash' });
  delivery.dispose();
});

test('a previous renderer epoch or wrong frame cannot confirm the current source image', async () => {
  // Arrange
  const sent: FrameMessage[] = [];
  const delivery = new FrameDelivery(message => { sent.push(message); return Promise.resolve(true); }, () => undefined);
  delivery.begin('first-view');
  const old = delivery.offer(live);
  const oldRejected = assert.rejects(old, /epoch changed/);
  // Act
  delivery.begin('second-view');
  const current = delivery.offer(pause);
  await delay(0);
  // Assert
  assert.equal(delivery.acknowledge('first-view', 1), false);
  assert.equal(delivery.acknowledge('second-view', 1), false);
  assert.equal(delivery.acknowledge('second-view', 2), true);
  assert.deepEqual(await current, { epoch: 'second-view', id: 2, hash: 'pause-hash' });
  await oldRejected;
  assert.equal(sent.at(-1)?.phase, 'paused-1');
  delivery.dispose();
});

test('a slow renderer retains only the newest pending live frame', async () => {
  // Arrange
  const sent: FrameMessage[] = [];
  const delivery = new FrameDelivery(message => { sent.push(message); return Promise.resolve(true); }, () => undefined);
  delivery.begin('view');
  const first = delivery.offer(live);
  const replaced = delivery.offer({ ...live, hash: 'older-pending' });
  const rejected = assert.rejects(replaced, /coalesced/);
  // Act
  const latest = delivery.offer({ ...live, hash: 'latest-pending' });
  await delay(0);
  assert.equal(sent.length, 1);
  delivery.acknowledge('view', 1);
  await delay(0);
  // Assert
  assert.deepEqual(sent.map(frame => frame.hash), ['original-hash', 'latest-pending']);
  delivery.acknowledge('view', 3);
  await Promise.all([first, latest, rejected]);
  delivery.dispose();
});

test('late live images cannot replace a paused image until continuation invalidates it', async () => {
  // Arrange
  const sent: FrameMessage[] = [];
  const delivery = new FrameDelivery(message => { sent.push(message); return Promise.resolve(true); }, () => undefined);
  delivery.begin('view');
  const old = delivery.offer(live);
  const oldRejected = assert.rejects(old, /superseded/);
  const queued = delivery.offer(live);
  const queuedRejected = assert.rejects(queued, /superseded/);
  await delay(0);
  // Act
  delivery.freeze();
  const captured = delivery.offer(pause);
  await assert.rejects(delivery.offer({ ...live, hash: 'late-stream' }), /withheld/);
  await delay(0);
  delivery.acknowledge('view', 3);
  await captured;
  await assert.rejects(delivery.offer(live), /withheld/);
  // Assert
  assert.deepEqual(sent.map(frame => frame.hash), ['original-hash', 'pause-hash']);
  delivery.resume();
  const after = delivery.offer({ ...live, hash: 'resumed' });
  await delay(0);
  delivery.acknowledge('view', 4);
  await Promise.all([oldRejected, queuedRejected, after]);
  assert.equal(sent.at(-1)?.hash, 'resumed');
  delivery.dispose();
});

test('a missing paint acknowledgement expires without confirming a later phase', async () => {
  // Arrange
  const delivery = new FrameDelivery(() => Promise.resolve(true), () => undefined, 20);
  delivery.begin('view');
  // Act
  await assert.rejects(delivery.offer(pause), /acknowledgement timed out/);
  const after = delivery.offer({ ...pause, phase: 'after', hash: 'after-hash' });
  await delay(0);
  // Assert
  assert.equal(delivery.acknowledge('view', 1), false);
  assert.equal(delivery.acknowledge('view', 2), true);
  assert.deepEqual(await after, { epoch: 'view', id: 2, hash: 'after-hash' });
  delivery.dispose();
});

test('closing a viewport rejects both bounded slots and ignores late post results', async () => {
  // Arrange
  let finishPost!: (accepted: boolean) => void;
  const posting = new Promise<boolean>(resolve => { finishPost = resolve; });
  const delivery = new FrameDelivery(() => posting, () => undefined);
  delivery.begin('view');
  const first = delivery.offer(live);
  const firstRejected = assert.rejects(first, /disposed/);
  const second = delivery.offer(pause);
  const secondRejected = assert.rejects(second, /disposed/);
  // Act
  delivery.dispose();
  finishPost(false);
  // Assert
  await Promise.all([firstRejected, secondRejected]);
  assert.equal(delivery.acknowledge('view', 1), false);
  await assert.rejects(delivery.offer(live), /not ready/);
});

test('a queued evidence frame survives newer live updates', async () => {
  // Arrange
  const delivery = new FrameDelivery(() => Promise.resolve(true), () => undefined);
  delivery.begin('view');
  const first = delivery.offer(live);
  const required = delivery.offer({ ...pause, phase: 'after' });
  // Act
  await assert.rejects(delivery.offer(live), /Required frame already pending/);
  await delay(0);
  delivery.acknowledge('view', 1);
  await delay(0);
  delivery.acknowledge('view', 2);
  // Assert
  assert.deepEqual(await required, { epoch: 'view', id: 2, hash: 'pause-hash' });
  await first;
  delivery.dispose();
});

test('a suspended recording clock retains the same remaining paint budget across visibility changes', async () => {
  // Arrange
  let paintTimeMs = 100, outcome = 'pending';
  const delivery = new FrameDelivery(() => Promise.resolve(true), () => undefined, 30, () => paintTimeMs);
  delivery.begin('recorded-view');
  const capture = delivery.offer(pause).then(() => { outcome = 'painted'; }, error => { outcome = error.message; });
  try {
    // Act: wall time alone cannot consume a stopped recording clock.
    await delay(60); const hiddenOutcome = outcome;
    paintTimeMs = 110; delivery.refreshDeadlines(); await delay(0); const partlyVisibleOutcome = outcome;
    paintTimeMs = 131; delivery.refreshDeadlines(); await capture;
    // Assert: returning to visibility never grants a new thirty-millisecond budget.
    assert.equal(hiddenOutcome, 'pending'); assert.equal(partlyVisibleOutcome, 'pending');
    assert.equal(outcome, 'Viewport frame acknowledgement timed out');
    assert.equal(delivery.acknowledge('recorded-view', 1), false);
  } finally { delivery.dispose(); await capture; }
});

test('visibility restoration expires both overdue recording slots without sending the queued image', async () => {
  // Arrange
  const sent: FrameMessage[] = []; let paintTimeMs = 0;
  const delivery = new FrameDelivery(message => { sent.push(message); return Promise.resolve(true); }, () => undefined, 20, () => paintTimeMs);
  delivery.begin('recorded-view');
  const first = delivery.offer(live), firstRejected = assert.rejects(first, /acknowledgement timed out/);
  const queued = delivery.offer(pause), queuedRejected = assert.rejects(queued, /acknowledgement timed out/);
  try {
    // Act
    await delay(0); paintTimeMs = 21; delivery.refreshDeadlines();
    await Promise.all([firstRejected, queuedRejected]);
    // Assert
    assert.deepEqual(sent.map(message => message.id), [1]);
    assert.equal(delivery.acknowledge('recorded-view', 2), false);
  } finally { delivery.dispose(); }
});

test('closing a suspended recording releases pending ownership without waiting for visibility', async () => {
  // Arrange
  const delivery = new FrameDelivery(() => Promise.resolve(true), () => undefined, 20, () => 0);
  delivery.begin('recorded-view');
  const first = delivery.offer(live), firstRejected = assert.rejects(first, /disposed/);
  const queued = delivery.offer(pause), queuedRejected = assert.rejects(queued, /disposed/);
  // Act
  delivery.dispose(); delivery.refreshDeadlines(); await Promise.all([firstRejected, queuedRejected]);
  // Assert
  assert.equal(delivery.acknowledge('recorded-view', 1), false);
  assert.equal(delivery.acknowledge('recorded-view', 2), false);
});

test('a nearly exhausted hidden paint budget waits quietly and still expires on visibility restoration', async () => {
  // Arrange: the recording becomes hidden with less than one millisecond left to paint.
  let paintTimeMs = 0, clockReads = 0, outcome = 'pending';
  const delivery = new FrameDelivery(() => Promise.resolve(true), () => undefined, 40, () => { clockReads++; return paintTimeMs; });
  delivery.begin('recorded-view');
  const capture = delivery.offer(pause).then(() => { outcome = 'painted'; }, error => { outcome = error.message; });
  try {
    // Act: a suspended clock cannot consume the remaining budget or justify millisecond polling.
    paintTimeMs = 39.9; delivery.refreshDeadlines(); const initialClockReads = clockReads;
    await delay(120); const hiddenClockReads = clockReads - initialClockReads;
    // Assert: tolerate scheduler variance while rejecting the reproduced 95 polls in this interval.
    assert.equal(outcome, 'pending'); assert.equal(hiddenClockReads < 20, true);
    paintTimeMs = 40.1; delivery.refreshDeadlines(); await capture;
    assert.equal(outcome, 'Viewport frame acknowledgement timed out');
    assert.equal(delivery.acknowledge('recorded-view', 1), false);
  } finally { delivery.dispose(); await capture; }
});
