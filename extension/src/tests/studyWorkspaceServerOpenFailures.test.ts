import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'
import { repositoryOf, workspaceKeyOf } from './utils/serverWorkspaceHarness'
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
