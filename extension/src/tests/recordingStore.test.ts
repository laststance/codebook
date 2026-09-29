import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { appendFile, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../runtimeSupport/utils/sha256';
import { RecordingStore, recordingDiskIo, type RecordingIo, type RecordingLimits } from '../recordingStore';
import type { RecordingBinding } from '../recordingSchemas';
import { LearningLibrary } from '../learningLibrary';
import { setTimeout as delay } from 'node:timers/promises';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');
const workspaceKey = sha256('recording-workspace');

/** Gives recording regressions private real files and explicit fault injection, without claiming browser/native capture. @example const { store, binding } = await recordingHarness(context) */
async function recordingHarness(context: TestContext, limits: Partial<RecordingLimits> = {}, io: RecordingIo = recordingDiskIo) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-recording-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const instanceId = randomUUID(), runId = randomUUID();
  const binding: RecordingBinding = { workspaceKey, studyId: `${instanceId}_${runId}`, instanceId, runId, runtimeId: randomUUID(), profile: 'repository-browser', sourceBuild: { revision: 'fixture-test', dirty: false, sourceHash: sha256('fixed-source') } };
  return { directory, binding, store: new RecordingStore(directory, workspaceKey, limits, io) };
}

test('recording starts after concurrent learner storage finishes instead of losing the entire film to its own writer lock', async context => {
  // Arrange
  const { directory, store, binding } = await recordingHarness(context), library = new LearningLibrary(directory, workspaceKey);
  let release = () => {}, entered = () => {};
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const read = library.readProgress.bind(library);
  library.readProgress = async () => { const progress = await read(); entered(); await held; return progress; };
  const saving = library.select({ profile: 'repository-browser', itemId: 'repository/interface/theme', tab: 'live', follow: false });
  await started;
  // Act: hold the real library lock while the independent recording owner attempts admission.
  const admission = store.start(binding, 0).then(writer => ({ writer }), error => ({ error }));
  await delay(25); release(); await saving;
  const result = await admission;
  // Assert
  assert.ok('writer' in result, `Recording was lost: ${'error' in result ? result.error : ''}`);
  assert.equal(result.writer.frame({ bytes: png, elapsedMs: 50, kind: 'stream' }), true);
  await result.writer.finish(100);
  assert.equal((await store.read(binding.studyId)).status, 'finalized');
  assert.equal((await library.readProgress()).selection?.itemId, 'repository/interface/theme');
});

test('recording is discoverable before its first frame and survives restart without a study archive', async context => {
  // Arrange
  const { directory, binding, store } = await recordingHarness(context), writer = await store.start(binding, 10);
  // Act
  const initial = await store.list();
  assert.equal(writer.frame({ bytes: png, elapsedMs: 20, kind: 'stream' }), true);
  assert.equal(writer.frame({ bytes: png, elapsedMs: 70, kind: 'stream' }), true);
  await writer.finish(120);
  const restarted = new RecordingStore(directory, workspaceKey), recording = await restarted.read(binding.studyId);
  // Assert
  assert.equal(initial.length, 1); assert.equal(initial[0]?.status, 'recording');
  assert.equal(recording.status, 'finalized'); assert.equal(recording.endMs, 120);
  assert.equal(recording.header.clock, 'runtime-receipt-ms'); assert.equal(recording.entries.length, 3);
  assert.deepEqual(recording.entries.map(entry => entry.elapsedMs), [20, 70, 120]);
  assert.equal((await readdir(store.path(binding.studyId))).filter(name => name.endsWith('.png')).length, 1);
  assert.equal(recording.seal?.pngBytes, 68);
  assert.deepEqual(await restarted.readFrame(binding.studyId, sha256(png)), png);
});

