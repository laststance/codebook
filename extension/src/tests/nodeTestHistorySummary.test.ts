import assert from 'node:assert/strict'
import fsPromises, {
  appendFile,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { NODE_TEST_HISTORY_DIRECTORY } from '../constants'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'

import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

/** A store in a temporary learning directory holding `count` sealed histories of one output each. */
async function storeWithSealedHistories(count: number) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-history-summary-'))
  const workspaceKey = 'b'.repeat(64)
  const store = new NodeTestHistoryStore(directory, workspaceKey)
  const studyIds: string[] = []
  for (let index = 0; index < count; index++) {
    const header = nodeTestHistoryHeader(workspaceKey)
    const writer = await store.start(header)
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 3,
      channel: 'stdout',
      text: `RUN src/scheduler.test.ts (${index})`,
    })
    await writer.finish('partial', 'The learner stopped this run.')
    studyIds.push(header.studyId)
  }
  return {
    directory,
    store,
    studyIds,
    cleanup: (): Promise<void> =>
      rm(directory, { recursive: true, force: true }),
  }
}

// Value: protects=the refresh's cost: a second list of unchanged sealed histories reads no journal again and answers the same summaries; fails_when=list() reads and hashes every journal at each refresh (every 250 ms); why_new=list() had no memo (nodeTestHistoryStore.ts:264, EN7, AC20); seam=the store's read is counted; no_claim=absolute timings
test('a second list of unchanged sealed histories reads no journal again', async (context) => {
  // Arrange
  const { store, cleanup } = await storeWithSealedHistories(3)
  try {
    const first = await store.list()
    const reads = context.mock.method(store, 'read')

    // Act
    const second = await store.list()

    // Assert
    assert.equal(reads.mock.callCount(), 0)
    assert.deepEqual(second, first)
  } finally {
    context.mock.restoreAll()
    await cleanup()
  }
})

// Value: protects=a journal edited after its seal: the next list reads it again and shows it unavailable; fails_when=the memo keeps vouching for a sealed journal whose bytes changed; why_new=the memo's signal includes the journal's size and time (EN7); seam=none; no_claim=edits that keep size and time
test('a sealed journal changed after the last list is read again and listed unavailable', async () => {
  // Arrange
  const { directory, store, studyIds, cleanup } =
    await storeWithSealedHistories(1)
  try {
    await store.list()
    await appendFile(
      join(
        directory,
        NODE_TEST_HISTORY_DIRECTORY,
        studyIds[0]!,
        'events.jsonl',
      ),
      '{"type":"forged"}\n',
    )

    // Act
    const [listed] = await store.list()

    // Assert
    assert.equal(listed?.verification, 'unavailable')
  } finally {
    await cleanup()
  }
})

// Value: protects=a learning material saved after the last list: the next list counts it without reading the journal; fails_when=the changed material is missed, or the journal is read again for it; why_new=the summary keeps the citable events (EN7); seam=the store's read is counted after the save; no_claim=a material another window wrote with the same size and time
test('a learning material saved after the last list is counted without reading its journal again', async (context) => {
  // Arrange
  const { store, studyIds, cleanup } = await storeWithSealedHistories(1)
  const studyId = studyIds[0]!
  try {
    const [before] = await store.list()
    await store.saveLearningMaterial(studyId, 0, {
      question: 'What did the scheduler print?',
      title: 'Scheduler output',
      summary: 'The test printed its file before the learner stopped it.',
      participants: [
        { id: 'test', label: 'Test' },
        { id: 'scheduler', label: 'Scheduler' },
      ],
      steps: [
        {
          id: 'output',
          from: 'test',
          to: 'scheduler',
          label: 'Output',
          explanation: 'Vitest named the test file.',
          evidence: 'observed',
          reference: { type: 'output', sequence: 1, channel: 'stdout' },
        },
      ],
    })
    const reads = context.mock.method(store, 'read')

    // Act
    const [after] = await store.list()

    // Assert
    assert.equal(before?.learningCoverage, 'none')
    assert.equal(after?.learningCoverage, 'complete')
    assert.equal(after?.materialRevision, 1)
    assert.equal(reads.mock.callCount(), 0)
  } finally {
    context.mock.restoreAll()
    await cleanup()
  }
})

// Value: protects=the bound on histories read at a time when a list finds new ones; fails_when=more than four journals are read at once; why_new=NODE_HISTORY_SUMMARY_READ_CONCURRENCY (EN7, AC20); seam=the store's read is held briefly and counted; no_claim=the order of the reads
test('a list reads at most four new histories at a time', async (context) => {
  // Arrange
  const { store, cleanup } = await storeWithSealedHistories(9)
  const read = NodeTestHistoryStore.prototype.read
  let reading = 0,
    mostReadingAtOnce = 0
  context.mock.method(
    store,
    'read',
    async function (this: NodeTestHistoryStore, studyId: string) {
      reading++
      mostReadingAtOnce = Math.max(mostReadingAtOnce, reading)
      await new Promise((resolve) => setTimeout(resolve, 10))
      try {
        return await read.call(this, studyId)
      } finally {
        reading--
      }
    },
  )
  try {
    // Act
    const listed = await store.list()

    // Assert
    assert.equal(listed.length, 9)
    assert.equal(mostReadingAtOnce, 4)
  } finally {
    context.mock.restoreAll()
    await cleanup()
  }
})

