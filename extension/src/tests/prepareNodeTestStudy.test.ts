import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { LearningLibrary } from '../learningLibrary';
import { nodeTestConfigSchema } from '../nodeTestConfigSchemas';
import { RepositoryBookStore } from '../repositoryBook';
import type { BookDocument } from '../repositorySchemas';
import { prepareNodeTestStudy } from '../utils/prepareNodeTestStudy';
import { createConfiguredStudy } from './utils/createConfiguredStudy';
import { repositoryHarness } from './utils/repositoryHarness';

async function nodeStudyHarness(context: TestContext) {
  const repository = await repositoryHarness(context), reference = createConfiguredStudy();
  for (const source of reference.descriptor!.sources) await repository.track(source.path, source.text);
  const library = new LearningLibrary(join(repository.directory, '.learning'), reference.workspaceKey);
  const books = new RepositoryBookStore(repository.sources, library);
  context.after(() => books.dispose());
  const document: BookDocument = { title: 'Interface', summary: 'Source-grounded behavior.', nodes: [{ id: 'theme', title: 'Theme',
    sections: [{ title: 'Theme choice', text: 'Explains the captured sources.' }], anchors: reference.descriptor!.anchors, observations: [] }], edges: [] };
  await books.publish({ bookId: 'interface', key: 'first', expectedRevision: 0, document });
  const configuration = nodeTestConfigSchema.parse({ version: 1, adapter: 'vitest-node', book: reference.configuration.book,
    testFile: 'src/theme.test.ts', testHash: 'a'.repeat(64), source: reference.configuration.source,
    inspections: [{ path: 'nextTheme', mode: 'value', required: true }] });
  const control = { signal: new AbortController().signal, deadlineAt: Date.now() + 20_000 };
  return { ...repository, books, library, document, configuration, control };
}

test('a Node test stop binds the exact article citation before acquiring its executable source', async context => {
  // Arrange
  const { books, configuration, control, document } = await nodeStudyHarness(context);
  await books.publish({ bookId: 'interface', key: 'second', expectedRevision: 1, document: { ...document, title: 'Newer article' } });
  // Act
  const definition = await prepareNodeTestStudy(configuration, books, control);
  // Assert
  assert.equal(definition.configuration.book.revision, 1);
  assert.equal(definition.descriptor.itemId, 'repository/interface/theme');
  assert.equal(definition.descriptor.bookTitle, 'Interface');
  assert.deepEqual(definition.descriptor.sources.map(source => source.path), ['src/theme.ts', 'src/mode.ts']);
  assert.equal(definition.configurationHash.length, 64);
});

test('a Node test stop outside its cited line or column is refused before source acquisition', async context => {
  // Arrange
  const { books, sources, configuration, control } = await nodeStudyHarness(context);
  let acquisitions = 0;
  sources.prepare = async () => { acquisitions++; throw new Error('Source acquisition should not start.'); };
  // Act / Assert
  await assert.rejects(prepareNodeTestStudy({ ...configuration, source: { ...configuration.source, line: 2 } }, books, control), { code: 'INVALID_CONFIGURATION' });
  await assert.rejects(prepareNodeTestStudy({ ...configuration, source: { ...configuration.source, column: 100 } }, books, control), { code: 'INVALID_CONFIGURATION' });
  assert.equal(acquisitions, 0);
});

test('a changed secondary citation refuses a Node test even when its selected source remains unchanged', async context => {
  // Arrange
  const { books, configuration, control, directory } = await nodeStudyHarness(context);
  await writeFile(join(directory, 'src/mode.ts'), 'export const mode = "changed";\n');
  // Act / Assert
  await assert.rejects(prepareNodeTestStudy(configuration, books, control), { code: 'SOURCE_CHANGED' });
});

test('an additional Node test stop must select its own exact citation anchor', async context => {
  // Arrange
  const { books, configuration, control, document } = await nodeStudyHarness(context);
  const second = document.nodes[0]!.anchors[1]!;
  const extra = { anchorIndex: 1, path: second.path, hash: second.hash, line: second.startLine, column: 1,
    inspections: [{ path: 'mode', mode: 'value' as const, required: true }] };
  // Act / Assert
  assert.equal((await prepareNodeTestStudy({ ...configuration, additionalStops: [extra] }, books, control)).descriptor.anchors.length, 2);
  await assert.rejects(prepareNodeTestStudy({ ...configuration, additionalStops: [{ ...extra, anchorIndex: 0 }] }, books, control), { code: 'INVALID_CONFIGURATION' });
});
