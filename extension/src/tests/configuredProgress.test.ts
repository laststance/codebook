import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LearningLibrary } from '../learningLibrary';
import { progressV3Schema } from '../learnerSchemas';
import { retainedStudySelectionSchema } from '../retainedStudySchemas';
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite';
import { citationLearningState } from '../utils/citationLearningState';
import { createConfiguredStudy } from './utils/createConfiguredStudy';
import { loadModule } from './utils/loadModule';

for (const version of [1, 2, 3, 4]) test(`retired version ${version} choices cannot block repository learning and their original bytes survive writes`, async context => {
  // Arrange
  const { directory, study, library, legacy, legacyPath } = await progressHarness(context);
  await rm(legacyPath);
  const historicalPath = join(directory, version === 1 ? 'progress.json' : `progress.v${version}.json`);
  const original = JSON.stringify({ version, workspaceKey: study.workspaceKey,
    decisions: [{ id: '66666666-6666-4666-8666-666666666666', item: 'retired/item', sourceHash: '1'.repeat(64), understood: true, at: '2026-09-19T00:00:00.000Z' },
      ...(version >= 3 ? legacy.decisions : [])],
    selection: { profile: 'retired', itemId: 'retired/item', follow: false, tab: 'overview' },
    ...(version >= 3 ? { repositorySelection: legacy.repositorySelection } : {}),
  }, null, 2);
  await writeFile(historicalPath, original);
  const choice = { ...legacy.decisions[1]!, id: '99999999-9999-4999-8999-999999999999', understood: false };
  // Act
  await library.decide(choice);
  await library.selectRepository({ bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 });
  const restored = await new LearningLibrary(directory, study.workspaceKey).readProgress();
  // Assert
  assert.deepEqual(restored.decisions, [...(version >= 3 ? legacy.decisions : []), choice]);
  assert.equal(restored.selection, undefined);
  assert.deepEqual(restored.repositorySelection, { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 });
  assert.equal(await readFile(historicalPath, 'utf8'), original);
  assert.equal((await readdir(directory)).includes('progress.repository.v4.json'), true);
});

test('invalid repository decisions and duplicate retired identities are not silently discarded during projection', async context => {
  // Arrange
  const { directory, library, study, legacy, legacyPath } = await progressHarness(context);
  const path = join(directory, 'progress.v4.json');
  const invalidDecisions = [
    [{ ...legacy.decisions[1], item: 'repository/invalid/extra/path' }],
    [{ ...legacy.decisions[1], context: { kind: 'source', fabricated: true } }],
    [legacy.decisions[1], { ...legacy.decisions[1], item: 'retired/item' }],
  ];
  // Act / Assert
  for (const decisions of invalidDecisions) {
    const original = JSON.stringify({ version: 4, workspaceKey: study.workspaceKey, decisions });
    await writeFile(path, original);
    await assert.rejects(library.readProgress());
    assert.equal(await readFile(path, 'utf8'), original);
  }
  assert.equal((await readdir(directory)).includes('progress.repository.v4.json'), false);
  assert.equal(JSON.parse(await readFile(legacyPath, 'utf8')).version, 3);
});

/** Freezes legacy source/citation decisions so progress tests can detect migration or selection rewriting them. @example const { legacy, selection } = await progressHarness(context) */
async function progressHarness(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-configured-progress-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const study = createConfiguredStudy(), library = new LearningLibrary(directory, study.workspaceKey);
  const legacy = progressV3Schema.parse({ version: 3, workspaceKey: study.workspaceKey, decisions: [
    { id: '77777777-7777-4777-8777-777777777777', item: 'repository/interface/theme', sourceHash: '1'.repeat(64), understood: false, at: '2026-09-19T00:00:00.000Z', context: { kind: 'source' } },
    { id: '88888888-8888-4888-8888-888888888888', item: 'repository/interface/theme', sourceHash: study.configuration.source.hash, understood: true, at: '2026-09-19T00:00:01.000Z', context: study.descriptor!.citationContext },
  ],
    repositorySelection: { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 1, location: { sectionIndex: 2, fraction: 0.375, focusId: 'observation-0' } } });
  const legacyBytes = JSON.stringify(legacy, null, 2), legacyPath = join(directory, 'progress.v3.json'), path = join(directory, 'progress.repository.v4.json');
  await writeFile(legacyPath, legacyBytes); await library.saveStudy(study);
  const selection = retainedStudySelectionSchema.parse({ studyId: study.id, profile: 'repository-browser', itemId: 'repository/interface/theme', follow: false, tab: 'live' });
  return { directory, study, library, legacy, legacyBytes, legacyPath, path, selection };
}

