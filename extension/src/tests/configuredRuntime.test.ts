import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness';

test('internal browser setup stops do not consume the configured learning pause or prevent its later completion', async context => {
  // Arrange
  const { run, resumeDuringPreparation, mouse, commands } = await configuredRuntimeHarness(context); resumeDuringPreparation();
  // Act
  await run.prepare();
  // Assert: setup notifications grant no learner pause or input authority.
  assert.equal(run.view().status, 'ready'); assert.equal(run.view().snapshots.length, 0); assert.equal(mouse.length, 0);
  assert.equal(commands.filter(command => command === 'continue').length, 0);
  run.action('one', 'repository-click'); const snapshot = await waitUntil(() => run.view().snapshots[0], 'configured learning pause');
  await run.continue('browser', snapshot.pause); await waitUntil(() => run.view().status === 'completed', 'configured completion'); await run.stop();
  assert.equal(run.view().finalOutcome, 'demonstrated'); assert.equal(run.view().snapshots.length, 1); assert.equal(mouse.length, 2);
  assert.equal(commands.filter(command => command === 'continue').length, 1);
});

test('a real debugger stop before configured input still fails instead of being ignored as browser setup', async context => {
  // Arrange
  const { run, emitPause, mouse, commands } = await configuredRuntimeHarness(context); await run.prepare();
  // Act
  emitPause(); await run.stop();
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated'); assert.equal(run.view().snapshots.length, 0); assert.equal(mouse.length, 0);
  assert.match(run.view().failures.join('\n'), /Unexpected or additional browser stop/);
  assert.equal(commands.filter(command => command === 'continue').length, 0);
});

test('a debugger-revealed raw source tab does not prevent the matching configured pause image or alter the learner document', async context => {
  // Arrange
  const { run, hideViewportOnPause, documents, commands } = await configuredRuntimeHarness(context), document = documents[0]!;
  await run.prepare(); hideViewportOnPause();
  // Act
  run.action('one', 'repository-click'); const snapshot = await waitUntil(() => run.view().snapshots[0], 'captured pause');
  // Assert
  assert.equal(run.view().status, 'paused-browser'); assert.equal(run.view().captures['paused-browser']?.status, 'captured');
  assert.equal(documents[0], document); assert.equal(document.text, 'const nextTheme = "dark";\n'); assert.equal(document.isDirty, false);
  assert.equal(commands.filter(command => command === 'continue').length, 0);
  await run.continue('browser', snapshot.pause); await waitUntil(() => run.view().status === 'completed', 'configured completion'); await run.stop();
  assert.equal(run.view().finalOutcome, 'demonstrated'); assert.equal(run.view().captureOutcome, 'complete');
});

test('an input-time browser resume fails before its stop can obtain DAP correlation or continuation authority', async context => {
  // Arrange
  const { run, suppressInputPause, emitCdpPause, manualResume, mouse, commands } = await configuredRuntimeHarness(context);
  await run.prepare(); suppressInputPause(); run.action('one', 'repository-click'); await waitUntil(() => mouse.length === 2, 'configured input');
  // Act
  emitCdpPause(); manualResume(); await run.stop();
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated'); assert.equal(run.view().snapshots.length, 0); assert.equal(mouse.length, 2);
  assert.equal(run.view().operation?.afterVerified, false); assert.match(run.view().failures.join('\n'), /resumed outside its owned continuation/);
  assert.equal(commands.filter(command => command === 'continue').length, 0);
});

test('a second browser-only stop during capture revokes continuation before any second DAP stop arrives', async context => {
  // Arrange
  const { run, emitCdpPause, holdCapture, mouse, commands } = await configuredRuntimeHarness(context);
  await run.prepare(); const held = holdCapture('paused-browser'); run.action('one', 'repository-click'); await held.started;
  // Act
  emitCdpPause(); held.release(); await run.stop();
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated'); assert.equal(run.view().snapshots.length, 0); assert.equal(mouse.length, 2);
  assert.equal(run.view().operation?.afterVerified, false); assert.match(run.view().failures.join('\n'), /Additional browser stop/);
  assert.equal(commands.filter(command => command === 'continue').length, 0);
});

