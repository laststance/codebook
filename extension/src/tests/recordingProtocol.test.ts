import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { StudyClient } from '../client';
import { startServer } from '../server';
import { StudyService } from '../service';
import { RecordingStore } from '../recordingStore';
import { PlaybackController } from '../playbackController';
import { readResource } from '../resources';
import { createHarness } from './helpers';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');
const stateSchema = z.object({ revision: z.number(), studyId: z.string().optional(), presentedMs: z.number().optional(), mode: z.string().optional() });

/** Binds actual saved files and protocol controls to a synthetic renderer; native host presentation is tested separately. @example installPlayback(service, store) */
function installPlayback(service: StudyService, store: RecordingStore) {
  service.recordings = store;
  const controller = new PlaybackController({ load: async studyId => ({ index: await store.read(studyId) }), frame: (studyId, hash) => store.readFrame(studyId, hash), present: async (_bundle, signal) => { signal.throwIfAborted(); }, invalidate() {}, changed() {},
    save: bundle => store.savePreference({ version: 1, workspaceKey: store.workspaceKey, studyId: bundle.studyId, positionMs: bundle.projection.positionMs }), manualTicks: true });
  service.playbackController = controller; return controller;
}

test('new server credentials discover and replay a stored recording with no live run or original service', async () => {
  // Arrange: fixed PNG input is a storage fixture, not claimed real native recording.
  const harness = await createHarness(), workspaceKey = sha256(harness.directory), directory = join(harness.directory, 'learning');
  const store = new RecordingStore(directory, workspaceKey), instanceId = harness.service.instanceId, runId = randomUUID(), studyId = `${instanceId}_${runId}`;
  const writer = await store.start({ workspaceKey, studyId, instanceId, runId, runtimeId: randomUUID(), profile: 'checkout-demo', sourceBuild: { revision: 'test', dirty: false, sourceHash: sha256('build') } }, 0);
  writer.frame({ bytes: png, elapsedMs: 0, kind: 'stream' }); await writer.finish(100);
  const firstController = installPlayback(harness.service, store), first = await startServer(harness.service);
  await first.close(); await firstController.dispose();
  const restarted = new StudyService(harness.service.environment, harness.directory), controller = installPlayback(restarted, new RecordingStore(directory, workspaceKey));
  const endpoint = await startServer(restarted), client = await StudyClient.connect(endpoint.descriptor);
  try {
    // Act
    const discovery = await client.tool('codebook_status', {}, z.object({ apiVersion: z.string(), recording: z.object({ libraryUri: z.string(), playbackUri: z.string() }), runs: z.array(z.unknown()) }));
    const library = await client.json(discovery.recording.libraryUri, z.object({ entries: z.array(z.object({ studyId: z.string(), recordingUri: z.string() })) }));
    const entry = library.entries[0]!;
    const recording = await client.json(entry.recordingUri, z.object({ framesUri: z.string(), status: z.string(), endMs: z.number(), contextReason: z.string() }));
    const initial = await client.json(discovery.recording.playbackUri, stateSchema);
    await client.tool('codebook_playback', { instanceId: restarted.instanceId, studyId: entry.studyId, action: 'open', expectedRevision: initial.revision }, stateSchema); await controller.settle();
    const opened = await client.json(discovery.recording.playbackUri, stateSchema);
    await client.tool('codebook_playback', { instanceId: restarted.instanceId, studyId: entry.studyId, action: 'seek', positionMs: 100, expectedRevision: opened.revision }, stateSchema); await controller.settle();
    // Assert
    assert.equal(discovery.apiVersion, '1.2'); assert.equal(discovery.runs.length, 0); assert.equal(entry.studyId, studyId);
    assert.equal(recording.status, 'finalized'); assert.equal(recording.endMs, 100); assert.match(recording.contextReason, /context\.json/);
    assert.equal((await client.json(discovery.recording.playbackUri, stateSchema)).presentedMs, 100);
    assert.equal((await store.readPreference())?.positionMs, 100); assert.equal(harness.runtimes.length, 0);
    await assert.rejects(client.read(`codebook://${instanceId}/studies/${studyId}/recording`), error =>
      z.object({ data: z.object({ code: z.literal('STALE_INSTANCE'), recovery: z.string().min(1) }) }).safeParse(error).success);
  } finally { await client.close(); await controller.dispose(); await endpoint.close(); await harness.close(); }
});

