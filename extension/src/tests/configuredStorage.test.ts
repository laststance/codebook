import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { LearningLibrary } from '../learningLibrary';
import { studyArchiveSchema as legacyArchiveSchema } from '../legacyStudySchemas';
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite';
import { readBoundedFile } from '../utils/readBoundedFile';
import { decodeStudyArchive } from '../utils/decodeStudyArchive';
import { createConfiguredStudy } from './utils/createConfiguredStudy';
import { loadModule } from './utils/loadModule';

/** Gives storage tests private files and deterministic captured data without native runtime claims. @example const { library, study } = await storageHarness(context) */
async function storageHarness(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-configured-storage-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const study = createConfiguredStudy(), library = new LearningLibrary(directory, study.workspaceKey);
  return { directory, study, library, archivePath: join(directory, `${study.id}.study.v3.json`), metadataPath: join(directory, `${study.id}.study.meta.v3.json`) };
}

test('configured history survives restart beside untouched legacy and demo records without loading images for the catalog', async context => {
  // Arrange
  const { directory, study, library, archivePath } = await storageHarness(context);
  const legacy = legacyArchiveSchema.parse(JSON.parse(await readFile(resolve(__dirname, '../../src/tests/fixtures/cycle-0006-legacy/study.v1.json'), 'utf8')));
  legacy.workspaceKey = study.workspaceKey;
  const legacyBytes = JSON.stringify(legacy), legacyPath = join(directory, `${legacy.id}.study.json`);
  await writeFile(legacyPath, legacyBytes);
  await library.saveStudy(decodeStudyArchive(legacy, study.workspaceKey));
  await library.saveStudy(study); const configuredBytes = await readFile(archivePath);
  const module = await loadModule<typeof import('../learningLibrary')>(resolve(__dirname, '../learningLibrary.js'), {
    './utils/readBoundedFile': { readBoundedFile: async (...arguments_: Parameters<typeof readBoundedFile>) => {
      if (/\.study(?:\.v[23])?\.json$/.test(arguments_[0])) throw new Error('Catalog must not load image blobs.');
      return readBoundedFile(...arguments_);
    } },
  });
  // Act
  const catalog = await new module.LearningLibrary(directory, study.workspaceKey).list();
  const restored = await new LearningLibrary(directory, study.workspaceKey).readCheckpoint(study.id);
  // Assert
  assert.equal(catalog.length, 2);
  assert.equal(JSON.stringify(catalog.map(entry => [entry.format, entry.profile, entry.metadata]).sort()), '[["v2","paired-cart-demo","validated"],["v3","repository-browser","validated"]]');
  assert.equal(restored.status, 'saved'); assert.equal(restored.study.version, 3);
  assert.equal(restored.study.observations[0]?.values['value:enabled'], false);
  assert.deepEqual(await readFile(archivePath), configuredBytes); assert.equal(await readFile(legacyPath, 'utf8'), legacyBytes);
  assert.equal((await library.readProgress()).decisions.length, 0);
});

test('corrupt or future configured files remain authoritative over valid older files and cannot be repaired from them', async context => {
  // Arrange
  const { directory, study, library, archivePath } = await storageHarness(context);
  const legacy = legacyArchiveSchema.parse(JSON.parse(await readFile(resolve(__dirname, '../../src/tests/fixtures/cycle-0006-legacy/study.v1.json'), 'utf8')));
  const demo = { ...decodeStudyArchive(legacy, legacy.workspaceKey), workspaceKey: study.workspaceKey, id: study.id, instanceId: study.instanceId, runId: study.runId, observations: [], captures: [], links: [] };
  await library.saveStudy(demo); const olderPath = join(directory, `${study.id}.study.v2.json`), older = await readFile(olderPath);
  // Act / Assert
  await writeFile(archivePath, '{corrupt');
  await assert.rejects(library.readStudy(study.id)); await assert.rejects(library.reconcile());
  assert.equal((await library.list())[0]?.format, 'v3'); assert.equal((await library.list())[0]?.metadata, 'unavailable');
  await writeFile(archivePath, JSON.stringify({ ...study, version: 4 }));
  await assert.rejects(library.readStudy(study.id), /Version 3 archive has an incompatible schema/);
  await writeFile(archivePath, JSON.stringify({ ...study, version: 2 }));
  await assert.rejects(library.readStudy(study.id), /Version 3 archive has an incompatible schema/);
  assert.deepEqual(await readFile(olderPath), older);
});

