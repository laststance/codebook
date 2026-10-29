import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import type { ExtensionViewportIdentity } from '../chromeExtensionContracts'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'
import { startFakeChromeExtensionRun } from './utils/startFakeChromeExtensionRun'

const POPUP_IDENTITY: ExtensionViewportIdentity = {
  manifestName: 'Bookmark Notes',
  surface: { kind: 'popup', path: 'popup.html' },
  clickTitles: ['Add note'],
}

/** Opens the Application view of one extension run on the harness's workspace, as the run's start does. */
async function openView(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  runId: string,
) {
  const create = harness.reader.presentation.createChromeExtensionViewport
  assert.ok(create)
  const view = await create(runId)
  view.setIdentity(POPUP_IDENTITY)
  return view
}

/** Writes a file into the harness's repository, so the fake editor can show it; a paused file exists on disk. */
async function writeRepositoryFile(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  filename: string,
): Promise<void> {
  await writeFile(
    join(harness.directory, filename),
    `// ${filename}\nawait chrome.storage.local.set({ theme: 'dark' })\n`,
  )
}

/** Names the group whose tabs include one with this label, if any. */
function groupShowing(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  label: string,
) {
  return harness.groups.find((group) =>
    group.tabs.some((tab) => tab.label === label),
  )
}

// protects=ER22: the view of an ended extension run stays on screen with its last frame and result line, in the same pane, until a next run or the learner replaces it; fails_when=the lease release closes the pane of an ended extension run; no_claim=native keyboard behaviour in a real editor
test('the Application view of an ended extension run stays open after its lease is released', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const view = await openView(harness, 'ended-run-1')
    const pane = harness.reader['app']
    const panelsBefore = harness.counts().panels
    // Act
    view.end('Clicked Add note; the saved title read "Bookmark Notes".')
    view.close()
    // Assert
    assert.equal(harness.reader['app'], pane)
    assert.equal(harness.counts().panels, panelsBefore)
    assert.equal(harness.reader['viewport'], undefined)
    const lastPane = harness.viewportInstances[0]!.extensionPanes.at(-1)
    assert.equal(lastPane?.phase, 'Run ended · no view was captured')
    assert.equal(
      lastPane?.message,
      'Clicked Add note; the saved title read "Bookmark Notes".',
    )
  } finally {
    await harness.close()
  }
})

// protects=a run that ends before its view reached a last content (a lease released without end or failure) closes its pane like every other profile; fails_when=the keep rule keeps the pane of any extension lease; no_claim=the ended view's content
test('the Application pane of an extension run released without a last view is closed', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const view = await openView(harness, 'unfinished-run-1')
    // Act
    view.close()
    // Assert
    await waitUntil(
      () => harness.counts().panels === 0,
      'the unfinished extension run closes its Application pane',
      5_000,
    )
    assert.equal(harness.reader['app'], undefined)
  } finally {
    await harness.close()
  }
})