test('one configured browser action keeps a 70-second pause controllable and completes only after original continuation input and renderer ACKs', async context => {
  // Arrange
  const { run, advance, mouse, breakpoints, userBreakpoint, commands } = await configuredRuntimeHarness(context); await run.prepare();
  // Act
  const accepted = run.action('one', 'repository-click');
  const snapshot = await waitUntil(() => run.view().snapshots[0], 'configured captured stop'); advance(70000);
  // Assert: synthetic protocol timing, not native motion or latency evidence.
  assert.equal(run.view().status, 'paused-browser'); assert.equal(run.view().operation?.inputAcknowledged, false);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.values)), { 'value:nextTheme': 'dark', 'type:setTheme': 'function', 'value:enabled': false, 'value:selection': null });
  assert.deepEqual(breakpoints, [userBreakpoint]); assert.equal(commands.filter(command => command === 'continue').length, 0);
  assert.deepEqual(mouse, [{ type: 'mousePressed', timeout: 600000 }, { type: 'mouseReleased', timeout: 600000 }]);
  await run.continue('browser', snapshot.pause); await waitUntil(() => run.view().status === 'completed', 'configured completion'); await run.stop();
  assert.equal(run.view().finalOutcome, 'demonstrated'); assert.equal(run.view().resourcesReleased, true); assert.equal(run.view().operation?.afterVerified, true);
  assert.deepEqual(run.action('one', 'repository-click'), accepted); assert.equal(commands.filter(command => command === 'continue').length, 1);
  assert.deepEqual(Object.keys(run.view().participants), ['browser']); assert.deepEqual(breakpoints, [userBreakpoint]);
});

test('a second selected stop during capture cancels the observation instead of overwriting it or granting continuation', async context => {
  // Arrange
  const { run, holdCapture, emitPause, commands } = await configuredRuntimeHarness(context); await run.prepare(); const held = holdCapture('paused-browser');
  run.action('one', 'repository-click'); await held.started;
  // Act
  emitPause(); held.release(); await run.stop();
  // Assert
  assert.equal(run.view().status, 'failed'); assert.equal(run.view().snapshots.length, 0); assert.equal(run.view().operation?.afterVerified, false);
  assert.equal(commands.filter(command => command === 'continue').length, 0); assert.equal(run.view().participants.browser.pause, undefined);
});

for (const missing of ['response', 'dap', 'cdp', 'input'] as const) test(`configured Continue cannot certify completion without its ${missing} acknowledgement`, async context => {
  // Arrange
  const { run, holdContinuation, advance, commands, mouse } = await configuredRuntimeHarness(context), receipts = holdContinuation();
  await run.prepare(); run.action('one', 'repository-click'); const snapshot = await waitUntil(() => run.view().snapshots[0], 'captured pause');
  const continuation = run.continue('browser', snapshot.pause).then(() => 'acknowledged', () => 'rejected'); await receipts.started;
  // Act: the other independent receipts cannot stand in for the missing one.
  for (const receipt of ['response', 'dap', 'cdp', 'input'] as const) if (receipt !== missing) receipts[receipt]();
  await new Promise<void>(resolve => setImmediate(resolve));
  // Assert
  assert.equal(run.view().operation?.afterVerified, false); assert.equal(run.view().captures.after, undefined);
  advance(20000); await run.stop();
  assert.equal(await continuation, missing === 'response' ? 'rejected' : 'acknowledged');
  assert.equal(run.view().finalOutcome, 'not-demonstrated'); assert.equal(run.view().resourcesReleased, true);
  assert.equal(run.view().snapshots[0], snapshot); assert.equal(mouse.length, 2); assert.equal(commands.filter(command => command === 'continue').length, 1);
});

for (const order of [['response', 'dap', 'cdp'], ['response', 'cdp', 'dap'], ['dap', 'response', 'cdp'], ['dap', 'cdp', 'response'], ['cdp', 'response', 'dap'], ['cdp', 'dap', 'response']] as const) test(`configured Continue completes once when acknowledgements arrive ${order.join(' then ')}`, async context => {
  // Arrange
  const { run, holdContinuation, commands, mouse } = await configuredRuntimeHarness(context), receipts = holdContinuation();
  await run.prepare(); run.action('one', 'repository-click'); const snapshot = await waitUntil(() => run.view().snapshots[0], 'captured pause');
  const continuation = run.continue('browser', snapshot.pause); await receipts.started; receipts.input();
  // Act / Assert: every proper prefix remains incomplete, independent of receipt order.
  for (const [index, receipt] of order.entries()) {
    receipts[receipt](); await new Promise<void>(resolve => setImmediate(resolve));
    if (index < 2) assert.equal(run.view().operation?.afterVerified, false);
  }
  await continuation; await waitUntil(() => run.view().status === 'completed', 'verified after state'); await run.stop();
  assert.equal(run.view().finalOutcome, 'demonstrated'); assert.equal(run.view().operation?.afterVerified, true);
  assert.equal(run.view().events.filter(event => event.type === 'screen.observed').length, 1);
  assert.equal(mouse.length, 2); assert.equal(commands.filter(command => command === 'continue').length, 1);
});