/** A directory for a store, with the workspace key the fixture headers use, removed when the test ends. */
async function emptyStore(context: TestContext, capacity?: () => number) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-history-summary-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const workspaceKey = 'c'.repeat(64)
  return {
    directory,
    workspaceKey,
    store: new NodeTestHistoryStore(directory, workspaceKey, capacity),
  }
}

// Value: protects=Decision D6: a test history that seals with no entry is listed nowhere, takes no place of the saved study limit and leaves no folder; fails_when=Saved studies lists "0 of 0 stops explained" for a run that never reached its first output, or the empty history keeps the only place under a limit of one; why_new=a history sealed with no entry was listed and opened while the run resource read replayAvailable false (F85); seam=none; no_claim=the run resource's own field (service tests)
test('a history sealed with no entry is removed, listed nowhere and leaves its place of the saved study limit free', async (context) => {
  // Arrange
  const { directory, workspaceKey, store } = await emptyStore(context, () => 1)
  const empty = nodeTestHistoryHeader(workspaceKey)
  const writer = await store.start(empty)

  // Act
  const sealedHash = await writer.finish(
    'partial',
    'The learner stopped this run.',
  )
  const listed = await store.list()
  const names = await readdir(join(directory, NODE_TEST_HISTORY_DIRECTORY))
  const next = await store.start(nodeTestHistoryHeader(workspaceKey))

  // Assert
  assert.equal(
    sealedHash,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
  assert.deepEqual(listed, [])
  assert.deepEqual(names, [])
  assert.equal(store.isListedHistory(empty.studyId), false)
  assert.equal(next.header.workspaceKey, workspaceKey)
})

// Value: protects=Saved studies against a header that was corrupted or removed after the last list; fails_when=a history whose header.json now fails stays listed as verified from the memo although it cannot open; why_new=the summary memo did not watch header.json (F102); seam=none; no_claim=edits that keep the header's size and time
test('a history whose header was corrupted or removed after the last list is no longer listed as verified', async (context) => {
  // Arrange
  const { directory, store, studyIds } = await storeWithSealedHistories(2)
  context.after(() => rm(directory, { recursive: true, force: true }))
  const [corrupted, removed] = studyIds as [string, string]
  const firstList = await store.list()
  const headerOf = (studyId: string) =>
    join(directory, NODE_TEST_HISTORY_DIRECTORY, studyId, 'header.json')
  const original = await readFile(headerOf(corrupted), 'utf8')

  // Act
  await writeFile(headerOf(corrupted), 'x'.repeat(original.length))
  await rm(headerOf(removed))
  const secondList = await store.list()

  // Assert
  assert.deepEqual(
    firstList.map((summary) => summary.verification),
    ['verified', 'verified'],
  )
  assert.deepEqual(secondList, [])
  assert.equal(store.isListedHistory(corrupted), false)
  assert.equal(store.isListedHistory(removed), false)
})

// Value: protects=a refresh and Save's read-back Retry after a transient read error; fails_when=an EBUSY on the journal is remembered as unavailable until a file changes, so the next list keeps saying unavailable; why_new=the summary memo kept any failed read (F63); seam=the store's read throws once; no_claim=the error codes other than EBUSY
test('a journal read that fails with a busy file is read again at the next list instead of staying unavailable', async (context) => {
  // Arrange
  const { directory, store } = await storeWithSealedHistories(1)
  context.after(() => rm(directory, { recursive: true, force: true }))
  context.mock.method(
    store,
    'read',
    async () => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), {
        code: 'EBUSY',
      })
    },
    { times: 1 },
  )

  // Act
  const [whileBusy] = await store.list()
  const [afterwards] = await store.list()

  // Assert
  assert.equal(whileBusy?.verification, 'unavailable')
  assert.equal(afterwards?.verification, 'verified')
  assert.equal(afterwards?.status, 'partial')
})