test('interrupted configured metadata saving retains readable evidence and explicit retry repairs only its checkpoint', async context => {
  // Arrange
  const { directory, study, archivePath } = await storageHarness(context);
  let rejectMetadata = true;
  const module = await loadModule<typeof import('../learningLibrary')>(resolve(__dirname, '../learningLibrary.js'), {
    './utils/atomicPrivateWrite': { atomicPrivateWrite: async (...arguments_: Parameters<typeof atomicPrivateWrite>) => {
      if (rejectMetadata && arguments_[0].endsWith('.study.meta.v3.json')) throw new Error('Injected configured metadata failure');
      return atomicPrivateWrite(...arguments_);
    } },
  });
  const library = new module.LearningLibrary(directory, study.workspaceKey);
  // Act
  await assert.rejects(library.saveStudy(study), /configured metadata failure/);
  const before = await readFile(archivePath), incomplete = await library.readCheckpoint(study.id);
  assert.equal((await library.list())[0]?.outcome, 'unverified');
  rejectMetadata = false; await library.reconcile();
  const recovered = await new LearningLibrary(directory, study.workspaceKey).readCheckpoint(study.id);
  // Assert
  assert.equal(incomplete.status, 'failed'); assert.equal(incomplete.study.observations.length, 1);
  assert.equal(recovered.status, 'saved'); assert.equal((await library.list())[0]?.outcome, 'demonstrated');
  assert.deepEqual(await readFile(archivePath), before);
});

test('configured checkpoints advance from preparation through one observation and completion without rewriting accepted facts', async context => {
  // Arrange
  const { library, study } = await storageHarness(context);
  const preparing = { ...study, savedAt: study.createdAt, state: 'preparing', terminal: false, finalOutcome: 'pending-teardown' as const,
    descriptor: undefined, operation: undefined, observations: [], captures: [] };
  const ready = { ...preparing, savedAt: '2026-09-20T00:00:01.000Z', state: 'ready', descriptor: study.descriptor };
  const paused = { ...study, savedAt: '2026-09-20T00:00:04.000Z', state: 'paused-browser', terminal: false, finalOutcome: 'pending-teardown' as const,
    operation: { ...study.operation!, inputAcknowledged: false, continuedPause: undefined, afterVerified: false }, captures: study.captures.slice(0, 2) };
  // Act
  await library.saveStudy(preparing); await library.saveStudy(ready); await library.saveStudy(paused); await library.saveStudy(study);
  const interpreted = structuredClone(study);
  interpreted.savedAt = '2026-09-20T00:00:11.000Z';
  interpreted.observations[0]!.interpretations.push({ id: '55555555-5555-4555-8555-555555555555', text: 'The captured flag is false.', createdAt: '2026-09-20T00:00:11.000Z', facts: [{ path: 'value:enabled', value: false }] });
  await library.saveStudy(interpreted);
  const checkpoint = await library.readCheckpoint(study.id);
  // Assert
  assert.equal(checkpoint.status, 'saved'); assert.equal(checkpoint.study.finalOutcome, 'demonstrated');
  assert.equal(checkpoint.study.observations[0]?.interpretations.length, 2);
  await assert.rejects(library.saveStudy(study), /older checkpoint/);
  await assert.rejects(library.saveStudy({ ...interpreted, terminal: false, finalOutcome: 'pending-teardown' }), /older checkpoint/);
});

test('changed configured intent, citations, operation receipts and captured facts cannot replace valid retained history', async context => {
  // Arrange
  const { library, study, archivePath } = await storageHarness(context);
  await library.saveStudy(study); const before = await readFile(archivePath);
  const changedIntent = structuredClone(study); changedIntent.configuration.action.title = 'Different intent'; changedIntent.configurationHash = sha256(JSON.stringify(changedIntent.configuration));
  const changedDescriptor = structuredClone(study); changedDescriptor.descriptor!.anchors.reverse(); changedDescriptor.configuration.book.anchorIndex = 1; changedDescriptor.configurationHash = sha256(JSON.stringify(changedDescriptor.configuration));
  const changedOperation = structuredClone(study); changedOperation.operation!.key = 'another-operation';
  const changedReceipt = structuredClone(study); changedReceipt.finalOutcome = 'partial'; changedReceipt.operation!.afterVerified = false;
  const changedFacts = structuredClone(study); changedFacts.observations[0]!.values['value:nextTheme'] = 'light'; changedFacts.observations[0]!.interpretations[0]!.facts[0]!.value = 'light';
  // Act / Assert
  await assert.rejects(library.saveStudy(changedIntent), /intent changed after acceptance/);
  await assert.rejects(library.saveStudy(changedDescriptor), /intent changed after acceptance/);
  await assert.rejects(library.saveStudy(changedOperation), /operation identity/);
  await assert.rejects(library.saveStudy(changedReceipt), /confirmed receipts/);
  await assert.rejects(library.saveStudy(changedFacts), /Captured observation/);
  assert.deepEqual(await readFile(archivePath), before); assert.equal((await library.readCheckpoint(study.id)).status, 'saved');
});

