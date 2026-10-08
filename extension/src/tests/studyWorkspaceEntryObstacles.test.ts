import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { test } from 'node:test'

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
  try {
    await harness.reader.close()
    harness.changeWindowFocus(false)

    // Act
    await harness.reader.openRecording(harness.studyId)
    setTimeout(() => harness.changeWindowFocus(true), 200)
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().reason, undefined)
    assert.equal(harness.summary.visible, true)
  } finally {
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
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 1)
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
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    let live: { close(): void } | undefined
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
        live = harness.reader.presentation.createViewport(
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

      // Act
      await harness.reader.close()

      // Assert: the Read resized the groups; the Close ended the maximization and then applied the layout of before the Read.
      assert.deepEqual(beforeRead, {
        orientation: 1,
        groups: [{ size: 0.5 }, { size: 0.5 }],
      })
      assert.deepEqual(duringRead, {
        maximized: true,
        layout: { orientation: 1, groups: [{ size: 0.8 }, { size: 0.2 }] },
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
          ],
          maximized: false,
          layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
          learnersTabs: [1, 1],
        },
      )
    } finally {
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the sizes of the learner's own editor groups after a Read and a Restore in the live arrangement beside a third group of the learner's, where the Restore arranges nothing because it preserves the learner's groups: the groups have the sizes they had before the Read; fails_when=the Restore ends the Read with the editor's Expand and relies on its arrangement for the sizes, which it does not apply there, so the learner's groups stay at the expanded sizes; why_new=Cycle 0046 row 328 (a Restore ends a Read too, and gives sizes back only where it arranges); seam=the workspace harness with the controlled runtime, a native layout of three rows, the arrange action, the reader's layout line, command log and layout read
test("a Restore after a Read in the live arrangement beside a third group of the learner's gives every group the size it had before the Read, also where it arranges nothing", async () => {
  // Arrange: the learner has three editor groups, one above the other; a live run puts its panes into the first two, and the learner reads the application enlarged.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}, {}] })
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
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('read-app')
    const duringRead = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )

    // Act: Arrange Study Workspace, which is the Restore of the Study pane.
    await harness.reader.action('arrange')

    // Assert
    assert.deepEqual(duringRead, {
      orientation: 1,
      groups: [{ size: 0.8 }, { size: 0.1 }, { size: 0.1 }],
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
          groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
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
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
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
    live = harness.reader.presentation.createViewport(
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
    harness.focusMutableDraft()
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
    assert.equal(restore, 'refused')
    assert.deepEqual(afterRestore, {
      layoutsApplied: 0,
      layout: { orientation: 1, groups: [{ size: 0.8 }, { size: 0.2 }] },
    })
    assert.deepEqual(
      await harness.editor.commands.executeCommand('vscode.getEditorLayout'),
      { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
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
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
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
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('read-app')
    await harness.reader.action('read-source')
    const duringSecondRead = harness.maximizedEditorGroup()

    // Act
    await harness.reader.close()

    // Assert
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
        layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
      },
    )
  } finally {
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
    live = harness.reader.presentation.createViewport(
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
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
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
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('read-app')
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1,
      groups: [{ size: 0.4 }, { size: 0.3 }, { size: 0.3 }],
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
        groups: harness.groups.length,
        state: harness.reader.presentationState().state,
      },
      { layoutsApplied: 0, groups: 3, state: 'closed' },
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
    live = harness.reader.presentation.createViewport(
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
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
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
    live = harness.reader.presentation.createViewport(
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
        layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
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
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    let live: { close(): void } | undefined
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
        live = harness.reader.presentation.createViewport(
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

      // Act
      await harness.reader.close()

      // Assert
      assert.deepEqual(duringEnlarge, {
        maximized: true,
        layout: { orientation: 1, groups: [{ size: 0.8 }, { size: 0.2 }] },
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
          ],
          maximized: false,
          layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
          learnersTabs: [1, 1],
        },
      )
    } finally {
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the sizes of the learner's own editor groups after Enlarge application and a Restore in the live arrangement beside a third group of the learner's, where the Restore arranges nothing: the groups have the sizes they had before the Enlarge; fails_when=the Enlarge keeps no sizes, the Restore ends the maximization with the editor's Expand and applies no arrangement there, so the groups stay at the expanded sizes; why_new=Cycle 0046 row 334; seam=the workspace harness with the controlled runtime, a native layout of three rows, the arrange action, command log and layout read
test("a Restore after Enlarge application in the live arrangement beside a third group of the learner's gives every group the size it had before the Enlarge, also where it arranges nothing", async () => {
  // Arrange: the learner has three editor groups, one above the other; a live run puts its panes into the first two, and the learner enlarges the application.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}, {}] })
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
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('enlarge-app')
    const duringEnlarge = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )

    // Act: Arrange Study Workspace, which is the Restore of the Study pane.
    await harness.reader.action('arrange')

    // Assert
    assert.deepEqual(duringEnlarge, {
      orientation: 1,
      groups: [{ size: 0.8 }, { size: 0.1 }, { size: 0.1 }],
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
          groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
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
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
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
      live = harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      await harness.reader.action(order.first)
      await harness.reader.action(order.second)
      const commandsBefore = harness.commands.length

      // Act
      await harness.reader.close()

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
          layout: await harness.editor.commands.executeCommand(
            'vscode.getEditorLayout',
          ),
        },
        {
          gridCommands: [
            'workbench.action.minimizeOtherEditors',
            'vscode.setEditorLayout',
          ],
          maximized: false,
          layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
        },
      )
    } finally {
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the widths of the three-pane columns after a Read of the explanation, which hides the side bars and resizes no group, followed by Enlarge application and a Close: the columns have the widths they had before the Read; fails_when=the Enlarge, which begins while the Read's maximization is on, keeps no sizes or keeps those the maximized grid answers, so the Close leaves the columns as the Enlarge's Expand left them; why_new=Cycle 0046 row 334 (an Enlarge during a reading keeps the layout the reading began with); seam=the workspace harness's side bar model and three-pane columns in pixels, command log and layout read
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
          groups: [
            { size: 617, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 504 },
          ],
        },
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
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
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
    live = harness.reader.presentation.createViewport(
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
        layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
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
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}, {}] })
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
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
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

    // Act: the learner goes to a draft of their own while the editor answers; the Restore is refused; then the learner closes the Study workspace.
    harness.focusMutableDraft()
    giveBackRead.release()
    const restore = await restoring
    const layoutsAppliedByRestore = harness.commands
      .slice(commandsBefore)
      .filter((command) => command === 'vscode.setEditorLayout').length
    await harness.reader.close()

    // Assert
    assert.deepEqual(
      { restore, layoutsAppliedByRestore },
      { restore: 'refused', layoutsAppliedByRestore: 0 },
    )
    assert.deepEqual(
      await harness.editor.commands.executeCommand('vscode.getEditorLayout'),
      { orientation: 1, groups: [{ size: 1 }, { size: 1 }, { size: 1 }] },
    )
  } finally {
    release()
    live?.close()
    await harness.close()
  }
})

// Value: protects=the widths of the three-pane columns after a Read and a Close in an editor that keeps a group its last tab left (the learner turned workbench.editor.closeEmptyGroups off), where the Close has to end the maximization with the editor's Expand: the columns have the widths they had before the Read; fails_when=that Expand leaves every other group at its minimum size and nothing gives the sizes back, because a Read that hid the side bars kept none; why_new=Cycle 0046 row 334 (the audit of every command of the reader that resizes a group: the Close's own Expand, the limit row 323 stated); seam=the workspace harness's side bar model and three-pane columns in pixels, the fake editor that keeps emptied groups, command log and layout read
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

    // Assert
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
        layout: await harness.editor.commands.executeCommand(
          'vscode.getEditorLayout',
        ),
      },
      {
        gridCommands: [
          'workbench.action.minimizeOtherEditors',
          'vscode.setEditorLayout',
        ],
        maximized: false,
        sideBars: { primary: true, auxiliary: false, hasKeyboard: false },
        layout: {
          orientation: 0,
          groups: [
            { size: 617, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 504 },
          ],
        },
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
    name: 'the editor keeps the group the Study pane left empty',
    expected: { layoutsApplied: 0, groups: 3 },
  },
  {
    name: 'the reader is disposed and not closed by the learner',
    expected: { layoutsApplied: 0, groups: 2 },
  },
] as const)
  // Value: protects=the learner's editor groups at the end of a Study session in the three cases in which the layout of before the Open is not theirs to get back: a group no longer holds its tab of before, the editor was told to keep emptied groups, so there is one group more than before, and a reader that is disposed without the learner's Close; fails_when=the layout of before is applied all the same, over a group the learner changed, by merging a group the editor keeps, or at a disposal nobody asked for; why_new=Cycle 0046 row 339 (the guards of the give-back, each given up on purpose); seam=the workspace harness, a native layout of two columns, the fake editor's tab model changed as the learner's replacement of a file, closeDisposedPanelTabsLater, the reader's dispose and command log
  test(`the end of a Study session applies no layout of before the Open when ${situation.name}`, async () => {
    // Arrange: the learner has two editor groups side by side; the Study workspace is open.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 0.7 }, { size: 0.3 }],
    })
    if (situation.expected.groups === 2) harness.closeDisposedPanelTabsLater()
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
          firstGroup = harness.groups.find((group) => group.viewColumn === 1)!,
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
        // No tab was closed: the learner's file and the settings page are still tabs of the first group.
        assert.equal(firstGroup.tabs.includes(learnerFile.tab), true)
        assert.equal(firstGroup.tabs.includes(settings), true)
        assert.deepEqual(harness.tabCloseRequests(), [])
        // The measurement borrowed the keyboard for the main editor; the chat has it again through Cursor's own command, and no editor group was opened for that.
        assert.equal(chatGroup?.viewColumn, entry === 'Open replay' ? 3 : 4)
        assert.equal(harness.groups.length, entry === 'Open replay' ? 3 : 4)
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
