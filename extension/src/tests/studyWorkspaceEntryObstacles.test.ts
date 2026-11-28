import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  configuredWorkspaceHarness,
  recordedReaderHarness,
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

// Value: protects=the next Study placement after a run: the source preview the run's own debugger opened is kept instead of refusing as a foreign preview; fails_when=a preview of a run's stop file still ends Open replay with the foreign-preview refusal; why_new=Cycle 0063 N63-F7 (Cursor 3.27.22); seam=addTextPreview, the main editor never reporting focus beside a preview (hasMainEditorFocus)
test('Open replay beside the source preview the run own debugger opened keeps that tab and opens', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const agentChat = harness.addSeparateEditorPart()
    await mkdir(join(harness.directory, 'src'), { recursive: true })
    await writeFile(join(harness.directory, 'src', 'theme.ts'), 'export {}\n')
    const runPreview = harness.addTextPreview(
      join(harness.directory, 'src', 'theme.ts'),
      1,
      false,
      true,
    )
    agentChat.focus()
    const hasMainEditorFocus = harness.reader['hasMainEditorFocus'].bind(
      harness.reader,
    )
    harness.reader['hasMainEditorFocus'] = (groupCount: number): boolean =>
      groupCount === 1 && runPreview.isPreview
        ? false
        : hasMainEditorFocus(groupCount)

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().reason, undefined)
    assert.equal(runPreview.isPreview, false)
  } finally {
    await harness.close()
  }
})

// Value: protects=a dirty preview of a run's own stop file is the learner's edit and stays a preview when the next Study placement pins the run's previews; fails_when=the pin also takes a preview with unsaved changes, so the learner's edit tab is kept open without the learner's choice; why_new=Cycle 0064 pt2 /ship coverage audit; seam=addTextPreview with dirty, the main editor never reporting focus beside a preview (hasMainEditorFocus); no_claim=the real Cursor's answer (native Cursor trial), what the foreign-preview handling then asks
test('Open replay beside a dirty preview of the run stop file leaves that tab a preview', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const agentChat = harness.addSeparateEditorPart()
    await mkdir(join(harness.directory, 'src'), { recursive: true })
    await writeFile(join(harness.directory, 'src', 'theme.ts'), 'export {}\n')
    const dirtyPreview = harness.addTextPreview(
      join(harness.directory, 'src', 'theme.ts'),
      1,
      true,
      true,
    )
    agentChat.focus()
    const hasMainEditorFocus = harness.reader['hasMainEditorFocus'].bind(
      harness.reader,
    )
    harness.reader['hasMainEditorFocus'] = (groupCount: number): boolean =>
      groupCount === 1 && dirtyPreview.isPreview
        ? false
        : hasMainEditorFocus(groupCount)

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.equal(dirtyPreview.isPreview, true)
    assert.equal(dirtyPreview.isDirty, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a clean preview of a run's stop file standing behind the learner's tab is not pinned, because pinning shows it and would bring it in front of the tab the learner works in; fails_when=the next Study placement shows the background run preview, so it becomes the group's front tab or loses its preview state; why_new=Cycle 0064 pt2 /ship review pass 1; seam=addTextPreview behind focusMutableDraft's front tab, the main editor never reporting focus beside a preview (hasMainEditorFocus); no_claim=the real Cursor's answer (native Cursor trial), what the foreign-preview refusal then asks
test("Open replay leaves a run's stop-file preview behind the learner's tab a preview and the learner's tab in front", async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const agentChat = harness.addSeparateEditorPart()
    await mkdir(join(harness.directory, 'src'), { recursive: true })
    await writeFile(join(harness.directory, 'src', 'theme.ts'), 'export {}\n')
    harness.focusMutableDraft('notes.ts', 1)
    const backgroundRunPreview = harness.addTextPreview(
      join(harness.directory, 'src', 'theme.ts'),
      1,
    )
    const group = harness.groups.find(
      (candidate) => candidate.viewColumn === 1,
    )!
    agentChat.focus()
    const hasMainEditorFocus = harness.reader['hasMainEditorFocus'].bind(
      harness.reader,
    )
    harness.reader['hasMainEditorFocus'] = (groupCount: number): boolean =>
      groupCount === 1 && backgroundRunPreview.isPreview
        ? false
        : hasMainEditorFocus(groupCount)

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.equal(backgroundRunPreview.isPreview, true)
    assert.equal(group.activeTab?.label, 'notes.ts')
    assert.notEqual(group.activeTab, backgroundRunPreview)
  } finally {
    await harness.close()
  }
})

