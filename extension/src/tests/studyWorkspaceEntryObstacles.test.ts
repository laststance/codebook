import assert from 'node:assert/strict'
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
