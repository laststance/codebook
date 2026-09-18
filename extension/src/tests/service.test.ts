import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { PROFILE_ID, RUN_TIMEOUT_MS } from '../constants';
import { StudyError } from '../errors';
import { readResource } from '../resources';
import { ControlledRuntime, createHarness } from './helpers';

test('repeated start intent creates one runtime and a conflicting key never silently changes its profile', async () => {
  // Arrange
  const harness = await createHarness(); const service = harness.service;
  const input = { instanceId: service.instanceId, profile: PROFILE_ID, key: 'one' };
  try {
    // Act
    const first = service.start(input), second = service.start(input); const record = service.record(first);
    await record.preparation;
    // Assert
    assert.deepEqual(second, first); assert.equal(harness.runtimes.length, 1);
    assert.throws(() => service.start({ ...input, profile: 'other' }), error => error instanceof StudyError && error.code === 'IDEMPOTENCY_CONFLICT');
    assert.throws(() => service.start({ ...input, key: 'overlap' }), error => error instanceof StudyError && error.code === 'BUSY');
    assert.equal(service.state(record).state, 'ready');
  } finally { await harness.close(); }
});

test('stop during delayed runtime acquisition waits and releases the late resource without preparing it', async () => {
  // Arrange
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; }); let acquiring = false;
  const harness = await createHarness({ create: async directory => { acquiring = true; await barrier; return new ControlledRuntime(directory); } });
  const service = harness.service, receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'late' });
  try {
    await waitUntil(() => acquiring, 'acquisition', 1_000);
    // Act
    let stopped = false; const stopping = service.stop(receipt).then(() => { stopped = true; });
    await Promise.resolve(); assert.equal(stopped, false); release(); await stopping;
    // Assert
    assert.equal(harness.runtimes[0]?.releases, 1); assert.equal(harness.runtimes[0]?.status, 'preparing');
    assert.equal(service.state(service.record(receipt)).cleaned, true);
  } finally { release(); await harness.close(); }
});

test('shutdown during prerequisite validation prevents a late runtime launch', async () => {
  // Arrange
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const harness = await createHarness({ prerequisites: async () => { await barrier; return { ready: true, missing: [] }; } });
  const service = harness.service; service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'late' });
  // Act
  const stopping = service.shutdown(); release(); await stopping;
  // Assert
  assert.equal(harness.runtimes.length, 0); await harness.close();
});

test('an action submitted before readiness is rejected without dispatch and a replay after stop keeps its original receipt', async () => {
  // Arrange
  const harness = await createHarness(), service = harness.service;
  const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'ready' }); const record = service.record(receipt);
  const action = { ...receipt, key: 'click', action: 'add-to-cart' as const };
  try {
    // Act / Assert
    assert.throws(() => service.action(action), error => error instanceof StudyError && error.code === 'BUSY');
    await record.preparation; const first = service.action(action); await service.stop(receipt);
    assert.deepEqual(service.action(action), first); assert.equal(harness.runtimes[0]?.dispatches, 1);
  } finally { await harness.close(); }
});

test('a failed prerequisite becomes an actionable terminal record and never creates a runtime', async () => {
  // Arrange
  const harness = await createHarness({ prerequisites: async () => ({ ready: false, missing: ['codebook.nodeExecutable missing'] }) });
  const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: PROFILE_ID, key: 'missing' });
  try {
    // Act
    await harness.service.record(receipt).preparation; await harness.service.stop(receipt);
    const state = harness.service.state(harness.service.record(receipt));
    // Assert
    assert.equal(harness.runtimes.length, 0); assert.equal(state.error?.code, 'PREREQUISITE_MISSING'); assert.match(state.terminalReason!, /nodeExecutable/);
  } finally { await harness.close(); }
});

test('simultaneous continuation consumes only one exact pause and historical snapshots stay readable after expiry', async () => {
  // Arrange
  let now = 0; const harness = await createHarness({ now: () => now }), service = harness.service;
  const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'pause' }); const record = service.record(receipt);
  try {
    await record.preparation; service.action({ ...receipt, key: 'click', action: 'add-to-cart' });
    const state = service.state(record), continuation = state.participants.server.continueArguments!;
    // Act
    const results = await Promise.allSettled([service.continue(continuation), service.continue(continuation)]);
    now = RUN_TIMEOUT_MS + 1; service.maintain(); await service.stop(receipt);
    const snapshot = await readResource(service, state.participants.server.snapshotUri!);
    // Assert
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(service.state(record).participants.server.resumable, false);
    await assert.rejects(service.continue(continuation), error => error instanceof StudyError && error.code === 'STALE_PAUSE');
    assert.ok('text' in snapshot); assert.equal(JSON.parse(snapshot.text).values.price, 24); assert.equal(harness.runtimes[0]?.dispatches, 1);
  } finally { await harness.close(); }
});

