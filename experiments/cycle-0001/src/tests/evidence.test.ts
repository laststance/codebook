import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Evidence } from '../evidence';

test('overlapping manifest writes leave the latest complete state after flushing', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-'));
  const evidence = new Evidence(directory);
  await evidence.initialize();
  try {
    // Act
    const earlier = evidence.save('manifest.json', { status: 'preparing', padding: 'a'.repeat(100_000) });
    evidence.record('run.failed', { reason: 'disconnect' });
    const latest = evidence.save('manifest.json', { status: 'failed', cleaned: true });
    await Promise.all([earlier, latest]);
    await evidence.flush();
    // Assert
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')), { status: 'failed', cleaned: true });
    assert.equal(JSON.parse(await readFile(join(directory, 'events.jsonl'), 'utf8')).type, 'run.failed');
  } finally { await rm(directory, { recursive: true }); }
});

test('immediate cleanup can record evidence before initialization finishes', async () => {
  // Arrange
  const parent = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-'));
  const directory = join(parent, 'new', 'run');
  const evidence = new Evidence(directory);
  try {
    // Act
    evidence.record('cleanup.started');
    await evidence.save('manifest.json', { cleaned: true });
    await evidence.flush();
    // Assert
    assert.equal(JSON.parse(await readFile(join(directory, 'events.jsonl'), 'utf8')).type, 'cleanup.started');
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')), { cleaned: true });
  } finally { await rm(parent, { recursive: true }); }
});

test('a bounded recorder stops retaining events at capacity and reports missing evidence instead of growing history', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-'));
  const evidence = new Evidence(directory, { maxEvents: 2, retainedBytes: 10_000, queuedBytes: 10_000 });
  try {
    // Act
    evidence.record('first'); evidence.record('second'); evidence.record('overflow');
    for (let index = 0; index < 100; index += 1) evidence.record('ignored');
    // Assert
    assert.equal(evidence.events.length, 2); await assert.rejects(evidence.flush(), /buffering limit/);
    await assert.rejects(evidence.save('false-success.json', { success: true }), /buffering limit/);
    assert.equal((await readFile(join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').length, 2);
  } finally { await rm(directory, { recursive: true }); }
});

test('retained bytes and queued bytes have separate limits even before the writer can drain', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-'));
  const retained = new Evidence(join(directory, 'retained'), { maxEvents: 100, retainedBytes: 10, queuedBytes: 10_000 });
  const queued = new Evidence(join(directory, 'queued'), { maxEvents: 100, retainedBytes: 10_000, queuedBytes: 100 });
  try {
    // Act
    retained.record('too-large');
    const firstWrite = queued.save('first.txt', 'x'.repeat(80));
    const overCapacity = queued.save('second.txt', 'x'.repeat(80));
    // Observe both immediate rejections before yielding to the separate retained-byte writer.
    const rejectedWrites = Promise.all([assert.rejects(overCapacity, /queued write limit/), assert.rejects(firstWrite, /queued write limit/)]);
    // Assert
    assert.equal(retained.events.length, 0); await assert.rejects(retained.flush(), /buffering limit/);
    await rejectedWrites;
    await assert.rejects(queued.flush(), /queued write limit/);
  } finally { await rm(directory, { recursive: true }); }
});
