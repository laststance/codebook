import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  configuredWorkspaceHarness,
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import {
  advanceClock,
  advanceClockUntil,
  advanceClockUntilSettled,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'

test('the first presentation selection keeps a debugger preview of a cited workspace file and arranges the Study without restore', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    await harness.reader.select('repository/interface/theme')
    // The native debugger opens the cited workspace file as a clean preview in the source column.
    const debuggerPreview = harness.addTextPreview(
      join(harness.directory, 'src/theme.ts'),
      2,
    )
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })

    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(debuggerPreview)),
      true,
    )
    assert.equal(debuggerPreview.isPreview, false)
  } finally {
    await harness.close()
  }
})

test('Open replay clicked while another window has the desktop focus opens the recording once the work window gains focus', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  let focusTimer: ReturnType<typeof setTimeout> | undefined,
    beforeFocus: { panels: number; groupCreations: number } | undefined
  try {
    await harness.reader.close()
    harness.changeWindowFocus(false)
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.openRecording(harness.studyId)
    focusTimer = setTimeout(() => {
      beforeFocus = {
        panels: harness.nativePanels().length,
        groupCreations: harness.commands
          .slice(commandsBefore)
          .filter((command) => command === 'workbench.action.newGroupAbove')
          .length,
      }
      harness.changeWindowFocus(true)
    }, 200)
    await harness.controller.settle()

    // Assert
    assert.deepEqual(beforeFocus, { panels: 0, groupCreations: 0 })
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().reason, undefined)
    assert.equal(harness.summary.visible, true)
  } finally {
    clearTimeout(focusTimer)
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

test('Close while recorded entry waits for its work window prevents later App creation', async (context) => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.close()
    harness.changeWindowFocus(false)
    const commandsBefore = harness.commands.length
    await harness.reader.openRecording(harness.studyId)
    enableFakeClock(context)
    await advanceClock(context, 200)
    assert.equal(harness.controller.state().readiness, 'loading')
    assert.equal(harness.nativePanels().length, 0)

    // Act
    const closing = harness.reader.close()
    await advanceClockUntilSettled(context, closing, 40_000)
    await closing
    harness.changeWindowFocus(true)
    await advanceClockUntilSettled(context, harness.controller.settle(), 40_000)
    resetFakeClock(context)

    // Assert
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.nativePanels().length, 0)
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.newGroupAbove'),
      false,
    )
    assert.equal(harness.summary.visible, false)
  } finally {
    resetFakeClock(context)
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

// Value: protects=the answer of Open replay when the work window never gains the desktop focus; fails_when=the focus wait loses its ten-second bound or its refusal no longer names the window to click and the control to choose again; why_new=the only focus test gives the window its focus after 200 ms, and the full wait was seen once by hand; seam=none
test(
  'Open replay while another window keeps the desktop focus is refused after ten seconds with the window to click and the control to choose again',
  { timeout: 30_000 },
  async (context) => {
    // Arrange
    const harness = await recordedReaderHarness()
    try {
      await harness.reader.close()
      harness.changeWindowFocus(false)

      // Act: the 10 s wait for the work window's focus passes on a faked clock.
      await harness.reader.openRecording(harness.studyId)
      enableFakeClock(context)
      await advanceClock(context, 9_950)
      const readinessBeforeBound = harness.controller.state().readiness
      const refusedAfterMs = await advanceClockUntil(
        context,
        () => harness.controller.state().readiness === 'failed',
        10_000,
      )
      resetFakeClock(context)

      // Assert
      assert.equal(readinessBeforeBound, 'loading')
      assert.notEqual(refusedAfterMs, undefined)
      assert.equal(
        harness.controller.state().reason,
        'Error: Focus the Codebook work window before reading the learning summary: another window kept the desktop focus for 10 s. Click in this editor window, then choose Open replay again.',
      )
      assert.equal(harness.summary.visible, false)
    } finally {
      resetFakeClock(context)
      harness.changeWindowFocus(true)
      await harness.close()
    }
  },
)

// Value: protects=the learner who clicked Open replay in the status bar while another window had the desktop focus learning why no replay opened; fails_when=the refusal stays in the playback state alone, which no pane shows because the reader could not open, so the click appears to do nothing; why_new=Cycle 0045 NF-12 (Cursor: the reason was readable only through the playback resource); seam=the harness records the editor's error notifications
test(
  'Open replay refused for the desktop focus tells the learner in an editor notification which window to click',
  { timeout: 30_000 },
  async (context) => {
    // Arrange: a closed reader with a saved recording, and another window that keeps the desktop focus.
    const harness = await recordedReaderHarness()
    try {
      await harness.reader.close()
      harness.changeWindowFocus(false)
      enableFakeClock(context)

      // Act: the status bar's Open replay command runs; the 10 s wait for the work window's focus passes on the faked clock.
      const opening = harness.reader.openLearningReplay(harness.studyId).then(
        () => 'completed',
        (error: unknown) => String(error),
      )
      await advanceClockUntilSettled(context, opening, 40_000)
      resetFakeClock(context)

      // Assert: the command ends without rejecting and the editor shows the reason, which it keeps until its window has the focus again.
      assert.equal(await opening, 'completed')
      assert.deepEqual(harness.errorMessages, [
        'Codebook could not open the learning replay: Focus the Codebook work window before reading the learning summary: another window kept the desktop focus for 10 s. Click in this editor window, then choose Open replay again.',
      ])
      assert.equal(harness.summary.visible, false)
    } finally {
      resetFakeClock(context)
      harness.changeWindowFocus(true)
      await harness.close()
    }
  },
)

// Value: protects=the status bar's Open replay staying silent when the recording opens; fails_when=the command that now reports a failed load also raises a notification for a load that succeeded; why_new=Cycle 0045 NF-12 (the command waits for the load's result); seam=the harness records the editor's error notifications
test('Open replay that presents the recording shows no error notification', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    // Act
    await harness.reader.openLearningReplay(harness.studyId)

    // Assert
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.deepEqual(harness.errorMessages, [])
    assert.equal(harness.summary.visible, true)
  } finally {
    await harness.close()
  }
})

test('Open replay in Cursor beside a foreign preview tab that keeps the main editor from reporting focus names that tab and how to clear it', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const agentChat = harness.addSeparateEditorPart()
    const debuggerPreview = harness.addTextPreview(
      join(harness.directory, 'login-form.tsx'),
      1,
    )
    agentChat.focus()
    // Cursor's main editor never reports focus in group 1 while the preview is open.
    const hasMainEditorFocus = harness.reader['hasMainEditorFocus'].bind(
      harness.reader,
    )
    harness.reader['hasMainEditorFocus'] = (groupCount: number): boolean =>
      groupCount !== 1 && hasMainEditorFocus(groupCount)

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(
      harness.controller.state().reason,
      'Error: A destination group contains a foreign preview: "login-form.tsx" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
    )
    assert.equal(debuggerPreview.isPreview, true)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(debuggerPreview)),
      true,
    )
  } finally {
    await harness.close()
  }
})

test('a presentation selection refused for a learner preview names that tab, its group and how to clear it', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    // An unedited text preview is pinned and the selection goes on (0036-N02); one with unsaved edits cannot be pinned for the learner and still refuses.
    const learnerPreview = harness.addTextPreview(
      join(harness.directory, 'learner-notes.ts'),
      1,
      true,
    )
    const state = harness.reader.presentationState()

    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'A destination group contains a foreign preview: "learner-notes.ts" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
      },
    )

    // Assert
    assert.equal(
      harness.reader.presentationState().reason,
      'Error: A destination group contains a foreign preview: "learner-notes.ts" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
    )
    assert.equal(learnerPreview.isPreview, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=Return to the current pause from a saved item in a reader whose Application pane still stands in a learner group; fails_when=the App preparation takes its placement guard before the editor reported the Application pane's move into the newly allocated group, so Codebook's own move reads as a learner change and the return fails with "Native pane, group or focus changed while presentation waited"; why_new=Cycle 0046 finding 583 (C50 in VS Code 1.140.0 and Cursor 3.23.12: the first Return Current after a cold Study select was refused, and the extension-host observer saw the pane's move reported during the next layout read); seam=the fake editor's movePanelsLater
test('Return to the current pause from a saved item puts the Application in its own group at the first click', async () => {
  // Arrange: the reader shows a saved item, and the editor reports a pane's move into another column only during the next layout read.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    harness.movePanelsLater()
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.action('return-current')

    // Assert: no refusal; one owned group was allocated and the Application stands in it, with the layout confirmed.
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .filter((command) => command === 'workbench.action.newGroupAbove')
        .length,
      1,
    )
    assert.equal(harness.reader['app']!.viewColumn, 1)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=Return to the current pause after a window reload that left the old Application group empty and locked at column 1, beside the learner's groups; fails_when=the cold Study select puts the Application into that leftover group and Return Current refuses it as adopted before registration (RUNTIME_FAILED, with the layout unconfirmed) instead of placing it in its own group; why_new=Cycle 0046 finding 590 (C54 in Cursor 3.23.12: after Developer: Reload Window the Study's Return Current failed with "The new Application group was adopted before registration."); seam=leaveEmptyLockedGroup and reactivatePreviousGroupAfterInsertion
test("a reloaded window's leftover empty Application group does not refuse Return to the current pause", async () => {
  // Arrange: the window reloaded while the Study was open; the old owned group stays empty and locked at column 1, the learner's files stand in columns 2 and 3, and the chat part has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    // The earlier window recorded the Application group it claimed at column 1 of this three-group grid.
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    const learnerReadme = harness.focusMutableDraft('learner-readme.md', 3)
    chat.focusTab()
    // Cursor names the group that held the keyboard again as the new group is locked, before the Application's group is claimed.
    harness.reactivatePreviousGroupAfterInsertion()
    const state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Act
    await harness.reader.action('return-current')

    // Assert: no refusal; the Application stands in column 1 with the layout confirmed, and both learner files keep their groups.
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.reader['app']!.viewColumn, 1)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerNotes.tab)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerReadme.tab)),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a Restore after a Return that could not confirm the Application's dedicated layout keeps the learner's groups and their tabs; fails_when=the refused Return leaves its half-claimed owner (count set, layout unset) behind, so the Restore arranges the live two-group layout over three learner groups and the editor merges the third learner group into the source group; why_new=Cycle 0046 finding 590 (C54 in Cursor 3.23.12: the Restore after the failed Return merged README.md, auth.ts and Cursor Settings into the source group and lost the learner's arrangement); seam=reactivatePreviousGroupAtNextLayoutRead
test('a Restore that cannot confirm its layout leaves the learner’s groups as they were', async () => {
  // Arrange: the same reloaded window; the Return's native read after the Application moved into its new group finds the editor naming the old group, so the Return is refused after its group was taken.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.leaveEmptyLockedGroup(1)
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    const learnerReadme = harness.focusMutableDraft('learner-readme.md', 3)
    chat.focusTab()
    const state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.reactivatePreviousGroupAtNextLayoutRead(4)
    // The Return is refused; its switch to the live composition has already closed Codebook's own Study Context pane, which is no learner tab.
    await harness.reader.action('return-current').catch(() => undefined)
    const readmeGroupBefore = harness.groups.find((group) =>
      group.tabs.includes(learnerReadme.tab),
    )!
    const readmeGroupTabsBefore = [...readmeGroupBefore.tabs]

    // Act: the learner asks for Restore.
    const restoreState = harness.reader.presentationState()
    await harness.reader
      .changePresentation({
        presentationId: restoreState.presentationId,
        expectedRevision: restoreState.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      .catch(() => undefined)

    // Assert: the learner's README group keeps its tabs, and the learner's notes keep their group.
    const readmeGroupAfter = harness.groups.find((group) =>
      group.tabs.includes(learnerReadme.tab),
    )
    assert.deepEqual(readmeGroupAfter?.tabs, readmeGroupTabsBefore)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerNotes.tab)),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold Study select after a window reload retiring the empty Application group the earlier window recorded, before the Application is placed; fails_when=the cold entry leaves that unproven leftover group and places the Application in it, so the window keeps an empty locked group beside the learner's groups; why_new=Cycle 0046 finding 590 (C54 in both hosts: Developer: Reload Window kept the earlier window's owned group empty at column 1); seam=applicationGroupMarkers (the earlier window's record) and leaveEmptyLockedGroup
test('a cold Study select after a window reload retires the empty Application group the earlier window recorded', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of this three-group grid; after the reload that group stands empty and locked, the learner's files stand in columns 2 and 3, and the chat part has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    const learnerReadme = harness.focusMutableDraft('learner-readme.md', 3)
    chat.focusTab()
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the leftover group is gone and its record forgotten; both learner files keep their tabs, and the Application stands in column 1.
    assert.equal(harness.groups.includes(leftover), false)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerNotes.tab)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerReadme.tab)),
      true,
    )
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's own empty locked group at column 1 when no record proves it is Codebook's; fails_when=a cold Study select focuses, unlocks or closes an empty group without the earlier window's record; why_new=Cycle 0046 finding 590's repair retires a leftover group only on proof; seam=leaveEmptyLockedGroup
test('an empty locked group at column 1 that no record proves stays as it is at a cold Study select', async () => {
  // Arrange: the learner's own empty group is locked at column 1; no window recorded an Application group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.leaveEmptyLockedGroup(1)
    const learnersGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the group was neither unlocked nor closed.
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.unlockEditorGroup'),
      false,
    )
    assert.equal(harness.groups.includes(learnersGroup), true)
    assert.equal(learnersGroup.locked, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the record of the Application group a Return claimed, which alone lets the window after a reload retire that group's empty leftover; fails_when=a confirmed Application group is not recorded, or is recorded with another column, group count or layout than the grid it was confirmed in; why_new=Cycle 0046 finding 590; seam=applicationGroupMarkers
test('a Return records the Application group it claimed for the window after a reload', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')

    // Act
    await harness.reader.action('return-current')

    // Assert: column 1 of the confirmed three-group grid, written by this reader (a random name).
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      { ...marker, writer: typeof marker?.writer },
      {
        version: 1,
        writer: 'string',
        column: 1,
        groupCount: 3,
        layout: {
          orientation: 1,
          groups: [{ size: 0.25 }, { size: 0.25 }, { size: 0.5 }],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's later empty group at column 1 after Close retired the Study's own Application group; fails_when=Close keeps the record of the group it retired, so the next window's cold Study select takes the learner's empty group in the same grid for Codebook's leftover and closes it; why_new=Cycle 0046 finding 590's record is forgotten when Codebook retires its group; seam=createReader (the next window over the same workspace state) and the learner's own native group commands
test('Close forgets the recorded Application group, so a later empty group at column 1 stays at the next window’s cold select', async () => {
  // Arrange: a Return claims the Application group and Close retires it; the learner then splits the window into the very grid the record described and locks its empty first group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const nextWindow = harness.createReader()
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.close()
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    await harness.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )
    await harness.editor.commands.executeCommand(
      'workbench.action.lockEditorGroup',
    )
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1,
      groups: [{ size: 0.25 }, { size: 0.25 }, { size: 0.5 }],
    })
    const learnersGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    assert.equal(learnersGroup.tabs.length, 0)
    const commandsBefore = harness.commands.length
    const state = nextWindow.presentationState()

    // Act
    await nextWindow.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the learner's group was neither unlocked nor closed.
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.unlockEditorGroup'),
      false,
    )
    assert.equal(harness.groups.includes(learnersGroup), true)
    assert.equal(learnersGroup.locked, true)
  } finally {
    await nextWindow.dispose()
    await harness.close()
  }
})

