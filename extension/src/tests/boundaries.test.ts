import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROFILE_ID } from '../constants';
import { StudyError } from '../errors';
import { readResource } from '../resources';
import { readBoundedFile } from '../utils/readBoundedFile';
import { createHarness } from './helpers';

test('retaining sixteen stopped runs rejects a seventeenth without evicting original history or idempotency', async () => {
  // Arrange
  const harness = await createHarness(), service = harness.service;
  const initial = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'first' });
  try {
    await service.stop(initial);
    for (let index = 1; index < 16; index += 1) await service.stop(service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: `study-${index}` }));
    // Act / Assert
    assert.throws(() => service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'excess' }), error => error instanceof StudyError && error.code === 'LIMIT_EXCEEDED');
    assert.deepEqual(service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'first' }), initial);
    assert.equal(service.records.size, 16); assert.equal(service.state(service.record(initial)).cleaned, true);
  } finally { await harness.close(); }
});

test('explanation capacity preserves thirty-two captured records and rejects a new intent', async () => {
  // Arrange
  const harness = await createHarness(), service = harness.service;
  const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'explanations' }), record = service.record(receipt);
  try {
    await record.preparation; service.action({ ...receipt, key: 'click', action: 'add-to-cart' });
    const snapshotUri = service.state(record).participants.server.snapshotUri!, snapshot = service.snapshot(record, snapshotUri);
    const input = { ...receipt, key: 'first', snapshotUri, sourceHash: snapshot.source.typescriptHash, valuePaths: [], interpretation: 'An explicitly labeled interpretation.' };
    const first = await service.explain(input);
    for (let index = 1; index < 32; index += 1) await service.explain({ ...input, key: `explain-${index}` });
    // Act / Assert
    assert.throws(() => service.explain({ ...input, key: 'excess' }), error => error instanceof StudyError && error.code === 'LIMIT_EXCEEDED');
    assert.deepEqual(await service.explain(input), first); assert.equal(record.explanations.size, 32);
  } finally { await harness.close(); }
});

test('foreign snapshots, duplicate value paths and wrong source hashes cannot commit an explanation', async () => {
  // Arrange
  const harness = await createHarness(), service = harness.service;
  const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'references' }), record = service.record(receipt);
  try {
    await record.preparation; service.action({ ...receipt, key: 'click', action: 'add-to-cart' });
    const snapshotUri = service.state(record).participants.server.snapshotUri!, snapshot = service.snapshot(record, snapshotUri);
    const input = { ...receipt, key: 'invalid', snapshotUri, sourceHash: snapshot.source.typescriptHash, valuePaths: [], interpretation: 'Not yet committed.' };
    // Act / Assert
    assert.throws(() => service.explain({ ...input, snapshotUri: `${snapshotUri}other` }), /Snapshot is absent/);
    assert.throws(() => service.explain({ ...input, valuePaths: ['price', 'price'] }), /distinct value paths/);
    assert.throws(() => service.explain({ ...input, sourceHash: '0'.repeat(64) }), /Source hash/);
    assert.equal(record.explanationKeys.size, 0); assert.equal(record.explanations.size, 0);
    await assert.rejects(readResource(service, `${receipt.runUri}/images/../../etc/passwd`), /Unknown resource/);
    await assert.rejects(readResource(service, `${receipt.runUri}?file=/etc/passwd`), /canonical resource URI/);
  } finally { await harness.close(); }
});

test('a failed cleanup remains retryable and cannot report cleaned history', async () => {
  // Arrange
  const harness = await createHarness(), service = harness.service;
  const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'cleanup' }), record = service.record(receipt);
  try {
    await record.preparation; const runtime = harness.runtimes[0]!, originalStop = runtime.stop.bind(runtime);
    runtime.stop = async () => { throw new Error('Owned process still alive'); };
    // Act / Assert
    await assert.rejects(service.stop(receipt), /still alive/); assert.equal(service.state(record).cleaned, false);
    runtime.stop = originalStop; await service.stop(receipt); assert.equal(service.state(record).cleaned, true);
  } finally { await harness.close(); }
});

test('bounded evidence reads reject oversized and missing bytes with an actionable domain error', async () => {
  // Arrange
  const harness = await createHarness(), path = join(harness.directory, 'image.png');
  try {
    await writeFile(path, Buffer.alloc(11));
    // Act / Assert
    await assert.rejects(readBoundedFile(path, 10), error => error instanceof StudyError && error.code === 'EVIDENCE_UNAVAILABLE');
    await assert.rejects(readBoundedFile(join(harness.directory, 'absent'), 10), error => error instanceof StudyError && error.code === 'EVIDENCE_UNAVAILABLE');
  } finally { await harness.close(); }
});
