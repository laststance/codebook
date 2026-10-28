import assert from 'node:assert/strict'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import { NodeHistoryRepository } from '../nodeHistoryRepository'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'

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

// protects=each profile reads only its own header; fails_when=a test header in the server folder, or a server header in the test folder, is listed, counted or opened; no_claim=hand-edited histories beyond the header profile
test('a test header placed in the server folder is refused and listed nowhere', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const intruder = nodeTestHistoryHeader(SERVER_WORKSPACE_KEY)
  const folder = join(learningDirectory, 'node-servers.v1', intruder.studyId)
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'header.json'),
    JSON.stringify({ ...intruder, version: 1 }),
  )
  await writeFile(join(folder, 'events.jsonl'), '')

  // Act
  const reading = assert.rejects(
    repository.serverHistories.read(intruder.studyId),
  )
  const listed = await repository.serverHistories.list()
  const counted = await repository.serverHistories.countListedHistories(10)

  // Assert
  await reading
  assert.deepEqual(listed, [])
  assert.equal(counted, 0)
})

test('a server header placed in the test folder is refused by the test store', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  writer.abandon()
  await mkdir(join(learningDirectory, 'node-tests.v1'), { recursive: true })
  await cp(
    join(learningDirectory, 'node-servers.v1', header.studyId),
    join(learningDirectory, 'node-tests.v1', header.studyId),
    { recursive: true },
  )

  // Act
  const listed = await repository.testHistories.list()

  // Assert
  assert.deepEqual(listed, [])
})

// protects=a node-test header written by the new code has the keys v0.2.53.0 wrote, so an older extension still parses it; fails_when=a new required field or a changed profile appears in a test header; no_claim=other files of the folder
test('a test header written by the generalized store has exactly the keys of the v0.2.53.0 fixture header', async (context) => {
  // Arrange
  const { learningDirectory } = await openServerRepository(context)
  const store = new NodeTestHistoryStore(
    learningDirectory,
    SERVER_WORKSPACE_KEY,
  )
  const header = nodeTestHistoryHeader(SERVER_WORKSPACE_KEY)
  const fixtureFolder = join(
    __dirname,
    '../../src/tests/fixtures/node-test-history-v0.2.53.0/node-tests.v1',
  )
  const [fixtureStudy] = await readdir(fixtureFolder)
  const fixtureHeader = JSON.parse(
    await readFile(join(fixtureFolder, fixtureStudy!, 'header.json'), 'utf8'),
  )

  // Act
  const writer = await store.start(header)
  writer.abandon()
  const written = JSON.parse(
    await readFile(
      join(learningDirectory, 'node-tests.v1', header.studyId, 'header.json'),
      'utf8',
    ),
  )

  // Assert
  assert.deepEqual(
    Object.keys(written).sort(),
    Object.keys(fixtureHeader).sort(),
  )
  assert.equal(written.profile, 'node-test')
  assert.equal(written.version, 1)
})

// protects=a server history another window records lists as recording with what has been written, and opens its verified prefix; fails_when=it lists as interrupted or unavailable while its writer lives; no_claim=deleting it, which belongs to the workspace's Trash path (pt2)
test('a live server history recorded in one window lists as recording in another with its request line and stops', async (context) => {
  // Arrange
  const first = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 2,
  })
  const writer = await first.repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/api/items',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  await writer.appendStop(
    serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 10 }),
  )
  const secondWindow = new NodeHistoryRepository(
    first.learningDirectory,
    SERVER_WORKSPACE_KEY,
    () => 64,
    async () => 0,
  )

  // Act
  const listed = await secondWindow.serverHistories.list()
  const opened = await secondWindow.serverHistories.read(header.studyId)

  // Assert
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.status, 'recording')
  assert.equal(listed[0]?.requestLine, 'POST /api/items')
  assert.equal(listed[0]?.stopCount, 1)
  assert.equal(listed[0]?.reachedStopCount, 1)
  assert.equal(listed[0]?.declaredStopCount, 2)
  assert.equal(opened.status, 'recording')
  assert.deepEqual(
    opened.entries.map((entry) => entry.type),
    ['request', 'request-sent', 'source', 'stop'],
  )
  writer.abandon()
})

// protects=nothing secret-named or secret-shaped from the declaration reaches any file of the folder; fails_when=a body field, query value or token in the request path is written; no_claim=output and failure messages, which the run's redactors own and pt3 tests end to end
test('a secret-named body field and a query token of the declaration reach no file of the history folder', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    path: '/api/login?api_key=CANARY-QUERY-9d1',
    body: '{"password":"CANARY-BODY-7c4","name":"ada"}',
  })
  const writer = await repository.serverHistories.start(header)

  // Act
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/api/login?api_key=CANARY-QUERY-9d1&Authorization=Bearer abcdefgh12345',
    bodyBytes: 41,
  })
  await writer.seal({ elapsedMs: 2, reason: 'stopped' })
  const folder = join(learningDirectory, 'node-servers.v1', header.studyId)
  const contents = await Promise.all(
    (await readdir(folder)).map((name) => readFile(join(folder, name), 'utf8')),
  )

  // Assert
  const everything = contents.join('\n')
  assert.equal(everything.includes('CANARY-QUERY-9d1'), false)
  assert.equal(everything.includes('CANARY-BODY-7c4'), false)
  assert.equal(everything.includes('abcdefgh12345'), false)
  // The non-secret field survives, escaped inside the header's JSON string.
  assert.equal(everything.includes('name\\":\\"ada'), true)
})

// protects=a server history with no request holds nothing to replay and its folder is removed at the seal; fails_when=an empty server history takes a place of the saved-study limit; no_claim=a history with learner files, which stays like a test history
test('a server history that never opened a request is removed when it seals and takes no place of the limit', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context, { limit: 1 })
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  await writer.appendOutput({
    elapsedMs: 1,
    channel: 'stdout',
    text: 'booting\n',
  })

  // Act
  await writer.seal({ elapsedMs: 2, reason: 'failed', code: 'PORT_IN_USE' })

  // Assert
  assert.deepEqual(await repository.serverHistories.list(), [])
  assert.equal(await repository.countHistories(1), 0)
  assert.equal(repository.resolve(header.studyId), undefined)
})

// protects=the repository resolves a study id to the profile whose folder holds it and validates the id and sequence; fails_when=a path-like id resolves, or a bad sequence reads an entry; no_claim=ids of other workspaces
test('the repository resolves a server history by id and refuses a malformed id and a missing sequence', async (context) => {
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
  await writer.seal({ elapsedMs: 2, reason: 'stopped' })

  // Act
  const resolved = repository.resolve(header.studyId)
  const entry = await repository.entryAt(header.studyId, 1)

  // Assert
  assert.equal(resolved?.profile, 'node-server')
  assert.equal(entry.entry.type, 'request')
  assert.equal(repository.resolve('../../etc_passwd'), undefined)
  await assert.rejects(
    repository.entryAt(header.studyId, 0),
    /positive integer/,
  )
  await assert.rejects(
    repository.entryAt(header.studyId, 99),
    /no entry with this sequence/,
  )
})
