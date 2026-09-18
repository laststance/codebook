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
