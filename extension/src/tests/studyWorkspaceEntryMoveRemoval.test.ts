import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import { workspaceHarness } from './studyWorkspaceHarness'

// Value: protects=an agent's Return Current in Cursor when the editor removes the group the Application's own move emptied together with its report of that move (F382, Cursor 3.26.16 candidate 3773701: the removal arrived 44 ms after the move began, `watchLearnerViewDuringApplicationMove` armed 52 ms before the refusal): the Return reaches the live run, nothing is written as a refused placement, and the Application stands at column 1 with the learner's two files kept; fails_when=the removal of the emptied group is not marked as Codebook's own before the move is issued, so Cursor's new objects for every group lose the identities of the groups behind it and the watch reads them as the learner's change and refuses with "Native pane, group or focus changed while presentation waited; the learner arrangement was preserved."; why_new=Cycle 0050 F382 (the first native run with the guard diagnostics); seam=applicationGroupMarkers (a record the resized grid no longer equals), leaveEmptyLockedGroup, addSeparateEditorPart (Cursor's chat part), replaceGroupObjectsOnTabChanges, rebuildTabObjectsAtGroupRemoval, closeEmptyGroupsAfterPanelMove (the removal comes with the move), the reader's agent select and returnToCurrent, the diagnostics log; no_claim=the VS Code first-Open-replay refusal of the same sentence
test("in Cursor, an agent's Return Current reaches the live run when the editor removes the group the Application's move emptied together with the move", async () => {
  // Arrange: after a reload the earlier window's empty locked group stands at column 1 and the agent's cold Study select put the Application into it; actions.ts is in the second group, auth.ts in the third, Cursor's chat part stands beside the main editor.
  const harness = await workspaceHarness(false)
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
  })
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.rebuildTabObjectsAtGroupRemoval()
  harness.closeEmptyGroupsAfterPanelMove()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 1,
        groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    await harness.reader.changePresentation(
      {
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )
    const selected = harness.reader.presentationState()

    // Act
    const result = await harness.reader
      .returnToCurrent(
        {
          presentationId: selected.presentationId,
          expectedRevision: selected.reader.contentRevision,
        },
        'agent',
      )
      .then(
        () => 'returned',
        (error: unknown) => String(error),
      )

    // Assert
    assert.equal(result, 'returned')
    assert.deepEqual(
      logged.filter(
        (entry) => entry.surface === 'presentation:placement-refused',
      ),
      [],
    )
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    const labels = harness.groups.flatMap((group) =>
      group.tabs.map((tab) => tab.label),
    )
    assert.ok(labels.includes('auth.ts'))
    assert.ok(labels.includes('actions.ts'))
  } finally {
    await harness.close()
  }
})
