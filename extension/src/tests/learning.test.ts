import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { LearningLibrary } from '../learningLibrary';
import { learningState, projectStudy, type LearnerDecision, type LiveStudy, type SourceBaselines, type StudyArchive } from '../studyModel';
import { validateStudy } from '../utils/validateStudy';
import { loadModule } from './utils/loadModule';
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite';

const workspaceKey = sha256('workspace-a'), source = 'const cartCount = 0;\n', sourceHash = sha256(source);
const baselines: SourceBaselines = { server: { text: source, hash: sourceHash, line: 1, path: '/fixture/server.mts' }, browser: { text: source, hash: sourceHash, line: 1, path: '/fixture/client.mts' } };

/** Supplies a bounded captured stop to persistence/selection regressions without simulating a real debugger. @example const study = capturedStudy() */
function capturedStudy(): StudyArchive & { instanceId: ReturnType<typeof randomUUID> } {
  const instanceId = randomUUID(), runId = randomUUID(), id = 'server-session:1';
  return { version: 1, workspaceKey, id: `${instanceId}_${runId}`, instanceId, runId, profile: 'paired-cart-demo', createdAt: '2026-09-18T10:00:00.000Z', savedAt: '2026-09-18T10:00:01.000Z', state: 'paused', terminal: false, finalOutcome: 'pending-teardown',
    observations: [{ id, snapshotUri: `codebook://${instanceId}/runs/${runId}/snapshots/${encodeURIComponent(id)}`, participant: 'server', capturedAt: '2026-09-18T10:00:01.000Z', elapsedMs: 1000,
      pause: { sessionId: 'server-session', threadId: 1, generation: 1 }, source: { text: source, hash: sourceHash, line: 1 }, values: { operationId: runId, cartId: 'selected', productId: 'tote-01', price: 24, cartCount: 0, admittedCount: 2 }, interpretations: [] }],
    captures: [{ phase: 'paused-server', status: 'captured', base64: Buffer.from('test-image-bytes').toString('base64'), hash: sha256('test-image-bytes') }], links: [] };
}

/** Makes explicit learner intents for library tests, never derived from execution success. @example decision(true) */
function decision(understood: boolean): LearnerDecision { return { id: randomUUID(), item: 'server', sourceHash, understood, at: '2026-09-18T10:00:00.000Z' }; }

test('capturing a successful observation never checks understanding and explicit choices survive a fresh library instance', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const library = new LearningLibrary(directory, workspaceKey), study = capturedStudy();
  // Act
  await library.saveStudy(study);
  const before = await library.readProgress(); await library.decide(decision(true));
  const restarted = new LearningLibrary(directory, workspaceKey), after = await restarted.readProgress();
  // Assert
  assert.equal(before.decisions.length, 0); assert.equal(learningState(after, 'server', sourceHash).understood, true);
  assert.equal((await restarted.readStudy(study.id)).observations[0]?.values.cartCount, 0);
  await assert.rejects(new LearningLibrary(directory, sha256('workspace-b')).readProgress(), /another workspace/);
  await assert.rejects(new LearningLibrary(directory, sha256('workspace-b')).readStudy(study.id), /different workspace/);
});

test('a changed source requires review without erasing an old check or treating history selection as the current revision', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const library = new LearningLibrary(directory, workspaceKey), study = capturedStudy(), progress = await library.decide(decision(true));
  const changed = { ...baselines, server: { ...baselines.server, text: 'const cartCount = 1;\n', hash: sha256('const cartCount = 1;\n') } };
  // Act
  const view = projectStudy({ selection: { studyId: study.id, participant: 'server', follow: false, tab: 'live' }, study, progress, baselines: changed });
  // Assert
  assert.equal(view.understoodCount, 0); assert.equal(view.reviewCount, 1); assert.equal(view.selectedUnderstanding.understood, true);
  assert.equal(view.sourceChanged, true); assert.equal(progress.decisions.length, 1); assert.equal(progress.decisions[0]?.sourceHash, sourceHash);
});

test('a historical server observation cannot continue a current browser pause even if its values remain readable', () => {
  // Arrange
  const study = capturedStudy(), server = study.observations[0]!;
  const live = { instanceId: study.instanceId, runId: study.runId, participants: {
    server: { snapshotUri: server.snapshotUri, sourceUri: undefined, phase: 'running', resumable: false, continueArguments: undefined },
    browser: { snapshotUri: 'codebook://new/browser', sourceUri: undefined, phase: 'paused', resumable: true, continueArguments: { instanceId: study.instanceId, runId: study.runId, participant: 'browser', sessionId: 'browser', threadId: 1, generation: 2 } },
  } } satisfies Pick<LiveStudy, 'instanceId' | 'runId' | 'participants'>;
  // Act
  const view = projectStudy({ selection: { studyId: study.id, participant: 'server', follow: false, tab: 'live' }, study, live, baselines });
  // Assert
  assert.equal(view.currentParticipant, 'browser'); assert.equal(view.observation?.values.productId, 'tote-01'); assert.equal(view.matching, false); assert.equal(view.continueArguments, undefined);
});

test('choosing an unobserved item clears old values and image instead of borrowing the previous observation', () => {
  // Arrange
  const study = capturedStudy();
  // Act
  const view = projectStudy({ selection: { studyId: study.id, participant: 'browser', follow: false, tab: 'live' }, study, baselines });
  // Assert
  assert.equal(view.observation, undefined); assert.equal(view.image, undefined); assert.equal(view.continueArguments, undefined);
});

