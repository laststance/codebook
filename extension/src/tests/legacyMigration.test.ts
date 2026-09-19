import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { studyArchiveSchema as legacyArchiveSchema, progressSchema as legacyProgressSchema } from '../legacyStudySchemas';
import { decodeStudyArchive } from '../utils/decodeStudyArchive';
import { decodeLearnerProgress } from '../utils/decodeLearnerProgress';
import { LearningLibrary } from '../learningLibrary';
import { loadModule } from './utils/loadModule';
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite';
import { readBoundedFile } from '../utils/readBoundedFile';

const fixtureDirectory = resolve(__dirname, '../../src/tests/fixtures/cycle-0006-legacy');
const workspaceKey = '67bf38abd3f309bf29b1eed73e4f3ea88863995c0f207b70a50eec48d36f8743';

test('a real Cycle 0006 archive gains paired item identities without changing its captured bytes or original file', async () => {
  // Arrange
  const path = resolve(fixtureDirectory, 'study.v1.json'), bytes = await readFile(path);
  const original = legacyArchiveSchema.parse(JSON.parse(bytes.toString())), before = JSON.stringify(original);
  // Act
  const study = decodeStudyArchive(original, workspaceKey);
  // Assert
  assert.equal(sha256(bytes), '46da21735d8e86a0b6a3cfd05ad9437142360b0530f2996502737621570c7c57');
  assert.equal(study.version, 2); assert.equal(study.profile, 'paired-cart-demo');
  assert.deepEqual(study.observations.map(observation => observation.itemId), ['paired-cart-demo/server', 'paired-cart-demo/browser']);
  assert.deepEqual(study.observations.map(observation => observation.capturePhase), ['paused-server', 'paused-browser']);
  assert.equal(study.observations[0]?.values.productId, 'tote-01'); assert.equal(study.observations[0]?.values.cartCount, 0);
  assert.equal(study.observations[1]?.values.cartCount, 1);
  assert.deepEqual(study.captures, original.captures); assert.deepEqual(study.observations.map(observation => observation.source), original.observations.map(observation => observation.source));
  assert.equal(JSON.stringify(original), before); assert.deepEqual(await readFile(path), bytes);
});

test('legacy understanding stays in the paired profile and preserves the exact decision identity and source revision', async () => {
  // Arrange
  const path = resolve(fixtureDirectory, 'progress.v1.json'), bytes = await readFile(path);
  const original = legacyProgressSchema.parse(JSON.parse(bytes.toString())), before = JSON.stringify(original);
  // Act
  const progress = decodeLearnerProgress(original, workspaceKey);
  // Assert
  assert.equal(sha256(bytes), '4cd64d619cb165a2e6d4b68a4f5be32c21ea50cb06df4d89f9633dde3a81038b');
  assert.equal(progress.version, 4);
  assert.deepEqual(progress.decisions, [{ id: '2873e41e-7878-422e-af27-da5f40334558', sourceHash: 'd31e34bc5c3745317afabd5721819d959de090497e58cfd49df759134d59d8f2', understood: true, at: '2026-09-18T20:56:35.947Z', item: 'paired-cart-demo/server', context: { kind: 'source' } }]);
  assert.equal(progress.selection?.profile, 'paired-cart-demo'); assert.equal(progress.selection?.itemId, 'paired-cart-demo/server'); assert.equal(progress.selection?.follow, false);
  assert.equal(progress.decisions.some(decision => decision.item.startsWith('checkout-demo/')), false);
  assert.equal(JSON.stringify(original), before); assert.deepEqual(await readFile(path), bytes);
});

test('version 1 remains a strict historical format and cannot smuggle new profile identities or facts into migration', async () => {
  // Arrange
  const study = legacyArchiveSchema.parse(JSON.parse(await readFile(resolve(fixtureDirectory, 'study.v1.json'), 'utf8')));
  const progress = legacyProgressSchema.parse(JSON.parse(await readFile(resolve(fixtureDirectory, 'progress.v1.json'), 'utf8')));
  // Act / Assert
  assert.throws(() => decodeStudyArchive({ ...study, profile: 'checkout-demo' }, workspaceKey));
  assert.throws(() => decodeStudyArchive({ ...study, observations: study.observations.map(observation => ({ ...observation, itemId: 'checkout-demo/order-creation' })) }, workspaceKey));
  assert.throws(() => decodeStudyArchive({ ...study, observations: study.observations.map(observation => ({ ...observation, values: { ...observation.values, orderCount: 1 } })) }, workspaceKey));
  assert.throws(() => decodeLearnerProgress({ ...progress, decisions: progress.decisions.map(decision => ({ ...decision, item: 'checkout-demo/order-creation' })) }, workspaceKey));
  assert.throws(() => decodeLearnerProgress({ ...progress, version: 3 }, workspaceKey));
});