// Value: protects=the record of the Application group the Study still holds when a Return retires the Study's own empty Context group; fails_when=retiring the Context group forgets the Application group's record, so the window after a reload has no proof for the Application group left empty at column 1; why_new=Cycle 0046 finding 595 (C55 in Cursor: after rounds of Return Current the reload kept the empty Application group, and the cold select refused with "The previously focused source group changed; focus was not guessed."); seam=applicationGroupMarkers
test('a Return that retires the Study’s own Context group keeps the record of the Application group the Study still holds', async () => {
  // Arrange: a first Return claims the Application group at column 1; a saved item then gives the Study Context a group of its own at column 3.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    const contextGroup = harness.groups.find((group) => group.viewColumn === 3)!
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)

    // Act
    await harness.reader.action('return-current')

    // Assert: the Context group is gone, the Application still stands in its group at column 1, and that group's record names it alone, at the two-group grid this Return confirmed (finding 599).
    assert.equal(harness.groups.includes(contextGroup), false)
    assert.equal(harness.reader['app']!.viewColumn, 1)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      { ...marker, writer: typeof marker?.writer },
      {
        version: 1,
        writer: 'string',
        column: 1,
        groupCount: 2,
        layout: {
          orientation: 1,
          groups: [{ size: 0.5 }, { size: 0.5 }],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold Study select after a window reload retiring the empty Application group whose record outlived a Return that retired the Study's own Context group; fails_when=that Return forgot the record, so the cold select leaves the leftover group and puts the Application into it; why_new=Cycle 0046 finding 595 (C55 in Cursor: the reload after rounds of Return Current kept the empty Application group at column 1, and no unlock or close was issued); seam=createReader (the window after the reload, over the same workspace state) and leaveEmptyLockedGroup
test('a cold Study select after a window reload retires the empty Application group although a Return before the reload retired the Study’s Context group', async () => {
  // Arrange: a first Return claims the Application group; a saved item gives the Context a group of its own, and a second Return retires that group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    // The window reloads: the Application pane is not restored, and its group stays empty and locked at column 1.
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    const nextWindow = harness.createReader()
    try {
      const state = nextWindow.presentationState()

      // Act
      const selected = await nextWindow.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })

      // Assert: the leftover group is gone and its record forgotten; the new window's Application stands in column 1 with the layout confirmed.
      assert.equal(harness.groups.includes(leftover), false)
      assert.equal(
        harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
        undefined,
      )
      assert.equal(nextWindow['app']!.viewColumn, 1)
      assert.equal(selected.layoutConfirmed, true)
    } finally {
      await nextWindow.dispose()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the record of the Application group an MCP-first preparation claimed, while a Living book Open gives that group to the Study Context; fails_when=the preparation writes no record before the Open, or the hand-over forgets the record of the group that still stands locked at column 1; why_new=Cycle 0046 finding 596 (the hand-over of the MCP-first Application group to the source-derived Context leaves no App owner beside the record); seam=presentation.createViewport (the MCP-first preparation) and applicationGroupMarkers
test('a Living book Open that gives the MCP-first Application group to the Study Context keeps that group’s record', async () => {
  // Arrange: an MCP run prepared the Application in a locked group of its own at column 1 before the reader opened; the Living book preference is restored.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  const claimedGroup = harness.groups.find((group) => group.viewColumn === 1)!
  try {
    // Act
    await reader.open()

    // Assert: the claimed group, still locked at column 1, now holds the Study Context, and the record the preparation wrote for it stays, at the three-group grid the Open confirmed (finding 599).
    assert.equal(harness.groups.includes(claimedGroup), true)
    assert.equal(claimedGroup.locked, true)
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      { ...marker, writer: typeof marker?.writer },
      {
        version: 1,
        writer: 'string',
        column: 1,
        groupCount: 3,
        layout: {
          orientation: 0,
          groups: [
            { size: 0.6 },
            { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] },
          ],
        },
      },
    )
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=a record that never outlives, in the same window, the group it describes once a Return retired the Study Context's group, the one a Living book Open took from the MCP-first Application; fails_when=the retirement keeps the record because no App owner names that group, and the Return, refused before it claims a new group, writes no record over it, so after a later reload a learner's empty group at column 1 in the same grid passes for Codebook's leftover; why_new=Cycle 0046 finding 596 (finding 595's rule clears the record only for the App owner's allocation, and the hand-over leaves no App owner); seam=failNextCommand('workbench.action.newGroupAbove') and applicationGroupMarkers
test('a Return that retires the Study Context’s group taken from the MCP-first Application forgets that group’s record although the editor refuses the new Application group', async () => {
  // Arrange: an MCP run prepared the Application at column 1, and the Living book Open gave that group to the Study Context; the editor will refuse the Return's new group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  try {
    await reader.open()
    const contextGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    harness.failNextCommand('workbench.action.newGroupAbove')
    const state = reader.presentationState()

    // Act
    await assert.rejects(
      reader.returnToCurrent({
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      }),
      /Native layout command failed/,
    )

    // Assert: the Context's group is gone, and so is its record.
    assert.equal(harness.groups.includes(contextGroup), false)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=a learner's later empty group at column 1 after Close removed the Study Context's group, the one a Living book Open took from the MCP-first Application; fails_when=Close keeps the record of that removed group because no App owner is left to release it, so the next window's cold Study select takes the learner's empty locked group in the very grid the record described for Codebook's leftover, unlocks it and closes it; why_new=Cycle 0046 finding 596; seam=closeDisposedPanelTabsLater (the editor removes the group the Context's last tab left, workbench.editor.closeEmptyGroups on), createReader (the next window over the same workspace state) and the learner's own native group commands
test('Close after a Living book Open that took the MCP-first Application group forgets its record, so a later empty group at column 1 stays at the next window’s cold select', async () => {
  // Arrange: an MCP run prepared the Application at column 1, the Living book Open gave that group to the Study Context, and Close removed it with the Context's tab; the learner then splits the window into the very grid the record described at that Open (finding 599) and locks its empty first group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.focusMutableDraft()
  harness.closeDisposedPanelTabsLater()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  const nextWindow = harness.createReader()
  try {
    await reader.open()
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    // End the MCP run's lease first; a live lease keeps its Application available.
    viewport.close()
    await reader.close()
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    await harness.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )
    await harness.editor.commands.executeCommand(
      'workbench.action.lockEditorGroup',
    )
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [
        { size: 0.6 },
        { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] },
      ],
    })
    const learnersGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    assert.equal(learnersGroup.tabs.length, 0)
    const commandsBefore = harness.commands.length
    const state = nextWindow.presentationState()

    // Act
    await nextWindow.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the learner's group was neither unlocked nor closed.
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.unlockEditorGroup'),
      false,
    )
    assert.equal(harness.groups.includes(learnersGroup), true)
    assert.equal(learnersGroup.locked, true)
  } finally {
    viewport.close()
    await nextWindow.dispose()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=the learner's window after Close of a Study whose Context holds the group a Living book Open took from the MCP-first Application, in an editor that keeps a group its last tab left (workbench.editor.closeEmptyGroups off); fails_when=Close leaves that group empty and locked at column 1 because no App owner is left for the release to retire it, keeps its record, or leaves the empty source group Codebook created beside the learner's group; why_new=Cycle 0046 finding 597 (finding 596's hand-over leaves the donated group without an App owner); seam=presentation.createViewport (the MCP-first preparation), the fake editor that keeps emptied groups, and applicationGroupMarkers
test('Close after a Living book Open that took the MCP-first Application group retires every empty group Codebook created and forgets the record, in an editor that keeps emptied groups', async () => {
  // Arrange: an MCP run prepared the Application at column 1 and the Living book Open gave that group to the Study Context; the editor keeps a group its last tab left.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart()
  const learnerNotes = harness.focusMutableDraft()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  try {
    await reader.open()
    const donatedGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    // End the MCP run's lease first; a live lease keeps its Application available.
    viewport.close()

    // Act
    await reader.close()

    // Assert: beside the chat's own part, only the learner's group is left, with the learner's notes, and the donated group's record is gone with it.
    const mainGroups = harness.groups.filter(
      (group) => !group.tabs.includes(chat.tab),
    )
    assert.equal(harness.groups.includes(donatedGroup), false)
    assert.equal(mainGroups.length, 1)
    assert.equal(mainGroups[0]!.tabs.includes(learnerNotes.tab), true)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=the learner's window after Close of a Study whose Context holds a group of its own that Codebook created beside the Application's group, in an editor that keeps a group its last tab left (workbench.editor.closeEmptyGroups off); fails_when=Close retires the Application's group but leaves the Study Context's created group empty beside the learner's group; why_new=Cycle 0046 finding 597 (Close retired only the App owner's group); seam=the fake editor that keeps emptied groups
test('Close of a Study whose Context holds a group Codebook created gives back exactly the learner’s group, in an editor that keeps emptied groups', async () => {
  // Arrange: a Return claims the Application group at column 1; a saved item then gives the Study Context a group of its own at column 3.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const learnersGroup = harness.groups[0]!,
    learnersTabs = [...learnersGroup.tabs]
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    const contextGroup = harness.groups.find((group) => group.viewColumn === 3)!
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)

    // Act
    await harness.reader.close()

    // Assert: the Context's group is gone, and the learner's group stands alone with its own tabs.
    assert.equal(harness.groups.includes(contextGroup), false)
    assert.deepEqual(
      harness.groups.map((group) => group.tabs),
      [learnersTabs],
    )
  } finally {
    await harness.close()
  }
})

for (const editor of [
  { keeps: 'keeps', removesEmptiedGroups: false },
  { keeps: 'removes', removesEmptiedGroups: true },
] as const)
  // Value: protects=the learner's window after Close of a Living book Open beside no chat part, whose captured source the editor gave a group of its own at column 3; fails_when=nothing tracks the group that source display created, so Close leaves it empty beside the learner's group when the editor keeps emptied groups (workbench.editor.closeEmptyGroups off), or any other group Codebook created stays; why_new=Cycle 0046 finding 597 (finding 597's observation 3: without the chat's part no reservation precedes the source display, and showTextDocument at a column beyond the grid creates that group); seam=presentation.createViewport (the MCP-first preparation), createGroupForTextBeyondGrid (the editor's own group for a text shown beyond the grid), closeDisposedPanelTabsLater for the editor that removes emptied groups
  test(`Close after a Living book Open beside no chat part leaves no group Codebook created, in an editor that ${editor.keeps} emptied groups`, async () => {
    // Arrange: an MCP run prepared the Application at column 1 beside the learner's group; the Living book Open shows the captured source at column 3, where the editor gives it a group of its own.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    harness.focusMutableDraft()
    harness.createGroupForTextBeyondGrid()
    if (editor.removesEmptiedGroups) harness.closeDisposedPanelTabsLater()
    const learnersTabs = [...harness.groups[0]!.tabs]
    harness.presentationPreferences.set('codebook.presentation.v1', {
      version: 1,
      mode: 'living-book',
    })
    const reader = harness.createReader(),
      viewport = await reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      )
    try {
      await reader.open()
      assert.deepEqual(
        harness.groups.map((group) => group.tabs.length),
        [1, 3, 1],
      )
      assert.equal(harness.textDocumentShows().at(-1)?.viewColumn, 3)
      // End the MCP run's lease first; a live lease keeps its Application available.
      viewport.close()

      // Act
      await reader.close()

      // Assert: the learner's group stands alone, with the tabs it had before the MCP run.
      assert.deepEqual(
        harness.groups.map((group) => group.tabs),
        [learnersTabs],
      )
    } finally {
      viewport.close()
      await reader.dispose()
      await harness.close()
    }
  })

// Value: protects=the learner's window after Close of a Study whose arrangement created a Source group the captured source never entered, in an editor that removes emptied groups (workbench.editor.closeEmptyGroups on): the editor removes the claimed group first and every later column shifts; fails_when=the shift ends the created Source group's receipt and the App owner's release clears the record's identities before the Close retires the empty groups it created, so that empty group stays beside the learner's group; why_new=Cycle 0046 finding 597 (observation 3 in the harness's own model of a Living book Open beside no chat part: the fake shows the source in the first group and the arrangement's vscode.setEditorLayout creates the empty third group); seam=presentation.createViewport (the MCP-first preparation), the fake editor's text placement in the first group, closeDisposedPanelTabsLater
test('Close leaves no empty group Codebook created when the editor removes the claimed group first and shifts the created Source group', async () => {
  // Arrange: an MCP run prepared the Application at column 1; the Living book Open put the captured source beside the Context in that group and created an empty Source group at column 3; the editor removes a group its last tab left.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.focusMutableDraft()
  harness.closeDisposedPanelTabsLater()
  const learnersTabs = [...harness.groups[0]!.tabs]
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  try {
    await reader.open()
    assert.deepEqual(
      harness.groups.map((group) => group.tabs.length),
      [2, 3, 0],
    )
    // End the MCP run's lease first; a live lease keeps its Application available.
    viewport.close()

    // Act
    await reader.close()

    // Assert: the learner's group stands alone, with the tabs it had before the MCP run.
    assert.deepEqual(
      harness.groups.map((group) => group.tabs),
      [learnersTabs],
    )
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=a record that never outlives, in the same window, the Application group it describes once a preparation that already recorded its group is cancelled; fails_when=the cancellation that arrives during the preparation's final layout read closes the empty group the preparation claimed but keeps that group's record, so after a later reload a learner's empty group at column 1 in the same grid passes for Codebook's leftover; why_new=Cycle 0046 finding 598 (found by reading: the record is written before the preparation's last check of current intent, and the failure cleanup closed the group with tabGroups.close directly); seam=presentation.createViewport with its cancellation (the MCP-first preparation a newer run replaces), holdNextCommand('vscode.getEditorLayout') and applicationGroupMarkers
test('a cancelled Application preparation that already recorded its group forgets that record as it retires the group', async () => {
  // Arrange: an MCP run prepares the Application in a group of its own; the run is replaced while the preparation reads the confirmed layout.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  const reader = harness.createReader(),
    preparation = new AbortController()
  const gridRead = harness.holdNextCommand('vscode.getEditorLayout')
  const viewport = Promise.resolve(
    reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
      preparation.signal,
    ),
  ).catch((error: unknown) => error)
  let finalRead: ReturnType<typeof harness.holdNextCommand> | undefined
  try {
    // The first read measures the grid before the allocation; the next one confirms the Application in its claimed group.
    await gridRead.started
    finalRead = harness.holdNextCommand('vscode.getEditorLayout')
    gridRead.release()
    await finalRead.started
    const claimedGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(claimedGroup.locked, true)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)

    // Act: a newer run replaces this one during the final layout read.
    preparation.abort(new Error('A newer run replaced this preparation.'))
    finalRead.release()
    const outcome = await viewport

    // Assert: the preparation was refused, its claimed group is gone, and so is that group's record.
    assert.equal(
      String(outcome),
      'Error: A newer run replaced this preparation.',
    )
    assert.equal(harness.groups.includes(claimedGroup), false)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
  } finally {
    gridRead.release()
    finalRead?.release()
    await viewport
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=a record that never outlives, in the same window, the Application group it describes once a cancelled preparation's pane leaves and the editor removes the group with the pane's tab (workbench.editor.closeEmptyGroups on, the default); fails_when=the failure cleanup finds no empty group of its own to close and keeps the record of the group the editor removed; why_new=Cycle 0046 finding 598 (the editor, not Codebook, retires the claimed group in the default configuration); seam=presentation.createViewport with its cancellation, holdNextCommand('vscode.getEditorLayout'), closeDisposedPanelTabsLater and applicationGroupMarkers
test('a cancelled Application preparation that already recorded its group forgets that record when the editor removes the group with the pane’s tab', async () => {
  // Arrange: an MCP run prepares the Application in a group of its own in an editor that removes a group its last tab left; the run is replaced while the preparation reads the confirmed layout.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  harness.closeDisposedPanelTabsLater()
  const reader = harness.createReader(),
    preparation = new AbortController()
  const gridRead = harness.holdNextCommand('vscode.getEditorLayout')
  const viewport = Promise.resolve(
    reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
      preparation.signal,
    ),
  ).catch((error: unknown) => error)
  let finalRead: ReturnType<typeof harness.holdNextCommand> | undefined
  try {
    // The first read measures the grid before the allocation; the next one confirms the Application in its claimed group.
    await gridRead.started
    finalRead = harness.holdNextCommand('vscode.getEditorLayout')
    gridRead.release()
    await finalRead.started
    const claimedGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(claimedGroup.locked, true)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)

    // Act: a newer run replaces this one during the final layout read.
    preparation.abort(new Error('A newer run replaced this preparation.'))
    finalRead.release()
    const outcome = await viewport

    // Assert: the preparation was refused, the editor removed its claimed group, and that group's record is gone too.
    assert.equal(
      String(outcome),
      'Error: A newer run replaced this preparation.',
    )
    assert.equal(harness.groups.includes(claimedGroup), false)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
  } finally {
    gridRead.release()
    finalRead?.release()
    await viewport
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=a record that never outlives, in the same window, the group a Living book Open took from the MCP-first Application for the Study Context, when Close leaves that group to the editor, which removes it with the Context's last tab (workbench.editor.closeEmptyGroups on); fails_when=Close keeps the record because no App owner is left to release the group and Codebook found no group of its own to retire; why_new=Cycle 0046 finding 599 (the record now names every group by identity, and the forget of a removed group follows all of them; this case reaches the hand-over itself: beside the chat's part the Open gives the claimed group to the Context alone, while without it the captured source joins the Context there and the App owner stays); seam=presentation.createViewport (the MCP-first preparation), addSeparateEditorPart, closeDisposedPanelTabsLater and applicationGroupMarkers
test('Close after a Living book Open that took the MCP-first Application group forgets its record when the editor removes that group with the Context’s tab', async () => {
  // Arrange: an MCP run prepared the Application at column 1 and the Living book Open gave that group to the Study Context; the editor removes a group its last tab left.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  harness.closeDisposedPanelTabsLater()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  try {
    await reader.open()
    const donatedGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    assert.equal(reader['applicationGroup'], undefined)
    // End the MCP run's lease first; a live lease keeps its Application available.
    viewport.close()

    // Act
    await reader.close()

    // Assert: the editor removed the donated group, and its record went with it.
    assert.equal(harness.groups.includes(donatedGroup), false)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

// Value: protects=the record of every group Codebook created that a reload would leave empty, at the layout a Study select confirmed after it gave the Study Context a group of its own beside the Application's group; fails_when=the record keeps the grid of the Application group's reservation only, or does not name the Study Context's created group; why_new=Cycle 0046 finding 599 (the record kept the reservation's grid, so a reload in a later layout left the Application's leftover unproven and the Context's leftover unrecorded); seam=applicationGroupMarkers
test('a Study select that gives the Context a group of its own records the Application’s group and the Context’s group at the layout it confirmed', async () => {
  // Arrange: a Return claims the Application group at column 1 beside the learner's group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')

    // Act: a saved item gives the Study Context a group of its own at column 3.
    await harness.reader.select('repository/workspace/overview')

    // Assert: both groups, by their columns in the confirmed three-group grid, written by this reader (a random name).
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      { ...marker, writer: typeof marker?.writer },
      {
        version: 2,
        writer: 'string',
        columns: [1, 3],
        groupCount: 3,
        layout: {
          orientation: 0,
          groups: [
            { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 0.45 },
          ],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold Study select after a window reload that left the Application's group empty and locked at column 1 and the Study Context's created group empty at column 3, beside the learner's group; fails_when=the record kept only the reservation's two-group grid, so the cold select proves neither leftover, puts the Application into the locked one and refuses (finding 590's failure), and the Context's empty group stays for good; why_new=Cycle 0046 finding 599; seam=createReader (the window after the reload, over the same workspace state), leaveEmptyLockedGroup and leaveEmptyGroup
test('a cold Study select after a window reload retires the empty Application group and the Study Context’s empty created group the earlier window recorded', async () => {
  // Arrange: one learner group; a Return claims the Application group, and a saved item gives the Study Context a group of its own at column 3.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    // The window reloads: neither pane is restored; the Application's group stays empty and locked at column 1, the Context's group empty at column 3.
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    const nextWindow = harness.createReader()
    try {
      const state = nextWindow.presentationState()

      // Act
      const selected = await nextWindow.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })

      // Assert: both leftovers are gone and their record forgotten; the new window's Application stands in column 1 with the layout confirmed.
      assert.equal(nextWindow.inspect().view!.errors.join(' | '), '')
      assert.equal(harness.groups.includes(applicationLeftover), false)
      assert.equal(harness.groups.includes(contextLeftover), false)
      assert.equal(
        harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
        undefined,
      )
      assert.equal(nextWindow['app']!.viewColumn, 1)
      assert.equal(selected.layoutConfirmed, true)
    } finally {
      await nextWindow.dispose()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's group after a window reload whose two recorded leftovers a cold Study select retired: the new Study can be restored, and its Close gives back exactly the learner's group with its own tab; fails_when=a leftover stays beside the learner's group, the Restore cannot confirm the Study's layout, or the Close leaves a group Codebook created; why_new=Cycle 0046 finding 599 (with finding 597's Close); seam=createReader, leaveEmptyLockedGroup and leaveEmptyGroup
test('after a cold Study select retired both recorded leftovers of a reload, Restore confirms the Study and Close gives back exactly the learner’s group', async () => {
  // Arrange: the same reload as above, and the window after it selected the Study, which retired both leftovers.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const learnersTab = harness.groups[0]!.tabs[0]!
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(3)
    const nextWindow = harness.createReader()
    try {
      const selectState = nextWindow.presentationState()
      await nextWindow.changePresentation({
        presentationId: selectState.presentationId,
        expectedRevision: selectState.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })

      // Act
      const restoreState = nextWindow.presentationState()
      const restored = await nextWindow.changePresentation({
        presentationId: restoreState.presentationId,
        expectedRevision: restoreState.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      await nextWindow.close()

      // Assert: the Restore confirmed the Study's layout, and after the Close only the learner's group is left, with its own tab.
      assert.equal(restored.layoutConfirmed, true)
      assert.deepEqual(
        harness.groups.map((group) => group.tabs),
        [[learnersTab]],
      )
    } finally {
      await nextWindow.dispose()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's groups when the learner changed the layout after the last layout Codebook confirmed and the window then reloads; fails_when=the cold Study select guesses that the changed grid is the recorded one and unlocks or closes a group, or forgets the record without a proof; why_new=Cycle 0046 finding 599 (a layout the learner changed without a Codebook confirmation is not guessed: the proof fails conservatively); seam=createReader, leaveEmptyLockedGroup, leaveEmptyGroup and the learner's own layout command
test('a cold Study select after a reload leaves the recorded leftovers untouched when the learner resized the groups after the last confirmed layout', async () => {
  // Arrange: the record names both groups at the confirmed Study grid; the learner then widens the Context's column, and the window reloads.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    await harness.reader.select('repository/workspace/overview')
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [
        { size: 0.3, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.7 },
      ],
    })
    const recordBefore = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    )
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    const nextWindow = harness.createReader()
    try {
      const commandsBefore = harness.commands.length
      const state = nextWindow.presentationState()

      // Act
      await nextWindow
        .changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        })
        .catch(() => undefined)

      // Assert: no group was unlocked or retired as a leftover, and the record is kept as it was.
      assert.equal(
        harness.commands
          .slice(commandsBefore)
          .includes('workbench.action.unlockEditorGroup'),
        false,
      )
      assert.equal(harness.groups.includes(applicationLeftover), true)
      assert.equal(harness.groups.includes(contextLeftover), true)
      assert.deepEqual(
        harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
        recordBefore,
      )
    } finally {
      await nextWindow.dispose()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the editor-restart case of finding 590 across the update: a version-1 record that a 0.2.30 candidate (C55) wrote, in pixels, still proves the empty locked Application group that a quit and relaunch of the editor restored at column 1, as after Developer: Reload Window; fails_when=the reader of the new record shape no longer reads a version-1 record as the Application group alone, so the cold select keeps the leftover and puts the Application into it; why_new=Cycle 0046 finding 599 (the record's shape changed; the VS Code QA window holds such a record); seam=applicationGroupMarkers (the record C55 wrote) and leaveEmptyLockedGroup
test('a cold Study select after an editor restart retires the empty Application group a version-1 record of a 0.2.30 candidate proves', async () => {
  // Arrange: C55 recorded its Application group at column 1 of a three-group grid of rows, in pixels; the restarted editor restored that group empty and locked, with the learner's files in rows 2 and 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: '3f0c5a52-8f4e-4f43-9a5e-1d2b7c9e6a10',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 1,
        groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    const learnerReadme = harness.focusMutableDraft('learner-readme.md', 3)
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the leftover group is gone and its record forgotten; both learner files keep their tabs, and the Application stands in column 1.
    assert.equal(harness.groups.includes(leftover), false)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerNotes.tab)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerReadme.tab)),
      true,
    )
    assert.equal(harness.reader['app']!.viewColumn, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's file in a group the earlier window's record names, after a window reload: the cold Study select retires only the recorded group that is proved empty; fails_when=a recorded group that holds a learner's tab is closed with its tab, or the empty Application group beside it stays because the record is taken as a whole; why_new=Cycle 0046 finding 599 (each recorded leftover is retired on its own proof in the recorded grid); seam=applicationGroupMarkers (a version-2 record of the earlier window) and leaveEmptyLockedGroup
test('a cold Study select after a reload retires the recorded empty Application group and keeps the recorded Context group that holds a learner’s file', async () => {
  // Arrange: the earlier window recorded the Application's group at column 1 and the Study Context's group at column 3; after the reload the learner's files stand in columns 2 and 3, and the chat part has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 2,
      writer: 'the window before the reload',
      columns: [1, 3],
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const applicationLeftover = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    harness.focusMutableDraft('learner-notes.ts', 2)
    const learnerReadme = harness.focusMutableDraft('learner-readme.md', 3)
    const readmeGroup = harness.groups.find((group) =>
      group.tabs.includes(learnerReadme.tab),
    )!
    chat.focusTab()
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the empty Application group is gone and the record with it; the recorded group with the learner's file stands with its tab.
    assert.equal(harness.groups.includes(applicationLeftover), false)
    assert.equal(harness.groups.includes(readmeGroup), true)
    assert.equal(readmeGroup.tabs.includes(learnerReadme.tab), true)
    assert.equal(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      undefined,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's groups at a Restore after a Return that was refused once the Application stood in its new group; fails_when=the arrangement applies a layout no confirmed receipt describes (the live pair, or no layout at all) over the window's groups instead of refusing it; why_new=Cycle 0046 finding 591 (C54 in Cursor 3.23.12: the Restore after the refused Return merged a learner group into the source group); seam=reactivatePreviousGroupAtNextLayoutRead
test('a Restore with no confirmed layout for the window’s groups refuses the arrangement and leaves every group’s tabs', async () => {
  // Arrange: one learner group; the Return is refused after the Application moved into its new group, so the window holds two groups and no confirmed Application layout.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.focusMutableDraft('learner-notes.ts', 1)
    chat.focusTab()
    const state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.reactivatePreviousGroupAtNextLayoutRead(4)
    await harness.reader.action('return-current').catch(() => undefined)
    const tabsBefore = harness.groups.map((group) => [...group.tabs])
    const restoreState = harness.reader.presentationState()

    // Act
    const restore = await harness.reader
      .changePresentation({
        presentationId: restoreState.presentationId,
        expectedRevision: restoreState.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      .catch((error: unknown) => error)

    // Assert: the arrangement was refused with the groups-preserved message, the Restore says the live layout could not be confirmed, and every group keeps its tabs.
    assert.deepEqual(
      [...harness.reader.inspect().view!.errors],
      [
        'Error: Existing editor groups were preserved. Use the focus commands or arrange the Codebook panes manually.',
      ],
    )
    assert.equal(
      String(restore),
      'Error: The live Study layout could not be confirmed after Restore.',
    )
    assert.deepEqual(
      harness.groups.map((group) => [...group.tabs]),
      tabsBefore,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Open replay opening the recording at the first click while the learner's file is the tab in front of the live Application pane; fails_when=the entry reveals the Application pane and starts its arrangement before the editor has reported that reveal, so its own reveal reads as a change the learner made and the click ends with "Native pane, group or focus changed while presentation waited; the learner arrangement was preserved."; why_new=Cycle 0045 NF-20 (Cursor: the first click failed whenever a preview or kept tab was in front of the pane, the second opened it); seam=the recorded reader harness, focusMutableDraft, the fake editor reporting a pane's reveal later, and the fake clock, which alone lets the fake editor's own timer pass (local review tests-1 #3: no real delay decides whether the report arrives during the arrangement)
test("Open replay with the learner's file in front of the live Application pane opens the recording at the first click", async (context) => {
  // Arrange: the reader is open, and the file the learner (or the debugger) opened in the Application's group is in front of the pane with the keyboard focus.
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const learnerFile = harness.focusMutableDraft('login-form.tsx', 1)
    harness.revealPanelsLater()
    enableFakeClock(context)

    // Act: one click on Open replay. The fake editor reports the reveal while a layout read is pending, or by itself once the faked clock has passed its delay; the clock moves only while the entry waits.
    const opening = harness.reader
      .openRecording(harness.studyId)
      .then(() => harness.controller.settle())
    await advanceClockUntilSettled(context, opening, 6_000)
    resetFakeClock(context)

    // Assert
    assert.equal(harness.controller.state().reason, undefined)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(learnerFile.document.getText(), 'Original learner draft.\n')
    assert.equal(learnerFile.tab.isDirty, true)
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 2)
        ?.tabs.includes(learnerFile.tab),
      true,
    )
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

for (const column of [1, 2, 3] as const)
  // Value: protects=a selection and a Restore made while a kept tab that is no text editor (an image) has the focus arranging the three panes, instead of leaving the Study pane filling the window; fails_when=the selection is not arranged for that tab and falls back to the enlarged explanation, and every Restore ends there again; why_new=Cycle 0045 NF-22 with PC-1.10 (the state no longer arises since the first part of package S1 admits such a tab; this pins it for each Study column and for the Restore after it); seam=addOpaqueTab, focusOpaqueTab
  test(`a selection and a Restore made beside a focused kept image tab in editor group ${column} arrange the Study panes without enlarging the Study pane`, async () => {
    // Arrange: the learner keeps an image open and it has the focus; it is no preview and no text editor.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
    try {
      const image = harness.addOpaqueTab('logo.png', column)
      harness.focusOpaqueTab(image)
      const closed = harness.reader.presentationState()

      // Act
      const selected = await harness.reader.changePresentation({
        presentationId: closed.presentationId,
        expectedRevision: closed.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      const restored = await harness.reader.changePresentation({
        presentationId: selected.presentationId,
        expectedRevision: selected.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })

      // Assert
      assert.equal(selected.layoutConfirmed, true)
      assert.equal(selected.reason, undefined)
      assert.equal(restored.layoutConfirmed, true)
      assert.equal(restored.reason, undefined)
      assert.equal(restored.panes.appColumn, 1)
      assert.equal(restored.panes.sourceColumn, 2)
      assert.equal(restored.panes.contextColumn, 3)
      assert.equal(
        harness.commands.includes('workbench.action.maximizeEditorHideSidebar'),
        false,
      )
      assert.equal(harness.maximizedEditorGroup(), false)
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(image)),
        true,
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=Close Study Workspace ending the maximized editor group a Read of a pane left; fails_when=the workspace closes its panes and the editor stays with one maximized group; why_new=Cycle 0045 NF-22 (close undid neither the maximized group nor the hidden side bars); seam=the fake editor's maximized group
test('Close Study Workspace ends the maximized editor group that a Read of a pane left', async () => {
  // Arrange: the learner read the explanation enlarged; the editor shows that group maximized.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    const maximizedByRead = harness.maximizedEditorGroup()

    // Act
    await harness.reader.close()

    // Assert
    assert.equal(maximizedByRead, true)
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's side bars after a Read and Close Study Workspace: the primary side bar and the secondary one (the Agent pane in Cursor) are open again as before the Read, and the closed reader's state carries no reason of the reading that ended; fails_when=the editor's maximize command hid both bars, Close ends the maximization and neither bar comes back, so the window stays without its file explorer and its chat until the learner finds the two toggle commands, and the closed state still reads "Focused explanation. …" at the ready of the next run; why_new=Cycle 0045 NF-22 (obs15 P4, `c3-before.json`, `c3-after-read.json`, `c3-after-close.json` in Cursor 3.23.12 and `v-*.json` in VS Code 1.140.0: both bars at width 0 after Close); seam=the workspace harness's side bar model (the maximize command hides both bars, leaving the maximization shows neither) and its maximized group
test('closing the Study workspace after a Read brings back the side bars the Read hid', async () => {
  // Arrange: both side bars are open; the learner reads the explanation enlarged, which hides them.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: true })
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    const duringRead = {
      ...harness.sideBars(),
      maximized: harness.maximizedEditorGroup(),
      reason: harness.reader.presentationState().reason,
    }

    // Act
    await harness.reader.close()

    // Assert
    assert.deepEqual(duringRead, {
      primary: false,
      auxiliary: false,
      hasKeyboard: false,
      maximized: true,
      reason:
        'Focused explanation. The three-pane Study split is not confirmed. Use the pane controls or Restore layout.',
    })
    // Both bars are open again, and the keyboard is in the editor, not in a side bar.
    assert.deepEqual(harness.sideBars(), {
      primary: true,
      auxiliary: true,
      hasKeyboard: false,
    })
    assert.equal(harness.maximizedEditorGroup(), false)
    const closed = harness.reader.presentationState()
    assert.equal(closed.state, 'closed')
    assert.equal(closed.reason, undefined)
  } finally {
    await harness.close()
  }
})

for (const open of [
  { primary: false, auxiliary: true },
  { primary: true, auxiliary: false },
  { primary: false, auxiliary: false },
])
  // Value: protects=a side bar the learner keeps closed staying closed through a Read and its end: only the bars the Read hid come back; fails_when=the end of the Read shows both bars whatever the learner had, so a learner who works without the file explorer or without the chat gets it opened by every Read; why_new=Cycle 0045 NF-22 (the fix shows bars again; the editor API does not say which bars are open, so the reader measures the editor area's width); seam=the workspace harness's side bar model and its pixel layout read
  test(`a side bar the learner had closed before the Read stays closed, with the primary side bar ${open.primary ? 'open' : 'closed'} and the secondary one ${open.auxiliary ? 'open' : 'closed'}`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.modelSideBars(open)
    try {
      await harness.reader.open()
      await harness.reader.action('read-context')
      const duringRead = harness.sideBars()

      // Act
      await harness.reader.close()

      // Assert
      assert.deepEqual(duringRead, {
        primary: false,
        auxiliary: false,
        hasKeyboard: false,
      })
      assert.deepEqual(harness.sideBars(), { ...open, hasKeyboard: false })
      // A bar that was closed is not touched: its show command is not run.
      assert.equal(
        harness.commands.includes('workbench.action.focusSideBar'),
        open.primary,
      )
      assert.equal(
        harness.commands.includes('workbench.action.focusAuxiliaryBar'),
        open.auxiliary,
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner's side bars after a Read and the pane's Restore: the three panes are arranged again between the bars that were open before the Read, with the layout confirmed; fails_when=Restore ends the maximization and arranges the panes across the whole window, with the file explorer and the chat still hidden; why_new=Cycle 0045 NF-22 (a Restore that leaves the reading belongs to the same row as Close); seam=the workspace harness's side bar model and its pixel layout read
test('a Restore that ends a Read brings back the side bars the Read hid and confirms the three panes between them', async () => {
  // Arrange: the primary side bar is open, the secondary one closed; the learner reads the explanation enlarged.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: false })
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    const duringRead = harness.sideBars()

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.deepEqual(duringRead, {
      primary: false,
      auxiliary: false,
      hasKeyboard: false,
    })
    assert.deepEqual(harness.sideBars(), {
      primary: true,
      auxiliary: false,
      hasKeyboard: false,
    })
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(harness.maximizedEditorGroup(), false)
    const restored = await harness.reader.readPresentationState()
    assert.equal(restored.layoutConfirmed, true)
    assert.equal(restored.reason, undefined)
  } finally {
    await harness.close()
  }
})

for (const before of [
  { primary: false, auxiliary: true },
  { primary: false, auxiliary: false },
])
  // Value: protects=the side bars after a Read during which the learner opened the primary side bar again: the Restore brings back the secondary bar the Read hid and leaves the primary one open; fails_when=the Restore compares the editor area beside the reopened primary bar with the width it had beside the secondary one, sees no gain for bars of about the same width, and leaves the chat hidden; or its second measurement hides the reopened primary bar and does not show it again; why_new=Cycle 0045 local review study-1 #1, second case (the measurement assumed that no bar is opened between Read and Restore); seam=the workspace harness's side bar model with both bars 300 px wide, and the learner's own show command
  test(`a Restore after the learner opened the primary side bar during a Read shows the bars the Read hid and keeps the primary one open, with the secondary side bar ${before.auxiliary ? 'open' : 'closed'} before the Read`, async () => {
    // Arrange: both bars are 300 px wide; the primary one is closed before the Read, and the learner opens it while reading and returns to the pane.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.modelSideBars(before, { primary: 300, auxiliary: 300 })
    try {
      await harness.reader.open()
      await harness.reader.action('read-context')
      await harness.editor.commands.executeCommand(
        'workbench.action.focusSideBar',
      )
      await harness.editor.commands.executeCommand(
        'workbench.action.focusActiveEditorGroup',
      )
      const duringRead = harness.sideBars()

      // Act
      await harness.reader.action('arrange')

      // Assert
      assert.deepEqual(duringRead, {
        primary: true,
        auxiliary: false,
        hasKeyboard: false,
      })
      assert.deepEqual(harness.sideBars(), {
        primary: true,
        auxiliary: before.auxiliary,
        hasKeyboard: false,
      })
      assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
      assert.equal(harness.maximizedEditorGroup(), false)
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner's primary side bar after a Read that was refused because the work window lost the focus while the reader measured the side bars: the bar is open as before, and the next Read measures again; fails_when=the measurement hid the primary side bar, the refusal left it hidden with no maximized group, and the reader kept the reading as begun, so the file explorer stays away until a later Restore or Close; why_new=Cycle 0045 local review study-1 #6 and coderabbit #6 (the measurement of NF-22 runs before the Read's last check that can refuse); seam=the workspace harness's side bar model, holdNextCommand on the measurement's close command, changeWindowFocus
test('a Read refused while the reader measured the side bars leaves the primary side bar open and no maximized group', async () => {
  // Arrange: both side bars are open; the work window loses and regains the focus while the Read's measurement hides the primary side bar.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: true })
  let release = (): void => {}
  try {
    await harness.reader.open()
    const measurement = harness.holdNextCommand('workbench.action.closeSidebar')
    release = measurement.release

    // Act
    const reading = harness.reader.action('read-context')
    await measurement.started
    harness.changeWindowFocus(false)
    harness.changeWindowFocus(true)
    measurement.release()
    await assert.rejects(reading, /work window lost focus/i)
    const afterRefusal = {
      ...harness.sideBars(),
      maximized: harness.maximizedEditorGroup(),
    }
    await harness.reader.action('read-context')
    const duringNextRead = harness.sideBars()
    await harness.reader.close()

    // Assert
    assert.deepEqual(afterRefusal, {
      primary: true,
      auxiliary: true,
      hasKeyboard: false,
      maximized: false,
    })
    assert.deepEqual(duringNextRead, {
      primary: false,
      auxiliary: false,
      hasKeyboard: false,
    })
    // The next Read measured both bars as open, so its Close shows both again.
    assert.deepEqual(harness.sideBars(), {
      primary: true,
      auxiliary: true,
      hasKeyboard: false,
    })
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=the learner's side bars after a Read during which the learner made the window wider: the Restore shows the primary side bar the Read hid and leaves the secondary one closed, as before the Read; fails_when=the Restore takes the editor area's growth since the Read for the hidden secondary side bar and opens a secondary side bar (Cursor's Agent pane) the learner had closed; why_new=Cycle 0046 row 30 (PL-22 of Cycle 0045: the width before the Read was compared with the width at its end); seam=the workspace harness's side bar model and its resizeWindow
test('a Restore after the learner widened the window during a Read shows the side bars as they were before the Read and opens no secondary side bar', async () => {
  // Arrange: the primary side bar is open and the secondary one closed; the learner reads the explanation enlarged and then widens the window by 600 px.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: false })
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    harness.resizeWindow(1935)

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.deepEqual(harness.sideBars(), {
      primary: true,
      auxiliary: false,
      hasKeyboard: false,
    })
    assert.equal(
      harness.commands.includes('workbench.action.focusAuxiliaryBar'),
      false,
    )
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(harness.maximizedEditorGroup(), false)
  } finally {
    await harness.close()
  }
})

for (const read of ['read-app', 'read-source', 'read-context'] as const)
  for (const secondaryBar of ['closed', 'open'] as const)
    for (const ending of ['Restore', 'Close Study Workspace'] as const)
      // Value: protects=the learner's secondary side bar (Cursor's Agent pane) after a Read of any of the three panes: Restore and Close show it again when it was open before the Read and leave it closed when it was closed; fails_when=the Read measures the editor area through its own maximized layout, in which the editor answers every hidden group with the width it had while visible, so the area seems to have grown by a side bar and a secondary side bar the learner had closed opens after every Read App or Read Source, or the answer of a hidden split column fails the layout's check and the measurement is lost; why_new=Cycle 0046 rows 167 and 170 (delegated review, findings 3 and 7: the fake editor answered clean columns while a group was maximized, and only Read Explanation was tested); seam=the workspace harness's side bar model, whose layout read answers as both editors do while a group is maximized
      test(`${ending} after ${read === 'read-app' ? 'Read App' : read === 'read-source' ? 'Read Source' : 'Read Explanation'} ${secondaryBar === 'open' ? 'shows the secondary side bar the Read hid' : 'leaves the secondary side bar closed, as it was before the Read'}`, async () => {
        // Arrange: the primary side bar is open and the secondary one as the case says; the learner reads one pane enlarged, which hides both bars.
        const harness = await workspaceHarness(false)
        harness.useNativeLayout({ orientation: 0, groups: [{}] })
        harness.modelSideBars({
          primary: true,
          auxiliary: secondaryBar === 'open',
        })
        try {
          await harness.reader.open()
          await harness.reader.action(read)
          const duringRead = {
            ...harness.sideBars(),
            maximized: harness.maximizedEditorGroup(),
          }

          // Act
          if (ending === 'Restore') await harness.reader.action('arrange')
          else await harness.reader.close()

          // Assert
          assert.deepEqual(duringRead, {
            primary: false,
            auxiliary: false,
            hasKeyboard: false,
            maximized: true,
          })
          assert.deepEqual(harness.sideBars(), {
            primary: true,
            auxiliary: secondaryBar === 'open',
            hasKeyboard: false,
          })
          assert.equal(
            harness.commands.includes('workbench.action.focusAuxiliaryBar'),
            secondaryBar === 'open',
          )
          assert.equal(harness.maximizedEditorGroup(), false)
        } finally {
          await harness.close()
        }
      })

// Value: protects=the learner's side bars after a Read during which the learner made the window narrower: Close Study Workspace shows both side bars the Read hid; fails_when=the end of the reading finds the editor area no wider than before the Read because the window lost more than the secondary side bar's width, and leaves the secondary side bar (Cursor's Agent pane) hidden; why_new=Cycle 0046 row 30 (PL-22 of Cycle 0045); seam=the workspace harness's side bar model and its resizeWindow
test('closing the Study workspace after the learner narrowed the window during a Read shows both side bars the Read hid', async () => {
  // Arrange: both side bars are open; the learner reads the explanation enlarged and then narrows the window by 600 px.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: true })
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    harness.resizeWindow(735)

    // Act
    await harness.reader.close()

    // Assert
    assert.deepEqual(harness.sideBars(), {
      primary: true,
      auxiliary: true,
      hasKeyboard: false,
    })
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    await harness.close()
  }
})

// Value: protects=the sizes of the learner's own editor groups after a Close made during a Read: the editor ends the maximization by itself when the panes' groups go, with every group at the size it had before the Read, and the reader runs no command that resizes a group; fails_when=Close ends the Read with the editor's Expand, which gives the active group all the room and leaves every other group at its minimum size, so that two groups of 344 and 343 px are 617 and 70 px high after Open, Read Application and Close and stay so; why_new=Cycle 0046 row 323 (native round in VS Code 1.140.0, check V-05: `vscode.getEditorLayout` after Open, Read and Close, three takes); seam=the workspace harness's closeDisposedPanelTabsLater (an emptied group is removed, which ends a maximization as both editors' grids do), its maximized group, command log and layout read
test("Close Study Workspace during a Read leaves the learner's editor groups at the sizes they had before the Read: the maximization ends as the panes' groups go, and no command that resizes a group is run", async () => {
  // Arrange: the learner has two editor groups, one above the other, of the same height; the editor removes a group its last tab left. The learner opens the Study workspace and reads the explanation enlarged.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.closeDisposedPanelTabsLater()
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    const maximizedByRead = harness.maximizedEditorGroup()
    const commandsBefore = harness.commands.length

    // Act: Close, and longer than the fake editor takes to close the disposed panes' tabs and remove the group they left.
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Assert: a Restore ends a Read with the editor's Expand and then applies its arrangement's sizes; a Close has no arrangement to apply, so it runs neither Expand nor another command that changes a group's size.
    assert.equal(maximizedByRead, true)
    assert.deepEqual(
      {
        resizingCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /minimizeOtherEditors|toggleMaximizeEditorGroup|maximizeEditorHideSidebar|evenEditorWidths|setEditorLayout/.test(
              command,
            ),
          ),
        maximized: harness.maximizedEditorGroup(),
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
        state: harness.reader.presentationState().state,
      },
      {
        resizingCommands: [],
        maximized: false,
        layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
        state: 'closed',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's side bars after a Read whose secondary bar could not be measured, in an editor that removes emptied groups: Close ends the maximization with the editor's Expand before it measures the editor area, and shows both bars again; fails_when=the maximization is left to the editor in that case too, the area is read from a maximized grid whose hidden columns answer the widths they had, and a bar is shown or left hidden by a wrong measurement; why_new=Cycle 0046 row 323 (the bound of the new rule: rows 167 and 255 measure the side bars in a grid that is not maximized); seam=the workspace harness's side bar model, holdNextCommand and failNextCommand for the layout read after the maximize command, closeDisposedPanelTabsLater and command log
test('Close Study Workspace after a Read whose secondary side bar could not be measured ends the maximization with Expand before it measures the editor area, and shows both side bars again', async () => {
  // Arrange: both side bars are open and the editor removes a group its last tab left; the editor refuses the layout read that follows the Read's maximize command, so the secondary bar is not measured at the Read.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: true })
  harness.closeDisposedPanelTabsLater()
  let release = (): void => {}
  try {
    await harness.reader.open()
    const maximizing = harness.holdNextCommand(
      'workbench.action.maximizeEditorHideSidebar',
    )
    release = maximizing.release
    const reading = harness.reader.action('read-context')
    await maximizing.started
    harness.failNextCommand('vscode.getEditorLayout')
    maximizing.release()
    await reading
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Assert: Expand runs once, before the first layout read of the close.
    const closeCommands = harness.commands.slice(commandsBefore)
    assert.deepEqual(
      {
        firstTwoOfGridAndLayout: closeCommands
          .filter((command) =>
            /minimizeOtherEditors|vscode\.getEditorLayout/.test(command),
          )
          .slice(0, 2),
        expands: closeCommands.filter(
          (command) => command === 'workbench.action.minimizeOtherEditors',
        ).length,
        sideBars: harness.sideBars(),
        maximized: harness.maximizedEditorGroup(),
      },
      {
        firstTwoOfGridAndLayout: [
          'workbench.action.minimizeOtherEditors',
          'vscode.getEditorLayout',
        ],
        expands: 1,
        sideBars: { primary: true, auxiliary: true, hasKeyboard: false },
        maximized: false,
      },
    )
  } finally {
    release()
    await harness.close()
  }
})

for (const read of [
  { action: 'read-app', pane: 'the Application pane' },
  { action: 'read-source', pane: 'the captured source' },
  { action: 'read-context', pane: 'the Explanation pane' },
] as const)
  // Value: protects=the keyboard of a learner after a Restore of a Read, as far as the reader decides it: the Restore runs the editor's Expand, shows the side bars the Read hid, gives the active editor group the keyboard again and applies the Study layout, and runs no command or reveal that names another pane, so the pane that was read keeps the keyboard in an editor that moves none by itself; fails_when=a Restore of a Read reveals or focuses another pane than the one that was read, so the learner who read the explanation finds the keyboard in the Application pane; why_new=Cycle 0046 row 325 (native round in VS Code 1.140.0, check V-05, fourth step: after Read Explanation and Restore the Application pane had the keyboard; this test shows that no command of the reader moves it there, see the row's record for what is still open); seam=the workspace harness's side bar model, focusedPanel, active text editor, command log and panel reveals
  test(`a Restore after a Read of ${read.pane} runs no command and no reveal that gives another pane the keyboard: ${read.pane} keeps it in an editor that moves none by itself`, async () => {
    // Arrange: the primary side bar is open; the learner reads one pane enlarged, which hides the bar.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.modelSideBars({ primary: true, auxiliary: false })
    const keyboardHolder = (): string | undefined =>
      harness.focusedPanel() ??
      (harness.editor.window.activeTextEditor?.viewColumn === 2
        ? 'the captured source'
        : undefined)
    try {
      await harness.reader.open()
      await harness.reader.action(read.action)
      const duringRead = keyboardHolder()
      const commandsBefore = harness.commands.length,
        revealsBefore = harness.panelReveals().length
      const state = harness.reader.presentationState()

      // Act: the Restore of the public presentation action.
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'restore',
      })

      // Assert
      const expectedHolder = {
        'read-app': 'codebook.scopedBrowser',
        'read-source': 'the captured source',
        'read-context': 'codebook.studyContext',
      }[read.action]
      assert.equal(duringRead, expectedHolder)
      assert.deepEqual(
        {
          commands: harness.commands.slice(commandsBefore),
          reveals: harness.panelReveals().slice(revealsBefore),
          keyboardHolder: keyboardHolder(),
          layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
        },
        {
          commands: [
            'workbench.action.minimizeOtherEditors',
            'workbench.action.focusSideBar',
            'workbench.action.focusActiveEditorGroup',
            'vscode.getEditorLayout',
            'runCommands',
            'vscode.setEditorLayout',
            'vscode.getEditorLayout',
          ],
          reveals: [],
          keyboardHolder: expectedHolder,
          layoutConfirmed: true,
        },
      )
    } finally {
      await harness.close()
    }
  })

for (const arrangement of ['live', 'replay'] as const)
  // Value: protects=the sizes of the learner's own editor groups after a Read and a Close in an arrangement whose top level is rows (the live and the replay arrangement, where the panes share the learner's groups): the Read begins with the editor's Expand, which leaves every other group at its minimum size, and the Close gives the groups the sizes they had before the Read; fails_when=the sizes of before the Read are not kept, so the Close ends the Read with Expand alone and the learner's two groups stay at the expanded sizes after the workspace is closed; why_new=Cycle 0046 row 328 (read in the source beside row 323: the branch of a Read without a measurement); seam=the workspace harness with the controlled runtime or a saved recording, a native layout of two rows, the fake editor's Expand (top-level proportions 0.8 and 0.2), command log and layout read
  test(`Close Study Workspace after a Read in the ${arrangement} arrangement leaves the learner's two editor groups at the sizes they had before the Read`, async () => {
    // Arrange: the learner has two editor groups, one above the other; the ${arrangement} arrangement puts the Application pane and the captured source into them, and the learner reads the application enlarged.
    const recorded =
      arrangement === 'replay' ? await recordedReaderHarness(true) : undefined
    const harness = recorded ?? (await workspaceHarness())
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
    let live: { close(): void } | undefined
    let restoreNativeClose = (): void => {}
    try {
      if (recorded) {
        await recorded.reader.openRecording(recorded.studyId)
        await recorded.controller.settle()
      } else {
        const receipt = harness.service.start({
          instanceId: harness.service.instanceId,
          profile: 'repository-browser',
          configuration: harness.configuration,
          key: randomUUID(),
        })
        await harness.service.record(receipt).preparation
        await harness.reader.open()
        live = await harness.reader.presentation.createViewport(
          receipt.runId,
          () => {},
          () => {},
          'normal',
        )
      }
      const beforeRead = await harness.editor.commands.executeCommand(
        'vscode.getEditorLayout',
      )
      await harness.reader.action('read-app')
      const duringRead = {
        maximized: harness.maximizedEditorGroup(),
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      }
      const commandsBefore = harness.commands.length

      // Observe the restored Study grid before owned tabs disappear; final origin restoration cannot hide a missed Read/Enlarge cleanup.
      const nativeClose = harness.editor.window.tabGroups.close
      let layoutAtFirstNativeClose: unknown
      harness.editor.window.tabGroups.close = (...arguments_) => {
        layoutAtFirstNativeClose ??= structuredClone(harness.editorLayout())
        return nativeClose(...arguments_)
      }
      restoreNativeClose = (): void => {
        harness.editor.window.tabGroups.close = nativeClose
      }

      // Act
      await harness.reader.close()

      // Assert: the Read resized the groups; the Close ended the maximization and then applied the layout of before the Read.
      assert.deepEqual(layoutAtFirstNativeClose, {
        orientation: 1,
        groups: [{ size: 80.5 }, { size: 80.5 }, { size: 162 }],
      })
      assert.deepEqual(beforeRead, {
        orientation: 1,
        groups: [{ size: 80.5 }, { size: 80.5 }, { size: 162 }],
      })
      assert.deepEqual(duringRead, {
        maximized: true,
        layout: {
          orientation: 1,
          groups: [{ size: 0.8 }, { size: 0.1 }, { size: 0.1 }],
        },
      })
      assert.deepEqual(
        {
          gridCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) =>
              /minimizeOtherEditors|toggleMaximizeEditorGroup|setEditorLayout/.test(
                command,
              ),
            ),
          maximized: harness.maximizedEditorGroup(),
          layout: await harness.editor.commands.executeCommand(
            'vscode.getEditorLayout',
          ),
          learnersTabs: harness.groups.map((group) => group.tabs.length),
        },
        {
          gridCommands: [
            'workbench.action.minimizeOtherEditors',
            'vscode.setEditorLayout',
            'vscode.setEditorLayout',
          ],
          maximized: false,
          layout: { orientation: 1, groups: [{ size: 161 }, { size: 162 }] },
          learnersTabs: [1, 1],
        },
      )
    } finally {
      restoreNativeClose()
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the sizes of the learner's own editor groups after a Read and a Restore in the live arrangement beside a third group of the learner's, where the Restore arranges nothing because it preserves the learner's groups: the groups have the sizes they had before the Read; fails_when=the Restore ends the Read with the editor's Expand and relies on its arrangement for the sizes, which it does not apply there, so the learner's groups stay at the expanded sizes; why_new=Cycle 0046 row 328 (a Restore ends a Read too, and gives sizes back only where it arranges); seam=the workspace harness with the controlled runtime, a native layout of three rows, the arrange action, the reader's layout line, command log and layout read
test("a Restore after a Read in the live arrangement beside a later group of the learner's gives every group the size it had before the Read, also where it arranges nothing", async () => {
  // Arrange: the learner has three editor groups, one above the other; a live run puts its panes into the first two, and the learner reads the application enlarged.
  const harness = await workspaceHarness()
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 161 }, { size: 162 }, { size: 163 }],
  })
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    // A later native group is outside the prepared App owner; Restore must preserve it and give back the pre-Read sizes without arranging.
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1,
      groups: [
        { size: 80.5 },
        { size: 80.5 },
        { size: 162 },
        { size: 163 },
        { size: 164 },
      ],
    })
    const learner = harness.focusMutableDraft('added-group-notes.txt', 5)
    await harness.reader.action('read-app')
    const duringRead = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )

    // Act: Arrange Study Workspace, which is the Restore of the Study pane.
    await harness.reader.action('arrange')

    // Assert
    assert.equal(learner.document.getText(), 'Original learner draft.\n')
    assert.equal(learner.tab.isDirty, true)
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 5)
        ?.tabs.includes(learner.tab),
      true,
    )
    assert.deepEqual(duringRead, {
      orientation: 1,
      groups: [
        { size: 0.8 },
        { size: 0.05 },
        { size: 0.05 },
        { size: 0.05 },
        { size: 0.05 },
      ],
    })
    assert.deepEqual(
      {
        maximized: harness.maximizedEditorGroup(),
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      },
      {
        maximized: false,
        layout: {
          orientation: 1,
          groups: [
            { size: 80.5 },
            { size: 80.5 },
            { size: 162 },
            { size: 163 },
            { size: 164 },
          ],
        },
      },
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the learner whose change of focus stops a Restore of a Read in the live arrangement: the Restore applies no layout over that change, and the Close that follows gives the groups the sizes they had before the Read; fails_when=the sizes are given back although the learner changed the focus while the maximization ended, or they are forgotten with the refused Restore and the groups stay at the expanded sizes after the workspace is closed; why_new=Cycle 0046 row 328 (the learner's newer choice wins over the give-back, and the Close still owes it); seam=the workspace harness with the controlled runtime, holdNextCommand for the editor's Expand, focusMutableDraft as the learner's change, command log and layout read
test("a Restore of a Read in the live arrangement that the learner's change of focus stops applies no layout, and the Close afterwards gives the learner's groups the sizes they had before the Read", async () => {
  // Arrange: the learner has two editor groups; a live run puts its panes into them, and the learner reads the application enlarged. The editor holds the Expand of the Restore that follows.
  const harness = await workspaceHarness()
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 161 }, { size: 162 }],
  })
  let live: { close(): void } | undefined
  let release = (): void => {}
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('read-app')
    const state = harness.reader.presentationState()
    const held = harness.holdNextCommand(
      'workbench.action.minimizeOtherEditors',
    )
    release = held.release
    const commandsBefore = harness.commands.length
    const restoring = harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'restore',
      })
      .then(
        () => 'restored',
        () => 'refused',
      )
    await held.started

    // Act: the learner goes to a draft of their own while the maximization ends; the Restore is refused; then the learner closes the Study workspace.
    const learner = harness.focusMutableDraft('later-source.txt', 2)
    held.release()
    const restore = await restoring
    const afterRestore = {
      layoutsApplied: harness.commands
        .slice(commandsBefore)
        .filter((command) => command === 'vscode.setEditorLayout').length,
      layout: await harness.editor.commands.executeCommand(
        'vscode.getEditorLayout',
      ),
    }
    await harness.reader.close()

    // Assert
    assert.equal(learner.document.getText(), 'Original learner draft.\n')
    assert.equal(learner.tab.isDirty, true)
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 1)
        ?.tabs.includes(learner.tab),
      true,
    )
    assert.equal(restore, 'refused')
    assert.deepEqual(afterRestore, {
      layoutsApplied: 0,
      layout: {
        orientation: 1,
        groups: [{ size: 0.8 }, { size: 0.1 }, { size: 0.1 }],
      },
    })
    assert.deepEqual(
      await harness.editor.commands.executeCommand('vscode.getEditorLayout'),
      { orientation: 1, groups: [{ size: 161 }, { size: 162 }] },
    )
  } finally {
    release()
    live?.close()
    await harness.close()
  }
})

// Value: protects=the sizes of the learner's own editor groups after two Reads of one reading in the live arrangement (the application, then the captured source) and a Close: the groups have the sizes they had before the first Read; fails_when=the second Read, which runs the editor's Expand again, replaces the sizes kept at the first with none or with the expanded ones, so the Close gives nothing back; why_new=Cycle 0046 row 328 (a reading keeps the sizes of before its first Read); seam=the workspace harness with the controlled runtime, two Reads, command log and layout read
test("Close Study Workspace after a Read of the application and then of the captured source in the live arrangement leaves the learner's two editor groups at the sizes they had before the first Read", async () => {
  // Arrange: the learner has two editor groups; a live run puts its panes into them.
  const harness = await workspaceHarness()
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 161 }, { size: 162 }],
  })
  let live: { close(): void } | undefined
  let restoreNativeClose = (): void => {}
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('read-app')
    await harness.reader.action('read-source')
    const duringSecondRead = harness.maximizedEditorGroup()

    // Observe the restored Study grid before owned tabs disappear; final origin restoration cannot hide a missed Read/Enlarge cleanup.
    const nativeClose = harness.editor.window.tabGroups.close
    let layoutAtFirstNativeClose: unknown
    harness.editor.window.tabGroups.close = (...arguments_) => {
      layoutAtFirstNativeClose ??= structuredClone(harness.editorLayout())
      return nativeClose(...arguments_)
    }
    restoreNativeClose = (): void => {
      harness.editor.window.tabGroups.close = nativeClose
    }

    // Act
    await harness.reader.close()

    // Assert
    assert.deepEqual(layoutAtFirstNativeClose, {
      orientation: 1,
      groups: [{ size: 80.5 }, { size: 80.5 }, { size: 162 }],
    })
    assert.equal(duringSecondRead, true)
    assert.deepEqual(
      {
        maximized: harness.maximizedEditorGroup(),
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      },
      {
        maximized: false,
        layout: { orientation: 1, groups: [{ size: 161 }, { size: 162 }] },
      },
    )
  } finally {
    restoreNativeClose()
    live?.close()
    await harness.close()
  }
})

// Value: protects=the order in which a Close ends a Read that began with the editor's Expand, in an editor that removes the group the captured source leaves empty: the maximization is ended with Expand first and the layout of before the Read is applied to a grid that is not maximized, before the panes are closed; fails_when=the Close leaves the maximization to the editor there, as it does after a Read that resized nothing, and applies a layout to a maximized grid, or brings back the sizes the Expand left; why_new=Cycle 0046 row 328 (the rule of row 323 holds for a Read that resized nothing; this Read did); seam=the workspace harness with the controlled runtime, closeDisposedPanelTabsLater (an emptied group is removed), command log and layout read
test('Close Study Workspace after a Read in the live arrangement whose captured source has a group of its own ends the maximization with Expand before it applies the layout of before the Read, and one group of the learner is left', async () => {
  // Arrange: the learner has one editor group and the editor removes a group its last tab left; a live run puts the Application pane beside the learner's file and the captured source into a second group below, and the learner reads the application enlarged.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.closeDisposedPanelTabsLater()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('read-app')
    const commandsBefore = harness.commands.length

    // Act: Close, and longer than the fake editor takes to remove the emptied group.
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Assert
    assert.deepEqual(
      {
        gridCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /minimizeOtherEditors|toggleMaximizeEditorGroup|setEditorLayout/.test(
              command,
            ),
          ),
        maximized: harness.maximizedEditorGroup(),
        groups: harness.groups.length,
      },
      {
        gridCommands: [
          'workbench.action.minimizeOtherEditors',
          'vscode.setEditorLayout',
        ],
        maximized: false,
        groups: 1,
      },
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the learner's editor groups when the learner changed them during a Read: a Close does not apply the layout of before the Read to groups that are no longer those of before; fails_when=the layout noted at the Read is applied whatever the groups are now, so a group the learner opened during the reading is merged into another one, or the learner's new split is undone; why_new=Cycle 0046 row 328 (the bound of the give-back: only the same groups get their sizes back); seam=the workspace harness with the controlled runtime, a native layout of two rows, a layout of three rows applied as the learner's change during the reading, command log
test('Close Study Workspace after a Read during which the learner opened another editor group applies no layout of before the Read: the three groups stay', async () => {
  // Arrange: the learner has two editor groups; a live run puts its panes into them, the learner reads the application enlarged and then opens a third group below.
  const harness = await workspaceHarness()
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 161 }, { size: 162 }],
  })
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('read-app')
    assert.equal(harness.groups.length, 3)
    // The new fourth group is a genuine learner addition beside App and both original groups.
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1,
      groups: [{ size: 0.3 }, { size: 0.25 }, { size: 0.25 }, { size: 0.2 }],
    })
    assert.equal(harness.groups.length, 4)
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()

    // Assert
    assert.deepEqual(
      {
        layoutsApplied: harness.commands
          .slice(commandsBefore)
          .filter((command) => command === 'vscode.setEditorLayout').length,
        groups: harness.groups.length,
        state: harness.reader.presentationState().state,
      },
      { layoutsApplied: 0, groups: 3, state: 'closed' },
    )
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.25 }, { size: 0.25 }, { size: 0.2 }],
    })
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.minimizeOtherEditors'),
      false,
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the editor part of Cursor's Agent chat when a Close ends a Read of a rows arrangement while the chat tab has the keyboard: the editor answers a layout command for the part that has the focus, so no layout is applied and the chat's part keeps the sizes of its own groups; fails_when=the layout noted at the Read is applied without proof that the main editor answers, and the chat's editor part, which has the same number of groups in the same split, is given the main editor's sizes; why_new=Cycle 0046 row 328 (the bound of the give-back beside another editor part; the sizes then stay as the Read left them, which is stated in the docstring); seam=the workspace harness with the controlled runtime, addSeparateEditorPart and the chat's own layout, command log
test("Close Study Workspace after a Read in the live arrangement while Cursor's chat tab has the keyboard applies no layout: the chat's editor part keeps the sizes of its own two groups", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner has two editor groups, a live run puts its panes into them, the learner reads the application enlarged and then types in the chat, whose editor part has two groups of its own, one above the other, as the main editor has.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('read-app')
    chat.focusTab()
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1,
      groups: [{ size: 400 }, { size: 343 }],
    })
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()

    // Assert
    assert.deepEqual(
      {
        layoutsApplied: harness.commands
          .slice(commandsBefore)
          .filter((command) => command === 'vscode.setEditorLayout').length,
        chatLayout: chat.layout(),
        state: harness.reader.presentationState().state,
      },
      {
        layoutsApplied: 0,
        chatLayout: {
          orientation: 1,
          groups: [{ size: 400 }, { size: 343 }],
        },
        state: 'closed',
      },
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the sizes of the learner's own editor groups after a Read of a rows arrangement that the editor refused once its Expand had run: the groups have the sizes they had before; fails_when=a refused Read leaves the groups at the sizes the Expand gave them, with no reading to end, so nothing gives them back; why_new=Cycle 0046 row 328 (found in the function the row changes: the Read's Expand and its maximize are two commands, and the second can fail); seam=the workspace harness with the controlled runtime, failNextCommand for the editor's maximize toggle, command log and layout read
test("a Read in the live arrangement that the editor refuses after its Expand ran leaves the learner's editor groups at the sizes they had before", async () => {
  // Arrange: the learner has two editor groups; a live run puts its panes into them; the editor refuses the maximize toggle of the next Read.
  const harness = await workspaceHarness()
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 161 }, { size: 162 }],
  })
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.failNextCommand('workbench.action.toggleMaximizeEditorGroup')

    // Act
    const refused = await harness.reader.action('read-app').then(
      () => false,
      () => true,
    )

    // Assert
    assert.equal(refused, true)
    assert.deepEqual(
      {
        maximized: harness.maximizedEditorGroup(),
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      },
      {
        maximized: false,
        layout: {
          orientation: 1,
          groups: [{ size: 80.5 }, { size: 80.5 }, { size: 162 }],
        },
      },
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

for (const arrangement of ['live', 'replay'] as const)
  // Value: protects=the learner's own editor groups after Enlarge application and a Close in an arrangement whose top level is rows: the Close ends the maximization the Enlarge left and gives the groups the sizes they had before it; fails_when=the Enlarge begins with the editor's Expand, keeps no sizes, and the Close ends nothing, so one of the learner's two groups stays maximized over the other after the workspace is closed, at the sizes the Expand left; why_new=Cycle 0046 row 334 (read in the source beside row 328, produced here); seam=the workspace harness with the controlled runtime or a saved recording, a native layout of two rows, the fake editor's Expand (top-level proportions 0.8 and 0.2) and maximized group, command log and layout read
  test(`Close Study Workspace after Enlarge application in the ${arrangement} arrangement leaves the learner's two editor groups at the sizes they had before the Enlarge, and none of them maximized`, async () => {
    // Arrange: the learner has two editor groups, one above the other; the arrangement puts the Application pane and the captured source into them, and the learner enlarges the application.
    const recorded =
      arrangement === 'replay' ? await recordedReaderHarness(true) : undefined
    const harness = recorded ?? (await workspaceHarness())
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
    let live: { close(): void } | undefined
    let restoreNativeClose = (): void => {}
    try {
      if (recorded) {
        await recorded.reader.openRecording(recorded.studyId)
        await recorded.controller.settle()
      } else {
        const receipt = harness.service.start({
          instanceId: harness.service.instanceId,
          profile: 'repository-browser',
          configuration: harness.configuration,
          key: randomUUID(),
        })
        await harness.service.record(receipt).preparation
        await harness.reader.open()
        live = await harness.reader.presentation.createViewport(
          receipt.runId,
          () => {},
          () => {},
          'normal',
        )
      }
      await harness.reader.action('enlarge-app')
      const duringEnlarge = {
        maximized: harness.maximizedEditorGroup(),
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      }
      const commandsBefore = harness.commands.length

      // Observe the restored Study grid before owned tabs disappear; final origin restoration cannot hide a missed Read/Enlarge cleanup.
      const nativeClose = harness.editor.window.tabGroups.close
      let layoutAtFirstNativeClose: unknown
      harness.editor.window.tabGroups.close = (...arguments_) => {
        layoutAtFirstNativeClose ??= structuredClone(harness.editorLayout())
        return nativeClose(...arguments_)
      }
      restoreNativeClose = (): void => {
        harness.editor.window.tabGroups.close = nativeClose
      }

      // Act
      await harness.reader.close()

      // Assert
      assert.deepEqual(layoutAtFirstNativeClose, {
        orientation: 1,
        groups: [{ size: 80.5 }, { size: 80.5 }, { size: 162 }],
      })
      assert.deepEqual(duringEnlarge, {
        maximized: true,
        layout: {
          orientation: 1,
          groups: [{ size: 0.8 }, { size: 0.1 }, { size: 0.1 }],
        },
      })
      assert.deepEqual(
        {
          gridCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) =>
              /minimizeOtherEditors|toggleMaximizeEditorGroup|setEditorLayout/.test(
                command,
              ),
            ),
          maximized: harness.maximizedEditorGroup(),
          layout: await harness.editor.commands.executeCommand(
            'vscode.getEditorLayout',
          ),
          learnersTabs: harness.groups.map((group) => group.tabs.length),
        },
        {
          gridCommands: [
            'workbench.action.minimizeOtherEditors',
            'vscode.setEditorLayout',
            'vscode.setEditorLayout',
          ],
          maximized: false,
          layout: { orientation: 1, groups: [{ size: 161 }, { size: 162 }] },
          learnersTabs: [1, 1],
        },
      )
    } finally {
      restoreNativeClose()
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the sizes of the learner's own editor groups after Enlarge application and a Restore in the live arrangement beside a third group of the learner's, where the Restore arranges nothing: the groups have the sizes they had before the Enlarge; fails_when=the Enlarge keeps no sizes, the Restore ends the maximization with the editor's Expand and applies no arrangement there, so the groups stay at the expanded sizes; why_new=Cycle 0046 row 334; seam=the workspace harness with the controlled runtime, a native layout of three rows, the arrange action, command log and layout read
test("a Restore after Enlarge application in the live arrangement beside a later group of the learner's gives every group the size it had before the Enlarge, also where it arranges nothing", async () => {
  // Arrange: the learner has three editor groups, one above the other; a live run puts its panes into the first two, and the learner enlarges the application.
  const harness = await workspaceHarness()
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 161 }, { size: 162 }, { size: 163 }],
  })
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    // A later native group is outside the prepared App owner; Restore must preserve it and give back the pre-Read sizes without arranging.
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1,
      groups: [
        { size: 80.5 },
        { size: 80.5 },
        { size: 162 },
        { size: 163 },
        { size: 164 },
      ],
    })
    const learner = harness.focusMutableDraft('added-group-notes.txt', 5)
    await harness.reader.action('enlarge-app')
    const duringEnlarge = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )

    // Act: Arrange Study Workspace, which is the Restore of the Study pane.
    await harness.reader.action('arrange')

    // Assert
    assert.equal(learner.document.getText(), 'Original learner draft.\n')
    assert.equal(learner.tab.isDirty, true)
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 5)
        ?.tabs.includes(learner.tab),
      true,
    )
    assert.deepEqual(duringEnlarge, {
      orientation: 1,
      groups: [
        { size: 0.8 },
        { size: 0.05 },
        { size: 0.05 },
        { size: 0.05 },
        { size: 0.05 },
      ],
    })
    assert.deepEqual(
      {
        maximized: harness.maximizedEditorGroup(),
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      },
      {
        maximized: false,
        layout: {
          orientation: 1,
          groups: [
            { size: 80.5 },
            { size: 80.5 },
            { size: 162 },
            { size: 163 },
            { size: 164 },
          ],
        },
      },
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the one layout a Restore applies: after Enlarge application in the three-pane Study workspace the Restore gives the measured layout back with one layout command, and the Close that follows runs no command that changes a group's size; fails_when=the sizes kept at the Enlarge are applied beside the Restore's own layout, or stay kept after it and are applied again at the Close, over sizes the learner may have set since; why_new=Cycle 0046 row 334 (the Enlarge's own way back and the sizes kept for a Close are one account: what the Restore gives back is no longer owed); seam=the workspace harness, the three-pane columns, the arrange action, command log and layout read
test('the Restore of Enlarge application in the three-pane Study workspace applies one layout, the measured one, and the Close afterwards runs no Expand and applies no layout', async () => {
  // Arrange: the three-pane Study workspace is confirmed, and the learner enlarges the application.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const beforeEnlarge = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )
    await harness.reader.action('enlarge-app')
    const commandsBeforeRestore = harness.commands.length

    // Act: Arrange Study Workspace, then Close Study Workspace.
    await harness.reader.action('arrange')
    const afterRestore = {
      layoutsApplied: harness.commands
        .slice(commandsBeforeRestore)
        .filter((command) => command === 'vscode.setEditorLayout').length,
      maximized: harness.maximizedEditorGroup(),
      layout: await harness.editor.commands.executeCommand(
        'vscode.getEditorLayout',
      ),
    }
    const commandsBeforeClose = harness.commands.length
    await harness.reader.close()

    // Assert
    assert.deepEqual(afterRestore, {
      layoutsApplied: 1,
      maximized: false,
      layout: beforeEnlarge,
    })
    assert.deepEqual(
      harness.commands
        .slice(commandsBeforeClose)
        .filter((command) =>
          /minimizeOtherEditors|toggleMaximizeEditorGroup|setEditorLayout/.test(
            command,
          ),
        ),
      [],
    )
  } finally {
    await harness.close()
  }
})

for (const order of [
  {
    first: 'enlarge-app',
    second: 'read-app',
    name: 'Enlarge application and then a Read of the application',
  },
  {
    first: 'read-app',
    second: 'enlarge-app',
    name: 'a Read of the application and then Enlarge application',
  },
  {
    first: 'enlarge-app',
    second: 'enlarge-app',
    name: 'Enlarge application twice',
  },
] as const)
  // Value: protects=the sizes of the learner's own editor groups after an Enlarge and a Read of one sitting, in either order, or two Enlarges, and a Close in the live arrangement: the groups have the sizes they had before the first of them, and the maximization the second left is ended before the layout is applied; fails_when=the second of them, which runs the editor's Expand again, replaces the kept sizes with the expanded ones, or the Close applies the layout to a grid an Enlarge left maximized without ending the maximization first; why_new=Cycle 0046 row 334 (one account of kept sizes for a Read and an Enlarge); seam=the workspace harness with the controlled runtime, a native layout of two rows, command log and layout read
  test(`Close Study Workspace after ${order.name} in the live arrangement leaves the learner's two editor groups at the sizes they had before the first of them`, async () => {
    // Arrange: the learner has two editor groups; a live run puts its panes into them.
    const harness = await workspaceHarness()
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
    let live: { close(): void } | undefined
    let restoreNativeClose = (): void => {}
    try {
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      await harness.service.record(receipt).preparation
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      await harness.reader.action(order.first)
      await harness.reader.action(order.second)
      const commandsBefore = harness.commands.length

      // Observe the restored Study grid before owned tabs disappear; final origin restoration cannot hide a missed Read/Enlarge cleanup.
      const nativeClose = harness.editor.window.tabGroups.close
      let layoutAtFirstNativeClose: unknown
      harness.editor.window.tabGroups.close = (...arguments_) => {
        layoutAtFirstNativeClose ??= structuredClone(harness.editorLayout())
        return nativeClose(...arguments_)
      }
      restoreNativeClose = (): void => {
        harness.editor.window.tabGroups.close = nativeClose
      }

      // Act
      await harness.reader.close()

      // Assert
      assert.deepEqual(layoutAtFirstNativeClose, {
        orientation: 1,
        groups: [{ size: 80.5 }, { size: 80.5 }, { size: 162 }],
      })
      assert.deepEqual(
        {
          gridCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) =>
              /minimizeOtherEditors|toggleMaximizeEditorGroup|setEditorLayout/.test(
                command,
              ),
            ),
          maximized: harness.maximizedEditorGroup(),
          layout: await harness.editor.commands.executeCommand(
            'vscode.getEditorLayout',
          ),
        },
        {
          gridCommands: [
            'workbench.action.minimizeOtherEditors',
            'vscode.setEditorLayout',
            'vscode.setEditorLayout',
          ],
          maximized: false,
          layout: { orientation: 1, groups: [{ size: 161 }, { size: 162 }] },
        },
      )
    } finally {
      restoreNativeClose()
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the widths of the three-pane columns after a Read of the explanation, which hides the side bars and resizes no group, followed by Enlarge application and a Close: the columns have the widths they had before the Read; fails_when=the Enlarge, which begins while the Read's maximization is on, keeps no sizes or keeps those the maximized grid answers, so the Close leaves the columns as the Enlarge's Expand left them; why_new=Cycle 0046 row 334 (an Enlarge during a reading keeps the layout the reading began with); seam=the workspace harness's side bar model and three-pane columns in pixels, command log, layoutsAtGroupCloses (the grid when the Close begins to retire the groups Codebook created for the panes, finding 597) and layout read
test('Close Study Workspace after a Read of the explanation and then Enlarge application in the three-pane Study workspace leaves the columns at the widths they had before the Read', async () => {
  // Arrange: the primary side bar is open; the learner reads the explanation enlarged, which hides the bar, and then enlarges the application, which shows it again.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: false })
  try {
    await harness.reader.open()
    const beforeRead = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )
    await harness.reader.action('read-context')
    await harness.reader.action('enlarge-app')
    const duringEnlarge = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )

    // Act
    await harness.reader.close()

    // Assert
    assert.deepEqual(beforeRead, {
      orientation: 0,
      groups: [
        { size: 617, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 504 },
      ],
    })
    assert.deepEqual(duringEnlarge, {
      orientation: 0,
      groups: [
        { size: 1121, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 224 },
      ],
    })
    // The columns have their widths back when the Close begins to retire the groups Codebook created for the panes; then only the learner's group is left (finding 597).
    assert.deepEqual(
      {
        maximized: harness.maximizedEditorGroup(),
        sideBars: harness.sideBars(),
        layoutAtFirstGroupRetirement: harness.layoutsAtGroupCloses()[0],
        groups: harness.groups.length,
      },
      {
        maximized: false,
        sideBars: { primary: true, auxiliary: false, hasKeyboard: false },
        layoutAtFirstGroupRetirement: {
          orientation: 0,
          groups: [
            { size: 617, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 504 },
          ],
        },
        groups: 1,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the sizes of the learner's own editor groups after Enlarge application that the editor refused once its Expand had run: the groups have the sizes they had before; fails_when=a refused Enlarge leaves the groups at the sizes the Expand gave them, and nothing gives them back; why_new=Cycle 0046 row 334 (the Enlarge's Expand and its maximize are two commands, and the second can fail, as at a Read); seam=the workspace harness with the controlled runtime, failNextCommand for the editor's maximize toggle, command log and layout read
test("Enlarge application in the live arrangement that the editor refuses after its Expand ran leaves the learner's editor groups at the sizes they had before", async () => {
  // Arrange: the learner has two editor groups; a live run puts its panes into them; the editor refuses the maximize toggle of the next Enlarge.
  const harness = await workspaceHarness()
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 161 }, { size: 162 }],
  })
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.failNextCommand('workbench.action.toggleMaximizeEditorGroup')

    // Act
    const refused = await harness.reader.action('enlarge-app').then(
      () => false,
      () => true,
    )

    // Assert
    assert.equal(refused, true)
    assert.deepEqual(
      {
        maximized: harness.maximizedEditorGroup(),
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      },
      {
        maximized: false,
        layout: {
          orientation: 1,
          groups: [{ size: 80.5 }, { size: 80.5 }, { size: 162 }],
        },
      },
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the learner who changes the focus while a Restore that arranged nothing reads the layout to give the sizes of before an Enlarge back: no layout is applied over that change, the Restore is refused, and the Close that follows gives the sizes back; fails_when=the give-back asks nobody and applies the kept layout over the learner's newer choice, or the refused Restore forgets the sizes; why_new=Cycle 0046 row 334 (the guard of row 328, asked where the give-back now runs: after an arrangement that applied nothing); seam=the workspace harness with the controlled runtime, a native layout of three rows, holdNextCommand for the two layout reads of the Restore, focusMutableDraft as the learner's change, command log and layout read
test("a Restore after Enlarge application that arranges nothing applies no layout once the learner changed the focus during its layout read, and the Close afterwards gives the learner's groups the sizes they had before the Enlarge", async () => {
  // Arrange: the learner has three editor groups; a live run puts its panes into the first two, and the learner enlarges the application. The editor holds the layout read of the arrangement, and then the one that follows it.
  const harness = await workspaceHarness()
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 161 }, { size: 162 }, { size: 163 }],
  })
  let live: { close(): void } | undefined
  let release = (): void => {}
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    // A later native group is outside the prepared App owner; Restore must preserve it and give back the pre-Read sizes without arranging.
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1,
      groups: [
        { size: 80.5 },
        { size: 80.5 },
        { size: 162 },
        { size: 163 },
        { size: 164 },
      ],
    })
    await harness.reader.action('enlarge-app')
    const state = harness.reader.presentationState()
    const arrangementRead = harness.holdNextCommand('vscode.getEditorLayout')
    release = arrangementRead.release
    const commandsBefore = harness.commands.length
    const restoring = harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'restore',
      })
      .then(
        () => 'restored',
        () => 'refused',
      )
    await arrangementRead.started
    const giveBackRead = harness.holdNextCommand('vscode.getEditorLayout')
    release = giveBackRead.release
    arrangementRead.release()
    // A Restore that reads no second layout ends here by itself, and the assertions below say so.
    await Promise.race([giveBackRead.started, restoring])

    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .filter((command) => command === 'vscode.setEditorLayout').length,
      0,
    )

    // Act: the learner goes to a draft of their own while the editor answers; the Restore is refused; then the learner closes the Study workspace.
    const learner = harness.focusMutableDraft('later-source.txt', 2)
    giveBackRead.release()
    const restore = await restoring
    const layoutsAppliedByRestore = harness.commands
      .slice(commandsBefore)
      .filter((command) => command === 'vscode.setEditorLayout').length
    await harness.reader.close()

    // Assert
    assert.equal(learner.document.getText(), 'Original learner draft.\n')
    assert.equal(learner.tab.isDirty, true)
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 1)
        ?.tabs.includes(learner.tab),
      true,
    )
    assert.deepEqual(
      { restore, layoutsAppliedByRestore },
      { restore: 'refused', layoutsAppliedByRestore: 0 },
    )
    assert.deepEqual(
      await harness.editor.commands.executeCommand('vscode.getEditorLayout'),
      {
        orientation: 1,
        groups: [{ size: 80.5 }, { size: 162 }, { size: 163 }, { size: 164 }],
      },
    )
  } finally {
    release()
    live?.close()
    await harness.close()
  }
})

