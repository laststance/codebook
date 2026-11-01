import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import { createExtensionStorageDescriptor } from '../chromeExtensionStorageDescriptor'
import { SavedStudyStorageFullError } from '../errors'
import { NodeHistoryStore } from '../nodeTestHistoryStore'

import {
  EXTENSION_WORKSPACE_KEY,
  extensionHistoryHeader,
} from './utils/chromeExtensionHistoryFixture'
import {
  nodeServerHistoryHeader,
  openServerRepository,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import {
  writeExtensionHistory,
  type ExtensionScriptStep,
} from './utils/sealedExtensionHistory'

before(async () => {
  await realProcessStart(process.pid)
})

const REMOVAL_DIRECTORY = 'removed-histories.v1'

/** One page stop and a result: journal sequences 1 to 4. */
const SCRIPT: ExtensionScriptStep[] = [
  { at: 100, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
  { at: 101, type: 'capture', pauseId: 'p1', stopIndex: 1, context: 'page' },
  { at: 200, type: 'close', pauseId: 'p1' },
  { at: 300, type: 'result' },
]

/** Learning material citing the result of {@link SCRIPT}. */
const MATERIAL = {
  question: 'Why does Save fail?',
  title: 'Saving a note',
  summary: 'The popup asks the worker to save.',
  participants: [{ id: 'extension', label: 'Extension' }],
  steps: [
    {
      id: 'result',
      from: 'extension',
      to: 'extension',
      label: 'Result',
      explanation: 'The save changed the value.',
      evidence: 'observed' as const,
      reference: { type: 'result' as const, sequence: 4 },
    },
  ],
}

/** A repository over a fresh learning directory and one sealed extension history in it. */
async function openWithSealedHistory(context: TestContext, limit = 64) {
  const { repository, learningDirectory } = await openServerRepository(
    context,
    { limit, workspaceKey: EXTENSION_WORKSPACE_KEY },
  )
  const history = await writeExtensionHistory(
    learningDirectory,
    EXTENSION_WORKSPACE_KEY,
    SCRIPT,
  )
  return {
    repository,
    learningDirectory,
    store: repository.extensionHistories,
    studyId: history.studyId,
  }
}

// protects=deleting a sealed Extension replay takes it out of the listing and the shared limit and keeps its files in the removal staging folder for the Trash; fails_when=the history stays listed, still counts a place, or its files are gone before the Trash has them; no_claim=the editor's Trash move
test('removing a sealed extension history unlists it, frees its place and stages its files', async (context) => {
  // Arrange
  const { repository, learningDirectory, store, studyId } =
    await openWithSealedHistory(context, 1)
  const listedBefore = (await store.list()).length
  const placesBefore = await repository.countHistories(10)

  // Act
  const removal = await store.removeHistory(studyId, () => false)

  // Assert
  assert.equal(listedBefore, 1)
  assert.equal(placesBefore, 1)
  assert.equal(removal.outcome, 'removed')
  assert.equal(await store.list().then((list) => list.length), 0)
  assert.equal(await repository.countHistories(10), 0)
  assert.equal(store.holdsHistoryFolder(studyId), false)
  const staged = await readdir(join(learningDirectory, REMOVAL_DIRECTORY))
  assert.equal(staged.length, 1)
  assert.equal(staged[0]?.startsWith(`${studyId}.`), true)
  assert.equal(
    existsSync(
      join(learningDirectory, REMOVAL_DIRECTORY, staged[0], 'events.jsonl'),
    ),
    true,
  )
  // The freed place admits a new history under the limit of one.
  const writer = await store.start(
    extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
  )
  writer.abandon()
})

// protects=a history whose run still records in this window is never removed; fails_when=the rename runs under a live writer, so the run's next append fails; no_claim=a writer of another window
test('removing an extension history is refused while its writer is live in this window', async (context) => {
  // Arrange
  const { store, learningDirectory } = await openWithSealedHistory(context)
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const writer = await store.start(header)

  // Act
  const removal = await store.removeHistory(header.studyId, () => false)

  // Assert
  assert.deepEqual(removal, { outcome: 'refused', reason: 'recording' })
  assert.equal(store.holdsHistoryFolder(header.studyId), true)
  assert.equal(existsSync(join(learningDirectory, REMOVAL_DIRECTORY)), false)
  writer.abandon()
})

// protects=a history another window judged live still writes is never removed, a writer judged gone is; fails_when=a live foreign writer loses its folder or a crashed writer's history can never be deleted; no_claim=the process judge itself (injected)
test('removing an extension history is refused while another window’s writer is live and allowed once it is gone', async (context) => {
  // Arrange
  const { learningDirectory } = await openWithSealedHistory(context)
  const writing = new NodeHistoryStore(
    createExtensionStorageDescriptor(),
    learningDirectory,
    EXTENSION_WORKSPACE_KEY,
  )
  let verdict: 'live' | 'gone' | 'unread' = 'live'
  const reading = new NodeHistoryStore(
    createExtensionStorageDescriptor(),
    learningDirectory,
    EXTENSION_WORKSPACE_KEY,
    () => 64,
    async () => 0,
    { now: Date.now, judge: async () => verdict },
  )
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const writer = await writing.start(header)

  // Act
  const whileLive = await reading.removeHistory(header.studyId, () => false)
  verdict = 'unread'
  const whileUnreadable = await reading.removeHistory(
    header.studyId,
    () => false,
  )
  verdict = 'gone'
  const afterCrash = await reading.removeHistory(header.studyId, () => false)

  // Assert
  assert.deepEqual(whileLive, { outcome: 'refused', reason: 'recording' })
  assert.deepEqual(whileUnreadable, { outcome: 'refused', reason: 'recording' })
  assert.equal(afterCrash.outcome, 'removed')
  writer.abandon()
})

// protects=a window that cannot read another window's writer record (EMFILE, EBUSY) leaves that live recording's temporary frame blobs alone; fails_when=reading the history as interrupted removes `frames/*.tmp`, so the writing window's next rename fails and its later frames are lost; no_claim=the process judge itself (injected)
test('reading an unsealed extension history whose writer record cannot be read keeps its temporary frame blobs', async (context) => {
  // Arrange
  const { learningDirectory } = await openWithSealedHistory(context)
  const writing = new NodeHistoryStore(
    createExtensionStorageDescriptor(),
    learningDirectory,
    EXTENSION_WORKSPACE_KEY,
  )
  const reading = new NodeHistoryStore(
    createExtensionStorageDescriptor(),
    learningDirectory,
    EXTENSION_WORKSPACE_KEY,
    () => 64,
    async () => 0,
    { now: Date.now, judge: async () => 'unread' },
  )
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const writer = await writing.start(header)
  const framesDirectory = join(writer.historyDirectory, 'frames')
  await mkdir(framesDirectory, { recursive: true })
  const inFlight = join(framesDirectory, `${'a'.repeat(64)}.png.blob.tmp`)
  await writeFile(inFlight, 'partial png')

  // Act
  await reading.read(header.studyId)

  // Assert
  assert.equal(existsSync(inFlight), true)
  writer.abandon()
})

// protects=a replay the reader shows is never removed; fails_when=the folder moves under an open replay; no_claim=what the reader does after the refusal
test('removing an extension history is refused while its replay is open', async (context) => {
  // Arrange
  const { store, studyId } = await openWithSealedHistory(context)

  // Act
  const removal = await store.removeHistory(studyId, () => true)

  // Assert
  assert.deepEqual(removal, { outcome: 'refused', reason: 'open' })
  assert.equal(store.holdsHistoryFolder(studyId), true)
})

// protects=a reader-position write that is queued keeps the history, and a write accepted after the removal began is dropped without creating a folder; fails_when=the rename runs under a queued write or the late write recreates the history folder; no_claim=a write in another window
test('a removal and a reader-position write racing leave either the saved position or no folder, never a recreated one', async (context) => {
  // Arrange
  const { store, learningDirectory, studyId } =
    await openWithSealedHistory(context)
  const folder = join(learningDirectory, 'chrome-extensions.v1', studyId)

  // Act: the write is queued first, then the removal asks.
  const queued = store.saveReaderPosition(studyId, 1)
  const refused = await store.removeHistory(studyId, () => false)
  await queued
  // Act: the removal begins first, then a write is accepted.
  const removing = store.removeHistory(studyId, () => false)
  const late = store.saveReaderPosition(studyId, 1)
  const lateOutcome = await late.then(
    () => 'written',
    (error: Error) => error.message,
  )
  const removed = await removing

  // Assert
  assert.deepEqual(refused, { outcome: 'refused', reason: 'saving' })
  assert.equal(lateOutcome, 'No Node history has this study id.')
  assert.equal(removed.outcome, 'removed')
  assert.equal(existsSync(folder), false)
})

// protects=a learning-material save queued for a history keeps it, and a material save arriving after the removal is refused and recreates nothing; fails_when=the removal runs under a queued save or a late save recreates the folder; no_claim=a save of another window
test('a removal and a learning-material save racing leave either the saved material or no folder, never a recreated one', async (context) => {
  // Arrange
  const { store, learningDirectory, studyId } =
    await openWithSealedHistory(context)
  const folder = join(learningDirectory, 'chrome-extensions.v1', studyId)

  // Act
  const queued = store.saveLearningMaterial(studyId, 0, MATERIAL)
  const refused = await store.removeHistory(studyId, () => false)
  const saved = await queued
  const removed = await store.removeHistory(studyId, () => false)
  const lateSave = await store
    .saveLearningMaterial(studyId, saved.revision, MATERIAL)
    .then(
      () => 'saved',
      (error: Error) => error.message,
    )

  // Assert
  assert.deepEqual(refused, { outcome: 'refused', reason: 'saving' })
  assert.equal(saved.revision, 1)
  assert.equal(removed.outcome, 'removed')
  assert.equal(lateSave, 'No Node history has this study id.')
  assert.equal(existsSync(folder), false)
})

// protects=a rename that fails leaves the history listed with all its files and a refusal; fails_when=the history vanishes from the list or loses files when its staging folder cannot be made; no_claim=every filesystem failure mode
test('a failed rename leaves the extension history listed and unchanged', async (context) => {
  // Arrange: a file where the staging folder belongs makes the rename's first step fail.
  const { store, learningDirectory, studyId } = await openWithSealedHistory(
    context,
    1,
  )
  await writeFile(join(learningDirectory, REMOVAL_DIRECTORY), 'not a folder')

  // Act
  const removal = await store.removeHistory(studyId, () => false)

  // Assert
  assert.deepEqual(removal, { outcome: 'refused', reason: 'renameFailed' })
  assert.deepEqual(
    (await store.list()).map((summary) => summary.studyId),
    [studyId],
  )
  assert.equal(
    existsSync(join(store.historyDirectory(studyId), 'events.jsonl')),
    true,
  )
})

// protects=a second removal of one history is a refusal and releases no second place; fails_when=the second call reports removed or the shared count goes below the real number of histories; no_claim=concurrent removals from two windows
test('removing an extension history twice releases its place once', async (context) => {
  // Arrange
  const { repository, store, studyId } = await openWithSealedHistory(context, 2)
  const other = await store.start(
    extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
  )
  other.abandon()

  // Act
  const first = await store.removeHistory(studyId, () => false)
  const second = await store.removeHistory(studyId, () => false)

  // Assert
  assert.equal(first.outcome, 'removed')
  assert.deepEqual(second, { outcome: 'refused', reason: 'unknown' })
  assert.equal(await repository.countHistories(10), 1)
})

// protects=test and server histories keep refusing removal and stay listed; fails_when=enabling removal for the extension profile also removes a server history; no_claim=the Saved studies sentences (workspace tests)
test('test and server histories are never removed by the store', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context, {
    workspaceKey: EXTENSION_WORKSPACE_KEY,
  })
  const header = nodeServerHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  writer.abandon()

  // Act
  const server = await repository.serverHistories.removeHistory(
    header.studyId,
    () => false,
  )
  const test = await repository.testHistories.removeHistory(
    header.studyId,
    () => false,
  )

  // Assert
  assert.deepEqual(server, { outcome: 'refused', reason: 'unsupported' })
  assert.deepEqual(test, { outcome: 'refused', reason: 'unsupported' })
  assert.equal(
    repository.serverHistories.holdsHistoryFolder(header.studyId),
    true,
  )
})

// protects=two windows over one learning directory never both take the last place across the extension and server profiles; fails_when=both starts succeed so the library holds more histories than its limit; no_claim=which window wins
test('two windows starting an extension and a server history compete for the last place', async (context) => {
  // Arrange
  const first = await openServerRepository(context, {
    limit: 1,
    workspaceKey: EXTENSION_WORKSPACE_KEY,
  })
  const second = await openServerRepository(context, {
    limit: 1,
    workspaceKey: EXTENSION_WORKSPACE_KEY,
    learningDirectory: first.learningDirectory,
  })

  // Act
  const outcomes = await Promise.allSettled([
    first.repository.extensionHistories.start(
      extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
    ),
    second.repository.serverHistories.start(
      nodeServerHistoryHeader(EXTENSION_WORKSPACE_KEY),
    ),
  ])

  // Assert
  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
  assert.equal(fulfilled.length, 1)
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
  assert.equal(rejected?.reason instanceof SavedStudyStorageFullError, true)
  assert.equal(await first.repository.countHistories(10), 1)
  for (const outcome of fulfilled) outcome.value.abandon()
})
