import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'
import {
  openServerReplay,
  repositoryOf,
  workspaceKeyOf,
} from './utils/serverWorkspaceHarness'
import { lastView } from './utils/twoStopNodeHistory'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=a server history whose summary cannot be read at open shows the cause on the learning line; fails_when=the failure is swallowed and the replay reads as an explanation that was never saved; no_claim=what the summary would have said
test('opening a server replay whose summary cannot be read names the cause on the learning line', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    // The catalog lists the history before the summary starts to fail, as a summary that breaks later does.
    await harness.reader.action('retry')
    context.mock.method(
      repositoryOf(harness).serverHistories,
      'summarize',
      async () => {
        throw new Error('summary file unreadable')
      },
    )

    // Act
    await harness.reader.openLearningReplay(header.studyId)
    await waitUntil(
      () => lastView(harness)?.nodeHistory?.header.studyId === header.studyId,
      'the server replay is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      readerSeams(harness)
        .errorLines()
        .includes(
          'Learning status of this server replay could not be read: summary file unreadable',
        ),
      true,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// protects=closing the reader waits for the reader-position write of a server replay that is still running, as it does for a test replay; fails_when=close reports closed while a server position write is pending, so the file lands in storage that is gone; no_claim=the bound on a write that never returns
test('closing the reader waits for a server reader-position write that is still running', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const repository = repositoryOf(harness)
    const { header, sequences } = await writeServerHistory(repository, {
      workspaceKey: workspaceKeyOf(harness),
    })
    const store = repository.serverHistories
    await openServerReplay(harness, header.studyId)
    const read = store.read.bind(store)
    let releaseRead = (): void => {}
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let readEntered = (): void => {}
    const readStarted = new Promise<void>((resolve) => {
      readEntered = resolve
    })
    store.read = async (studyId): ReturnType<typeof read> => {
      readEntered()
      await readHeld
      return read(studyId)
    }
    const write = store.saveReaderPosition(header.studyId, sequences.request)
    await readStarted

    // Act
    const closing = harness.reader.close()
    const closedWhileWriting = await Promise.race([
      closing.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ])
    releaseRead()
    await closing
    await write
    store.read = read

    // Assert
    assert.equal(closedWhileWriting, false)
    assert.equal(
      await store.readReaderPosition(header.studyId),
      sequences.request,
    )
  } finally {
    await harness.close()
  }
})
