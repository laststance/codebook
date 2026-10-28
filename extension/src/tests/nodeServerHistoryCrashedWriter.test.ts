import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import {
  NODE_SERVER_HISTORY_DIRECTORY,
  NODE_TEST_HISTORY_WRITER_FILE,
} from '../constants'

import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'
import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

/**
 * Names a process start of the same form as `start` that is not it, as the start of another process that took the same process id.
 * @param start - A process start as the writer record keeps it.
 * @returns The start with its last digit changed.
 * @example otherStartOf('linux@4026531836:100') // => 'linux@4026531836:101'
 */
function otherStartOf(start: string): string {
  return `${start.slice(0, -1)}${start.endsWith('0') ? '1' : '0'}`
}

/** A server history the writing window left unsealed, read by a second window over the same folder, with the path of its writer record. */
async function unsealedByAnotherWindow(context: TestContext) {
  const writing = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await writing.repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/x',
    bodyBytes: 0,
  })
  const reading = await openServerRepository(context, {
    learningDirectory: writing.learningDirectory,
  })
  const recordPath = join(
    writing.learningDirectory,
    NODE_SERVER_HISTORY_DIRECTORY,
    header.studyId,
    NODE_TEST_HISTORY_WRITER_FILE,
  )
  return { header, reading: reading.repository.serverHistories, recordPath }
}

// protects=a server history whose writing window is gone reads as interrupted and opens as a verified prefix, as a test history does; fails_when=a crashed server writer reads as recording for good, so the history stays unopenable; no_claim=deleting a server history (Saved studies offers no delete for histories)
for (const crash of [
  {
    name: 'a process that no system has',
    change: () => ({ pid: ID_OF_NO_PROCESS, hostname: hostname() }),
  },
  {
    name: 'a process id that went to another process',
    change: (record: Record<string, unknown>) => ({
      ...record,
      processStart: otherStartOf(String(record.processStart)),
    }),
  },
]) {
  test(`a server history whose writer record names ${crash.name} reads as interrupted and opens`, async (context) => {
    // Arrange
    const { header, reading, recordPath } =
      await unsealedByAnotherWindow(context)
    const [whileLive] = await reading.list()
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<
      string,
      unknown
    >
    await writeFile(recordPath, JSON.stringify(crash.change(record)))

    // Act
    const afterCrash = await reading.list()
    const opened = await reading.read(header.studyId)

    // Assert
    assert.equal(whileLive?.status, 'recording')
    assert.equal(afterCrash[0]?.status, 'interrupted')
    assert.equal(opened.status, 'interrupted')
    assert.equal(opened.entries.length, 1)
  })
}

// protects=a writer record of another machine counts as live, since this computer cannot probe it, as for a test history; fails_when=a record of another host reads as a crash; no_claim=a machine id match
test('a server history whose writer record names another machine reads as recording', async (context) => {
  // Arrange
  const { reading, recordPath } = await unsealedByAnotherWindow(context)
  await writeFile(
    recordPath,
    JSON.stringify({ pid: ID_OF_NO_PROCESS, hostname: 'another-machine' }),
  )

  // Act
  const [listed] = await reading.list()

  // Assert
  assert.equal(listed?.status, 'recording')
})
