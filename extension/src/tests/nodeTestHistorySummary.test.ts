import assert from 'node:assert/strict'
import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

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
