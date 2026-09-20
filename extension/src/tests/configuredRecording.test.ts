import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { LearningLibrary } from '../learningLibrary';
import { RecordingStore, recordingDiskIo, type RecordingIo, type RecordingLimits } from '../recordingStore';
import { recordingContextSchema, recordingHeaderSchema, type RecordingBinding } from '../recordingSchemas';
import { buildRecordingContext } from '../utils/buildRecordingContext';
import { projectRecording } from '../utils/projectRecording';
import { validateRecordingContext } from '../utils/validateRecordingContext';
import { createConfiguredStudy } from './utils/createConfiguredStudy';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');

/** Creates synthetic frame/receipt correspondence for storage and offline projection, never native visual evidence. @example const { store, binding } = await configuredRecordingHarness(context) */
async function configuredRecordingHarness(context: TestContext, limits: Partial<RecordingLimits> = {}, io: RecordingIo = recordingDiskIo) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-configured-recording-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const study = createConfiguredStudy(), library = new LearningLibrary(directory, study.workspaceKey), store = new RecordingStore(directory, study.workspaceKey, limits, io);
  study.captures = (['before', 'paused-browser', 'after'] as const).map(phase => ({ phase, status: 'captured', base64: png.toString('base64'), hash: sha256(png) }));
  await library.saveStudy(study);
  const binding: RecordingBinding = { workspaceKey: study.workspaceKey, studyId: study.id, instanceId: study.instanceId, runId: study.runId, runtimeId: '99999999-9999-4999-8999-999999999999', profile: 'repository-browser', sourceBuild: { revision: 'unit-fixture', dirty: false, sourceHash: sha256('build') } };
  const events = [
    { type: 'capture.requested', elapsedMs: 90, detail: { phase: 'before' } },
    { type: 'capture.response-received', elapsedMs: 100, detail: { phase: 'before', hash: sha256(png) } },
    { type: 'capture.received', elapsedMs: 110, detail: { phase: 'before', renderer: { hash: sha256(png) } } },
    { type: 'capture.requested', elapsedMs: 1990, detail: { phase: 'paused-browser' } },
    { type: 'capture.response-received', elapsedMs: 2010, detail: { phase: 'paused-browser', hash: sha256(png), pause: study.observations[0]!.pause } },
    { type: 'capture.received', elapsedMs: 2020, detail: { phase: 'paused-browser', renderer: { hash: sha256(png) } } },
    { type: 'agent.explanation-saved', elapsedMs: 3500, detail: { id: study.observations[0]!.interpretations[0]!.id, snapshotId: study.observations[0]!.id } },
    { type: 'capture.requested', elapsedMs: 4090, detail: { phase: 'after' } },
    { type: 'capture.response-received', elapsedMs: 4100, detail: { phase: 'after', hash: sha256(png) } },
    { type: 'capture.received', elapsedMs: 4110, detail: { phase: 'after', renderer: { hash: sha256(png) } } },
  ].map((event, index) => ({ ...event, sequence: index + 1, wallTime: '2026-09-20T00:00:10.000Z' }));
  const recordingContext = buildRecordingContext(study, events, 1);
  return { directory, study, library, store, binding, events, recordingContext };
}

test('configured recording replays the bound source and actual values after restart without exposing future explanations or live authority', async context => {
  // Arrange
  const { directory, study, store, binding, recordingContext } = await configuredRecordingHarness(context);
  const writer = await store.start(binding, 0);
  writer.frame({ bytes: png, elapsedMs: 100, kind: 'phase', phase: 'before' });
  writer.frame({ bytes: png, elapsedMs: 2010, kind: 'phase', phase: 'paused-browser' });
  writer.frame({ bytes: png, elapsedMs: 4100, kind: 'phase', phase: 'after' });
  await writer.finish(5000); const saved = await store.saveContext(recordingContext);
  // Act
  const restarted = new RecordingStore(directory, study.workspaceKey), index = await restarted.read(study.id), restored = await restarted.readContext(study.id, saved.hash);
  const before = projectRecording(index, restored.context, 1500), paused = projectRecording(index, restored.context, 2010), confirmed = projectRecording(index, restored.context, 2020), explained = projectRecording(index, restored.context, 3500);
  // Assert
  assert.equal(index.header.version, 2); assert.equal(index.seal?.version, 2); assert.equal(restored.context.version, 2);
  assert.equal(index.status, 'finalized'); assert.equal(before.observation, undefined);
  assert.equal(paused.observation?.itemId, 'repository/interface/theme'); assert.equal(paused.observation?.values['value:enabled'], false);
  assert.equal(paused.observation?.values['value:selection'], null); assert.equal(paused.observation?.source.text, 'const nextTheme = "dark";\n');
  assert.equal(paused.observation?.interpretations.length, 0); assert.equal(paused.pauseConfirmed, true); assert.equal(paused.rendererConfirmed, false);
  assert.equal(confirmed.rendererConfirmed, true); assert.equal(explained.observation?.interpretations.length, 1);
  assert.equal('continueArguments' in paused, false); assert.equal('participants' in restored.context, false);
  assert.deepEqual(await restarted.readFrame(study.id, sha256(png)), png);
  assert.equal(recordingHeaderSchema.safeParse(index.header).success, false); assert.equal(recordingContextSchema.safeParse(restored.context).success, false);
});

