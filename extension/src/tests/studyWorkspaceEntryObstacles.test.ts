import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  configuredWorkspaceHarness,
  readerSeams,
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

// Value: protects=Open replay refused for a learner's preview tab being answered with a modal warning that names the file and offers Keep Tab Open and Close Tab, each retrying the open, in both hosts (Cursor cuts a toast to one line, so the learner saw neither the file nor the way out); fails_when=the refusal stays a toast, the dialog names no file, a button does not clear the tab, or the open is not retried; why_new=Cycle 0050 F158 and D33 (PR-B2 spike, Cursor 3.26.13); seam=addTextPreview, the main editor never reporting focus beside it (hasMainEditorFocus), answerWarningDialogs
for (const choice of ['Close Tab', 'Keep Tab Open'] as const)
  test(`Open replay beside a learner's preview tab asks in a modal dialog that names the file, and ${choice} retries the open`, async () => {
    // Arrange
    const harness = await recordedReaderHarness()
    try {
      await harness.reader.close()
      harness.useNativeLayout({ orientation: 0, groups: [{}] })
      // The learner's own kept file stands in group 1 beside the preview, so the group still has a file once the preview is closed.
      harness.focusMutableDraft('learner-notes.ts', 1)
      const agentChat = harness.addSeparateEditorPart()
      await writeFile(join(harness.directory, 'login-form.tsx'), 'export {}\n')
      const preview = harness.addTextPreview(
        join(harness.directory, 'login-form.tsx'),
        1,
      )
      agentChat.focus()
      const hasMainEditorFocus = harness.reader['hasMainEditorFocus'].bind(
        harness.reader,
      )
      // The main editor reports no focus in group 1 only while the preview tab is a preview.
      harness.reader['hasMainEditorFocus'] = (groupCount: number): boolean =>
        groupCount === 1 && preview.isPreview
          ? false
          : hasMainEditorFocus(groupCount)
      harness.answerWarningDialogs(async () => choice)
      let openAttempts = 0
      const openRecording = harness.reader.openRecording.bind(harness.reader)
      harness.reader.openRecording = (studyId: string): Promise<void> => {
        openAttempts++
        return openRecording(studyId)
      }

      // Act
      await harness.reader.openLearningReplay(harness.studyId)
      await harness.controller.settle()

      // Assert
      assert.equal(harness.warningDialogs.length, 1)
      assert.match(harness.warningDialogs[0]!.title, /"login-form\.tsx"/)
      assert.deepEqual(harness.warningDialogs[0]!.items, [
        'Keep Tab Open',
        'Close Tab',
      ])
      assert.equal(
        (harness.warningDialogs[0]!.options as { modal?: boolean }).modal,
        true,
      )
      // The choice retried the open once (the fake editor's chat-focus model still lets that second attempt fail for another cause, which the dialog does not answer).
      assert.equal(openAttempts, 2)
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(preview)),
        choice === 'Keep Tab Open',
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

// Value: protects=the way back to the live run after Developer: Reload Window when the learner resized the grid, so the earlier window's record no longer proves its empty locked Application group at column 1, and a cold Study select placed the Application pane in that leftover; fails_when=the agent's Return Current moves the Application into its own new group, the editor removes the leftover the move left empty (workbench.editor.closeEmptyGroups, on by default in both hosts), and the reservation, still expecting that group, refuses with "The dedicated Application layout could not be confirmed." and leaves the Study unconfirmed, so Restore refuses too and nothing names the leftover; why_new=Cycle 0046 row 626 (native C56 round 1d in VS Code 1.140.0: layout 229/349/109 against the record's 229×3, cold select confirmed with the Application in the leftover at column 1, then codebook_return_current RUNTIME_FAILED and Restore PRESENTATION_UNAVAILABLE); seam=applicationGroupMarkers (a record the resized grid no longer equals), leaveEmptyLockedGroup, closeEmptyGroupsAfterPanelMove, addSeparateEditorPart (Cursor's chat part) and returnToCurrent as the agent
for (const host of ['VS Code', 'Cursor'] as const)
  test(`in ${host}, an agent's Return Current after a reload whose record no longer proves the leftover reaches the live run in a group of the Application's own`, async () => {
    // Arrange: the earlier window recorded its Application group at column 1 of three equal rows; after the reload that group stands empty and locked, and the learner grew the second row twice, so the record proves nothing. The learner's files stand in columns 2 and 3; in Cursor its chat part stands beside the main editor.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
    })
    const chat = host === 'Cursor' ? harness.addSeparateEditorPart() : undefined
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
      const leftover = harness.groups.find((group) => group.viewColumn === 1)!
      const learnerAuth = harness.focusMutableDraft('auth.ts', 3)
      const learnerActions = harness.focusMutableDraft('actions.ts', 2)
      chat?.focusTab()
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
      // The cold select placed the Application pane in the unproven leftover at column 1, which keeps its lock.
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(leftover.tabs.length, 1)
      assert.equal(leftover.locked, true)
      const selected = harness.reader.presentationState(),
        commandsBefore = harness.commands.length

      // Act
      const answer = await harness.reader
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

      // Assert: the Return reached the live run with its layout confirmed; the Application stands in column 1 in a new locked group, the editor removed the leftover the pane's move left empty at column 2, Codebook unlocked nothing, and the learner's files keep their groups.
      assert.equal(answer, 'returned')
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.groups.includes(leftover), false)
      assert.deepEqual(harness.automaticallyClosedColumns(), [2])
      assert.equal(
        harness.groups.find((group) => group.viewColumn === 1)?.locked,
        true,
      )
      assert.equal(
        harness.commands
          .slice(commandsBefore)
          .includes('workbench.action.unlockEditorGroup'),
        false,
      )
      assert.equal(
        harness.groups.find((group) => group.tabs.includes(learnerActions.tab))
          ?.viewColumn,
        2,
      )
      assert.equal(
        harness.groups.find((group) => group.tabs.includes(learnerAuth.tab))
          ?.viewColumn,
        3,
      )
      // The earlier window's record, which proved nothing, gave way to this window's record of the Application's own group.
      const marker = harness.applicationGroupMarkers.get(
        'codebook.applicationGroup.v1',
      ) as { writer?: unknown; column?: unknown; groupCount?: unknown }
      assert.deepEqual(
        {
          writtenByThisWindow:
            marker.writer === harness.reader['applicationGroupMarkerWriter'],
          column: marker.column,
          groupCount: marker.groupCount,
        },
        { writtenByThisWindow: true, column: 1, groupCount: 3 },
      )
    } finally {
      await harness.close()
    }
  })

for (const situation of [
  {
    host: 'VS Code',
    layoutAfterClose: {
      orientation: 1,
      groups: [{ size: 349 }, { size: 109 }],
    },
  },
  {
    host: 'Cursor',
    // Beside Cursor's chat part no layout read at Close proves the main editor, so no sizes are given back (as without the leftover): the learner's groups stay in the rows the live arrangement made, which the fake editor reports with a size of 1 each.
    layoutAfterClose: {
      orientation: 1,
      groups: [{ size: 1 }, { size: 1 }],
    },
  },
] as const)
  // Value: protects=the learner's arrangement on row 626's path (Developer: Reload Window, the learner resized the stacked groups so the earlier window's record proves nothing, the cold Study select put the Application into the unproven leftover, and the agent's Return Current moved it into its own group): the live arrangement stacks the Application above the captured source's group and the learner's other group as it does without the leftover (C57 rounds 1a and 1b: three rows), and Close gives the learner's two groups back stacked as they stood, the removed leftover aside; fails_when=the Return's newGroupAbove splits only the Study layout's left column (VS Code 1.140.0 workbench.desktop.main.js 990:31740 adds above the active group, 1106:113133 and 981:46383 split that group's cell), so the learner's second group keeps the Study pane's column beside it, and Close finds one group fewer than it noted (the leftover the editor removed) and gives nothing back, so the learner's groups stand side by side (C57 round 1d); why_new=Cycle 0046 row 639; seam=applicationGroupMarkers (a record the resized grid no longer equals), leaveEmptyLockedGroup, closeEmptyGroupsAfterPanelMove, addSeparateEditorPart (Cursor's chat part), the reader's agent select and returnToCurrent, close, editorLayout and harness.groups
  test(`in ${situation.host}, an agent's Return Current after a reload whose record no longer proves the leftover stacks the Application above the source and the learner's other group, and Close gives the learner's groups back stacked`, async () => {
    // Arrange: the earlier window recorded its Application group at column 1 of three equal rows; after the reload that group stands empty and locked, and the learner grew the second row twice. actions.ts is in the second row and auth.ts in the third; in Cursor its chat part stands beside the main editor. The agent selected the Study cold, which put the Application into the leftover.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
    })
    const chat =
      situation.host === 'Cursor' ? harness.addSeparateEditorPart() : undefined
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
      const learnerAuth = harness.focusMutableDraft('auth.ts', 3)
      const learnerActions = harness.focusMutableDraft('actions.ts', 2)
      chat?.focusTab()
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
      /** Names the column of the group that holds a tab. */
      const columnOf = (tab: unknown): number | undefined =>
        harness.groups.find((group) => group.tabs.some((held) => held === tab))
          ?.viewColumn

      // Act
      await harness.reader.returnToCurrent(
        {
          presentationId: selected.presentationId,
          expectedRevision: selected.reader.contentRevision,
        },
        'agent',
      )
      const live = {
        layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
        rows: harness.editorLayout(),
        applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
        actionsColumn: columnOf(learnerActions.tab),
        sourceColumn: harness.sourceColumn(),
        authColumn: columnOf(learnerAuth.tab),
      }
      await harness.reader.close()

      // Assert: three stacked rows (the Application, the captured source with actions.ts, auth.ts) while the run is live; after Close the learner's two groups stand stacked again with the sizes they had.
      assert.deepEqual(
        {
          ...live,
          rows: {
            orientation: (live.rows as { orientation: number }).orientation,
            nested: (
              live.rows as { groups: { groups?: unknown }[] }
            ).groups.some((group) => group.groups !== undefined),
            count: (live.rows as { groups: unknown[] }).groups.length,
          },
          afterClose: harness.editorLayout(),
        },
        {
          layoutConfirmed: true,
          rows: { orientation: 1, nested: false, count: 3 },
          applicationColumn: 1,
          actionsColumn: 2,
          sourceColumn: 2,
          authColumn: 3,
          afterClose: situation.layoutAfterClose,
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the way back to the live run on row 626's path in VS Code (Developer: Reload Window, the learner resized the stacked groups so the earlier window's record proves nothing, the cold Study select put the Application into the unproven leftover) when the editor removes the leftover the Application's move emptied only a moment after that move, as VS Code 1.140.0 did about 130 ms later in C58 round 1d (it closes the moved webview's old editor from `onWillOpenEditor` and awaits that close's confirmation before it removes the group: workbench.desktop.main.js 4037:7120, 1106:79300, 1106:79400, 1106:80531); the Return follows that removal as its own move's effect, reaches the live run stacked, and Close gives the learner's groups back stacked; fails_when=the reservation's placement guard, taken before the late removal, reads the editor's own removal as a learner's change and the Return is refused with "Native pane, group or focus changed while presentation waited; the learner arrangement was preserved." (C58 rounds c58-vs-1d and c58-vs-1d2; C57 reached the live run); why_new=Cycle 0046 row 658; seam=applicationGroupMarkers (a record the resized grid no longer equals), leaveEmptyLockedGroup, closeEmptyGroupsAfterPanelMove with removeGroupLeftByPanelMoveLater, the reader's agent select and returnToCurrent, close, editorLayout, automaticallyClosedColumns and harness.groups
test("in VS Code, an agent's Return Current after a reload whose record no longer proves the leftover follows the editor's late removal of the leftover the Application's move emptied, reaches the live run stacked, and Close gives the learner's groups back stacked", async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of three equal rows; after the reload that group stands empty and locked, and the learner grew the second row twice. actions.ts is in the second row and auth.ts in the third. The editor removes a group a pane's move emptied 130 ms after the move. The agent selected the Study cold, which put the Application into the leftover.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
  })
  harness.closeEmptyGroupsAfterPanelMove()
  harness.removeGroupLeftByPanelMoveLater()
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
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    const learnerAuth = harness.focusMutableDraft('auth.ts', 3)
    const learnerActions = harness.focusMutableDraft('actions.ts', 2)
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
    /** Names the column of the group that holds a tab. */
    const columnOf = (tab: unknown): number | undefined =>
      harness.groups.find((group) => group.tabs.some((held) => held === tab))
        ?.viewColumn

    // Act
    const answer = await harness.reader
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
    const live = {
      answer,
      layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      leftoverGone: !harness.groups.includes(leftover),
      removedColumns: harness.automaticallyClosedColumns(),
      rows: harness.editorLayout(),
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      actionsColumn: columnOf(learnerActions.tab),
      sourceColumn: harness.sourceColumn(),
      authColumn: columnOf(learnerAuth.tab),
    }
    await harness.reader.close()

    // Assert: the Return answered, the editor removed the leftover at column 2 after the move, three stacked rows (the Application, the captured source with actions.ts, auth.ts) stand while the run is live, and after Close the learner's two groups stand stacked again with the sizes they had.
    assert.deepEqual(
      {
        ...live,
        rows: {
          orientation: (live.rows as { orientation: number }).orientation,
          nested: (live.rows as { groups: { groups?: unknown }[] }).groups.some(
            (group) => group.groups !== undefined,
          ),
          count: (live.rows as { groups: unknown[] }).groups.length,
        },
        afterClose: harness.editorLayout(),
      },
      {
        answer: 'returned',
        layoutConfirmed: true,
        leftoverGone: true,
        removedColumns: [2],
        rows: { orientation: 1, nested: false, count: 3 },
        applicationColumn: 1,
        actionsColumn: 2,
        sourceColumn: 2,
        authColumn: 3,
        afterClose: { orientation: 1, groups: [{ size: 349 }, { size: 109 }] },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own change of the editor groups while the Return waits for the editor's late removal of the leftover the Application's move emptied (row 658): a group the learner adds then is no effect of Codebook's move, and the Return refuses instead of arranging around it; fails_when=the wait takes every group change before the removal for the editor's own, so the learner's new group is stacked into the live arrangement or refused only later with another cause; why_new=Cycle 0046 row 658 (the bound of its fix); seam=applicationGroupMarkers, leaveEmptyLockedGroup, closeEmptyGroupsAfterPanelMove with removeGroupLeftByPanelMoveLater, the reader's agent select and returnToCurrent, the fake editor's workbench.action.newGroupAbove run as the learner, panelColumn and harness.groups
test("in VS Code, a group the learner adds while an agent's Return Current waits for the editor's late removal of the emptied leftover refuses the Return as a learner's change", async () => {
  // Arrange: as in the late-removal round above; the agent selected the Study cold, which put the Application into the unproven leftover.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
  })
  harness.closeEmptyGroupsAfterPanelMove()
  harness.removeGroupLeftByPanelMoveLater()
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
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('actions.ts', 2)
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

    // Act: the agent's Return moves the Application out of the leftover; before the editor removes the emptied leftover, the learner runs New Group Above in the Application's new group.
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
        harness.groups.includes(leftover) &&
        leftover.tabs.length === 0,
      "the Application's move out of the leftover",
    )
    await harness.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )

    // Assert: the Return is refused as a learner's change.
    assert.equal(
      await answer,
      'Error: Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own choice while an agent's Return Current waits for the editor's late removal of the leftover the Application's move emptied (row 658): a click into their auth.ts, or a page they bring to the front of auth.ts's group, is no effect of Codebook's move, and the Return refuses as a learner's change instead of arranging over it; fails_when=only the groups are compared during the move and the wait, so the learner's focus or front tab is taken into the placement guard taken after them and the Return goes on; why_new=Cycle 0046 row 670; seam=applicationGroupMarkers, leaveEmptyLockedGroup, closeEmptyGroupsAfterPanelMove with removeGroupLeftByPanelMoveLater, the reader's agent select and returnToCurrent, focusMutableDraft's focus (the learner's click), addOpaqueTab with focusOpaqueTab (the learner's tab), panelColumn and harness.groups
for (const change of ['focus', 'tab'] as const)
  test(`in VS Code, a learner's ${change === 'focus' ? 'click into their file' : 'tab brought to the front of their group'} while an agent's Return Current waits for the editor's late removal of the emptied leftover refuses the Return as a learner's change`, async () => {
    // Arrange: as in the late-removal round above; the agent selected the Study cold, which put the Application into the unproven leftover.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
    })
    harness.closeEmptyGroupsAfterPanelMove()
    harness.removeGroupLeftByPanelMoveLater()
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
      const leftover = harness.groups.find((group) => group.viewColumn === 1)!
      const learnerAuth = harness.focusMutableDraft('auth.ts', 3)
      harness.focusMutableDraft('actions.ts', 2)
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

      // Act: the agent's Return moves the Application out of the leftover; before the editor removes the emptied leftover, the learner clicks into auth.ts, or brings a page of their own to the front of auth.ts's group.
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
          harness.groups.includes(leftover) &&
          leftover.tabs.length === 0,
        "the Application's move out of the leftover",
      )
      const authColumn = harness.groups.find((group) =>
        group.tabs.includes(learnerAuth.tab),
      )!.viewColumn
      if (change === 'focus') learnerAuth.focus()
      else
        harness.focusOpaqueTab(
          harness.addOpaqueTab('Release notes', authColumn),
        )

      // Assert: the Return is refused as a learner's change.
      assert.equal(
        await answer,
        'Error: Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner's groups from Codebook's lock: when Cursor activates the group that held the keyboard before the Return's new Application group was inserted (the learner's first group, whose Application pane the reservation focused) again before the lock reaches it, the lock without argument locks that learner group (C57 round 1b: the new Application group stood unlocked above the learner's locked group, which stayed locked after Close); the reservation now finds the tab model naming that group as the lock answers, unlocks it, focuses the new group and locks that one, so only the Application's own group is locked and Close leaves no group locked; fails_when=the lock's target is taken on trust from the naming before the lock, so a learner's group stays locked through Close and into the next rounds; why_new=Cycle 0046 row 644; seam=useNativeLayout, addSeparateEditorPart (Cursor's chat part), reactivatePreviousGroupBeforeLock, the reader's agent select and returnToCurrent, close, the groups' lock flags and the command log
