import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  workspaceHarness,
  configuredWorkspaceHarness,
} from './studyWorkspaceHarness'

const capturedSourceTabs = (
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
): number =>
  harness.groups
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        'uri' in tab.input &&
        String(tab.input.uri).startsWith('codebook-source://'),
    ).length

// Value: protects=a captured-source tab the learner pinned to keep an earlier run's source in view; fails_when=the one-tab-per-file rule closes every captured tab of the file without reading isPinned, so the pinned tab disappears when the same article runs again; why_new=Cycle 0045 CX-S1 (the filter compared only the URI); seam=the harness tab is pinned as the editor's Pin command marks it
test('a captured-source tab the learner pinned stays open when another run of the same file is shown', async () => {
  // Arrange: a first run stopped in src/theme.ts, and the learner pinned its captured-source tab.
  const harness = await configuredWorkspaceHarness()
  try {
    await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    const pinnedTab = harness.groups
      .flatMap((group) => group.tabs)
      .find(
        (tab) =>
          'uri' in tab.input &&
          tab.input.uri.path.endsWith('/Captured-theme.ts'),
      )
    assert.ok(pinnedTab)
    pinnedTab.isPinned = true

    // Act: a second run stops in the same file.
    await harness.start()
    await harness.reader.action('click')

    // Assert: the pinned capture stays beside the second run's own.
    const capturedThemeTabs = harness.groups
      .flatMap((group) => group.tabs)
      .filter(
        (tab) =>
          'uri' in tab.input &&
          tab.input.uri.path.endsWith('/Captured-theme.ts'),
      )
    assert.equal(capturedThemeTabs.includes(pinnedTab), true)
    assert.deepEqual(
      capturedThemeTabs.map((tab) => Boolean(tab.isPinned)),
      [true, false],
    )
  } finally {
    await harness.close()
  }
})

test('selecting a presentation on a closed reader closes a leftover captured-source tab that has no text editor and keeps the learner’s own tab', async () => {
  // Arrange: after a host restart the active tab is a captured source of this workspace, beside a learner draft and another workspace's captured source.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const foreign = harness.restoreLeftoverCapturedSource({
      active: false,
      authority: 'f'.repeat(64),
    })
    const draft = harness.focusMutableDraft()
    const leftover = harness.restoreLeftoverCapturedSource()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(tabs.includes(foreign), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

test('the leftover captured-source tab is closed on a reader that has not loaded its library yet', async () => {
  // Arrange: nothing has attached or opened this reader, so its workspace key is not known when the selection arrives.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const draft = harness.focusMutableDraft()
    const leftover = harness.restoreLeftoverCapturedSource()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(tabs.includes(draft.tab), true)
  } finally {
    await harness.close()
  }
})

test('a second presentation control sent while the leftover captured-source tabs are closing is refused', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    harness.focusMutableDraft()
    harness.restoreLeftoverCapturedSource()
    const state = harness.reader.presentationState(),
      request = {
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select' as const,
      }
    // Act
    const first = harness.reader.changePresentation(request)
    // Assert
    assert.throws(() => harness.reader.changePresentation(request), {
      code: 'PRESENTATION_UNAVAILABLE',
      message:
        'A presentation change or reader close is pending. Read its state before another control.',
    })
    assert.equal((await first).layoutConfirmed, true)
    assert.equal(harness.reader.presentationState().state, 'open')
  } finally {
    await harness.close()
  }
})

test('a selection still succeeds when the editor reports the next text editor a moment after the leftover tab closed', async () => {
  // Arrange: the tab model names the learner draft at once, the active text editor follows 60 ms later.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const draft = harness.focusMutableDraft()
    const leftover = harness.restoreLeftoverCapturedSource({
      lateTextEditor: true,
    })
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(tabs.includes(draft.tab), true)
    // The draft the editor activated in the leftover tab's place shares the Application pane's group: the pane is in front and has the keyboard focus that draft had, and the draft is still open behind it (Cycle 0045 NF-1 as DR-5; the draft was fronted and focused again before).
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(
      harness.groups.find((group) => group.tabs.includes(draft.tab))
        ?.activeTab === draft.tab,
      false,
    )
    assert.equal(
      harness.groups.find((group) => group.tabs.includes(draft.tab))
        ?.viewColumn,
      1,
    )
    assert.equal(selected.panes.appColumn, 1)
  } finally {
    await harness.close()
  }
})

test('a leftover captured-source tab the editor refuses to close leaves every tab in place and reports why the selection could not start', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const draft = harness.focusMutableDraft()
    const leftover = harness.restoreLeftoverCapturedSource({
      refuseClose: true,
    })
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.flatMap((group) => group.tabs)
    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'The presentation was not changed: the focused tab "Captured-login-form.tsx" in editor group 1 has no text editor, so the focus could not be given back to it. Close that tab or click into another editor, then try again.',
        causeDetail: 'A leftover captured source tab could not be closed.',
      },
    )
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(tabs.length, tabsBefore.length)
    assert.equal(tabs.includes(leftover), true)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
  } finally {
    harness.acceptLeftoverClose()
    await harness.close()
  }
})