for (const invalid of ['foreign-thread', 'duplicate-continued'] as const) test(`a ${invalid} receipt after authorized Continue revokes completion without another input`, async context => {
  // Arrange
  const { run, holdContinuation, commands, mouse } = await configuredRuntimeHarness(context), receipts = holdContinuation();
  await run.prepare(); run.action('one', 'repository-click'); const snapshot = await waitUntil(() => run.view().snapshots[0], 'captured pause');
  const continuation = run.continue('browser', snapshot.pause).catch(() => undefined); await receipts.started;
  // Act: retain one missing receipt while the invalid notification races the authorized continuation.
  receipts.response(); receipts.input();
  if (invalid === 'duplicate-continued') receipts.dap();
  receipts.dap(invalid === 'foreign-thread' ? 99 : 1); receipts.cdp(); await continuation; await run.stop();
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated'); assert.equal(run.view().operation?.afterVerified, false);
  assert.equal(run.view().snapshots[0], snapshot); assert.equal(run.view().resourcesReleased, true);
  assert.equal(mouse.length, 2); assert.equal(commands.filter(command => command === 'continue').length, 1);
});

test('a second selected stop racing the after renderer cannot replace the first observation or certify completion', async context => {
  // Arrange
  const { run, holdCapture, emitPause } = await configuredRuntimeHarness(context); await run.prepare(); run.action('one', 'repository-click');
  const snapshot = await waitUntil(() => run.view().snapshots[0], 'first stop'), held = holdCapture('after'); await run.continue('browser', snapshot.pause); await held.started;
  // Act
  emitPause(); held.release(); await run.stop();
  // Assert
  assert.equal(run.view().snapshots[0], snapshot); assert.equal(run.view().snapshots.length, 1); assert.equal(run.view().operation?.afterVerified, false);
  assert.equal(run.view().captures.after?.status, 'failed'); assert.equal(run.view().finalOutcome, 'not-demonstrated');
});

test('removing an editor breakpoint without the adapter acknowledgement grants no captured pause or Continue', async context => {
  // Arrange
  const { run, suppressRetirementAck, commands, breakpoints, userBreakpoint } = await configuredRuntimeHarness(context); await run.prepare(); suppressRetirementAck(); run.action('one', 'repository-click');
  await waitUntil(() => run.view().captures['paused-browser']?.status === 'captured' && breakpoints.length === 1, 'retirement pending');
  // Act / Assert
  assert.equal(run.view().snapshots.length, 0);
  await assert.rejects(run.continue('browser', { sessionId: 'browser-session', threadId: 1, generation: 1 }), /conflict/);
  await run.stop(); assert.equal(commands.filter(command => command === 'continue').length, 0); assert.deepEqual(breakpoints, [userBreakpoint]);
});

test('a dirty target buffer rejects preparation before application effects without saving reverting or removing its tab', async context => {
  // Arrange
  const { run, documents, releases, mouse } = await configuredRuntimeHarness(context), document = documents[0]!;
  document.text = 'unsaved learner changes'; document.isDirty = true;
  // Act / Assert
  await assert.rejects(run.prepare(), { code: 'SOURCE_CHANGED' }); await run.stop();
  assert.equal(releases.includes('application acquired'), false); assert.equal(mouse.length, 0); assert.equal(documents[0], document);
  assert.equal(document.text, 'unsaved learner changes'); assert.equal(document.isDirty, true);
});

test('a target buffer changed during the hold rejects Continue and preserves the first captured source and dirty text', async context => {
  // Arrange
  const { run, documents, commands } = await configuredRuntimeHarness(context); await run.prepare(); run.action('one', 'repository-click');
  const snapshot = await waitUntil(() => run.view().snapshots[0], 'captured stop'); documents[0]!.text = 'unsaved change'; documents[0]!.isDirty = true;
  // Act / Assert
  await assert.rejects(run.continue('browser', snapshot.pause), { code: 'SOURCE_CHANGED' }); await run.stop();
  assert.equal(commands.filter(command => command === 'continue').length, 0); assert.equal(run.view().snapshots[0]?.source.text, 'const nextTheme = "dark";\n');
  assert.equal(documents[0]?.text, 'unsaved change'); assert.equal(documents[0]?.isDirty, true);
});