test("in Cursor, an agent's Return Current whose lock reaches the learner's group Cursor activated again locks only the Application's own group, and Close leaves no group locked", async () => {
  // Arrange: actions.ts in the first group and auth.ts in the second; the agent selected the Study from Cursor's chat, which put the Application pane into the first group. Cursor will activate that group again before the Return's lock arrives.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const learnerAuth = harness.focusMutableDraft('auth.ts', 2)
    const learnerActions = harness.focusMutableDraft('actions.ts', 1)
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
    chat.focusTab()
    harness.reactivatePreviousGroupBeforeLock()
    const selected = harness.reader.presentationState()
    /** Says whether the group that holds a tab is locked. */
    const lockedWith = (tab: unknown): boolean | undefined =>
      harness.groups.find((group) => group.tabs.some((held) => held === tab))
        ?.locked
    const lockedGroups = (): number[] =>
      harness.groups
        .filter((group) => group.locked)
        .map((group) => group.viewColumn)

    // Act
    await harness.reader.returnToCurrent(
      {
        presentationId: selected.presentationId,
        expectedRevision: selected.reader.contentRevision,
      },
      'agent',
    )
    const live = {
      layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      lockedColumns: lockedGroups(),
      actionsGroupLocked: Boolean(lockedWith(learnerActions.tab)),
      authGroupLocked: Boolean(lockedWith(learnerAuth.tab)),
    }
    await harness.reader.close()

    // Assert: during the live run only the Application's own group at column 1 is locked; after Close no group is locked.
    assert.deepEqual(
      { ...live, lockedAfterClose: lockedGroups() },
      {
        layoutConfirmed: true,
        applicationColumn: 1,
        lockedColumns: [1],
        actionsGroupLocked: false,
        authGroupLocked: false,
        lockedAfterClose: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's groups from Codebook's lock when another group is the active one by the time the reservation acts on its lock's answer: the lock reached the learner's actions.ts group Cursor activated again (row 644), and auth.ts's group became the active one right after; the reservation takes the lock off the group the lock changed, whichever group is active then, and locks only the Application's own group, so Close leaves no group locked and auth.ts's group is never touched; fails_when=the unlock acts only while the group it read as changed is still the active one, so the learner's actions.ts group stays locked through the live run and Close; why_new=Cycle 0046 row 668; seam=useNativeLayout, addSeparateEditorPart (Cursor's chat part), reactivatePreviousGroupBeforeLock, activateGroupOfTabAfterNextLock, the reader's agent select and returnToCurrent, close, the groups' lock flags and the command log
test("in Cursor, an agent's Return Current whose lock reached the learner's group takes that lock off again although another learner group is the active one by then, and Close leaves no group locked", async () => {
  // Arrange: actions.ts in the first group and auth.ts in the second; the agent selected the Study from Cursor's chat. Cursor will activate the actions.ts group again before the Return's lock arrives, and the auth.ts group right after the lock answered.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const learnerAuth = harness.focusMutableDraft('auth.ts', 2)
    const learnerActions = harness.focusMutableDraft('actions.ts', 1)
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
    chat.focusTab()
    harness.reactivatePreviousGroupBeforeLock()
    harness.activateGroupOfTabAfterNextLock(learnerAuth.tab)
    const selected = harness.reader.presentationState()
    /** Says whether the group that holds a tab is locked. */
    const lockedWith = (tab: unknown): boolean | undefined =>
      harness.groups.find((group) => group.tabs.some((held) => held === tab))
        ?.locked
    const lockedGroups = (): number[] =>
      harness.groups
        .filter((group) => group.locked)
        .map((group) => group.viewColumn)
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.returnToCurrent(
      {
        presentationId: selected.presentationId,
        expectedRevision: selected.reader.contentRevision,
      },
      'agent',
    )
    const live = {
      layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      lockedColumns: lockedGroups(),
      actionsGroupLocked: Boolean(lockedWith(learnerActions.tab)),
      authGroupLocked: Boolean(lockedWith(learnerAuth.tab)),
      unlockCommands: harness.commands
        .slice(commandsBefore)
        .filter((command) => command === 'workbench.action.unlockEditorGroup')
        .length,
    }
    await harness.reader.close()

    // Assert: during the live run only the Application's own group at column 1 is locked, after one unlock of the actions.ts group; after Close no group is locked.
    assert.deepEqual(
      { ...live, lockedAfterClose: lockedGroups() },
      {
        layoutConfirmed: true,
        applicationColumn: 1,
        lockedColumns: [1],
        actionsGroupLocked: false,
        authGroupLocked: false,
        unlockCommands: 1,
        lockedAfterClose: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a lock the learner set on their own group (View: Lock Editor Group) when an agent's Return Current locks its new Application group and Cursor names the learner's group as the active one only after that lock reached the new group: the tab model the lock sends names the new group, so the learner's group keeps its lock through the live run and Close; fails_when=the reservation takes the group Cursor names after the lock for the group the lock reached (row 644's reading) and unlocks it because it holds a learner's tab, removing a lock Codebook never set; why_new=Cycle 0046 row 650; seam=useNativeLayout, addSeparateEditorPart (Cursor's chat part), lockGroupAsLearner, reactivatePreviousGroupAfterInsertion (Cursor names the group that had the keyboard again as the lock settles), the reader's agent select and returnToCurrent, close, the groups' lock flags and the command log
test("in Cursor, an agent's Return Current whose lock reached the new Application group keeps the lock the learner set on their own group that Cursor names afterwards, through Close", async () => {
  // Arrange: actions.ts in the first group and auth.ts in the second; the agent selected the Study from Cursor's chat, and the learner then locked the group that shows actions.ts. Cursor will name the group that held the keyboard before the Return's insertion again only after the lock reached the new group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const learnerAuth = harness.focusMutableDraft('auth.ts', 2)
    const learnerActions = harness.focusMutableDraft('actions.ts', 1)
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
    /** Says whether the group that holds a tab is locked. */
    const lockedWith = (tab: unknown): boolean | undefined =>
      harness.groups.find((group) => group.tabs.some((held) => held === tab))
        ?.locked
    const actionsColumn = harness.groups.find((group) =>
      group.tabs.includes(learnerActions.tab),
    )!.viewColumn
    harness.lockGroupAsLearner(actionsColumn)
    chat.focusTab()
    harness.reactivatePreviousGroupAfterInsertion()
    const selected = harness.reader.presentationState()
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.returnToCurrent(
      {
        presentationId: selected.presentationId,
        expectedRevision: selected.reader.contentRevision,
      },
      'agent',
    )
    const live = {
      layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      applicationGroupLocked: Boolean(
        harness.groups.find((group) => group.viewColumn === 1)?.locked,
      ),
      actionsGroupLocked: Boolean(lockedWith(learnerActions.tab)),
      authGroupLocked: Boolean(lockedWith(learnerAuth.tab)),
      unlockCommands: harness.commands
        .slice(commandsBefore)
        .filter((command) => command === 'workbench.action.unlockEditorGroup')
        .length,
    }
    await harness.reader.close()

    // Assert: the Application's own group at column 1 and the learner's actions.ts group are locked during the live run, and no unlock ran during the Return; after Close the learner's lock is still there.
    assert.deepEqual(
      {
        ...live,
        actionsGroupLockedAfterClose: Boolean(lockedWith(learnerActions.tab)),
        authGroupLockedAfterClose: Boolean(lockedWith(learnerAuth.tab)),
      },
      {
        layoutConfirmed: true,
        applicationColumn: 1,
        applicationGroupLocked: true,
        actionsGroupLocked: true,
        authGroupLocked: false,
        unlockCommands: 0,
        actionsGroupLockedAfterClose: true,
        authGroupLockedAfterClose: false,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a lock the learner set on their own group when Cursor activates that group again before the Return's lock reaches the editor: the lock lands on that group, which was locked already, so it changes nothing and the editor sends no tab model; the learner's lock stays, and the new Application group is focused and locked; fails_when=the reservation unlocks the group the tab model names after the lock without proof that the lock changed it, removing the learner's own lock; why_new=Cycle 0046 row 650 (the other order of row 644's race); seam=useNativeLayout, addSeparateEditorPart, lockGroupAsLearner, reactivatePreviousGroupBeforeLock, the reader's agent select and returnToCurrent, close and the groups' lock flags
test("in Cursor, an agent's Return Current whose lock reaches the learner's own locked group Cursor activated again keeps the learner's lock and locks the Application's own group", async () => {
  // Arrange: as above, but Cursor activates the learner's locked actions.ts group again before the lock arrives.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const learnerAuth = harness.focusMutableDraft('auth.ts', 2)
    const learnerActions = harness.focusMutableDraft('actions.ts', 1)
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
    /** Says whether the group that holds a tab is locked. */
    const lockedWith = (tab: unknown): boolean | undefined =>
      harness.groups.find((group) => group.tabs.some((held) => held === tab))
        ?.locked
    const actionsColumn = harness.groups.find((group) =>
      group.tabs.includes(learnerActions.tab),
    )!.viewColumn
    harness.lockGroupAsLearner(actionsColumn)
    chat.focusTab()
    harness.reactivatePreviousGroupBeforeLock()
    const selected = harness.reader.presentationState()

    // Act
    await harness.reader.returnToCurrent(
      {
        presentationId: selected.presentationId,
        expectedRevision: selected.reader.contentRevision,
      },
      'agent',
    )
    const live = {
      layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      applicationGroupLocked: Boolean(
        harness.groups.find((group) => group.viewColumn === 1)?.locked,
      ),
      actionsGroupLocked: Boolean(lockedWith(learnerActions.tab)),
      authGroupLocked: Boolean(lockedWith(learnerAuth.tab)),
    }
    await harness.reader.close()

    // Assert: the Application's own group and the learner's actions.ts group are locked during the live run; after Close only the learner's lock is left.
    assert.deepEqual(
      {
        ...live,
        actionsGroupLockedAfterClose: Boolean(lockedWith(learnerActions.tab)),
        authGroupLockedAfterClose: Boolean(lockedWith(learnerAuth.tab)),
      },
      {
        layoutConfirmed: true,
        applicationColumn: 1,
        applicationGroupLocked: true,
        actionsGroupLocked: true,
        authGroupLocked: false,
        actionsGroupLockedAfterClose: true,
        authGroupLockedAfterClose: false,
      },
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

    // Assert: the leftover group is gone and its record forgotten, replaced by this window's record of the Context group its Study created (finding 599); both learner files keep their tabs, and the Application stands in column 1.
    assert.equal(harness.groups.includes(leftover), false)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      {
        ...marker,
        writer:
          marker?.writer === harness.reader['applicationGroupMarkerWriter'],
      },
      {
        version: 1,
        writer: true,
        column: 3,
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

      // Assert: the leftover group is gone and its record forgotten, replaced by the new window's record of the Source and Context groups its Study created (finding 599); the new window's Application stands in column 1 with the layout confirmed.
      assert.equal(harness.groups.includes(leftover), false)
      const marker = harness.applicationGroupMarkers.get(
        'codebook.applicationGroup.v1',
      ) as { writer?: unknown } | undefined
      assert.deepEqual(
        {
          ...marker,
          writer: marker?.writer === nextWindow['applicationGroupMarkerWriter'],
        },
        {
          version: 2,
          writer: true,
          columns: [2, 3],
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

    // Assert: the claimed group, still locked at column 1, now holds the Study Context, and the record the preparation wrote for it stays, at the three-group grid the Open confirmed, beside the Source group that Open created at column 3 (finding 599).
    assert.equal(harness.groups.includes(claimedGroup), true)
    assert.equal(claimedGroup.locked, true)
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
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
  // Value: protects=the learner's window after Close of a Living book Open beside no chat part, whose captured source the editor gave a group of its own at column 3; fails_when=nothing tracks the group that source display created, so Close leaves it empty beside the learner's group when the editor keeps emptied groups (workbench.editor.closeEmptyGroups off), or any other group Codebook created stays; why_new=Cycle 0046 finding 597 (finding 597's observation 3: without the chat's part no reservation precedes the source display, and showTextDocument at a column beyond the grid creates that group); seam=presentation.createViewport (the MCP-first preparation), the fake editor's own group for a text shown beyond the grid, closeDisposedPanelTabsLater for the editor that removes emptied groups
  test(`Close after a Living book Open beside no chat part leaves no group Codebook created, in an editor that ${editor.keeps} emptied groups`, async () => {
    // Arrange: an MCP run prepared the Application at column 1 beside the learner's group; the Living book Open shows the captured source at column 3, where the editor gives it a group of its own.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    harness.focusMutableDraft()
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

// Value: protects=the next Study action after an Application preparation that failed inside the layout queue: the failed preparation's cleanup disposed the pane it created, and the editor's dispose event, which both extension hosts fire inside dispose() before the pane leaves the editor (VS Code 1.140.0 extensionHostProcess.js 295:115246, Cursor 3.23.12 203:121182), lets the reader's own pane handler forget that pane at once, so the next run prepares a new pane in a new group and acts on nothing of the disposed one; fails_when=the reader still names the disposed pane after the cleanup, so the next preparation reveals or reads it and fails, or keeps a second pane; why_new=Cycle 0046 row 672 (evidence: no reference to the disposed pane remains, this test holds the reader to it); seam=presentation.createViewport with its cancellation (an MCP-first preparation a newer run replaces), holdNextCommand('vscode.getEditorLayout'), counts and panelColumn
test('the run after an Application preparation that a newer run replaced inside the layout queue prepares a new Application pane in its own group, with nothing left of the disposed one', async () => {
  // Arrange: an MCP run prepares the Application in a group of its own; the run is replaced while the preparation reads the confirmed layout, and its cleanup disposes the pane it created.
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
  let nextViewport:
    Awaited<ReturnType<typeof reader.presentation.createViewport>> | undefined
  try {
    await gridRead.started
    finalRead = harness.holdNextCommand('vscode.getEditorLayout')
    gridRead.release()
    await finalRead.started
    preparation.abort(new Error('A newer run replaced this preparation.'))
    finalRead.release()
    const outcome = await viewport
    const afterFailure = {
      outcome: String(outcome),
      panels: harness.counts().panels,
      applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
    }

    // Act: the newer run prepares its Application.
    nextViewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
      new AbortController().signal,
    )

    // Assert: the failed preparation left no pane; the newer run's pane stands alone at column 1 in a locked group of its own.
    assert.deepEqual(afterFailure, {
      outcome: 'Error: A newer run replaced this preparation.',
      panels: 0,
      applicationColumn: undefined,
    })
    assert.deepEqual(
      {
        panels: harness.counts().panels,
        applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
        applicationGroupLocked: Boolean(
          harness.groups.find((group) => group.viewColumn === 1)?.locked,
        ),
      },
      { panels: 1, applicationColumn: 1, applicationGroupLocked: true },
    )
  } finally {
    gridRead.release()
    finalRead?.release()
    await viewport
    nextViewport?.close()
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

// Value: protects=the cancellation a refused Application preparation reports, and the record of its claimed group, when the editor refuses to close that empty group during the cleanup; fails_when=the cleanup's refused close throws its own error in place of the preparation's, or the record of a group that still stands is forgotten; why_new=Cycle 0046 finding 598 (the first repair routed the cleanup through the owned retirement, which throws on a refusal); seam=presentation.createViewport with its cancellation, holdNextCommand('vscode.getEditorLayout'), refuseNextGroupClose and applicationGroupMarkers
test('a cancelled Application preparation whose claimed group the editor refuses to close reports its cancellation and keeps the record of that group', async () => {
  // Arrange: an MCP run prepares the Application in a group of its own; the run is replaced while the preparation reads the confirmed layout, and the editor will refuse to close the claimed group.
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
    harness.refuseNextGroupClose()

    // Act: a newer run replaces this one during the final layout read.
    preparation.abort(new Error('A newer run replaced this preparation.'))
    finalRead.release()
    const outcome = await viewport

    // Assert: the preparation reports its own cancellation; the claimed group stands empty, and its record stays with it.
    assert.equal(
      String(outcome),
      'Error: A newer run replaced this preparation.',
    )
    assert.equal(harness.groups.includes(claimedGroup), true)
    assert.equal(claimedGroup.tabs.length, 0)
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
        layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
      },
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

      // Assert: both leftovers are gone and their record forgotten, replaced by the new window's record of the Source and Context groups its Study created; the new window's Application stands in column 1 with the layout confirmed.
      assert.equal(nextWindow.inspect().view!.errors.join(' | '), '')
      assert.equal(harness.groups.includes(applicationLeftover), false)
      assert.equal(harness.groups.includes(contextLeftover), false)
      const marker = harness.applicationGroupMarkers.get(
        'codebook.applicationGroup.v1',
      ) as { writer?: unknown } | undefined
      assert.deepEqual(
        {
          ...marker,
          writer: marker?.writer === nextWindow['applicationGroupMarkerWriter'],
        },
        {
          version: 2,
          writer: true,
          columns: [2, 3],
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

    // Assert: the leftover group is gone and its record forgotten, replaced by this window's record of the Context group its Study created (finding 599); both learner files keep their tabs, and the Application stands in column 1.
    assert.equal(harness.groups.includes(leftover), false)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      {
        ...marker,
        writer:
          marker?.writer === harness.reader['applicationGroupMarkerWriter'],
      },
      {
        version: 1,
        writer: true,
        column: 3,
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

    // Assert: the empty Application group is gone and the earlier record with it, replaced by this window's record of the Context group its Study created; the recorded group with the learner's file stands with its tab.
    assert.equal(harness.groups.includes(applicationLeftover), false)
    assert.equal(harness.groups.includes(readmeGroup), true)
    assert.equal(readmeGroup.tabs.includes(learnerReadme.tab), true)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      {
        ...marker,
        writer:
          marker?.writer === harness.reader['applicationGroupMarkerWriter'],
      },
      {
        version: 1,
        writer: true,
        column: 3,
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

// Value: protects=the record of the groups a Study Open created beside the learner's one group, without any reservation of the Application's group (the Application shares the learner's group); fails_when=only a reservation starts the record, so the created Source and Context groups a reload leaves empty are never named, or the created Source group is left out; why_new=Cycle 0046 finding 599 (observations 1 and 2 of its first repair: no record without a reservation, and the created Source group unnamed); seam=applicationGroupMarkers
test('a Study Open without an Application reservation records the Source and Context groups it created at the layout it confirmed', async () => {
  // Arrange: the learner has one editor group; the Application will share it.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    // Act
    await harness.reader.open()

    // Assert: the Source group at column 2 and the Context group at column 3, in the confirmed three-group Study grid, written by this reader.
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      {
        ...marker,
        writer:
          marker?.writer === harness.reader['applicationGroupMarkerWriter'],
      },
      {
        version: 2,
        writer: true,
        columns: [2, 3],
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

for (const editor of [
  { keeps: 'keeps', removesEmptiedGroups: false },
  { keeps: 'removes', removesEmptiedGroups: true },
] as const)
  // Value: protects=a cold Study select after a window reload of a Study Open that created the Source and Context groups beside the learner's group: the restored captured source stands alone in the Source group, the Context group is empty; fails_when=the cold entry closes the restored captured source first, so an editor that removes emptied groups (workbench.editor.closeEmptyGroups on) shrinks the grid and the Context group can no longer be proved, or the Source group an editor keeps stays empty; why_new=Cycle 0046 finding 599 (observation 2 of its first repair); seam=applicationGroupMarkers (the record of the window before the reload), leaveEmptyGroup, restoreLeftoverCapturedSource and closeDisposedPanelTabsLater for the editor that removes emptied groups
  test(`a cold Study select after a reload retires the recorded Source group with its restored captured source and the empty Context group, in an editor that ${editor.keeps} emptied groups`, async () => {
    // Arrange: the window before the reload recorded its Source group at column 2 and its Context group at column 3; after the reload the learner's file stands in column 1, the captured source is restored without an editor in column 2, and column 3 is empty.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 0.55, groups: [{}, {}] }, { size: 0.45 }],
    })
    if (editor.removesEmptiedGroups) harness.closeDisposedPanelTabsLater()
    try {
      harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
        version: 2,
        writer: 'the window before the reload',
        columns: [2, 3],
        groupCount: 3,
        layout: {
          orientation: 0,
          groups: [
            { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 0.45 },
          ],
        },
      })
      harness.leaveEmptyGroup(2)
      const restoredSource = harness.restoreLeftoverCapturedSource({
        column: 2,
        active: false,
      })
      const sourceLeftover = harness.groups.find(
          (group) => group.viewColumn === 2,
        )!,
        contextLeftover = harness.groups.find(
          (group) => group.viewColumn === 3,
        )!,
        learnersGroup = harness.groups.find((group) => group.viewColumn === 1)!
      const learnersTabs = [...learnersGroup.tabs]
      const state = harness.reader.presentationState()

      // Act
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })

      // Assert: both leftovers and the restored captured source are gone, the learner's file keeps its group, and the earlier window's record is replaced by this window's own.
      assert.equal(harness.groups.includes(sourceLeftover), false)
      assert.equal(harness.groups.includes(contextLeftover), false)
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(restoredSource)),
        false,
      )
      assert.equal(
        learnersTabs.every((tab) => learnersGroup.tabs.includes(tab)),
        true,
      )
      assert.notEqual(
        (
          harness.applicationGroupMarkers.get(
            'codebook.applicationGroup.v1',
          ) as { writer?: unknown } | undefined
        )?.writer,
        'the window before the reload',
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=a cold Study select after a window reload whose focused tab is the earlier session's restored captured source, in an editor that removes emptied groups (workbench.editor.closeEmptyGroups on, the default); fails_when=the selection closes that leftover tab before the recorded leftovers are retired, the editor removes the Source group with it, the grid no longer equals the record, and the Application's and Context's leftovers stay unproven (row 590's failure); why_new=Cycle 0046 row 608; seam=applicationGroupMarkers (the record of the window before the reload), leaveEmptyLockedGroup, leaveEmptyGroup, restoreLeftoverCapturedSource (focused) and closeDisposedPanelTabsLater
test('a cold Study select after a reload with the restored captured source focused retires every recorded leftover before that tab closes, and Close gives the learner’s group back', async () => {
  // Arrange: the window before the reload recorded its Application group at column 1, its Source group at column 3 and its Context group at column 4; after the reload the learner's notes stand in column 2, the restored captured source has the keyboard in column 3, and the editor removes a group its last tab left.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}, {}] })
  harness.closeDisposedPanelTabsLater()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 2,
      writer: 'the window before the reload',
      columns: [1, 3, 4],
      groupCount: 4,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    const restoredSource = harness.restoreLeftoverCapturedSource({ column: 3 })
    const [applicationLeftover, , sourceLeftover, contextLeftover] =
      harness.groups
    const state = harness.reader.presentationState()

    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the three leftovers and the restored captured source are gone before any pane is placed, and the Application stands in column 1 beside the learner's notes with the layout confirmed.
    const leftoversAfterSelect = [
      applicationLeftover,
      sourceLeftover,
      contextLeftover,
    ].filter((group) => harness.groups.includes(group!))
    assert.deepEqual(leftoversAfterSelect, [])
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(restoredSource)),
      false,
    )
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.layoutConfirmed, true)
    // Close then gives the learner's group back, alone with its notes.
    await harness.reader.close()
    assert.deepEqual(
      harness.groups.map((group) => group.tabs),
      [[learnerNotes.tab]],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard and the recorded leftovers at a cold Study select made from Cursor's chat after an extension-host restart left a dead Study pane in the earlier window's Context group, in an editor that removes emptied groups; fails_when=the selection closes the dead pane before the leftovers are retired, so the grid shrinks and nothing is proved, or the retirement's focus commands take the keyboard from the chat before the selection captured it, so the chat does not get it back; why_new=Cycle 0046 row 608; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, leaveDeadCodebookPane, addSeparateEditorPart with the chat's focusTab, and closeDisposedPanelTabsLater
test('a cold Study select from the chat beside a dead pane in a recorded group retires the recorded leftovers first and gives the chat its keyboard back', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 and its Context group at column 3; the old host's Study pane is left dead in column 3, the learner's notes stand in column 2, and the chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  harness.closeDisposedPanelTabsLater()
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
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    const deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    chat.focusTab()
    const state = harness.reader.presentationState()

    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: both leftovers and the dead pane are gone, the Application stands in column 1 with the layout confirmed, and the chat has the keyboard again.
    assert.equal(harness.groups.includes(applicationLeftover), false)
    assert.equal(harness.groups.includes(contextLeftover), false)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(deadStudy)),
      false,
    )
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold Study select in Cursor after a reload, where a dead pane of the earlier host that the editor will not close stands in a learner's group beside the earlier window's recorded leftover: the leftover's retirement makes Cursor build every tab object anew, and the selection still ends with the instruction to close the dead pane before any panel exists; fails_when=the close after the retirement requests and counts the tab objects read before it, which are in no group any more, so the dead pane is never requested, is counted as closed, and the Study opens beside it (Cycle 0046 OCR1-1); why_new=Cycle 0046 OCR1-1; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, leaveDeadCodebookPane with refuseClose, focusMutableDraft, replaceGroupObjectsOnTabChanges and rebuildTabObjectsAtGroupRemoval (Cursor's new tab objects after a removed group), counts and harness.groups
test('in Cursor, a cold Study select after a reload that retired the earlier window’s leftover group still refuses beside a dead pane the editor keeps, though the retirement made every tab object new', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked; the old host's Repository Wiki pane, which the editor will not close, is left dead in column 2 behind the learner's notes, which have the keyboard. The editor is Cursor: a removed group brings new group and tab objects.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.replaceGroupObjectsOnTabChanges()
  harness.rebuildTabObjectsAtGroupRemoval()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.leaveDeadCodebookPane('codebook.repositoryWiki', 2, {
      refuseClose: true,
    })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const state = harness.reader.presentationState()

    // Act
    const answer = await harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        () => 'selected',
        (error: unknown) => (error instanceof Error ? error.message : error),
      )

    // Assert: the leftover group is gone, the selection tells the learner to close the dead pane, no panel was created, and the dead pane is still the one tab of the Repository Wiki.
    assert.deepEqual(
      {
        answer,
        groupCount: harness.groups.length,
        panels: harness.counts().panels,
        deadWikiTabs: harness.groups
          .flatMap((group) => group.tabs)
          .filter((tab) => tab.label === 'codebook · Repository Wiki').length,
      },
      {
        answer:
          'A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        groupCount: 1,
        panels: 0,
        deadWikiTabs: 1,
      },
    )
  } finally {
    harness.acceptDeadPaneClose()
    await harness.close()
  }
})

// Value: protects=the chat's keyboard when an agent's cold Study select in Cursor after a reload ends because the editor refuses to close the earlier window's leftover group: the proof focused that group before the close, so the chat gets its keyboard back before the refusal reaches the agent, and the learner is told once why, without saying that the groups closed; fails_when=the proof's fact that it took the keyboard is lost with the throw, so the selection gives nothing back and tells nothing, and the keyboard stays in the leftover group (Cycle 0046 OCR1-2); why_new=Cycle 0046 OCR1-2; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, refuseNextGroupClose, the reader's changePresentation for an agent, the command log and the information messages
test('in Cursor, an agent’s cold Study select from the chat whose leftover group the editor refuses to close gives the chat its keyboard back and says once that Codebook could not close the groups', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked beside the learner's notes; Cursor's chat has the keyboard, and the editor will refuse to close the leftover group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()
    harness.refuseNextGroupClose()
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    const answer = await harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      .then(
        () => 'selected',
        (error: unknown) => String(error),
      )

    // Assert: the selection is refused, the proof focused the leftover and Focus Agent gave the chat its keyboard back, and the learner is told once that the groups could not be closed.
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter(
            (command) =>
              command.startsWith('workbench.action.focus') ||
              command === 'composer.focusComposer',
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        answer:
          'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook gave the keyboard back to the chat after it could not close the editor groups an earlier window had left: proving them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard when an agent's cold Study select in Cursor after a reload meets a dead pane of the earlier host, so the selection closes the leftover tabs itself, and the editor refuses to close the earlier window's leftover group: the proof focused that group before the close, so the chat gets its keyboard back before the refusal reaches the agent, and the learner is told once why; fails_when=the close of the leftover tabs throws with the proof's fact that it took the keyboard, so the selection's own give-back after that close never runs (Cycle 0046 OCR1-2); why_new=Cycle 0046 OCR1-2; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, leaveDeadCodebookPane, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, refuseNextGroupClose, the reader's changePresentation for an agent and the information messages
test('in Cursor, an agent’s cold Study select from the chat beside a dead pane, whose leftover group the editor refuses to close, gives the chat its keyboard back and says once that Codebook could not close the groups', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked; the old host's Repository Wiki pane is left dead in column 2 behind the learner's notes; Cursor's chat has the keyboard, and the editor will refuse to close the leftover group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.leaveDeadCodebookPane('codebook.repositoryWiki', 2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()
    harness.refuseNextGroupClose()
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    const answer = await harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      .then(
        () => 'selected',
        (error: unknown) => String(error),
      )

    // Assert: the selection reports the refused close, the chat has the keyboard again, and the learner is told once that the groups could not be closed.
    assert.deepEqual(
      {
        answer,
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        chatHasKeyboard: true,
        messages: [
          'Codebook gave the keyboard back to the chat after it could not close the editor groups an earlier window had left: proving them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard when an agent's first run in Cursor after a reload, before any Study select, fails because the editor refuses to close the earlier window's leftover group: the proof focused that group before the close, so the chat gets its keyboard back before the preparation's refusal reaches the run, and the learner is told once why; fails_when=the retirement before the preparation loses the fact that its proof took the keyboard with the throw, so no return is owed and the keyboard stays in the leftover group without a word (Cycle 0046 OCR1-2); why_new=Cycle 0046 OCR1-2; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, refuseNextGroupClose, presentation.createViewport (the MCP-first preparation) and the information messages
test('in Cursor, the first Application preparation of a reloaded window whose leftover group the editor refuses to close gives the chat its keyboard back before the run fails', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked beside the learner's notes; Cursor's chat has the keyboard, and the editor will refuse to close the leftover group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()
    harness.refuseNextGroupClose()

    // Act
    let answer: string
    try {
      const viewport = await harness.reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      )
      viewport.close()
      answer = 'prepared'
    } catch (error) {
      answer = String(error)
    }

    // Assert: the run's preparation reports the refused close, the chat has the keyboard again, and the learner is told once that the groups could not be closed.
    assert.deepEqual(
      {
        answer,
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        chatHasKeyboard: true,
        messages: [
          'Codebook gave the keyboard back to the chat after it could not close the editor groups an earlier window had left: proving them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload meets an empty group at the column the earlier window recorded, in a grid the learner resized since, so the record proves nothing: the proof that focused that group gives the learner's file its keyboard back at once, and the record stays, as a failed proof forgets nothing (finding 599); fails_when=the failed proof leaves the keyboard in the empty group (its caller gives a keyboard back only to a chat), and since the record stays, every later cold entry takes the keyboard from the learner's file the same way (Cycle 0046 CR5-4); why_new=Cycle 0046 CR5-4; seam=useNativeLayout (three columns the learner resized), applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, the reader's open, the command log
test('a cold Study open after a reload whose resized grid no longer proves the earlier window’s record gives the learner’s file its keyboard back right after the proof', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of three equal columns; after the reload that group stands empty and locked, the learner widened the second column, and the learner's notes there have the keyboard beside auth.ts in the third.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 300 }, { size: 600 }, { size: 300 }],
  })
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
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('learner-notes.ts', 2)
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.open()

    // Assert: the proof focused the empty group, and the second group's focus command gave the notes their keyboard back right after it; the earlier window's record stays for a later proof.
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      {
        firstFocusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => command.startsWith('workbench.action.focus'))
          .slice(0, 2),
        earlierRecordKept: marker?.writer === 'the window before the reload',
      },
      {
        firstFocusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusSecondEditorGroup',
        ],
        earlierRecordKept: true,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group and the editor then refuses to close it: the proof's focus command took the keyboard from the learner's notes, and the notes get it back before the refusal reaches the learner, as after a proof that failed without a throw; fails_when=only the path without an exception gives a text editor its keyboard back, and the chat's give-back the throw runs is none while a text editor had the keyboard, so the keyboard stays in the unlocked leftover group (Cycle 0046 P2CR-1); why_new=Cycle 0046 P2CR-1; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, refuseNextGroupClose, the reader's open, the command log and the active text editor
test('a cold Study open after a reload whose leftover group the editor refuses to close gives the learner’s file its keyboard back before the refusal', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands empty and locked beside the learner's notes, which have the keyboard, and the editor will refuse to close the leftover group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.refuseNextGroupClose()
    const commandsBefore = harness.commands.length

    // Act
    const answer = await harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )

    // Assert: the open reports the refused close, the proof focused the leftover group, and the second group's focus command gave the notes their keyboard back right after it.
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusSecondEditorGroup',
        ],
        keyboardEditor: { name: 'learner-notes.ts', column: 2 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, the learner clicks into a file of a third group while the editor's answer to the group's close is pending, and the editor then refuses the close: the file the learner clicked into keeps the keyboard; fails_when=the give-back after a proof that threw checks only that the notes it took the keyboard from are still in front of their group, so the second group's focus command takes the keyboard from the file the learner moved to (Cycle 0047 row 44); why_new=Cycle 0047 row 44 (P3dCR-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft and its focus, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active text editor; no_claim=a move to the terminal or a view, which the editor does not report
test('a cold Study open after a reload whose leftover group the editor refuses to close leaves the keyboard in the file the learner clicked into while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of three equal columns; after the reload that group stands empty and locked, the learner's notes in the second group have the keyboard beside auth.ts in the third, and the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
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
    harness.leaveEmptyGroup(2)
    const authFile = harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: the learner clicks into auth.ts while the editor's answer to the close is pending.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    authFile.focus()
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, no focus command ran after the learner's click, and auth.ts keeps the keyboard.
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        keyboardEditor: { name: 'auth.ts', column: 3 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, the learner focuses a page that is no text editor in a third group while the editor's answer to the group's close is pending, and the editor then refuses the close: that page keeps the keyboard; fails_when=the give-back after a proof that threw reads no change of the named group, so the second group's focus command takes the keyboard from the page the learner moved to, where no text editor reports the move (Cycle 0047 row 44); why_new=Cycle 0047 row 44 (P3dCR-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addOpaqueTab, focusOpaqueTab, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active tab group; no_claim=a move to the terminal or a view, which the editor does not report
test('a cold Study open after a reload whose leftover group the editor refuses to close leaves the keyboard on the page the learner focused in another group while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of three equal columns; after the reload that group stands empty and locked, the learner's notes in the second group have the keyboard, an extension page stands in the third, and the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
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
    harness.leaveEmptyGroup(2)
    const extensionPage = harness.addOpaqueTab('Extension page', 3)
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: the learner clicks the extension page's tab while the editor's answer to the close is pending.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.focusOpaqueTab(extensionPage)
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, no focus command ran after the learner's click, and the third group with the extension page in front is still the active one.
    const activeGroup = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        activeGroup: {
          column: activeGroup.viewColumn,
          tab: activeGroup.activeTab?.label,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        activeGroup: { column: 3, tab: 'Extension page' },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, which still shows the earlier session's restored captured sources, the learner selects another of those captured sources in that group while the editor's answer to the group's close is pending, and the editor then refuses the close: the captured source the learner selected keeps the keyboard; fails_when=the give-back takes no captured source for a move of the learner's, so a selection in a group the proof may name (the leftover's own, or the one named before the proof) is not seen and the second group's focus command takes the keyboard from it (Cycle 0047 row 99); why_new=Cycle 0047 row 99 (CR1-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, restoreLeftoverCapturedSource, focusMutableDraft, focusOpaqueTab, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active text editor; no_claim=a move to the terminal or a view, which the editor does not report
test('a cold Study open after a reload whose leftover group the editor refuses to close leaves the keyboard in the captured source the learner selected in that group while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's restored captured sources, Captured-login-form.tsx in front without a text editor and Captured-auth-form.tsx behind it, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.restoreLeftoverCapturedSource({ column: 1 })
    const authSource = harness.restoreLeftoverCapturedSource({
      column: 1,
      file: 'Captured-auth-form.tsx',
      active: false,
      textEditor: true,
    })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: the learner selects Captured-auth-form.tsx in the leftover group while the editor's answer to the close is pending.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.focusOpaqueTab(authSource)
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, no focus command ran after the learner's click, and Captured-auth-form.tsx keeps the keyboard.
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        keyboardEditor: { name: 'Captured-auth-form.tsx', column: 1 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, the editor comes to show that group's restored captured source in a text editor while the group has the keyboard and its close is pending, and the editor then refuses the close: the learner's notes get the keyboard back, since the learner did not move; fails_when=every captured source that has the keyboard counts as a move of the learner's, also the one the focused leftover itself shows in front, so nothing is given back and the keyboard stays in the leftover group the editor did not close (Cycle 0047 row 99, the limit of its fix); why_new=Cycle 0047 row 99 (CR1-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, restoreLeftoverCapturedSource, resolveRestoredCapturedSource, focusMutableDraft, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active text editor; no_claim=whether and when an editor shows a restored captured source in a text editor by itself (no native trace)
test('a cold Study open after a reload whose leftover group comes to show its restored captured source while the close is pending, and is refused the close, gives the learner’s file its keyboard back', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's restored captured source in front, without a text editor, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    const restoredSource = harness.restoreLeftoverCapturedSource({ column: 1 })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: while the close is pending, the editor shows the leftover's restored captured source in a text editor, in the group that has the keyboard.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.resolveRestoredCapturedSource(restoredSource)
    const shownByTheLeftover =
      harness.editor.window.activeTextEditor?.document.uri.path
        .split('/')
        .at(-1)
    const commandsWhileTheCloseWasPending = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, the second group's focus command gave the notes their keyboard back after it, and the notes have it.
    assert.deepEqual(
      {
        shownByTheLeftover,
        answer,
        focusCommands: harness.commands
          .slice(commandsWhileTheCloseWasPending)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        shownByTheLeftover: 'Captured-login-form.tsx',
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: ['workbench.action.focusSecondEditorGroup'],
        keyboardEditor: { name: 'learner-notes.ts', column: 2 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, which still shows the earlier session's restored captured source in front of its dead Application pane, the learner selects that pane's tab in the group while the editor's answer to the group's close is pending, and the editor then refuses the close: the pane keeps the keyboard; fails_when=the give-back reads the learner's move only from the active text editor and the group the editor names, so a page that is no text editor selected in the proof's own group (no active text editor, a group the proof named) is not seen and the second group's focus command takes the keyboard from it (Cycle 0047 row 128, CR2-1); why_new=Cycle 0047 row 128 (CR2-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveDeadCodebookPane, restoreLeftoverCapturedSource, focusMutableDraft, focusOpaqueTab, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active tab group; no_claim=a move to the terminal or a view, which the editor does not report
test('a cold Study open after a reload whose leftover group the editor refuses to close leaves the keyboard on the page the learner selected in that group while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's dead Application pane and its restored captured source in front of it, without a text editor, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
    )
    harness.restoreLeftoverCapturedSource({ column: 1 })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: the learner selects the dead Application pane's tab in the leftover group while the editor's answer to the close is pending.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.focusOpaqueTab(deadApplication)
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, no focus command ran after the learner's click, and the leftover group with the pane in front is still the active one.
    const activeGroup = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        activeGroup: {
          column: activeGroup.viewColumn,
          tab: activeGroup.activeTab?.label,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        activeGroup: { column: 1, tab: 'codebook · Application' },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, the editor comes to show the restored captured source in front of it in a text editor, the learner then selects another restored captured source of that group while the close is pending, the editor goes on reporting the first one's text editor as the active one, and the editor then refuses the close: the captured source the learner selected keeps the keyboard; fails_when=the give-back takes the stale active text editor, which shows the captured source the proof's group had in front, for no move, so the selection is not seen and the second group's focus command takes the keyboard from it (Cycle 0047 row 128, CR2-1); why_new=Cycle 0047 row 128 (CR2-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, restoreLeftoverCapturedSource, resolveRestoredCapturedSource, retainActiveTextEditorReport, focusMutableDraft, focusOpaqueTab, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active tab group; no_claim=how long a real editor's report lags (no native trace)
test('a cold Study open after a reload whose leftover group the editor refuses to close leaves the keyboard in the captured source the learner selected in that group while the editor still reported the one in front before', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's restored captured sources, Captured-login-form.tsx in front and Captured-auth-form.tsx behind it, both without a text editor, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    const loginSource = harness.restoreLeftoverCapturedSource({ column: 1 })
    const authSource = harness.restoreLeftoverCapturedSource({
      column: 1,
      file: 'Captured-auth-form.tsx',
      active: false,
    })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: while the close is pending, the editor shows Captured-login-form.tsx in a text editor, and the learner selects Captured-auth-form.tsx while the editor still reports that text editor as the active one.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.resolveRestoredCapturedSource(loginSource)
    const endStaleReport = harness.retainActiveTextEditorReport()
    harness.focusOpaqueTab(authSource)
    const reportedAfterTheLearnersClick =
      harness.editor.window.activeTextEditor?.document.uri.path
        .split('/')
        .at(-1)
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening
    endStaleReport()

    // Assert: the editor still reported Captured-login-form.tsx, the open reports the refused close, no focus command ran after the learner's click, and the leftover group with Captured-auth-form.tsx in front is still the active one.
    const activeGroup = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        reportedAfterTheLearnersClick,
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        activeGroup: {
          column: activeGroup.viewColumn,
          tab: activeGroup.activeTab?.label,
        },
      },
      {
        reportedAfterTheLearnersClick: 'Captured-login-form.tsx',
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        activeGroup: { column: 1, tab: 'Captured-auth-form.tsx' },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, which stands empty, the learner opens a page that is no text editor in that group while the editor's answer to the group's close is pending, and the editor then refuses the close: the page keeps the keyboard; fails_when=a group that had no tab at the proof's start counts no tab in front of it now as the learner's move, so the page, which no active text editor reports and which stands in a group the proof named, is not seen and the second group's focus command takes the keyboard from it (Cycle 0047 row 151 (b)); why_new=Cycle 0047 row 151 (P3COV-3 = P3TEST-6): no test reached the empty front of the proof's group; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, focusMutableDraft, addOpaqueTab, focusOpaqueTab, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active tab group; no_claim=a move to the terminal or a view, which the editor does not report
test('a cold Study open after a reload whose empty leftover group the editor refuses to close leaves the keyboard on the page the learner opened in that group while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands empty and locked beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: the learner opens an extension page in the empty leftover group while the editor's answer to the close is pending.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.focusOpaqueTab(harness.addOpaqueTab('Extension page', 1))
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, no focus command ran after the learner's click, and the leftover group with the page in front is still the active one.
    const activeGroup = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        activeGroup: {
          column: activeGroup.viewColumn,
          tab: activeGroup.activeTab?.label,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        activeGroup: { column: 1, tab: 'Extension page' },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, which still shows the earlier session's restored captured source in front of its dead Application pane, that captured source closes while the editor's answer to the group's close is pending, and the editor then refuses the close: the learner's notes get the keyboard back, since the pane came to the front only because the tab before it closed; fails_when=any other tab in front of the proof's group counts as the learner's move, also one that came there because the tab in front left the group, so nothing is given back and the keyboard stays in the leftover group the editor did not close (Cycle 0047 row 151 (c)); why_new=Cycle 0047 row 151 (P3COV-3 = P3TEST-6): no test closed the tab in front of the proof's group; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveDeadCodebookPane, restoreLeftoverCapturedSource, focusMutableDraft, closeTabByHand, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active text editor; no_claim=what closes a restored tab in a real editor while a group close is pending (no native trace)
test('a cold Study open after a reload whose leftover group loses its restored captured source while the close is pending, and is refused the close, gives the learner’s file its keyboard back', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's dead Application pane and its restored captured source in front of it, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveDeadCodebookPane('codebook.scopedBrowser', 1)
    const restoredSource = harness.restoreLeftoverCapturedSource({ column: 1 })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: while the close is pending, the restored captured source closes, and the dead pane behind it comes to the front of the leftover group.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.closeTabByHand(restoredSource)
    const frontAfterTheClose =
      harness.editor.window.tabGroups.activeTabGroup.activeTab?.label
    const commandsWhileTheCloseWasPending = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the pane came to the front, the open reports the refused close, the second group's focus command gave the notes their keyboard back after it, and the notes have it.
    assert.deepEqual(
      {
        frontAfterTheClose,
        answer,
        focusCommands: harness.commands
          .slice(commandsWhileTheCloseWasPending)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        frontAfterTheClose: 'codebook · Application',
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: ['workbench.action.focusSecondEditorGroup'],
        keyboardEditor: { name: 'learner-notes.ts', column: 2 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, a page opens in a new group beside without taking the keyboard while the editor's answer to the group's close is pending, and the editor then refuses the close: the learner's notes get the keyboard back, since the keyboard is still where the proof left it; fails_when=a grid that gained or lost a group is taken for the learner's move, so nothing is given back and the keyboard stays in the leftover group the editor did not close (Cycle 0047 row 151 (a)); why_new=Cycle 0047 row 151 (P3COV-3 = P3TEST-6): no test changed the number of groups while the close was pending; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, restoreLeftoverCapturedSource, focusMutableDraft, openPageInNewGroup, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active text editor; no_claim=which extension opens a page beside while a group close is pending, and a group that came or went left of the proof's column, which moves the proof's group to another column
test('a cold Study open after a reload whose leftover group the editor refuses to close gives the learner’s file its keyboard back when a page opened in a new group beside while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's restored captured source in front, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.restoreLeftoverCapturedSource({ column: 1 })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: while the close is pending, an extension page opens in a new third group without taking the keyboard.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.openPageInNewGroup('Extension page')
    const groupsWhileTheCloseWasPending =
      harness.editor.window.tabGroups.all.length
    const commandsWhileTheCloseWasPending = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the editor named three groups, the open reports the refused close, the second group's focus command gave the notes their keyboard back after it, and the notes have it.
    assert.deepEqual(
      {
        groupsWhileTheCloseWasPending,
        answer,
        focusCommands: harness.commands
          .slice(commandsWhileTheCloseWasPending)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        groupsWhileTheCloseWasPending: 3,
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: ['workbench.action.focusSecondEditorGroup'],
        keyboardEditor: { name: 'learner-notes.ts', column: 2 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of whoever owns the window after a cold Study open is cancelled while the proof of the earlier window's leftover group runs its focus command: the cancelled entry gives the learner's file nothing back, since nothing was refused and a newer owner may hold the keyboard; fails_when=the text editor's give-back after a proof that threw runs for every rejection, also the entry's own cancellation, so the cancelled entry runs a group's focus command outside the layout queue it no longer owns (Cycle 0046 P2CR-1 with P2OCR1-1); why_new=Cycle 0046 P2CR-1; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, holdNextCommand('workbench.action.focusFirstEditorGroup'), the entry's AbortController, the reader's open and the command log
test('a cold Study open that is cancelled while the leftover proof focuses the earlier window’s group gives the learner’s file nothing back', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked beside the learner's notes, which have the keyboard; the editor holds the proof's focus command.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
    version: 1,
    writer: 'the window before the reload',
    column: 1,
    groupCount: 2,
    layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
  })
  harness.leaveEmptyLockedGroup(1)
  harness.leaveEmptyGroup(2)
  harness.focusMutableDraft('learner-notes.ts', 2)
  const proofFocus = harness.holdNextCommand(
    'workbench.action.focusFirstEditorGroup',
  )
  const entry = new AbortController()
  try {
    // Act: the entry is cancelled while the proof's focus command runs.
    const opening = harness.reader.open(entry.signal).then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await proofFocus.started
    const commandsAfterProofFocus = harness.commands.length
    entry.abort(new Error('The Study entry was cancelled.'))
    proofFocus.release()
    const answer = await opening

    // Assert: the open reports its cancellation, and the cancelled entry ran no focus command after the proof's.
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterProofFocus)
          .filter((command) => command.startsWith('workbench.action.focus')),
      },
      {
        answer: 'Error: The Study entry was cancelled.',
        focusCommands: [],
      },
    )
  } finally {
    proofFocus.release()
    await harness.close()
  }
})

// Value: protects=the keyboard of whoever owns the window after a cold Study open from Cursor's chat is cancelled while the proof of the earlier window's leftover group runs its focus command: the cancelled entry gives the chat nothing back and tells no sentence, since nothing was refused; fails_when=the give-back after a proof that took the keyboard runs for every rejection, also the entry's own cancellation, so the cancelled entry runs Focus Agent outside the layout queue it no longer owns and tells that Codebook could not close the groups (Cycle 0046 P2OCR1-1); why_new=Cycle 0046 P2OCR1-1; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, holdNextCommand('workbench.action.focusFirstEditorGroup'), the entry's AbortController, the reader's open, the command log and the information messages
test('in Cursor, a cold Study open from the chat that is cancelled while the leftover proof focuses the earlier window’s group gives the chat nothing back and tells nothing', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked beside the learner's notes; Cursor's chat has the keyboard, and the editor holds the proof's focus command.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
    version: 1,
    writer: 'the window before the reload',
    column: 1,
    groupCount: 2,
    layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
  })
  harness.leaveEmptyLockedGroup(1)
  harness.leaveEmptyGroup(2)
  harness.focusMutableDraft('learner-notes.ts', 2)
  chat.focusTab()
  const proofFocus = harness.holdNextCommand(
    'workbench.action.focusFirstEditorGroup',
  )
  const entry = new AbortController()
  const messagesBefore = harness.informationMessages.length
  try {
    // Act: the entry is cancelled while the proof's focus command runs.
    const opening = harness.reader.open(entry.signal).then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await proofFocus.started
    const commandsAfterProofFocus = harness.commands.length
    entry.abort(new Error('The Study entry was cancelled.'))
    proofFocus.release()
    const answer = await opening

    // Assert: the open reports its cancellation, and the cancelled entry ran no focus command after the proof's and told nothing.
    assert.deepEqual(
      {
        answer,
        keyboardCommands: harness.commands
          .slice(commandsAfterProofFocus)
          .filter(
            (command) =>
              command === 'composer.focusComposer' ||
              command.startsWith('workbench.action.focus'),
          ),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        answer: 'Error: The Study entry was cancelled.',
        keyboardCommands: [],
        messages: [],
      },
    )
  } finally {
    proofFocus.release()
    await harness.close()
  }
})

// Value: protects=the window after the learner closed the Study workspace while a cold Study open from Cursor's chat ran the proof's focus command for the earlier window's leftover group: the closed reader gives the chat nothing back and tells no sentence; fails_when=the give-back after a proof that took the keyboard runs for the lifetime the Close ended, so the closed reader runs Focus Agent beside the Close's own work and tells that Codebook could not close the groups (Cycle 0046 P2OCR1-1); why_new=Cycle 0046 P2OCR1-1; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, holdNextCommand('workbench.action.focusFirstEditorGroup'), the reader's open and close, the command log and the information messages
test('in Cursor, a cold Study open from the chat whose reader closes while the leftover proof focuses the earlier window’s group runs no Focus Agent after the Close and tells nothing', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked beside the learner's notes; Cursor's chat has the keyboard, and the editor holds the proof's focus command.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
    version: 1,
    writer: 'the window before the reload',
    column: 1,
    groupCount: 2,
    layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
  })
  harness.leaveEmptyLockedGroup(1)
  harness.leaveEmptyGroup(2)
  harness.focusMutableDraft('learner-notes.ts', 2)
  chat.focusTab()
  const proofFocus = harness.holdNextCommand(
    'workbench.action.focusFirstEditorGroup',
  )
  const messagesBefore = harness.informationMessages.length
  try {
    // Act: the learner closes the reader while the proof's focus command runs.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await proofFocus.started
    const closing = harness.reader.close()
    const commandsAfterClose = harness.commands.length
    proofFocus.release()
    const answer = await opening
    await closing

    // Assert: the open reports the Close, and the closed reader ran no Focus Agent and told nothing.
    assert.deepEqual(
      {
        answer,
        chatCommands: harness.commands
          .slice(commandsAfterClose)
          .filter((command) => command === 'composer.focusComposer'),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        answer:
          'Error: The study workspace was closed; repeat the action explicitly if needed.',
        chatCommands: [],
        messages: [],
      },
    )
  } finally {
    proofFocus.release()
    await harness.close()
  }
})

// Value: protects=the learner's own Study Application pane when an agent's run prepares its Application while the layout queue is busy and the learner's Open makes that pane outside the queue meanwhile: the run's preparation, refused afterwards by its focus return, retires only what it made itself, so the Open's pane and the Study stay; fails_when=the preparation decides what it made from the pane it saw before it waited for the queue, so the refused focus return disposes the pane the Open made and closes the group it was moved into, and the Open is left without its Application (Cycle 0046 OCR1-7); why_new=Cycle 0046 OCR1-7; seam=the reader's withLayout held by the test (another layout operation in the queue), focusMutableDraft with workInActiveTextEditor and replaceContent (the learner typing during the placement), holdNextCommand on workbench.action.lockEditorGroup, presentation.createViewport (the MCP-first preparation), the reader's open, counts and panelColumn
test('a run’s Application preparation refused by its focus return after it waited for the layout queue leaves the Application pane the learner’s Open made meanwhile', async () => {
  // Arrange: the learner works in notes.ts in the second of two groups; another layout operation holds the queue, so an agent's run's preparation waits for it, and the learner's Open makes the Application pane outside the queue meanwhile.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  let releaseQueue = (): void => {}
  try {
    const notes = harness.focusMutableDraft('notes.ts', 2)
    harness.workInActiveTextEditor('keyboard')
    const queueHeld = harness.reader['withLayout'](
      undefined,
      () =>
        new Promise<void>((resolve) => {
          releaseQueue = resolve
        }),
    )
    const preparing = Promise.resolve(
      harness.reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      ),
    ).then(
      (viewport) => {
        viewport.close()
        return 'prepared'
      },
      (error: unknown) => String(error),
    )
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await waitUntil(
      () => harness.counts().panels > 0,
      'the Open’s Application pane',
      2_000,
    )
    const lock = harness.holdNextCommand('workbench.action.lockEditorGroup')

    // Act: the queue frees; the learner types in notes.ts while the run's new group is locked, so the run's focus return refuses.
    releaseQueue()
    await queueHeld
    await lock.started
    notes.replaceContent('The learner typed during the placement.\n')
    lock.release()
    const preparation = await preparing
    const open = await opening

    // Assert: the run's preparation is refused for the learner's typing, and the Open's Application pane stands in column 1 beside the Study.
    assert.deepEqual(
      {
        preparation,
        open,
        panels: harness.counts().panels,
        applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      },
      {
        preparation:
          'Error: The previously focused document changed during presentation; its current reading position was preserved.',
        open: 'opened',
        panels: 2,
        applicationColumn: 1,
      },
    )
  } finally {
    releaseQueue()
    await harness.close()
  }
})

// Value: protects=the truth of what the learner is told when an agent's cold Study select in Cursor after a reload, beside a dead pane of the earlier host, checks the empty group at the recorded column in a grid the learner resized since: the proof focused that group and closed nothing, so the chat gets its keyboard back with a sentence that says nothing was closed; fails_when=the selection's give-back after the leftover close tells the sentence of a proof that closed the groups, "Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, …", for a proof that closed none (Cycle 0046 FX-D1-1); why_new=Cycle 0046 FX-D1-1; seam=useNativeLayout (columns the learner resized), applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, leaveDeadCodebookPane, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, the reader's changePresentation for an agent and the information messages
test('in Cursor, an agent’s cold Study select from the chat beside a dead pane, whose resized grid no longer proves the earlier window’s record, gives the chat its keyboard back saying that no group was closed', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands empty and locked, the learner widened the second column, the old host's Repository Wiki pane is left dead there behind the learner's notes, and Cursor's chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 300 }, { size: 600 }],
  })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.leaveDeadCodebookPane('codebook.repositoryWiki', 2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    await harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      .catch(() => undefined)

    // Assert: the first sentence the learner is told says that the check closed no group.
    assert.equal(
      harness.informationMessages[0]?.message,
      'Codebook gave the keyboard back to the chat after it checked the empty editor groups an earlier window may have left and closed none of them: checking them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the truth of what the learner is told when an agent's first run in Cursor after a reload checks the empty group at the recorded column in a grid the learner resized since: the proof focused that group and closed nothing, so the chat's keyboard comes back with a sentence that says nothing was closed; fails_when=the preparation's give-back after the proof tells the sentence of a proof that closed the groups, "Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, …", for a proof that closed none (Cycle 0046 FX-D1-1); why_new=Cycle 0046 FX-D1-1; seam=useNativeLayout (columns the learner resized), applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, presentation.createViewport (the MCP-first preparation) and the information messages
test('in Cursor, an agent’s first run after a reload whose resized grid no longer proves the earlier window’s record gives the chat its keyboard back saying that no group was closed', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands empty and locked, the learner widened the second column with the notes, and Cursor's chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 300 }, { size: 600 }],
  })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()

    // Act
    await Promise.resolve(
      harness.reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      ),
    ).then(
      (viewport) => viewport.close(),
      () => undefined,
    )

    // Assert: the chat has the keyboard again, and the first sentence the learner is told says that the check closed no group.
    assert.deepEqual(
      {
        chatHasKeyboard: chat.focused(),
        firstMessage: harness.informationMessages[0]?.message,
      },
      {
        chatHasKeyboard: true,
        firstMessage:
          'Codebook gave the keyboard back to the chat after it checked the empty editor groups an earlier window may have left and closed none of them: checking them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an open Study in Cursor beside a dead Study pane of the earlier host that the editor kept: after the learner closes one of their own groups, Cursor builds every tab object anew, and the next selection still knows the kept pane for the earlier host's and names it, while this host's own Study pane stays; fails_when=the note of the dead pane is kept per tab object only, and while this host holds a Study pane of its own the rebuilt dead tab is not noted again, so the selection no longer names the kept pane and is refused for "The Study panes changed during Restore." instead (Cycle 0046 FX-D1-2); why_new=Cycle 0046 FX-D1-2; seam=useNativeLayout with five groups, leaveEmptyGroup, focusMutableDraft, leaveDeadCodebookPane with refuseClose, replaceGroupObjectsOnTabChanges and rebuildTabObjectsAtGroupRemoval (Cursor's new tab objects after a removed group), the editor's tabGroups.close of the learner's group, the reader's open and changePresentation, counts and panelColumn
test('in Cursor, a selection after the learner closed one of their groups still names the earlier host’s dead Study pane the editor kept, though the removal made every tab object new', async () => {
  // Arrange: five groups: the learner's notes, two empty groups, other.ts, the old host's Study pane (which the editor will not close) and scratch.ts; the Study opens beside the kept dead pane, and the learner then closes the group of scratch.ts. The editor is Cursor: a removed group brings new group and tab objects.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}, {}, {}] })
  harness.replaceGroupObjectsOnTabChanges()
  harness.rebuildTabObjectsAtGroupRemoval()
  try {
    harness.leaveEmptyGroup(2)
    harness.leaveEmptyGroup(3)
    harness.focusMutableDraft('other.ts', 3)
    harness.leaveDeadCodebookPane('codebook.studyContext', 4, {
      refuseClose: true,
    })
    harness.focusMutableDraft('scratch.ts', 5)
    harness.focusMutableDraft('notes.ts', 1)
    await harness.reader.open()
    const studyColumnAtOpen = harness.panelColumn('codebook.studyContext')
    const scratchGroup = harness.groups.find((group) =>
      group.tabs.some((tab) => tab.label === 'scratch.ts'),
    )!
    await harness.editor.window.tabGroups.close(scratchGroup, true)
    const state = harness.reader.presentationState()

    // Act
    const answer = await harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        () => 'selected',
        (error: unknown) => String(error),
      )

    // Assert: the selection names the kept dead pane; this host's own Study pane stays in its column beside the dead one.
    assert.deepEqual(
      {
        studyColumnAtOpen,
        answer,
        studyPaneColumn: harness.panelColumn('codebook.studyContext'),
        studyTabColumns: harness.groups
          .filter((group) =>
            group.tabs.some((tab) => tab.label === 'codebook · Study'),
          )
          .map((group) => group.viewColumn),
      },
      {
        studyColumnAtOpen: 3,
        answer:
          'Error: A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        studyPaneColumn: 3,
        studyTabColumns: [3, 4],
      },
    )
  } finally {
    harness.acceptDeadPaneClose()
    await harness.close()
  }
})

// Value: protects=an open Study in Cursor whose own Study pane is named exactly as the dead Study pane of the earlier host (one view type, one title, as the editors name a live and a dead pane alike): after a removed group made every tab object new, the next selection still knows the dead pane, and this host's own pane stays its own; fails_when=the rebuilt tab of this host's own Study pane, in that pane's own column, is taken for a successor of the dead pane's note, so two tabs answer one note and the dead pane is no longer known, or this host's own pane is taken for a dead one (Cycle 0046 FX-D1-2's own-column rule); why_new=the harness names this host's panes without the main-thread prefix of the dead ones, so the FX-D1-2 test passes with that rule removed (second Step 7 audit); seam=as the FX-D1-2 test, and the dead pane's input renamed to the view type this host's own Study pane carries; no_claim=a successor in a column where this host's pane does not stand, which the rule that more successors than notes are none decides (not covered)
test('in Cursor, a selection after the learner closed one of their groups still names the earlier host’s dead Study pane, though this host’s own Study pane carries the same view type and title', async () => {
  // Arrange: as the test above, with the dead Study pane named as this host's own Study pane is named here, so that only its column tells the two apart.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}, {}, {}] })
  harness.replaceGroupObjectsOnTabChanges()
  harness.rebuildTabObjectsAtGroupRemoval()
  try {
    harness.leaveEmptyGroup(2)
    harness.leaveEmptyGroup(3)
    harness.focusMutableDraft('other.ts', 3)
    const deadStudy = harness.leaveDeadCodebookPane(
      'codebook.studyContext',
      4,
      { refuseClose: true },
    )
    deadStudy.input = new harness.editor.TabInputWebview(
      'codebook.studyContext',
    )
    harness.focusMutableDraft('scratch.ts', 5)
    harness.focusMutableDraft('notes.ts', 1)
    await harness.reader.open()
    const studyColumnAtOpen = harness.panelColumn('codebook.studyContext')
    const scratchGroup = harness.groups.find((group) =>
      group.tabs.some((tab) => tab.label === 'scratch.ts'),
    )!
    await harness.editor.window.tabGroups.close(scratchGroup, true)
    const state = harness.reader.presentationState()

    // Act
    const answer = await harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        () => 'selected',
        (error: unknown) => String(error),
      )

    // Assert: the selection names the kept dead pane; this host's own Study pane stays in its column beside the dead one.
    assert.deepEqual(
      {
        studyColumnAtOpen,
        answer,
        studyPaneColumn: harness.panelColumn('codebook.studyContext'),
        studyTabColumns: harness.groups
          .filter((group) =>
            group.tabs.some((tab) => tab.label === 'codebook · Study'),
          )
          .map((group) => group.viewColumn),
      },
      {
        studyColumnAtOpen: 3,
        answer:
          'Error: A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        studyPaneColumn: 3,
        studyTabColumns: [3, 4],
      },
    )
  } finally {
    harness.acceptDeadPaneClose()
    await harness.close()
  }
})

// Value: protects=this host's own Study pane when its panel reports a column other than its tab's group, beside a dead Study pane of the earlier host named exactly as this host's own: after a removed group made every tab object new, the dead pane's one note meets two unnoted Study tabs of its key outside the column the panel reports, so none of them takes the note, and this host's own pane is never taken for a dead one; fails_when=every successor of a vanished key is noted, so this host's own Study pane is noted dead too, and the selection closes it with the earlier host's leftover tabs (Cycle 0046 FX-D1-2's rule that more successors than notes are none); why_new=second Step 7 audit, path 23 (a mutation of that rule passed every Entry, EntryObstacles and Lifecycle test); seam=as the FX-D1-2 test, the dead pane's input renamed to the view type this host's own Study pane carries, and reportPanelColumn (a test-only harness option for a panel whose viewColumn differs from its tab's group) while the selection's admission reads the dead panes; no_claim=whether Cursor reports such a column
test('in Cursor, a selection after a removed group made every tab object new keeps this host’s own Study pane, whose panel reported another column, when a dead Study pane of the same name stands beside it', async () => {
  // Arrange: as the test above, with the dead Study pane named as this host's own Study pane; the learner closes the group of scratch.ts, and Cursor builds every tab object anew.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}, {}, {}] })
  harness.replaceGroupObjectsOnTabChanges()
  harness.rebuildTabObjectsAtGroupRemoval()
  try {
    harness.leaveEmptyGroup(2)
    harness.leaveEmptyGroup(3)
    harness.focusMutableDraft('other.ts', 3)
    const deadStudy = harness.leaveDeadCodebookPane(
      'codebook.studyContext',
      4,
      { refuseClose: true },
    )
    deadStudy.input = new harness.editor.TabInputWebview(
      'codebook.studyContext',
    )
    harness.focusMutableDraft('scratch.ts', 5)
    harness.focusMutableDraft('notes.ts', 1)
    await harness.reader.open()
    const studyColumnAtOpen = harness.panelColumn('codebook.studyContext')
    const scratchGroup = harness.groups.find((group) =>
      group.tabs.some((tab) => tab.label === 'scratch.ts'),
    )!
    await harness.editor.window.tabGroups.close(scratchGroup, true)
    const state = harness.reader.presentationState()

    // Act: the selection's admission reads the dead panes first, while this host's Study panel reports the captured source's column instead of its tab's; the panel reports its own column again right after.
    harness.reportPanelColumn('codebook.studyContext', 2)
    const selecting = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.reportPanelColumn('codebook.studyContext')
    await selecting.catch(() => undefined)

    // Assert: this host's own Study pane still stands in its column, beside the dead one.
    assert.deepEqual(
      {
        studyColumnAtOpen,
        studyPaneColumn: harness.panelColumn('codebook.studyContext'),
        studyTabColumns: harness.groups
          .filter((group) =>
            group.tabs.some((tab) => tab.label === 'codebook · Study'),
          )
          .map((group) => group.viewColumn),
      },
      { studyColumnAtOpen: 3, studyPaneColumn: 3, studyTabColumns: [3, 4] },
    )
  } finally {
    harness.reportPanelColumn('codebook.studyContext')
    harness.acceptDeadPaneClose()
    await harness.close()
  }
})

// Value: protects=the learner's knowledge of why VS Code's chat editor tab has the keyboard again after an agent's cold Study select retired the earlier window's leftover group: the proof focused that group, its removal gave the keyboard to the group before it, and the chat tab's group gets it back through its focus command; the sentence told once names the leftover's close and no pause; fails_when=the leftover proof's give-back tells row 632's pause sentence, "(at a pause, to the paused file the debugger opened)", for a pause that did not happen; why_new=Cycle 0046 row 648; seam=applicationGroupMarkers, leaveEmptyGroup, leaveDeadCodebookPane, focusChatEditorTab (VS Code's TabInputChat), closeDisposedPanelTabsLater, the reader's changePresentation for an agent (codebook_presentation), the command log and the information messages
test('an agent’s cold Study select in VS Code that retires the earlier window’s leftover group while the chat editor tab has the keyboard gives that chat its keyboard back and says once that closing the leftover moved it, naming no pause', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, where the old host's Application pane is left dead; the learner's notes stand in column 2, and VS Code's chat editor tab in column 3 has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  harness.closeDisposedPanelTabsLater()
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
    harness.leaveEmptyGroup(1)
    harness.leaveDeadCodebookPane('codebook.scopedBrowser', 1)
    const applicationLeftover = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    harness.focusChatEditorTab(3)
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    await harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      .catch(() => undefined)

    // Assert: the leftover is gone; the proof focused it, and the chat tab's group, now column 2, was focused by its number once the proof had moved the keyboard; the chat's sentence names the leftover's close and no pause, before the selection's own sentence for the captured source that covers the chat afterwards.
    assert.deepEqual(
      {
        leftoverGone: !harness.groups.includes(applicationLeftover),
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => command.startsWith('workbench.action.focus')),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        leftoverGone: true,
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusSecondEditorGroup',
        ],
        messages: [
          'Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, which moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
          'Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now: placing the panes needed the focus of the source, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of VS Code's chat editor tab in a group before the earlier window's leftover when an agent's cold Study select retires that leftover: its removal leaves the chat's group at its column, the chat's group gets its keyboard back through its focus command and the leftovers' sentence is told once; fails_when=the return shifts the remembered column by the group count as if the removed group stood before the chat's, finds no group showing the chat at column 0, and gives nothing back, so the captured source takes the keyboard and only its sentence is told; why_new=Cycle 0046 row 648's further finding (the fixer's own); seam=applicationGroupMarkers, leaveEmptyGroup, leaveDeadCodebookPane, focusChatEditorTab (VS Code's TabInputChat), closeDisposedPanelTabsLater, the reader's changePresentation for an agent, the command log and the information messages
test('an agent’s cold Study select in VS Code that retires the earlier window’s leftover group after the chat editor tab’s group gives that chat its keyboard back at its unchanged column and says once that closing the leftover moved it', async () => {
  // Arrange: the earlier window recorded its Application group at column 3, where the old host's Application pane is left dead; the learner's notes stand in column 2, and VS Code's chat editor tab in column 1 has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  harness.closeDisposedPanelTabsLater()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 3,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyGroup(3)
    harness.leaveDeadCodebookPane('codebook.scopedBrowser', 3)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(1)
    harness.focusChatEditorTab(1)
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    await harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      .catch(() => undefined)

    // Assert: the proof focused the leftover at column 3, and the chat tab's group, still column 1, got the keyboard back by its number before the selection went on; the leftovers' sentence was told first.
    assert.deepEqual(
      {
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => command.startsWith('workbench.action.focus'))
          .slice(0, 2),
        firstMessage: harness.informationMessages[0]?.message,
      },
      {
        focusCommands: [
          'workbench.action.focusThirdEditorGroup',
          'workbench.action.focusFirstEditorGroup',
        ],
        firstMessage:
          'Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, which moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's knowledge of where the keyboard is after an agent's cold Study select in Cursor retired the earlier window's leftover groups from the Agent chat: the proofs focused those groups, and Cursor's Focus Agent gave the chat its keyboard back, which Cursor reads the same whether the chat input or the terminal or a view had it (Cursor 3.23.12 17501:84373, 17501:88693, 17264:2840, 17264:3411), so the learner is told once, as at a pause (row 635), with the leftover's own sentence; fails_when=the leftover proof's return to Cursor's chat moves the keyboard into the chat without a word, or tells row 632's pause sentence; why_new=Cycle 0046 row 648 (Cursor's half of the same give-back); seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, leaveDeadCodebookPane, addSeparateEditorPart with the chat's focusTab, closeDisposedPanelTabsLater, the reader's changePresentation for an agent, the command log and the information messages
test('in Cursor, an agent’s cold Study select from the chat that retires the earlier window’s leftover groups gives the chat its keyboard back and says once that closing the leftovers moved it', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 and its Context group at column 3; the old host's Study pane is left dead in column 3, the learner's notes stand in column 2, and the chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  harness.closeDisposedPanelTabsLater()
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
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    chat.focusTab()
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    const selected = await harness.reader.changePresentation(
      {
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )

    // Assert: the layout is confirmed, Focus Agent gave the chat its keyboard back after the proofs, and the learner is told once why, with the leftovers' sentence; the selection's own return after its measurement's borrow then tells the arrangement's sentence (rows 647 and 655).
    assert.deepEqual(
      {
        layoutConfirmed: selected.layoutConfirmed,
        chatHasKeyboard: chat.focused(),
        focusAgentRuns: harness.commands
          .slice(commandsBefore)
          .filter((command) => command === 'composer.focusComposer').length,
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        layoutConfirmed: true,
        chatHasKeyboard: true,
        focusAgentRuns: 2,
        messages: [
          'Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, which moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
          'Codebook placed its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's window when an agent's run prepares the Application right after Developer: Reload Window, before any Study select: the earlier window's recorded leftovers are retired before the new Application group is allocated, and the chat keeps its keyboard; fails_when=the preparation allocates beside the leftovers and writes this window's record over the earlier one, so those empty groups are never proved or retired, or the retirement takes the keyboard from the chat; why_new=Cycle 0046 row 609; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, presentation.createViewport (the MCP-first preparation) and addSeparateEditorPart with the chat's focusTab
test('the first Application preparation of a reloaded window retires the earlier window’s recorded leftovers before it allocates, and the chat keeps its keyboard', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 and its Context group at column 3; after the reload both stand empty beside the learner's notes in column 2, and the chat has the keyboard.
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
    harness.leaveEmptyGroup(2)
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    chat.focusTab()

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: both leftovers are gone; the new Application group stands alone and locked in column 1 beside the learner's group, the record is this window's own, and the chat has the keyboard again.
      assert.equal(harness.groups.includes(applicationLeftover), false)
      assert.equal(harness.groups.includes(contextLeftover), false)
      const mainGroups = harness.groups.filter(
        (group) => !group.tabs.includes(chat.tab),
      )
      assert.deepEqual(
        mainGroups.map((group) => ({
          column: group.viewColumn,
          locked: Boolean(group.locked),
          tabs: group.tabs.length,
          holdsNotes: group.tabs.includes(learnerNotes.tab),
        })),
        [
          { column: 1, locked: true, tabs: 1, holdsNotes: false },
          { column: 2, locked: false, tabs: 1, holdsNotes: true },
        ],
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      const marker = harness.applicationGroupMarkers.get(
        'codebook.applicationGroup.v1',
      ) as { writer?: unknown } | undefined
      assert.equal(
        marker?.writer,
        harness.reader['applicationGroupMarkerWriter'],
      )
      assert.equal(chat.focused(), true)
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner told where the keyboard went when an agent's first run in Cursor after Developer: Reload Window retires the earlier window's proven leftover at column 1: the proof focuses that empty group for its layout read and its unlock, and Cursor's close of a focused group gives the next group's file the keyboard (Cursor 3.23.12 workbench.desktop.main.js 17269:33927 `$closeGroup` → `removeGroup`, 17501:61528 `doRemoveEmptyGroup` with 17501:43055 `shouldRestoreFocus`), the same group the Application's allocation focuses right after (row 655), so the chat gets the keyboard back at the end and the learner is told once with the leftovers' sentence; Codebook itself shows no learner file with the keyboard; fails_when=the chat's return after the proof is made without a word, or Codebook gives the learner's file the keyboard on purpose; why_new=Cycle 0046 row 657 (C58 c58-cu-1f-reload: login-form.tsx had the keyboard for 124 ms after the leftover's close); seam=useNativeLayout (three stacked rows), applicationGroupMarkers (a record the grid still equals), leaveEmptyLockedGroup, focusMutableDraft, addSeparateEditorPart with focusTab, leavePaneFocusUnreportedBesideChat, presentation.createViewport (the MCP-first preparation), textDocumentShows and the information messages
test('in Cursor, the first Application preparation of a reloaded window whose proof focuses the leftover at column 1 shows no learner file with the keyboard, gives the chat its keyboard back and says once that closing the leftover moved it', async () => {
  // Arrange: three stacked rows: the earlier window's empty locked Application group, login-form.tsx and auth.ts; the record still describes this grid, and Cursor's chat tab has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 219 }, { size: 219 }, { size: 219 }],
  })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 1,
        groups: [{ size: 219 }, { size: 219 }, { size: 219 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('login-form.tsx', 2)
    chat.focusTab()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: the leftover is gone, Codebook showed no learner file with the keyboard, the chat has the keyboard again, and the leftovers' sentence was told once before the arrangement's.
      assert.deepEqual(
        {
          leftoverStands: harness.groups.includes(leftover),
          learnerFilesShownWithKeyboard: harness
            .textDocumentShows()
            .slice(showsBefore)
            .filter(
              (shown) =>
                !shown.preserveFocus && !shown.name.startsWith('Captured-'),
            ),
          chatHasKeyboard: chat.focused(),
          messages: harness.informationMessages.map(
            (message) => message.message,
          ),
        },
        {
          leftoverStands: false,
          learnerFilesShownWithKeyboard: [],
          chatHasKeyboard: true,
          messages: [
            'Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, which moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
          ],
        },
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's first run in Cursor right after Developer: Reload Window, before any Study select: the earlier window's proven leftover is retired, the Application stands alone in its own locked group, the run's preparation answers, and the chat gets its keyboard back; fails_when=the reader gives the chat its keyboard back with Focus Agent between the leftover's retirement and the Application's allocation, Cursor's chat input takes the keyboard only after that command answered (workbench.desktop.main.js 17914:19364, 18566:8949, 18566:8198), so the chat's part has the focus again while the allocation reads its layout and the preparation fails ("The dedicated Application layout could not be confirmed.", C57 c57-cursor-1f2; "Native pane, group or focus changed while presentation waited; …", c57-cursor-1f); why_new=Cycle 0046 row 646; seam=useNativeLayout (three stacked rows), applicationGroupMarkers (a record the grid still equals), leaveEmptyLockedGroup, focusMutableDraft, addSeparateEditorPart with focusTab, leavePaneFocusUnreportedBesideChat, focusAgentLater, presentation.createViewport (the MCP-first preparation)
for (const landing of [
  // Before the reservation's first command: C57 c57-cursor-1f failed with "Native pane, group or focus changed while presentation waited; the learner arrangement was preserved."
  { commandsBeforeFocus: 1, nativeRound: 'c57-cursor-1f' },
  // Amid the allocation: C57 c57-cursor-1f2 failed with "The dedicated Application layout could not be confirmed."
  { commandsBeforeFocus: 4, nativeRound: 'c57-cursor-1f2' },
] as const)
  test(`in Cursor, the first Application preparation of a reloaded window whose chat takes its keyboard late (as in ${landing.nativeRound}) retires the leftover, stands alone in its own group, and gives the chat its keyboard back`, async () => {
    // Arrange: three stacked rows: the earlier window's empty locked Application group, the Repository Wiki's tab with login-form.tsx, and auth.ts; the record still describes this grid. Cursor's chat tab has the keyboard, and Cursor gives the chat input the keyboard only after Focus Agent answered.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 219 }, { size: 219 }, { size: 219 }],
    })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusAgentLater(landing.commandsBeforeFocus)
    try {
      harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
        version: 1,
        writer: 'the window before the reload',
        column: 1,
        groupCount: 3,
        layout: {
          orientation: 1,
          groups: [{ size: 219 }, { size: 219 }, { size: 219 }],
        },
      })
      harness.leaveEmptyLockedGroup(1)
      const leftover = harness.groups.find((group) => group.viewColumn === 1)!
      const learnerAuth = harness.focusMutableDraft('auth.ts', 3)
      const learnerLogin = harness.focusMutableDraft('login-form.tsx', 2)
      chat.focusTab()

      // Act
      let viewport: { close(): void } | undefined
      const prepared = await Promise.resolve()
        .then(() =>
          harness.reader.presentation.createViewport(
            'mcp-first-run',
            () => {},
            () => {},
            'normal',
          ),
        )
        .then(
          (created) => {
            viewport = created
            return 'prepared'
          },
          (error: unknown) => String(error),
        )
      // Cursor's chat takes the keyboard of the last Focus Agent a moment after it answered.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      // Assert: the preparation answered; the leftover is gone, the Application's group stands alone and locked at column 1 above the learner's two groups, and the chat has the keyboard.
      const mainGroups = harness.groups
        .filter((group) => !group.tabs.includes(chat.tab))
        .toSorted((left, right) => left.viewColumn - right.viewColumn)
      assert.deepEqual(
        {
          prepared,
          leftoverStands: harness.groups.includes(leftover),
          mainGroups: mainGroups.map((group) => ({
            column: group.viewColumn,
            locked: Boolean(group.locked),
            tabs: group.tabs.length,
          })),
          loginColumn: mainGroups.find((group) =>
            group.tabs.includes(learnerLogin.tab),
          )?.viewColumn,
          authColumn: mainGroups.find((group) =>
            group.tabs.includes(learnerAuth.tab),
          )?.viewColumn,
          chatHasKeyboard: chat.focused(),
        },
        {
          prepared: 'prepared',
          leftoverStands: false,
          mainGroups: [
            { column: 1, locked: true, tabs: 1 },
            { column: 2, locked: false, tabs: 2 },
            { column: 3, locked: false, tabs: 1 },
          ],
          loginColumn: 2,
          authColumn: 3,
          chatHasKeyboard: true,
        },
      )
      viewport?.close()
    } finally {
      await harness.close()
    }
  })

// Value: protects=an agent's first run right after a reload whose record no longer proves the earlier window's leftovers (the learner resized a group), beside Cursor's chat: the preparation is refused at once with a sentence that names the empty first group and its remedy, nothing is unlocked or closed, the record stays and the chat keeps its keyboard; fails_when=the preparation waits 5 s for a focus report the empty first group never gives and refuses with a sentence that names no group, or a failed proof unlocks, closes or forgets anything; why_new=Cycle 0046 row 610 (and the guard of row 609's path when the proof fails); seam=applicationGroupMarkers (a record the resized grid no longer equals), leaveEmptyLockedGroup, leaveEmptyGroup, presentation.createViewport (the MCP-first preparation) and addSeparateEditorPart with the chat's focusTab
test('an agent’s first run after a reload whose record no longer proves the empty first group is refused at once with that group named, touching nothing', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 and its Context group at column 3 in a grid the learner has since resized; both stand empty beside the learner's notes in column 2, and the chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const earlierRecord = {
      version: 2,
      writer: 'the window before the reload',
      columns: [1, 3],
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 3 }, { size: 1 }, { size: 1 }],
      },
    }
    harness.applicationGroupMarkers.set(
      'codebook.applicationGroup.v1',
      earlierRecord,
    )
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    chat.focusTab()
    const commandsBefore = harness.commands.length

    // Act
    const outcome = await Promise.resolve(
      harness.reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      ),
    ).catch((error: unknown) => error)

    // Assert: the refusal names the empty first group and its remedy; both leftovers stand as they were, nothing was unlocked, the record is the earlier window's, and the chat has the keyboard.
    assert.equal(
      outcome instanceof Error ? outcome.message : outcome,
      'The Codebook panes were not arranged: the first editor group (column 1) is empty, and beside the chat the editor reports no keyboard focus in an empty group. Open a file in that group or close it, then try again.',
    )
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.unlockEditorGroup'),
      false,
    )
    assert.deepEqual(
      [applicationLeftover, contextLeftover].map((group) => ({
        stands: harness.groups.includes(group),
        locked: Boolean(group.locked),
        tabs: group.tabs.length,
      })),
      [
        { stands: true, locked: true, tabs: 0 },
        { stands: true, locked: false, tabs: 0 },
      ],
    )
    assert.deepEqual(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      earlierRecord,
    )
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's first run beside Cursor's chat when the learner's own first editor group is empty (workbench.editor.closeEmptyGroups off), with no reload and no record: the preparation is refused at once with a sentence that names that group and its remedy, the group stays, and the chat keeps its keyboard; fails_when=the preparation waits 5 s for a focus report the empty group never gives and refuses with a sentence that names no group; why_new=Cycle 0046 row 610 (the same refusal without any reload); seam=leaveEmptyGroup, presentation.createViewport (the MCP-first preparation) and addSeparateEditorPart with the chat's focusTab
test('an agent’s first run beside the chat with the learner’s own empty first group is refused at once with that group named, and the group stays', async () => {
  // Arrange: the learner's first editor group is empty and the editor keeps it; the learner's notes stand in column 2, and the chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.leaveEmptyGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    const learnersEmptyGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    chat.focusTab()

    // Act
    const outcome = await Promise.resolve(
      harness.reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      ),
    ).catch((error: unknown) => error)

    // Assert
    assert.equal(
      outcome instanceof Error ? outcome.message : outcome,
      'The Codebook panes were not arranged: the first editor group (column 1) is empty, and beside the chat the editor reports no keyboard focus in an empty group. Open a file in that group or close it, then try again.',
    )
    assert.equal(harness.groups.includes(learnersEmptyGroup), true)
    assert.equal(learnersEmptyGroup.tabs.length, 0)
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the earlier window's unproven leftovers at an agent's first run after a reload in an editor without another editor part: the Application gets its own new group at column 1 beside them, and nothing is unlocked, closed or merged; fails_when=a failed proof unlocks or closes a leftover, or the preparation puts the Application into the empty locked group; why_new=Cycle 0046 rows 609 and 610 (the guard of row 591's rule on the preparation's path when the proof fails); seam=applicationGroupMarkers (a record the resized grid no longer equals), leaveEmptyLockedGroup, leaveEmptyGroup and presentation.createViewport (the MCP-first preparation)
test('an agent’s first run after a reload whose record no longer proves the leftovers places the Application in its own group beside them and unlocks or closes nothing', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 and its Context group at column 3 in a grid the learner has since resized; both stand empty beside the learner's notes in column 2; no chat part.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 2,
      writer: 'the window before the reload',
      columns: [1, 3],
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 3 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    const commandsBefore = harness.commands.length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: the Application stands alone in a new locked group at column 1; both leftovers stand beside it as they were, and nothing was unlocked.
      assert.equal(
        harness.commands
          .slice(commandsBefore)
          .includes('workbench.action.unlockEditorGroup'),
        false,
      )
      assert.deepEqual(
        harness.groups.map((group) => ({
          column: group.viewColumn,
          locked: Boolean(group.locked),
          tabs: group.tabs.length,
          leftover: group === applicationLeftover || group === contextLeftover,
          holdsNotes: group.tabs.includes(learnerNotes.tab),
        })),
        [
          {
            column: 1,
            locked: true,
            tabs: 1,
            leftover: false,
            holdsNotes: false,
          },
          {
            column: 2,
            locked: true,
            tabs: 0,
            leftover: true,
            holdsNotes: false,
          },
          {
            column: 3,
            locked: false,
            tabs: 1,
            leftover: false,
            holdsNotes: true,
          },
          {
            column: 4,
            locked: false,
            tabs: 0,
            leftover: true,
            holdsNotes: false,
          },
        ],
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard in VS Code, and in Cursor with its chat in the side bar, when an agent's run prepares the Application while the Study workspace is closed and the learner's file is the active editor of the first group: the Application gets its own locked group without any editor group's focus, no file gets the keyboard, and the one sentence the editor's ambiguity calls for (row 614) says that a view keeps it; fails_when=the preparation focuses the first group and its focus return shows the learner's active file with the keyboard, so the chat input the learner just typed in loses its keyboard to that file for good, without a word; why_new=Cycle 0046 row 612 (C56 run c56-1f-control: focusFirstEditorGroup, then showTextDocument(actions.ts, preserveFocus false) from restorePreparationFocus); seam=useNativeLayout, focusMutableDraft, focusView (the chat view's input, which the editor does not report), presentation.createViewport (the MCP-first preparation), keyboardInView, textDocumentShows and the information messages
test('an agent’s run that prepares the Application while the chat view has the keyboard leaves the keyboard in the chat, focuses nothing and says once where the keyboard may be', async () => {
  // Arrange: the learner's actions.ts is the active editor of the first group and auth.ts stands in the second; then the learner typed the request into the chat view, which the editor does not report.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    const auth = harness.focusMutableDraft('auth.ts', 2)
    harness.leaveEmptyGroup(1)
    const actions = harness.focusMutableDraft('actions.ts', 1)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: no document was shown with the keyboard and the chat view still has it; the Application stands alone in its locked group at column 1 beside the learner's two groups, and the sentence names both places the keyboard may be.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      assert.equal(harness.keyboardInView(), true)
      assert.deepEqual(
        harness.groups.map((group) => ({
          column: group.viewColumn,
          locked: Boolean(group.locked),
          holdsActions: group.tabs.includes(actions.tab),
          holdsAuth: group.tabs.includes(auth.tab),
        })),
        [
          { column: 1, locked: true, holdsActions: false, holdsAuth: false },
          { column: 2, locked: false, holdsActions: true, holdsAuth: false },
          { column: 3, locked: false, holdsActions: false, holdsAuth: true },
        ],
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        [
          'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
        ],
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard in VS Code when an agent's first run after Developer: Reload Window retires the earlier window's empty Application group, which the editor restored as its active group: the proof and the close of that group and the new Application group take no editor group's focus, no file gets the keyboard, and the one sentence the editor's ambiguity calls for (row 614) says that a view keeps it; fails_when=the leftover proof focuses the recorded column, the removal of the focused group hands the keyboard to the learner's file, and the preparation's focus return then shows that file with the keyboard; why_new=Cycle 0046 row 612 (C56 run c56-1f2: row 609's proof focusFirstEditorGroup, retainForeignTabFocus giving nothing back beside an active text editor, then showTextDocument(actions.ts, preserveFocus false)); seam=applicationGroupMarkers, leaveEmptyGroup, focusMutableDraft, the editor's focusFirstEditorGroup (the learner's last click into the empty group), focusView (the chat view's input), presentation.createViewport (the MCP-first preparation), keyboardInView, textDocumentShows and the information messages
test('an agent’s first run after a reload retires the earlier window’s empty Application group the editor restored as active, leaves the keyboard in the chat view and says once where the keyboard may be', async () => {
  // Arrange: the earlier window recorded its Application group at column 1; after the reload it stands empty and active beside the learner's actions.ts in column 2 and auth.ts in column 3, and the learner typed the request into the chat view.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
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
    harness.leaveEmptyGroup(3)
    const auth = harness.focusMutableDraft('auth.ts', 3)
    harness.leaveEmptyGroup(2)
    const actions = harness.focusMutableDraft('actions.ts', 2)
    harness.leaveEmptyGroup(1)
    const applicationLeftover = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: no document was shown with the keyboard and the chat view still has it; the leftover is gone, the new Application group stands locked at column 1 before the learner's two groups, and the sentence names both places the keyboard may be.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      assert.equal(harness.keyboardInView(), true)
      assert.equal(harness.groups.includes(applicationLeftover), false)
      assert.deepEqual(
        harness.groups.map((group) => ({
          column: group.viewColumn,
          locked: Boolean(group.locked),
          holdsActions: group.tabs.includes(actions.tab),
          holdsAuth: group.tabs.includes(auth.tab),
        })),
        [
          { column: 1, locked: true, holdsActions: false, holdsAuth: false },
          { column: 2, locked: false, holdsActions: true, holdsAuth: false },
          { column: 3, locked: false, holdsActions: false, holdsAuth: true },
        ],
      )
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        [
          'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
        ],
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner in VS Code when an agent's run can place its Application only after focusing the first editor group (another group is the active one): without a fresh sign of the learner's hand in the active file the editor cannot tell whether the chat view had the keyboard, so no file is given the keyboard afterwards, and the learner is told once that the Application's group has it; fails_when=the preparation's focus return shows the learner's active file with the keyboard, taking it from a chat input the learner was typing in, or the keyboard stays in the new group without a word; why_new=Cycle 0046 row 612 (the borrow that cannot be avoided: workbench.action.newGroupAbove adds above the active group only, and no command makes a group active without focusing it); seam=useNativeLayout, focusMutableDraft, focusView (the chat view's input), presentation.createViewport (the MCP-first preparation), textDocumentShows and the information messages
test('an agent’s run that must focus the first editor group to place the Application gives no file the keyboard and says once that the Application’s group has it', async () => {
  // Arrange: the learner's actions.ts is the active editor of the second group, and the learner typed the request into the chat view.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    const actions = harness.focusMutableDraft('actions.ts', 2)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: no document was shown with the keyboard after the placement; the Application stands in its locked group at column 1, actions.ts in column 3, and the sentence says where the keyboard is.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        [
          'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
        ],
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(
        harness.groups.find((group) => group.tabs.includes(actions.tab))
          ?.viewColumn,
        3,
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of VS Code's chat opened as an editor tab of a main editor group (Chat: Open Chat in Editor), where the learner typed the request: an agent's run places its Application in a new group above the first one, and the chat tab, still in front of its group, gets its keyboard back through that group's focus command, which gives the chat editor's input the keyboard (1.140.0 workbench.desktop.main.js 1106:74902, 3129:7546); nothing is told; fails_when=the preparation gives back only another editor part's chat and leaves the keyboard in the new Application group with row 612's sentence; why_new=Cycle 0046 row 625 (the row-612 fixer's report: the preparation never gave the keyboard back to a foreign tab in the main editor); seam=useNativeLayout, focusMutableDraft, focusChatEditorTab (VS Code's TabInputChat without an active text editor), presentation.createViewport (the MCP-first preparation), the command log, the active tab group and the information messages
test('an agent’s run that prepares the Application while VS Code’s chat editor tab has the keyboard gives that chat tab its keyboard back and tells nothing', async () => {
  // Arrange: actions.ts is in the first group, and the learner typed the request into the chat, opened as an editor tab of the second group in front of auth.ts.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('auth.ts', 2)
    const chat = harness.focusChatEditorTab(2)
    const commandsBefore = harness.commands.length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: the Application stands in its own group at column 1; the chat's group, now column 3, got the keyboard back through its focus command with the chat tab in front, no text editor is active, and nothing was told.
      const active = harness.editor.window.tabGroups.activeTabGroup
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.deepEqual(
        harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusThirdEditorGroup',
        ],
      )
      assert.equal(active.viewColumn, 3)
      assert.equal(active.activeTab, chat)
      assert.equal(harness.focusedSource(), undefined)
      assert.deepEqual(harness.informationMessages, [])
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's run whose Application preparation is placed while the editor refuses the focus command that gives VS Code's chat editor tab its keyboard back: the run still gets its Application pane in its own group; fails_when=the preparation's return of the keyboard to the chat rejects inside its focus return, so the preparation takes a refused keyboard courtesy for a refused placement, disposes the new Application pane, closes its group and fails the agent's run; why_new=Cycle 0046 second /ship OCR review OCR1-9 (returnPreparationFocus awaited the give-back without a catch, unlike every other give-back of the flow); seam=useNativeLayout, focusMutableDraft, focusChatEditorTab (VS Code's TabInputChat without an active text editor), failNextCommand on the chat group's focus command, presentation.createViewport (the MCP-first preparation), the command log; no_claim=what the learner is told about the keyboard after the refused command
test('an agent’s run whose return of the keyboard to VS Code’s chat editor tab the editor refuses still gets its Application pane in its own group', async () => {
  // Arrange: actions.ts is in the first group, and the learner typed the request into the chat, opened as an editor tab of the second group in front of auth.ts. The editor will refuse the focus command of the chat's group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('auth.ts', 2)
    harness.focusChatEditorTab(2)
    const commandsBefore = harness.commands.length
    harness.failNextCommand('workbench.action.focusThirdEditorGroup')

    // Act: what the preparation answers, its viewport or its refusal.
    let failure: string | undefined
    const viewport = await Promise.resolve()
      .then(() =>
        harness.reader.presentation.createViewport(
          'mcp-first-run',
          () => {},
          () => {},
          'normal',
        ),
      )
      .catch((error: unknown) => {
        failure = String(error)
        return undefined
      })

    try {
      // Assert: the chat's group, now column 3, was asked for its focus and refused it; the Application stands in its own group at column 1 all the same.
      assert.deepEqual(
        {
          failure,
          applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
          focusCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) => /^workbench\.action\.focus/.test(command)),
        },
        {
          failure: undefined,
          applicationColumn: 1,
          focusCommands: [
            'workbench.action.focusFirstEditorGroup',
            'workbench.action.focusThirdEditorGroup',
          ],
        },
      )
    } finally {
      viewport?.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of VS Code's chat editor tab that the learner moved into a floating window (Chat: Move Chat into New Window), where the learner typed the request: an agent's run places its Application in a new group above the first one, and the chat gets its keyboard back through the numbered focus command of its group's column, which in VS Code counts the groups of every editor part, raises the floating window and gives the chat editor's input the keyboard (1.140.0 workbench.desktop.main.js 987:4284, 1106:181056, 1106:133818, 3129:7546); the measurement's focus of the first group gave the learner's file the keyboard for a moment, so the return says so once (rows 647 and 655); fails_when=the floating window's group counts as another editor part, whose only give-back is Cursor's Focus Agent, so VS Code runs nothing and tells nothing while the Application's group keeps the keyboard, or the return after the measurement's borrow is made without a word; why_new=Cycle 0046 row 636, and rows 647 and 655 (the sentence); seam=useNativeLayout, focusMutableDraft, addSeparateEditorPart('vscode-floating-chat') and its focusTab, presentation.createViewport (the MCP-first preparation), the command log, the chat's keyboard and the information messages
test('an agent’s run that prepares the Application while VS Code’s chat editor tab in a floating window has the keyboard gives that chat its keyboard back and says once that a file of the main editor had it for a moment', async () => {
  // Arrange: actions.ts is in the first group and auth.ts in the second; the learner typed the request into the chat editor tab moved into a floating window, whose group the editor counts at column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart('vscode-floating-chat')
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('auth.ts', 2)
    chat.focusTab()
    const commandsBefore = harness.commands.length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: the Application stands in its own group at column 1; the floating window's group, now column 4, got the keyboard back through its numbered focus command, and the arrangement's sentence was told once.
      assert.deepEqual(
        {
          applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
          chatColumn: harness.groups.find((group) =>
            group.tabs.includes(chat.tab),
          )?.viewColumn,
          focusCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) => /^workbench\.action\.focus/.test(command)),
          chatHasKeyboard: chat.focused(),
          messages: harness.informationMessages.map(
            (message) => message.message,
          ),
        },
        {
          applicationColumn: 1,
          chatColumn: 4,
          focusCommands: [
            'workbench.action.focusFirstEditorGroup',
            'workbench.action.focusFirstEditorGroup',
            'workbench.action.focusFourthEditorGroup',
          ],
          chatHasKeyboard: true,
          messages: [
            'Codebook placed its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
          ],
        },
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=row 612's bound beside row 625: a page of the main editor that is no chat (the editor's Settings, Cursor's composer tab, whose input the extension API gives no kind) reads the same whether the keyboard was in it or in a view beside it, so an agent's run gives it nothing back after placing its Application and says once that the new group has the keyboard; fails_when=row 625's return to VS Code's chat editor tab also focuses a group for a tab that cannot be proven a chat; why_new=Cycle 0046 row 625 guard; seam=useNativeLayout, focusMutableDraft, addOpaqueTab and focusOpaqueTab, presentation.createViewport, the command log and the information messages
test('an agent’s run that prepares the Application while a Settings tab is the active tab gives that tab nothing back and says once that the Application’s group has the keyboard', async () => {
  // Arrange: actions.ts is in the first group, and the editor's Settings is the active tab of the second group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('auth.ts', 2)
    harness.focusOpaqueTab(harness.addOpaqueTab('Settings', 2))
    const commandsBefore = harness.commands.length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert
      assert.deepEqual(
        harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        ['workbench.action.focusFirstEditorGroup'],
      )
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        [
          'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
        ],
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner in VS Code when an agent's first run after Developer: Reload Window must focus the earlier window's leftover group for its proof (another group is the active one): the removal of that focused group gives the editor's next group the keyboard, so the editor cannot tell whether the chat view had it; no file gets the keyboard after the Application is placed, and the learner is told once that the Application's group has it; fails_when=the preparation's focus return shows the learner's active file with the keyboard after row 609's proof took it from the chat view, or the keyboard stays in the new group without a word; why_new=Cycle 0046 row 612 (the proof's focus that cannot be avoided: the editor unlocks only the active group); seam=applicationGroupMarkers, leaveEmptyGroup, focusMutableDraft, focusView (the chat view's input), presentation.createViewport (the MCP-first preparation), textDocumentShows and the information messages
test('an agent’s first run after a reload that must focus the earlier window’s leftover group for its proof gives no file the keyboard and says once that the Application’s group has it', async () => {
  // Arrange: the earlier window recorded its Application group at column 3; after the reload it stands empty beside the learner's actions.ts, the active editor of column 1, and auth.ts in column 2, and the learner typed the request into the chat view.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 3,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
      (group) => group.viewColumn === 3,
    )!
    harness.leaveEmptyGroup(2)
    const auth = harness.focusMutableDraft('auth.ts', 2)
    harness.leaveEmptyGroup(1)
    const actions = harness.focusMutableDraft('actions.ts', 1)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: no document was shown with the keyboard after the placement and the sentence says where the keyboard is; the leftover is gone and the Application stands locked at column 1 before the learner's two groups.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        [
          'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
        ],
      )
      assert.equal(harness.groups.includes(applicationLeftover), false)
      assert.deepEqual(
        harness.groups.map((group) => ({
          column: group.viewColumn,
          locked: Boolean(group.locked),
          holdsActions: group.tabs.includes(actions.tab),
          holdsAuth: group.tabs.includes(auth.tab),
        })),
        [
          { column: 1, locked: true, holdsActions: false, holdsAuth: false },
          { column: 2, locked: false, holdsActions: true, holdsAuth: false },
          { column: 3, locked: false, holdsActions: false, holdsAuth: true },
        ],
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who types in the first group's file while an agent's run prepares the Application in VS Code: the new group takes the keyboard from that file by the editor's own rule, and the preparation gives it back to the file, since a fresh sign of the learner's hand (a key press within LEARNER_SIGN_FRESH_MS) says the keyboard was there; fails_when=row 612's rule for the chat view also withholds the keyboard from a file the learner typed in a moment ago, which then stays in the empty Application group; why_new=Cycle 0046 row 612 (the bound of its fix: the learner's own sign still decides); seam=useNativeLayout, focusMutableDraft, workInActiveTextEditor('keyboard'), presentation.createViewport (the MCP-first preparation), textDocumentShows, focusedSource, keyboardOnBody and the information messages
test('an agent’s run that prepares the Application while the learner types in the first group’s file gives that file the keyboard back', async () => {
  // Arrange: actions.ts is the active editor of the first group, and the learner has just typed in it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.workInActiveTextEditor('keyboard')
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: actions.ts, in column 2 behind the new Application group, was shown with the keyboard and has it; nothing is told.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
        { name: 'actions.ts', viewColumn: 2, preserveFocus: false },
      ])
      assert.equal(
        harness.focusedSource()?.document.uri.path.endsWith('/actions.ts'),
        true,
      )
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.deepEqual(harness.informationMessages, [])
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who reads a file of the first group, without a key press, while an agent's run prepares the Application in VS Code: the new group takes the keyboard from that file by the editor's own rule, nothing proves that the keyboard was there and not in a chat view, so the file does not get it and the learner is told once where it may be; fails_when=the keyboard is left in the Application's group without a word (Cycle 0046 row 614, introduced by row 612's preparation without a focus); why_new=Cycle 0046 row 614; seam=useNativeLayout, focusMutableDraft (the learner's file, with no fresh sign), presentation.createViewport (the MCP-first preparation), textDocumentShows, keyboardOnBody and the information messages
test('an agent’s run that prepares the Application while the learner reads a first-group file without a key press gives that file nothing it cannot prove and says once where the keyboard may be', async () => {
  // Arrange: actions.ts is the active editor of the first group and has the keyboard; the learner has not pressed a key in it for a while, so no sign says so.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: the new group took the keyboard from actions.ts, no document was shown with it afterwards, and the sentence says where the keyboard may be.
      assert.deepEqual(harness.informationMessages, [
        {
          message:
            'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
          items: [],
        },
      ])
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      assert.equal(harness.keyboardOnBody(), true)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard when an agent reveals the current pause's source through codebook_reveal while the Study workspace is closed and the learner closed the run's Application pane: the reader's entry prepares a new Application group as an agent's, so no file the learner is not known to work in gets the keyboard; the sentence the run's own preparation told stays the only one in the editor session; fails_when=the entry prepares the Application as the learner's and its focus return shows the learner's active file with the keyboard; why_new=Cycle 0046 finding on codebook_reveal (row 612's rule on the reveal's reader entry); seam=useNativeLayout, focusMutableDraft, a live run's viewport, closeTabByHand (the learner closes the Application pane), focusView (the chat view's input), presentation.revealSource (what the codebook_reveal handler's configured run calls), textDocumentShows, keyboardInView and the information messages
test('an agent’s source reveal that opens the closed Study workspace gives no learner’s file the keyboard', async () => {
  // Arrange: a live run's Application pane stands in column 1 beside the learner's actions.ts; the reader is closed, the learner closed the Application pane, and then typed the request into the chat view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  let live: { close(): void } | undefined
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')!
    harness.closeTabByHand(application.nativeTab)
    harness.focusView()
    const snapshot = harness.service.snapshot(
      record,
      harness.service.state(record).participants.browser.snapshotUri!,
    )
    const showsBefore = harness.textDocumentShows().length

    // Act
    await harness.reader.presentation.revealSource(snapshot, 'server.mts')

    // Assert: no document was shown with the keyboard and the chat view still has it; the run's own preparation told the editor session's one sentence about the new group.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
      ],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard when an agent selects the Study workspace through codebook_presentation during a live run whose Application pane the learner closed: the selection's entry is an agent's (open with forAgent), so the new Application group's preparation, which has to focus the first editor group, gives no file the keyboard and says once that the new group has it; fails_when=the entry prepares as the learner's and its focus return shows the learner's actions.ts with the keyboard, or the new group keeps the keyboard without a word; why_new=Cycle 0046 coverage of an agent's select during a live run (no test reached open's forAgent through a selection into a new Application preparation); seam=workInActiveTextEditor (the learner's sign before the run, so the run's own preparation tells nothing), presentation.createViewport (the agent's run), closeTabByHand (the learner closes the Application pane), focusView (the chat view's input), the faked clock (the sign is old by the selection), the service's selectPresentation (the codebook_presentation handler), textDocumentShows and the information messages
test('an agent’s Study selection during a live run whose Application pane the learner closed gives no file the keyboard and says once that the new Application group has it', async (context) => {
  // Arrange: the learner typed in actions.ts (second group) when the agent's run placed its Application, then closed the Application pane and typed the next request into the chat view; more than three seconds pass.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  let live: { close(): void } | undefined
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 2)
    harness.workInActiveTextEditor('keyboard')
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')!
    harness.closeTabByHand(application.nativeTab)
    harness.focusView()
    const state = harness.reader.presentationState(),
      showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length
    enableFakeClock(context)
    await advanceClock(context, 3_001)

    // Act
    const selecting = harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await advanceClockUntilSettled(context, selecting, 40_000)
    resetFakeClock(context)
    await selecting

    // Assert: no document was shown with the keyboard, the Application stands in column 1 again, and the one sentence says that its new group has the keyboard.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    resetFakeClock(context)
    live?.close()
    await harness.close()
  }
})

// Value: protects=the captured source at the Study's own column when an agent's run reacquires the Application while the learner's file covers that source: the next entry from the repository brings the source to the front again; fails_when=the Application group is remembered as an ordinary Study layout because the source already stands at column 2, so no reentry fronts it and the learner's file stays over the captured source; why_new=Cycle 0046 control 'source-reentry' (the guard `|| !this.sourceReady()` of rememberApplicationGroup lost its only test when the fake editor began to give a text shown beyond the grid a group of its own, commit 7cc9499a); seam=closeTabByHand (the learner closes the Application pane), focusMutableDraft (the learner's file over the source), presentation.createViewport (the agent's run) and open with the repository origin, as the Repository Wiki's evidence link enters
test('an entry from the repository fronts the captured source again after an agent’s run reacquired the Application while the learner’s file covered that source', async () => {
  // Arrange: a Return claimed the Application group; the learner closed the Application pane and opened a file over the captured source in column 2, and an agent's run then prepared the Application again.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let viewport: Awaited<
    ReturnType<typeof harness.reader.presentation.createViewport>
  >
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    harness.closeTabByHand(
      harness.groups.find((group) => group.viewColumn === 1)!.tabs[0]!,
    )
    const learnersFile = harness.focusMutableDraft('learner-work.ts', 2)
    viewport = await harness.reader.presentation.createViewport(
      'agent-run',
      () => {},
      () => {},
      'normal',
    )
    const sourceGroup = harness.groups.find((group) => group.viewColumn === 2)!
    assert.equal(sourceGroup.activeTab, learnersFile.tab)

    // Act
    await harness.reader.open(undefined, 'repository')

    // Assert: column 2 shows the captured source again (the reader finds its source in front), and the learner's file stays in that group.
    const shown = harness.groups.find((group) => group.viewColumn === 2)!
    assert.deepEqual(
      {
        learnersFileInFront: shown.activeTab === learnersFile.tab,
        sourceInFront: harness.reader['sourceReady'](),
        learnersFileKept: shown.tabs.includes(learnersFile.tab),
      },
      {
        learnersFileInFront: false,
        sourceInFront: true,
        learnersFileKept: true,
      },
    )
  } finally {
    viewport!?.close()
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

// Value: protects=the learner's knowledge of where the keyboard is when an agent's Study selection (codebook_presentation) ends a Read while the learner types outside the editor (the terminal of the bottom panel, which a Read leaves shown, or another view): the side bars the Read hid are shown again with the editor's focus commands, which take the keyboard (VS Code 1.140.0 workbench.desktop.main.js 1113:32927, 859:17722; Cursor 3.23.12 18340:22765, 17376:10844), and the active editor group gets it after them, so the pane being read has it and the learner is told once; fails_when=the agent's selection moves the keyboard from the learner's view into the Study pane without a word; why_new=Cycle 0046 row 622; seam=workspaceHarness with modelSideBars, the pane's Read action, focusView (a view outside the editor with the keyboard), changePresentation with the agent's requester (the codebook_presentation handler), keyboardInView, sideBars and the information messages
test('an agent’s Study selection that ends a Read while the learner types in a view outside the editor says once that the pane being read has the keyboard', async () => {
  // Arrange: both side bars are open; the learner reads the explanation enlarged, which hides them, and then types in the terminal.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: true })
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    harness.focusView()
    const state = harness.reader.presentationState(),
      messagesBefore = harness.informationMessages.length

    // Act
    const selected = await harness.reader.changePresentation(
      {
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )

    // Assert: the bars are open again, the view lost the keyboard to the pane that was read, and the learner is told so.
    assert.equal(selected.layoutConfirmed, true)
    assert.deepEqual(harness.sideBars(), {
      primary: true,
      auxiliary: true,
      hasKeyboard: false,
    })
    assert.equal(harness.keyboardInView(), false)
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook ended your Read for the Study arrangement an agent asked for and showed the side bars the Read had hidden. Showing a side bar takes the keyboard in this editor, so the pane you were reading has it now: if you were typing in the terminal, a view or the chat, click there to type again.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who reads in the Study pane from a sentence that is not true for them: when the Study pane reports that it has the keyboard, an agent's Study selection that ends the Read gives it back to that pane and tells nothing; fails_when=row 622's notice is told although the learner was typing in the pane that gets the keyboard back; why_new=Cycle 0046 row 622 guard; seam=workspaceHarness with modelSideBars, the pane's Read action, receiveContext pane-focus (the Study pane's own report), changePresentation with the agent's requester, focusedPanel and the information messages
test('an agent’s Study selection that ends a Read while the Study pane reports its keyboard gives it back to the pane without a word', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: true })
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    harness.receiveContext({ type: 'pane-focus', focused: true })
    const state = harness.reader.presentationState(),
      messagesBefore = harness.informationMessages.length

    // Act
    const selected = await harness.reader.changePresentation(
      {
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )

    // Assert
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.deepEqual(harness.informationMessages.slice(messagesBefore), [])
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
      groups: [{ size: 250 }, { size: 300 }],
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
        groups: [{ size: 125 }, { size: 250 }, { size: 175 }],
      })
      assert.deepEqual(beforeRead, {
        orientation: 1,
        groups: [{ size: 125 }, { size: 250 }, { size: 175 }],
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
          layout: { orientation: 1, groups: [{ size: 250 }, { size: 300 }] },
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
      groups: [{ size: 109 }, { size: 107 }, { size: 107 }],
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
          groups: [{ size: 109 }, { size: 107 }, { size: 107 }],
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
      groups: [{ size: 250 }, { size: 300 }],
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
        groups: [{ size: 125 }, { size: 250 }, { size: 175 }],
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
          layout: { orientation: 1, groups: [{ size: 250 }, { size: 300 }] },
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
      groups: [{ size: 250 }, { size: 300 }],
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
        groups: [{ size: 125 }, { size: 250 }, { size: 175 }],
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
          layout: { orientation: 1, groups: [{ size: 250 }, { size: 300 }] },
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
          groups: [{ size: 109 }, { size: 107 }, { size: 107 }],
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
        groups: [{ size: 161 }, { size: 162 }, { size: 163 }, { size: 164 }],
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
        // The entry owns the final return to the chat, so the preparation of its Application shows no file of the learner's with the keyboard on the way (since row 712 its capture finds that file's group, and its own return would show it).
        assert.deepEqual(
          harness
            .textDocumentShows()
            .filter((shown) => !shown.preserveFocus)
            .map((shown) => shown.name),
          [],
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
