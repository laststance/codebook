import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
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

// Value: protects=an agent's Return Current in Cursor 3.27.22 when the editor first reports the close of the Application's tab in the group it left (every group an object anew) and removes that emptied group only a moment later (N64p2-F1: tabs closed +9 ms, group closed +15 ms, the chat part's group went from column 4 to 3, `watchLearnerViewDuringApplicationMove` armed 52 ms before the refusal): the Return reaches the live run, nothing is written as a refused placement, and the Application stands at column 1 with the learner's two files kept; fails_when=the group the tab close emptied is given a new identity by that report, so its later removal is not recognized as Codebook's own, the groups behind it (the chat part's group among them) are named anew and the watch reads the chat tab as moved into a group the learner changed, refusing with "Native pane, group or focus changed while presentation waited; the learner arrangement was preserved."; why_new=Cycle 0064 N64p2-F1 (task 66); seam=applicationGroupMarkers, leaveEmptyLockedGroup, addSeparateEditorPart (Cursor's chat part), replaceGroupObjectsOnTabChanges, rebuildTabObjectsAtGroupRemoval, closeEmptyGroupsAfterPanelMove with removeGroupLeftByPanelMoveLater (tab close, then group close), the reader's agent select and returnToCurrent, the diagnostics log; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, an agent's Return Current reaches the live run when the editor reports the Application's tab close first and removes the emptied group a moment later", async () => {
  // Arrange: the Application stands alone in the earlier window's leftover group at column 1, actions.ts is in the second group, auth.ts in the third, Cursor's chat part stands beside the main editor and has the keyboard.
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
  harness.removeGroupLeftByPanelMoveLater()
  harness.reportsPaneMoveAsOpenThenClose()
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

// Value: protects=the learner's own choice while an agent's Return Current in Cursor 3.27.22 waits for the editor's removal of the group the Application's move emptied: a page the learner brings to the front of auth.ts's group between the report of the Application's tab close and the removal of its old group is no effect of Codebook's move, and the Return refuses as a learner's change instead of arranging over it; fails_when=Codebook's own removal marker makes the groups of those reports unreadable for the learner watch, so a learner's change in them is taken as the move's own and the Return arranges over it; why_new=Cycle 0064 N64p2-F1 (task 66), the guard side of the fix; seam=the seam of the test above plus focusOpaqueTab and addOpaqueTab; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a learner's tab brought to the front of their group while the editor removes the group the Application's move emptied refuses the Return as a learner's change", async () => {
  // Arrange: as in the test above; the agent selected the Study cold, which put the Application into the leftover at column 1.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
  })
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.rebuildTabObjectsAtGroupRemoval()
  harness.closeEmptyGroupsAfterPanelMove()
  harness.removeGroupLeftByPanelMoveLater()
  harness.reportsPaneMoveAsOpenThenClose()
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
    const learnerAuth = harness.focusMutableDraft('auth.ts', 3)
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

    // Act: the agent's Return moves the Application out of the leftover; before the editor removes the emptied group, the learner brings a page of their own to the front of auth.ts's group.
    const answer = harness.reader
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
    await waitUntil(
      () =>
        harness.panelColumn('codebook.scopedBrowser') === 1 &&
        harness.groups.some(
          (group) => group.viewColumn === 2 && group.tabs.length === 0,
        ),
      "the Application's move out of the leftover",
    )
    const authColumn = harness.groups.find((group) =>
      group.tabs.includes(learnerAuth.tab),
    )!.viewColumn
    harness.focusOpaqueTab(harness.addOpaqueTab('Release notes', authColumn))

    // Assert
    assert.equal(
      await answer,
      'Error: Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
    )
  } finally {
    await harness.close()
  }
})