test('old and configured recording directories share a catalog and total capacity without rewriting old frames', async context => {
  // Arrange
  const { store, study, binding, directory } = await configuredRecordingHarness(context, { slots: 2 });
  const oldRun = randomUUID(), oldBinding: RecordingBinding = { ...binding, profile: 'checkout-demo', runId: oldRun, studyId: `${binding.instanceId}_${oldRun}` };
  const old = await store.start(oldBinding, 0); old.frame({ bytes: png, elapsedMs: 100, kind: 'stream' }); await old.finish(200);
  const oldHeader = await readFile(join(store.path(oldBinding.studyId), 'header.json')), oldJournal = await readFile(join(store.path(oldBinding.studyId), 'frames.jsonl'));
  // Act
  const configured = await store.start(binding, 0); configured.frame({ bytes: png, elapsedMs: 100, kind: 'stream' }); await configured.finish(200);
  const restarted = new RecordingStore(directory, study.workspaceKey), catalog = await restarted.list(), overflowRun = randomUUID();
  // Assert
  assert.equal(catalog.length, 2); assert.deepEqual(catalog.map(entry => entry.profile).sort(), ['checkout-demo', 'repository-browser']);
  assert.equal((await restarted.header(oldBinding.studyId)).version, 1); assert.equal((await restarted.header(study.id)).version, 2);
  await assert.rejects(store.start({ ...binding, runId: overflowRun, studyId: `${binding.instanceId}_${overflowRun}` }, 0), /Recording library is full/);
  assert.deepEqual(await readFile(join(store.path(oldBinding.studyId), 'header.json')), oldHeader);
  assert.deepEqual(await readFile(join(store.path(oldBinding.studyId), 'frames.jsonl')), oldJournal);
});

test('an interrupted or corrupt preferred recording reservation cannot fall back to a valid old recording', async context => {
  // Arrange
  const { store, binding } = await configuredRecordingHarness(context);
  const old = await store.start({ ...binding, profile: 'checkout-demo' }, 0); old.frame({ bytes: png, elapsedMs: 100, kind: 'stream' }); await old.finish(200);
  const oldHeader = await readFile(join(store.path(binding.studyId), 'header.json'));
  const preferred = store.path(binding.studyId, 2); await mkdir(preferred, { recursive: true });
  // Act / Assert
  await assert.rejects(store.read(binding.studyId));
  const catalog = await store.list(); assert.equal(catalog.length, 1); assert.equal(catalog[0]?.status, 'partial'); assert.equal(catalog[0]?.profile, undefined);
  await writeFile(join(preferred, 'header.json'), oldHeader);
  await assert.rejects(store.header(binding.studyId), /another workspace, study or format/);
  await writeFile(join(preferred, 'header.json'), '{corrupt'); await assert.rejects(store.read(binding.studyId));
  await assert.rejects(store.start(binding, 0), /already exists/);
  assert.deepEqual(await readFile(join(store.path(binding.studyId), 'header.json')), oldHeader);
});

test('configured header seal and context versions must agree before recording data reaches replay', async context => {
  // Arrange
  const { store, binding, recordingContext } = await configuredRecordingHarness(context), writer = await store.start(binding, 0);
  writer.frame({ bytes: png, elapsedMs: 100, kind: 'stream' }); await writer.finish(5000); await store.saveContext(recordingContext);
  const path = store.path(binding.studyId, 2), sealPath = join(path, 'sealed.json'), seal = JSON.parse(await readFile(sealPath, 'utf8'));
  // Act / Assert
  await writeFile(sealPath, JSON.stringify({ ...seal, version: 1 })); await assert.rejects(store.read(binding.studyId), /seal belongs to another study or version/);
  await writeFile(sealPath, JSON.stringify(seal));
  await writeFile(join(path, 'context.json'), JSON.stringify({ ...recordingContext, version: 1 })); await assert.rejects(store.readContext(binding.studyId));
  await assert.rejects(store.file(binding.studyId, 'header.json', 65536, 1), /format changed during reading/);
  const index = await store.read(binding.studyId);
  assert.throws(() => projectRecording({ ...index, header: { ...index.header, version: 1, profile: 'checkout-demo' } }, recordingContext, 100), /another recording/);
});