test('sampling preserves explicit phase frames and never upgrades stream pixels to a confirmed pause', async context => {
  // Arrange
  const { binding, store } = await recordingHarness(context), writer = await store.start(binding, 0);
  // Act
  const admitted = [writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' }), writer.frame({ bytes: png, elapsedMs: 20, kind: 'stream' }), writer.frame({ bytes: png, elapsedMs: 21, kind: 'phase', phase: 'paused-browser' })];
  await writer.finish(30); const recording = await store.read(binding.studyId);
  // Assert
  assert.deepEqual(admitted, [true, false, true]);
  assert.equal(recording.entries[0]?.type, 'frame');
  assert.equal('phase' in recording.entries[0]!, false);
  assert.equal(recording.entries[1]?.type === 'frame' ? recording.entries[1].phase : undefined, 'paused-browser');
  assert.equal(JSON.stringify(recording.entries).includes('confirmed'), false);
});

test('frame count exhaustion preserves readable frames and still seals the missing tail', async context => {
  // Arrange
  const { store, binding } = await recordingHarness(context, { frames: 1 }), writer = await store.start(binding, 0);
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' });
  // Act
  const rejected = writer.frame({ bytes: png, elapsedMs: 80, kind: 'stream' });
  const seal = await writer.finish(120), recording = await store.read(binding.studyId);
  // Assert
  assert.equal(rejected, false); assert.equal(seal.status, 'partial'); assert.equal(seal.frameCount, 1);
  assert.deepEqual(recording.entries.map(entry => entry.type), ['frame', 'gap', 'end']);
  assert.equal(recording.entries[1]?.elapsedMs, 80); assert.equal(recording.endMs, 120);
  assert.equal(writer.frame({ bytes: png, elapsedMs: 130, kind: 'stream' }), false);
});

test('journal capacity reserves terminal records even when frame metadata fills its admission budget', async context => {
  // Arrange
  const { binding, store } = await recordingHarness(context, { journalBytes: 16_634 }), writer = await store.start(binding, 0);
  // Act
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' });
  writer.frame({ bytes: png, elapsedMs: 70, kind: 'stream' });
  await writer.finish(100); const recording = await store.read(binding.studyId);
  // Assert
  assert.equal(recording.status, 'partial'); assert.equal(recording.seal?.frameCount, 1);
  assert.equal(recording.entries.at(-1)?.type, 'end');
  assert.ok(recording.seal!.journalBytes < 16_634);
});

test('pending binary capacity rejects excess work synchronously while the first write is delayed', async context => {
  // Arrange
  let release: () => void = () => undefined;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const { store, binding } = await recordingHarness(context, { pendingBytes: 350 }, { ...recordingDiskIo, async binary(path, bytes) { if (path.endsWith('.png')) await blocked; await recordingDiskIo.binary(path, bytes); } });
  const writer = await store.start(binding, 0);
  // Act
  const first = writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' });
  const second = writer.frame({ bytes: png, elapsedMs: 70, kind: 'stream' });
  const stateWhileBlocked = writer.state(); release(); await writer.finish(100);
  // Assert
  assert.equal(first, true); assert.equal(second, false); assert.equal(stateWhileBlocked.status, 'partial');
  assert.ok(stateWhileBlocked.pendingHighWaterBytes <= 350);
  assert.equal((await store.read(binding.studyId)).entries[0]?.type, 'frame');
});

test('a torn journal exposes only the verified prefix and never invents an end time after a dead owner', async context => {
  // Arrange
  const { directory, binding, store } = await recordingHarness(context), writer = await store.start(binding, 0);
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' }); await writer.flush();
  const header = await store.header(binding.studyId);
  await writeFile(join(store.path(binding.studyId), 'header.json'), JSON.stringify({ ...header, owner: { ...header.owner, pid: 2_147_483_647 } }));
  await appendFile(join(store.path(binding.studyId), 'frames.jsonl'), '{"type":"frame"');
  // Act
  const recovered = await new RecordingStore(directory, workspaceKey).read(binding.studyId);
  // Assert
  assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.entries.length, 1);
  assert.equal(recovered.lastVerifiedMs, 10); assert.equal(recovered.endMs, undefined);
  assert.match(recovered.reason ?? '', /end time unknown/);
});

test('a failed final seal never advertises a completed recording even when the terminal journal record exists', async context => {
  // Arrange
  const { directory, binding, store } = await recordingHarness(context, {}, { ...recordingDiskIo, async json(path, value, limit) { if (path.endsWith('sealed.json')) throw new Error('injected final storage failure'); await recordingDiskIo.json(path, value, limit); } });
  const writer = await store.start(binding, 0); writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' });
  // Act / Assert
  await assert.rejects(writer.finish(100), /injected final storage failure/);
  const reopened = await new RecordingStore(directory, workspaceKey).read(binding.studyId);
  assert.equal(reopened.status, 'unfinalized'); assert.equal(reopened.endMs, undefined);
  assert.equal(reopened.entries.at(-1)?.type, 'end'); assert.equal(writer.state().status, 'partial');
});

test('a failed blob write cannot publish its frame metadata or certify finalization', async context => {
  // Arrange
  const { binding, store } = await recordingHarness(context, {}, { ...recordingDiskIo, async binary(path, bytes) { if (path.endsWith('.png')) throw new Error('injected blob failure'); await recordingDiskIo.binary(path, bytes); } });
  const writer = await store.start(binding, 0);
  // Act
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' });
  // Assert
  await assert.rejects(writer.finish(100), /end time unknown/);
  assert.equal(await readFile(join(store.path(binding.studyId), 'frames.jsonl'), 'utf8'), '');
  assert.equal((await store.read(binding.studyId)).endMs, undefined);
});

test('sealed journal edits and altered PNG bytes fail instead of showing another frame', async context => {
  // Arrange
  const { store, binding } = await recordingHarness(context), writer = await store.start(binding, 0);
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' }); await writer.finish(100);
  const journalPath = join(store.path(binding.studyId), 'frames.jsonl'), original = await readFile(journalPath);
  // Act / Assert
  await appendFile(journalPath, ' '); await assert.rejects(store.read(binding.studyId), /journal is corrupt/);
  await writeFile(journalPath, original);
  await writeFile(join(store.path(binding.studyId), `${sha256(png)}.png`), Buffer.from('changed'));
  await assert.rejects(store.read(binding.studyId), /hash mismatch/);
});

