import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LearningLibrary } from '../learningLibrary';
import { citationContext } from '../utils/citationContext';
import { citationLearningState } from '../utils/citationLearningState';
import { learningState } from '../studyModel';
import { loadModule } from './utils/loadModule';
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite';

const workspaceKey = '1'.repeat(64), sourceHash = '2'.repeat(64);
const primary = { path: 'src/main.ts', hash: sourceHash, startLine: 1, endLine: 8 };
const secondary = { path: 'src/store.ts', hash: '3'.repeat(64), startLine: 2, endLine: 12 };
const at = '2026-09-19T10:00:00.000Z';

test('article understanding survives prose and citation ordering but changed paths, ranges and citation sets need a new decision', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-context-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const library = new LearningLibrary(directory, workspaceKey), item = 'repository/architecture/storage';
  const intent = { id: randomUUID(), item, sourceHash, at, understood: true, context: citationContext([primary, secondary]) };
  // Act
  await library.decide(intent);
  const progress = await new LearningLibrary(directory, workspaceKey).readProgress();
  // Assert
  assert.equal(citationLearningState(progress, item, [secondary, primary, primary]).understood, true);
  for (const changed of [[primary], [primary, { ...secondary, hash: '4'.repeat(64) }], [primary, { ...secondary, endLine: 13 }], [primary, { ...secondary, path: 'src/renamed.ts' }]]) {
    assert.equal(citationLearningState(progress, item, changed).understood, false);
    assert.equal(citationLearningState(progress, item, changed).reviewNeeded, true);
  }
  assert.equal(progress.decisions.length, 1); assert.equal(progress.decisions[0]?.id, intent.id);
  assert.equal(citationLearningState(progress, 'repository/another-book/storage', [primary, secondary]).understood, false);
});

test('runtime primary-hash understanding never acknowledges additional article citations and article decisions do not check runtime', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-context-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const library = new LearningLibrary(directory, workspaceKey), item = 'checkout-demo/cart-mutation';
  await library.decide({ id: randomUUID(), item, sourceHash, understood: true, at });
  // Act / Assert
  const runtime = await library.readProgress();
  assert.equal(learningState(runtime, item, sourceHash).understood, true);
  assert.equal(citationLearningState(runtime, item, [primary, secondary]).understood, false);
  await library.decide({ id: randomUUID(), item, sourceHash, understood: false, at });
  const article = await library.decide({ id: randomUUID(), item, sourceHash, understood: true, at, context: citationContext([primary, secondary]) });
  assert.equal(learningState(article, item, sourceHash).understood, false);
  assert.equal(citationLearningState(article, item, [primary, secondary]).understood, true);
});

test('unchecking and identical intent retries affect only the original complete citation context', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-context-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const library = new LearningLibrary(directory, workspaceKey), item = 'repository/book/node';
  const first = { id: randomUUID(), item, sourceHash, at, understood: true, context: citationContext([primary, secondary]) };
  const other = { ...first, id: randomUUID(), context: citationContext([primary]) };
  await library.decide(first); await library.decide(other);
  const uncheck = { ...first, id: randomUUID(), understood: false };
  // Act
  await library.decide(uncheck); const retried = await library.decide(uncheck);
  // Assert
  assert.equal(retried.decisions.length, 3);
  assert.equal(citationLearningState(retried, item, [primary, secondary]).understood, false);
  assert.equal(citationLearningState(retried, item, [primary]).understood, true);
  await assert.rejects(library.decide({ ...uncheck, context: citationContext([primary]) }), /different decision/);
});

test('v3 migration preserves v2 bytes and exact legacy intent fields without merging later writes from older builds', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-context-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const oldDecision = { id: '11111111-1111-4111-8111-111111111111', item: 'checkout-demo/cart-mutation', sourceHash, understood: true, at };
  const legacy = JSON.stringify({ version: 2, workspaceKey, decisions: [oldDecision], selection: { profile: 'checkout-demo', itemId: 'checkout-demo/cart-mutation', follow: false, tab: 'live' } });
  await writeFile(join(directory, 'progress.v2.json'), legacy);
  const library = new LearningLibrary(directory, workspaceKey);
  // Act
  const read = await library.readProgress();
  assert.deepEqual((await readdir(directory)), ['progress.v2.json']);
  await library.selectRepository({ bookId: 'book', revision: 1, nodeId: 'node', anchorIndex: 0, location: { sectionIndex: 0, fraction: 0.5, focusId: 'observation-0' } });
  assert.equal(await readFile(join(directory, 'progress.v2.json'), 'utf8'), legacy);
  await writeFile(join(directory, 'progress.v2.json'), '{older build now corrupt}');
  const restarted = await new LearningLibrary(directory, workspaceKey).readProgress();
  // Assert
  assert.equal(read.version, 3); assert.deepEqual(read.decisions, [{ ...oldDecision, context: { kind: 'source' } }]);
  assert.deepEqual(restarted.decisions, read.decisions); assert.deepEqual(restarted.selection, read.selection);
  assert.equal(restarted.repositorySelection?.location?.fraction, 0.5);
});

test('corrupt, unknown or untyped v3 progress never falls back to readable v2 choices', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-context-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const legacy = { version: 2, workspaceKey, decisions: [{ id: randomUUID(), item: 'checkout-demo/cart-mutation', sourceHash, understood: true, at }] };
  await writeFile(join(directory, 'progress.v2.json'), JSON.stringify(legacy));
  const library = new LearningLibrary(directory, workspaceKey);
  // Act / Assert
  for (const invalid of ['{broken', JSON.stringify({ ...legacy, version: 4 }), JSON.stringify({ ...legacy, version: 3 })]) {
    await writeFile(join(directory, 'progress.v3.json'), invalid);
    await assert.rejects(library.readProgress());
    await assert.rejects(library.selectRepository({ bookId: 'book', revision: 1, nodeId: 'node', anchorIndex: 0 }));
    assert.equal(await readFile(join(directory, 'progress.v3.json'), 'utf8'), invalid);
  }
  assert.equal(await readFile(join(directory, 'progress.v2.json'), 'utf8'), JSON.stringify(legacy));
});

test('failed first v3 publication leaves legacy choices intact and explicit retry appends the same intent once', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-context-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const legacy = JSON.stringify({ version: 2, workspaceKey, decisions: [] }); await writeFile(join(directory, 'progress.v2.json'), legacy);
  let fail = true;
  const module = await loadModule<typeof import('../learningLibrary')>(resolve(__dirname, '../learningLibrary.js'), {
    './utils/atomicPrivateWrite': { atomicPrivateWrite: async (...arguments_: Parameters<typeof atomicPrivateWrite>) => { if (fail) throw new Error('Injected v3 write failure'); return atomicPrivateWrite(...arguments_); } },
  });
  const library = new module.LearningLibrary(directory, workspaceKey), intent = { id: randomUUID(), item: 'repository/book/node', sourceHash, at, understood: true, context: citationContext([primary]) };
  // Act / Assert
  await assert.rejects(library.decide(intent), /v3 write failure/);
  assert.deepEqual(await readdir(directory), ['progress.v2.json']); assert.equal(await readFile(join(directory, 'progress.v2.json'), 'utf8'), legacy);
  fail = false; await library.decide(intent); const retried = await library.decide(intent);
  assert.equal(retried.decisions.length, 1); assert.equal(retried.decisions[0]?.id, intent.id);
});