// Value: protects=the next Study placement when the editor refuses to pin a run's stop-file preview (the file was deleted after the stop): the open does not end with the editor's rejection; fails_when=the rejected show escapes the pin and Open replay ends with the file-read error instead of the foreign-preview handling; why_new=Cycle 0064 pt2 /ship Step 11 adversarial review; seam=addTextPreview for a file that no longer exists (the harness show rejects reading it), the main editor never reporting focus beside a preview (hasMainEditorFocus); no_claim=the real Cursor's answer (native Cursor trial)
test('Open replay beside a run stop-file preview the editor cannot pin goes on and leaves that tab a preview', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const agentChat = harness.addSeparateEditorPart()
    const stopFile = join(harness.directory, 'src', 'theme.ts')
    const runPreview = harness.addTextPreview(stopFile, 1, false, true)
    // The run's stop file is no file any more: the editor's show of it rejects.
    await rm(stopFile, { force: true })
    agentChat.focus()
    const hasMainEditorFocus = harness.reader['hasMainEditorFocus'].bind(
      harness.reader,
    )
    harness.reader['hasMainEditorFocus'] = (groupCount: number): boolean =>
      groupCount === 1 && runPreview.isPreview
        ? false
        : hasMainEditorFocus(groupCount)

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.equal(
      harness.controller.state().reason,
      'Error: The primary text editor could not be retained safely before scope measurement. Focus it explicitly and try again.',
    )
    assert.equal(runPreview.isPreview, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's choice made while the next Study placement pins the run's stop-file previews one after the other: a group whose front tab the learner changed meanwhile is not shown again; fails_when=the pin shows the stale preview of the second group over the learner's tab, which loses the front and the learner's work stands behind a preview; why_new=Cycle 0064 pt2 /ship Step 11 adversarial review; seam=addTextPreview in two groups, holdNextTextDocumentShow (the first pin in flight), focusMutableDraft (the learner's tab to the front of the second group), the main editor never reporting focus beside a preview (hasMainEditorFocus); no_claim=the real Cursor's answer (native Cursor trial), the placement's outcome after the pins
test("Open replay does not pin a run's stop-file preview in a group whose front tab the learner changed while the first pin was in flight", async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const agentChat = harness.addSeparateEditorPart()
    await mkdir(join(harness.directory, 'src'), { recursive: true })
    const stopFile = join(harness.directory, 'src', 'theme.ts')
    await writeFile(stopFile, 'export {}\n')
    const firstPreview = harness.addTextPreview(stopFile, 1, false, true)
    const secondPreview = harness.addTextPreview(stopFile, 2, false, true)
    agentChat.focus()
    const hasMainEditorFocus = harness.reader['hasMainEditorFocus'].bind(
      harness.reader,
    )
    harness.reader['hasMainEditorFocus'] = (groupCount: number): boolean =>
      firstPreview.isPreview || secondPreview.isPreview
        ? false
        : hasMainEditorFocus(groupCount)
    // The first show of the placement is the first group's pin.
    const firstPin = harness.holdNextTextDocumentShow()

    // Act
    const opening = harness.reader
      .openRecording(harness.studyId)
      .catch(() => undefined)
    await firstPin.started
    harness.focusMutableDraft('learner-notes.ts', 2)
    firstPin.release()
    await opening
    await harness.controller.settle()

    // Assert
    const secondGroup = harness.groups.find((group) =>
      group.tabs.includes(secondPreview),
    )!
    assert.equal(firstPreview.isPreview, false)
    assert.equal(secondPreview.isPreview, true)
    assert.equal(secondGroup.activeTab?.label, 'learner-notes.ts')
  } finally {
    await harness.close()
  }
})

// Value: protects=changing the presentation of an open Study in Cursor while the debugger's stop-file preview of the run is the front tab of a group: the preview is pinned and the selection succeeds; fails_when=the preview is collected before the pin replaces Cursor's group and tab objects, so the change ends with "The prepared preview changed before it could be retained."; why_new=Cycle 0064 pt2 /ship review pass 1 (Codex structured review); seam=addTextPreview as the front tab, replaceGroupObjectsOnTabChanges (Cursor rebuilds group and tab objects at a tab change), leavePaneFocusUnreportedBesideChat; no_claim=the real Cursor's answer (native Cursor trial)
test("a presentation change made from the chat while the run's stop-file preview is in front pins that preview and changes the presentation", async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    harness.replaceGroupObjectsOnTabChanges()
    await harness.reader.open()
    await mkdir(join(harness.directory, 'src'), { recursive: true })
    await writeFile(join(harness.directory, 'src', 'theme.ts'), 'export {}\n')
    harness.addTextPreview(
      join(harness.directory, 'src', 'theme.ts'),
      1,
      false,
      true,
    )
    // Cursor reports no primary focus in the main editor beside a preview.
    const hasMainEditorFocus = harness.reader['hasMainEditorFocus'].bind(
      harness.reader,
    )
    // Cursor rebuilds tab objects at a tab change, so the preview is looked up anew each time.
    const runPreviewTabs = () =>
      harness.groups
        .flatMap((group) => group.tabs)
        .filter((tab) => tab.label === 'theme.ts')
    harness.reader['hasMainEditorFocus'] = (groupCount: number): boolean =>
      runPreviewTabs().some((tab) => tab.isPreview)
        ? false
        : hasMainEditorFocus(groupCount)
    const state = harness.reader.presentationState()

    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })

    // Assert
    assert.equal(selected.reason, undefined)
    assert.equal(selected.state, 'open')
    assert.deepEqual(
      runPreviewTabs().map((tab) => tab.isPreview),
      [false],
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
