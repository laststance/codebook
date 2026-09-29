import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitUntil } from '../runtimeSupport/utils/waitUntil';
import { nativeParticipantsHarness } from './utils/nativeParticipantsHarness';

const pauseReady = async (harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>, name: 'server' | 'browser') => waitUntil(() => { const view = harness.run.view(); if (view.failures.length) throw new Error(view.failures.join('; ')); return view.participants[name]?.snapshot; }, `${name} committed stop`);

test('a result already visible before input cannot establish completion', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context); await harness.run.prepare();
  harness.satisfyAfterBeforeInput();
  // Act
  harness.run.action('once', 'repository-click');
  await waitUntil(() => harness.run.view().status === 'failed', 'preexisting result rejected');
  await harness.run.stop();
  // Assert
  assert.match(harness.run.view().failures.join(' '), /already true before application input/);
  assert.equal(harness.commands.some(command => command.method.startsWith('Input.')), false);
  assert.equal(harness.run.view().finalOutcome, 'not-demonstrated');
});

test('an internal browser CDP pause that auto resumes cannot invalidate a server-only result', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server']); await harness.run.prepare();
  harness.run.action('once', 'repository-click');
  const server = await pauseReady(harness, 'server');
  harness.holdContinueResponse();
  // Act
  const continuation = harness.run.continue('server', server.pause);
  await waitUntil(() => harness.run.view().events.some(event => event.type === 'dap.resume-request'), 'server continuation requested');
  harness.emitBrowserAdapterPause();
  harness.emitResume('browser');
  harness.releaseContinueResponse();
  await continuation;
  await waitUntil(() => harness.run.view().status === 'completed', 'server-only result after internal browser pause');
  // Assert
  assert.equal(harness.run.view().failures.length, 0);
  assert.equal(harness.run.view().operation?.afterVerified, true);
});

test('a held browser CDP pause during a server-only result cannot claim completion', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server']); await harness.run.prepare();
  harness.run.action('once', 'repository-click');
  const server = await pauseReady(harness, 'server');
  harness.holdContinueResponse();
  // Act
  const continuation = harness.run.continue('server', server.pause);
  await waitUntil(() => harness.run.view().events.some(event => event.type === 'dap.resume-request'), 'server continuation requested');
  harness.emitBrowserAdapterPause();
  harness.releaseContinueResponse();
  await continuation.catch(() => undefined);
  await waitUntil(() => harness.run.view().status === 'failed', 'held browser pause rejected');
  // Assert
  assert.equal(harness.run.view().operation?.afterVerified, false);
  assert.match(harness.run.view().failures.join(' '), /browser stop/);
});

test('a browser DAP stop during a server-only result remains a competing pause', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server']); await harness.run.prepare();
  harness.run.action('once', 'repository-click');
  const server = await pauseReady(harness, 'server');
  harness.holdContinueResponse();
  // Act
  const continuation = harness.run.continue('server', server.pause);
  await waitUntil(() => harness.run.view().events.some(event => event.type === 'dap.resume-request'), 'server continuation requested');
  harness.emitBrowserAdapterPause();
  harness.run.onEvent(harness.sessions.browser, { type: 'event', seq: 903, event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } });
  harness.releaseContinueResponse();
  await continuation.catch(() => undefined);
  // Assert
  assert.equal(harness.run.view().status, 'failed');
  assert.equal(harness.run.view().operation?.afterVerified, false);
  assert.match(harness.run.view().failures.join(' '), /Unowned browser DAP stop/);
});