test('configured selection upgrades progress only on explicit write and preserves every old decision and exact Wiki return', async context => {
  // Arrange
  const { directory, study, library, legacy, legacyBytes, legacyPath, path, selection } = await progressHarness(context);
  // Act
  const read = await library.readProgress();
  assert.equal((await readdir(directory)).includes('progress.repository.v4.json'), false);
  await library.select(selection);
  const restarted = await new LearningLibrary(directory, study.workspaceKey).readProgress();
  // Assert
  assert.equal(read.version, 4); assert.deepEqual(read.decisions, legacy.decisions);
  assert.equal(restarted.version, 4); assert.deepEqual(restarted.decisions, legacy.decisions); assert.deepEqual(restarted.selection, selection);
  assert.deepEqual(restarted.repositorySelection, { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 1, location: { sectionIndex: 2, fraction: 0.375, focusId: 'observation-0' } });
  assert.equal(restarted.decisions[0]?.id, '77777777-7777-4777-8777-777777777777');
  assert.equal(restarted.decisions[1]?.at, '2026-09-19T00:00:01.000Z');
  assert.equal(citationLearningState(restarted, selection.itemId, study.descriptor!.anchors).understood, true);
  assert.equal(await readFile(legacyPath, 'utf8'), legacyBytes); assert.equal(JSON.parse(await readFile(path, 'utf8')).version, 4);
});

test('recording Return keeps the visible focused control position through restart without rewriting understanding', async context => {
  // Arrange
  const { directory, study, library, legacy } = await progressHarness(context);
  const article = { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 1,
    location: { sectionIndex: 2, fraction: 0.698, focusId: 'evidence-0-recording', focusViewportFraction: 0.0625 } };
  // Act
  await library.selectRepository(article);
  await library.rememberRepositoryReturn({ studyId: study.id, selection: article });
  const restarted = await new LearningLibrary(directory, study.workspaceKey).readProgress();
  // Assert
  assert.deepEqual(restarted.repositorySelection, { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 1,
    location: { sectionIndex: 2, fraction: 0.698, focusId: 'evidence-0-recording', focusViewportFraction: 0.0625 } });
  assert.deepEqual(restarted.repositoryReturn?.selection.location, { sectionIndex: 2, fraction: 0.698, focusId: 'evidence-0-recording', focusViewportFraction: 0.0625 });
  assert.deepEqual(restarted.decisions, legacy.decisions);
});

test('invalid focused control positions cannot overwrite the saved article or learner history', async context => {
  // Arrange
  const { library, path, legacy } = await progressHarness(context);
  await library.selectRepository(legacy.repositorySelection!);
  const before = await readFile(path, 'utf8');
  // Act / Assert
  for (const focusViewportFraction of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalid = { ...legacy.repositorySelection!, location: {
      sectionIndex: 2, fraction: 0.698, focusId: 'evidence-0-recording', focusViewportFraction,
    } };
    await assert.rejects(async () => library.selectRepository(invalid));
    assert.equal(await readFile(path, 'utf8'), before);
  }
});

test('a cancelled return receipt cannot erase another window\'s later article position and its own receipt can be cleared', async context => {
  // Arrange
  const { directory, study, library, legacy } = await progressHarness(context), other = new LearningLibrary(directory, study.workspaceKey);
  const cancelled = { studyId: study.id, selection: { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 } };
  const newer = { studyId: study.id, selection: { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 1, location: { sectionIndex: 2, fraction: 0.75, focusId: 'section-2' } } };
  await library.rememberRepositoryReturn(cancelled); await other.rememberRepositoryReturn(newer);
  // Act
  await library.rememberRepositoryReturn(undefined, cancelled);
  const preserved = await other.readProgress(); await library.rememberRepositoryReturn(undefined, newer);
  const cleared = await new LearningLibrary(directory, study.workspaceKey).readProgress();
  // Assert
  assert.equal(preserved.repositoryReturn?.selection.anchorIndex, 1);
  assert.deepEqual(preserved.repositoryReturn?.selection.location, { sectionIndex: 2, fraction: 0.75, focusId: 'section-2' });
  assert.equal(cleared.repositoryReturn, undefined); assert.deepEqual(cleared.decisions, legacy.decisions);
});

test('version 3 remains closed to configured selections and version 4 cannot persist arbitrary live authority', async context => {
  // Arrange
  const { legacy, selection } = await progressHarness(context);
  // Act / Assert
  assert.equal(progressV3Schema.safeParse({ ...legacy, selection }).success, false);
  assert.equal(retainedStudySelectionSchema.safeParse({ ...selection, studyId: undefined }).success, true);
  assert.equal(retainedStudySelectionSchema.safeParse({ ...selection, profile: 'unavailable-profile' }).success, false);
  assert.equal(retainedStudySelectionSchema.safeParse({ ...selection, itemId: 'invalid' }).success, false);
  assert.equal(retainedStudySelectionSchema.safeParse({ ...selection, continueArguments: { generation: 1 } }).success, false);
});

test('a configured selection cannot borrow another article identity and failed selection leaves prior progress untouched', async context => {
  // Arrange
  const { library, selection, legacyPath, legacyBytes, directory } = await progressHarness(context);
  // Act / Assert
  await assert.rejects(library.select({ ...selection, profile: 'repository-browser', studyId: selection.studyId!, itemId: 'repository/interface/other' }), /another retained learning item/);
  await assert.rejects(library.select({ ...selection, profile: 'repository-browser', studyId: '99999999-9999-4999-8999-999999999999_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', itemId: 'repository/interface/theme' }), /archive is unavailable/);
  assert.equal((await readdir(directory)).includes('progress.repository.v4.json'), false); assert.equal(await readFile(legacyPath, 'utf8'), legacyBytes);
});

