import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import filesystem, { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { RepositoryBookStore } from '../repositoryBook'
import type * as RepositoryBookModule from '../repositoryBook'
import {
  repositoryBookSchema,
  type BookDocument,
  type BookPublishIntent,
} from '../repositorySchemas'
import { RepositorySourceService } from '../repositorySource'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { loadModule } from './utils/loadModule'
import { repositoryHarness } from './utils/repositoryHarness'

const workspaceKey = '1'.repeat(64),
  sourceHash =
    '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b'

/** Builds real tracked source and independent shared storage for book publication regressions. @example const { books, intent } = await bookHarness(context) */
async function bookHarness(context: TestContext) {
  const source = await repositoryHarness(context)
  await source.track('src/module.ts')
  const library = new LearningLibrary(
      join(source.directory, '.learning'),
      workspaceKey,
    ),
    books = new RepositoryBookStore(source.sources, library)
  context.after(() => books.dispose())
  const document: BookDocument = {
    title: 'Module architecture',
    summary: 'Source-derived module state.',
    nodes: [
      {
        id: 'module',
        title: 'Module',
        sections: [{ title: 'Price', text: 'The module exports price 24.' }],
        anchors: [
          { path: 'src/module.ts', hash: sourceHash, startLine: 1, endLine: 2 },
        ],
        observations: [],
      },
    ],
    edges: [],
  }
  const intent: BookPublishIntent = {
    bookId: 'architecture',
    key: 'first',
    expectedRevision: 0,
    document,
  }
  return {
    ...source,
    library,
    books,
    intent,
    path: join(library.directory, 'architecture.book.v2.json'),
  }
}

/** Uses synthetic configured facts to test exact checkpoint links, without claiming a new native run. @example const study = await linkCheckpoint(harness) */
async function linkCheckpoint(
  harness: Awaited<ReturnType<typeof bookHarness>>,
) {
  const study = {
    ...createConfiguredStudy(),
    workspaceKey,
    finalOutcome: 'partial' as const,
  }
  await harness.library.saveStudy(study)
  const observation = study.observations[0]!
  await harness.track('src/module.ts', observation.source.text)
  harness.intent.document.nodes[0]!.anchors = [
    {
      path: 'src/module.ts',
      hash: observation.source.hash,
      startLine: 1,
      endLine: 2,
    },
  ]
  harness.intent.document.nodes[0]!.observations = [
    {
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
    },
  ]
  harness.intent.document.nodes[0]!.learningItemId = observation.itemId
  return study
}

test('whole book publication retains immutable source revisions without navigation or learner decisions', async (context) => {
  // Arrange
  const { books, sources, library, intent, directory } =
    await bookHarness(context)
  // Act
  const first = await books.publish(intent)
  const second = await books.publish({
    ...intent,
    key: 'second',
    expectedRevision: 1,
    document: { ...intent.document, title: 'Clearer title' },
  })
  await writeFile(
    join(directory, 'src/module.ts'),
    'export const price = 30;\n',
  )
  const historical = await books.read('architecture', 1),
    states = await sources.inspect(historical.revision.sources)
  // Assert
  assert.equal(first.revision, 1)
  assert.equal(second.revision, 2)
  assert.equal(historical.latestRevision, 2)
  assert.equal(historical.revision.document.title, 'Module architecture')
  assert.equal(
    historical.revision.sources[0]?.text,
    'export const price = 24;\n',
  )
  assert.equal(states[0]?.status, 'changed')
  assert.equal((await library.readProgress()).decisions.length, 0)
  assert.equal((await library.readProgress()).repositorySelection, undefined)
})

test('lost publication responses recover the original receipt after source edits and deletion without another revision', async (context) => {
  // Arrange
  const { books, intent, directory, path, sources, library } =
    await bookHarness(context)
  const first = await books.publish(intent),
    before = await readFile(path)
  // Act / Assert
  await writeFile(
    join(directory, 'src/module.ts'),
    'changed after successful commit',
  )
  assert.deepEqual(await books.publish(intent), first)
  await rm(join(directory, 'src/module.ts'))
  assert.deepEqual(
    await new RepositoryBookStore(sources, library).publish(intent),
    first,
  )
  await assert.rejects(
    books.publish({
      ...intent,
      document: { ...intent.document, title: 'Changed intent' },
    }),
    /already names different input/,
  )
  assert.deepEqual(await readFile(path), before)
  assert.equal((await books.list())[0]?.revision, 1)
})

test('same-key recovery survives unavailable checkpoints while public reads label the exact linked destination unavailable', async (context) => {
  // Arrange
  const harness = await bookHarness(context),
    study = await linkCheckpoint(harness)
  const first = await harness.books.publish(harness.intent)
  const verified = await harness.books.read('architecture', 1)
  // Act
  await writeFile(
    join(harness.library.directory, `${study.id}.study.meta.v3.json`),
    '{corrupt',
  )
  const repeated = await harness.books.publish(harness.intent),
    unavailable = await harness.books.read('architecture', 1)
  // Assert
  assert.equal(verified.links[0]?.status, 'available')
  assert.equal(verified.links[0]?.outcome, 'partial')
  assert.deepEqual(repeated, first)
  assert.equal(unavailable.links[0]?.status, 'unavailable')
  assert.equal(unavailable.revision.document.title, 'Module architecture')
  assert.equal(unavailable.latestRevision, 1)
})

// Value: protects=a storage failure while a linked study is read reaches the agent as that failure; fails_when=the store recognises a missing archive by the sentence of the error, so any failure worded the same way is reported as a deleted study (SM-3); why_new=the only failure tested was the library's own missing archive; seam=the library's checkpoint read, replaced by one that rejects with a plain error
test('a linked study whose read fails for another reason that words itself like a missing archive is passed on as it is, not reported as deleted', async (context) => {
  // Arrange: a publication that links a saved study; the checkpoint read fails with a plain error that carries the missing-archive sentence.
  const harness = await bookHarness(context)
  await linkCheckpoint(harness)
  const readFailure = new Error('Study archive is unavailable.')
  context.mock.method(harness.library, 'readCheckpoint', async () => {
    throw readFailure
  })
  // Act
  const publication = harness.books.publish(harness.intent)
  // Assert
  await assert.rejects(publication, (error) => error === readFailure)
})

test('slow source preparation lets another learner writer finish before publication enters the shared queue', async (context) => {
  // Arrange
  const { books, intent, sources, library } = await bookHarness(context)
  let enter = (): void => {},
    release = (): void => {}
  const entered = new Promise<void>((resolve) => {
      enter = resolve
    }),
    held = new Promise<void>((resolve) => {
      release = resolve
    })
  const prepare = sources.prepare.bind(sources)
  sources.prepare = async (...arguments_: Parameters<typeof prepare>) => {
    const value = await prepare(...arguments_)
    enter()
    await held
    return value
  }
  // Act
  const publishing = books.publish(intent)
  await entered
  const progress = await library.decide({
    id: randomUUID(),
    item: 'repository/interface/theme',
    sourceHash,
    understood: true,
    at: '2026-09-19T10:00:00.000Z',
  })
  release()
  const receipt = await publishing
  // Assert
  assert.equal(progress.decisions.length, 1)
  assert.equal(receipt.revision, 1)
  assert.equal((await library.readProgress()).decisions.length, 1)
})

test('simultaneous same-key publishers recover one receipt and different keys cannot overwrite the same expected revision', async (context) => {
  // Arrange
  const { books, sources, library, intent, path } = await bookHarness(context)
  const other = new RepositoryBookStore(sources, library)
  context.after(() => other.dispose())
  // Act
  const same = await Promise.all([books.publish(intent), other.publish(intent)])
  const competing = await Promise.allSettled([
    books.publish({ ...intent, key: 'next-a', expectedRevision: 1 }),
    other.publish({ ...intent, key: 'next-b', expectedRevision: 1 }),
  ])
  // Assert
  assert.deepEqual(same[0], same[1])
  assert.equal(
    competing.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  assert.equal(
    competing.filter((result) => result.status === 'rejected').length,
    1,
  )
  assert.equal(JSON.parse(await readFile(path, 'utf8')).revisions.length, 2)
})

// Value: protects=an agent whose book id is already taken learning what exists and the two ways on; fails_when=the conflict answers "Expected book revision 0, current 1; read the current book before retrying.", after which the Cursor agent of the baseline round read the existing article and ran on it; why_new=Cycle 0045 cause 5; seam=none
test('a publication that expects another revision than the current one is refused saying which revision exists, how to replace the book and how to keep it', async (context) => {
  // Arrange: the book "architecture" holds revision 1, then revision 2.
  const { books, intent, path } = await bookHarness(context)
  await books.publish(intent)
  const createAgain = books.publish({ ...intent, key: 'create-again' })
  await assert.rejects(createAgain, {
    code: 'BOOK_CONFLICT',
    message:
      "Book architecture exists at revision 1. To replace it, publish the complete document again with expectedRevision 1; to keep it, publish under another book id. A run stops only on lines its article's node cites, so publish your own citations before you start.",
  })
  await books.publish({ ...intent, key: 'second', expectedRevision: 1 })
  const before = await readFile(path)

  // Act
  const staleRevision = books.publish({
    ...intent,
    key: 'stale',
    expectedRevision: 1,
  })

  // Assert
  await assert.rejects(staleRevision, {
    code: 'BOOK_CONFLICT',
    message:
      "Book architecture exists at revision 2. To replace it, publish the complete document again with expectedRevision 2; to keep it, publish under another book id. A run stops only on lines its article's node cites, so publish your own citations before you start.",
  })
  assert.deepEqual(await readFile(path), before)
})

// The sentence above would be false for a book that does not exist, so that case keeps its text (recorded as a conflict with the plan).
test('a publication that expects a revision of a book that does not exist keeps the answer that names both numbers', async (context) => {
  // Arrange: no book is stored under "architecture".
  const { books, intent } = await bookHarness(context)

  // Act
  const expectingRevision = books.publish({ ...intent, expectedRevision: 3 })

  // Assert
  await assert.rejects(expectingRevision, {
    code: 'BOOK_CONFLICT',
    message:
      'Expected book revision 3, current 0; read the current book before retrying.',
  })
})

test('invalid ranges, stale hashes and mismatched observation references preserve the previous entire book', async (context) => {
  // Arrange
  const { books, intent, path } = await bookHarness(context)
  await books.publish(intent)
  const before = await readFile(path)
  const node = intent.document.nodes[0]!
  // Act / Assert
  for (const changed of [
    { ...node, anchors: [{ ...node.anchors[0]!, endLine: 3 }] },
    { ...node, anchors: [{ ...node.anchors[0]!, hash: '0'.repeat(64) }] },
    {
      ...node,
      observations: [
        {
          studyId: `${randomUUID()}_${randomUUID()}`,
          observationId: 'absent',
          sourceHash,
        },
      ],
    },
  ]) {
    await assert.rejects(
      books.publish({
        ...intent,
        key: 'invalid',
        expectedRevision: 1,
        document: { ...intent.document, nodes: [changed] },
      }),
    )
    assert.deepEqual(await readFile(path), before)
  }
})

test('source edits after hash revalidation but before final commit retain the old revision', async (context) => {
  // Arrange
  const { books, intent, path, sources, directory } = await bookHarness(context)
  await books.publish(intent)
  const before = await readFile(path)
  const prepare = sources.prepare.bind(sources)
  sources.prepare = async (...arguments_: Parameters<typeof prepare>) => {
    const prepared = await prepare(...arguments_),
      revalidate = prepared.revalidate
    return {
      ...prepared,
      revalidate: async () => {
        const checks = await revalidate()
        await writeFile(
          join(directory, 'src/module.ts'),
          'edited during final link checks',
        )
        return checks
      },
    }
  }
  // Act / Assert
  await assert.rejects(
    books.publish({ ...intent, key: 'next', expectedRevision: 1 }),
    /changed before commit/,
  )
  assert.deepEqual(await readFile(path), before)
})

test('a cancelled or expired preparation never starts an atomic write or publishes a late revision', async (context) => {
  // Arrange
  const { directory, library, intent } = await bookHarness(context)
  let now = Date.now()
  const sources = new RepositorySourceService(directory, () => now),
    books = new RepositoryBookStore(sources, library, () => now)
  context.after(() => books.dispose())
  const prepare = sources.prepare.bind(sources),
    controller = new AbortController()
  sources.prepare = async (...arguments_: Parameters<typeof prepare>) => {
    const prepared = await prepare(...arguments_)
    controller.abort()
    now += 20_000
    return prepared
  }
  // Act / Assert
  await assert.rejects(
    books.publish(intent, controller.signal),
    /expired or was cancelled/,
  )
  assert.equal((await books.list()).length, 0)
  assert.equal(
    (await readdir(library.directory)).includes('writer.lock'),
    false,
  )
})

test('a failed atomic rename preserves prior book bytes and removes only its incomplete temporary file', async (context) => {
  // Arrange
  const { books, intent, path, library } = await bookHarness(context)
  await books.publish(intent)
  const before = await readFile(path)
  context.mock.method(filesystem, 'rename', async () => {
    throw new Error('Injected book rename failure')
  })
  // Act / Assert
  await assert.rejects(
    books.publish({ ...intent, key: 'next', expectedRevision: 1 }),
    /rename failure/,
  )
  assert.deepEqual(await readFile(path), before)
  assert.deepEqual(await readdir(library.directory), [
    'architecture.book.v2.json',
  ])
})

test('retirement and transport cancellation drain an in-flight successful atomic writer before releasing its lock', async (context) => {
  // Arrange
  const { sources, library, intent, path } = await bookHarness(context)
  let enter = (): void => {},
    release = (): void => {},
    retired = false
  const entered = new Promise<void>((resolve) => {
      enter = resolve
    }),
    held = new Promise<void>((resolve) => {
      release = resolve
    })
  const module = await loadModule<typeof RepositoryBookModule>(
    resolve(__dirname, '../repositoryBook.js'),
    {
      './utils/atomicPrivateWrite': {
        atomicPrivateWrite: async (
          ...arguments_: Parameters<typeof atomicPrivateWrite>
        ) => {
          await atomicPrivateWrite(...arguments_)
          enter()
          await held
        },
      },
    },
  )
  const books = new module.RepositoryBookStore(sources, library),
    controller = new AbortController()
  // Act
  const pending = books.publish(intent, controller.signal)
  await entered
  controller.abort()
  const disposal = books.dispose().then(() => {
    retired = true
  })
  assert.equal(retired, false)
  assert.ok((await readdir(library.directory)).includes('writer.lock'))
  assert.equal(JSON.parse(await readFile(path, 'utf8')).revisions.length, 1)
  release()
  const receipt = await pending
  await disposal
  // Assert
  assert.equal(retired, true)
  assert.equal(
    (await readdir(library.directory)).includes('writer.lock'),
    false,
  )
  assert.equal(
    JSON.stringify(
      await new RepositoryBookStore(sources, library).publish(intent),
    ),
    JSON.stringify(receipt),
  )
})

test('corrupt or future book formats never fall back to older revisions and other valid books remain listed', async (context) => {
  // Arrange
  const { books, intent, path } = await bookHarness(context)
  await books.publish(intent)
  await books.publish({ ...intent, bookId: 'another' })
  const stored = JSON.parse(await readFile(path, 'utf8'))
  // Act / Assert
  for (const invalid of [
    '{corrupt',
    JSON.stringify({ ...stored, version: 3 }),
    JSON.stringify({
      ...stored,
      revisions: stored.revisions.map((revision: object) => ({
        ...revision,
        hash: '0'.repeat(64),
      })),
    }),
  ]) {
    await writeFile(path, invalid)
    await assert.rejects(
      books.read('architecture', 1),
      /no older revision was substituted/,
    )
    await assert.rejects(
      books.publish({ ...intent, key: 'next', expectedRevision: 1 }),
    )
    const catalog = await books.list()
    assert.equal(
      catalog.find((entry) => entry.bookId === 'another')?.status,
      'available',
    )
    assert.equal(
      catalog.find((entry) => entry.bookId === 'architecture')?.status,
      'unavailable',
    )
    assert.equal(await readFile(path, 'utf8'), invalid)
  }
})

test('partial linked observations remain exact and later article revisions cannot rebind a retained learning identity', async (context) => {
  // Arrange
  const harness = await bookHarness(context),
    study = await linkCheckpoint(harness)
  await harness.books.publish(harness.intent)
  const before = await readFile(harness.path),
    node = harness.intent.document.nodes[0]!
  // Act / Assert
  const linked = await harness.books.read('architecture', 1)
  assert.equal(linked.links[0]?.studyId, study.id)
  assert.equal(linked.links[0]?.outcome, 'partial')
  assert.equal(linked.links[0]?.itemId, 'repository/interface/theme')
  const { learningItemId: _identity, ...withoutAlias } = node
  await assert.rejects(
    harness.books.publish({
      ...harness.intent,
      key: 'changed-alias',
      expectedRevision: 1,
      document: { ...harness.intent.document, nodes: [withoutAlias] },
    }),
    {
      code: 'BOOK_CONFLICT',
      message:
        'Learning identity changed for module. Keep its original learningItemId or omit it as in the retained revision.',
    },
  )
  assert.deepEqual(await readFile(harness.path), before)
})

test('a changed captured fact cannot become a valid book destination even after its archive sidecar is repaired', async (context) => {
  // Arrange
  const harness = await bookHarness(context),
    study = await linkCheckpoint(harness)
  await harness.books.publish(harness.intent)
  const path = join(harness.library.directory, `${study.id}.study.v3.json`),
    changed = JSON.parse(await readFile(path, 'utf8'))
  // Act
  changed.observations[0].elapsedMs += 1
  await writeFile(path, JSON.stringify(changed))
  await harness.library.reconcile()
  const read = await harness.books.read('architecture', 1)
  // Assert
  assert.equal((await harness.library.readCheckpoint(study.id)).status, 'saved')
  assert.equal(read.links[0]?.status, 'unavailable')
})

// Value: protects=the list of repository books and the saving of a new one in a learning directory that holds a file nobody's book owns; fails_when=the name of every file with a book suffix is parsed as a book id, so one stray file rejects the list and the book count of a save with a ZodError; why_new=Cycle 0046 package PRF, found while working F3 (row 48); seam=none
test('a stray X.book.v1.json in the book directory leaves the books listed and a new book saved', async (context) => {
  // Arrange: one saved book, and two files with a book suffix whose prefix is no book id.
  const { books, intent, library } = await bookHarness(context)
  await books.publish(intent)
  await writeFile(join(library.directory, 'X.book.v1.json'), '{}')
  await writeFile(join(library.directory, 'my_notes.book.v2.json'), '{}')

  // Act
  const receipt = await books.publish({ ...intent, bookId: 'another' })
  const catalog = await books.list()

  // Assert
  assert.equal(receipt.bookId, 'another')
  assert.equal(receipt.revision, 1)
  assert.deepEqual(
    catalog.map((entry) => [entry.bookId, entry.status]),
    [
      ['another', 'available'],
      ['architecture', 'available'],
    ],
  )
  assert.deepEqual(
    (await readdir(library.directory))
      .filter((name) => name.includes('.book.'))
      .sort(),
    [
      'X.book.v1.json',
      'another.book.v2.json',
      'architecture.book.v2.json',
      'my_notes.book.v2.json',
    ],
  )
})

test('a seventeenth distinct book is saved and a sixty-fifth is rejected without evicting retained history', async (context) => {
  // Arrange
  const { books, intent, path, library } = await bookHarness(context)
  await books.publish(intent)
  const original = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(
    join(library.directory, 'architecture.book.v1.json'),
    JSON.stringify({ ...original, version: 1 }),
  )
  for (let index = 1; index < 16; index++)
    await books.publish({ ...intent, bookId: `book-${index}` })
  // Act / Assert
  await books.publish({ ...intent, bookId: 'book-16' })
  assert.equal(
    (await books.list()).length,
    17,
    'the former cap cannot prevent a new current-source article',
  )
  for (let index = 17; index < 64; index++)
    await books.publish({ ...intent, bookId: `book-${index}` })
  await assert.rejects(
    books.publish({ ...intent, bookId: 'overflow' }),
    /64 books/,
  )
  assert.equal((await books.list()).length, 64)
  for (let revision = 1; revision < 20; revision++)
    await books.publish({
      ...intent,
      key: `revision-${revision + 1}`,
      expectedRevision: revision,
    })
  const before = await readFile(path)
  await assert.rejects(
    books.publish({
      ...intent,
      key: 'overflow-revision',
      expectedRevision: 20,
    }),
    /20 revisions/,
  )
  assert.deepEqual(await readFile(path), before)
  assert.equal((await books.read('architecture', 1)).latestRevision, 20)
})

test('aggregate source and retained-file byte limits preserve earlier revisions even when individual sources are allowed', async (context) => {
  // Arrange
  const { books, intent, track, sources, path } = await bookHarness(context)
  const anchors = []
  for (let index = 0; index < 17; index++) {
    const name = `src/large-${index}.ts`
    await track(name, 'x'.repeat(262_144))
    const source = await sources.read(name)
    anchors.push({ path: name, hash: source.hash, startLine: 1, endLine: 1 })
  }
  const node = intent.document.nodes[0]!
  const twoNodes = [
    { ...node, id: 'first', anchors: anchors.slice(0, 6) },
    { ...node, id: 'second', anchors: anchors.slice(6, 12) },
  ]
  const large = { ...intent, document: { ...intent.document, nodes: twoNodes } }
  // Act / Assert
  await books.publish(large)
  await books.publish({ ...large, key: 'second', expectedRevision: 1 })
  const before = await readFile(path)
  await assert.rejects(
    books.publish({ ...large, key: 'file-overflow', expectedRevision: 2 }),
    /Storage limit exceeded/,
  )
  assert.deepEqual(await readFile(path), before)
  await assert.rejects(
    books.publish({
      ...large,
      key: 'revision-overflow',
      expectedRevision: 2,
      document: {
        ...large.document,
        nodes: [
          ...twoNodes,
          { ...node, id: 'third', anchors: anchors.slice(12) },
        ],
      },
    }),
    /revision exceeds/,
  )
  assert.deepEqual(await readFile(path), before)
})

test('reading a version 1 book preserves its exact revision hash and retry receipt before copying it on the next publication', async (context) => {
  // Arrange
  const { books, intent, path, library, directory, track } =
    await bookHarness(context)
  await library.readProgress()
  const bytes = await readFile(
    resolve(
      __dirname,
      '../../src/tests/fixtures/cycle-0009-legacy/architecture.book.v1.json',
    ),
  )
  const legacyPath = join(library.directory, 'architecture.book.v1.json')
  await writeFile(legacyPath, bytes)
  // Act
  const historical = await books.read('architecture', 1)
  await rm(join(directory, 'src/module.ts'))
  const retry = await books.publish(intent)
  // Assert
  assert.equal(
    sha256(bytes),
    '073dea7dd3f21bad0b2ba2feaaa1711054d539c4e6711b9ca9178b60dfdd46dc',
  )
  assert.equal(
    historical.revision.hash,
    'a772171df763a8ecf607b077b1ecff6a995fbbde8bbf18e7fee848e7b2028290',
  )
  assert.equal(
    historical.revision.inputDigest,
    '512543316e941dce362bbff1dd905efd16691c8e92274d1f4dcc2a5ca0a8f6bc',
  )
  assert.deepEqual(retry, {
    bookId: 'architecture',
    revision: 1,
    hash: 'a772171df763a8ecf607b077b1ecff6a995fbbde8bbf18e7fee848e7b2028290',
    publishedAt: '2026-09-19T00:00:02.000Z',
  })
  assert.deepEqual(await readdir(library.directory), [
    'architecture.book.v1.json',
  ])
  await track('src/module.ts')
  const next = await books.publish({
    ...intent,
    key: 'second',
    expectedRevision: 1,
    document: { ...intent.document, title: 'Clearer title' },
  })
  const current = JSON.parse(await readFile(path, 'utf8')),
    legacy = repositoryBookSchema.parse(JSON.parse(bytes.toString()))
  assert.equal(next.revision, 2)
  assert.equal(current.version, 2)
  assert.deepEqual(current.revisions[0], legacy.revisions[0])
  assert.equal((await books.list()).length, 1)
  assert.deepEqual(await books.publish(intent), retry)
  assert.deepEqual(await readFile(legacyPath), bytes)
})

test('a corrupt preferred version 2 book cannot revive valid version 1 articles or publication receipts', async (context) => {
  // Arrange
  const { books, intent, path, library } = await bookHarness(context)
  await library.readProgress()
  const bytes = await readFile(
    resolve(
      __dirname,
      '../../src/tests/fixtures/cycle-0009-legacy/architecture.book.v1.json',
    ),
  )
  const legacyPath = join(library.directory, 'architecture.book.v1.json')
  await writeFile(legacyPath, bytes)
  await writeFile(path, '{corrupt')
  // Act / Assert
  await assert.rejects(
    books.read('architecture', 1),
    /no older revision was substituted/,
  )
  await assert.rejects(
    books.publish(intent),
    /no older revision was substituted/,
  )
  const catalog = await books.list()
  assert.equal(catalog.length, 1)
  assert.equal(catalog[0]?.status, 'unavailable')
  assert.deepEqual(await readFile(legacyPath), bytes)
  assert.equal(await readFile(path, 'utf8'), '{corrupt')
})

test('an interrupted first version 2 publication preserves the legacy book and its recoverable original receipt', async (context) => {
  // Arrange
  const { books, intent, path, library } = await bookHarness(context)
  await library.readProgress()
  const bytes = await readFile(
    resolve(
      __dirname,
      '../../src/tests/fixtures/cycle-0009-legacy/architecture.book.v1.json',
    ),
  )
  const legacyPath = join(library.directory, 'architecture.book.v1.json')
  await writeFile(legacyPath, bytes)
  context.mock.method(filesystem, 'rename', async () => {
    throw new Error('Injected migration rename failure')
  })
  // Act / Assert
  await assert.rejects(
    books.publish({ ...intent, key: 'second', expectedRevision: 1 }),
    /migration rename failure/,
  )
  assert.deepEqual(await readFile(legacyPath), bytes)
  await assert.rejects(readFile(path), { code: 'ENOENT' })
  assert.equal(
    (await books.publish(intent)).hash,
    'a772171df763a8ecf607b077b1ecff6a995fbbde8bbf18e7fee848e7b2028290',
  )
  assert.deepEqual(await readdir(library.directory), [
    'architecture.book.v1.json',
  ])
})

test('a configured observation links back to its source-only article without rebinding its complete-citation learning identity', async (context) => {
  // Arrange
  const { books, library, track } = await bookHarness(context),
    study = createConfiguredStudy()
  study.workspaceKey = workspaceKey
  for (const source of study.descriptor!.sources)
    await track(source.path, source.text)
  const document: BookDocument = {
    title: 'Interface',
    summary: 'Theme behavior.',
    nodes: [
      {
        id: 'theme',
        title: 'Theme',
        sections: [{ title: 'Selection', text: 'A source-grounded article.' }],
        anchors: study.descriptor!.anchors,
        observations: [],
      },
    ],
    edges: [],
  }
  const first: BookPublishIntent = {
    bookId: 'interface',
    key: 'source-only',
    expectedRevision: 0,
    document,
  }
  await books.publish(first)
  await library.decide({
    id: '77777777-7777-4777-8777-777777777777',
    item: 'repository/interface/theme',
    sourceHash: study.configuration.source.hash,
    context: study.descriptor!.citationContext,
    understood: true,
    at: '2026-09-20T00:00:00.000Z',
  })
  await library.saveStudy(study)
  const progress = await library.readProgress(),
    observation = study.observations[0]!
  // Act
  const receipt = await books.publish({
    ...first,
    key: 'observed',
    expectedRevision: 1,
    document: {
      ...document,
      nodes: [
        {
          ...document.nodes[0]!,
          observations: [
            {
              studyId: study.id,
              observationId: observation.id,
              sourceHash: observation.source.hash,
            },
          ],
        },
      ],
    },
  })
  const linked = await books.read('interface', 2)
  // Assert
  assert.equal(receipt.revision, 2)
  assert.equal(linked.links[0]?.itemId, 'repository/interface/theme')
  assert.equal(linked.links[0]?.status, 'available')
  assert.equal(linked.links[0]?.outcome, 'demonstrated')
  assert.equal(linked.links[0]?.recording.status, 'unavailable')
  assert.equal(linked.revision.document.nodes[0]?.learningItemId, undefined)
  assert.deepEqual((await library.readProgress()).decisions, progress.decisions)
  const stored = JSON.parse(
    await readFile(join(library.directory, 'interface.book.v2.json'), 'utf8'),
  )
  assert.equal(
    repositoryBookSchema.safeParse({ ...stored, version: 1 }).success,
    false,
  )
})

test('a configured observation cannot be attached as another repository learning item', async (context) => {
  // Arrange
  const { books, library, track } = await bookHarness(context),
    study = createConfiguredStudy()
  study.workspaceKey = workspaceKey
  for (const source of study.descriptor!.sources)
    await track(source.path, source.text)
  await library.saveStudy(study)
  const observation = study.observations[0]!
  const document: BookDocument = {
    title: 'Other article',
    summary: 'Different identity.',
    nodes: [
      {
        id: 'different',
        title: 'Different',
        sections: [{ title: 'Theme', text: 'Cannot inherit another item.' }],
        anchors: study.descriptor!.anchors,
        observations: [
          {
            studyId: study.id,
            observationId: observation.id,
            sourceHash: observation.source.hash,
          },
        ],
      },
    ],
    edges: [],
  }
  // Act / Assert
  await assert.rejects(
    books.publish({
      bookId: 'interface',
      key: 'wrong-item',
      expectedRevision: 0,
      document,
    }),
    /another learning item/,
  )
  assert.equal((await books.list()).length, 0)
  assert.equal((await library.readCheckpoint(study.id)).status, 'saved')
})