test('recording pages are bounded and foreign frames, paths and concurrent stale controls are rejected', async () => {
  // Arrange
  const harness = await createHarness(), workspaceKey = sha256(harness.directory), store = new RecordingStore(join(harness.directory, 'learning'), workspaceKey);
  const runId = randomUUID(), studyId = `${harness.service.instanceId}_${runId}`;
  const writer = await store.start({ workspaceKey, studyId, instanceId: harness.service.instanceId, runId, runtimeId: randomUUID(), profile: 'paired-cart-demo', sourceBuild: { revision: 'test', dirty: false, sourceHash: sha256('build') } }, 0);
  for (let index = 0; index < 101; index++) writer.frame({ bytes: png, elapsedMs: index * 50, kind: 'stream' });
  await writer.finish(5_100);
  const controller = installPlayback(harness.service, store), endpoint = await startServer(harness.service), client = await StudyClient.connect(endpoint.descriptor), base = `codebook://${harness.service.instanceId}/studies/${studyId}/recording`;
  try {
    // Act
    const page = await client.json(`${base}/frames/0`, z.object({ entries: z.array(z.object({ type: z.string(), uri: z.string().optional() })), nextUri: z.string() }));
    const next = await client.json(page.nextUri, z.object({ entries: z.array(z.unknown()), nextUri: z.string().optional() }));
    const image = (await client.read(page.entries[0]!.uri!)).contents[0];
    await client.tool('codebook_playback', { instanceId: harness.service.instanceId, studyId, action: 'open', expectedRevision: 0 }, stateSchema); await controller.settle();
    const revision = controller.state().revision;
    const controls = await Promise.allSettled([100, 200].map(positionMs => client.tool('codebook_playback', { instanceId: harness.service.instanceId, studyId, action: 'seek', expectedRevision: revision, positionMs }, stateSchema)));
    await controller.settle();
    // Assert
    assert.equal(page.entries.length, 100); assert.equal(next.entries.length, 2); assert.equal(next.nextUri, undefined);
    assert.ok(image && 'blob' in image); assert.equal(image.blob, png.toString('base64'));
    assert.equal(controls.filter(result => result.status === 'fulfilled').length, 1); assert.equal(controls.filter(result => result.status === 'rejected').length, 1);
    assert.equal(harness.runtimes.length, 0);
    await assert.rejects(client.read(`${base}/frame/${sha256('not-recorded')}`), /does not belong/);
    await assert.rejects(client.read(`${base}/frames/01`), /canonical/);
    await assert.rejects(readResource(harness.service, `${base}?file=/etc/passwd`), /canonical/);
    // Direct guards reject raw aliases; the public SDK safely normalizes this alias before identity validation.
    await assert.rejects(readResource(harness.service, `${base}/../recording`), /canonical/);
    assert.deepEqual(await client.read(`${base}/../recording`), await client.read(base));
  } finally { await client.close(); await controller.dispose(); await endpoint.close(); await harness.close(); }
});

test('a corrupt playback preference loses only navigation and leaves stored understanding unchanged', async () => {
  // Arrange
  const harness = await createHarness(), directory = join(harness.directory, 'learning'), workspaceKey = sha256(harness.directory), store = new RecordingStore(directory, workspaceKey);
  const studyId = `${randomUUID()}_${randomUUID()}`;
  await store.savePreference({ version: 1, workspaceKey, studyId, positionMs: 42 });
  await writeFile(join(directory, 'progress.v2.json'), 'learner-owned history');
  // Act / Assert
  assert.equal((await new RecordingStore(directory, workspaceKey).readPreference())?.positionMs, 42);
  await writeFile(join(directory, 'playback.v1.json'), '{corrupt'); await assert.rejects(store.readPreference());
  const { readFile } = await import('node:fs/promises');
  assert.equal(await readFile(join(directory, 'progress.v2.json'), 'utf8'), 'learner-owned history');
  await harness.close();
});

test('concurrent recorded PNG reads share sealed verification and still reject changed frame bytes', async () => {
  // Arrange
  const harness = await createHarness(), workspaceKey = sha256(harness.directory), store = new RecordingStore(join(harness.directory, 'learning'), workspaceKey);
  harness.service.recordings = store;
  const runId = randomUUID(), studyId = `${harness.service.instanceId}_${runId}`;
  const writer = await store.start({ workspaceKey, studyId, instanceId: harness.service.instanceId, runId, runtimeId: randomUUID(), profile: 'paired-cart-demo', sourceBuild: { revision: 'test', dirty: false, sourceHash: sha256('build') } }, 0);
  for (const elapsedMs of [0, 50, 100]) writer.frame({ bytes: png, elapsedMs, kind: 'stream' });
  await writer.finish(150);
  let reads = 0; const read = store.readFrame.bind(store);
  store.readFrame = async (id, hash) => { reads++; return read(id, hash); };
  const base = `codebook://${harness.service.instanceId}/studies/${studyId}/recording`, uri = `${base}/frame/${sha256(png)}`;
  try {
    // Act
    const frames = await Promise.all([readResource(harness.service, uri), readResource(harness.service, uri), readResource(harness.service, uri)]);
    // Assert: one unique PNG verification plus three independently verified returned payloads.
    assert.equal(reads, 4); assert.equal(frames.length, 3);
    await readResource(harness.service, uri); assert.equal(reads, 5);
    await writeFile(join(store.path(studyId), `${sha256(png)}.png`), Buffer.concat([png, Buffer.from('corrupt')]));
    await assert.rejects(readResource(harness.service, uri), /hash mismatch/);
    await assert.rejects(readResource(harness.service, base), /hash mismatch/);
    // A cached index cannot conceal a changed journal, even for a previously valid frame URI.
    await writeFile(join(store.path(studyId), `${sha256(png)}.png`), png);
    const { appendFile } = await import('node:fs/promises'); await appendFile(join(store.path(studyId), 'frames.jsonl'), ' ');
    await assert.rejects(readResource(harness.service, uri), /journal is corrupt/);
  } finally { await harness.close(); }
});