test('configured copied source descriptors cannot change even when a new descriptor is internally consistent', async context => {
  // Arrange
  const { library, study, archivePath } = await storageHarness(context);
  await library.saveStudy(study); const before = await readFile(archivePath);
  const changed = structuredClone(study);
  // Ordered acquisition sources are sealed once; even an equivalent reorder cannot replace them later.
  changed.descriptor!.sources.reverse();
  // Act / Assert
  await assert.rejects(library.saveStudy(changed), /descriptor changed/);
  assert.deepEqual(await readFile(archivePath), before);
});

test('competing configured checkpoint writers preserve the winning interpretation instead of losing it', async context => {
  // Arrange
  const { library, directory, study } = await storageHarness(context); await library.saveStudy(study);
  const other = new LearningLibrary(directory, study.workspaceKey), first = structuredClone(study), second = structuredClone(study);
  first.observations[0]!.interpretations.push({ id: '55555555-5555-4555-8555-555555555555', text: 'First annotation.', createdAt: '2026-09-20T00:00:10.000Z', facts: [{ path: 'value:nextTheme', value: 'dark' }] });
  second.observations[0]!.interpretations.push({ id: '66666666-6666-4666-8666-666666666666', text: 'Second annotation.', createdAt: '2026-09-20T00:00:10.000Z', facts: [{ path: 'value:enabled', value: false }] });
  // Act
  const results = await Promise.allSettled([library.saveStudy(first), other.saveStudy(second)]);
  const checkpoint = await library.readCheckpoint(study.id);
  // Assert
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(checkpoint.study.observations[0]?.interpretations.length, 2); assert.equal(checkpoint.status, 'saved');
});

test('one shared retained-study limit counts configured and demo history while coalescing old filenames', async context => {
  // Arrange
  const { directory, study, library } = await storageHarness(context);
  const legacy = legacyArchiveSchema.parse(JSON.parse(await readFile(resolve(__dirname, '../../src/tests/fixtures/cycle-0006-legacy/study.v1.json'), 'utf8')));
  legacy.workspaceKey = study.workspaceKey;
  await writeFile(join(directory, `${legacy.id}.study.json`), JSON.stringify(legacy));
  await library.saveStudy(decodeStudyArchive(legacy, study.workspaceKey));
  for (let index = 0; index < 15; index++) {
    const configured = createConfiguredStudy(); configured.runId = randomUUID(); configured.id = `${configured.instanceId}_${configured.runId}`;
    configured.observations[0]!.snapshotUri = `codebook://${configured.instanceId}/runs/${configured.runId}/snapshots/browser-session%3A1`;
    await library.saveStudy(configured);
  }
  const files = (await readdir(directory)).sort();
  // Act / Assert
  await assert.rejects(library.saveStudy(study), /library is full/);
  assert.equal((await library.list()).length, 16); assert.deepEqual((await readdir(directory)).sort(), files);
  assert.equal((await library.readStudy(legacy.id)).profile, 'paired-cart-demo');
});

test('a mismatched configured checkpoint hash is repaired explicitly without replacing captured bytes', async context => {
  // Arrange
  const { library, study, archivePath, metadataPath } = await storageHarness(context);
  await library.saveStudy(study); const before = await readFile(archivePath);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')); metadata.archive.hash = '0'.repeat(64);
  await writeFile(metadataPath, JSON.stringify(metadata));
  // Act
  const invalid = await library.readCheckpoint(study.id); await library.reconcile(); const repaired = await library.readCheckpoint(study.id);
  // Assert
  assert.equal(invalid.status, 'failed'); assert.match(invalid.reason!, /differs from its catalog checkpoint/);
  assert.equal(repaired.status, 'saved'); assert.deepEqual(await readFile(archivePath), before);
});
