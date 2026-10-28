import assert from 'node:assert/strict'
import fsPromises, { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { sha256 } from '../runtimeSupport/utils/sha256'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

/** Starts a test history and returns its writer, store and folder. */
async function startTestHistory(context: TestContext) {
  const learningDirectory = await mkdtemp(join(tmpdir(), 'codebook-seal-'))
  context.after(() => rm(learningDirectory, { recursive: true, force: true }))
  const store = new NodeTestHistoryStore(
    learningDirectory,
    sha256('node-history-test-workspace'),
  )
  const header = nodeTestHistoryHeader(store.workspaceKey)
  const writer = await store.start(header)
  return {
    writer,
    store,
    header,
    folder: join(learningDirectory, 'node-tests.v1', header.studyId),
  }
}

/** Holds the `sync` of every handle opened on a path ending `suffix` until `release` is called; other files are untouched. */
function holdSyncOf(context: TestContext, suffix: string) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let reportHeld!: () => void
  const held = new Promise<void>((resolve) => {
    reportHeld = resolve
  })
  const openBefore = fsPromises.open
  context.mock.method(
    fsPromises,
    'open',
    async (...input: Parameters<typeof openBefore>) => {
      const handle = await openBefore(...input)
      if (!String(input[0]).endsWith(suffix)) return handle
      const syncBefore = handle.sync.bind(handle)
      handle.sync = async (): Promise<void> => {
        reportHeld()
        await gate
        return syncBefore()
      }
      return handle
    },
  )
  return { held, release }
}

// protects=an entry accepted before the seal began is written even when the seal is requested in the same synchronous step; fails_when=the queued entry is refused with "already sealing" after the seal call set closing; no_claim=entries offered after the seal began
test('a test history keeps an output appended in the same synchronous turn as its finish', async (context) => {
  // Arrange
  const { writer, store, header } = await startTestHistory(context)

  // Act
  const accepted = writer.appendOutput({
    sequence: 1,
    elapsedMs: 5,
    channel: 'stdout',
    text: 'kept\n',
  })
  const sealed = writer.finish('partial', 'Cancelled by the learner.')
  await Promise.all([accepted, sealed])
  const opened = await store.read(header.studyId)

  // Assert
  assert.deepEqual(
    opened.entries.map((entry) => entry.type),
    ['output'],
  )
  assert.equal(opened.status, 'partial')
})

// protects=the same drain rule for a server history through its seal; fails_when=the accepted output is lost or the end is written before it; no_claim=timing of fsync
test('a server history keeps an output and a request appended in the same synchronous turn as its seal and writes end after them', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)

  // Act
  const output = writer.appendOutput({
    elapsedMs: 1,
    channel: 'stdout',
    text: 'kept\n',
  })
  const request = writer.appendRequest({
    elapsedMs: 2,
    attempt: 1,
    method: 'POST',
    path: '/x',
    bodyBytes: 0,
  })
  const sealed = writer.seal({ elapsedMs: 3, reason: 'stopped' })
  await Promise.all([output, request, sealed])
  const opened = await repository.serverHistories.read(header.studyId)

  // Assert
  assert.deepEqual(
    opened.entries.map((entry) => entry.type),
    ['output', 'request', 'end'],
  )
})

// protects=an entry offered after the seal began is refused at the call; fails_when=a late entry slips behind the seal; no_claim=which message the learner reads
test('an entry offered after the seal began is refused, and the sealed journal stays as it was', async (context) => {
  // Arrange
  const { writer, store, header } = await startTestHistory(context)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 1,
    channel: 'stdout',
    text: 'a\n',
  })
  const sealed = writer.finish('partial', 'Stopped.')

  // Act
  const lateOutcome = writer
    .appendOutput({
      sequence: 2,
      elapsedMs: 2,
      channel: 'stdout',
      text: 'late\n',
    })
    .then(
      () => 'accepted',
      (error: Error) => error.message,
    )
  await sealed

  // Assert
  assert.match(await lateOutcome, /already sealing or sealed/)
  assert.equal((await store.read(header.studyId)).entries.length, 1)
})

// protects=a finish that arrives during an fsync waits for that entry and seals it; fails_when=the seal reads the journal before the in-flight entry is durable; no_claim=power-loss durability
test('a finish called while an entry is being fsynced seals with that entry in the journal', async (context) => {
  // Arrange
  const { writer, store, header } = await startTestHistory(context)
  const hold = holdSyncOf(context, 'events.jsonl')
  const accepted = writer.appendOutput({
    sequence: 1,
    elapsedMs: 5,
    channel: 'stdout',
    text: 'in flight\n',
  })
  await hold.held

  // Act
  const sealed = writer.finish('partial', 'Stopped.')
  hold.release()
  await Promise.all([accepted, sealed])
  context.mock.restoreAll()
  const opened = await store.read(header.studyId)

  // Assert
  assert.equal(opened.entries.length, 1)
  assert.equal(opened.status, 'partial')
})

// protects=a timed-out seal that finishes its I/O later publishes nothing; fails_when=sealed.json appears after the folder was reported interrupted; no_claim=the status line the service words
test('a seal that times out and finishes its I/O afterwards leaves no sealed.json and the folder reads interrupted', async (context) => {
  // Arrange
  const { writer, store, header, folder } = await startTestHistory(context)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 1,
    channel: 'stdout',
    text: 'a\n',
  })
  const hold = holdSyncOf(context, '.tmp')
  const sealed = writer.finish('partial', 'Stopped.')
  await hold.held

  // Act
  writer.abandon()
  hold.release()
  const outcome = await sealed.then(
    () => 'published',
    (error: Error) => error.message,
  )
  context.mock.restoreAll()
  const opened = await store.read(header.studyId)

  // Assert
  assert.match(outcome, /abandoned before it was published/)
  assert.equal((await readdir(folder)).includes('sealed.json'), false)
  assert.equal(opened.status, 'interrupted')
})

// protects=Save, Stop and a self-exit that all ask for the seal at once give one seal; fails_when=two sealed.json writes or different hashes; no_claim=the service's own coordinator
test('three seals requested in one turn publish one sealed.json and return one hash', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/x',
    bodyBytes: 0,
  })
  const renameBefore = fsPromises.rename
  const publishedSeals: string[] = []
  context.mock.method(
    fsPromises,
    'rename',
    async (...input: Parameters<typeof renameBefore>) => {
      if (String(input[1]).endsWith('sealed.json'))
        publishedSeals.push(String(input[1]))
      return renameBefore(...input)
    },
  )

  // Act
  const hashes = await Promise.all([
    writer.seal({ elapsedMs: 2, reason: 'stopped' }),
    writer.seal({ elapsedMs: 3, reason: 'closed', exitCode: 0 }),
    writer.seal({ elapsedMs: 4, reason: 'failed', code: 'RUNTIME_FAILED' }),
  ])

  // Assert
  assert.equal(new Set(hashes).size, 1)
  assert.equal(publishedSeals.length, 1)
  const opened = await repository.serverHistories.read(header.studyId)
  assert.equal(opened.entries.filter((entry) => entry.type === 'end').length, 1)
})