// Value: protects=the widths of the three-pane columns after a Read and a Close in an editor that keeps a group its last tab left (the learner turned workbench.editor.closeEmptyGroups off), where the Close has to end the maximization with the editor's Expand: the columns have the widths they had before the Read; fails_when=that Expand leaves every other group at its minimum size and nothing gives the sizes back, because a Read that hid the side bars kept none; why_new=Cycle 0046 row 334 (the audit of every command of the reader that resizes a group: the Close's own Expand, the limit row 323 stated); seam=the workspace harness's side bar model and three-pane columns in pixels, the fake editor that keeps emptied groups, command log, layoutsAtGroupCloses (the grid when the Close begins to retire the groups Codebook created for the panes, finding 597) and layout read
test('Close Study Workspace after a Read of the explanation in an editor that keeps emptied groups leaves the three-pane columns at the widths they had before the Read', async () => {
  // Arrange: the primary side bar is open and the editor keeps a group its last tab left; the learner reads the explanation enlarged.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: false })
  try {
    await harness.reader.open()
    const beforeRead = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )
    await harness.reader.action('read-context')
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()

    // Assert: the columns have their widths back when the Close begins to retire the groups Codebook created for the panes; then only the learner's group is left (finding 597).
    assert.deepEqual(beforeRead, {
      orientation: 0,
      groups: [
        { size: 617, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 504 },
      ],
    })
    assert.deepEqual(
      {
        gridCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /minimizeOtherEditors|toggleMaximizeEditorGroup|setEditorLayout/.test(
              command,
            ),
          ),
        maximized: harness.maximizedEditorGroup(),
        sideBars: harness.sideBars(),
        layoutAtFirstGroupRetirement: harness.layoutsAtGroupCloses()[0],
        groups: harness.groups.length,
      },
      {
        gridCommands: [
          'workbench.action.minimizeOtherEditors',
          'vscode.setEditorLayout',
        ],
        maximized: false,
        sideBars: { primary: true, auxiliary: false, hasKeyboard: false },
        layoutAtFirstGroupRetirement: {
          orientation: 0,
          groups: [
            { size: 617, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 504 },
          ],
        },
        groups: 1,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the widths of the learner's editor groups after a Read and a Restore of the three-pane Study workspace beside a fourth group of the learner's, where the Restore arranges nothing: every group has the width it had before the Read; fails_when=the Restore ends the Read with the editor's Expand, which leaves every other group at its minimum size, and its arrangement, which would give sizes, preserves the learner's groups and applies nothing; why_new=Cycle 0046 row 334 (the audit: the Restore's own Expand after a Read that resized nothing); seam=the workspace harness's side bar model, a native layout of four columns, the arrange action, the reader's layout line, command log and layout read
test("a Restore after a Read of the application beside a fourth group of the learner's gives every group the width it had before the Read, also where it arranges nothing", async () => {
  // Arrange: the learner has four editor groups side by side and the primary side bar open; the Study panes share the first three, and the learner reads the application enlarged.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}, {}] })
  harness.modelSideBars({ primary: true, auxiliary: false })
  try {
    await harness.reader.open()
    const beforeRead = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )
    await harness.reader.action('read-app')

    // Act: Arrange Study Workspace, which is the Restore of the Study pane.
    await harness.reader.action('arrange')

    // Assert
    assert.deepEqual(beforeRead, {
      orientation: 0,
      groups: [{ size: 280 }, { size: 280 }, { size: 280 }, { size: 280 }],
    })
    assert.deepEqual(
      {
        maximized: harness.maximizedEditorGroup(),
        sideBars: harness.sideBars(),
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      },
      {
        maximized: false,
        sideBars: { primary: true, auxiliary: false, hasKeyboard: false },
        layout: {
          orientation: 0,
          groups: [{ size: 280 }, { size: 280 }, { size: 280 }, { size: 280 }],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

for (const editor of [
  {
    name: 'VS Code',
    sideBars: { primary: true, auxiliary: false },
    sideBarWidthsPx: { primary: 65, auxiliary: 461 },
    areaPx: { width: 1270, height: 688 },
    split: {
      orientation: 0,
      groups: [
        { size: 699, groups: [{ size: 344 }, { size: 344 }] },
        { size: 572 },
      ],
    },
  },
  {
    name: 'Cursor',
    sideBars: { primary: true, auxiliary: true },
    sideBarWidthsPx: { primary: 214, auxiliary: 461 },
    areaPx: { width: 660, height: 658 },
    split: {
      orientation: 0,
      groups: [
        { size: 363, groups: [{ size: 329 }, { size: 329 }] },
        { size: 297 },
      ],
    },
  },
] as const)
  // Value: protects=the learner who runs Open Study Workspace with two editor groups side by side: the Open ends in the confirmed three-pane split, with no pane maximized and no side bar hidden; fails_when=the grid of columns gives the reader no height to measure, the layout goes out in proportions, the editor answers them as single pixels (the Application pane at one pixel), the split is never confirmed, and the Open goes on to a Read of the explanation, which hides both side bars and maximizes that pane; why_new=Cycle 0046 row 340 (native round: VS Code 1.140.0, three takes, and Cursor 3.23.12, where the Application pane stood at 1x1 px); seam=the workspace harness's answerProportionsAsPixels (the editors' answer to proportions over a grid of columns, with each editor's measured area), a native layout of two columns, command log, the fake editor's maximized group and layout read
  test(`Open Study Workspace from the learner's two groups side by side ends in the confirmed three-pane split in ${editor.name}, with no pane maximized and no side bar hidden`, async () => {
    // Arrange: the learner has two editor groups side by side in a window of 1335 px, whose side bars leave the editor area ${editor.name} had; the editor answers a layout given in proportions as single pixels, as ${editor.name} did.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.modelSideBars(editor.sideBars, editor.sideBarWidthsPx)
    harness.answerProportionsAsPixels(editor.areaPx)
    try {
      const commandsBefore = harness.commands.length

      // Act
      await harness.reader.open()

      // Assert: the split is confirmed in the pixels of the editor area, and the Open ran no command of a Read.
      const state = harness.reader.presentationState()
      assert.deepEqual(
        {
          readCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) =>
              /closeSidebar|maximizeEditorHideSidebar|minimizeOtherEditors|toggleMaximizeEditorGroup/.test(
                command,
              ),
            ),
          maximized: harness.maximizedEditorGroup(),
          sideBars: harness.sideBars(),
          layoutConfirmed: state.layoutConfirmed,
          reason: state.reason,
          errorLines: [...harness.reader.inspect().view!.errors],
          layout: harness.editorLayout(),
        },
        {
          readCommands: [],
          maximized: false,
          sideBars: { ...editor.sideBars, hasKeyboard: false },
          layoutConfirmed: true,
          reason: undefined,
          errorLines: [],
          layout: editor.split,
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the Open in a window too narrow for the three-pane split: the reader applies the layout in the grid's measured pixels once for each arrangement and then takes the grid as it is, and the Open still ends in the readable explanation; fails_when=the step that applies the layout in pixels is repeated at every read of a grid that cannot take the proportions, so the editor is given the same layout many times a second while the split is waited for, or the step replaces the readable explanation the compact Open ends in; why_new=Cycle 0046 row 340 (the bound of the pixel step); seam=the workspace harness's constrainStudyGrid (every three-group layout is answered at the groups' minimum sizes), command log, the fake editor's maximized group and the presentation's reason
test('Open Study Workspace in a window too narrow for the split applies the layout in measured pixels once for each of its two arrangements and still ends in the readable explanation', async () => {
  // Arrange: the editor answers every three-group layout with the groups at their minimum sizes.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.constrainStudyGrid()
  try {
    const commandsBefore = harness.commands.length

    // Act: the Open reserves its groups with one arrangement and arranges once more when the panes exist.
    await harness.reader.open()

    // Assert: each arrangement sent its layout and one more in pixels.
    assert.deepEqual(
      {
        layoutsApplied: harness.commands
          .slice(commandsBefore)
          .filter((command) => command === 'vscode.setEditorLayout').length,
        maximized: harness.maximizedEditorGroup(),
        reason: harness.reader.presentationState().reason,
      },
      {
        layoutsApplied: 4,
        maximized: true,
        reason:
          'Focused explanation. The three-pane Study split is not confirmed. Use the pane controls or Restore layout.',
      },
    )
  } finally {
    await harness.close()
  }
})

for (const start of [
  {
    name: 'two groups side by side of 785 and 336 px',
    native: { orientation: 0, groups: [{ size: 0.7 }, { size: 0.3 }] },
    before: { orientation: 0, groups: [{ size: 785 }, { size: 336 }] },
  },
  {
    name: 'two groups one above the other in the proportion 7 to 3',
    native: { orientation: 1, groups: [{ size: 0.7 }, { size: 0.3 }] },
    before: { orientation: 1, groups: [{ size: 0.7 }, { size: 0.3 }] },
  },
] as const)
  for (const between of [
    'nothing',
    'a Read of the application',
    'Enlarge application',
  ] as const)
    // Value: protects=the learner's own editor layout through Open Study Workspace and Close Study Workspace: the groups stand as before, in their orientation and at their sizes, also after a Read or an Enlarge during the session; fails_when=the Study arrangement, which takes the learner's groups for its panes, stays applied after the Close, so two groups side by side are two rows, or unequal groups are equal, and the sizes a Read or an Enlarge kept are the last thing applied; why_new=Cycle 0046 row 339 (native round: two groups of 659 and 440 px side by side were two rows of 70 and 617 px after Open and Close in VS Code 1.140.0, twice); seam=the workspace harness's side bar model (layouts in pixels), closeDisposedPanelTabsLater (an emptied group is removed), a native layout of two unequal groups, the Read and Enlarge actions and layout read
    test(`Open Study Workspace and Close Study Workspace from the learner's ${start.name}, with ${between} between, leave the two groups as they stood before the Open`, async () => {
      // Arrange: the learner has two editor groups of unequal size, each with a tab; the editor removes a group its last tab left.
      const harness = await workspaceHarness(false)
      harness.useNativeLayout(start.native)
      harness.modelSideBars({ primary: true, auxiliary: false })
      harness.closeDisposedPanelTabsLater()
      try {
        const beforeOpen = harness.editorLayout()
        await harness.reader.open()
        const whileOpen = harness.groups.length
        if (between === 'a Read of the application')
          await harness.reader.action('read-app')
        if (between === 'Enlarge application')
          await harness.reader.action('enlarge-app')

        // Act: Close, and longer than the fake editor takes to remove the group the Study pane left.
        await harness.reader.close()
        await new Promise((resolve) => setTimeout(resolve, 150))

        // Assert
        assert.deepEqual(beforeOpen, start.native)
        assert.equal(whileOpen, 3)
        assert.deepEqual(
          {
            maximized: harness.maximizedEditorGroup(),
            learnersTabs: harness.groups.map((group) => group.tabs.length),
            layout: await harness.editor.commands.executeCommand(
              'vscode.getEditorLayout',
            ),
          },
          { maximized: false, learnersTabs: [1, 1], layout: start.before },
        )
      } finally {
        await harness.close()
      }
    })

// Value: protects=the learner who changed their editor groups during a Study session: a Close applies no layout of before the Open to groups that are no longer those of before; fails_when=the layout noted at the Open is applied whatever the groups are now, so a group the learner opened is merged into another one; why_new=Cycle 0046 row 339 (the guard: the same number of groups, each with its tabs; a learner who rearranged keeps what they made); seam=the workspace harness, a layout of four groups applied as the learner's change during the session, closeDisposedPanelTabsLater, command log
test('Close Study Workspace after the learner opened another editor group during the session applies no layout of before the Open, and the group stays', async () => {
  // Arrange: the learner has two editor groups side by side; the Study workspace is open, and the learner opens a fourth group with a file.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 0.7 }, { size: 0.3 }],
  })
  harness.modelSideBars({ primary: true, auxiliary: false })
  harness.closeDisposedPanelTabsLater()
  try {
    await harness.reader.open()
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [
        { size: 400, groups: [{ size: 300 }, { size: 300 }] },
        { size: 400 },
        { size: 321 },
      ],
    })
    harness.focusMutableDraft('notes-of-the-learner.txt', 4)
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Assert: the learner's three groups stay, and no layout was applied.
    assert.deepEqual(
      {
        layoutsApplied: harness.commands
          .slice(commandsBefore)
          .filter((command) => command === 'vscode.setEditorLayout').length,
        learnersTabs: harness.groups.map((group) => group.tabs.length),
      },
      { layoutsApplied: 0, learnersTabs: [1, 1, 1] },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's group opened while Close awaits a layout read captured before that group existed; fails_when=Close truncates the current groups with the old reply's count and applies a two-group original layout that merges the new third group; why_new=Cycle 0046 row 365; seam=a test-local native command response hold after its snapshot, learner layout/group creation, and the original column kept active
test('Close Study Workspace applies no original layout and keeps all three learner groups when a captured two-group layout reply waits while the third group is opened', async (context) => {
  // Arrange: Open used the learner's two columns; their native tabs close before Close reads the remaining rows.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 0.7 }, { size: 0.3 }],
  })
  harness.closeDisposedPanelTabsLater()
  let releaseRead = (): void => {}
  let reportReadCaptured = (): void => {}
  const readCaptured = new Promise<void>((resolve) => {
    reportReadCaptured = resolve
  })
  const readReleased = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  let closing: Promise<void> | undefined
  try {
    const firstFile = harness.focusMutableDraft('first-learner-file.ts', 1)
    harness.focusMutableDraft('second-learner-file.ts', 2)
    await harness.reader.open()
    harness.focusExistingSource(firstFile.editor)
    const executeCommand = harness.editor.commands.executeCommand
    let holdsRead = true
    let capturedLayout: unknown
    context.mock.method(
      harness.editor.commands,
      'executeCommand',
      async (...arguments_: Parameters<typeof executeCommand>) => {
        const answer = await Reflect.apply(
          executeCommand,
          harness.editor.commands,
          arguments_,
        )
        // Hold the captured answer, rather than delaying the read until after learner input.
        if (arguments_[0] === 'vscode.getEditorLayout' && holdsRead) {
          holdsRead = false
          capturedLayout = answer
          reportReadCaptured()
          await readReleased
        }
        return answer
      },
    )

    // Act: after the old two-group snapshot, the learner adds a third group and returns to the original column.
    closing = harness.reader.close()
    await readCaptured
    assert.deepEqual(capturedLayout, {
      orientation: 1,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1,
      groups: [{ size: 0.4 }, { size: 0.35 }, { size: 0.25 }],
    })
    const newFile = harness.focusMutableDraft('new-third-file.ts', 3)
    harness.focusExistingSource(firstFile.editor)
    const commandsBeforeReply = harness.commands.length
    releaseRead()
    await closing

    // Assert: the stale answer gives no permission to merge away the new learner group.
    assert.deepEqual(
      {
        restorationCommands: harness.commands
          .slice(commandsBeforeReply)
          .filter((command) => command === 'vscode.setEditorLayout'),
        groups: harness.groups.length,
        thirdGroupKeptItsFile:
          harness.groups[2]?.tabs.includes(newFile.tab) ?? false,
      },
      { restorationCommands: [], groups: 3, thirdGroupKeptItsFile: true },
    )
  } finally {
    releaseRead()
    await closing?.catch(() => undefined)
    await harness.close()
  }
})

// Cycle 0046 row 372: comparison keeps its real answer; a queued native-model update must not fit between that guard and the restoration command.
test('Close Study Workspace keeps a third learner group whose model update was queued by the completed group comparison', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 0.7 }, { size: 0.3 }],
  })
  harness.closeDisposedPanelTabsLater()
  const compareGroups = harness.reader['sameEditorGroups']
  let queuedUpdate = false
  let newFile: ReturnType<typeof harness.focusMutableDraft> | undefined
  let groupLayoutWrite: Promise<unknown> | undefined
  try {
    const firstFile = harness.focusMutableDraft('first-learner-file.ts', 1)
    harness.focusMutableDraft('second-learner-file.ts', 2)
    await harness.reader.open()
    harness.focusExistingSource(firstFile.editor)
    harness.reader['sameEditorGroups'] = (...argumentsOfComparison) => {
      const answer = compareGroups.call(
        harness.reader,
        ...argumentsOfComparison,
      )
      // Preserve the real comparison and queue input only in Close's final layout check.
      if (
        answer &&
        !queuedUpdate &&
        harness.groups.length === 2 &&
        new Error().stack?.includes('giveLayoutOfBeforeOpenBack')
      ) {
        queuedUpdate = true
        queueMicrotask(() => {
          groupLayoutWrite = harness.editor.commands.executeCommand(
            'vscode.setEditorLayout',
            {
              orientation: 1,
              groups: [{ size: 0.4 }, { size: 0.35 }, { size: 0.25 }],
            },
          )
          newFile = harness.focusMutableDraft('new-third-file.ts', 3)
          harness.focusExistingSource(firstFile.editor)
        })
      }
      return answer
    }

    // Act
    await harness.reader.close()
    await groupLayoutWrite

    // Assert: the queued input is exercised, and no later stale restoration removes its group.
    assert.deepEqual(
      {
        queuedUpdate,
        groups: harness.groups.length,
        thirdGroupKeptItsFile:
          newFile !== undefined &&
          Boolean(harness.groups[2]?.tabs.includes(newFile.tab)),
      },
      { queuedUpdate: true, groups: 3, thirdGroupKeptItsFile: true },
    )
  } finally {
    harness.reader['sameEditorGroups'] = compareGroups
    await groupLayoutWrite?.catch(() => undefined)
    await harness.close()
  }
})

for (const situation of [
  {
    name: 'the learner replaced the file of the second group by another one during the session',
    expected: { layoutsApplied: 0, groups: 2 },
  },
  {
    name: 'the reader is disposed and not closed by the learner',
    expected: { layoutsApplied: 0, groups: 2 },
  },
] as const)
  // Value: protects=the learner's editor groups at the end of a Study session in the two cases in which the layout of before the Open is not theirs to get back: a group no longer holds its tab of before, and a reader that is disposed without the learner's Close; fails_when=the layout of before is applied all the same, over a group the learner changed, or at a disposal nobody asked for; why_new=Cycle 0046 row 339 (the guards of the give-back, each given up on purpose; the third case, an editor that keeps the group the Study pane left empty, ended with finding 597: Close retires that group Codebook created); seam=the workspace harness, a native layout of two columns, the fake editor's tab model changed as the learner's replacement of a file, closeDisposedPanelTabsLater, the reader's dispose and command log
  test(`the end of a Study session applies no layout of before the Open when ${situation.name}`, async () => {
    // Arrange: the learner has two editor groups side by side; the Study workspace is open.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 0.7 }, { size: 0.3 }],
    })
    harness.closeDisposedPanelTabsLater()
    try {
      await harness.reader.open()
      if (situation.name.startsWith('the learner replaced'))
        harness.groups[1]!.tabs[0]!.input = harness.focusMutableDraft(
          'another-file.ts',
          2,
        ).tab.input
      const commandsBefore = harness.commands.length

      // Act
      if (situation.name.startsWith('the reader is disposed'))
        await harness.reader.dispose()
      else await harness.reader.close()
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Assert
      assert.deepEqual(
        {
          layoutsApplied: harness.commands
            .slice(commandsBefore)
            .filter((command) => command === 'vscode.setEditorLayout').length,
          groups: harness.groups.length,
        },
        situation.expected,
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner's two editor groups at the end of a Study session in an editor that keeps a group its last tab left (workbench.editor.closeEmptyGroups off): the group Codebook created for the Study pane goes, and the learner's groups get the layout they had before the Open; fails_when=Close leaves the Study pane's created group empty beside the learner's groups, so the groups differ from those of before and no layout is given back; why_new=Cycle 0046 finding 597 (Close retires every empty group Codebook created for the Study; row 339 had kept that group); seam=the workspace harness, a native layout of two columns, the fake editor that keeps emptied groups, command log and layout read
test('Close Study Workspace in an editor that keeps emptied groups retires the group Codebook created for the Study pane and gives the learner’s two groups the layout they had before the Open', async () => {
  // Arrange: the learner has two editor groups side by side; the Study workspace is open, its Study pane in a third group Codebook created.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 0.7 }, { size: 0.3 }],
  })
  try {
    await harness.reader.open()
    const studyPaneGroup = harness.groups.find(
      (group) => group.viewColumn === 3,
    )!
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()

    // Assert
    assert.deepEqual(
      {
        studyPaneGroupLeft: harness.groups.includes(studyPaneGroup),
        layoutsApplied: harness.commands
          .slice(commandsBefore)
          .filter((command) => command === 'vscode.setEditorLayout').length,
        groups: harness.groups.length,
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      },
      {
        studyPaneGroupLeft: false,
        layoutsApplied: 1,
        groups: 2,
        layout: { orientation: 0, groups: [{ size: 0.7 }, { size: 0.3 }] },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a Close that finds the learner's groups as they stood before the Open running no layout command at all; fails_when=the layout of before is applied whenever it is noted, so every Close rebuilds the editor's grid although nothing differs; why_new=Cycle 0046 row 339 (the native record of row 323: two rows of 344 and 343 px were 344 and 343 px after Open and Close); seam=the workspace harness, a native layout of two equal rows, closeDisposedPanelTabsLater, command log and layout read
test("Open Study Workspace and Close Study Workspace from the learner's two rows of equal height apply no layout at the Close: the rows are as before already", async () => {
  // Arrange: the learner has two editor groups, one above the other, of equal height; the editor removes a group its last tab left.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.closeDisposedPanelTabsLater()
  try {
    await harness.reader.open()
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Assert
    assert.deepEqual(
      {
        layoutsApplied: harness.commands
          .slice(commandsBefore)
          .filter((command) => command === 'vscode.setEditorLayout').length,
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      },
      {
        layoutsApplied: 0,
        layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the editor part of Cursor's Agent chat at a Close made while the chat tab has the keyboard: the editor applies a layout to the part that has the focus, so the layout of before the Open is not applied and the chat's part keeps its own groups; fails_when=the layout noted for the main editor is applied without proof that the main editor answers, and the chat's part, which has as many groups as the learner had, is given the learner's layout; why_new=Cycle 0046 row 339 (the guard of rows 328 and 334, asked for the Open's layout); seam=the workspace harness's addSeparateEditorPart with a layout of two groups of its own, a native layout of two columns, closeDisposedPanelTabsLater and command log
test("Close Study Workspace made while Cursor's chat tab has the keyboard applies no layout of before the Open: the chat's editor part keeps the sizes of its own two groups", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part, which has two groups of its own; the learner has two editor groups side by side; the Study workspace is open and the learner types in the chat.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 0.7 }, { size: 0.3 }],
  })
  harness.useHostAppName('Cursor')
  harness.closeDisposedPanelTabsLater()
  const chat = harness.addSeparateEditorPart()
  try {
    await harness.reader.open()
    chat.focusTab()
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [{ size: 400 }, { size: 343 }],
    })
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Assert
    assert.deepEqual(
      {
        layoutsApplied: harness.commands
          .slice(commandsBefore)
          .filter((command) => command === 'vscode.setEditorLayout').length,
        chatLayout: chat.layout(),
      },
      {
        layoutsApplied: 0,
        chatLayout: { orientation: 0, groups: [{ size: 400 }, { size: 343 }] },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's empty editor group through Open and Close in an editor that removes a group its last tab left (Cursor's default): the Study workspace puts a pane into the empty group, the editor removes that group when the pane goes, and the Close makes an empty group again at its place and size; fails_when=the Close leaves one group where the learner had two, as natively in Cursor 3.23.12 (two rows of 329 and 328 px, the second empty, were one group of 587 px after Open and Close); why_new=Cycle 0046 row 339 (the Cursor case: what a Close can give back of an empty group); seam=the workspace harness, a native layout of two rows whose second group has no tab, closeDisposedPanelTabsLater, layout read
test("Open Study Workspace and Close Study Workspace from the learner's two rows, the second of them empty, leave two rows of the sizes of before, the second empty again", async () => {
  // Arrange: the learner has two editor groups, one above the other, of 329 and 328 parts; the second has no tab; the editor removes a group its last tab left.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 329 }, { size: 328 }],
  })
  harness.groups[1]!.tabs.splice(0)
  harness.groups[1]!.activeTab = undefined
  harness.closeDisposedPanelTabsLater()
  try {
    const tabsBefore = harness.groups.map((group) => group.tabs.length)
    await harness.reader.open()

    // Act
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Assert
    assert.deepEqual(tabsBefore, [1, 0])
    assert.deepEqual(
      {
        learnersTabs: harness.groups.map((group) => group.tabs.length),
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      },
      {
        learnersTabs: [1, 0],
        layout: { orientation: 1, groups: [{ size: 329 }, { size: 328 }] },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's primary side bar when the editor answers the Read's first layout read and refuses the one after the measurement hid that bar: the Restore shows it again; fails_when=the reading keeps no record that its measurement hid the bar, so the Restore, Close and a refused Read show nothing and the file explorer stays away; why_new=Cycle 0046 row 33 (PL-25 of Cycle 0045: the second read's failure left the measurement undefined); seam=the workspace harness's side bar model, holdNextCommand on the measurement's close command and failNextCommand on the layout read after it
test('a Restore after a Read whose layout read failed once the primary side bar was hidden for the measurement shows the primary side bar again', async () => {
  // Arrange: both side bars are open; the editor answers the Read's first layout read and rejects the one after the primary side bar was hidden.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: true })
  let release = (): void => {}
  try {
    await harness.reader.open()
    const measurement = harness.holdNextCommand('workbench.action.closeSidebar')
    release = measurement.release
    const reading = harness.reader.action('read-context')
    await measurement.started
    harness.failNextCommand('vscode.getEditorLayout')
    measurement.release()
    await reading
    const duringRead = {
      ...harness.sideBars(),
      maximized: harness.maximizedEditorGroup(),
    }

    // Act
    await harness.reader.action('arrange')

    // Assert: the reading without a measurement left the secondary side bar as it was; the Restore shows the primary one the measurement hid.
    assert.deepEqual(duringRead, {
      primary: false,
      auxiliary: true,
      hasKeyboard: false,
      maximized: true,
    })
    assert.deepEqual(harness.sideBars(), {
      primary: true,
      auxiliary: true,
      hasKeyboard: false,
    })
    assert.equal(harness.maximizedEditorGroup(), false)
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=Restore leaving the enlarged Study pane while a tab the learner keeps covers the captured source, and saying which tab and what clears it; fails_when=the Restore finds the source not shown and enlarges the Study pane again, so the pane fills the window after every Restore and no tab is named; why_new=Cycle 0045 NF-22 with PC-1.10 (a kept tab that is no text editor is its own case, and the step the refusal names makes the next Restore possible); seam=addOpaqueTab, focusOpaqueTab, the fake editor's maximized group
test('Restore beside a kept image tab leaves the enlarged Study pane and names the tab that keeps the panes from being arranged', async () => {
  // Arrange: the learner keeps an image open in front of the captured source and read the explanation enlarged.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const image = harness.addOpaqueTab('logo.png', 2)
    harness.focusOpaqueTab(image)
    await harness.reader.action('read-context')
    const enlargedByRead = harness.maximizedEditorGroup()
    const maximizeCommands = (): number =>
      harness.commands.filter(
        (command) => command === 'workbench.action.maximizeEditorHideSidebar',
      ).length

    // Act: the pane's Restore; then the step the refusal names, and Restore again.
    await harness.reader.action('arrange')
    const refused = {
      lines: harness.reader.inspect().view!.errors.join(' | '),
      maximized: harness.maximizedEditorGroup(),
      maximizeCommands: maximizeCommands(),
    }
    const sourceGroup = harness.groups.find((group) =>
      group.tabs.includes(image),
    )!
    sourceGroup.activeTab = sourceGroup.tabs.find((tab) => tab !== image)
    await harness.reader.action('arrange')

    // Assert
    assert.equal(enlargedByRead, true)
    assert.deepEqual(refused, {
      lines:
        'Error: The tab "logo.png" is in front of the captured source in editor group 2. Close that tab or select the captured source\'s tab, then restore the layout again.',
      maximized: false,
      maximizeCommands: 1,
    })
    // After the named step (the learner selected the captured source's tab; the image stays open behind it) the next Restore arranges and confirms the three panes.
    assert.equal(sourceGroup.tabs.includes(image), true)
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.equal(maximizeCommands(), 1)
    assert.equal(
      (await harness.reader.readPresentationState()).layoutConfirmed,
      true,
    )
  } finally {
    await harness.close()
  }
})

for (const entry of ['Open replay', 'Open Study Workspace'] as const) {
  // Value: protects=an entry that is refused because the main editor never reports the keyboard focus the measurement gave it leaving the window as it found it; fails_when=the entry creates the Application pane first, the refusal leaves that pane open with the keyboard, and the chat does not get the keyboard back because the editor still names its group; why_new=Cycle 0045 finding S1-F3 (the rule a select and a restore follow since cause 12 (b) did not hold for Open replay and Open Study Workspace; natively item 2's first try of the owed checks left the Application pane open with the keyboard after `codebook_playback open`); seam=the recorded reader harness with a separate editor part whose group the editor names as active, the fake editor's unreported pane focus beside the chat, and the fake clock for the five seconds of the wait
  test(`${entry} refused while Cursor's chat holds the keyboard opens no pane and leaves the keyboard focus where it was`, async (context) => {
    // Arrange: Cursor names the chat's group as the active one and its input has the keyboard; the first group shows a settings page, so the measurement can only focus the Application pane the entry places there, and Cursor reports no focus of that pane.
    const harness = await recordedReaderHarness()
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    harness.leavePaneFocusUnreportedBesideChat()
    try {
      harness.focusOpaqueTab(harness.addOpaqueTab('Cursor Settings', 1))
      chat.focusTab()
      const tabsBefore = harness.groups.map((group) => [...group.tabs]),
        layoutBefore = structuredClone(harness.editorLayout())

      // Act: the five seconds of the wait for the focus report pass on a faked clock.
      let refusal: string | undefined
      if (entry === 'Open replay') {
        await harness.reader.openRecording(harness.studyId)
        enableFakeClock(context)
        await advanceClockUntil(
          context,
          () => harness.controller.state().readiness === 'failed',
          6_000,
        )
        refusal = harness.controller.state().reason
      } else {
        const opening = harness.reader.open().then(
          () => 'opened',
          (error: unknown) => String(error),
        )
        enableFakeClock(context)
        await advanceClockUntilSettled(context, opening, 6_000)
        refusal = await opening
      }
      resetFakeClock(context)

      // Assert
      assert.equal(
        refusal,
        'Error: The Codebook panes were not arranged: the main editor did not report the keyboard focus within 5 s after Codebook focused its first editor group. Click into a file in the main editor, then try again.',
      )
      assert.equal(harness.counts().panels, 0)
      assert.deepEqual(
        harness.groups.map((group) => [...group.tabs]),
        tabsBefore,
      )
      assert.equal(chat.focused(), true)
      assert.equal(harness.reader.presentationState().state, 'closed')
      // The grid is as the entry found it: no editor group was opened for the focus return.
      assert.equal(harness.groups.length, 3)
      assert.deepEqual(harness.editorLayout(), layoutBefore)
    } finally {
      resetFakeClock(context)
      await harness.close()
    }
  })

  for (const [named, replacesGroupObjects] of [
    ["the chat's group", true],
    ['a text tab without an active text editor', false],
    ['a text tab without an active text editor', true],
  ] as const)
    // Value: protects=an entry made while Cursor's chat holds the keyboard being arranged, with the chat having the keyboard again afterwards; fails_when=the Application pane is created before the main editor is measured, where Cursor reports no focus while it names the chat's group, so the entry ends with a refusal after five seconds, or the keyboard stays in the main editor after the measurement borrowed it; why_new=Cycle 0045 finding S1-F3 (the early measurement and the focus return of cause 12 held for a select and a restore only); seam=the recorded reader harness with a separate editor part, focusMutableDraft, the fake editor's group object replacement and its unreported pane focus beside the chat
    test(`${entry} made while Cursor's chat holds the keyboard and the editor names ${named} arranges the panes and gives the chat its focus back, ${replacesGroupObjects ? 'also when the editor replaces every tab group object with each tab change' : 'in an editor that keeps its tab group objects'}`, async () => {
      // Arrange: the first group shows the learner's file beside a settings page and the group below is empty; the chat's own editor part holds the keyboard.
      const harness = await recordedReaderHarness()
      harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
      harness.groups.at(-1)!.tabs = []
      harness.groups.at(-1)!.activeTab = undefined
      const chat = harness.addSeparateEditorPart()
      if (replacesGroupObjects) harness.replaceGroupObjectsOnTabChanges()
      // Cursor keeps naming the chat's group after the measurement focused the first group.
      if (named === "the chat's group")
        harness.leavePaneFocusUnreportedBesideChat()
      try {
        const settings = harness.addOpaqueTab('Cursor Settings', 1),
          learnerFile = harness.focusMutableDraft('login-form.tsx', 1)
        if (named === "the chat's group") chat.focusTab()
        else chat.focus()
        const before = {
          chatHasKeyboard: chat.focused(),
          hasActiveTextEditor:
            harness.editor.window.activeTextEditor !== undefined,
          chatGroupNamed:
            harness.editor.window.tabGroups.activeTabGroup.tabs.includes(
              chat.tab,
            ),
        }

        // Act
        if (entry === 'Open replay') {
          await harness.reader.openRecording(harness.studyId)
          await harness.controller.settle()
        } else await harness.reader.open()

        // Assert
        const state = harness.reader.presentationState(),
          firstGroup = harness.groups.find(
            (group) => group.viewColumn === (entry === 'Open replay' ? 2 : 1),
          )!,
          chatGroup = harness.groups.find((group) =>
            group.tabs.includes(chat.tab),
          )
        assert.deepEqual(before, {
          chatHasKeyboard: true,
          hasActiveTextEditor: false,
          chatGroupNamed: named === "the chat's group",
        })
        assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
        if (entry === 'Open replay') {
          assert.equal(harness.controller.state().reason, undefined)
          assert.equal(harness.controller.state().readiness, 'ready')
        }
        assert.equal(state.state, 'open')
        assert.equal(state.layoutConfirmed, true)
        assert.equal(state.panes.appColumn, 1)
        assert.equal(state.panes.sourceColumn, 2)
        assert.equal(
          state.panes.contextColumn,
          entry === 'Open replay' ? undefined : 3,
        )
        // Replay's App allocation shifts the original group; its dirty file and settings remain together in that original group.
        assert.equal(firstGroup.tabs.includes(learnerFile.tab), true)
        assert.equal(firstGroup.tabs.includes(settings), true)
        assert.equal(
          learnerFile.document.getText(),
          'Original learner draft.\n',
        )
        assert.equal(learnerFile.tab.isDirty, true)
        assert.deepEqual(harness.tabCloseRequests(), [])
        // The measurement borrowed the keyboard for the main editor; the chat has it again through Cursor's own command, and no editor group was opened for that.
        assert.equal(chatGroup?.viewColumn, 4)
        assert.equal(harness.groups.length, 4)
        assert.equal(
          harness.commands.filter(
            (command) => command === 'workbench.action.newGroupAbove',
          ).length,
          entry === 'Open replay' ? 1 : 0,
        )
        assert.equal(
          harness.commands
            .filter((command) =>
              /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
                command,
              ),
            )
            .at(-1),
          'composer.focusComposer',
        )
        assert.equal(chat.focused(), true)
      } finally {
        await harness.close()
      }
    })
}

for (const phase of [
  'native response',
  'caller admission',
  'same-source key',
  'window round trip',
  'Close',
] as const)
  test(`recorded App preparation preserves newer source input at ${phase} before allocating its native group`, async () => {
    // Arrange: both source tabs exist before entry, so an away-and-back choice changes no group or document identity.
    const harness = await recordedReaderHarness()
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    harness.leavePaneFocusUnreportedBesideChat()
    const original = harness.focusMutableDraft('original-primary.ts', 1),
      other = harness.focusMutableDraft('other-primary.ts', 1)
    harness.focusExistingSource(original.editor)
    chat.focusTab()
    const focus = harness.reader['focusApplicationSourceGroup'],
      focusPrimary = focus.bind(harness.reader),
      commandsBefore = harness.commands.length
    let held:
        ReturnType<typeof harness.holdNextPrimaryFocusResponse> | undefined,
      opening: Promise<void> | undefined,
      closing: Promise<void> | undefined
    harness.reader['focusApplicationSourceGroup'] = async (...arguments_) => {
      if (phase !== 'caller admission')
        held = harness.holdNextPrimaryFocusResponse()
      const receipt = await focusPrimary(...arguments_)
      if (phase === 'caller admission') {
        harness.focusExistingSource(other.editor)
        harness.focusExistingSource(original.editor)
      }
      return receipt
    }
    try {
      // Act: hold the native response or change input in the caller's await gap; Close must also drain that response without allocation.
      opening = harness.reader
        .openRecording(harness.studyId)
        .then(() => harness.controller.settle())
      if (phase !== 'caller admission') {
        await waitUntil(() => Boolean(held), 'App preparation primary focus')
        assert.ok(held)
        await held.started
        if (phase === 'Close') closing = harness.reader.close()
        else if (phase === 'same-source key')
          harness.workInActiveTextEditor('keyboard')
        else if (phase === 'window round trip') {
          harness.changeWindowFocus(false)
          harness.changeWindowFocus(true)
        } else {
          harness.focusExistingSource(other.editor)
          harness.focusExistingSource(original.editor)
        }
        held.release()
      }
      await opening
      await closing

      // Assert
      assert.equal(
        harness.commands
          .slice(commandsBefore)
          .includes('workbench.action.newGroupAbove'),
        false,
      )
      assert.equal(harness.nativePanels().length, 0)
      assert.equal(original.document.getText(), 'Original learner draft.\n')
      assert.equal(other.document.getText(), 'Original learner draft.\n')
      if (phase === 'Close')
        assert.equal(harness.reader.inspect().opened, false)
      else {
        assert.equal(harness.controller.state().readiness, 'failed')
        assert.match(
          harness.controller.state().reason ?? '',
          /primary source changed/,
        )
        assert.equal(
          harness.focusedSource()?.document.uri.toString(),
          original.document.uri.toString(),
        )
      }
    } finally {
      held?.release()
      await opening
      await closing
      harness.reader['focusApplicationSourceGroup'] = focus
      await harness.close()
    }
  })

// Value: protects=cold Study entry when VS Code retains an unchanged background text-editor receipt; fails_when=Application registration waits for that receipt to disappear although its native tab is active and visible; why_new=Cycle0046 native283 held auth.ts/column2 while Application was active in column1; seam=the confirmed independent native tab and text-editor receipts, retained until Open completes.
for (const receiptLocation of [
  'background group',
  'covered source group',
] as const)
  test(`Open Study Workspace completes while VS Code retains the original text-editor receipt in the ${receiptLocation}`, async (context) => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 659 }, { size: 440 }],
    })
    harness.focusMutableDraft('auth.ts', 2)
    const backgroundEditor = harness.editor.window.activeTextEditor
    harness.focusMutableDraft('login-form.tsx', 1)
    const originalEditor =
      receiptLocation === 'background group'
        ? backgroundEditor
        : harness.editor.window.activeTextEditor
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      harness.editor.window,
      'activeTextEditor',
    )!
    const originalTabs = harness.groups.flatMap((group) => [...group.tabs])
    Object.defineProperty(harness.editor.window, 'activeTextEditor', {
      configurable: true,
      get: () => originalEditor,
    })
    try {
      // Act: leave the original receipt populated through the entire Open.
      const opening = harness.reader.open().then(
        () => 'opened',
        (error: unknown) => String(error),
      )
      enableFakeClock(context)
      await advanceClockUntilSettled(context, opening, 6_000)
      resetFakeClock(context)

      // Assert
      assert.equal(await opening, 'opened')
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.editor.window.activeTextEditor, originalEditor)
      assert.equal(harness.groups.length, 3)
      assert.equal(
        originalTabs.every((tab) =>
          harness.groups.some((group) => group.tabs.includes(tab)),
        ),
        true,
      )
      assert.equal(harness.runtimes.length, 0)
    } finally {
      resetFakeClock(context)
      Object.defineProperty(
        harness.editor.window,
        'activeTextEditor',
        originalDescriptor,
      )
      await harness.close()
    }
  })

for (const changedIdentity of ['source URI', 'source column'] as const)
  test(`Open Study Workspace refuses a text-editor receipt whose ${changedIdentity} changes during Application registration`, async (context) => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 659 }, { size: 440 }],
    })
    const background = harness.focusMutableDraft('auth.ts', 2)
    const otherFile = harness.focusMutableDraft('different-source.ts', 2)
    background.focus()
    harness.focusMutableDraft('login-form.tsx', 1)
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      harness.editor.window,
      'activeTextEditor',
    )!
    let reportedEditor = background.editor
    Object.defineProperty(harness.editor.window, 'activeTextEditor', {
      configurable: true,
      get: () => reportedEditor,
    })
    harness.onNextPanel('codebook.scopedBrowser', () => {
      // Only the independent text-editor receipt changes; no tab change masks this guard.
      reportedEditor =
        changedIdentity === 'source URI'
          ? otherFile.editor
          : { ...background.editor, viewColumn: 1 }
    })
    const originalTabs = harness.groups.flatMap((group) => [...group.tabs])
    try {
      // Act
      const opening = harness.reader.open().then(
        () => 'opened',
        (error: unknown) => String(error),
      )
      enableFakeClock(context)
      await advanceClockUntilSettled(context, opening, 6_000)
      resetFakeClock(context)

      // Assert
      assert.equal(
        await opening,
        changedIdentity === 'source URI'
          ? 'Error: Native panes or learner focus changed while the new application registered; the arrangement was preserved.'
          : 'Error: Timed out waiting for new application native registration',
      )
      assert.equal(harness.reader.presentationState().state, 'closed')
      assert.equal(harness.counts().panels, 0)
      assert.equal(
        originalTabs.every((tab) =>
          harness.groups.some((group) => group.tabs.includes(tab)),
        ),
        true,
      )
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
    } finally {
      resetFakeClock(context)
      Object.defineProperty(
        harness.editor.window,
        'activeTextEditor',
        originalDescriptor,
      )
      await harness.close()
    }
  })

test('Open Study Workspace refuses an unchanged text-editor receipt without an original column identity', async (context) => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 659 }, { size: 440 }],
  })
  const background = harness.focusMutableDraft('auth.ts', 2)
  harness.focusMutableDraft('login-form.tsx', 1)
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    harness.editor.window,
    'activeTextEditor',
  )!
  Object.defineProperty(harness.editor.window, 'activeTextEditor', {
    configurable: true,
    get: () => ({ ...background.editor, viewColumn: undefined }),
  })
  try {
    // Act
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    enableFakeClock(context)
    await advanceClockUntilSettled(context, opening, 6_000)
    resetFakeClock(context)

    // Assert
    assert.equal(
      await opening,
      'Error: Timed out waiting for new application native registration',
    )
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
  } finally {
    resetFakeClock(context)
    Object.defineProperty(
      harness.editor.window,
      'activeTextEditor',
      originalDescriptor,
    )
    await harness.close()
  }
})
