import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import { NODE_SERVER_HISTORY_DIRECTORY } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { workspaceHarness } from './studyWorkspaceHarness'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'
import {
  openServerReplay,
  repositoryOf,
  workspaceKeyOf,
} from './utils/serverWorkspaceHarness'
import { shownApplicationView } from './utils/shownTestOutput'
import { lastView } from './utils/twoStopNodeHistory'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=the last moment of a replay whose recording was interrupted reads a no-response reason in the response region, not the interruption's own sentence; fails_when=the region prints the first capture reason whatever it is; no_claim=the end sentence under the output
test('the response region of an interrupted server replay reads that no response was recorded at its last moment', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header, sequences } = await writeServerHistory(
      repositoryOf(harness),
      {
        workspaceKey: workspaceKeyOf(harness),
        output: ['listening\n'],
        response: null,
        seal: false,
      },
    )
    await openServerReplay(harness, header.studyId)

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: header.studyId,
      sequence: sequences.output[0]!,
    })
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence ===
          sequences.output[0] &&
        !lastView(harness)?.nodeHistoryPosition?.pending,
      'the last moment is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      shownApplicationView(harness)?.response?.state,
      'No response was recorded: the history ended before the server answered.',
    )
  } finally {
    await harness.close()
  }
})

// protects=a seek beyond the recorded range of a server replay is refused in server words; fails_when=the refusal says test replay; no_claim=the transport's rendering of the refusal
test('a seek outside the recorded range of a server replay is refused as a server replay', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    await openServerReplay(harness, header.studyId)

    // Act
    harness.receiveContext({
      type: 'node-history-playback',
      revision: lastView(harness)!.revision,
      studyId: header.studyId,
      action: 'seek',
      positionMs: 3_600_000,
    })
    await waitUntil(
      () => (lastView(harness)?.errors.length ?? 0) > 0,
      'the seek is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      lastView(harness)?.errors[0],
      'Error: Seek lies outside the verified range of this server replay.',
    )
  } finally {
    await harness.close()
  }
})

// protects=an understanding choice for a replay whose folder vanished answers that no history has this id and does not read the test store; fails_when=the choice falls through to the test store and fails with its own error; no_claim=recovery of the replay
test('an understanding choice for a server replay whose folder is gone answers that no history has this study id', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    await openServerReplay(harness, header.studyId)
    await rm(
      join(
        harness.service.nodeHistoryStore!.learningDirectory,
        NODE_SERVER_HISTORY_DIRECTORY,
        header.studyId,
      ),
      { recursive: true, force: true },
    )

    // Act
    harness.receiveContext({
      type: 'node-history-understanding',
      revision: lastView(harness)!.revision,
      studyId: header.studyId,
      understood: true,
    })
    await waitUntil(
      () => (lastView(harness)?.errors.length ?? 0) > 0,
      'the choice is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      lastView(harness)?.errors[0],
      'Error: No Node history has this study id.',
    )
  } finally {
    await harness.close()
  }
})
