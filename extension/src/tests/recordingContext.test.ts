import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { RecordingStore, recordingDiskIo, type RecordingIo } from '../recordingStore';
import { LearningLibrary } from '../learningLibrary';
import { buildRecordingContext } from '../utils/buildRecordingContext';
import { captureStudy } from '../utils/captureStudy';
import { projectRecording } from '../utils/projectRecording';
import { readResource } from '../resources';
import { validateRecordingContext } from '../utils/validateRecordingContext';
import { ControlledRuntime, createHarness } from './helpers';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');

/** Combines actual service/archive/recording I/O with a deterministic synthetic runtime clock; it is not native proof. @example const harness = await contextHarness() */
async function contextHarness(io: RecordingIo = recordingDiskIo) {
  let clock = 0;
  const harness = await createHarness({ create: async directory => { const runtime = new ControlledRuntime(directory); runtime.evidence.elapsedMs = () => clock; return runtime; } });
  const service = harness.service, workspaceKey = sha256(harness.directory), directory = join(harness.directory, 'learning');
  const store = new RecordingStore(directory, workspaceKey, {}, io), library = new LearningLibrary(directory, workspaceKey);
  service.environment.build.sourceHash = sha256('source-build'); service.recordings = store;
  const receipt = service.start({ instanceId: service.instanceId, profile: 'paired-cart-demo', key: 'recorded' }), record = service.record(receipt);
  await record.preparation; assert.ok(record.recording);
  const runtime = harness.runtimes[0]!, view = runtime.view.bind(runtime);
  runtime.view = () => ({ ...view(), finalOutcome: 'demonstrated' });
  return { ...harness, record, receipt, store, library, runtime, workspaceKey,
    clock(value: number) { clock = value; },
    async checkpoint() {
      const study = await captureStudy(service, record, workspaceKey); assert.ok(study);
      const revision = service.beginHistory(record, study.materialSignature); assert.ok(revision);
      await library.saveStudy(study); service.reportHistory(record, study.materialSignature, revision, 'saved');
      await service.saveRecordingContext(record, study, revision);
      return { study, revision };
    } };
}

test('replay withholds future values and saved interpretations even when their creation date is earlier', async () => {
  // Arrange
  const harness = await contextHarness(), { service, record, runtime, store } = harness;
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' }); harness.clock(100);
    service.action({ ...harness.receipt, key: 'cart', action: 'add-to-cart' });
    const observed = service.state(record).observations[0]!; harness.clock(180);
    await service.explain({ ...harness.receipt, key: 'meaning', snapshotUri: observed.snapshotUri, sourceHash: sha256('const price = 24;'), valuePaths: ['price'], interpretation: 'Observed price: 24.' });
    harness.clock(250); await service.stop(harness.receipt); await harness.checkpoint();
    const index = await store.read(record.recording!.header.studyId), saved = await store.readContext(index.header.studyId);
    // Act
    const before = projectRecording(index, saved.context, 99), stop = projectRecording(index, saved.context, 100), later = projectRecording(index, saved.context, 180);
    // Assert
    assert.equal(before.observation, undefined); assert.equal(stop.observation?.values.price, 24);
    assert.equal(stop.observation?.interpretations.length, 0); assert.equal(stop.laterInterpretations.length, 1);
    assert.equal(later.observation?.interpretations[0]?.text, 'Observed price: 24.');
    assert.equal(saved.context.interpretationAvailability[0]?.elapsedMs, 180);
    assert.equal(runtime.dispatches, 1); assert.equal(runtime.releases, 1);
    assert.equal((await harness.library.readProgress()).decisions.length, 0);
  } finally { await harness.close(); }
});

