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
  serverStopCapture,
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

/** Writes the request, its sent mark, one stop hit and the response of a one-stop server run: everything but its seal. */
async function writeWholeServerRun(
  writer: Awaited<ReturnType<typeof startServerRun>>['writer'],
): Promise<void> {
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/x',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  await writer.appendStop(
    serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 3 }),
  )
  await writer.appendResponse({
    elapsedMs: 4,
    status: 200,
    contentType: null,
    body: '',
    bodyBytes: 0,
    readCut: false,
    location: null,
    requestDurationMs: 1,
  })
}

/** Starts a server history declaring one stop and returns its writer and store. */
async function startServerRun(context: TestContext) {
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  return { writer, store: repository.serverHistories, header }
}

// protects=a cleanly finished run seals complete although its output keeps arriving while the seal drains; fails_when=an output offered after the seal began is queued behind end, refused, and the run seals partial with SERVER_HISTORY_APPEND_FAILED; no_claim=entries accepted before the seal began (their own test)
test('output offered after the seal began, in the same turn and in a later one, is not written and the run still seals complete', async (context) => {
  // Arrange
  const { writer, store, header } = await startServerRun(context)
  await writeWholeServerRun(writer)
  const hold = holdSyncOf(context, 'events.jsonl')

  // Act
  const sealed = writer.seal({ elapsedMs: 5, reason: 'stopped' })
  const sameTurn = writer.appendOutput({
    elapsedMs: 6,
    channel: 'stdout',
    text: 'same turn\n',
  })
  await hold.held
  const laterTurn = writer.appendOutput({
    elapsedMs: 7,
    channel: 'stdout',
    text: 'later turn\n',
  })
  hold.release()
  await Promise.all([sealed, sameTurn, laterTurn])
  context.mock.restoreAll()
  const opened = await store.read(header.studyId)

  // Assert
  assert.deepEqual(
    opened.entries.map((entry) => entry.type),
    ['request', 'request-sent', 'source', 'stop', 'response', 'end'],
  )
  assert.equal(opened.status, 'complete')
  assert.deepEqual(opened.seal?.reasons, [])
})

// protects=a retried seal after a failed sealed.json write writes end once and seals complete; fails_when=the retry appends a second end, which is refused and recorded as SERVER_HISTORY_APPEND_FAILED; no_claim=which write failed
test('a seal retried after its sealed.json write failed keeps one end and seals complete', async (context) => {
  // Arrange
  const { writer, store, header } = await startServerRun(context)
  await writeWholeServerRun(writer)
  const renameBefore = fsPromises.rename
  let failed = false
  context.mock.method(
    fsPromises,
    'rename',
    async (...input: Parameters<typeof renameBefore>) => {
      if (!failed && String(input[1]).endsWith('sealed.json')) {
        failed = true
        throw new Error('rename refused once')
      }
      return renameBefore(...input)
    },
  )
  await assert.rejects(
    writer.seal({ elapsedMs: 5, reason: 'stopped' }),
    /rename refused once/,
  )

  // Act
  await writer.seal({ elapsedMs: 6, reason: 'stopped' })
  context.mock.restoreAll()
  const opened = await store.read(header.studyId)

  // Assert
  assert.equal(opened.entries.filter((entry) => entry.type === 'end').length, 1)
  assert.equal(opened.status, 'complete')
  assert.deepEqual(opened.seal?.reasons, [])
})

// protects=the inherited finish never publishes a server seal that the read path refuses; fails_when=finish seals complete without end and the history then reads corrupt; no_claim=the status finish is asked for
test('finish on a server history writes end first, so the sealed history reads back', async (context) => {
  // Arrange
  const { writer, store, header } = await startServerRun(context)
  await writeWholeServerRun(writer)

  // Act
  await writer.finish('complete')
  const opened = await store.read(header.studyId)

  // Assert
  assert.deepEqual(
    opened.entries.map((entry) => entry.type),
    ['request', 'request-sent', 'source', 'stop', 'response', 'end'],
  )
  assert.equal(opened.status, 'complete')
})

// protects=an entry refused or failing after the rules checked it leaves the rules' progress unchanged; fails_when=a request whose write failed still counts as the history's request, so the history is kept instead of removed at its seal; no_claim=the disk error's wording
test('a request whose write failed leaves nothing to replay, so the history is removed at its seal', async (context) => {
  // Arrange
  const { writer, store, header } = await startServerRun(context)
  const openBefore = fsPromises.open
  context.mock.method(
    fsPromises,
    'open',
    async (...input: Parameters<typeof openBefore>) => {
      if (String(input[0]).endsWith('events.jsonl'))
        throw new Error('disk full')
      return openBefore(...input)
    },
  )
  await assert.rejects(
    writer.appendRequest({
      elapsedMs: 1,
      attempt: 1,
      method: 'POST',
      path: '/x',
      bodyBytes: 0,
    }),
    /disk full/,
  )
  context.mock.restoreAll()

  // Act
  await writer.seal({ elapsedMs: 2, reason: 'stopped' })

  // Assert
  await assert.rejects(store.read(header.studyId), /ENOENT/)
})

// protects=an abandon that lands while sealed.json is being published leaves no sealed.json, so the folder lists interrupted as reported; fails_when=the seal published after the abandon check and the file stays; no_claim=a rename that fails
test('a seal abandoned while its sealed.json is being published removes it and the folder reads interrupted', async (context) => {
  // Arrange
  const { writer, store, header, folder } = await startTestHistory(context)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 1,
    channel: 'stdout',
    text: 'a\n',
  })
  const renameBefore = fsPromises.rename
  context.mock.method(
    fsPromises,
    'rename',
    async (...input: Parameters<typeof renameBefore>) => {
      // The abandon lands while the publish is in flight.
      if (String(input[1]).endsWith('sealed.json')) writer.abandon()
      return renameBefore(...input)
    },
  )

  // Act
  const outcome = await writer.finish('partial', 'Stopped.').then(
    () => 'published',
    (error: Error) => error.message,
  )
  context.mock.restoreAll()
  const opened = await store.read(header.studyId)

  // Assert
  assert.match(outcome, /abandoned/)
  assert.equal((await readdir(folder)).includes('sealed.json'), false)
  assert.equal(opened.status, 'interrupted')
})
