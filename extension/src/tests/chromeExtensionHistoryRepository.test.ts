import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import { SavedStudyStorageFullError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'

import {
  EXTENSION_WORKSPACE_KEY,
  extensionHistoryHeader,
} from './utils/chromeExtensionHistoryFixture'
import {
  nodeServerHistoryHeader,
  openServerRepository,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=a started extension history resolves to the chrome-extension profile and its store, and an id with no folder resolves to nothing; fails_when=the id resolves to the test or server store, or an unknown id resolves; no_claim=reading the history
test('the repository resolves an extension study id to the chrome-extension profile', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context, {
    workspaceKey: EXTENSION_WORKSPACE_KEY,
  })
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const writer = await repository.extensionHistories.start(header)
  writer.abandon()

  // Act
  const resolved = repository.resolve(header.studyId)
  const unknown = repository.resolve(
    '33333333-3333-4333-8333-333333333333_44444444-4444-4444-8444-444444444444',
  )

  // Assert
  assert.equal(resolved?.profile, 'chrome-extension')
  assert.equal(resolved?.store, repository.extensionHistories)
  assert.equal(unknown, undefined)
})

// protects=the node-test and node-server stores list, count and resolve nothing from the chrome-extensions.v1 folder, as 0.2.69.0 does not know it; fails_when=either older store lists, counts or holds the extension history; no_claim=a real 0.2.69.0 build
test('the test and server stores see nothing in the chrome-extension folder', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(
    context,
    {
      workspaceKey: EXTENSION_WORKSPACE_KEY,
    },
  )
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const writer = await repository.extensionHistories.start(header)
  writer.abandon()

  // Act
  const tests = await repository.testHistories.list()
  const servers = await repository.serverHistories.list()
  const extensions = await repository.extensionHistories.list()

  // Assert
  assert.equal(
    existsSync(join(learningDirectory, 'chrome-extensions.v1', header.studyId)),
    true,
  )
  assert.deepEqual(tests, [])
  assert.deepEqual(servers, [])
  assert.deepEqual(
    extensions.map((summary) => [summary.studyId, summary.extensionName]),
    [[header.studyId, 'Bookmark Notes']],
  )
  assert.equal(
    repository.testHistories.holdsHistoryFolder(header.studyId),
    false,
  )
  assert.equal(
    repository.serverHistories.holdsHistoryFolder(header.studyId),
    false,
  )
})

// protects=one limit counts every kind: an extension history takes the only place, so a server history cannot start, and the library's count sees it; fails_when=the server start succeeds, or countHistories misses the extension history; no_claim=the browser save path
test('an extension history takes a place of the shared limit that the server and test stores respect', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context, {
    limit: 1,
    workspaceKey: EXTENSION_WORKSPACE_KEY,
  })
  const writer = await repository.extensionHistories.start(
    extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
  )
  writer.abandon()

  // Act
  const serverStart = repository.serverHistories.start(
    nodeServerHistoryHeader(EXTENSION_WORKSPACE_KEY),
  )
  const counted = await repository.countHistories(10)
  const admission = await repository.testHistories.admission()

  // Assert
  await assert.rejects(serverStart, SavedStudyStorageFullError)
  assert.equal(counted, 1)
  assert.deepEqual(admission, { admits: false, taken: 1, limit: 1 })
})

// protects=the extension store counts the other two profiles too: a server history on a limit of one refuses an extension history, with the limit named; fails_when=the extension start succeeds past the shared limit; no_claim=the full-library sentence (the service part)
test('an extension history cannot start when a server history takes the only place', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context, {
    limit: 1,
    workspaceKey: EXTENSION_WORKSPACE_KEY,
  })
  const writer = await repository.serverHistories.start(
    nodeServerHistoryHeader(EXTENSION_WORKSPACE_KEY),
  )
  writer.abandon()

  // Act
  const start = repository.extensionHistories.start(
    extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
  )

  // Assert
  await assert.rejects(
    start,
    (error) => error instanceof SavedStudyStorageFullError && error.limit === 1,
  )
})

// protects=a history whose header is written by a later format is not listed, not counted and never deleted; fails_when=it is listed, counted or its folder is removed; no_claim=what a newer Codebook writes into it
test('a header of a newer format version is not listed, not counted and stays on disk', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(
    context,
    {
      workspaceKey: EXTENSION_WORKSPACE_KEY,
    },
  )
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const folder = join(learningDirectory, 'chrome-extensions.v1', header.studyId)
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'header.json'),
    JSON.stringify({ ...header, formatVersion: 2 }),
  )
  await writeFile(join(folder, 'events.jsonl'), '')

  // Act
  const listed = await repository.extensionHistories.list()
  const counted = await repository.extensionHistories.countListedHistories(10)

  // Assert
  assert.deepEqual(listed, [])
  assert.equal(counted, 0)
  assert.equal(existsSync(folder), true)
})

// protects=a sealed history with an entry in a context a later Codebook adds lists as unavailable with the format-newer sentence, not as a replay of the stops it knows; fails_when=it lists verified, with another reason, or is deleted; no_claim=the Saved studies wording
test('a sealed history that holds an unknown future context lists as unavailable with the format-newer sentence', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(
    context,
    {
      workspaceKey: EXTENSION_WORKSPACE_KEY,
    },
  )
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const writer = await repository.extensionHistories.start(header)
  writer.abandon()
  const folder = join(learningDirectory, 'chrome-extensions.v1', header.studyId)
  const journal = Buffer.from(
    `${JSON.stringify({
      type: 'pause-open',
      sequence: 1,
      elapsedMs: 5,
      pauseId: 'run:1:content-script:1',
      generation: 1,
      context: 'content-script',
      stopIndex: 1,
      targetUrl: 'https://example.com/',
      workerGeneration: 0,
    })}\n`,
  )
  await writeFile(join(folder, 'events.jsonl'), journal)
  await writeFile(
    join(folder, 'sealed.json'),
    JSON.stringify({
      version: 1,
      studyId: header.studyId,
      entryCount: 1,
      journalBytes: journal.byteLength,
      journalHash: sha256(journal),
      status: 'partial',
      endedAt: '2026-11-01T00:00:00.000Z',
      reasons: [
        {
          code: 'EXTENSION_HISTORY_RESULT_MISSING',
          params: {},
          text: 'The result of the run was not recorded.',
        },
      ],
      capture: 'incomplete',
    }),
  )

  // Act
  const [summary] = await repository.extensionHistories.list()

  // Assert
  assert.equal(summary?.verification, 'unavailable')
  assert.match(
    summary?.reason ?? '',
    /Recorded by a newer Codebook; update Codebook to open it\./,
  )
  assert.equal(existsSync(folder), true)
})