test('late annotations replace only context and stale context hashes never return different bytes', async () => {
  // Arrange
  const harness = await contextHarness(), { service, record, store } = harness;
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' }); harness.clock(100);
    service.action({ ...harness.receipt, key: 'cart', action: 'add-to-cart' }); harness.clock(200);
    await service.stop(harness.receipt); await harness.checkpoint();
    const id = record.recording!.header.studyId, earlier = await store.readContext(id), journal = await readFile(join(store.path(id), 'frames.jsonl'));
    assert.equal(service.state(record).recordedStudyOutcome, 'demonstrated'); harness.clock(400);
    // Act
    await service.explain({ ...harness.receipt, key: 'later', snapshotUri: service.state(record).observations[0]!.snapshotUri, sourceHash: sha256('const price = 24;'), valuePaths: ['price'], interpretation: 'Added after the app exited.' });
    assert.equal(service.state(record).recordedStudyOutcome, 'pending');
    await harness.checkpoint(); const latest = await store.readContext(id), index = await store.read(id);
    // Assert
    assert.notEqual(latest.hash, earlier.hash); await assert.rejects(store.readContext(id, earlier.hash), /stale/);
    assert.deepEqual(await readFile(join(store.path(id), 'frames.jsonl')), journal);
    assert.equal(index.endMs, 200);
    const projection = projectRecording(index, latest.context, 200);
    assert.equal(projection.observation?.interpretations.length, 0); assert.equal(projection.laterInterpretations[0]?.availableMs, 400);
    assert.equal(service.state(record).recordedStudyOutcome, 'demonstrated');
  } finally { await harness.close(); }
});

test('phase confirmation badges appear only after their own receipt and the referenced observation', async () => {
  // Arrange
  const harness = await contextHarness(), { runtime, record, service, store } = harness;
  try {
    harness.clock(100); service.action({ ...harness.receipt, key: 'cart', action: 'add-to-cart' });
    const pause = runtime.snapshot!.pause;
    harness.clock(110); runtime.evidence.record('capture.requested', { phase: 'paused-server', pause });
    harness.clock(120); runtime.evidence.record('capture.response-received', { phase: 'paused-server', pause, hash: sha256(png) });
    record.recording!.frame({ bytes: png, elapsedMs: 120, kind: 'phase', phase: 'paused-server' });
    harness.clock(200); runtime.evidence.record('capture.received', { phase: 'paused-server', pause, renderer: { hash: sha256(png) } });
    harness.clock(250); await service.stop(harness.receipt); await harness.checkpoint();
    const index = await store.read(record.recording!.header.studyId), saved = await store.readContext(index.header.studyId);
    // Act
    const pixels = projectRecording(index, saved.context, 120), painted = projectRecording(index, saved.context, 200);
    // Assert
    assert.equal(pixels.pauseConfirmed, true); assert.equal(pixels.rendererConfirmed, false);
    assert.equal(painted.rendererConfirmed, true);
    assert.equal(saved.context.phases.find(phase => phase.phase === 'paused-server')?.pixelsMs, 120);
    assert.equal(saved.context.phases.find(phase => phase.phase === 'paused-server')?.rendererConfirmedMs, 200);
  } finally { await harness.close(); }
});

test('known missing intervals hide pixels rather than keeping an apparently current frozen screenshot', async () => {
  // Arrange
  const harness = await contextHarness(), { record, service, store } = harness;
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' }); record.recording!.stopFrames(100, 'stream lost');
    harness.clock(200); await service.stop(harness.receipt); await harness.checkpoint();
    const index = await store.read(record.recording!.header.studyId);
    // Act / Assert
    assert.ok(projectRecording(index, undefined, 99).frame);
    assert.equal(projectRecording(index, undefined, 100).frame, undefined);
    assert.equal(projectRecording(index, undefined, 100).missing, 'stream lost');
    assert.equal(service.state(record).recordedStudyOutcome, 'partial');
  } finally { await harness.close(); }
});

test('context storage rejection leaves execution history complete but recorded study partial through repeated GET', async () => {
  // Arrange
  const harness = await contextHarness({ ...recordingDiskIo, async json(path, value, limit) { if (path.endsWith('context.json')) throw new Error('injected context failure'); await recordingDiskIo.json(path, value, limit); } });
  try {
    harness.record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' }); harness.clock(100);
    await harness.service.stop(harness.receipt);
    // Act
    await harness.checkpoint(); const state = harness.service.state(harness.record);
    // Assert
    assert.equal(state.studyOutcome, 'demonstrated'); assert.equal(state.recordedStudyOutcome, 'partial');
    assert.equal(state.recording.contextStatus, 'failed'); assert.match(state.recording.contextReason ?? '', /injected context failure/);
    assert.equal((await harness.service.stop(harness.receipt)).recordedStudyOutcome, 'partial');
    assert.equal(harness.runtime.releases, 1);
  } finally { await harness.close(); }
});

