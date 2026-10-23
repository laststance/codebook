import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { LearningLibrary } from '../learningLibrary'
import { nodeTestConfigSchema } from '../nodeTestConfigSchemas'
import { RepositoryBookStore } from '../repositoryBook'
import type { BookDocument } from '../repositorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { prepareNodeTestStudy } from '../utils/prepareNodeTestStudy'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { repositoryHarness } from './utils/repositoryHarness'

async function nodeStudyHarness(context: TestContext) {
  const repository = await repositoryHarness(context),
    reference = createConfiguredStudy()
  for (const source of reference.descriptor!.sources)
    await repository.track(source.path, source.text)
  const library = new LearningLibrary(
    join(repository.directory, '.learning'),
    reference.workspaceKey,
  )
  const books = new RepositoryBookStore(repository.sources, library)
  context.after(() => books.dispose())
  const document: BookDocument = {
    title: 'Interface',
    summary: 'Source-grounded behavior.',
    nodes: [
      {
        id: 'theme',
        title: 'Theme',
        sections: [
          { title: 'Theme choice', text: 'Explains the captured sources.' },
        ],
        anchors: reference.descriptor!.anchors,
        observations: [],
      },
    ],
    edges: [],
  }
  await books.publish({
    bookId: 'interface',
    key: 'first',
    expectedRevision: 0,
    document,
  })
  const configuration = nodeTestConfigSchema.parse({
    version: 1,
    adapter: 'vitest-node',
    book: reference.configuration.book,
    testFile: 'src/theme.test.ts',
    testTitles: ['theme', 'selects the dark theme'],
    testHash: 'a'.repeat(64),
    source: reference.configuration.source,
    inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
  })
  const control = {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 20_000,
  }
  return { ...repository, books, library, document, configuration, control }
}

test('a Node test stop binds the exact article citation before acquiring its executable source', async (context) => {
  // Arrange
  const { books, configuration, control, document } =
    await nodeStudyHarness(context)
  await books.publish({
    bookId: 'interface',
    key: 'second',
    expectedRevision: 1,
    document: { ...document, title: 'Newer article' },
  })
  // Act
  const definition = await prepareNodeTestStudy(configuration, books, control)
  // Assert
  assert.equal(definition.configuration.book.revision, 1)
  assert.equal(definition.descriptor.itemId, 'repository/interface/theme')
  assert.equal(definition.descriptor.bookTitle, 'Interface')
  assert.deepEqual(
    definition.descriptor.sources.map((source) => source.path),
    ['src/theme.ts', 'src/mode.ts'],
  )
  assert.equal(definition.configurationHash.length, 64)
})

test('a new Node test that names its test with the retired testName, or not at all, is refused before its history exists', async (context) => {
  // Arrange
  const { books, configuration, control } = await nodeStudyHarness(context)
  const { testTitles: _cited, ...withoutIdentity } = configuration
  // Act / Assert
  await assert.rejects(
    prepareNodeTestStudy(
      { ...withoutIdentity, testName: 'selects the dark theme' },
      books,
      control,
    ),
    {
      code: 'INVALID_CONFIGURATION',
      message: /testName is retired.*testTitles/,
    },
  )
  await assert.rejects(prepareNodeTestStudy(withoutIdentity, books, control), {
    code: 'INVALID_CONFIGURATION',
    message: /needs testTitles/,
  })
})

test('a Node test stop outside its cited line or column is refused before source acquisition', async (context) => {
  // Arrange
  const { books, sources, configuration, control } =
    await nodeStudyHarness(context)
  let acquisitions = 0
  sources.prepare = async () => {
    acquisitions++
    throw new Error('Source acquisition should not start.')
  }
  // Act / Assert
  await assert.rejects(
    prepareNodeTestStudy(
      { ...configuration, source: { ...configuration.source, line: 2 } },
      books,
      control,
    ),
    { code: 'INVALID_CONFIGURATION' },
  )
  await assert.rejects(
    prepareNodeTestStudy(
      { ...configuration, source: { ...configuration.source, column: 100 } },
      books,
      control,
    ),
    { code: 'INVALID_CONFIGURATION' },
  )
  assert.equal(acquisitions, 0)
})

test('a changed secondary citation refuses a Node test even when its selected source remains unchanged', async (context) => {
  // Arrange
  const { books, configuration, control, directory } =
    await nodeStudyHarness(context)
  await writeFile(
    join(directory, 'src/mode.ts'),
    'export const mode = "changed";\n',
  )
  // Act / Assert
  await assert.rejects(prepareNodeTestStudy(configuration, books, control), {
    code: 'SOURCE_CHANGED',
  })
})

test('an additional Node test stop must select its own exact citation anchor', async (context) => {
  // Arrange
  const { books, configuration, control, document } =
    await nodeStudyHarness(context)
  const second = document.nodes[0]!.anchors[1]!
  const extra = {
    anchorIndex: 1,
    path: second.path,
    hash: second.hash,
    line: second.startLine,
    column: 1,
    inspections: [{ path: 'mode', mode: 'value' as const, required: true }],
  }
  // Act / Assert
  assert.equal(
    (
      await prepareNodeTestStudy(
        { ...configuration, additionalStops: [extra] },
        books,
        control,
      )
    ).descriptor.anchors.length,
    2,
  )
  await assert.rejects(
    prepareNodeTestStudy(
      { ...configuration, additionalStops: [{ ...extra, anchorIndex: 0 }] },
      books,
      control,
    ),
    { code: 'INVALID_CONFIGURATION' },
  )
})

