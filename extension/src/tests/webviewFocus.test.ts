import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { installWebviewFocus } from 'codebook-cycle-0001/dist/utils/installWebviewFocus';
import { focusWebview } from '../utils/focusWebview';

/** Executes the actual serialized renderer protocol with isolated document events, without claiming native focus proof. @example const renderer = focusRenderer(); renderer.send(request) */
function focusRenderer(emit: (message: unknown) => void = () => {}) {
  const windowEvents = new Map<string, (event: { data?: unknown }) => void>(), documentEvents = new Map<string, () => void>();
  let focused = false, visible = true, focusCalls = 0, clock = Date.now();
  const receipts: Record<string, unknown>[] = [];
  runInNewContext(`(${installWebviewFocus.toString()})(api)`, {
    crypto: { randomUUID }, Date: { now: () => clock },
    api: { postMessage(message: Record<string, unknown>) { receipts.push(message); emit(message); } },
    window: { addEventListener: (name: string, listener: (event: { data?: unknown }) => void) => windowEvents.set(name, listener), focus() { focusCalls++; focused = true; } },
    document: { hasFocus: () => focused, get visibilityState() { return visible ? 'visible' : 'hidden'; }, addEventListener: (name: string, listener: () => void) => documentEvents.set(name, listener) },
  });
  return { receipts, send: (message: unknown) => windowEvents.get('message')?.({ data: message }), calls: () => focusCalls,
    hide() { visible = false; documentEvents.get('visibilitychange')?.(); },
    advance(milliseconds: number) { clock += milliseconds; },
    focusLater() { focused = true; windowEvents.get('focus')?.({}); }, blur() { focused = false; windowEvents.get('blur')?.({}); } };
}

/** Couples real host/renderer helpers through an observable disposable transport for delivery and lifecycle failures. @example const harness = focusHarness(); await harness.run() */
function focusHarness() {
  const listeners = new Set<(value: unknown) => void>(), disposals = new Set<() => void>();
  const emit = (value: unknown) => { for (const listener of listeners) listener(value); };
  let renderer = focusRenderer(emit), nativeActive = true, rejectNativeActivation = false, nativeDocumentFocus = true, guard = () => {}, beforeCommit = () => {};
  let onPost = (_message: Record<string, unknown>): Promise<boolean> | undefined => undefined;
  const controller = new AbortController(), messages: Record<string, unknown>[] = [], reveals: boolean[] = [];
  const panel = {
    visible: true, reveal(_column?: number, preserveFocus?: boolean) {
      reveals.push(Boolean(preserveFocus));
      if (!preserveFocus && !rejectNativeActivation) nativeActive = true;
      if (!preserveFocus && nativeDocumentFocus) renderer.focusLater();
    },
    onDidDispose(listener: () => void) { disposals.add(listener); return { dispose() { disposals.delete(listener); } }; },
    webview: { onDidReceiveMessage(listener: (value: unknown) => void) { listeners.add(listener); return { dispose() { listeners.delete(listener); } }; },
      postMessage(message: Record<string, unknown>) { messages.push(message); const intercepted = onPost(message); if (intercepted) return intercepted; renderer.send(message); return Promise.resolve(true); } },
  };
  return { panel, messages, reveals, emit, controller, renderer: () => renderer,
    run: (timeoutMs = 1_000) => focusWebview(panel, { timeoutMs, signal: controller.signal, assertCurrent: () => guard(), assertBeforeCommit: () => beforeCommit(), isActive: () => nativeActive }),
    intercept(value: typeof onPost) { onPost = value; }, setGuard(value: typeof guard) { guard = value; }, beforeCommit(value: typeof beforeCommit) { beforeCommit = value; },
    replaceRenderer() { renderer = focusRenderer(emit); }, nativeInactive() { nativeActive = false; rejectNativeActivation = true; },
    requireNativeActivation() { nativeActive = false; }, nativeIsActive: () => nativeActive, suppressDocumentActivation() { nativeDocumentFocus = false; },
    disposePanel() { for (const listener of disposals) listener(); }, listenerCount: () => listeners.size + disposals.size };
}

test('owned focus completes only after the current document confirms focus and cleans up its listeners', async () => {
  // Arrange
  const harness = focusHarness();
  // Act
  await harness.run();
  // Assert
  assert.deepEqual(harness.messages.map(message => message.phase), ['prepare', 'commit', 'cancel']);
  assert.deepEqual(harness.reveals, [false]); assert.equal(harness.renderer().calls(), 0); assert.equal(harness.listenerCount(), 0);
});

