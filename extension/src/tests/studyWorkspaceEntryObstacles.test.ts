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

// Value: protects=Open replay opening the recording at the first click while the learner's file is the tab in front of the live Application pane; fails_when=the entry reveals the Application pane and starts its arrangement before the editor has reported that reveal, so its own reveal reads as a change the learner made and the click ends with "Native pane, group or focus changed while presentation waited; the learner arrangement was preserved."; why_new=Cycle 0045 NF-20 (Cursor: the first click failed whenever a preview or kept tab was in front of the pane, the second opened it); seam=the recorded reader harness, focusMutableDraft, and the fake editor reporting a pane's reveal one turn later
test("Open replay with the learner's file in front of the live Application pane opens the recording at the first click", async () => {
  // Arrange: the reader is open, and the file the learner (or the debugger) opened in the Application's group is in front of the pane with the keyboard focus.
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const learnerFile = harness.focusMutableDraft('login-form.tsx', 1)
    harness.revealPanelsLater()

    // Act: one click on Open replay.
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

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