test('a closed reader opens when closing its focused leftover captured-source tab leaves a non-text page of the editor active', async () => {
  // Arrange: after a host restart the group holds the editor's own Settings page and, with focus, a captured source of this workspace.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const settingsPage = harness.useOpaquePrimary('settings')
    const leftover = harness.restoreLeftoverCapturedSource()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(
      tabs.some((tab) => tab === settingsPage),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection on a closed reader being admitted while a page of the editor that is no text editor has the focus in the Application's group, with that page left open behind the pane; fails_when=the admission refuses a focused non-text page again, or the page is closed or moved to make room for the pane; why_new=Cycle 0045 cause 7 (this test asserted the refusal "Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely." until then); seam=useOpaquePrimary, restoreLeftoverCapturedSource
test('a closed reader behind a focused non-text page of the editor opens, closes the leftover captured-source tab and keeps that page open behind the Application pane', async () => {
  // Arrange: the active tab is the editor's Settings page; a leftover captured source sits inactive in the same group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const settingsPage = harness.useOpaquePrimary('settings')
    const leftover = harness.restoreLeftoverCapturedSource({ active: false })
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const applicationGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(leftover),
      false,
    )
    assert.equal(applicationGroup.tabs[0], settingsPage)
    assert.equal(
      Reflect.get(applicationGroup.activeTab!.input, 'viewType'),
      'codebook.scopedBrowser',
    )
    // The keyboard focus stays on the placed captured source; the page is not fronted again.
    assert.equal(harness.editor.window.tabGroups.activeTabGroup.viewColumn, 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection on an open reader never closes the captured source it is showing; fails_when=the closed-reader condition is dropped from the leftover-tab list, so an open reader's own captured-source tabs are closed as leftovers; why_new=Cycle 0044 0036-C07a: the earlier test left the learner's focus on a text editor, so the leftover-tab step never ran and the condition was never reached; seam=restoreLeftoverCapturedSource
test('selecting a presentation on an open reader whose focused captured-source tab has no text editor closes none of its captured-source tabs', async () => {
  // Arrange: the reader is open and shows its captured source; the tab that has focus is a captured source of this workspace without a text editor.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const focusedCapturedSource = harness.restoreLeftoverCapturedSource()
    const capturedBefore = capturedSourceTabs(harness),
      closeRequestsBefore = harness.tabCloseRequests().length,
      state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    assert.equal(capturedBefore, 2)
    assert.equal(capturedSourceTabs(harness), 2)
    assert.equal(harness.tabCloseRequests().length, closeRequestsBefore)
    assert.equal(
      harness.groups
        .flatMap((group) => group.tabs)
        .includes(focusedCapturedSource),
      true,
    )
  } finally {
    await harness.close()
  }
})

/** Counts the tabs of one Codebook pane kind, in the registered or the main-thread form, for the dead-pane tests. @example codebookPaneTabs(harness, 'codebook.scopedBrowser') // 1 */
const codebookPaneTabs = (
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  kind: 'codebook.scopedBrowser' | 'codebook.studyContext',
): number =>
  harness.groups
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        'viewType' in tab.input &&
        [kind, `mainThreadWebview-${kind}`].includes(tab.input.viewType),
    ).length

// Value: protects=the reader recognizes exactly the old host's pane as dead and asks the editor to close that tab alone; fails_when=the dead-pane reader answers none, or takes the learner's tabs or this host's live Wiki pane for dead; why_new=Cycle 0044 0037-D8: the earlier test of this name asserted the fake editor only and never called the reader; seam=leaveDeadCodebookPane
test('the first presentation selection after an extension-host restart asks the editor to close the old host’s dead Study pane and no other tab', async () => {
  // Arrange: the old host's Study pane is the only tab of column 3; the learner's draft has focus in column 1 and this host's Repository Wiki pane is open in column 2.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    harness.focusMutableDraft('mutable-notes.txt', 1)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    assert.equal(selected.layoutConfirmed, true)
    assert.deepEqual(harness.tabCloseRequests()[0], [deadStudy])
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
  } finally {
    await harness.close()
  }
})

test('the first presentation selection after an extension-host restart closes the old host’s dead Application and Study panes and is confirmed', async () => {
  // Arrange: the old host's Application pane is still the visible tab of column 1, its Study pane sits in column 3 behind the learner draft that has focus, and the new Application panel registers a moment after it is created.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const articleSource = harness.groups[0]!.tabs[0]!,
      wiki = harness.groups[1]!.tabs[0]!
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
      ),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
    harness.delayPanelRegistration('codebook.scopedBrowser', true)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
    // The learner's draft, a second workspace file and another extension's webview are untouched.
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(tabs.includes(articleSource), true)
    assert.equal(tabs.includes(wiki), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

test('the first presentation selection is confirmed when the old host’s dead Study pane had focus and no text editor was active', async () => {
  // Arrange: focus sits on the dead Study pane, the only tab of column 3; the learner draft of column 1 is open behind the dead Application pane.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const articleSource = harness.groups[0]!.tabs[0]!,
      wiki = harness.groups[1]!.tabs[0]!
    const draft = harness.focusMutableDraft('mutable-notes.txt', 1)
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
      ),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3, {
        focused: true,
      })
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(tabs.includes(articleSource), true)
    assert.equal(tabs.includes(wiki), true)
  } finally {
    await harness.close()
  }
})

test('the first presentation selection closes a dead Application pane together with the focused leftover captured-source tab', async () => {
  // Arrange: the state the installed trial met: the old host's Application pane as the visible tab of column 1 and, with focus in column 2, a captured source of this workspace; the new Application panel registers a moment after it is created.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    const articleSource = harness.groups[0]!.tabs[0]!,
      wiki = harness.groups[1]!.tabs[0]!
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
      ),
      leftover = harness.restoreLeftoverCapturedSource({ column: 2 })
    harness.delayPanelRegistration('codebook.scopedBrowser', true)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(tabs.includes(articleSource), true)
    assert.equal(tabs.includes(wiki), true)
  } finally {
    await harness.close()
  }
})

