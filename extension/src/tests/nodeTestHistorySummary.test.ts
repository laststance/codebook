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
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

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

// Value: protects=the refresh's cost: a second list of unchanged sealed histories reads no journal again and answers the same summaries; fails_when=list() reads and hashes every journal at each refresh (every 250 ms); why_new=list() had no memo (NodeTestHistoryStore.list, EN7, AC20); seam=the store's read is counted; no_claim=absolute timings
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

// Value: protects=the bound on histories read at a time when a list finds new ones; fails_when=more than four journals are read at once; why_new=NODE_HISTORY_SUMMARY_READ_CONCURRENCY (EN7, AC20); seam=the store’s read is held by a gate the test opens one at a time and counted; no_claim=the order of the reads
test('a list reads at most four new histories at a time', async (context) => {
  // Arrange
  const { store, cleanup } = await storeWithSealedHistories(9)
  const read = NodeTestHistoryStore.prototype.read
  const held: (() => void)[] = []
  let reading = 0,
    started = 0,
    mostReadingAtOnce = 0
  context.mock.method(
    store,
    'read',
    async function (this: NodeTestHistoryStore, studyId: string) {
      reading++
      started++
      mostReadingAtOnce = Math.max(mostReadingAtOnce, reading)
      // Gate: each read waits until the test lets it go (no timer).
      await new Promise<void>((resolve) => held.push(resolve))
      try {
        return await read.call(this, studyId)
      } finally {
        reading--
      }
    },
  )
  try {
    // Act: the list runs; the test lets one held read go at a time and waits for the next to start.
    const listing = store.list()
    await waitUntil(() => started === 4, 'the first four reads', 2_000)
    for (let letGo = 0; letGo < 9; letGo++) {
      held.shift()?.()
      if (started < 9)
        await waitUntil(
          () => started === Math.min(9, 4 + letGo + 1),
          'the next read after one finished',
          2_000,
        )
    }
    const listed = await listing

    // Assert
    assert.equal(listed.length, 9)
    assert.equal(started, 9)
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

// Value: protects=the saved study limit against a history sealed with no entry before Decision D6 (D28); fails_when=such a history on disk keeps a place of the limit that the learner can neither see nor delete, so a new test run is refused, or its folder stays; why_new=the list hid it but the count did not (F213); seam=the legacy seal is written by hand; no_claim=histories of other windows
test('a legacy history sealed with no entry takes no place of the saved study limit and is removed when found', async (context) => {
  // Arrange
  const { directory, workspaceKey, store } = await emptyStore(context, () => 2)
  const kept = nodeTestHistoryHeader(workspaceKey)
  const keptWriter = await store.start(kept)
  await keptWriter.appendOutput({
    sequence: 1,
    elapsedMs: 1,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
  await keptWriter.finish('partial', 'The learner stopped this run.')
  const legacy = nodeTestHistoryHeader(workspaceKey)
  const legacyWriter = await store.start(legacy)
  legacyWriter.abandon()
  const legacyFolder = join(
    directory,
    NODE_TEST_HISTORY_DIRECTORY,
    legacy.studyId,
  )
  await writeFile(
    join(legacyFolder, 'sealed.json'),
    JSON.stringify({
      version: 1,
      studyId: legacy.studyId,
      entryCount: 0,
      journalBytes: 0,
      journalHash: sha256(''),
      status: 'partial',
      endedAt: '2026-09-28T00:00:01.000Z',
      reason: 'The learner stopped this run.',
    }),
  )

  // Act
  const admitted = await store.start(nodeTestHistoryHeader(workspaceKey))
  const names = await readdir(join(directory, NODE_TEST_HISTORY_DIRECTORY))

  // Assert
  assert.equal(admitted.header.workspaceKey, workspaceKey)
  assert.equal(names.includes(legacy.studyId), false)
  assert.equal(names.includes(kept.studyId), true)
})

// Value: protects=a recording read by two summaries at once (the 250 ms refresh and a history resource read); fails_when=both continue the shared scan from one offset, so the second applies the same entries again and the recording reads interrupted; why_new=advanceRecordingScan mutated the shared scan across awaits with no serialization per study (F216); seam=the first journal read is held until the second summary was asked for; no_claim=reads of different histories
test('two overlapping summaries of a growing recording leave it recording with no interrupted reason', async (context) => {
  // Arrange
  const { store, workspaceKey } = await emptyStore(context)
  const writer = await store.start(nodeTestHistoryHeader(workspaceKey))
  const appendOutput = (sequence: number): Promise<void> =>
    writer.appendOutput({
      sequence,
      elapsedMs: sequence,
      channel: 'stdout',
      text: `line ${sequence}`,
    })
  await appendOutput(1)
  const [first] = await store.list()
  await appendOutput(2)
  await appendOutput(3)
  const openBefore = fsPromises.open
  let releaseHeldRead!: () => void
  const heldRead = new Promise<void>((resolve) => {
    releaseHeldRead = resolve
  })
  let held = false
  context.mock.method(
    fsPromises,
    'open',
    async (...input: Parameters<typeof openBefore>) => {
      const handle = await openBefore(...input)
      if (input[1] !== 'r' || held) return handle
      held = true
      const readBefore = handle.read.bind(handle)
      handle.read = (async (...readInput: unknown[]) => {
        const result = await Reflect.apply(readBefore, handle, readInput)
        await heldRead
        return result
      }) as typeof handle.read
      return handle
    },
  )

  // Act
  const summaryA = store.summarize(first!.studyId)
  const summaryB = store.summarize(first!.studyId)
  await new Promise((resolve) => setImmediate(resolve))
  releaseHeldRead()
  const results = await Promise.all([summaryA, summaryB])

  // Assert
  assert.deepEqual(
    results.map((summary) => [summary?.status, summary?.reason]),
    [
      ['recording', undefined],
      ['recording', undefined],
    ],
  )
})

// Value: protects=a history Saved studies lists when a refresh fails to read both its journal and its header with a transient error; fails_when=the history disappears from Saved studies for that refresh and is not read again at the next; why_new=unavailableMemo returned nothing when its own header read failed too (F217); seam=the store's read and the header file read fail with EMFILE; no_claim=a header that is really corrupt (F102 test)
test('a listed history stays listed when a refresh fails to read its journal and header with too many open files, and is read again at the next', async (context) => {
  // Arrange
  const { directory, store, studyIds } = await storeWithSealedHistories(1)
  context.after(() => rm(directory, { recursive: true, force: true }))
  const studyId = studyIds[0]!
  const headerPath = join(
    directory,
    NODE_TEST_HISTORY_DIRECTORY,
    studyId,
    'header.json',
  )
  const [before] = await store.list()
  // Rewriting the header changes its signal, so the next refresh reads the history again.
  await writeFile(headerPath, await readFile(headerPath))
  const readFileBefore = fsPromises.readFile
  const refuse = (): never => {
    throw Object.assign(new Error('EMFILE: too many open files'), {
      code: 'EMFILE',
    })
  }
  const readCalls = context.mock.method(store, 'read', async () => refuse())
  const fileReads = context.mock.method(
    fsPromises,
    'readFile',
    async (...input: Parameters<typeof readFileBefore>) =>
      String(input[0]) === headerPath ? refuse() : readFileBefore(...input),
  )

  // Act
  const duringFailure = await store.list()
  readCalls.mock.restore()
  fileReads.mock.restore()
  const afterwards = await store.list()

  // Assert
  assert.deepEqual(duringFailure, [before])
  assert.deepEqual(afterwards, [before])
  assert.equal(store.isListedHistory(studyId), true)
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

/** A learning material that explains the one output entry every history of {@link storeWithSealedHistories} holds. */
const OUTPUT_MATERIAL = {
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
      evidence: 'observed' as const,
      reference: {
        type: 'output' as const,
        sequence: 1,
        channel: 'stdout' as const,
      },
    },
  ],
}

// Value: protects=the memo of a history whose folder is gone: the next list forgets it and the store no longer vouches for it as listed, while the other history stays listed; fails_when=a removed history stays listed after a list, or the prune forgets one that is still there; why_new=the prune searched an array for each memo, quadratic in the histories (F77 part 5); seam=none; no_claim=the prune's running time (a set lookup replaces the array search)
test('a history whose folder was removed is forgotten by the next list and the other stays listed', async () => {
  // Arrange
  const { directory, store, studyIds, cleanup } =
    await storeWithSealedHistories(2)
  try {
    await store.list()
    await rm(join(directory, NODE_TEST_HISTORY_DIRECTORY, studyIds[0]!), {
      recursive: true,
    })

    // Act
    const listed = await store.list()

    // Assert
    assert.deepEqual(
      listed.map((summary) => summary.studyId),
      [studyIds[1]],
    )
    assert.deepEqual(
      [
        store.isListedHistory(studyIds[0]!),
        store.isListedHistory(studyIds[1]!),
      ],
      [false, true],
    )
  } finally {
    await cleanup()
  }
})

// Value: protects=the memory bound of the summary memo: of twelve listed histories only the last eight keep the map of their citable events, so a changed material reads the journal again for exactly the other four; fails_when=every listed history keeps its map (no journal is read again), or none does (all twelve are read again); why_new=the memo kept citable maps for every listed history (F77 part 4); seam=the store's read is counted after the materials were saved; no_claim=which four histories lose their map (the oldest by creation time, then study id)
test('only the last eight of twelve listed histories keep their citable events, so a changed material reads the other four again', async (context) => {
  // Arrange
  const { store, studyIds, cleanup } = await storeWithSealedHistories(12)
  try {
    await store.list()
    for (const studyId of studyIds)
      await store.saveLearningMaterial(studyId, 0, OUTPUT_MATERIAL)
    const reads = context.mock.method(store, 'read')

    // Act
    const listed = await store.list()

    // Assert
    assert.equal(listed.length, 12)
    assert.ok(
      listed.every((summary) => summary.learningCoverage === 'complete'),
    )
    assert.equal(reads.mock.callCount(), 4)
  } finally {
    context.mock.restoreAll()
    await cleanup()
  }
})