// Value: protects=a Node test run that reaches preparation on a node id its revision lacks naming that revision's nodes; fails_when=the Node test profile keeps the old sentence that names no node; why_new=only the repository profile's preparation is tested; seam=none
test('a Node test start on a node id its selected revision does not have is refused before source acquisition, naming the revision’s nodes', async (context) => {
  // Arrange: revision 1 of the book "interface" has the one node "theme".
  const { books, sources, configuration, control } =
    await nodeStudyHarness(context)
  let acquisitions = 0
  sources.prepare = async () => {
    acquisitions++
    throw new Error('Source acquisition should not start.')
  }
  // Act
  const preparation = prepareNodeTestStudy(
    { ...configuration, book: { ...configuration.book, nodeId: 'mode' } },
    books,
    control,
  )
  // Assert
  await assert.rejects(preparation, {
    code: 'BOOK_UNAVAILABLE',
    message:
      'configuration.book.nodeId mode does not exist in revision 1 of book interface, which has the node: theme. Use it, or publish your own document under its own book id and start on that revision.',
  })
  assert.equal(acquisitions, 0)
})

// Value: protects=the citation-position refusal of a node-test start naming the stop, its anchor, the cited path and lines, the failed condition and what to send, one sentence per condition; fails_when=the refusal goes back to "Configured position differs from its selected citation" for every condition, or names the wrong stop or condition; why_new=the refusal named neither the stop, the anchor, the cited range nor the failed condition, and the chat guessed three times (F205, D17, inventory row 14); seam=the article and its sources are real, the stops are changed one condition at a time; no_claim=the browser profile's refusal (unchanged)
for (const scenario of [
  {
    condition: 'the anchor does not exist',
    stop: (
      configuration: Awaited<
        ReturnType<typeof nodeStudyHarness>
      >['configuration'],
    ) => ({
      ...configuration,
      additionalStops: [
        {
          anchorIndex: 5,
          path: 'src/mode.ts',
          hash: sha256('export const mode = "display";\n'),
          line: 1,
          column: 1,
          inspections: [
            { path: 'mode', mode: 'value' as const, required: true },
          ],
        },
      ],
    }),
    message:
      'node-test preparation refused: additionalStops[0] uses anchorIndex 5, but the article node cites 2 source ranges (anchorIndex 0 to 1). Send the anchorIndex of the citation that covers the stop.',
  },
  {
    condition: 'the path differs from the anchor’s',
    stop: (
      configuration: Awaited<
        ReturnType<typeof nodeStudyHarness>
      >['configuration'],
    ) => ({
      ...configuration,
      source: {
        ...configuration.source,
        path: 'src/mode.ts',
        hash: sha256('export const mode = "display";\n'),
      },
    }),
    message:
      'node-test preparation refused: source cites src/mode.ts, but anchorIndex 0 cites src/theme.ts lines 1 to 1. Send src/theme.ts, or the anchorIndex of the citation of src/mode.ts.',
  },
  {
    condition: 'the hash differs from the anchor’s',
    stop: (
      configuration: Awaited<
        ReturnType<typeof nodeStudyHarness>
      >['configuration'],
    ) => ({
      ...configuration,
      source: { ...configuration.source, hash: 'b'.repeat(64) },
    }),
    message: `node-test preparation refused: source sends SHA-256 ${'b'.repeat(64)} for src/theme.ts, but anchorIndex 0 cites src/theme.ts lines 1 to 1 with SHA-256 ${sha256('const nextTheme = "dark";\n')}. Read the file with codebook_source and send its current hash; publish the article again if the file changed.`,
  },
  {
    condition: 'the line lies outside the cited range',
    stop: (
      configuration: Awaited<
        ReturnType<typeof nodeStudyHarness>
      >['configuration'],
    ) => ({
      ...configuration,
      source: { ...configuration.source, line: 2 },
    }),
    message:
      'node-test preparation refused: source sends line 2, but anchorIndex 0 cites src/theme.ts lines 1 to 1 only. Send a line from 1 to 1.',
  },
  {
    condition: 'the column lies past the end of its line',
    stop: (
      configuration: Awaited<
        ReturnType<typeof nodeStudyHarness>
      >['configuration'],
    ) => ({
      ...configuration,
      source: { ...configuration.source, column: 100 },
    }),
    message:
      'node-test preparation refused: source sends column 100 on line 1 of src/theme.ts, but that line has 25 characters, so the last column is 26. Send a column from 1 to 26.',
  },
] as const)
  test(`a Node test stop is refused with its own sentence when ${scenario.condition}`, async (context) => {
    // Arrange
    const { books, configuration, control } = await nodeStudyHarness(context)

    // Act
    const refusal = await prepareNodeTestStudy(
      scenario.stop(configuration),
      books,
      control,
    ).then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.deepEqual(
      { code: refusal.code, message: refusal.message },
      { code: 'INVALID_CONFIGURATION', message: scenario.message },
    )
  })