// protects=N61-1 (Cycle 0062 task 3): an extension run started from Cursor's Agent chat, with the first main editor group empty, opens its Application view and leaves the chat its keyboard; fails_when=the lease refuses with "Focus the first main source group before preparing the Application." because the Agent chat's tab group is counted beside the main groups; no_claim=Cursor's native focus events (N62)
test('an extension run started from Cursor\u2019s Agent chat with an empty first group opens its Application view and keeps the chat\u2019s keyboard', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.groups[0]!.tabs = []
    harness.groups[0]!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    chat.focusTab()
    // Act
    const view = await openView(harness, 'cursor-agent-run-1')
    // Assert
    assert.ok(harness.reader['app'])
    assert.equal(chat.focused(), true)
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=D1 (Cycle 0062 task 1): an extension run started while the learner's focused tab is a preview that is no text editor (an image opened by one click) opens its Application view in its own group and leaves that tab open as a preview; fails_when=the lease refuses with "A destination group contains a foreign preview: …" although the pane goes into a new group and never replaces the tab; no_claim=the native editor's own preview replacement
test('an extension run started beside a focused image preview opens its Application view and leaves the preview open', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const image = harness.addOpaqueTab('logo.png', 1)
    image.isPreview = true
    harness.focusOpaqueTab(image)
    // Act
    const view = await openView(harness, 'image-preview-run-1')
    // Assert
    assert.ok(harness.reader['app'])
    assert.equal(image.isPreview, true)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(image)),
      true,
    )
    assert.deepEqual(harness.tabCloseRequests(), [])
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=D2 (Cycle 0062 task 2): a stop's paused file that Cursor opens in front of the extension view, in the locked Application group, moves to the source group beside it, so the extension view and the stopped source stay visible in separate groups (DR6); fails_when=the paused file stays in front of the Application pane and covers the extension view, as Cursor 3.27.22 showed in the dry run of 2026-10-30; no_claim=Cursor's own routing of the paused file, the keyboard at the stop
test('a paused file Cursor opens in front of the extension view moves to the source group and leaves the view in front', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeFile(
      join(harness.directory, 'settings.js'),
      "await chrome.storage.local.set({ theme: 'dark' })\n",
    )
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'cursor-paused-run-1')
    const pane = harness.reader['app']
    assert.ok(pane?.viewColumn)
    const applicationColumn = pane.viewColumn
    // Act
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    // Assert
    const applicationGroup = () =>
        harness.groups.find((group) => group.viewColumn === applicationColumn),
      groupShowingPausedFile = () =>
        harness.groups.find((group) =>
          group.tabs.some((tab) => tab.label === 'settings.js'),
        )
    await waitUntil(
      () =>
        groupShowingPausedFile() !== undefined &&
        groupShowingPausedFile() !== applicationGroup(),
      'the paused file moves out of the Application group',
      5_000,
    )
    assert.equal(applicationGroup()?.tabs.length, 1)
    assert.equal(applicationGroup()?.activeTab, applicationGroup()?.tabs[0])
    const sourceGroup = groupShowingPausedFile()
    assert.ok(sourceGroup)
    assert.notEqual(sourceGroup.viewColumn, applicationColumn)
    assert.equal(sourceGroup.activeTab?.label, 'settings.js')
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=OCR-M3 (Cycle 0062 review): a file the learner keeps in front of the extension view (a tab that is no preview) stays in the Application group, while the paused file the editor opens there next still moves out; fails_when=the watch moves any text tab of the Application group, the learner's own kept tab first; no_claim=how the learner put the tab there
test('a file the learner keeps in the Application group stays there while the next paused file moves out', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'notes.js')
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'kept-tab-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    // Act
    harness.openAnnouncedTextTab('notes.js', applicationColumn, {
      isPreview: false,
      isDirty: false,
    })
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    // Assert
    await waitUntil(
      () =>
        groupShowing(harness, 'settings.js') !== undefined &&
        groupShowing(harness, 'settings.js')?.viewColumn !== applicationColumn,
      'the paused file moves out of the Application group',
      5_000,
    )
    assert.equal(
      groupShowing(harness, 'notes.js')?.viewColumn,
      applicationColumn,
    )
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=OCR-H1 (Cycle 0062 review): a preview with unsaved changes in front of the extension view is never moved, so its changes are never put at risk by a close, while the next paused file still moves out; fails_when=the watch closes an edited tab, which asks to save or loses the edits; no_claim=the editor's own save prompt
test('an edited preview in the Application group stays there while the next paused file moves out', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'draft.js')
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'edited-tab-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    // Act
    harness.openAnnouncedTextTab('draft.js', applicationColumn, {
      isPreview: true,
      isDirty: true,
    })
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    // Assert
    await waitUntil(
      () =>
        groupShowing(harness, 'settings.js') !== undefined &&
        groupShowing(harness, 'settings.js')?.viewColumn !== applicationColumn,
      'the paused file moves out of the Application group',
      5_000,
    )
    assert.equal(
      groupShowing(harness, 'draft.js')?.viewColumn,
      applicationColumn,
    )
    assert.deepEqual(
      harness
        .tabCloseRequests()
        .flat()
        .map((tab) => tab.label),
      ['settings.js'],
    )
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=OCR-H2 (Cycle 0062 review): a paused file the editor cannot show in the source group stays open in front of the view instead of being closed and lost, and the next stop's file still moves out; fails_when=the move closes the tab before the show and the show fails, so the learner's paused file disappears; no_claim=why the editor refuses the show
test('a paused file the editor cannot show elsewhere stays open while the next paused file moves out', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'failed-show-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    // Act: the first paused file is gone from disk, so the fake editor refuses to show it.
    harness.openPausedFileInLockedGroup('deleted.js', applicationColumn)
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    // Assert
    await waitUntil(
      () =>
        groupShowing(harness, 'settings.js') !== undefined &&
        groupShowing(harness, 'settings.js')?.viewColumn !== applicationColumn,
      'the next paused file moves out of the Application group',
      5_000,
    )
    assert.equal(
      groupShowing(harness, 'deleted.js')?.viewColumn,
      applicationColumn,
    )
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=CR6 (Cycle 0062 review, local CodeRabbit CLI): when the editor refuses to close the paused file's copy in front of the view, the watch tries again only up to its limit and then leaves it, instead of showing and closing it without end; fails_when=a refused close counts as a finished move, so the watch looks again, finds the copy and repeats forever; no_claim=why the editor refuses the close
test('a paused file whose close the editor refuses is moved only up to the attempt limit', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'refused-close-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    const showsOfPausedFile = () =>
      harness.textDocumentShows().filter((show) => show.name === 'settings.js')
    // Act: the editor refuses to close the paused file's tab in front of the view.
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    harness.refuseCloseOfTabsShowing('settings.js')
    await waitUntil(
      () => showsOfPausedFile().length >= 2,
      'the watch tries the move twice',
      5_000,
    )
    // gstack-timing-ok: a negative check; a looping watch shows the file again within a few fake-editor file reads, so this settle is enough to see a third show.
    await new Promise((resolve) => setTimeout(resolve, 200))
    // Assert
    assert.equal(showsOfPausedFile().length, 2)
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=Step 7 gap (Cycle 0062 ship): when the group below the Application group holds no editor (a chat part's tab), the paused file is not moved into it; fails_when=the move picks a chat part or any other group in place of the learner's group the Application group was inserted above; why_new=the other move tests all have the learner's group below; seam=none; no_claim=Cursor's own group numbering
test('a paused file is not moved into a group below the extension view that holds no editor', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'chat-below-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    const below = harness.groups.find(
      (group) => group.viewColumn === applicationColumn + 1,
    )
    assert.ok(below)
    below.tabs = []
    below.activeTab = undefined
    harness.addOpaqueTab('Agent chat', applicationColumn + 1)
    const showsBefore = harness.textDocumentShows().length
    // Act
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    // gstack-timing-ok: a negative check; a move would start its show at once, so one settle of the fake editor's file read is enough to see none.
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Assert
    assert.equal(harness.textDocumentShows().length, showsBefore)
    assert.equal(
      groupShowing(harness, 'settings.js')?.viewColumn,
      applicationColumn,
    )
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=Step 7 gap (Cycle 0062 ship): a paused file moved into a group that shows the learner's own preview tab opens there as a kept tab, so it never replaces that preview; fails_when=the move opens the paused file as a preview beside the learner's preview, which the editor would replace; why_new=the other move tests have no preview in the destination; seam=none; no_claim=the editor's own preview replacement
test('a paused file moved beside the learner’s preview tab opens as a kept tab and leaves the preview', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'preview-below-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    const learnersPreview = harness.addTextPreview(
      join(harness.directory, 'notes.js'),
      applicationColumn + 1,
    )
    // Act
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    // Assert
    await waitUntil(
      () =>
        groupShowing(harness, 'settings.js')?.viewColumn ===
        applicationColumn + 1,
      'the paused file moves into the group below',
      5_000,
    )
    const moved = groupShowing(harness, 'settings.js')?.tabs.find(
      (tab) => tab.label === 'settings.js',
    )
    assert.equal(moved?.isPreview, false)
    assert.equal(learnersPreview.isPreview, true)
    assert.equal(
      groupShowing(harness, 'notes.js')?.viewColumn,
      applicationColumn + 1,
    )
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=Step 7 gap (Cycle 0062 ship): the moved paused file keeps the line the editor revealed the stop at; fails_when=the move shows the file without the paused editor's selection, so the learner lands on another line than the stop; why_new=the other move tests do not read the moved editor's caret; seam=none; no_claim=the editor's own reveal scrolling
test('a paused file moved out of the Application group keeps the line the stop was revealed at', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'caret-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    // Act
    harness.openAnnouncedTextTab('settings.js', applicationColumn, {
      isPreview: true,
      isDirty: false,
      selectedLine: 41,
    })
    // Assert
    await waitUntil(
      () =>
        groupShowing(harness, 'settings.js')?.viewColumn ===
        applicationColumn + 1,
      'the paused file moves into the group below',
      5_000,
    )
    const movedEditor = harness.editor.window.visibleTextEditors.find(
      (editor) =>
        editor.viewColumn === applicationColumn + 1 &&
        editor.document.uri.path.endsWith('/settings.js'),
    )
    assert.equal(movedEditor?.selections[0]?.active.line, 41)
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=state cell paused-file x lease-release (Cycle 0062 ship review): once an extension run ends and its view is kept, the lease's watch is gone, so a preview the editor later opens in that group is not moved; fails_when=the watch outlives the released lease and moves files around a run that already ended; no_claim=what the kept view shows
test('a paused file opened after an extension run ended stays in the kept view’s group', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'ended-watch-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    view.end('The run ended.')
    view.close()
    assert.ok(harness.reader['app'])
    const showsBefore = harness.textDocumentShows().length
    // Act
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    // gstack-timing-ok: a negative check; a move would start its show at once, so one settle of the fake editor's file read is enough to see none.
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Assert
    assert.equal(harness.textDocumentShows().length, showsBefore)
    assert.equal(
      groupShowing(harness, 'settings.js')?.viewColumn,
      applicationColumn,
    )
  } finally {
    await harness.close()
  }
})

// protects=OCR-M2 (Cycle 0062 review): a second paused file that opens in front of the view while the first is being moved moves out too; fails_when=the watch drops the events that come during a move and never looks again, so the second file covers the view; no_claim=how fast two stops come natively
test('a second paused file opened during a move also leaves the Application group', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    await writeRepositoryFile(harness, 'service-worker.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'two-stops-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    const firstShow = harness.holdNextTextDocumentShow({
      uri: harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString(),
    })
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    await firstShow.started
    // Act
    harness.openPausedFileInLockedGroup('service-worker.js', applicationColumn)
    firstShow.release()
    // Assert
    await waitUntil(
      () =>
        harness.groups
          .find((group) => group.viewColumn === applicationColumn)
          ?.tabs.every(
            (tab) =>
              tab.label !== 'settings.js' && tab.label !== 'service-worker.js',
          ) ?? false,
      'both paused files leave the Application group',
      5_000,
    )
    assert.notEqual(groupShowing(harness, 'service-worker.js'), undefined)
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=OCR-M1 (Cycle 0062 review): once the learner closes the extension view during the run, the watch ends, so a preview in what is then the learner's first group is never moved; fails_when=the watch outlives the disposed pane and moves the learner's files between their own groups; no_claim=the editor's own group removal
test('a paused file opened after the learner closed the extension view stays where the editor opened it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'closed-view-run-1')
    const pane = harness.reader['app']
    assert.ok(pane)
    pane.dispose()
    const showsBefore = harness.textDocumentShows().length
    // Act
    harness.openPausedFileInLockedGroup('settings.js', 1)
    // gstack-timing-ok: a negative check; a move would start its show at once, so one settle of the fake editor's file read is enough to see none.
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Assert
    assert.equal(harness.textDocumentShows().length, showsBefore)
    assert.equal(groupShowing(harness, 'settings.js')?.viewColumn, 1)
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=ER22: a late cleanup of an older run never closes or replaces a newer run's view; fails_when=the older lease's release clears the newer lease, closes its pane or keeps the older pane as the kept view; no_claim=which pane object the editor reuses
test('a late cleanup of an older extension run leaves the newer run view open', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const older = await openView(harness, 'older-run-1')
    older.end('The older run ended.')
    const newer = await openView(harness, 'newer-run-1')
    const panelsBefore = harness.counts().panels
    const newerViewport = harness.viewportInstances[1]
    // Act
    older.close()
    // Assert
    assert.equal(harness.reader['viewport'], newerViewport)
    assert.equal(harness.counts().panels, panelsBefore)
    assert.notEqual(harness.reader['leaseId'], undefined)
    newer.close()
  } finally {
    await harness.close()
  }
})

// protects=ER22: the learner closing the tab drops the kept view of an ended run; fails_when=the workspace keeps pointing at a disposed pane; no_claim=the tab model of a real editor
test('closing the tab of an ended extension run drops its kept view', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const view = await openView(harness, 'ended-run-2')
    view.end('The run ended.')
    view.close()
    const pane = harness.reader['app']
    assert.ok(pane)
    // Act
    pane.dispose()
    // Assert
    assert.equal(harness.reader['app'], undefined)
  } finally {
    await harness.close()
  }
})

// protects=ER22 (Cycle 0062 task 8): a next extension run reuses the kept pane of an ended run without adding a disposal listener to it; fails_when=each run that reuses the kept pane adds another onDidDispose listener, so they pile up over a session; no_claim=how many listeners the editor itself holds
test('a next extension run reuses the kept Application pane without adding a disposal listener', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const first = await openView(harness, 'kept-run-1')
    first.end('The first run ended.')
    first.close()
    const pane = harness.reader['app']
    const listenersAfterFirstRun = harness.disposeListenerCount()
    // Act
    const second = await openView(harness, 'kept-run-2')
    second.end('The second run ended.')
    second.close()
    // Assert
    assert.equal(harness.reader['app'], pane)
    assert.equal(harness.disposeListenerCount(), listenersAfterFirstRun)
  } finally {
    await harness.close()
  }
})