test('a delayed context checkpoint cannot certify newer explanations and does not alter the material signature', async () => {
  // Arrange
  let release: () => void = () => undefined, entered: () => void = () => undefined;
  const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const harness = await contextHarness({ ...recordingDiskIo, async json(path, value, limit) { if (path.endsWith('context.json')) { entered(); await waiting; } await recordingDiskIo.json(path, value, limit); } });
  try {
    harness.record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' }); harness.clock(100);
    harness.service.action({ ...harness.receipt, key: 'cart', action: 'add-to-cart' }); harness.clock(200); await harness.service.stop(harness.receipt);
    const pending = harness.checkpoint(); await started;
    assert.equal(harness.service.state(harness.record).recordedStudyOutcome, 'pending');
    // Act
    harness.clock(300); await harness.service.explain({ ...harness.receipt, key: 'new', snapshotUri: harness.service.state(harness.record).observations[0]!.snapshotUri, sourceHash: sha256('const price = 24;'), valuePaths: ['price'], interpretation: 'Newer checkpoint.' });
    const signature = harness.service.state(harness.record).materialSignature; release(); await pending;
    // Assert
    assert.equal(harness.service.state(harness.record).recordedStudyOutcome, 'pending');
    assert.equal(harness.service.state(harness.record).materialSignature, signature);
    await harness.checkpoint(); assert.equal(harness.service.state(harness.record).recordedStudyOutcome, 'demonstrated');
    assert.equal(harness.service.state(harness.record).materialSignature, signature);
  } finally { release(); await harness.close(); }
});

test('context rejects source tampering, rewritten availability and a hash from another saved checkpoint', async () => {
  // Arrange
  const harness = await contextHarness();
  try {
    harness.record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' }); harness.clock(100);
    harness.service.action({ ...harness.receipt, key: 'cart', action: 'add-to-cart' }); harness.clock(200); await harness.service.stop(harness.receipt);
    const { study, revision } = await harness.checkpoint(), context = buildRecordingContext(study, harness.runtime.evidence.events, revision);
    // Act / Assert
    const changed = structuredClone(context); changed.study.observations[0]!.source.text = 'changed';
    assert.throws(() => validateRecordingContext(changed, harness.workspaceKey), /source is incomplete or changed/);
    await assert.rejects(harness.store.saveContext({ ...context, studyHash: sha256('wrong checkpoint'), historyRevision: revision + 1 }), /saved study checkpoint/);
    await writeFile(join(harness.store.path(context.studyId), 'context.json'), JSON.stringify(changed));
    await assert.rejects(harness.store.readContext(context.studyId), /source is incomplete or changed/);
  } finally { await harness.close(); }
});


test('rediscovery rejects valid JSON recorded values that differ from the saved study checkpoint', async () => {
  // Arrange
  const harness = await contextHarness(), { service, record, store } = harness;
  try {
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' }); harness.clock(100);
    service.action({ ...harness.receipt, key: 'cart', action: 'add-to-cart' }); harness.clock(200);
    await service.stop(harness.receipt); await harness.checkpoint();
    const id = record.recording!.header.studyId, saved = await store.readContext(id);
    saved.context.study.observations[0]!.values.price = 25;
    const corrupt = JSON.stringify(saved.context);
    await writeFile(join(store.path(id), 'context.json'), corrupt);
    // Act / Assert: a new URI cannot turn a parseable changed value into an observed fact.
    await assert.rejects(store.readContext(id), /differs from the saved study checkpoint/);
    const base = `codebook://${service.instanceId}/studies/${id}/recording`;
    await assert.rejects(readResource(service, `${base}/context/${sha256(corrupt)}`), /differs from the saved study checkpoint/);
    const metadata = await readResource(service, base);
    assert.ok('text' in metadata); assert.equal(JSON.parse(metadata.text).contextUri, undefined);
    assert.match(JSON.parse(metadata.text).contextReason, /differs from the saved study checkpoint/);
    assert.equal((await harness.library.readStudy(id)).observations[0]!.values.price, 24);
  } finally { await harness.close(); }
});