test('explanations publish captured values only after persistence and same-key callers share the pending write', async () => {
  // Arrange
  const harness = await createHarness(), service = harness.service;
  const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'explain' }), record = service.record(receipt);
  let release: (() => void) | undefined;
  try {
    await record.preparation; service.action({ ...receipt, key: 'cart', action: 'add-to-cart' });
    const snapshotUri = service.state(record).participants.server.snapshotUri!, snapshot = service.snapshot(record, snapshotUri);
    const evidence = harness.runtimes[0]!.evidence, originalSave = evidence.save.bind(evidence);
    let entered = false; const barrier = new Promise<void>(resolve => { release = resolve; });
    evidence.save = async (name, contents) => { entered = true; await barrier; await originalSave(name, contents); };
    const input = { ...receipt, key: 'explanation', snapshotUri, sourceHash: snapshot.source.typescriptHash, valuePaths: ['price', 'cartCount'] as ('price' | 'cartCount')[], interpretation: 'The cart is still empty at the captured statement.' };
    // Act
    const first = service.explain(input), duplicate = service.explain(input);
    await waitUntil(() => entered, 'explanation write', 1_000);
    // Assert
    assert.equal(first, duplicate); assert.equal(record.explanations.size, 0);
    assert.throws(() => service.explain({ ...input, interpretation: 'different' }), error => error instanceof StudyError && error.code === 'IDEMPOTENCY_CONFLICT');
    release?.(); const result = await first; const resource = await readResource(service, result.explanationUri);
    assert.ok('text' in resource); const saved = JSON.parse(resource.text);
    assert.deepEqual(saved.capturedFacts, [{ path: 'price', value: 24 }, { path: 'cartCount', value: 0 }]); assert.equal(saved.learnerUnderstandingChanged, false);
    assert.deepEqual(JSON.parse(await readFile(join(evidence.directory, `agent-explanation-${saved.id}.json`), 'utf8')), saved);
  } finally { release?.(); await harness.close(); }
});

test('a failed explanation write never appears as committed history or a successful final outcome', async () => {
  // Arrange
  const harness = await createHarness(), service = harness.service;
  const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'storage' }), record = service.record(receipt);
  try {
    await record.preparation; service.action({ ...receipt, key: 'cart', action: 'add-to-cart' });
    const snapshotUri = service.state(record).participants.server.snapshotUri!, snapshot = service.snapshot(record, snapshotUri);
    harness.runtimes[0]!.evidence.save = async () => { throw new Error('ENOSPC'); };
    // Act / Assert
    await assert.rejects(service.explain({ ...receipt, key: 'explain', snapshotUri, sourceHash: snapshot.source.typescriptHash, valuePaths: ['price'], interpretation: 'Price captured.' }), error => error instanceof StudyError && error.code === 'EVIDENCE_UNAVAILABLE');
    assert.equal(record.explanations.size, 0); assert.equal(service.state(record).finalOutcome, 'not-demonstrated');
  } finally { await harness.close(); }
});

test('completed runtime resources are released without a further client request', async () => {
  // Arrange
  const harness = await createHarness(), service = harness.service;
  const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'complete' });
  try {
    await service.record(receipt).preparation; harness.runtimes[0]!.status = 'completed';
    // Act
    service.maintain(); await waitUntil(() => service.record(receipt).stopped, 'automatic completion cleanup', 1_000);
    // Assert
    assert.equal(harness.runtimes[0]?.releases, 1); assert.equal(service.state(service.record(receipt)).cleaned, true);
  } finally { await harness.close(); }
});

test('event pagination bounds response detail and a source resource retains the captured bytes', async () => {
  // Arrange
  const harness = await createHarness(), service = harness.service;
  const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'history' });
  try {
    const record = service.record(receipt); await record.preparation; service.action({ ...receipt, key: 'cart', action: 'add-to-cart' });
    for (let index = 0; index < 60; index += 1) harness.runtimes[0]!.evidence.record('test.detail', { text: 'x'.repeat(9_000) });
    // Act
    const page = await readResource(service, service.uri(record.id, 'events/0'));
    const source = await readResource(service, service.state(record).participants.server.sourceUri!);
    // Assert
    assert.ok('text' in page && 'text' in source); const parsed = JSON.parse(page.text);
    assert.equal(parsed.events.length, 50); assert.equal(parsed.events[1].detail.truncated, true); assert.match(parsed.nextUri, /events\/50$/);
    assert.equal(source.text, 'const price = 24;');
    await assert.rejects(readResource(service, service.uri(record.id, 'events/-1')), /cursor/);
  } finally { await harness.close(); }
});
