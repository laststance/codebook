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