test('normalized history rejects duplicate items, cross-profile labels, altered source and unsupported interpretation facts', async () => {
  // Arrange
  const study = decodeStudyArchive(JSON.parse(await readFile(resolve(fixtureDirectory, 'study.v1.json'), 'utf8')), workspaceKey);
  const first = study.observations[0]!;
  // Act / Assert
  assert.throws(() => decodeStudyArchive({ ...study, observations: [first, first] }, workspaceKey), /duplicate observation/);
  assert.throws(() => decodeStudyArchive({ ...study, observations: [{ ...first, itemId: 'checkout-demo/cart-mutation' }] }, workspaceKey), /learning item/);
  assert.throws(() => decodeStudyArchive({ ...study, observations: [{ ...first, source: { ...first.source, text: 'changed' } }] }, workspaceKey), /source.*changed/);
  assert.throws(() => decodeStudyArchive({ ...study, observations: [{ ...first, interpretations: [{ id: '11111111-1111-4111-8111-111111111111', createdAt: '2026-09-18T20:56:35.947Z', text: 'Invalid claim', facts: [{ path: 'orderCount', value: 1 }] }] }] }, workspaceKey), /facts differ/);
  assert.throws(() => decodeStudyArchive({ ...study, captures: [{ phase: 'paused-order-creation', status: 'absent', reason: 'Wrong item' }] }, workspaceKey), /foreign image/);
  assert.throws(() => decodeStudyArchive({ ...study, links: [{ id: 'checkout-server-mutation', status: 'observed' }] }, workspaceKey), /foreign causal link/);
});

test('reading legacy files leaves their bytes untouched and labels unread catalog outcomes as unverified', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-migration-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = await readFile(resolve(fixtureDirectory, 'study.v1.json')), study = decodeStudyArchive(JSON.parse(bytes.toString()), workspaceKey);
  const progress = await readFile(resolve(fixtureDirectory, 'progress.v1.json'));
  await writeFile(join(directory, `${study.id}.study.json`), bytes); await writeFile(join(directory, 'progress.json'), progress);
  const library = new LearningLibrary(directory, workspaceKey);
  // Act
  const catalog = await library.list(), loaded = await library.readStudy(study.id), choices = await library.readProgress();
  // Assert
  assert.equal(catalog[0]?.format, 'legacy-v1'); assert.equal(catalog[0]?.outcome, 'unverified');
  assert.equal(loaded.observations.length, 2); assert.equal(choices.decisions[0]?.item, 'paired-cart-demo/server');
  assert.deepEqual((await readdir(directory)).sort(), [`${study.id}.study.json`, 'progress.json'].sort());
  assert.deepEqual(await readFile(join(directory, `${study.id}.study.json`)), bytes); assert.deepEqual(await readFile(join(directory, 'progress.json')), progress);
});

test('two first-migration writers in one host preserve both explicit decisions exactly once without user retry', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-migration-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const legacy = await readFile(resolve(fixtureDirectory, 'progress.v1.json')); await writeFile(join(directory, 'progress.json'), legacy);
  const first = new LearningLibrary(directory, workspaceKey), second = new LearningLibrary(directory, workspaceKey);
  await Promise.all([first.readProgress(), second.readProgress()]);
  const firstDecision = { id: randomUUID(), item: 'checkout-demo/cart-mutation' as const, sourceHash: sha256('cart-source'), understood: true, at: '2026-09-19T00:00:00.000Z' };
  const secondDecision = { id: randomUUID(), item: 'checkout-demo/order-creation' as const, sourceHash: sha256('order-source'), understood: true, at: '2026-09-19T00:00:01.000Z' };
  let release = () => {}, entered = () => {};
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const read = first.readProgress.bind(first);
  first.readProgress = async () => { const value = await read(); entered(); await held; return value; };
  // Act
  const writing = first.decide(firstDecision); await started;
  const queued = second.decide(secondDecision); release();
  await Promise.all([writing, queued]); await second.decide(secondDecision);
  const progress = await new LearningLibrary(directory, workspaceKey).readProgress();
  // Assert
  assert.equal(progress.decisions.length, 3);
  assert.deepEqual(progress.decisions.map(decision => decision.id), ['2873e41e-7878-422e-af27-da5f40334558', firstDecision.id, secondDecision.id]);
  assert.equal(progress.decisions[0]?.item, 'paired-cart-demo/server'); assert.equal(progress.decisions[2]?.item, 'checkout-demo/order-creation');
  assert.deepEqual(await readFile(join(directory, 'progress.json')), legacy);
  assert.equal(JSON.parse(await readFile(join(directory, 'progress.v4.json'), 'utf8')).version, 4);
});

