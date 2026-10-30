import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

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

// Value: protects=a learner's tab never being kept open by the Application's keep-open step; fails_when=attach runs the editor's Keep Open command although the active tab of the active group is a learner's text tab, which would pin the learner's preview; why_new=Cycle 0064 pt2 /ship coverage audit; seam=BrowserViewport.attach (the run's browser attach), createViewport, addSeparateEditorPart, focusMutableDraft (the learner's tab in front), the harness command log; no_claim=the real Cursor's answer (native Cursor trial)
test("a run's browser attach runs no Keep Open command while a learner's text tab is the active tab", async () => {
  // Arrange: the run's Application is in its group and the learner's own file is the active tab of the active group.
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
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    harness.focusMutableDraft('learner-notes.ts', 1)
    const commandsBeforeAttach = harness.commands.length

    // Act
    await viewport.attach(
      {
        on: () => undefined,
        request: async () => ({}),
        subscribe: async () => undefined,
      },
      new AbortController().signal,
    )

    // Assert
    assert.equal(
      harness.commands
        .slice(commandsBeforeAttach)
        .includes('workbench.action.keepEditor'),
      false,
    )
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=the Application pane staying open when the native debugger opens a run's stop file in the Application's group in Cursor 3.27.22 (N64p2-F2: the Application tab stood as a preview in column 1 after its move, the stop's file opened as a preview in that group replaced it, and the run failed ten seconds later with "Owned viewport closed before cleanup"): the Application is still at column 1 beside the stop file; fails_when=the Application's tab is left a preview after its move, so a text preview opened in its group closes the pane and its webview; why_new=Cycle 0064 N64p2-F2 (task 67); seam=BrowserViewport.attach (the run's browser attach), reader open (the Application's first pane), createViewport (a live run's Application moved into its new group), addSeparateEditorPart (Cursor's chat part), replaceGroupObjectsOnTabChanges, closeEmptyGroupsAfterPanelMove with removeGroupLeftByPanelMoveLater, reportsPaneMoveAsOpenThenClose, replacesPreviewTabOnTextPreview (a text preview replaces the group's preview tab), openPausedFileInLockedGroup; no_claim=the real Cursor's answer (native Cursor trial), the run's journal
test("in Cursor, a run's Application stays open when the debugger opens the run's stop file as a preview in its group", async () => {
  // Arrange: the Study is open with its Application pane and an agent starts a run from Cursor's Agent chat; the run's Application moves into its new group at column 1, where Cursor lists its tab as a preview.
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )

    // Act: the run attaches its browser, pauses, and the debugger opens its stop file as a preview in the Application's group.
    await viewport.attach(
      {
        on: () => undefined,
        request: async () => ({}),
        subscribe: async () => undefined,
      },
      new AbortController().signal,
    )
    harness.openPausedFileInLockedGroup('index.tsx', 1)

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    const applicationGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    assert.deepEqual(
      applicationGroup.tabs.map((tab) => tab.label),
      ['codebook · Application stop-run', 'index.tsx'],
    )
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=a run starting although the editor refuses Keep Open for the Application's tab; fails_when=BrowserViewport.attach rejects with the command's error, so the run fails at its start for a tab the move itself left usable; why_new=Cycle 0064 pt2 /ship Step 11 adversarial review; seam=rejectsKeepEditor, BrowserViewport.attach, createViewport, addSeparateEditorPart; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a run's attach resolves when the editor rejects the Keep Open command", async () => {
  // Arrange
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
  harness.replacesPreviewTabOnTextPreview()
  harness.rejectsKeepEditor()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    const attachCdp = {
      on: () => undefined,
      request: async () => ({}),
      subscribe: async () => undefined,
    }

    // Act
    const outcome = await viewport
      .attach(attachCdp, new AbortController().signal)
      .then(
        () => 'attached',
        (error: unknown) => String(error),
      )

    // Assert
    assert.equal(outcome, 'attached')
    assert.equal(harness.commands.includes('workbench.action.keepEditor'), true)
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=Keep Open not acting on the chat part's editor while Cursor 3.27.22 names the Agent chat's group as the active group although the Application pane reports itself active, and the Application staying open once the editor names its group; fails_when=attach trusts the pane's own active flag, so Keep Open runs while the chat's group is active, or never runs after the editor names the Application's group; why_new=Cycle 0064 pt2 /ship Step 11 round 2; seam=nameChatGroupWhilePaneHoldsKeyboard (the chat's group stays named, the pane reports itself active), activatePaneGroupByGroupEventOnly, replacesPreviewTabOnTextPreview, openPausedFileInLockedGroup, BrowserViewport.attach; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a run's Application is kept only once the editor names its group, not while the chat's group is named and the pane reports itself active", async () => {
  // Arrange
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    const attachCdp = {
      on: () => undefined,
      request: async () => ({}),
      subscribe: async () => undefined,
    }
    harness.nameChatGroupWhilePaneHoldsKeyboard('codebook.scopedBrowser')

    const commandsBeforeAttach = harness.commands.length
    const keepsSince = (from: number): number =>
      harness.commands
        .slice(from)
        .filter((command) => command === 'workbench.action.keepEditor').length

    // Act
    await viewport.attach(attachCdp, new AbortController().signal)
    const keepsAtAttach = keepsSince(commandsBeforeAttach)
    harness.activatePaneGroupByGroupEventOnly('codebook.scopedBrowser')
    await waitUntil(
      () => keepsSince(commandsBeforeAttach) > 0,
      'the Keep Open command after the editor named the Application group',
    )
    harness.openPausedFileInLockedGroup('index.tsx', 1)

    // Assert
    assert.equal(keepsAtAttach, 0)
    assert.equal(keepsSince(commandsBeforeAttach), 1)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.deepEqual(
      harness.groups
        .find((group) => group.viewColumn === 1)!
        .tabs.map((tab) => tab.label),
      ['codebook · Application stop-run', 'index.tsx'],
    )
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=the Application pane staying open at a stop when the learner worked in another group at attach and came to the Application later, without the run taking the keyboard at attach; fails_when=attach runs no Keep Open at all in that state (the later stop file replaces the Application) or runs it at attach (the keyboard is taken from the learner's group), or the keep runs more than once; why_new=Cycle 0064 pt2 /ship Step 11 adversarial review; seam=focusMutableDraft in another group at attach, activatePaneByHand (the pane becomes active), replacesPreviewTabOnTextPreview, BrowserViewport.attach; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a run's Application is kept once the learner moves to it, not at attach while another group is active", async () => {
  // Arrange
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    const attachCdp = {
      on: () => undefined,
      request: async () => ({}),
      subscribe: async () => undefined,
    }
    harness.focusMutableDraft('learner-notes.ts', 2)
    const commandsBeforeAttach = harness.commands.length
    const keepsSince = (from: number): number =>
      harness.commands
        .slice(from)
        .filter((command) => command === 'workbench.action.keepEditor').length

    // Act
    await viewport.attach(attachCdp, new AbortController().signal)
    const keepsAtAttach = keepsSince(commandsBeforeAttach)
    harness.activatePaneByHand('codebook.scopedBrowser')
    await waitUntil(
      () => keepsSince(commandsBeforeAttach) > 0,
      'the Keep Open command after the pane became active',
    )
    harness.activatePaneByHand('codebook.scopedBrowser')
    // An asynchronous duplicate Keep Open command would be issued by now.
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.openPausedFileInLockedGroup('index.tsx', 1)

    // Assert
    assert.equal(keepsAtAttach, 0)
    assert.equal(keepsSince(commandsBeforeAttach), 1)
    assert.deepEqual(
      harness.groups
        .find((group) => group.viewColumn === 1)!
        .tabs.map((tab) => tab.label),
      ['codebook · Application stop-run', 'index.tsx'],
    )
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=the Application pane staying open when it is a preview behind a file the learner pinned in its group at attach and comes to the front later; fails_when=the entry check reads only the group's front tab, so no watch is armed and the stop file's preview replaces the Application; why_new=Cycle 0064 pt2 OCR delegate finding; seam=focusMutableDraft in the Application's group at attach, activatePaneByHand, replacesPreviewTabOnTextPreview, BrowserViewport.attach; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a run's Application stays watched when it is a preview behind the learner's file at attach, and is kept once it is in front again", async () => {
  // Arrange
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    const attachCdp = {
      on: () => undefined,
      request: async () => ({}),
      subscribe: async () => undefined,
    }
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('pinned-notes.ts', 1)
    harness.focusMutableDraft('learner-notes.ts', 2)
    const commandsBeforeAttach = harness.commands.length
    const keepsSince = (from: number): number =>
      harness.commands
        .slice(from)
        .filter((command) => command === 'workbench.action.keepEditor').length

    // Act
    await viewport.attach(attachCdp, new AbortController().signal)
    const keepsAtAttach = keepsSince(commandsBeforeAttach)
    harness.activatePaneByHand('codebook.scopedBrowser')
    await waitUntil(
      () => keepsSince(commandsBeforeAttach) > 0,
      'the Keep Open command after the Application came back to the front',
    )
    harness.activatePaneByHand('codebook.scopedBrowser')
    // An asynchronous duplicate Keep Open command would be issued by now.
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.openPausedFileInLockedGroup('index.tsx', 1)

    // Assert
    assert.equal(keepsAtAttach, 0)
    assert.equal(keepsSince(commandsBeforeAttach), 1)
    assert.deepEqual(
      harness.groups
        .find((group) => group.viewColumn === 1)!
        .tabs.map((tab) => tab.label),
      ['codebook · Application stop-run', 'pinned-notes.ts', 'index.tsx'],
    )
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=the Application pane staying open when the learner opens a file in its group after attach, which puts the preview Application behind that file, and then returns to the Application; fails_when=the watch ends at the first tab change that leaves the Application behind another tab, as if it had been kept; why_new=Cycle 0064 pt2 OCR delegate finding; seam=focusMutableDraft in the Application's group after attach, activatePaneByHand, replacesPreviewTabOnTextPreview, BrowserViewport.attach; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a run's Application stays watched when the learner's file covers it after attach, and is kept once it is in front again", async () => {
  // Arrange
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    const attachCdp = {
      on: () => undefined,
      request: async () => ({}),
      subscribe: async () => undefined,
    }
    harness.focusMutableDraft('learner-notes.ts', 2)
    const commandsBeforeAttach = harness.commands.length
    const keepsSince = (from: number): number =>
      harness.commands
        .slice(from)
        .filter((command) => command === 'workbench.action.keepEditor').length

    // Act
    await viewport.attach(attachCdp, new AbortController().signal)
    const keepsAtAttach = keepsSince(commandsBeforeAttach)
    harness.openAnnouncedKeptFile('pinned-notes.ts', 1)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.openAnnouncedKeptFile('learner-extra.ts', 2)
    harness.activatePaneByHand('codebook.scopedBrowser')
    await waitUntil(
      () => keepsSince(commandsBeforeAttach) > 0,
      'the Keep Open command after the Application came back to the front',
    )
    harness.activatePaneByHand('codebook.scopedBrowser')
    // An asynchronous duplicate Keep Open command would be issued by now.
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.openPausedFileInLockedGroup('index.tsx', 1)

    // Assert
    assert.equal(keepsAtAttach, 0)
    assert.equal(keepsSince(commandsBeforeAttach), 1)
    assert.deepEqual(
      harness.groups
        .find((group) => group.viewColumn === 1)!
        .tabs.map((tab) => tab.label),
      ['codebook · Application stop-run', 'pinned-notes.ts', 'index.tsx'],
    )
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=the Application pane staying open when the editor names the Application's group active by a tab-group event alone, with no view-state event of the pane, while its tab is still a preview; fails_when=the deferred watch listens to the pane's view state only, so Keep Open never runs and the stop file's preview replaces the Application; why_new=Cycle 0064 pt2 /ship Step 11 round 2; seam=focusMutableDraft in another group at attach, activatePaneGroupByGroupEventOnly (tab-group events only), replacesPreviewTabOnTextPreview, BrowserViewport.attach; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a run's Application is kept once the editor names its group by a tab-group event alone", async () => {
  // Arrange
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    const attachCdp = {
      on: () => undefined,
      request: async () => ({}),
      subscribe: async () => undefined,
    }
    harness.focusMutableDraft('learner-notes.ts', 2)
    const commandsBeforeAttach = harness.commands.length
    const keepsSince = (from: number): number =>
      harness.commands
        .slice(from)
        .filter((command) => command === 'workbench.action.keepEditor').length

    // Act
    await viewport.attach(attachCdp, new AbortController().signal)
    const keepsAtAttach = keepsSince(commandsBeforeAttach)
    harness.activatePaneGroupByGroupEventOnly('codebook.scopedBrowser')
    await waitUntil(
      () => keepsSince(commandsBeforeAttach) > 0,
      'the Keep Open command after a tab-group event named the Application group',
    )
    // An asynchronous duplicate Keep Open command would be issued by now.
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.openPausedFileInLockedGroup('index.tsx', 1)

    // Assert
    assert.equal(keepsAtAttach, 0)
    assert.equal(keepsSince(commandsBeforeAttach), 1)
    assert.deepEqual(
      harness.groups
        .find((group) => group.viewColumn === 1)!
        .tabs.map((tab) => tab.label),
      ['codebook · Application stop-run', 'index.tsx'],
    )
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=a cancelled run not taking the keyboard-bound Keep Open command later; fails_when=the deferred watch outlives the run's cancellation, so the learner who comes to the Application after the run ended triggers a Keep Open on a tab the run no longer owns; why_new=Cycle 0064 pt2 /ship review pass 2; seam=focusMutableDraft in another group at attach, an aborted attach signal, activatePaneByHand, BrowserViewport.attach; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a run's Application is not kept at activation after the run was cancelled while the learner worked elsewhere", async () => {
  // Arrange
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    const attachCdp = {
      on: () => undefined,
      request: async () => ({}),
      subscribe: async () => undefined,
    }
    harness.focusMutableDraft('learner-notes.ts', 2)
    const commandsBeforeAttach = harness.commands.length
    const keepsSince = (from: number): number =>
      harness.commands
        .slice(from)
        .filter((command) => command === 'workbench.action.keepEditor').length

    // Act
    const controller = new AbortController()
    await viewport.attach(attachCdp, controller.signal)
    controller.abort()
    harness.activatePaneByHand('codebook.scopedBrowser')
    await new Promise((resolve) => setImmediate(resolve))

    // Assert
    assert.equal(keepsSince(commandsBeforeAttach), 0)
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=closing the Application pane with the Keep Open watch armed ending the watch quietly; fails_when=the watch of a disposed pane still runs the keep or throws from its listener when the editor later reports a tab change; why_new=Cycle 0064 pt2 /ship review pass 2; seam=focusMutableDraft in another group at attach, the Application panel disposed, announceTabChange, BrowserViewport.attach; no_claim=the real Cursor's answer (native Cursor trial)
test('in Cursor, closing the Application pane while the learner worked elsewhere leaves no Keep Open command and no error behind', async () => {
  // Arrange
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    const attachCdp = {
      on: () => undefined,
      request: async () => ({}),
      subscribe: async () => undefined,
    }
    harness.focusMutableDraft('learner-notes.ts', 2)
    const commandsBeforeAttach = harness.commands.length
    const keepsSince = (from: number): number =>
      harness.commands
        .slice(from)
        .filter((command) => command === 'workbench.action.keepEditor').length

    // Act
    await viewport.attach(attachCdp, new AbortController().signal)
    const reported: unknown[] = []
    const onUncaught = (error: unknown): void => {
      reported.push(error)
    }
    process.on('uncaughtException', onUncaught)
    try {
      harness.reader['app']?.dispose()
      harness.announceTabChange()
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      process.off('uncaughtException', onUncaught)
    }

    // Assert
    assert.equal(keepsSince(commandsBeforeAttach), 0)
    assert.deepEqual(reported, [])
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=no second Keep Open command for an Application tab that is no preview any more when the pane becomes active; fails_when=the deferred watch runs the keep for a tab kept by other means, which takes the keyboard command for nothing; why_new=Cycle 0064 pt2 /ship review pass 2; seam=focusMutableDraft in another group at attach, the Application tab set to a kept tab, activatePaneByHand, BrowserViewport.attach; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a run's Application the learner already kept is not kept again when the learner comes to it", async () => {
  // Arrange
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    const attachCdp = {
      on: () => undefined,
      request: async () => ({}),
      subscribe: async () => undefined,
    }
    harness.focusMutableDraft('learner-notes.ts', 2)
    const commandsBeforeAttach = harness.commands.length
    const keepsSince = (from: number): number =>
      harness.commands
        .slice(from)
        .filter((command) => command === 'workbench.action.keepEditor').length

    // Act
    await viewport.attach(attachCdp, new AbortController().signal)
    const applicationTab = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Application stop-run')
    assert.ok(applicationTab)
    applicationTab.isPreview = false
    harness.activatePaneByHand('codebook.scopedBrowser')
    await new Promise((resolve) => setImmediate(resolve))

    // Assert
    assert.equal(keepsSince(commandsBeforeAttach), 0)
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=an attach whose signal was aborted before the watch could be armed leaving nothing armed; fails_when=the abort listener is added to a signal that never fires again, so the watches stay armed and the learner's later visit to the Application runs Keep Open; why_new=Cycle 0064 pt2 /ship review pass 2; seam=focusMutableDraft in another group at attach, a signal aborted just before the watch is armed (keepMovedApplicationTab wrapper), activatePaneByHand; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a run attached with an already cancelled signal arms no Keep Open watch for the learner's later visit", async () => {
  // Arrange
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    const attachCdp = {
      on: () => undefined,
      request: async () => ({}),
      subscribe: async () => undefined,
    }
    harness.focusMutableDraft('learner-notes.ts', 2)
    const commandsBeforeAttach = harness.commands.length
    const keepsSince = (from: number): number =>
      harness.commands
        .slice(from)
        .filter((command) => command === 'workbench.action.keepEditor').length

    // Act
    const cancelled = new AbortController()
    const keepMovedApplicationTab = harness.reader[
      'keepMovedApplicationTab'
    ].bind(harness.reader)
    // The run is cancelled after the move, before the watch is armed.
    let wrapperCalled = false
    harness.reader['keepMovedApplicationTab'] = async (
      panel,
      signal,
    ): Promise<void> => {
      wrapperCalled = true
      cancelled.abort()
      await keepMovedApplicationTab(panel, signal)
    }
    let attachError: unknown
    await viewport
      .attach(attachCdp, cancelled.signal)
      .catch((error: unknown) => {
        attachError = error
      })
    harness.activatePaneByHand('codebook.scopedBrowser')
    await new Promise((resolve) => setImmediate(resolve))

    // Assert
    assert.equal(wrapperCalled, true)
    // The attach ends either quietly or with the run's abort, never with another failure.
    assert.equal(
      attachError === undefined || (attachError as Error).name === 'AbortError',
      true,
    )
    assert.equal(keepsSince(commandsBeforeAttach), 0)
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=a run start staying prompt on a host where Keep Open leaves the Application's webview tab a preview: the wait for the kept state is bounded by APPLICATION_TAB_KEEP_PROBE_MS, not the five-second presentation bound; fails_when=BrowserViewport.attach waits PRESENTATION_READY_TIMEOUT_MS for a tab that stays a preview, stalling every run start; why_new=Cycle 0064 pt2 /ship review pass 1; seam=keepEditorLeavesWebviewPreviews, BrowserViewport.attach, createViewport, addSeparateEditorPart; no_claim=the real Cursor's timing
test("in Cursor, a run start is not stalled when Keep Open leaves the run's Application tab a preview", async () => {
  // Arrange
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
  harness.keepEditorLeavesWebviewPreviews()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      'stop-run',
      () => {},
      () => {},
      'normal',
    )
    const attached = viewport
      .attach(
        {
          on: () => undefined,
          request: async () => ({}),
          subscribe: async () => undefined,
        },
        new AbortController().signal,
      )
      .then(() => 'attached')

    // Act
    // gstack-timing-ok: the bound itself is the contract; attach must end well before the five-second presentation bound.
    const timerCancel = new AbortController()
    const winner = await Promise.race([
      attached,
      sleep(2_500, 'timer', { signal: timerCancel.signal }),
    ]).finally(() => timerCancel.abort())

    // Assert
    assert.equal(winner, 'attached')
    assert.equal(harness.commands.includes('workbench.action.keepEditor'), true)
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=a live run of a repository or server in Cursor 3.27.22 keeping its Application revealable at a pause: the native debugger opens the stop's file in front of the Application inside the Application's own group, and the reveal at the pause moves that file out instead of refusing (N64p3 Cursor runs 1-4: "Application ownership changed" at the first stop); fails_when=only an extension run's lease moves the paused file out, so the reveal of a repository run's Application finds the stop file in front of it and the run fails; why_new=Cycle 0064 task 96; seam=createViewport (a live repository run), declared run stops of the window's records, openPausedFileInLockedGroup, revealApplicationPaneOverPausedFile, replacesPreviewTabOnTextPreview, replaceGroupObjectsOnTabChanges; no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a repository run's Application is revealed at a pause after its stop file opened in front of it in its group", async () => {
  // Arrange: a run declared a stop in src/theme.ts; the Study is open and the run's Application sits at column 1 with the learner's files in the groups after it.
  const harness = await workspaceHarness(true, true)
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.acknowledgeContext()
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'declares-the-stop',
    })
    await harness.service.records.get(receipt.runId)!.preparation
    const runtimeId = harness.service.records.get(receipt.runId)!.runtime!.id
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      runtimeId,
      () => {},
      () => {},
      'normal',
    )
    await viewport.attach(
      {
        on: () => undefined,
        request: async () => ({}),
        subscribe: async () => undefined,
      },
      new AbortController().signal,
    )

    // Act: the debugger pauses and opens the stop's file in front of the Application, then the viewport reveals the Application.
    harness.openPausedFileInLockedGroup('src/theme.ts', 1)
    await waitUntil(
      () =>
        !harness.groups
          .find((group) => group.viewColumn === 1)
          ?.tabs.some((tab) => tab.label === 'theme.ts'),
      'the stop file leaving the Application group',
    )
    await harness.revealApplicationPaneOverPausedFile()

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.deepEqual(
      harness.groups
        .find((group) => group.viewColumn === 1)!
        .tabs.map((tab) => tab.label),
      [`codebook · Application ${runtimeId.slice(0, 8)}`],
    )
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=a repository run's first pause in Cursor 3.27.22 while the Agent chat has the keyboard: the run's stop file is already open outside the Application's group, so the native debugger reveals that editor instead of opening a preview in the Application's group that replaces the Application (N64p3-F2: "Owned viewport closed before cleanup"), without Codebook taking the keyboard or touching a learner's tab; fails_when=the run's stop files are not opened beside the Application at attach, so the debugger's preview in column 1 replaces the preview Application and disposes its webview; why_new=Cycle 0064 task 97 (D14); seam=createViewport (a live repository run), declared run stops of the window's records, BrowserViewport.attach, debuggerOpensStopFile (reveals an open editor in any group, else opens a preview in the Application's group), replacesPreviewTabOnTextPreview, addSeparateEditorPart (the Agent chat holds the keyboard); no_claim=the real Cursor's answer (native Cursor trial)
test("in Cursor, a repository run's first pause keeps the Application open while the Agent chat has the keyboard", async () => {
  // Arrange: a run declared a stop in src/theme.ts, the file is open nowhere, and the Agent chat has the keyboard.
  const harness = await workspaceHarness(true, true)
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
  harness.replacesPreviewTabOnTextPreview()
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    harness.acknowledgeContext()
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'declares-the-stop',
    })
    await harness.service.records.get(receipt.runId)!.preparation
    const runtimeId = harness.service.records.get(receipt.runId)!.runtime!.id
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    chat.focusTab()
    viewport = await harness.reader.presentation.createViewport(
      runtimeId,
      () => {},
      () => {},
      'normal',
    )
    const learnerTabLabels = (): string[] =>
      harness.groups
        .filter((group) => group.viewColumn !== 1)
        .flatMap((group) => group.tabs.map((tab) => tab.label))
        .filter((label) => label !== 'theme.ts')
        .sort()
    const learnerTabsBefore = learnerTabLabels()

    // Act: the run attaches its browser, then the debugger pauses at the stop and shows its file.
    await viewport.attach(
      {
        on: () => undefined,
        request: async () => ({}),
        subscribe: async () => undefined,
      },
      new AbortController().signal,
    )
    const shownInColumn = harness.debuggerOpensStopFile('src/theme.ts', 1)

    // Assert: the Application is still open in column 1 and the stop file stands in another group; no learner's tab went; the chat still has the keyboard.
    assert.notEqual(shownInColumn, 1)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.deepEqual(
      harness.groups
        .find((group) => group.viewColumn === 1)!
        .tabs.map((tab) => tab.label),
      [`codebook · Application ${runtimeId.slice(0, 8)}`],
    )
    assert.deepEqual(learnerTabLabels(), learnerTabsBefore)
    assert.equal(chat.focused(), true)
    assert.equal(
      harness.commands.includes('workbench.action.keepEditor'),
      false,
    )
  } finally {
    viewport?.close()
    await harness.close()
  }
})

// Value: protects=a repository run's lease opening only its own stop files beside the Application: an earlier run (or another study) of the window that stops in another file leaves that file closed, so the learner's group gets no tab for a run that is not on screen; fails_when=the lease collects the stop files of every record of the window instead of its own run's; why_new=Cycle 0064 pt3 review (CodeRabbit minor, OCR medium); seam=createViewport, declared run stops of the window's records, BrowserViewport.attach; no_claim=the real Cursor's answer
test("a repository run's lease opens only its own stop files beside the Application, not an earlier run's", async () => {
  // Arrange: this run stops in src/theme.ts and an earlier run of the window stopped in src/earlier-run.ts.
  const harness = await workspaceHarness(true, true)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
  })
  let viewport:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  const earlierRunId = randomUUID()
  try {
    harness.acknowledgeContext()
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'declares-the-stop',
    })
    const record = harness.service.records.get(receipt.runId)!
    await record.preparation
    // The earlier run's stop file exists, so only the lease's scope keeps it closed.
    await writeFile(
      join(harness.directory, 'src', 'earlier-run.ts'),
      'export {}\n',
    )
    const earlierConfiguration = {
      ...record.definition!.configuration,
      source: {
        ...record.definition!.configuration.source,
        path: 'src/earlier-run.ts',
      },
    }
    harness.service.records.set(earlierRunId, {
      ...record,
      id: `${harness.service.instanceId}_${earlierRunId}`,
      // No runtime of its own: it is a run of the window that is not this lease's.
      runtime: undefined,
      definition: {
        ...record.definition!,
        configuration: earlierConfiguration,
      },
    })
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
    await harness.reader.open()
    viewport = await harness.reader.presentation.createViewport(
      record.runtime!.id,
      () => {},
      () => {},
      'normal',
    )

    // Act: the run attaches its browser.
    await viewport.attach(
      {
        on: () => undefined,
        request: async () => ({}),
        subscribe: async () => undefined,
      },
      new AbortController().signal,
    )

    // Assert: its own stop file is open beside the Application; the earlier run's is open nowhere.
    const openLabels = harness.groups.flatMap((group) =>
      group.tabs.map((tab) => tab.label),
    )
    assert.equal(openLabels.includes('theme.ts'), true)
    assert.equal(openLabels.includes('earlier-run.ts'), false)
  } finally {
    // The stand-in record has no real runtime to shut down.
    harness.service.records.delete(earlierRunId)
    viewport?.close()
    await harness.close()
  }
})
