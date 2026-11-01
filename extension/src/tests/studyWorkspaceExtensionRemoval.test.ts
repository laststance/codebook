import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'
import { extensionHistoryHeader } from './utils/chromeExtensionHistoryFixture'
import {
  openExtensionReplay,
  writeExtensionHistoryFor,
} from './utils/extensionWorkspaceHarness'
import { realProcessStart } from './utils/realProcessStart'
import type { ExtensionScriptStep } from './utils/sealedExtensionHistory'
import {
  repositoryOf,
  workspaceKeyOf,
  type ServerWorkspaceHarness as Harness,
} from './utils/serverWorkspaceHarness'

before(async () => {
  await realProcessStart(process.pid)
})

/** One page stop and a result. */
const RUN: ExtensionScriptStep[] = [
  { at: 100, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
  { at: 101, type: 'capture', pauseId: 'p1', stopIndex: 1, context: 'page' },
  { at: 200, type: 'close', pauseId: 'p1' },
  { at: 300, type: 'result' },
]

/** Sends the pane's delete request for one Saved studies entry. */
function requestRemoval(harness: Harness, studyId: string): Promise<void> {
  return readerSeams(harness).receive(
    {
      type: 'delete-study',
      revision: harness.reader.inspect().view!.revision,
      studyId,
    },
    'context',
  )
}

/** Says whether Saved studies still lists a study id, as a row and as an Extension replay. */
function isListed(harness: Harness, studyId: string): boolean {
  const view = harness.reader.inspect().view!
  return (
    view.studies.some((entry) => entry.id === studyId) ||
    Boolean(
      view.nodeExtensionHistoryCatalog?.some(
        (summary) => summary.studyId === studyId,
      ),
    )
  )
}

// protects=deleting an Extension replay from Saved studies asks for confirmation, moves its history folder to the Trash, says so and drops the row; fails_when=the old "cannot be deleted here yet" refusal returns, the row stays, or nothing reaches the Trash; no_claim=the editor's real Trash
test('deleting an Extension replay from Saved studies moves it to the Trash, reports it and removes the row', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await harness.reader.action('retry')
    harness.answerWarningDialogs(async ([confirm]) => confirm)

    // Act
    await requestRemoval(harness, history.studyId)

    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(harness.warningDialogs.length, 1)
    assert.equal(
      harness.warningDialogs[0]?.title,
      'Move this saved study to the Trash?',
    )
    assert.deepEqual(
      { status: view.studyRemoval?.status, text: view.studyRemoval?.text },
      { status: 'moved', text: 'Extension replay moved to the Trash.' },
    )
    assert.equal(harness.trashMoves.length, 1)
    assert.equal(
      harness.trashMoves[0]?.path.includes('removed-histories.v1'),
      true,
    )
    assert.equal(isListed(harness, history.studyId), false)
  } finally {
    await harness.close()
  }
})

// protects=an Extension replay the reader shows cannot be deleted, with a sentence that says so, and stays listed; fails_when=the folder moves under the open replay; no_claim=closing the replay afterwards
test('deleting the Extension replay that is open is refused and moves nothing', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await openExtensionReplay(harness, history.studyId)

    // Act
    await requestRemoval(harness, history.studyId)

    // Assert
    assert.deepEqual(
      {
        status: harness.reader.inspect().view!.studyRemoval?.status,
        text: harness.reader.inspect().view!.studyRemoval?.text,
      },
      {
        status: 'refused',
        text: 'Choose Overview or Live to leave the Extension replay before deleting it.',
      },
    )
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(isListed(harness, history.studyId), true)
  } finally {
    await harness.close()
  }
})

// protects=an Extension replay whose run still records cannot be deleted from Saved studies; fails_when=the history folder moves under a live writer; no_claim=another window's writer (store tests)
test('deleting an Extension replay that is still recording is refused', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const header = extensionHistoryHeader(workspaceKeyOf(harness))
    const writer = await repositoryOf(harness).extensionHistories.start(header)
    await harness.reader.action('retry')

    // Act
    await requestRemoval(harness, header.studyId)

    // Assert
    assert.equal(
      harness.reader.inspect().view!.studyRemoval?.text,
      'Stop the run before deleting its Extension replay.',
    )
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(isListed(harness, header.studyId), true)
    writer.abandon()
  } finally {
    await harness.close()
  }
})

// protects=when the Trash refuses the folder the replay is already out of Saved studies and the line names the folder to delete by hand; fails_when=the replay stays listed after the rename, or the line claims the Trash took it; no_claim=recovering the folder
test('when the Trash refuses an Extension replay’s folder the replay is unlisted and the line names the folder', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await harness.reader.action('retry')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.rejectTrashMoves(() => true)

    // Act
    await requestRemoval(harness, history.studyId)

    // Assert
    const removal = harness.reader.inspect().view!.studyRemoval
    assert.equal(removal?.status, 'failed')
    assert.equal(
      removal?.text?.startsWith(
        'The Extension replay left Saved studies, but the Trash refused its files. Delete this folder by hand: ',
      ),
      true,
    )
    assert.equal(isListed(harness, history.studyId), false)
  } finally {
    await harness.close()
  }
})

// protects=in a window without a Trash the delete request lists the history folder for removal by hand and moves nothing; fails_when=Codebook deletes in a Trash-less window or answers with the old "cannot list the files yet" sentence; no_claim=the by-hand removal itself
test('in a window without a Trash an Extension replay’s delete request lists its folder by hand', async () => {
  // Arrange
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await harness.reader.action('retry')

    // Act
    await requestRemoval(harness, history.studyId)

    // Assert
    const removal = structuredClone(harness.reader.inspect().view!.studyRemoval)
    assert.equal(removal?.status, 'refused')
    assert.deepEqual(removal?.files, [
      repositoryOf(harness).extensionHistories.historyDirectory(
        history.studyId,
      ),
    ])
    assert.deepEqual(harness.trashMoves, [])
    assert.deepEqual(harness.warningDialogs, [])
    assert.equal(isListed(harness, history.studyId), true)
  } finally {
    await harness.close()
  }
})