test('a presentation selection on a closed reader that already owns a live Application panel closes no Codebook pane', async () => {
  // Arrange: a run created the Application panel before the reader was opened.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const draft = harness.focusMutableDraft()
  const viewport = await harness.reader.presentation.createViewport(
    'run-before-reader',
    () => {},
    () => {},
    'normal',
  )
  try {
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(
      harness
        .tabCloseRequests()
        .flat()
        .some((tab) => 'viewType' in tab.input),
      false,
    )
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(tabs.includes(draft.tab), true)
  } finally {
    viewport.close()
    await harness.close()
  }
})

// Value: protects=a dead pane the editor keeps ends the selection with the instruction to close it, whatever the editor closed in other groups; fails_when=the kept pane is read from the editor's one answer instead of from the tab model, or a panel is created beside the kept pane; why_new=Cycle 0044 0037-F4, 0037-D8: the fake editor closed all requested tabs or none, while the editor closes group by group; seam=leaveDeadCodebookPane refuseClose
test('a dead Codebook pane the editor refuses to close stays in its group while the dead pane of another group closes, and the selection tells why it could not start', async () => {
  // Arrange: the editor keeps the dead Application pane of column 1 and lets the dead Study pane of column 3 close.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const draft = harness.focusMutableDraft('mutable-notes.txt', 2)
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
        { refuseClose: true },
      ),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.flatMap((group) => group.tabs)
    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        causeDetail: 'A leftover Codebook pane could not be closed.',
      },
    )
    // Assert: only the dead pane the editor released is gone.
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.deepEqual(
      tabs,
      tabsBefore.filter((tab) => tab !== deadStudy),
    )
    assert.equal(tabs.includes(deadApplication), true)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection refused over a dead Codebook pane is confirmed when repeated once the editor lets the pane close; fails_when=the refusal leaves its pending transition or its kept-pane verdict behind, so the repeated selection is refused again; why_new=the refusal test stops at the refusal and never sends the selection again; seam=none
test('a presentation selection refused over a dead Codebook pane is confirmed when it is repeated once the editor lets the pane close', async () => {
  // Arrange: the editor refused to close the old host's panes, so the first selection ended with the instruction to close them and select again.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
        { refuseClose: true },
      ),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
    const refusedState = harness.reader.presentationState()
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: refusedState.presentationId,
        expectedRevision: refusedState.presentationControlRevision,
        mode: refusedState.mode,
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail: 'A leftover Codebook pane could not be closed.',
      },
    )
    harness.acceptDeadPaneClose()
    // Act: the agent reads the presentation state again and repeats the selection.
    const state = harness.reader.presentationState()
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection behind a foreign non-text editor stays refused and opens no pane when an earlier extension session left a dead Codebook pane elsewhere; fails_when=closing a dead pane is reported as closing the focused tab, so the focus guard is skipped and the reader opens over the foreign editor; why_new=the foreign-editor refusal test has no dead pane, so its refusal is thrown before the close step ever runs; seam=none
test('a closed reader behind a focused non-text page of the editor opens when an earlier extension session left a dead Study pane in another group, and that page stays open', async () => {
  // Arrange: the editor's Settings page has focus in column 1; the old host's Study pane is the only tab of column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const settingsPage = harness.useOpaquePrimary('settings')
    const deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(harness.counts().panels, 2)
    // The learner's Settings page is still a tab of its group, behind the Application pane.
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 1)?.tabs[0],
      settingsPage,
    )
  } finally {
    await harness.close()
  }
})