test('one input retains server/browser/server sources and independent native generations while video stays on the browser', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context); await harness.run.prepare();
  assert.equal(harness.run.view().status, 'ready');
  assert.deepEqual(harness.identities, ['server']);
  assert.equal(harness.launches[0]?.restart, false);
  assert.equal(harness.launches[0]?.continueOnAttach, false);
  assert.equal(harness.run.view().events.some(event => event.type === 'breakpoint.registered'), true);
  // Act
  harness.run.action('once', 'repository-click');
  const first = await pauseReady(harness, 'server');
  await assert.rejects(harness.run.continue('browser', first.pause), /stale, foreign/);
  await harness.run.continue('server', first.pause);
  const second = await pauseReady(harness, 'browser');
  await harness.run.continue('browser', second.pause);
  const third = await pauseReady(harness, 'server');
  await harness.run.continue('server', third.pause);
  await waitUntil(() => harness.run.view().status === 'completed', 'completed cross-runtime action');
  await harness.run.stop();
  // Assert
  const view = harness.run.view();
  assert.equal(JSON.stringify(view.snapshots.map(snapshot => [snapshot.participant, snapshot.pause.generation])), JSON.stringify([['server', 1], ['browser', 1], ['server', 2]]));
  assert.equal(first.values['value:mode'], 'display'); assert.equal(second.values['value:nextTheme'], 'dark');
  assert.notEqual(first.source.hash, second.source.hash);
  assert.equal(harness.run.source(first.itemId, first.id)?.source, first.source.text);
  assert.equal(harness.run.source(second.itemId, second.id)?.source, second.source.text);
  assert.equal(harness.run.source(first.itemId, 'foreign-snapshot'), undefined);
  assert.equal(harness.commands.filter(command => command.method === 'Input.dispatchMouseEvent').length, 2);
  assert.equal(harness.commands.some(command => command.participant === 'server' && command.method.startsWith('Page.')), false);
  assert.equal(JSON.parse(await readFile(join(view.artifactDirectory, 'snapshot-server-1.json'), 'utf8')).id, first.id);
  assert.equal(JSON.parse(await readFile(join(view.artifactDirectory, 'snapshot-browser-1.json'), 'utf8')).id, second.id);
  assert.equal(view.finalOutcome, 'demonstrated'); assert.equal(view.resourcesReleased, true);
  assert.equal(harness.breakpoints.length, 0);
  assert.ok(harness.released.includes('server-session')); assert.ok(harness.released.includes('browser-root'));
});

test('an idle browser continuation while a server stop is current preserves the next owned pause', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context); await harness.run.prepare();
  harness.run.action('once', 'repository-click');
  const firstServer = await pauseReady(harness, 'server');
  await harness.run.continue('server', firstServer.pause);
  const browser = await pauseReady(harness, 'browser');
  await harness.run.continue('browser', browser.pause);
  const lastServer = await pauseReady(harness, 'server');
  // Act
  harness.run.onEvent(harness.sessions.browser, { type: 'event', seq: 901, event: 'continued', body: { threadId: 1 } });
  // Assert
  assert.equal(harness.run.view().status, 'paused-server');
  assert.equal(harness.run.view().failures.length, 0);
  await harness.run.continue('server', lastServer.pause);
  await waitUntil(() => harness.run.view().status === 'completed', 'completed after idle browser continuation');
});

test('a competing browser resume request while the server is paused invalidates the run', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context); await harness.run.prepare();
  harness.run.action('once', 'repository-click');
  const server = await pauseReady(harness, 'server');
  // Act
  harness.run.onRequest(harness.sessions.browser, { type: 'request', seq: 902, command: 'continue', arguments: { threadId: server.pause.threadId } });
  // Assert
  assert.equal(harness.run.view().status, 'failed');
  assert.match(harness.run.view().failures.join(' '), /Manual or competing resume/);
});

test('one owned Next worker with nested debugger sessions still reaches its first server stop', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server', 'browser', 'server'], { duplicateServerSession: true });
  // Act
  await harness.run.prepare();
  harness.run.action('once', 'repository-click');
  const first = await pauseReady(harness, 'server');
  // Assert
  assert.equal(harness.run.view().status, 'paused-server');
  assert.equal(first.pause.sessionId, 'server-child');
  assert.deepEqual(harness.identities, ['server', 'server']);
  assert.equal(harness.parentServerProxy.closed, true);
  assert.equal(harness.proxies.server.closed, false);
});

test('two distinct owned server workers reject before application input', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server', 'browser', 'server'], { duplicateServerSession: true, distinctServerWorker: true });
  // Act
  await assert.rejects(harness.run.prepare(), /Ambiguous owned server/);
  await harness.run.stop();
  // Assert
  assert.equal(harness.commands.some(command => command.method.startsWith('Input.')), false);
  assert.equal(harness.run.view().snapshots.length, 0);
  assert.equal(harness.run.view().resourcesReleased, true);
});

for (const failure of ['registration', 'replacement'] as const) test(`a failed server ${failure} rejects the operation before any browser input`, async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context);
  if (failure === 'registration') harness.failRegistration();
  // Act
  if (failure === 'registration') await assert.rejects(harness.run.prepare(), /registration/);
  else { await harness.run.prepare(); harness.revokeServerRegistration(); harness.run.action('once', 'repository-click'); await waitUntil(() => harness.run.view().status === 'failed', 'failed replacement'); }
  await harness.run.stop();
  // Assert
  assert.equal(harness.commands.some(command => command.method.startsWith('Input.')), false);
  assert.equal(harness.run.view().snapshots.length, 0);
  assert.equal(harness.run.view().resourcesReleased, true);
});

