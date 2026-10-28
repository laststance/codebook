import assert from 'node:assert/strict'
import fsPromises, { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

/** Starts a server history, opens its request with the sent mark and returns what the state tests need. */
async function startOpenRequest(
  context: Parameters<typeof openServerRepository>[0],
) {
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/api/items',
    bodyBytes: 14,
  })
  return {
    repository,
    writer,
    header,
    store: repository.serverHistories,
    folder: join(learningDirectory, 'node-servers.v1', header.studyId),
  }
}

// protects=a seal that already published stays the history's truth when the writer is abandoned afterwards; fails_when=abandon after a seal removes the seal or reads the history as interrupted; no_claim=an abandon during the publish (covered by the seal coordinator tests)
test('abandoning a writer after its seal keeps the sealed history sealed', async (context) => {
  // Arrange
  const { writer, store, header, folder } = await startOpenRequest(context)
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  await writer.seal({ elapsedMs: 3, reason: 'stopped' })

  // Act
  writer.abandon()
  const opened = await store.read(header.studyId)

  // Assert
  assert.equal(opened.status, 'partial')
  assert.equal(opened.seal?.entryCount, 3)
  assert.ok((await readdir(folder)).includes('sealed.json'))
})

// protects=an abandon that lands while the temporary file's cleanup is still awaited after the rename keeps the published seal, its hash and the finish result; fails_when=sealed.json is removed or publishedSealHash/finish report no hash after the seal was published; no_claim=an abandon during the rename itself
test('abandoning during the temporary cleanup after the rename keeps the published seal', async (context) => {
  // Arrange
  const { writer, store, header, folder } = await startOpenRequest(context)
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  const unlinkBefore = fsPromises.unlink
  let releaseCleanup: () => void = () => undefined
  const cleanupStalled = new Promise<void>((resolve) => {
    releaseCleanup = resolve
  })
  let cleanupStarted: () => void = () => undefined
  const cleanupReached = new Promise<void>((resolve) => {
    cleanupStarted = resolve
  })
  context.mock.method(
    fsPromises,
    'unlink',
    async (...input: Parameters<typeof unlinkBefore>) => {
      if (String(input[0]).includes('sealed.json')) {
        cleanupStarted()
        await cleanupStalled
      }
      return unlinkBefore(...input)
    },
  )
  const sealing = writer.seal({ elapsedMs: 3, reason: 'stopped' })
  await cleanupReached

  // Act
  writer.abandon()
  releaseCleanup()
  const sealedHash = await sealing
  const opened = await store.read(header.studyId)

  // Assert
  assert.equal(typeof sealedHash, 'string')
  assert.equal(writer.publishedSealHash, sealedHash)
  assert.ok((await readdir(folder)).includes('sealed.json'))
  assert.equal(opened.status, 'partial')
})

// protects=an abandoned writer accepts nothing more; fails_when=an entry offered after abandon is written after the history was reported interrupted; no_claim=the wording of the refusal beyond naming the closed history
test('an abandoned writer refuses a later entry and leaves its journal as it was', async (context) => {
  // Arrange
  const { writer, store, header } = await startOpenRequest(context)
  writer.abandon()

  // Act
  const refused = writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })

  // Assert
  await assert.rejects(refused, /already sealing or sealed/)
  const opened = await store.read(header.studyId)
  assert.deepEqual(
    opened.entries.map((entry) => entry.type),
    ['request'],
  )
  assert.equal(opened.status, 'interrupted')
})

// protects=a seal requested on an abandoned writer publishes nothing and does not throw; fails_when=finish after abandon writes sealed.json over a folder already reported interrupted; no_claim=the return value of a normal seal
test('finish on an abandoned writer resolves with no hash and publishes no seal', async (context) => {
  // Arrange
  const { writer, store, header, folder } = await startOpenRequest(context)
  writer.abandon()

  // Act
  const hash = await writer.finish('partial')

  // Assert
  assert.equal(hash, undefined)
  assert.equal((await readdir(folder)).includes('sealed.json'), false)
  assert.equal((await store.read(header.studyId)).status, 'interrupted')
})

// protects=abandoning twice is harmless; fails_when=the second abandon throws or changes the interrupted state; no_claim=the writer record's removal timing
test('abandoning an abandoned writer again keeps the history interrupted', async (context) => {
  // Arrange
  const { writer, store, header } = await startOpenRequest(context)
  writer.abandon()

  // Act
  writer.abandon()
  const opened = await store.read(header.studyId)

  // Assert
  assert.equal(opened.status, 'interrupted')
  assert.equal(opened.entries.length, 1)
})

// protects=a writer abandoned after its sealed.json write failed stays abandoned and a late retry publishes nothing; fails_when=the retry seals the folder that was reported interrupted; no_claim=which write failed
test('a writer abandoned after its seal write failed publishes no seal on a later retry', async (context) => {
  // Arrange
  const { writer, store, header, folder } = await startOpenRequest(context)
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  const renameBefore = fsPromises.rename
  context.mock.method(
    fsPromises,
    'rename',
    async (...input: Parameters<typeof renameBefore>) => {
      if (String(input[1]).endsWith('sealed.json'))
        throw new Error('rename refused')
      return renameBefore(...input)
    },
  )
  await assert.rejects(
    writer.seal({ elapsedMs: 3, reason: 'stopped' }),
    /rename refused/,
  )

  // Act
  writer.abandon()
  context.mock.restoreAll()
  const retried = await writer.seal({ elapsedMs: 4, reason: 'stopped' })
  const opened = await store.read(header.studyId)

  // Assert
  assert.equal(retried, undefined)
  assert.equal((await readdir(folder)).includes('sealed.json'), false)
  assert.equal(opened.status, 'interrupted')
})

// protects=a request-sent mark is accepted once, for the open attempt; fails_when=a second mark for the same attempt or a mark before any request is written; no_claim=attempts beyond the first
for (const markCase of [
  {
    name: 'a second request-sent mark for the same attempt',
    prepare: async (
      writer: Awaited<ReturnType<typeof startOpenRequest>>['writer'],
    ): Promise<void> => {
      await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
    },
  },
  {
    name: 'a request-sent mark for an attempt never opened',
    prepare: async (): Promise<void> => {},
    attempt: 2,
  },
]) {
  test(`the server writer refuses ${markCase.name}`, async (context) => {
    // Arrange
    const { writer } = await startOpenRequest(context)
    await markCase.prepare(writer)

    // Act
    const refused = writer.appendRequestSent({
      elapsedMs: 3,
      attempt: markCase.attempt ?? 1,
    })

    // Assert
    await assert.rejects(refused, /marks no open request as sent/)
  })
}

// protects=a request-sent mark with no request at all is refused by the journal rules; fails_when=the writer accepts a mark that no request opened; no_claim=the writer's later seal
test('the server writer refuses a request-sent mark before any request was written', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const writer = await repository.serverHistories.start(
    nodeServerHistoryHeader(SERVER_WORKSPACE_KEY),
  )

  // Act
  const refused = writer.appendRequestSent({ elapsedMs: 1, attempt: 1 })

  // Assert
  await assert.rejects(refused, /marks no open request as sent/)
})