test('orphan blobs count against storage and nonregular frame files cannot follow external paths', async context => {
  // Arrange
  const { store, binding, directory } = await recordingHarness(context), writer = await store.start(binding, 0);
  writer.frame({ bytes: png, elapsedMs: 10, kind: 'stream' }); await writer.finish(100);
  const orphanPath = join(store.path(binding.studyId), `${sha256('orphan')}.png`), orphan = await open(orphanPath, 'wx');
  await orphan.truncate(536_870_912); await orphan.close();
  // Act / Assert
  await assert.rejects(store.read(binding.studyId), /including orphan/);
  await rm(orphanPath);
  const framePath = join(store.path(binding.studyId), `${sha256(png)}.png`), external = join(directory, 'outside.png');
  await writeFile(external, png); await rm(framePath); await symlink(external, framePath);
  await assert.rejects(store.readFrame(binding.studyId, sha256(png)), /regular file/);
});

test('simultaneous editor reservations cannot overfill a one-slot recording library', async context => {
  // Arrange
  const { directory, store, binding } = await recordingHarness(context, { slots: 1 });
  const second = new RecordingStore(directory, workspaceKey, { slots: 1 }), runId = randomUUID();
  // Act
  const results = await Promise.allSettled([store.start(binding, 0), second.start({ ...binding, runId, studyId: `${binding.instanceId}_${runId}` }, 0)]);
  // Assert
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await store.list()).length, 1);
});

test('interrupted reservations count against capacity and legacy learner bytes remain untouched', async context => {
  // Arrange
  const { directory, binding, store } = await recordingHarness(context, { slots: 1 }, { ...recordingDiskIo, async json() { throw new Error('injected header failure'); } });
  await writeFile(join(directory, 'progress.v2.json'), 'existing learner choices');
  await assert.rejects(store.start(binding, 0), /header failure/);
  const newRunId = randomUUID(), fresh = new RecordingStore(directory, workspaceKey, { slots: 1 });
  // Act / Assert
  await assert.rejects(fresh.start({ ...binding, runId: newRunId, studyId: `${binding.instanceId}_${newRunId}` }, 0), /full/);
  assert.equal((await fresh.list())[0]?.status, 'partial');
  assert.equal(await readFile(join(directory, 'progress.v2.json'), 'utf8'), 'existing learner choices');
});

test('foreign identities and impossible PNG dimensions stop capture without enlarging storage bounds', async context => {
  // Arrange
  const { binding, store } = await recordingHarness(context), writer = await store.start(binding, 0), oversized = Buffer.from(png);
  oversized.writeUInt32BE(4_097, 16);
  // Act / Assert
  assert.equal(writer.frame({ bytes: oversized, elapsedMs: 10, kind: 'stream' }), false);
  assert.equal((await writer.finish(20)).status, 'partial');
  await assert.rejects(store.start({ ...binding, workspaceKey: sha256('another') }, 0), /another workspace/);
  assert.throws(() => store.path('../other'), /Invalid/);
  assert.throws(() => new RecordingStore('/unused', workspaceKey, { slots: 257 }), /Invalid recording limit/);
});


test('a study without a recording offers history recovery without exposing a filesystem error', async context => {
  // Arrange
  const { store, binding } = await recordingHarness(context);
  // Act / Assert
  await assert.rejects(store.read(binding.studyId), /No saved recording is available for this study/);
});


test('ten minutes of animated application frames retain every sampled moment within bounded pending memory', async context => {
  // Arrange: valid PNG text chunks make distinct 33 KB inert frames; binary/append I/O is counted, not native capture.
  let writtenBytes = 0, appendedBytes = 0;
  const { store, binding } = await recordingHarness(context, {}, {
    ...recordingDiskIo,
    async binary(_path, bytes) { writtenBytes += bytes.byteLength; },
    async append(_path, line) { appendedBytes += Buffer.byteLength(line); },
  });
  const writer = await store.start(binding, 0);
  // Act: preserve the production 50 ms sampling rate through the full supported run wall time.
  for (let index = 0; index < 12_000; index++) {
    const chunk = Buffer.alloc(32_932, 32);
    chunk.writeUInt32BE(32_920, 0); chunk.write('tEXt', 4); chunk.write(`Frame\0${index}`, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
    const bytes = Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
    assert.equal(bytes.length, 33_000);
    assert.equal(writer.frame({ bytes, elapsedMs: (index + 1) * 50, kind: 'stream' }), true, `Frame ${index + 1} lost: ${writer.state().reason}`);
    // Flush batches below the unchanged pending-byte budget, without buffering the whole film.
    if ((index + 1) % 100 === 0) await writer.flush();
  }
  const seal = await writer.finish(600_000);
  // Assert
  assert.equal(seal.status, 'complete'); assert.equal(seal.frameCount, 12_000);
  assert.equal(seal.pngBytes, 396_000_000); assert.equal(writtenBytes, 396_000_000);
  assert.equal(seal.endMs, 600_000); assert.equal(seal.journalBytes, appendedBytes);
  assert.ok(writer.state().pendingHighWaterBytes <= 8_388_608);
  assert.equal(writer.state().pendingBytes, 0);
});