// Value: protects=the learning coverage after a transient error reading the learning material; fails_when=one EMFILE on learning-material.json is remembered as no material, so coverage reads none until the file changes; why_new=the memo kept a material read error as no material (F63); seam=the file system's readFile fails once for the material; no_claim=a material that really does not parse (counted as none)
test('a learning material read that fails with too many open files is read again at the next list', async (context) => {
  // Arrange
  const { directory, store, studyIds } = await storeWithSealedHistories(1)
  context.after(() => rm(directory, { recursive: true, force: true }))
  await store.saveLearningMaterial(studyIds[0]!, 0, {
    question: 'What did the scheduler print?',
    title: 'Scheduler output',
    summary: 'The test printed its file before the learner stopped it.',
    participants: [
      { id: 'test', label: 'Test' },
      { id: 'scheduler', label: 'Scheduler' },
    ],
    steps: [
      {
        id: 'output',
        from: 'test',
        to: 'scheduler',
        label: 'Output',
        explanation: 'Vitest named the test file.',
        evidence: 'observed',
        reference: { type: 'output', sequence: 1, channel: 'stdout' },
      },
    ],
  })
  const readFileBefore = fsPromises.readFile
  let refused = false
  context.mock.method(
    fsPromises,
    'readFile',
    async (...input: Parameters<typeof readFileBefore>) => {
      if (String(input[0]).endsWith('learning-material.json') && !refused) {
        refused = true
        throw Object.assign(new Error('EMFILE: too many open files'), {
          code: 'EMFILE',
        })
      }
      return readFileBefore(...input)
    },
  )

  // Act
  const [whileRefused] = await store.list()
  const [afterwards] = await store.list()

  // Assert
  assert.equal(whileRefused?.learningCoverage, 'none')
  assert.equal(afterwards?.learningCoverage, 'complete')
})

// Value: protects=a summary's reason from naming this machine's storage folder; fails_when=the unavailable reason carries the learning directory's absolute path; why_new=the reason was String(error) (F15); seam=the store's read throws a path-bearing error; no_claim=the roots the workspace adds
test('an unavailable history’s reason names no storage path', async (context) => {
  // Arrange
  const { directory, store } = await storeWithSealedHistories(1)
  context.after(() => rm(directory, { recursive: true, force: true }))
  context.mock.method(store, 'read', async () => {
    throw new Error(
      `EACCES: permission denied, open '${directory}/node-tests.v1/x/events.jsonl'`,
    )
  })

  // Act
  const [listed] = await store.list()

  // Assert
  assert.equal(
    listed?.reason,
    "History integrity check failed: EACCES: permission denied, open '<storage>/node-tests.v1/x/events.jsonl'",
  )
})

// Value: protects=a history this window stopped writing without a seal: the next list shows it interrupted, not still recording; fails_when=the summary memo keeps saying recording after the writer was abandoned; why_new=the memo after a writer ends without a seal was untested (F22); seam=none; no_claim=a writer that sealed (other tests)
test('a history whose writer ended without a seal is listed interrupted at the next list', async (context) => {
  // Arrange
  const { store, workspaceKey } = await emptyStore(context)
  const writer = await store.start(nodeTestHistoryHeader(workspaceKey))
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 2,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
  const [whileWriting] = await store.list()

  // Act
  writer.abandon()
  const [afterwards] = await store.list()

  // Assert
  assert.equal(whileWriting?.status, 'recording')
  assert.equal(afterwards?.status, 'interrupted')
  assert.equal(
    afterwards?.reason,
    'Node test history has no verified final seal.',
  )
})

// Value: protects=the refresh's cost for a history this window still writes; fails_when=each refresh reads the whole journal again, so 50 refreshes read far more than twice the final journal; why_new=a growing recording was read, parsed and summarized in full at every refresh (F64); seam=the bytes the store reads through the file system are counted; no_claim=wall-clock time
test('fifty refreshes of a growing recording read at most twice the final journal size', async (context) => {
  // Arrange
  const { directory, store, workspaceKey } = await emptyStore(context)
  const header = nodeTestHistoryHeader(workspaceKey)
  const writer = await store.start(header)
  let bytesRead = 0
  const openBefore = fsPromises.open
  const readFileBefore = fsPromises.readFile
  context.mock.method(
    fsPromises,
    'open',
    async (...input: Parameters<typeof openBefore>) => {
      const handle = await openBefore(...input)
      const readBefore = handle.read.bind(handle)
      handle.read = (async (...readInput: unknown[]) => {
        const result = await Reflect.apply(readBefore, handle, readInput)
        bytesRead += result.bytesRead
        return result
      }) as typeof handle.read
      return handle
    },
  )
  context.mock.method(
    fsPromises,
    'readFile',
    async (...input: Parameters<typeof readFileBefore>) => {
      const content = await readFileBefore(...input)
      bytesRead += content.length
      return content
    },
  )

  // Act
  for (let index = 1; index <= 50; index++) {
    await writer.appendOutput({
      sequence: index,
      elapsedMs: index,
      channel: 'stdout',
      text: `line ${index} ${'x'.repeat(900)}`,
    })
    await store.list()
  }
  const journalBytes = (
    await stat(
      join(
        directory,
        NODE_TEST_HISTORY_DIRECTORY,
        header.studyId,
        'events.jsonl',
      ),
    )
  ).size
  const [summary] = await store.list()

  // Assert
  assert.ok(journalBytes > 45_000, `journal is ${journalBytes} bytes`)
  assert.ok(
    bytesRead <= 2 * journalBytes,
    `read ${bytesRead} bytes for a journal of ${journalBytes}`,
  )
  assert.equal(summary?.status, 'recording')
})