test('manual CDP resume revokes the exact pause and after completion even before a DAP continued event arrives', async context => {
  // Arrange
  const { run, manualResume } = await configuredRuntimeHarness(context); await run.prepare(); run.action('one', 'repository-click');
  const snapshot = await waitUntil(() => run.view().snapshots[0], 'captured stop');
  // Act
  manualResume(); await run.stop();
  // Assert
  assert.equal(run.view().participants.browser.pause, undefined); assert.equal(run.view().snapshots[0], snapshot); assert.equal(run.view().operation?.afterVerified, false);
  await assert.rejects(run.continue('browser', snapshot.pause), /conflict/); assert.equal(run.view().finalOutcome, 'not-demonstrated');
});

test('a changed click target is rejected after readiness without a pointer event or automatic retry', async context => {
  // Arrange
  const { run, setReady, mouse } = await configuredRuntimeHarness(context); await run.prepare(); setReady(false);
  // Act
  run.action('one', 'repository-click'); await waitUntil(() => run.view().status === 'failed', 'changed target rejection'); await run.stop();
  // Assert
  assert.equal(mouse.length, 0); assert.equal(run.view().operation?.inputDispatched, false); assert.equal(run.view().finalOutcome, 'not-demonstrated');
  assert.throws(() => run.action('another', 'repository-click'), /conflict/);
});

test('a pending configured input expires the active wait without redispatch and closes transport before waiting for its acknowledgement', async context => {
  // Arrange
  const { run, suppressInputPause, advance, mouse, releases } = await configuredRuntimeHarness(context); await run.prepare(); suppressInputPause(); run.action('one', 'repository-click');
  await waitUntil(() => mouse.length === 2, 'pending input');
  // Act
  advance(20000); await run.stop();
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated'); assert.equal(run.view().resourcesReleased, true); assert.equal(mouse.length, 2);
  assert.equal(releases[0], 'application acquired'); assert.equal(releases.indexOf('cdp') < releases.indexOf('application'), true);
});

test('a held configured pause expires at five minutes while retaining its original observation and learner breakpoint', async context => {
  // Arrange
  const { run, advance, breakpoints, userBreakpoint } = await configuredRuntimeHarness(context); await run.prepare(); run.action('one', 'repository-click');
  const snapshot = await waitUntil(() => run.view().snapshots[0], 'held pause'); advance(299999); assert.equal(run.view().status, 'paused-browser');
  // Act
  advance(1); await run.stop();
  // Assert
  assert.equal(run.view().finalOutcome, 'not-demonstrated'); assert.equal(run.view().snapshots[0], snapshot); assert.equal(run.view().participants.browser.pause, undefined);
  assert.deepEqual(breakpoints, [userBreakpoint]); assert.match(run.view().failures.join('\n'), /pause hold deadline/);
});

test('a late action cannot reset the original ten-minute run deadline', async context => {
  // Arrange
  const { run, advance } = await configuredRuntimeHarness(context); await run.prepare(); advance(500000); run.action('late', 'repository-click');
  await waitUntil(() => run.view().snapshots[0], 'late pause'); advance(99999); assert.equal(run.view().status, 'paused-browser');
  // Act
  advance(1); await run.stop();
  // Assert
  assert.equal(run.view().resourcesReleased, true); assert.equal(run.view().operation?.afterVerified, false); assert.match(run.view().failures.join('\n'), /whole-run deadline/);
});

test('the service cancellation signal retires an already held configured runtime without requiring another click or manual debugger action', async context => {
  // Arrange
  const cancellation = new AbortController(), now = Date.now(), { run, mouse } = await configuredRuntimeHarness(context, { signal: cancellation.signal, deadlineAt: now + 600000, preparationDeadlineAt: now + 90000 });
  await run.prepare(); run.action('one', 'repository-click'); const snapshot = await waitUntil(() => run.view().snapshots[0], 'captured pause');
  // Act
  cancellation.abort(); await run.stop();
  // Assert
  assert.equal(run.view().resourcesReleased, true); assert.equal(run.view().participants.browser.pause, undefined); assert.equal(run.view().snapshots[0], snapshot); assert.equal(mouse.length, 2);
});

test('the pre-input configured manifest retains the full accepted intent and complete citation identity without source-code blobs', async context => {
  // Arrange
  const { run, mouse } = await configuredRuntimeHarness(context);
  // Act
  await run.prepare(); const manifest = run.view().manifest;
  // Assert
  assert.ok(manifest); assert.equal(manifest.configuration.source.path, 'src/theme.ts'); assert.equal(manifest.configuration.action.title, 'Change theme');
  assert.equal(manifest.descriptor.itemId, 'repository/interface/theme'); assert.equal(manifest.descriptor.citationContext.anchors.length, 2);
  assert.equal(manifest.configurationHash, run.definition.configurationHash); assert.equal('sources' in manifest.descriptor, false); assert.equal(mouse.length, 0);
});