test('owned focus selects the native editor even when inner focus alone cannot activate its group', async () => {
  // Arrange
  const harness = focusHarness(); harness.requireNativeActivation();
  // Act
  await harness.run(250);
  // Assert
  assert.equal(harness.nativeIsActive(), true); assert.equal(harness.renderer().calls(), 0);
  assert.deepEqual(harness.messages.map(message => message.phase), ['prepare', 'commit', 'cancel']);
  assert.equal(harness.listenerCount(), 0);
});

test('lost ownership before native activation leaves the learner editor untouched', async () => {
  // Arrange
  const harness = focusHarness(); harness.requireNativeActivation();
  harness.beforeCommit(() => { throw new Error('learner owns focus'); });
  // Act / Assert
  await assert.rejects(harness.run(), /learner owns focus/);
  assert.equal(harness.nativeIsActive(), false); assert.deepEqual(harness.reveals, []);
  assert.deepEqual(harness.messages, []); assert.equal(harness.listenerCount(), 0);
});

for (const failure of ['not delivered', 'rejected', 'stalled'] as const) test(`a ${failure} focus transport fails within its deadline without focusing or retaining listeners`, async () => {
  // Arrange
  const harness = focusHarness();
  harness.intercept(() => failure === 'not delivered' ? Promise.resolve(false) : failure === 'rejected' ? Promise.reject(new Error('transport rejected')) : new Promise<boolean>(() => {}));
  // Act / Assert
  await assert.rejects(harness.run(100), /not delivered|rejected|Timed out/);
  assert.equal(harness.renderer().calls(), 0); assert.equal(harness.listenerCount(), 0);
});

for (const boundary of ['closed', 'cancelled', 'ownership changed'] as const) test(`a focus target ${boundary} during preparation cannot receive the focus commit`, async () => {
  // Arrange
  const harness = focusHarness();
  harness.intercept(() => {
    if (boundary === 'closed') harness.disposePanel();
    if (boundary === 'cancelled') harness.controller.abort(new Error('cancelled'));
    if (boundary === 'ownership changed') harness.setGuard(() => { throw new Error('ownership changed'); });
    return undefined;
  });
  // Act / Assert
  await assert.rejects(harness.run(), /closed|cancelled|ownership changed/);
  assert.equal(harness.messages.some(message => message.phase === 'commit'), false); assert.equal(harness.renderer().calls(), 0); assert.equal(harness.listenerCount(), 0);
});

test('a replacement document cannot accept a focus commit prepared by its predecessor', async () => {
  // Arrange
  const harness = focusHarness();
  harness.intercept(message => { if (message.phase === 'commit') harness.replaceRenderer(); return undefined; });
  // Act / Assert
  await assert.rejects(harness.run(250), /Timed out/);
  assert.equal(harness.renderer().calls(), 0); assert.equal(harness.listenerCount(), 0);
});

for (const missing of ['native', 'document'] as const) test(`missing ${missing} focus cannot become a successful presentation handoff`, async () => {
  // Arrange
  const harness = focusHarness();
  if (missing === 'native') harness.nativeInactive(); else harness.suppressDocumentActivation();
  // Act / Assert
  await assert.rejects(harness.run(250), /Timed out/);
  assert.equal(harness.renderer().calls(), 0); assert.equal(harness.listenerCount(), 0);
});

for (const wrong of ['request', 'epoch'] as const) test(`a receipt for another ${wrong} cannot certify an unresponsive focus document`, async () => {
  // Arrange
  const harness = focusHarness(); harness.suppressDocumentActivation();
  harness.intercept(message => { if (message.phase === 'commit') harness.emit({ type: 'codebook-focus-receipt', phase: 'focused', requestId: wrong === 'request' ? randomUUID() : message.requestId, epoch: wrong === 'epoch' ? randomUUID() : message.epoch, focused: true }); return undefined; });
  // Act / Assert
  await assert.rejects(harness.run(250), /Timed out/); assert.equal(harness.listenerCount(), 0);
});

test('renderer preparation is read-only and a matching focus commit is consumed once', () => {
  // Arrange
  const renderer = focusRenderer(), requestId = randomUUID();
  renderer.focusLater();
  renderer.send({ type: 'codebook-focus', phase: 'prepare', requestId, expiresAt: Date.now() + 1_000 });
  assert.equal(renderer.calls(), 0);
  const commit = { type: 'codebook-focus', phase: 'commit', requestId, epoch: renderer.receipts[0]?.epoch };
  // Act
  renderer.send(commit); renderer.send(commit);
  // Assert
  assert.equal(renderer.calls(), 0); assert.deepEqual(renderer.receipts.map(receipt => receipt.phase), ['prepared', 'focused']);
});