test('corrupt, future or forged preferred version 4 progress cannot resurrect legacy choices', async context => {
  // Arrange
  const { library, legacy, legacyPath, legacyBytes, path, selection } = await progressHarness(context);
  const invalidValues = ['{corrupt', JSON.stringify({ ...legacy, version: 5 }), JSON.stringify({ ...legacy, version: 4, decisions: [...legacy.decisions, legacy.decisions[0]] }),
    JSON.stringify({ ...legacy, version: 4, decisions: [{ ...legacy.decisions[1], context: { ...legacy.decisions[1]!.context, key: '0'.repeat(64) } }] })];
  // Act / Assert
  for (const invalid of invalidValues) {
    await writeFile(path, invalid); await assert.rejects(library.readProgress()); await assert.rejects(library.select(selection));
    assert.equal(await readFile(path, 'utf8'), invalid);
  }
  assert.equal(await readFile(legacyPath, 'utf8'), legacyBytes);
});

test('an interrupted first version 4 decision preserves old choices and retry appends its original intent exactly once', async context => {
  // Arrange
  const { directory, study, legacy, legacyPath, legacyBytes, path } = await progressHarness(context);
  let rejectWrite = true;
  const module = await loadModule<typeof import('../learningLibrary')>(resolve(__dirname, '../learningLibrary.js'), {
    './utils/atomicPrivateWrite': { atomicPrivateWrite: async (...arguments_: Parameters<typeof atomicPrivateWrite>) => {
      if (rejectWrite && arguments_[0].endsWith('progress.repository.v4.json')) throw new Error('Injected version 4 write failure');
      return atomicPrivateWrite(...arguments_);
    } },
  });
  const library = new module.LearningLibrary(directory, study.workspaceKey), decision = { ...legacy.decisions[1]!, id: '99999999-9999-4999-8999-999999999999', understood: false, at: '2026-09-20T00:00:01.000Z' };
  // Act
  await assert.rejects(library.decide(decision), /version 4 write failure/); await assert.rejects(readFile(path), { code: 'ENOENT' });
  rejectWrite = false; await library.decide(decision); await library.decide(decision);
  const restarted = await new LearningLibrary(directory, study.workspaceKey).readProgress();
  // Assert
  assert.equal(restarted.decisions.length, 3); assert.deepEqual(restarted.decisions.slice(0, 2), legacy.decisions);
  assert.deepEqual(restarted.decisions[2], decision); assert.equal(await readFile(legacyPath, 'utf8'), legacyBytes);
});

test('a configured selection and concurrent explicit learner decision keep both updates during first migration', async context => {
  // Arrange
  const { directory, study, library, legacy, selection } = await progressHarness(context), other = new LearningLibrary(directory, study.workspaceKey);
  const decision = { ...legacy.decisions[1]!, id: '99999999-9999-4999-8999-999999999999', understood: false, at: '2026-09-20T00:00:01.000Z' };
  // Act
  await Promise.all([library.select(selection), other.decide(decision)]);
  const restarted = await new LearningLibrary(directory, study.workspaceKey).readProgress();
  // Assert
  assert.deepEqual(restarted.selection, selection); assert.equal(restarted.decisions.length, 3);
  assert.deepEqual(restarted.decisions[2], decision); assert.deepEqual(restarted.repositorySelection, legacy.repositorySelection);
});

test('later writes from an older build cannot replace the selected configured item or its complete citation history', async context => {
  // Arrange
  const { library, legacy, legacyPath, selection } = await progressHarness(context); await library.select(selection);
  // Act
  await writeFile(legacyPath, JSON.stringify({ ...legacy, decisions: [], selection: undefined, repositorySelection: undefined }));
  await library.selectRepository({ bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 });
  const progress = await library.readProgress();
  // Assert
  assert.deepEqual(progress.decisions, legacy.decisions); assert.deepEqual(progress.selection, selection);
  assert.equal(progress.repositorySelection?.anchorIndex, 0);
});

test('migrating a full learner ledger keeps all one thousand decisions while permitting configured navigation', async context => {
  // Arrange
  const { library, legacy, legacyPath, selection } = await progressHarness(context);
  const decisions = Array.from({ length: 1_000 }, (_, index) => ({ ...legacy.decisions[0]!, id: `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, '0')}` }));
  const bytes = JSON.stringify({ ...legacy, decisions }); await writeFile(legacyPath, bytes);
  // Act
  await library.select(selection); const progress = await library.readProgress();
  // Assert
  assert.equal(progress.decisions.length, 1_000); assert.deepEqual(progress.decisions, decisions);
  await assert.rejects(library.decide({ ...legacy.decisions[1]!, id: '99999999-9999-4999-8999-999999999999' }), /Understanding history is full/);
  assert.equal((await library.readProgress()).decisions.length, 1_000); assert.equal(await readFile(legacyPath, 'utf8'), bytes);
});
