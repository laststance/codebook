import assert from 'node:assert/strict'
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