test('queued learner choices and navigation retain both decisions and repeated intent does not double count', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const library = new LearningLibrary(directory, workspaceKey), checked = decision(true), unchecked = decision(false);
  // Act
  await Promise.all([library.decide(checked), library.select({ participant: 'browser', follow: false, tab: 'overview' }), library.decide(unchecked)]);
  const progress = await library.decide(unchecked);
  // Assert
  assert.equal(progress.decisions.length, 2); assert.equal(progress.selection?.participant, 'browser'); assert.equal(learningState(progress, 'server', sourceHash).understood, false);
  await assert.rejects(library.decide({ ...unchecked, understood: true }), /different decision/);
});

test('another writer or corrupt progress fails visibly without replacing persisted learner history', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const library = new LearningLibrary(directory, workspaceKey); await library.decide(decision(true));
  const path = join(directory, 'progress.json'), prior = await readFile(path, 'utf8'); await writeFile(join(directory, 'writer.lock'), 'another writer');
  // Act / Assert
  await assert.rejects(library.decide(decision(false)), /locked/); assert.equal(await readFile(path, 'utf8'), prior);
  await rm(join(directory, 'writer.lock')); await writeFile(path, '{broken');
  await assert.rejects(library.select({ participant: 'browser', follow: false, tab: 'overview' }));
  assert.equal(await readFile(path, 'utf8'), '{broken');
});

test('altered captured source or image cannot be read as the original historical observation', () => {
  // Arrange
  const changedSource = capturedStudy(), changedImage = capturedStudy();
  changedSource.observations[0]!.source.text = 'different source';
  changedImage.captures = [{ phase: 'paused-server', status: 'captured', base64: Buffer.from('other image').toString('base64'), hash: sha256('test-image-bytes') }];
  // Act / Assert
  assert.throws(() => validateStudy(changedSource, workspaceKey), /source.*changed/);
  assert.throws(() => validateStudy(changedImage, workspaceKey), /image.*changed/);
});

test('a later checkpoint cannot rewrite captured values or erase an existing observation', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const library = new LearningLibrary(directory, workspaceKey), study = capturedStudy(); await library.saveStudy(study);
  // Act / Assert
  await assert.rejects(library.saveStudy({ ...study, observations: [] }), /observation.*changed/);
  const changed = structuredClone(study); changed.observations[0]!.values.cartCount = 24;
  await assert.rejects(library.saveStudy(changed), /observation.*changed/);
  assert.equal((await library.readStudy(study.id)).observations[0]?.values.cartCount, 0);
});

test('a rejected atomic rename retains the old value and cleans its own incomplete temporary file', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'progress.json'); await writeFile(path, 'old value');
  const filesystem = await import('node:fs/promises');
  const writer = await loadModule<typeof import('../utils/atomicPrivateWrite')>(resolve(__dirname, '../utils/atomicPrivateWrite.js'), { 'node:fs/promises': { ...filesystem, rename: async () => { throw new Error('Injected rename failure'); } } });
  // Act / Assert
  await assert.rejects(writer.atomicPrivateWrite(path, { understood: true }, 1000), /rename failure/);
  assert.equal(await readFile(path, 'utf8'), 'old value'); assert.deepEqual(await readdir(directory), ['progress.json']);
});

test('a full library rejects the seventeenth study without losing history and still checkpoints an existing study', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const library = new LearningLibrary(directory, workspaceKey), studies = Array.from({ length: 16 }, () => capturedStudy());
  for (const study of studies) await library.saveStudy(study);
  const before = await Promise.all(studies.map(study => readFile(join(directory, `${study.id}.study.json`), 'utf8')));
  // Act
  await assert.rejects(library.saveStudy(capturedStudy()), /library is full/);
  const after = await Promise.all(studies.map(study => readFile(join(directory, `${study.id}.study.json`), 'utf8')));
  await library.saveStudy({ ...studies[0]!, savedAt: '2026-09-18T10:00:02.000Z', terminal: true });
  // Assert
  assert.deepEqual(after, before); assert.equal((await library.list()).length, 16);
  assert.equal((await library.readStudy(studies[0]!.id)).terminal, true);
  assert.equal((await readdir(directory)).includes('writer.lock'), false);
});

test('one thousand learner choices retain their bytes when new intent is rejected and identical retry still succeeds', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const library = new LearningLibrary(directory, workspaceKey), decisions = Array.from({ length: 1000 }, () => decision(true));
  const path = join(directory, 'progress.json'), before = JSON.stringify({ version: 1, workspaceKey, decisions }); await writeFile(path, before);
  // Act
  await assert.rejects(library.decide(decision(false)), /history is full/);
  const retried = await library.decide(decisions[999]!);
  // Assert
  assert.equal(retried.decisions.length, 1000); assert.equal(await readFile(path, 'utf8'), before);
  assert.equal((await readdir(directory)).includes('writer.lock'), false);
});

test('the exact UTF-8 byte limit is writable and an oversized replacement preserves the old document', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'progress.json');
  // Act
  await atomicPrivateWrite(path, 'あ', 5);
  await assert.rejects(atomicPrivateWrite(path, 'あい', 5), /Storage limit exceeded/);
  // Assert
  assert.equal(await readFile(path, 'utf8'), '"あ"'); assert.deepEqual(await readdir(directory), ['progress.json']);
});