test('a corrupt preferred v2 file never falls back to a valid legacy archive or progress', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-migration-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const archive = await readFile(resolve(fixtureDirectory, 'study.v1.json')), progress = await readFile(resolve(fixtureDirectory, 'progress.v1.json'));
  const study = decodeStudyArchive(JSON.parse(archive.toString()), workspaceKey), library = new LearningLibrary(directory, workspaceKey);
  await writeFile(join(directory, `${study.id}.study.json`), archive); await writeFile(join(directory, 'progress.json'), progress);
  await library.saveStudy(study);
  await writeFile(join(directory, 'progress.v2.json'), '{corrupt'); await writeFile(join(directory, `${study.id}.study.v2.json`), '{corrupt');
  // Act / Assert
  await assert.rejects(library.readProgress()); await assert.rejects(library.readStudy(study.id));
  await assert.rejects(library.select({ profile: 'checkout-demo', itemId: 'checkout-demo/order-creation', follow: false, tab: 'live' }));
  assert.equal((await library.list())[0]?.metadata, 'unavailable');
  await assert.rejects(library.reconcile());
  assert.deepEqual(await readFile(join(directory, 'progress.json')), progress); assert.deepEqual(await readFile(join(directory, `${study.id}.study.json`)), archive);
  assert.equal(await readFile(join(directory, 'progress.v2.json'), 'utf8'), '{corrupt');
});

test('a failed metadata write retains the archive and explicit reconciliation repairs catalog status without changing evidence', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-migration-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const study = decodeStudyArchive(JSON.parse(await readFile(resolve(fixtureDirectory, 'study.v1.json'), 'utf8')), workspaceKey);
  let rejectMetadata = true, rejectArchiveRead = false;
  const module = await loadModule<typeof import('../learningLibrary')>(resolve(__dirname, '../learningLibrary.js'), {
    './utils/atomicPrivateWrite': { atomicPrivateWrite: async (...args: Parameters<typeof atomicPrivateWrite>) => { if (rejectMetadata && args[0].endsWith('.study.meta.v2.json')) throw new Error('Injected catalog write denied'); return atomicPrivateWrite(...args); } },
    './utils/readBoundedFile': { readBoundedFile: async (...args: Parameters<typeof readBoundedFile>) => { if (rejectArchiveRead && args[0].endsWith('.study.v2.json')) throw new Error('Catalog loaded archive image blobs'); return readBoundedFile(...args); } },
  });
  const library = new module.LearningLibrary(directory, workspaceKey);
  // Act
  await assert.rejects(library.saveStudy(study), /catalog write denied/);
  const bytes = await readFile(join(directory, `${study.id}.study.v2.json`));
  assert.equal((await library.list())[0]?.outcome, 'unverified');
  assert.equal((await library.readCheckpoint(study.id)).status, 'failed');
  rejectMetadata = false; await library.reconcile(); rejectArchiveRead = true;
  const catalog = await library.list();
  // Assert
  assert.equal(catalog[0]?.metadata, 'validated'); assert.equal(catalog[0]?.outcome, 'partial');
  assert.equal(catalog[0]?.profile, 'paired-cart-demo');
  assert.deepEqual(await readFile(join(directory, `${study.id}.study.v2.json`)), bytes);
});

test('a mismatched checkpoint hash cannot certify readable history and explicit Retry repairs it without changing archive bytes', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-migration-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const library = new LearningLibrary(directory, workspaceKey), study = decodeStudyArchive(JSON.parse(await readFile(resolve(fixtureDirectory, 'study.v1.json'), 'utf8')), workspaceKey);
  await library.saveStudy(study);
  const archivePath = join(directory, `${study.id}.study.v2.json`), bytes = await readFile(archivePath), metadataPath = join(directory, `${study.id}.study.meta.v2.json`);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')); metadata.archive.hash = '0'.repeat(64);
  await writeFile(metadataPath, JSON.stringify(metadata));
  // Act
  const rejected = await library.readCheckpoint(study.id);
  await library.reconcile(); const recovered = await library.readCheckpoint(study.id);
  // Assert
  assert.equal(rejected.status, 'failed'); assert.match(rejected.reason!, /differs from its catalog checkpoint/);
  assert.equal(recovered.status, 'saved'); assert.deepEqual(await readFile(archivePath), bytes);
});
