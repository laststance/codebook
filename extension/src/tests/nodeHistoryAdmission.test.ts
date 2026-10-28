import assert from 'node:assert/strict'
import fsPromises from 'node:fs/promises'
import { before, test, type TestContext } from 'node:test'

import { SavedStudyStorageFullError } from '../errors'
import { LearningLibrary } from '../learningLibrary'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import {
  nodeServerHistoryHeader,
  openServerRepository,
} from './utils/nodeServerHistoryFixture'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

/** One window: a repository and a library over one learning directory, sharing the saved-study limit, as the workspace wires them. */
async function openWindow(
  context: TestContext,
  limit: number,
  learningDirectory?: string,
) {
  const study = createConfiguredStudy()
  // The workspace wires the repository to the library's own count, and the library to the repository's.
  let libraryOfWindow: LearningLibrary | undefined
  const opened = await openServerRepository(context, {
    limit,
    workspaceKey: study.workspaceKey,
    learningDirectory,
    savedStudies: () => libraryOfWindow!.savedStudyCount(),
  })
  const library = (libraryOfWindow = new LearningLibrary(
    opened.learningDirectory,
    study.workspaceKey,
    () => limit,
    () => 'available',
    (places) => opened.repository.countHistories(places),
  ))
  return { ...opened, library, study }
}

/** Counts how many of the settled results are fulfilled and how many are refused for a full store. */
function tally(results: PromiseSettledResult<unknown>[]) {
  return {
    won: results.filter((result) => result.status === 'fulfilled').length,
    refusedFull: results.filter(
      (result) =>
        result.status === 'rejected' &&
        (result.reason instanceof SavedStudyStorageFullError ||
          /storage is full|Saved Study Limit|saved study limit/i.test(
            String(result.reason),
          )),
    ).length,
  }
}

// protects=one saved-study limit counts test and server histories together under the storage lock; fails_when=two windows racing for the last place both succeed in either order; no_claim=the Retry wording the learner reads
for (const order of ['server first', 'test first'] as const) {
  test(`with one place left, a server start and a test start from two windows give one success (${order})`, async (context) => {
    // Arrange
    const first = await openWindow(context, 1)
    const second = await openWindow(context, 1, first.learningDirectory)
    const serverHeader = nodeServerHistoryHeader(first.study.workspaceKey)
    const testHeader = nodeTestHistoryHeader(first.study.workspaceKey)
    const startServer = () =>
      first.repository.serverHistories.start(serverHeader)
    const startTest = () => second.repository.testHistories.start(testHeader)

    // Act
    const results = await Promise.allSettled(
      order === 'server first'
        ? [startServer(), startTest()]
        : [startTest(), startServer()],
    )

    // Assert
    assert.deepEqual(tally(results), { won: 1, refusedFull: 1 })
  })
}

// protects=a browser save counts the server histories (and test histories) as saved studies count them; fails_when=a server history and a browser save both take the last place; no_claim=other windows' library caches
test('with one place left, a server history already started refuses a browser save', async (context) => {
  // Arrange
  const window = await openWindow(context, 1)
  await window.repository.serverHistories.start(
    nodeServerHistoryHeader(window.study.workspaceKey),
  )

  // Act
  const save = window.library.saveStudy(window.study)

  // Assert
  await assert.rejects(save, /Saved study storage is full|Saved Study Limit/i)
  assert.equal(await window.library.admitsStudy(window.study.id), false)
})

test('with one place left, a browser save already made refuses a server start', async (context) => {
  // Arrange
  const window = await openWindow(context, 1)
  await window.library.saveStudy(window.study)

  // Act
  const start = window.repository.serverHistories.start(
    nodeServerHistoryHeader(window.study.workspaceKey),
  )

  // Assert
  await assert.rejects(start, SavedStudyStorageFullError)
})

test('with one place left, a browser save and a server start asked at once give one success', async (context) => {
  // Arrange
  const window = await openWindow(context, 1)

  // Act
  const results = await Promise.allSettled([
    window.library.saveStudy(window.study),
    window.repository.serverHistories.start(
      nodeServerHistoryHeader(window.study.workspaceKey),
    ),
  ])

  // Assert
  assert.deepEqual(tally(results), { won: 1, refusedFull: 1 })
})

// protects=updating a study the library already keeps is never a new reservation; fails_when=a full store refuses the next checkpoint of a saved study; no_claim=checkpoint content rules
test('a saved study keeps accepting its own checkpoint while server histories fill the limit', async (context) => {
  // Arrange
  const window = await openWindow(context, 2)
  await window.library.saveStudy(window.study)
  await window.repository.serverHistories.start(
    nodeServerHistoryHeader(window.study.workspaceKey),
  )

  // Act
  const resave = window.library.saveStudy(window.study)

  // Assert
  await assert.doesNotReject(resave)
})

// protects=an unreadable history directory never blocks a browser save, as an unreadable Node history store never did; fails_when=the library's admission throws the directory's read error and the save fails; no_claim=the histories' own start, which still refuses on an unreadable directory
for (const code of ['EACCES', 'EMFILE', 'EBUSY']) {
  test(`a browser save on the last free place succeeds while both history directories fail to read with ${code}`, async (context) => {
    // Arrange
    const window = await openWindow(context, 1)
    const readdirBefore = fsPromises.readdir
    context.mock.method(
      fsPromises,
      'readdir',
      async (...input: Parameters<typeof readdirBefore>) => {
        if (/node-(tests|servers)\.v1$/.test(String(input[0])))
          throw Object.assign(new Error(`${code}: cannot read`), { code })
        return readdirBefore(...input)
      },
    )

    // Act
    await window.library.saveStudy(window.study)

    // Assert
    assert.equal(await window.library.admitsStudy(window.study.id), true)
    assert.equal(await window.library.savedStudyCount(), 1)
  })
}