for (const invalidation of ['hidden', 'expired', 'superseded'] as const) test(`a ${invalidation} renderer preparation never steals focus`, () => {
  // Arrange
  const renderer = focusRenderer(), requestId = randomUUID();
  renderer.send({ type: 'codebook-focus', phase: 'prepare', requestId, expiresAt: Date.now() + 1_000 });
  const epoch = renderer.receipts[0]?.epoch;
  if (invalidation === 'hidden') renderer.hide();
  if (invalidation === 'superseded') renderer.send({ type: 'codebook-focus', phase: 'prepare', requestId: randomUUID(), expiresAt: Date.now() + 1_000 });
  if (invalidation === 'expired') renderer.advance(2_000);
  // Act
  renderer.send({ type: 'codebook-focus', phase: 'commit', requestId, epoch });
  // Assert
  assert.equal(renderer.calls(), 0);
});

test('a delayed document focus event acknowledges once without requesting focus again', () => {
  // Arrange
  const renderer = focusRenderer(), requestId = randomUUID();
  renderer.send({ type: 'codebook-focus', phase: 'prepare', requestId, expiresAt: Date.now() + 1_000 });
  renderer.send({ type: 'codebook-focus', phase: 'commit', requestId, epoch: renderer.receipts[0]?.epoch });
  assert.equal(renderer.receipts.length, 1);
  // Act
  renderer.focusLater(); renderer.focusLater();
  // Assert
  assert.equal(renderer.calls(), 0); assert.deepEqual(renderer.receipts.map(receipt => receipt.phase), ['prepared', 'focused']);
});

test('cancelling an accepted but delayed focus commit revokes its document authority without a retry', async () => {
  // Arrange
  const harness = focusHarness(); let delayed: Record<string, unknown> | undefined;
  harness.intercept(message => {
    if (message.phase === 'commit') { delayed = message; harness.controller.abort(new Error('cancelled after acceptance')); return Promise.resolve(true); }
    return undefined;
  });
  // Act
  await assert.rejects(harness.run(), /cancelled after acceptance/);
  harness.renderer().send(delayed);
  // Assert
  assert.deepEqual(harness.messages.map(message => message.phase), ['prepare', 'commit', 'cancel']);
  assert.equal(harness.renderer().calls(), 0); assert.equal(harness.listenerCount(), 0);
});

for (const acquisition of ['before preparation', 'after preparation', 'not yet acquired'] as const) test(`learner departure with document focus ${acquisition} prevents a queued commit from stealing it back`, async () => {
  // Arrange: the renderer sees learner blur before the host receives its next transport response.
  const harness = focusHarness();
  harness.suppressDocumentActivation();
  if (acquisition === 'before preparation') harness.renderer().focusLater();
  harness.intercept(message => {
    if (message.phase === 'prepare' && acquisition === 'after preparation') {
      harness.renderer().send(message); harness.renderer().focusLater(); return Promise.resolve(true);
    }
    if (message.phase !== 'commit') return undefined;
    if (acquisition !== 'not yet acquired') harness.renderer().blur();
    harness.setGuard(() => { throw new Error('learner owns another editor'); });
    harness.renderer().send(message); return Promise.resolve(true);
  });
  // Act / Assert: host rejection alone is insufficient if the queued document effect already stole focus.
  await assert.rejects(harness.run(), /learner owns another editor/);
  assert.equal(harness.renderer().calls(), 0); assert.equal(harness.listenerCount(), 0);
  assert.deepEqual(harness.messages.map(message => message.phase), ['prepare', 'commit', 'cancel']);
});

for (const loss of ['blur', 'hide'] as const) test(`${loss} before native activation cannot reuse an earlier successful document receipt`, async () => {
  // Arrange: native activation arrives after the intended inner document has already blurred again.
  const harness = focusHarness();
  harness.intercept(message => {
    if (message.phase !== 'commit') return undefined;
    harness.renderer().send(message); harness.renderer()[loss](); return Promise.resolve(true);
  });
  // Act / Assert
  await assert.rejects(harness.run(250), /Timed out/);
  assert.equal(harness.renderer().calls(), 0); assert.equal(harness.listenerCount(), 0);
});
