import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { workspaceHarness } from './studyWorkspaceHarness'
import { lastView, saveTwoStopNodeHistory } from './utils/twoStopNodeHistory'

// Value: protects=Show recorded output puts a rebuilt Application pane where the Study arrangement puts it: once the three Study panes exist the arrangement runs again with its receipt cleared, so the pane does not come back as a second tab before the source stop when the editor closed the emptied group; fails_when=the rebuilt pane is left at the fixed Application column (the arrangement's re-entry returns at once because its receipt already says `study`), so no arrangement runs after the pane is rebuilt; why_new=F137 (D21): the closed pane's group is gone under workbench.editor.closeEmptyGroups and open() alone did not place the new pane; seam=the reader's private arrange, observed by a wrapper; no_claim=the native placement itself, which the driving agent checks in VS Code and Cursor (stand-ins: the workspace harness's closeTabByHand, its native panel list and the recorded arrange calls)
test('Show recorded output runs the Study arrangement again, with its receipt cleared, once the rebuilt Application pane exists', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      2_000,
    )
    const closedPane = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    harness.closeTabByHand(closedPane!.nativeTab)
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.applicationClosed === true,
      'the section says the Application pane is closed',
      2_000,
    )
    const reader = harness.reader as unknown as {
      arrange: (
        signal?: AbortSignal,
        mode?: 'study' | 'repository',
        ownedOnly?: boolean,
      ) => Promise<void>
      layoutReceipt: unknown
    }
    const arrange = reader.arrange.bind(reader)
    const arrangements: {
      mode?: string
      ownedOnly?: boolean
      receiptWasCleared: boolean
      applicationPanes: number
    }[] = []
    reader.arrange = (signal, mode, ownedOnly): Promise<void> => {
      arrangements.push({
        mode,
        ownedOnly: Boolean(ownedOnly),
        receiptWasCleared: reader.layoutReceipt === undefined,
        applicationPanes: harness
          .nativePanels()
          .filter((panel) => panel.kind === 'codebook.scopedBrowser').length,
      })
      return arrange(signal, mode, ownedOnly)
    }

    // Act
    harness.receiveContext({
      type: 'action',
      revision: lastView(harness)!.revision,
      action: 'focus-app',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.applicationClosed === false,
      'the section says the Application pane is back',
      3_000,
    )

    await waitUntil(
      () => arrangements.some((value) => value.ownedOnly === false),
      'the Study arrangement runs again for the rebuilt pane',
      3_000,
    )

    // Assert
    const last = arrangements.at(-1)
    assert.equal(last?.mode, 'study')
    assert.equal(last?.ownedOnly, false)
    assert.equal(last?.receiptWasCleared, true)
    assert.equal(last?.applicationPanes, 1)
  } finally {
    await harness.close()
  }
})
