import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, test } from 'node:test'

import {
  NODE_SERVER_HISTORY_DIRECTORY,
  NODE_TEST_HISTORY_DIRECTORY,
} from '../constants'
import { nodeServerStorageDescriptor } from '../nodeServerStorageDescriptor'
import { NodeHistoryStore, NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { nodeTestStorageDescriptor } from '../nodeTestStorageDescriptor'
import { sha256 } from '../runtimeSupport/utils/sha256'

import {
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

const WORKSPACE_KEY = sha256('node-history-header-version-workspace')

/**
 * Reads a JSON file of a history folder.
 * @param path - Absolute path of the file.
 * @returns The parsed object.
 * @example await readJson('/tmp/x/header.json') // => { version: 2, … }
 */
async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8'))
}

/**
 * Reads every file of a folder as name and base64 bytes so two reads can be compared byte for byte.
 * @param folder - Absolute folder path.
 * @returns Bytes by file name.
 * @example await folderBytes('/tmp/x/history') // => { 'header.json': '…' }
 */
async function folderBytes(folder: string): Promise<Record<string, string>> {
  // The writer marker (`writer.json`) leaves when the writer closes, after the history is sealed, so it is not part of the history's bytes.
  const names = (await readdir(folder))
    .filter((name) => name !== 'writer.json')
    .sort()
  return Object.fromEntries(
    await Promise.all(
      names.map(
        async (name) =>
          [
            name,
            (await readFile(join(folder, name))).toString('base64'),
          ] as const,
      ),
    ),
  )
}

test('a new test replay writes header version 2 with a version 1 seal and reads back sealed', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-header-v2-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const header = nodeTestHistoryHeader(WORKSPACE_KEY)
  const store = new NodeTestHistoryStore(directory, WORKSPACE_KEY)
  const writer = await store.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 1,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })

  // Act
  await writer.finish('partial', 'The learner stopped this run.')
  const reread = await new NodeTestHistoryStore(directory, WORKSPACE_KEY).read(
    header.studyId,
  )

  // Assert
  const folder = join(directory, NODE_TEST_HISTORY_DIRECTORY, header.studyId)
  assert.equal((await readJson(join(folder, 'header.json'))).version, 2)
  assert.equal((await readJson(join(folder, 'sealed.json'))).version, 1)
  assert.equal(reread.seal?.status, 'partial')
  assert.equal(reread.entries.length, 1)
})

test('an earlier Codebook that reads only header version 1 does not list a test replay saved with header 2 and leaves its files untouched', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-header-earlier-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const header = nodeTestHistoryHeader(WORKSPACE_KEY)
  const writer = await new NodeTestHistoryStore(directory, WORKSPACE_KEY).start(
    header,
  )
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 1,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
  await writer.finish('partial', 'The learner stopped this run.')
  const folder = join(directory, NODE_TEST_HISTORY_DIRECTORY, header.studyId)
  const bytesBefore = await folderBytes(folder)
  const earlierReader = new NodeHistoryStore(
    {
      ...nodeTestStorageDescriptor,
      // The header rule of the release before header version 2: only version 1 parses.
      parseHeader: (value) => {
        if ((value as { version?: unknown }).version !== 1)
          throw new Error('Unsupported header version.')
        return nodeTestStorageDescriptor.parseHeader(value)
      },
    },
    directory,
    WORKSPACE_KEY,
  )

  // Act
  const listed = await earlierReader.list()

  // Assert
  assert.deepEqual(listed, [])
  assert.deepEqual(await folderBytes(folder), bytesBefore)
})

test('a new server replay writes header formatVersion 2 with a version 1 seal and reads back sealed', async (context) => {
  // Arrange
  const { repository, learningDirectory: directory } =
    await openServerRepository(context)

  // Act
  const { header } = await writeServerHistory(repository)
  const reread = await repository.serverHistories.read(header.studyId)

  // Assert
  const folder = join(directory, NODE_SERVER_HISTORY_DIRECTORY, header.studyId)
  assert.equal((await readJson(join(folder, 'header.json'))).formatVersion, 2)
  assert.equal((await readJson(join(folder, 'sealed.json'))).version, 1)
  assert.equal(reread.seal?.status, 'complete')
})

test('an earlier Codebook that reads only server header version 1 does not list a server replay saved with header 2 and leaves its files untouched', async (context) => {
  // Arrange
  const { repository, learningDirectory: directory } =
    await openServerRepository(context)
  const { header } = await writeServerHistory(repository)
  const folder = join(directory, NODE_SERVER_HISTORY_DIRECTORY, header.studyId)
  const bytesBefore = await folderBytes(folder)
  const earlierReader = new NodeHistoryStore(
    {
      ...nodeServerStorageDescriptor,
      // The header rule of the release before header version 2: only formatVersion 1 parses.
      parseHeader: (value) => {
        if ((value as { formatVersion?: unknown }).formatVersion !== 1)
          throw new Error('Unsupported header version.')
        return nodeServerStorageDescriptor.parseHeader(value)
      },
    },
    directory,
    SERVER_WORKSPACE_KEY,
  )

  // Act
  const listed = await earlierReader.list()

  // Assert
  assert.deepEqual(listed, [])
  assert.deepEqual(await folderBytes(folder), bytesBefore)
})

// Value: protects=a node-test history saved with header version 1 (before this release) still lists and reads; fails_when=the header schema accepts only version 2; why_new=the other tests here write header 2 only; seam=none; no_claim=server histories (same union rule)
test('a node-test history saved with header version 1 still lists and reads sealed', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-header-v1-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const header = nodeTestHistoryHeader(WORKSPACE_KEY)
  const writer = await new NodeTestHistoryStore(directory, WORKSPACE_KEY).start(
    header,
  )
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 1,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
  await writer.finish('partial', 'The learner stopped this run.')
  const headerPath = join(
    directory,
    NODE_TEST_HISTORY_DIRECTORY,
    header.studyId,
    'header.json',
  )
  await writeFile(
    headerPath,
    JSON.stringify({ ...(await readJson(headerPath)), version: 1 }),
  )
  const store = new NodeTestHistoryStore(directory, WORKSPACE_KEY)

  // Act
  const listed = await store.list()
  const reread = await store.read(header.studyId)

  // Assert
  assert.equal(listed.length, 1)
  assert.equal(reread.seal?.status, 'partial')
})
