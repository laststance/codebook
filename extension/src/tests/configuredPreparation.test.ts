import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { LearningLibrary } from '../learningLibrary'
import { RepositoryBookStore } from '../repositoryBook'
import type { BookDocument } from '../repositorySchemas'
import { prepareRepositoryStudy } from '../utils/prepareRepositoryStudy'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { repositoryHarness } from './utils/repositoryHarness'

/** Supplies real tracked files and an immutable book while leaving all application effects absent; `fixture` replaces the cited browser source and widens its citation. @example const { books, configuration } = await preparationHarness(context) */
async function preparationHarness(
  context: TestContext,
  fixture?: { source: string; citationEndLine: number },
) {
  const repository = await repositoryHarness(context),
    reference = createConfiguredStudy(fixture?.source, fixture?.citationEndLine)
  for (const source of reference.descriptor!.sources)
    await repository.track(source.path, source.text)
  await repository.track('src/unrelated.ts', 'export const unrelated = true;\n')
  const unrelated = await repository.sources.read('src/unrelated.ts')
  const library = new LearningLibrary(
      join(repository.directory, '.learning'),
      reference.workspaceKey,
    ),
    books = new RepositoryBookStore(repository.sources, library)
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
      {
        id: 'unrelated',
        title: 'Unrelated',
        sections: [
          { title: 'Other module', text: 'Not part of the selected item.' },
        ],
        anchors: [
          {
            path: unrelated.path,
            hash: unrelated.hash,
            startLine: 1,
            endLine: 1,
          },
        ],
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
  return {
    ...repository,
    library,
    books,
    document,
    configuration: reference.configuration,
    control: {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 20000,
    },
  }
}

test('configured preparation binds the exact older article and all of its sources without loading unrelated recordings or creating execution evidence', async (context) => {
  // Arrange
  const { books, library, configuration, control, document } =
    await preparationHarness(context)
  await books.publish({
    bookId: 'interface',
    key: 'second',
    expectedRevision: 1,
    document: { ...document, title: 'Newer article title' },
  })
  books.read = async () => {
    throw new Error('Preparation must not inspect every linked recording.')
  }
  const path = join(library.directory, 'interface.book.v2.json'),
    before = await readFile(path)
  // Act
  const definition = await prepareRepositoryStudy(configuration, books, control)
  // Assert
  assert.equal(definition.configuration.book.revision, 1)
  assert.equal(definition.descriptor.itemId, 'repository/interface/theme')
  assert.equal(definition.descriptor.bookTitle, 'Interface')
  assert.equal(definition.descriptor.nodeTitle, 'Theme')
  assert.deepEqual(
    definition.descriptor.sources.map((source) => source.path),
    ['src/theme.ts', 'src/mode.ts'],
  )
  assert.equal(
    definition.descriptor.sources[0]?.text,
    'const nextTheme = "dark";\n',
  )
  assert.equal(definition.descriptor.citationContext.anchors.length, 2)
  assert.equal('operation' in definition, false)
  assert.equal('observations' in definition, false)
  assert.equal((await library.list()).length, 0)
  assert.equal((await library.readProgress()).decisions.length, 0)
  assert.deepEqual(await readFile(path), before)
})

test('missing book revisions or nodes cannot silently select another article before repository execution', async (context) => {
  // Arrange
  const { books, configuration, control } = await preparationHarness(context)
  // Act / Assert
  await assert.rejects(
    prepareRepositoryStudy(
      { ...configuration, book: { ...configuration.book, revision: 2 } },
      books,
      control,
    ),
    /revision 2 is unavailable/,
  )
  await assert.rejects(
    prepareRepositoryStudy(
      { ...configuration, book: { ...configuration.book, nodeId: 'absent' } },
      books,
      control,
    ),
    {
      code: 'BOOK_UNAVAILABLE',
      message:
        'configuration.book.nodeId absent does not exist in revision 1 of book interface, which has the nodes: theme, unrelated. Use one of them, or publish your own document under its own book id and start on that revision.',
    },
  )
})

test('an out-of-citation source line column or anchor index is rejected before acquiring current source files', async (context) => {
  // Arrange
  const { books, sources, configuration, control } =
    await preparationHarness(context)
  let acquisitions = 0
  sources.prepare = async () => {
    acquisitions++
    throw new Error('Source acquisition must not start.')
  }
  const invalid = [
    { ...configuration, book: { ...configuration.book, anchorIndex: 2 } },
    { ...configuration, source: { ...configuration.source, line: 2 } },
    { ...configuration, source: { ...configuration.source, column: 100 } },
    {
      ...configuration,
      source: { ...configuration.source, path: 'src/mode.ts' },
    },
  ]
  // Act / Assert
  for (const input of invalid)
    await assert.rejects(prepareRepositoryStudy(input, books, control), {
      code: 'INVALID_CONFIGURATION',
    })
  assert.equal(acquisitions, 0)
})

// Value: protects=an agent that counted anchors over the wrong list and must correct anchorIndex; fails_when=the refusal names only the rule, not the node's valid range and the index whose citation covers the source line; why_new=the out-of-citation test checked the code only (Cycle 0044 row N-8); seam=none
test('a start whose anchor index selects a citation without its source line names the valid range and the covering index', async (context) => {
  // Arrange: node "theme" cites src/theme.ts:1-1 (index 0) and src/mode.ts:1-1 (index 1).
  const { books, configuration, control } = await preparationHarness(context)
  // Act / Assert
  await assert.rejects(
    prepareRepositoryStudy(
      { ...configuration, book: { ...configuration.book, anchorIndex: 1 } },
      books,
      control,
    ),
    {
      code: 'INVALID_CONFIGURATION',
      message:
        'configuration.book.anchorIndex 1 selects citation src/mode.ts:1-1, which does not contain configuration.source src/theme.ts:1. Node "theme" has citations 0..1; index 0 (src/theme.ts:1-1) covers src/theme.ts:1.',
    },
  )
  await assert.rejects(
    prepareRepositoryStudy(
      { ...configuration, book: { ...configuration.book, anchorIndex: 2 } },
      books,
      control,
    ),
    {
      code: 'INVALID_CONFIGURATION',
      message:
        'configuration.book.anchorIndex 2 is outside the selected node\'s citations. Node "theme" has citations 0..1; index 0 (src/theme.ts:1-1) covers src/theme.ts:1.',
    },
  )
  await assert.rejects(
    prepareRepositoryStudy(
      { ...configuration, source: { ...configuration.source, line: 2 } },
      books,
      control,
    ),
    {
      code: 'INVALID_CONFIGURATION',
      message:
        'configuration.book.anchorIndex 0 selects citation src/theme.ts:1-1, which does not contain configuration.source src/theme.ts:2. Node "theme" has citations 0..1; no citation covers src/theme.ts:2; publish a revision that cites it or choose a cited line.',
    },
  )
})

// Cycle 0045 (ST-11): the sentences of a later stop were not asserted; green on 6a7a0b8, its controls are the index and the two version branches of describeCitationMismatch.
test('a later stop whose anchor index selects a citation without its line is named by its additionalStops field: the entry itself in version 1, its source and anchorIndex in version 2', async (context) => {
  // Arrange: node "theme" cites src/theme.ts:1-1 (index 0) and src/mode.ts:1-1 (index 1).
  const { books, configuration, control } = await preparationHarness(context)
  const inspections = configuration.inspections
  // Act / Assert: a version 1 later stop shares the first stop's file and index, so only its line can leave the citation.
  await assert.rejects(
    prepareRepositoryStudy(
      {
        ...configuration,
        additionalStops: [{ line: 2, column: 1, inspections }],
      },
      books,
      control,
    ),
    {
      code: 'INVALID_CONFIGURATION',
      message:
        'configuration.book.anchorIndex 0 selects citation src/theme.ts:1-1, which does not contain configuration.additionalStops[0] src/theme.ts:2. Node "theme" has citations 0..1; no citation covers src/theme.ts:2; publish a revision that cites it or choose a cited line.',
    },
  )
  // A version 2 later stop declares its own source and index.
  await assert.rejects(
    prepareRepositoryStudy(
      {
        ...configuration,
        version: 2,
        participant: 'browser',
        additionalStops: [
          {
            participant: 'browser',
            source: configuration.source,
            anchorIndex: 1,
            inspections,
          },
        ],
      },
      books,
      control,
    ),
    {
      code: 'INVALID_CONFIGURATION',
      message:
        'configuration.additionalStops[0].anchorIndex 1 selects citation src/mode.ts:1-1, which does not contain configuration.additionalStops[0].source src/theme.ts:1. Node "theme" has citations 0..1; index 0 (src/theme.ts:1-1) covers src/theme.ts:1.',
    },
  )
})

// Cycle 0045 (NF-28, DX-9, ER-10): red while a column past its line's end answered "configuration.source and configuration.book.anchorIndex must identify a valid position in the same captured citation."
// Cycle 0045 (N14c-13): the blank-line half of this test moved to the next one, because a column on a blank line is now admitted; the refusal of a line with characters stays word for word.
test('a stop declared past the end of a line with characters is refused with the field, the line’s length and the highest accepted column', async (context) => {
  // Arrange: src/theme.ts holds a statement on line 1 (25 characters), a blank line 2 and a statement on line 3, all cited.
  const { books, configuration, control } = await preparationHarness(context, {
    source: 'const nextTheme = "dark";\n\nexport const theme = nextTheme;\n',
    citationEndLine: 3,
  })
  // Act
  const pastLineEnd = await prepareRepositoryStudy(
    { ...configuration, source: { ...configuration.source, column: 100 } },
    books,
    control,
  ).catch((error: unknown) => error)
  // Assert: the agent reads the message; the cause keeps the rule that refused.
  assert.ok(pastLineEnd instanceof StudyError)
  assert.deepEqual(
    [pastLineEnd.code, pastLineEnd.message, pastLineEnd.causeDetail],
    [
      'INVALID_CONFIGURATION',
      'configuration.source.column 100 lies past the end of its line: src/theme.ts:1 has a length of 25, so the highest column accepted is 26. Declare a column from 1 to 26.',
      'Error: Configured position differs from its selected citation.',
    ],
  )
})

// Value: protects=the first admitted run of an agent that declared a stop with a column on a blank line, meaning that line; fails_when=preparation refuses the column of a line without characters; why_new=Cycle 0045 N14c-13 (DX-1 a): the VS Code agent declared auth.ts 38:9 on a blank line and its start ended "configuration.additionalStops[0].source.column 9 lies past the end of its line: auth.ts:38 has a length of 0 (a blank line), so the highest column accepted is 1. Declare column 1."; seam=none
test('a stop declared with a column on a blank line is admitted by preparation with its declaration unchanged', async (context) => {
  // Arrange: line 2 of src/theme.ts is blank, and the citation covers lines 1 to 3.
  const { books, configuration, control } = await preparationHarness(context, {
    source: 'const nextTheme = "dark";\n\nexport const theme = nextTheme;\n',
    citationEndLine: 3,
  })
  const declared = {
    ...configuration,
    source: { ...configuration.source, line: 2, column: 9 },
  }
  // Act
  const definition = await prepareRepositoryStudy(declared, books, control)
  // Assert: the frozen configuration is the one the agent sent; the run takes the column at the line's start.
  assert.deepEqual(
    {
      line: definition.configuration.source.line,
      column: definition.configuration.source.column,
    },
    { line: 2, column: 9 },
  )
  assert.equal(definition.descriptor.itemId, 'repository/interface/theme')
})

test('a secondary citation edit rejects preparation even when the selected breakpoint file has not changed', async (context) => {
  // Arrange
  const { books, configuration, control, directory, library } =
    await preparationHarness(context)
  await writeFile(
    join(directory, 'src/mode.ts'),
    'export const mode = "changed";\n',
  )
  const before = await readFile(
    join(library.directory, 'interface.book.v2.json'),
  )
  // Act / Assert
  await assert.rejects(prepareRepositoryStudy(configuration, books, control), {
    code: 'SOURCE_CHANGED',
  })
  assert.equal(
    await readFile(join(directory, 'src/theme.ts'), 'utf8'),
    'const nextTheme = "dark";\n',
  )
  assert.deepEqual(
    await readFile(join(library.directory, 'interface.book.v2.json')),
    before,
  )
  assert.equal((await library.list()).length, 0)
})

test('replacing a prepared file with identical bytes cannot reuse its earlier ownership receipt', async (context) => {
  // Arrange
  const { books, sources, configuration, control, directory } =
      await preparationHarness(context),
    prepare = sources.prepare.bind(sources)
  sources.prepare = async (...arguments_) => {
    const prepared = await prepare(...arguments_),
      path = join(directory, 'src/theme.ts'),
      bytes = await readFile(path)
    await rm(path)
    await writeFile(path, bytes)
    return prepared
  }
  // Act / Assert
  await assert.rejects(prepareRepositoryStudy(configuration, books, control), {
    code: 'SOURCE_CHANGED',
  })
})

test('cancellation during article acquisition prevents later source work and cannot return a prepared definition', async (context) => {
  // Arrange
  const { books, sources, configuration, control } =
      await preparationHarness(context),
    controller = new AbortController(),
    read = books.readDefinition.bind(books)
  let release = (): void => {},
    entered = (): void => {},
    acquisitions = 0
  const pending = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  books.readDefinition = async (...arguments_) => {
    const value = await read(...arguments_)
    entered()
    await pending
    return value
  }
  sources.prepare = async () => {
    acquisitions++
    throw new Error('Cancelled source acquisition started.')
  }
  // Act
  const preparation = prepareRepositoryStudy(configuration, books, {
    ...control,
    signal: controller.signal,
  })
  await started
  controller.abort()
  release()
  // Assert
  await assert.rejects(preparation, /cancelled before application input/)
  assert.equal(acquisitions, 0)
})

test('expired preparation rejects before book reads and input configuration changes cannot rewrite an accepted definition', async (context) => {
  // Arrange
  const { books, configuration, control } = await preparationHarness(context),
    read = books.readDefinition.bind(books)
  let reads = 0
  books.readDefinition = async (...arguments_) => {
    reads++
    return read(...arguments_)
  }
  // Act / Assert
  await assert.rejects(
    prepareRepositoryStudy(configuration, books, { ...control, deadlineAt: 0 }),
    /expired/,
  )
  assert.equal(reads, 0)
  books.readDefinition = async (...arguments_) => {
    const result = await read(...arguments_)
    configuration.action.title = 'Changed after acceptance'
    configuration.source.column = 100
    return result
  }
  const definition = await prepareRepositoryStudy(configuration, books, control)
  assert.ok('action' in definition.configuration)
  assert.equal(definition.configuration.action.title, 'Change theme')
  assert.equal(definition.configuration.source.column, 1)
})

test('a foreign learning alias cannot become a configured repository learning identity', async (context) => {
  // Arrange
  const { books, sources, configuration, control } =
      await preparationHarness(context),
    read = books.readDefinition.bind(books)
  books.readDefinition = async (...arguments_) => {
    const value = await read(...arguments_)
    value.revision.document.nodes[0]!.learningItemId =
      'repository/interface/theme'
    return value
  }
  let acquisitions = 0
  sources.prepare = async () => {
    acquisitions++
    throw new Error('Alias must reject before acquisition.')
  }
  // Act / Assert
  await assert.rejects(prepareRepositoryStudy(configuration, books, control), {
    code: 'INVALID_CONFIGURATION',
    message:
      'configuration.book.nodeId must retain its default repository identity; a foreign learning identity cannot become a configured study.',
  })
  assert.equal(acquisitions, 0)
})