// protects=SR13 and DR9: the editor's Save learning replay command refuses an extension run with its sentence, offers no Save item and changes no stored study; fails_when=the command stops the run, writes progress or answers another sentence; no_claim=the MCP surface's own refusal
test('Save learning replay of an extension run refuses and stores nothing', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const storage = await harness.reader.learningStorage()
    const progressBefore = await storage.readProgress()
    await startFakeChromeExtensionRun(harness)
    // Act
    const saving = harness.reader.saveLearningReplay()
    // Assert
    await assert.rejects(
      saving,
      new Error(
        'Saving an extension run is not available in this version; the live explanation stays in the chat.',
      ),
    )
    assert.deepEqual(await storage.readProgress(), progressBefore)
    await readerSeams(harness).refresh()
    assert.equal(harness.saveStatus.command, undefined)
  } finally {
    await harness.close()
  }
})

// protects=C4 and DR9: an extension run's status item shows the run's phase text from its view and carries no Save command, its tooltip saying why; fails_when=the item stays hidden during the run, shows Save learning replay, or words the phase differently from the viewport; no_claim=native status bar rendering
test('the status item of an extension run shows its phase text and offers no Save', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    // Act
    await startFakeChromeExtensionRun(harness)
    await readerSeams(harness).refresh()
    // Assert
    assert.equal(harness.saveStatus.visible, true)
    assert.equal(
      harness.saveStatus.text,
      'Waiting for chat · next click 1 of 2',
    )
    assert.equal(
      harness.saveStatus.tooltip,
      'Saving an extension run is not available in this version; the live explanation stays in the chat.',
    )
    assert.equal(harness.saveStatus.command, undefined)
  } finally {
    await harness.close()
  }
})