/** Tells whether a request answered before one second passed, so a test can show that the five-second editor-agreement wait did not run. @example await answeredWithinOneSecond(request) // true */
const answeredWithinOneSecond = async (
  request: Promise<unknown>,
): Promise<boolean> => {
  const deadline = new AbortController()
  try {
    return await Promise.race([
      request.then(
        () => true,
        () => true,
      ),
      delay(1_000, false, { signal: deadline.signal }),
    ])
  } finally {
    deadline.abort()
  }
}

/** Waits until the editor has removed a tab, so a test can act between the close and the admission that follows it. @example await tabClosed(harness, leftover) */
const tabClosed = async (
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  tab: ReturnType<typeof harness.restoreLeftoverCapturedSource>,
): Promise<void> => {
  while (harness.groups.flatMap((group) => group.tabs).includes(tab))
    await new Promise<void>((resolve) => setImmediate(resolve))
}

const TAB_WITHOUT_EDITOR_REFUSAL =
  'The presentation was not changed: the focused tab "Captured-login-form.tsx" in editor group 1 has no text editor, so the focus could not be given back to it. Close that tab or click into another editor, then try again.'

// Value: protects=a selection that has no leftover tab to close is answered at once; fails_when=the editor-agreement wait runs although no tab closed, so the refusal arrives after five seconds; why_new=Cycle 0044 0036-C06a: no test had another workspace's captured-source tab as the focused tab; seam=restoreLeftoverCapturedSource authority
test('a selection behind another workspace’s captured-source tab is refused without the five-second editor wait', async () => {
  // Arrange: the focused tab is a captured source of another workspace, restored without a text editor; this workspace left no tab.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    harness.restoreLeftoverCapturedSource({ authority: 'f'.repeat(64) })
    const state = harness.reader.presentationState()
    // Act
    const request = Promise.resolve().then(() =>
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      }),
    )
    const answered = await answeredWithinOneSecond(request)
    // Assert
    assert.equal(answered, true)
    await assert.rejects(request, {
      code: 'PRESENTATION_UNAVAILABLE',
      message: TAB_WITHOUT_EDITOR_REFUSAL,
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=a refused selection leaves this workspace's leftover tabs where they are; fails_when=the leftover tabs are closed before the refusal for a focus that cannot be kept; why_new=Cycle 0044 0036-C06b: no test combined a foreign workspace's focused captured source with an own leftover tab; seam=restoreLeftoverCapturedSource authority
test('a selection refused behind another workspace’s captured-source tab closes none of this workspace’s leftover tabs', async () => {
  // Arrange: this workspace's leftover captured source sits inactive beside the focused captured source of another workspace.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const leftover = harness.restoreLeftoverCapturedSource({ active: false })
    harness.restoreLeftoverCapturedSource({ authority: 'f'.repeat(64) })
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.flatMap((group) => group.tabs)
    // Act
    await assert.rejects(
      async () =>
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: state.mode,
          action: 'select',
        }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message: TAB_WITHOUT_EDITOR_REFUSAL,
      },
    )
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.deepEqual(tabs, tabsBefore)
    assert.equal(tabs.includes(leftover), true)
    assert.deepEqual(harness.tabCloseRequests(), [])
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    await harness.close()
  }
})