test('configured partial recordings retain observed source while explicitly missing pixels cannot certify a pause', async context => {
  // Arrange
  const { store, binding, recordingContext } = await configuredRecordingHarness(context, { frames: 1 }), writer = await store.start(binding, 0);
  writer.frame({ bytes: png, elapsedMs: 100, kind: 'stream' });
  assert.equal(writer.frame({ bytes: png, elapsedMs: 2010, kind: 'phase', phase: 'paused-browser' }), false);
  await writer.finish(5000); await store.saveContext(recordingContext);
  // Act
  const index = await store.read(binding.studyId), projection = projectRecording(index, (await store.readContext(binding.studyId)).context, 3500);
  // Assert
  assert.equal(index.status, 'partial'); assert.equal(index.seal?.version, 2);
  assert.equal(projection.observation?.actionId, 'repository-click');
  assert.equal(projection.observation?.values['value:nextTheme'], 'dark'); assert.equal(projection.frame, undefined);
  assert.match(projection.missing!, /capacity reached/); assert.equal(projection.pauseConfirmed, false); assert.equal(projection.rendererConfirmed, false);
});

test('failed configured context saving leaves the film and study intact until an explicit successful retry', async context => {
  // Arrange
  let rejectContext = true;
  const io: RecordingIo = { ...recordingDiskIo, json: async (...arguments_) => {
    if (rejectContext && arguments_[0].endsWith('context.json')) throw new Error('Injected configured context failure');
    return recordingDiskIo.json(...arguments_);
  } };
  const { store, library, binding, recordingContext } = await configuredRecordingHarness(context, {}, io), writer = await store.start(binding, 0);
  writer.frame({ bytes: png, elapsedMs: 100, kind: 'stream' }); await writer.finish(5000);
  const journal = await readFile(join(store.path(binding.studyId, 2), 'frames.jsonl'));
  // Act
  await assert.rejects(store.saveContext(recordingContext), /configured context failure/); await assert.rejects(store.readContext(binding.studyId));
  rejectContext = false; await store.saveContext(recordingContext);
  // Assert
  assert.equal((await library.readCheckpoint(binding.studyId)).status, 'saved'); assert.equal((await store.readContext(binding.studyId)).context.version, 2);
  assert.deepEqual(await readFile(join(store.path(binding.studyId, 2), 'frames.jsonl')), journal);
});

test('configured late explanations require their own matching context and never rewrite the sealed film or backdate availability', async context => {
  // Arrange
  const { store, library, study, binding, events, recordingContext } = await configuredRecordingHarness(context), writer = await store.start(binding, 0);
  writer.frame({ bytes: png, elapsedMs: 100, kind: 'stream' }); await writer.finish(5000);
  const first = await store.saveContext(recordingContext), journal = await readFile(join(store.path(study.id, 2), 'frames.jsonl'));
  const changed = structuredClone(study);
  changed.observations[0]!.interpretations.push({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', text: 'A later note about the actual false flag.', createdAt: '2026-09-20T00:01:00.000Z', facts: [{ path: 'value:enabled', value: false }] });
  changed.savedAt = '2026-09-20T00:01:00.000Z';
  // Act
  await library.saveStudy(changed); await assert.rejects(store.readContext(study.id), /matching context/);
  await store.saveContext(buildRecordingContext(changed, events, 2));
  const saved = await store.readContext(study.id), projection = projectRecording(await store.read(study.id), saved.context, 4500);
  // Assert
  assert.equal(projection.observation?.interpretations.length, 1); assert.equal(projection.laterInterpretations.length, 1);
  assert.equal(projection.laterInterpretations[0]?.availableMs, null);
  await assert.rejects(store.readContext(study.id, first.hash), /stale/);
  assert.deepEqual(await readFile(join(store.path(study.id, 2), 'frames.jsonl')), journal);
  const invalid = structuredClone(saved.context); invalid.study.observations[0]!.source.text = 'changed';
  assert.throws(() => validateRecordingContext(invalid, study.workspaceKey), /source differs/);
});

test('a configured film cannot admit or replay a server phase even if a rewritten journal has matching hashes', async context => {
  // Arrange
  const { store, binding } = await configuredRecordingHarness(context), writer = await store.start(binding, 0);
  writer.frame({ bytes: png, elapsedMs: 100, kind: 'phase', phase: 'before' }); await writer.finish(200);
  const path = store.path(binding.studyId, 2), journalPath = join(path, 'frames.jsonl'), sealPath = join(path, 'sealed.json');
  const altered = (await readFile(journalPath, 'utf8')).replace('"phase":"before"', '"phase":"paused-server"');
  const seal = JSON.parse(await readFile(sealPath, 'utf8')); seal.journalHash = sha256(altered); seal.journalBytes = Buffer.byteLength(altered);
  // Act / Assert
  await writeFile(journalPath, altered); await writeFile(sealPath, JSON.stringify(seal));
  await assert.rejects(store.read(binding.studyId), /foreign image phase/);
  const runId = randomUUID(), another = await store.start({ ...binding, runId, studyId: `${binding.instanceId}_${runId}` }, 0);
  assert.equal(another.frame({ bytes: png, elapsedMs: 100, kind: 'phase', phase: 'paused-server' }), false);
  assert.equal((await another.finish(200)).status, 'partial');
});