for (const failure of ['source', 'binding', 'binding-source'] as const) test(`a server stop with changed ${failure} never publishes captured facts`, async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context); await harness.run.prepare();
  if (failure === 'source') harness.changeExecutedSource(); else if (failure === 'binding') harness.leavePauseUnbound(); else harness.bindForeignSource();
  // Act
  harness.run.action('once', 'repository-click'); await waitUntil(() => harness.run.view().status === 'failed', 'invalid server pause'); await harness.run.stop();
  // Assert
  assert.equal(harness.run.view().snapshots.length, 0);
  assert.equal(harness.run.view().resourcesReleased, true);
  const receipt = harness.run.view().events.find(event => event.type === 'breakpoint.pause-binding');
  assert.ok(receipt);
  const detail = JSON.parse(JSON.stringify(receipt.detail));
  assert.equal(detail.returned, 'parsed');
  assert.equal(detail.observed.verified, failure !== 'binding');
  assert.equal(detail.observed.source.path, failure === 'binding-source' ? '/foreign/source.ts' : detail.expected.path);
  assert.equal(detail.expected.line, 1);
  assert.equal(detail.expected.column, 1);
  assert.match(harness.run.view().failures.join(' '), failure === 'source' ? /Executed JavaScript differs/ : /did not bind/);
});

test('a fast browser stop waits for the prior server continuation response before gaining authority', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context); await harness.run.prepare(); harness.run.action('once', 'repository-click');
  const first = await pauseReady(harness, 'server'); harness.holdContinueResponse();
  // Act
  const continued = harness.run.continue('server', first.pause);
  await waitUntil(() => harness.commands.some(command => command.participant === 'server' && command.method === 'continue'), 'native continue');
  // Assert
  assert.equal(harness.run.view().participants.browser.snapshot, undefined);
  assert.equal(harness.run.view().snapshots.length, 1);
  harness.releaseContinueResponse(); await continued;
  const browser = await pauseReady(harness, 'browser'); assert.equal(browser.pause.generation, 1);
});

test('manually resuming a queued browser stop cannot reuse the previous server continuation', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context); await harness.run.prepare(); harness.run.action('once', 'repository-click');
  const first = await pauseReady(harness, 'server'); harness.holdContinueResponse();
  const continued = harness.run.continue('server', first.pause); const rejected = assert.rejects(continued);
  await waitUntil(() => harness.commands.some(command => command.participant === 'server' && command.method === 'continue'), 'native continue');
  // Act
  harness.emitResume('browser'); harness.releaseContinueResponse(); await rejected; await harness.run.stop();
  // Assert
  assert.equal(harness.run.view().snapshots.length, 1);
  assert.match(harness.run.view().failures.join(' '), /Queued browser stop resumed/);
});


test('server worker exit invalidates the whole operation and releases both owned transports', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context); await harness.run.prepare();
  // Act
  harness.run.terminated(harness.sessions.server); await harness.run.stop();
  // Assert
  assert.equal(harness.run.view().status, 'failed');
  assert.match(harness.run.view().failures.join(' '), /Selected debugger terminated/);
  assert.equal(harness.proxies.server.closed, true); assert.equal(harness.proxies.browser.closed, true);
  assert.equal(harness.commands.some(command => command.method.startsWith('Input.')), false);
});

test('an unrelated debugger stop cannot claim the configured server pause', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context); await harness.run.prepare();
  // Act
  harness.run.onEvent({ ...harness.sessions.server, id: 'unrelated' }, { type: 'event', seq: 999, event: 'stopped', body: { threadId: 1, reason: 'breakpoint' } });
  // Assert
  assert.equal(harness.run.view().status, 'ready');
  assert.equal(harness.run.view().snapshots.length, 0);
  harness.run.action('once', 'repository-click');
  assert.equal((await pauseReady(harness, 'server')).pause.sessionId, 'server-session');
});


test('server registration revoked during the final DOM check prevents the mouse input', async context => {
  // Arrange
  const harness = await nativeParticipantsHarness(context); await harness.run.prepare(); harness.revokeDuringDomCheck();
  // Act
  harness.run.action('once', 'repository-click');
  await waitUntil(() => harness.run.view().status === 'failed', 'registration revoked during input preparation'); await harness.run.stop();
  // Assert
  assert.equal(harness.commands.some(command => command.method.startsWith('Input.')), false);
  assert.equal(harness.run.view().snapshots.length, 0);
});