// Value: protects=the selection is admitted on the editor's settled state when a non-text page replaces the closed leftover tab; fails_when=the admission runs while the active text editor still reports the document of the tab that closed, and tries to give focus back to it; why_new=Cycle 0044 0036-C06c: the late-editor test ends on a text tab, where the wait already ran; seam=restoreLeftoverCapturedSource staleTextEditor
test('a selection is confirmed when the editor still reports the closed captured source as its text editor for a moment after its Settings page took the tab’s place', async () => {
  // Arrange: the group holds the editor's Settings page and, with focus, a leftover captured source; for 60 ms after the close the editor still reports that source as its active text editor.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const settingsPage = harness.useOpaquePrimary('settings')
    const leftover = harness.restoreLeftoverCapturedSource({
      staleTextEditor: true,
    })
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(
      tabs.some((tab) => tab === settingsPage),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a captured source this host itself shows in a text editor is kept by a selection on a closed reader; fails_when=the leftover-tab step takes every captured-source tab of the workspace for a leftover, with or without a text editor; why_new=Cycle 0044 0036-C06d: every earlier leftover tab was one without a text editor; seam=restoreLeftoverCapturedSource textEditor
test('a selection on a closed reader does not close a focused captured-source tab that has a text editor', async () => {
  // Arrange: a first open that failed left this host's captured source open in a live text editor, and the reader closed.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const liveCapturedSource = harness.restoreLeftoverCapturedSource({
      textEditor: true,
    })
    const state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    assert.equal(
      harness.tabCloseRequests().flat().includes(liveCapturedSource),
      false,
    )
    assert.equal(
      harness.groups
        .flatMap((group) => group.tabs)
        .includes(liveCapturedSource),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a page that is no text editor staying open, behind the pane placed in its group, when it had the focus at a selection; fails_when=the selection is refused for that page, or the page is closed, moved or fronted again over the placed pane; why_new=Cycle 0045 cause 7 (until then this test moved the learner to such a page while leftover tabs closed and asserted the refusal "Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely."); seam=focusOpaqueTab
test('a presentation selection made while a tab that is not a text editor has the focus in a group the Study panes use keeps that tab open behind the placed pane', async () => {
  // Arrange: an extension's page has the focus in column 2, where Study workspace shows the captured source; the learner's draft is in column 1.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    await harness.reader.attach(harness.service)
    const draft = harness.focusMutableDraft('mutable-notes.txt', 1)
    const extensionPage = harness.addOpaqueTab('Extension page', 2)
    harness.focusOpaqueTab(extensionPage)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const sourceGroup = harness.groups.find((group) => group.viewColumn === 2)!
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(sourceGroup.tabs[0], extensionPage)
    assert.match(
      String(Reflect.get(sourceGroup.activeTab!.input, 'uri')),
      /^codebook-source:\/\//,
    )
    // The keyboard focus stays on the placed captured source, and the learner's draft is untouched.
    assert.equal(harness.editor.window.tabGroups.activeTabGroup, sourceGroup)
    assert.equal(draft.tab.isDirty, true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

// Value: protects=closing the reader ends a selection that is waiting for the editor after it closed a leftover tab; fails_when=the wait ignores the reader's cancellation and holds the selection for five seconds, or the selection goes on to open a pane on the closed reader; why_new=Cycle 0044 0036-C07d: no test closed the reader during the leftover-tab step; seam=restoreLeftoverCapturedSource authority
test('closing the reader while a selection waits for the editor after closing a leftover tab ends the selection at once and opens no pane', async () => {
  // Arrange: closing the focused leftover tab activates another workspace's captured source, for which the editor never reports a text editor, so the selection waits.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    harness.restoreLeftoverCapturedSource({
      active: false,
      authority: 'f'.repeat(64),
    })
    const leftover = harness.restoreLeftoverCapturedSource()
    const state = harness.reader.presentationState()
    const request = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    request.catch(() => undefined)
    await tabClosed(harness, leftover)
    // Act
    const closing = harness.reader.close()
    const answered = await answeredWithinOneSecond(request)
    await closing
    // Assert
    assert.equal(answered, true)
    await assert.rejects(request, {
      message:
        'The study workspace was closed; repeat the action explicitly if needed.',
    })
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=the dead panes of an earlier host are closed by the first selection although a run already created this host's Application panel; fails_when=the dead-pane reader answers none as soon as this host owns a panel, so the selection meets two Application tabs; why_new=Cycle 0044 0037-D3: the only test with a panel created first had no dead pane; seam=leaveDeadCodebookPane
test('the first presentation selection closes the old host’s dead panes when a run created this host’s Application panel before the reader was opened', async (context) => {
  // Arrange: the old host's panes are in columns 1 and 3; an agent run then creates this host's Application panel, and the learner's draft has focus in column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
    ),
    deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
  const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
  const createPanel = harness.editor.window.createWebviewPanel
  context.mock.method(
    harness.editor.window,
    'createWebviewPanel',
    (...arguments_: Parameters<typeof createPanel>) => {
      // Native registration requires the earlier host's tabs gone before the new pane is created.
      if (arguments_[0] === 'codebook.scopedBrowser') {
        const tabs = harness.groups.flatMap((group) => group.tabs)
        assert.equal(tabs.includes(deadApplication), false)
        assert.equal(tabs.includes(deadStudy), false)
      }
      return createPanel(...arguments_)
    },
  )
  let viewport:
    | Awaited<ReturnType<typeof harness.reader.presentation.createViewport>>
    | undefined
  try {
    viewport = await harness.reader.presentation.createViewport(
      'run-before-reader',
      () => {},
      () => {},
      'normal',
    )
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
    assert.equal(tabs.includes(draft.tab), true)
  } finally {
    context.mock.restoreAll()
    viewport?.close()
    await harness.close()
  }
})

for (const laterChoice of ['new source', 'Close'] as const)
  test(`cold prepared Study preserves ${laterChoice} while its preference write drains`, async () => {
    // Arrange: native App preparation preserves three original groups, so cold selection confirms that actual four-group layout.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
    const viewport = await harness.reader.presentation.createViewport(
      'prepared-preference',
      () => {},
      () => {},
      'normal',
    )
    const held = harness.holdPresentationPreference(),
      state = harness.reader.presentationState()
    let outcome: Promise<void> | undefined, closing: Promise<void> | undefined
    try {
      const selection = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      })
      outcome = assert.rejects(selection, /closed|changed|not confirmed/i)
      await held.started
      const commandsBefore = harness.commands.length

      // Act: the accepted preference write must drain, but cannot certify the old UI after newer input or Close.
      const draft =
        laterChoice === 'new source'
          ? harness.focusMutableDraft('later-choice.txt', 3)
          : undefined
      if (laterChoice === 'Close') closing = harness.reader.close()
      held.release()
      await outcome
      await closing

      // Assert
      if (draft) {
        assert.equal(
          harness.focusedSource()?.document.uri.toString(),
          draft.document.uri.toString(),
        )
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
        assert.equal(draft.tab.isDirty, true)
        assert.equal(
          harness.commands
            .slice(commandsBefore)
            .includes('vscode.setEditorLayout'),
          false,
        )
      } else {
        assert.equal(harness.reader.inspect().opened, false)
        assert.equal(harness.counts().panels, 0)
      }
    } finally {
      held.release()
      await outcome?.catch(() => undefined)
      await closing
      viewport.close()
      await harness.close()
    }
  })

test('MCP-first acquisition preserves a refused stale pane without allocating another Application', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const dead = harness.leaveDeadCodebookPane('codebook.scopedBrowser', 1, {
      refuseClose: true,
    }),
    draft = harness.focusMutableDraft('retained-draft.txt', 2),
    commandsBefore = harness.commands.length
  try {
    // Act
    await assert.rejects(
      Promise.resolve(
        harness.reader.presentation.createViewport(
          'refused-stale-pane',
          () => {},
          () => {},
          'normal',
        ),
      ),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'Close the leftover Codebook panes, then retry the live explanation.',
      },
    )

    // Assert
    assert.equal(harness.counts().panels, 0)
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.newGroupAbove'),
      false,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(dead)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft.tab)),
      true,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(draft.tab.isDirty, true)
  } finally {
    harness.acceptDeadPaneClose()
    await harness.close()
  }
})

