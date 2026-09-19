import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import filesystem, { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { repositoryHarness } from './utils/repositoryHarness';
import { LearningLibrary } from '../learningLibrary';
import { RepositoryBookStore } from '../repositoryBook';
import { RepositorySourceService } from '../repositorySource';
import { type BookDocument, type BookPublishIntent } from '../repositorySchemas';
import { decodeStudyArchive } from '../utils/decodeStudyArchive';
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite';
import { loadModule } from './utils/loadModule';

const workspaceKey = '1'.repeat(64), sourceHash = '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b';

/** Builds real tracked source and independent shared storage for book publication regressions. @example const { books, intent } = await bookHarness(context) */
async function bookHarness(context: TestContext) {
  const source = await repositoryHarness(context); await source.track('src/cart.ts');
  const library = new LearningLibrary(join(source.directory, '.learning'), workspaceKey), books = new RepositoryBookStore(source.sources, library);
  context.after(() => books.dispose());
  const document: BookDocument = { title: 'Cart architecture', summary: 'Source-derived cart state.', nodes: [{ id: 'cart', title: 'Cart', sections: [{ title: 'Price', text: 'The module exports price 24.' }], anchors: [{ path: 'src/cart.ts', hash: sourceHash, startLine: 1, endLine: 2 }], observations: [] }], edges: [] };
  const intent: BookPublishIntent = { bookId: 'architecture', key: 'first', expectedRevision: 0, document };
  return { ...source, library, books, intent, path: join(library.directory, 'architecture.book.v1.json') };
}

/** Reuses captured legacy facts to test exact checkpoint links, without claiming a new native run. @example const study = await linkCheckpoint(harness) */
async function linkCheckpoint(harness: Awaited<ReturnType<typeof bookHarness>>) {
  const value: unknown = JSON.parse(await readFile(resolve(__dirname, '../../src/tests/fixtures/cycle-0006-legacy/study.v1.json'), 'utf8'));
  const study = { ...decodeStudyArchive(value, '67bf38abd3f309bf29b1eed73e4f3ea88863995c0f207b70a50eec48d36f8743'), workspaceKey };
  await harness.library.saveStudy(study);
  const observation = study.observations[0]!;
  await harness.track('src/cart.ts', observation.source.text);
  harness.intent.document.nodes[0]!.anchors = [{ path: 'src/cart.ts', hash: observation.source.hash, startLine: 1, endLine: 2 }];
  harness.intent.document.nodes[0]!.observations = [{ studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash }];
  harness.intent.document.nodes[0]!.learningItemId = observation.itemId;
  return study;
}

test('whole book publication retains immutable source revisions without navigation or learner decisions', async context => {
  // Arrange
  const { books, sources, library, intent, directory } = await bookHarness(context);
  // Act
  const first = await books.publish(intent);
  const second = await books.publish({ ...intent, key: 'second', expectedRevision: 1, document: { ...intent.document, title: 'Clearer title' } });
  await writeFile(join(directory, 'src/cart.ts'), 'export const price = 30;\n');
  const historical = await books.read('architecture', 1), states = await sources.inspect(historical.revision.sources);
  // Assert
  assert.equal(first.revision, 1); assert.equal(second.revision, 2); assert.equal(historical.latestRevision, 2);
  assert.equal(historical.revision.document.title, 'Cart architecture'); assert.equal(historical.revision.sources[0]?.text, 'export const price = 24;\n');
  assert.equal(states[0]?.status, 'changed'); assert.equal((await library.readProgress()).decisions.length, 0);
  assert.equal((await library.readProgress()).repositorySelection, undefined);
});

test('lost publication responses recover the original receipt after source edits and deletion without another revision', async context => {
  // Arrange
  const { books, intent, directory, path, sources, library } = await bookHarness(context);
  const first = await books.publish(intent), before = await readFile(path);
  // Act / Assert
  await writeFile(join(directory, 'src/cart.ts'), 'changed after successful commit');
  assert.deepEqual(await books.publish(intent), first);
  await rm(join(directory, 'src/cart.ts'));
  assert.deepEqual(await new RepositoryBookStore(sources, library).publish(intent), first);
  await assert.rejects(books.publish({ ...intent, document: { ...intent.document, title: 'Changed intent' } }), /already names different input/);
  assert.deepEqual(await readFile(path), before); assert.equal((await books.list())[0]?.revision, 1);
});

test('same-key recovery survives unavailable checkpoints while public reads label the exact linked destination unavailable', async context => {
  // Arrange
  const harness = await bookHarness(context), study = await linkCheckpoint(harness);
  const first = await harness.books.publish(harness.intent);
  const verified = await harness.books.read('architecture', 1);
  // Act
  await writeFile(join(harness.library.directory, `${study.id}.study.meta.v2.json`), '{corrupt');
  const repeated = await harness.books.publish(harness.intent), unavailable = await harness.books.read('architecture', 1);
  // Assert
  assert.equal(verified.links[0]?.status, 'available'); assert.equal(verified.links[0]?.outcome, 'partial');
  assert.deepEqual(repeated, first); assert.equal(unavailable.links[0]?.status, 'unavailable');
  assert.equal(unavailable.revision.document.title, 'Cart architecture'); assert.equal(unavailable.latestRevision, 1);
});

test('slow source preparation lets another learner writer finish before publication enters the shared queue', async context => {
  // Arrange
  const { books, intent, sources, library } = await bookHarness(context);
  let enter = () => {}, release = () => {};
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const prepare = sources.prepare.bind(sources);
  sources.prepare = async (...arguments_: Parameters<typeof prepare>) => { const value = await prepare(...arguments_); enter(); await held; return value; };
  // Act
  const publishing = books.publish(intent); await entered;
  const progress = await library.decide({ id: randomUUID(), item: 'checkout-demo/cart-mutation', sourceHash, understood: true, at: '2026-09-19T10:00:00.000Z' });
  release(); const receipt = await publishing;
  // Assert
  assert.equal(progress.decisions.length, 1); assert.equal(receipt.revision, 1); assert.equal((await library.readProgress()).decisions.length, 1);
});

test('simultaneous same-key publishers recover one receipt and different keys cannot overwrite the same expected revision', async context => {
  // Arrange
  const { books, sources, library, intent, path } = await bookHarness(context);
  const other = new RepositoryBookStore(sources, library); context.after(() => other.dispose());
  // Act
  const same = await Promise.all([books.publish(intent), other.publish(intent)]);
  const competing = await Promise.allSettled([books.publish({ ...intent, key: 'next-a', expectedRevision: 1 }), other.publish({ ...intent, key: 'next-b', expectedRevision: 1 })]);
  // Assert
  assert.deepEqual(same[0], same[1]); assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(competing.filter(result => result.status === 'rejected').length, 1); assert.equal(JSON.parse(await readFile(path, 'utf8')).revisions.length, 2);
});

test('invalid ranges, stale hashes and mismatched observation references preserve the previous entire book', async context => {
  // Arrange
  const { books, intent, path } = await bookHarness(context); await books.publish(intent); const before = await readFile(path);
  const node = intent.document.nodes[0]!;
  // Act / Assert
  for (const changed of [{ ...node, anchors: [{ ...node.anchors[0]!, endLine: 3 }] }, { ...node, anchors: [{ ...node.anchors[0]!, hash: '0'.repeat(64) }] }, { ...node, observations: [{ studyId: `${randomUUID()}_${randomUUID()}`, observationId: 'absent', sourceHash }] }]) {
    await assert.rejects(books.publish({ ...intent, key: 'invalid', expectedRevision: 1, document: { ...intent.document, nodes: [changed] } }));
    assert.deepEqual(await readFile(path), before);
  }
});

test('source edits after hash revalidation but before final commit retain the old revision', async context => {
  // Arrange
  const { books, intent, path, sources, directory } = await bookHarness(context); await books.publish(intent); const before = await readFile(path);
  const prepare = sources.prepare.bind(sources);
  sources.prepare = async (...arguments_: Parameters<typeof prepare>) => {
    const prepared = await prepare(...arguments_), revalidate = prepared.revalidate;
    return { ...prepared, revalidate: async () => { const checks = await revalidate(); await writeFile(join(directory, 'src/cart.ts'), 'edited during final link checks'); return checks; } };
  };
  // Act / Assert
  await assert.rejects(books.publish({ ...intent, key: 'next', expectedRevision: 1 }), /changed before commit/);
  assert.deepEqual(await readFile(path), before);
});

test('a cancelled or expired preparation never starts an atomic write or publishes a late revision', async context => {
  // Arrange
  const { directory, library, intent } = await bookHarness(context);
  let now = Date.now();
  const sources = new RepositorySourceService(directory, () => now), books = new RepositoryBookStore(sources, library, () => now); context.after(() => books.dispose());
  const prepare = sources.prepare.bind(sources), controller = new AbortController();
  sources.prepare = async (...arguments_: Parameters<typeof prepare>) => { const prepared = await prepare(...arguments_); controller.abort(); now += 20_000; return prepared; };
  // Act / Assert
  await assert.rejects(books.publish(intent, controller.signal), /expired or was cancelled/);
  assert.equal((await books.list()).length, 0);
  assert.equal((await readdir(library.directory)).includes('writer.lock'), false);
});

test('a failed atomic rename preserves prior book bytes and removes only its incomplete temporary file', async context => {
  // Arrange
  const { books, intent, path, library } = await bookHarness(context); await books.publish(intent); const before = await readFile(path);
  context.mock.method(filesystem, 'rename', async () => { throw new Error('Injected book rename failure'); });
  // Act / Assert
  await assert.rejects(books.publish({ ...intent, key: 'next', expectedRevision: 1 }), /rename failure/);
  assert.deepEqual(await readFile(path), before); assert.deepEqual(await readdir(library.directory), ['architecture.book.v1.json']);
});

test('retirement and transport cancellation drain an in-flight successful atomic writer before releasing its lock', async context => {
  // Arrange
  const { sources, library, intent, path } = await bookHarness(context);
  let enter = () => {}, release = () => {}, retired = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const module = await loadModule<typeof import('../repositoryBook')>(resolve(__dirname, '../repositoryBook.js'), {
    './utils/atomicPrivateWrite': { atomicPrivateWrite: async (...arguments_: Parameters<typeof atomicPrivateWrite>) => { await atomicPrivateWrite(...arguments_); enter(); await held; } },
  });
  const books = new module.RepositoryBookStore(sources, library), controller = new AbortController();
  // Act
  const pending = books.publish(intent, controller.signal); await entered; controller.abort();
  const disposal = books.dispose().then(() => { retired = true; });
  assert.equal(retired, false); assert.ok((await readdir(library.directory)).includes('writer.lock')); assert.equal(JSON.parse(await readFile(path, 'utf8')).revisions.length, 1);
  release(); const receipt = await pending; await disposal;
  // Assert
  assert.equal(retired, true); assert.equal((await readdir(library.directory)).includes('writer.lock'), false);
  assert.equal(JSON.stringify(await new RepositoryBookStore(sources, library).publish(intent)), JSON.stringify(receipt));
});

test('corrupt or future book formats never fall back to older revisions and other valid books remain listed', async context => {
  // Arrange
  const { books, intent, path } = await bookHarness(context); await books.publish(intent);
  await books.publish({ ...intent, bookId: 'another' });
  const stored = JSON.parse(await readFile(path, 'utf8'));
  // Act / Assert
  for (const invalid of ['{corrupt', JSON.stringify({ ...stored, version: 2 }), JSON.stringify({ ...stored, revisions: stored.revisions.map((revision: object) => ({ ...revision, hash: '0'.repeat(64) })) })]) {
    await writeFile(path, invalid);
    await assert.rejects(books.read('architecture', 1), /no older revision was substituted/);
    await assert.rejects(books.publish({ ...intent, key: 'next', expectedRevision: 1 }));
    const catalog = await books.list(); assert.equal(catalog.find(entry => entry.bookId === 'another')?.status, 'available'); assert.equal(catalog.find(entry => entry.bookId === 'architecture')?.status, 'unavailable');
    assert.equal(await readFile(path, 'utf8'), invalid);
  }
});

test('partial linked observations remain exact and later article revisions cannot rebind a retained learning identity', async context => {
  // Arrange
  const harness = await bookHarness(context), study = await linkCheckpoint(harness); await harness.books.publish(harness.intent);
  const before = await readFile(harness.path), node = harness.intent.document.nodes[0]!;
  // Act / Assert
  const linked = await harness.books.read('architecture', 1);
  assert.equal(linked.links[0]?.studyId, study.id); assert.equal(linked.links[0]?.outcome, 'partial'); assert.equal(linked.links[0]?.itemId, 'paired-cart-demo/server');
  const { learningItemId: _identity, ...withoutAlias } = node;
  await assert.rejects(harness.books.publish({ ...harness.intent, key: 'changed-alias', expectedRevision: 1, document: { ...harness.intent.document, nodes: [withoutAlias] } }), { code: 'BOOK_CONFLICT', message: 'Learning identity changed for cart. Keep its original learningItemId or omit it as in the retained revision.' });
  assert.deepEqual(await readFile(harness.path), before);
});

test('a changed captured fact cannot become a valid book destination even after its archive sidecar is repaired', async context => {
  // Arrange
  const harness = await bookHarness(context), study = await linkCheckpoint(harness); await harness.books.publish(harness.intent);
  const path = join(harness.library.directory, `${study.id}.study.v2.json`), changed = JSON.parse(await readFile(path, 'utf8'));
  // Act
  changed.observations[0].elapsedMs += 1; await writeFile(path, JSON.stringify(changed)); await harness.library.reconcile();
  const read = await harness.books.read('architecture', 1);
  // Assert
  assert.equal((await harness.library.readCheckpoint(study.id)).status, 'saved'); assert.equal(read.links[0]?.status, 'unavailable');
});

test('the seventeenth book and twenty-first revision are rejected without evicting retained history', async context => {
  // Arrange
  const { books, intent, path } = await bookHarness(context); await books.publish(intent);
  for (let index = 1; index < 16; index++) await books.publish({ ...intent, bookId: `book-${index}` });
  // Act / Assert
  await assert.rejects(books.publish({ ...intent, bookId: 'overflow' }), /16 books/); assert.equal((await books.list()).length, 16);
  for (let revision = 1; revision < 20; revision++) await books.publish({ ...intent, key: `revision-${revision + 1}`, expectedRevision: revision });
  const before = await readFile(path);
  await assert.rejects(books.publish({ ...intent, key: 'overflow-revision', expectedRevision: 20 }), /20 revisions/);
  assert.deepEqual(await readFile(path), before); assert.equal((await books.read('architecture', 1)).latestRevision, 20);
});

test('aggregate source and retained-file byte limits preserve earlier revisions even when individual sources are allowed', async context => {
  // Arrange
  const { books, intent, track, sources, path } = await bookHarness(context);
  const anchors = [];
  for (let index = 0; index < 17; index++) { const name = `src/large-${index}.ts`; await track(name, 'x'.repeat(262_144)); const source = await sources.read(name); anchors.push({ path: name, hash: source.hash, startLine: 1, endLine: 1 }); }
  const node = intent.document.nodes[0]!;
  const twoNodes = [{ ...node, id: 'first', anchors: anchors.slice(0, 6) }, { ...node, id: 'second', anchors: anchors.slice(6, 12) }];
  const large = { ...intent, document: { ...intent.document, nodes: twoNodes } };
  // Act / Assert
  await books.publish(large); await books.publish({ ...large, key: 'second', expectedRevision: 1 });
  const before = await readFile(path);
  await assert.rejects(books.publish({ ...large, key: 'file-overflow', expectedRevision: 2 }), /Storage limit exceeded/);
  assert.deepEqual(await readFile(path), before);
  await assert.rejects(books.publish({ ...large, key: 'revision-overflow', expectedRevision: 2, document: { ...large.document, nodes: [...twoNodes, { ...node, id: 'third', anchors: anchors.slice(12) }] } }), /revision exceeds/);
  assert.deepEqual(await readFile(path), before);
});