test('Close during MCP-first stale-pane retirement prevents a later Application allocation', async (context) => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const dead = harness.leaveDeadCodebookPane('codebook.scopedBrowser', 1),
    draft = harness.focusMutableDraft('retained-draft.txt', 2),
    nativeClose = harness.editor.window.tabGroups.close,
    commandsBefore = harness.commands.length
  let release = (): void => {},
    closingOldPane = false,
    outcome: Promise<void> | undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  context.mock.method(
    harness.editor.window.tabGroups,
    'close',
    async (...arguments_: Parameters<typeof nativeClose>) => {
      const result = await nativeClose(...arguments_)
      // Hold only the first accepted native close response; Close's own later cleanup remains runnable.
      if (!closingOldPane) {
        closingOldPane = true
        await held
      }
      return result
    },
  )
  try {
    outcome = assert.rejects(
      Promise.resolve(
        harness.reader.presentation.createViewport(
          'closing-stale-pane',
          () => {},
          () => {},
          'normal',
        ),
      ),
      /closed/i,
    )
    await waitUntil(() => closingOldPane, 'the accepted stale-pane retirement')
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(dead)),
      false,
    )

    // Act
    await harness.reader.close()
    release()
    await outcome

    // Assert
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.counts().panels, 0)
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.newGroupAbove'),
      false,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(draft.tab.isDirty, true)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft.tab)),
      true,
    )
  } finally {
    release()
    await outcome?.catch(() => undefined)
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a dead pane the editor kept at a cold open is named by the next selection and closed once the editor lets it, without touching the open reader's captured source; fails_when=the selection of an open reader never looks for dead panes, so the kept pane is never reported; why_new=Cycle 0044 0037-D3: the cold-open refusal test stopped at the open; seam=leaveDeadCodebookPane refuseClose, acceptDeadPaneClose
test('a selection on a reader that opened beside a dead pane the editor kept names that pane, and closes it once the editor lets it', async () => {
  // Arrange: the editor refused to close the old host's Application pane when the Study workspace was opened.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
      { refuseClose: true },
    )
    harness.focusMutableDraft('mutable-notes.txt', 3)
    await harness.reader.open()
    const capturedBefore = capturedSourceTabs(harness),
      refusedState = harness.reader.presentationState()
    // Act
    await assert.rejects(
      async () =>
        harness.reader.changePresentation({
          presentationId: refusedState.presentationId,
          expectedRevision: refusedState.presentationControlRevision,
          mode: refusedState.mode,
          action: 'select',
        }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        causeDetail: 'A leftover Codebook pane could not be closed.',
      },
    )
    harness.acceptDeadPaneClose()
    const state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(capturedBefore, 1)
    assert.equal(capturedSourceTabs(harness), 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=a closed reader opens when the page left active by closing its focused dead pane is a non-text page of the same group; fails_when=that page is refused as a foreign editor, so the first selection after an update needs the learner's click again; why_new=Cycle 0044 0037-D5: the same rule was tested for a focused captured source only; seam=leaveDeadCodebookPane focused
test('a closed reader opens when closing its focused dead Study pane leaves a non-text page of the editor active in the same group', async () => {
  // Arrange: after a host restart column 1 holds the editor's Settings page and, with focus, the old host's Study pane.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const settingsPage = harness.useOpaquePrimary('settings')
    const deadStudy = harness.leaveDeadCodebookPane(
      'codebook.studyContext',
      1,
      {
        focused: true,
      },
    )
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(
      tabs.some((tab) => tab === settingsPage),
      true,
    )
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection refused for the focused tab changes nothing in the window; fails_when=the dead panes and leftover captured-source tabs are closed before the refusal is decided; why_new=Cycle 0044 0037-F5: the refusal test beside a dead pane asserted the refusal and the focused page only (since Cycle 0045 cause 7 the refusal is the one for a focused preview tab; a kept non-text page is admitted); seam=leaveDeadCodebookPane, restoreLeftoverCapturedSource
test('a selection refused for a focused preview tab that is no text editor closes neither the dead pane nor the leftover captured-source tab of an earlier session', async () => {
  // Arrange: the editor's Settings page has focus in column 1 as a preview tab, beside an inactive leftover captured source; the old host's Study pane is the only tab of column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    await harness.reader.attach(harness.service)
    harness.useOpaquePrimary('settings')!.isPreview = true
    const leftover = harness.restoreLeftoverCapturedSource({ active: false }),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.flatMap((group) => group.tabs)
    // Act
    await assert.rejects(
      async () =>
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: state.mode,
          action: 'select',
        }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'A destination group contains a foreign preview: "Settings" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
      },
    )
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.deepEqual(tabs, tabsBefore)
    assert.equal(tabs.includes(leftover), true)
    assert.equal(tabs.includes(deadStudy), true)
    assert.deepEqual(harness.tabCloseRequests(), [])
    assert.equal(harness.counts().panels, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=the selection waits for the editor and is confirmed when the editor closed the focused dead pane but kept a leftover tab of another group; fails_when=the editor's one answer for the whole request is read as "nothing closed", so the wait is skipped and the draft the close activated is refused as a foreign editor; why_new=Cycle 0044 0037-F4: the fake editor closed all requested tabs or none; seam=restoreLeftoverCapturedSource refuseClose lateTextEditor, leaveDeadCodebookPane focused
test('a selection is confirmed when the editor closes the focused dead pane and keeps a leftover captured-source tab of another group', async () => {
  // Arrange: the editor keeps the inactive leftover captured source of column 1; in column 3 the old host's Study pane has focus in front of the learner's draft, whose text editor the editor reports 60 ms after the pane closed.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    await harness.reader.attach(harness.service)
    const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
    const keptLeftover = harness.restoreLeftoverCapturedSource({
      active: false,
      column: 1,
      refuseClose: true,
      lateTextEditor: true,
    })
    const deadStudy = harness.leaveDeadCodebookPane(
      'codebook.studyContext',
      3,
      {
        focused: true,
      },
    )
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(tabs.includes(keptLeftover), true)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
  } finally {
    harness.acceptLeftoverClose()
    await harness.close()
  }
})

// Value: protects=a close request the editor rejects is treated as a kept pane: the selection ends with the instruction and nothing changes; fails_when=the rejection escapes as the editor's own error, or the selection goes on beside the dead pane; why_new=Cycle 0044 0037-D8: the fake editor could refuse a close but never reject the request; seam=rejectNextTabClose
test('a close request the editor rejects leaves every tab in place and the selection tells that a dead pane is still open', async () => {
  // Arrange: the editor rejects the close request, as it does when the request is cancelled.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.focusMutableDraft('mutable-notes.txt', 2)
    harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    harness.rejectNextTabClose()
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.flatMap((group) => group.tabs)
    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail: 'A leftover Codebook pane could not be closed.',
      },
    )
    // Assert
    assert.deepEqual(
      harness.groups.flatMap((group) => group.tabs),
      tabsBefore,
    )
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=this host's live Study pane is never taken for a dead one while its Application pane is gone; fails_when=only the Application panel counts as "this host owns a pane", so the live Study tab is closed as a leftover; why_new=Cycle 0044 0037-D8: the Study-only half of the live-panel condition had no test; seam=nativePanels
test('a selection after the learner closed the Application pane does not close this host’s live Study pane', async () => {
  // Arrange: the reader is open and the learner closed its Application tab, so this host owns the Study panel only.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    await harness.reader.open()
    const application = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser'),
      study = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.studyContext')
    assert.ok(application)
    assert.ok(study)
    application.dispose()
    const state = harness.reader.presentationState()
    // Act
    await harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      })
      .catch(() => undefined)
    // Assert
    assert.equal(
      harness.tabCloseRequests().flat().includes(study.nativeTab),
      false,
    )
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(study.nativeTab),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a dead Repository Wiki pane that had focus is closed by the first selection, which is then confirmed; fails_when=only the Application and Study view types count as Codebook panes, so the dead Wiki pane stays and the selection is refused for a foreign editor; why_new=Cycle 0044 0037-N6b: no test left a dead Wiki pane; seam=leaveDeadCodebookPane 'codebook.repositoryWiki'
test('the first presentation selection after an extension-host restart closes the old host’s dead Repository Wiki pane that had focus', async () => {
  // Arrange: the old host's Repository Wiki pane has focus in the only group; this host's Wiki reader has no panel.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const articleSource = harness.groups[0]!.tabs[0]!
    const deadWiki = harness.leaveDeadCodebookPane(
      'codebook.repositoryWiki',
      1,
      { focused: true },
    )
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadWiki), false)
    assert.equal(tabs.includes(articleSource), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=this host's live Repository Wiki pane stays open when the first selection closes the old host's dead panes; fails_when=every Repository Wiki tab is closed as a leftover without asking whether the Wiki reader owns a panel; why_new=Cycle 0044 0037-N6b: the Wiki view type was not a Codebook pane type before, so no test could close a live one; seam=leaveDeadCodebookPane
test('the first presentation selection keeps this host’s live Repository Wiki pane while it closes the old host’s dead Application pane', async () => {
  // Arrange: this host's Wiki reader shows its article in column 2; the old host's Application pane is the visible tab of column 1 and the learner's draft has focus in column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const liveWiki = harness.groups[1]!.tabs[0]!
    const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
    )
    harness.focusMutableDraft('mutable-notes.txt', 3)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.deepEqual(harness.tabCloseRequests()[0], [deadApplication])
    assert.equal(tabs.includes(liveWiki), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the dead panes of two earlier hosts are all closed by the first selection; fails_when=only one dead pane of a kind is recognized, so a second dead Application tab stays and the selection meets two Application tabs; why_new=Cycle 0044 0037-PR3: every earlier test left at most one dead pane of a kind; seam=leaveDeadCodebookPane
test('the first presentation selection closes the dead Application panes that two earlier extension hosts left in one window', async () => {
  // Arrange: two host restarts each left an Application pane behind: one in column 1, one in column 2; the learner's draft has focus in column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const firstDeadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
      ),
      secondDeadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        2,
      )
    harness.focusMutableDraft('mutable-notes.txt', 3)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(firstDeadApplication), false)
    assert.equal(tabs.includes(secondDeadApplication), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=the reader places its panes in columns 1 and 3 after the dead pane's close removed the first editor group and renumbered the others; fails_when=the placement uses the column numbers it read before the close; why_new=Cycle 0044 0037-PR4: the only emptied-group test removed the last group, which renumbers nothing; seam=leaveDeadCodebookPane, useOpaquePrimary
test('the first presentation selection places its panes after closing the dead Application pane removed the first editor group', async () => {
  // Arrange: the old host's Application pane is the only tab of column 1; the learner's draft has focus in column 2 and column 3 is empty.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.useOpaquePrimary('blank')
    const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
    )
    const draft = harness.focusMutableDraft('mutable-notes.txt', 2)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
  } finally {
    await harness.close()
  }
})

// Value: protects=the extension README tells a learner and an agent the dead-pane refusal and its causes in the words the reader uses; fails_when=the README does not describe the close of an earlier session's tabs, or its texts drift from the refusal a selection gives; why_new=Cycle 0044 0037-DOC1: the README named neither the close nor the refusal; seam=none
test('the extension README gives the refusal for a dead pane that stays open and both causes word for word', async () => {
  // Arrange
  const readme = await readFile(resolve(__dirname, '../../README.md'), 'utf8')
  // Act
  const documented = [
    '`A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.`',
    '`A leftover Codebook pane could not be closed.`',
    '`A leftover captured source tab could not be closed.`',
  ].map((text) => readme.includes(text))
  // Assert
  assert.deepEqual(documented, [true, true, true])
})
