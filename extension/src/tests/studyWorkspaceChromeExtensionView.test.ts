import assert from 'node:assert/strict'
import { symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import type { ExtensionViewportIdentity } from '../chromeExtensionContracts'
import {
  APPLICATION_GROUP_TOOK_KEYBOARD_MESSAGE,
  PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE,
} from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'
import { startFakeChromeExtensionRun } from './utils/startFakeChromeExtensionRun'

const POPUP_IDENTITY: ExtensionViewportIdentity = {
  manifestName: 'Bookmark Notes',
  surface: { kind: 'popup', path: 'popup.html' },
  clickTitles: ['Add note'],
  stopFiles: [],
}

/** Opens the Application view of one extension run on the harness's workspace, as the run's start does. */
async function openView(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  runId: string,
  stopFileNames: readonly string[] = [
    'settings.js',
    'service-worker.js',
    'deleted.js',
  ],
) {
  const create = harness.reader.presentation.createChromeExtensionViewport
  assert.ok(create)
  const view = await create(runId)
  view.setIdentity({
    ...POPUP_IDENTITY,
    stopFiles: stopFileNames.map((name) => join(harness.directory, name)),
  })
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

// protects=Cycle 0133 D13 (Cycle 0132 E3, observation 2): an extension run's stop file that is open nowhere stands as a kept tab in the learner's group beside the view before the run's first click, so the debugger's first pause reveals that editor instead of opening the file in the view's group; fails_when=the lease opens only a repository run's declared stop files, so an extension run's stop file stays unopened and Cursor shows it in front of the view at the first pause; no_claim=the real Cursor's answer to the debugger's first show (native N1); the fake editor stands in for the editor's groups, tabs and keyboard
test('an extension run opens its stop file as a kept tab beside its view before the first pause without taking the keyboard', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('popup.js', 1)
    const chat = harness.addSeparateEditorPart()
    chat.focus()
    const view = await openView(harness, 'stop-file-run-1', ['settings.js'])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    assert.equal(groupShowing(harness, 'settings.js'), undefined)
    // Act: the run attaches its surface, which is all that happens before its first click.
    await viewport.attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    // Assert
    const stopFileGroup = groupShowing(harness, 'settings.js')
    assert.equal(stopFileGroup?.viewColumn, applicationColumn + 1)
    assert.equal(
      stopFileGroup?.tabs.find((tab) => tab.label === 'settings.js')?.isPreview,
      false,
    )
    assert.equal(
      applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
      'codebook · Application stop-fil',
    )
    assert.equal(chat.focused(), true)
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 /ship review (Codex adversarial, Medium): a stop file whose show beside the view the editor never answers does not hold the extension run's attach: the attach goes on after the 5 s placement bound with the view in front; fails_when=the stop file's show is awaited without a bound, so the attach, and the run's start behind it, waits for as long as the editor does not answer; no_claim=why a native show stalls (the held show stands in for it), or where the file opens once the late show answers
test('an extension run’s attach goes on with its view in front when the editor never answers the show of its stop file beside the view', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('popup.js', 1)
    const chat = harness.addSeparateEditorPart()
    chat.focus()
    const view = await openView(harness, 'held-stop-run-1', ['settings.js'])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    // The editor holds its show of the stop file beside the view and never answers it during the attach.
    const show = harness.holdNextTextDocumentShow({
      uri: harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString(),
    })
    let budgetTimer: NodeJS.Timeout | undefined
    try {
      // Act
      // gstack-timing-ok: a negative check with a budget above the 5 s bound; an attach that awaits the held show without a bound never ends within it.
      const outcome = await Promise.race([
        viewport
          .attach(SILENT_SCREENCAST, new AbortController().signal, 'popup')
          .then(() => 'attached'),
        new Promise<string>((resolve) => {
          budgetTimer = setTimeout(() => resolve('still waiting'), 8_000)
        }),
      ])
      // Assert, with the show still held
      assert.equal(outcome, 'attached')
      assert.equal(groupShowing(harness, 'settings.js'), undefined)
      assert.equal(
        applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
        'codebook · Application held-sto',
      )
    } finally {
      clearTimeout(budgetTimer)
      // Released on every path, so a failure above leaves no show held.
      show.release()
    }
    view.close()
  } finally {
    await harness.close()
  }
})

/**
 * Closes every tab of the main editor and the chat's tab, as Cursor 3.30.8's View: Close All Editors does: the locked Application group stays, empty, as the main editor's only group, and the Agent part's group stays listed with no tab (Cycle 0133 D12 Step 0, run 3).
 * @param harness - The workspace harness.
 * @param chat - The Agent part the harness added.
 * @example await closeAllEditors(harness, chat)
 */
async function closeAllEditors(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  chat: ReturnType<
    Awaited<ReturnType<typeof workspaceHarness>>['addSeparateEditorPart']
  >,
): Promise<void> {
  const mainTabs = harness.groups
    .filter((group) => !group.tabs.includes(chat.tab))
    .flatMap((group) => group.tabs)
  await harness.editor.window.tabGroups.close(mainTabs, true)
  // The editor closes a main group its last tab left empty, unless the group is locked (workbench.editor.closeEmptyGroups).
  for (const group of harness.groups.filter(
    (candidate) =>
      !candidate.tabs.includes(chat.tab) &&
      !candidate.tabs.length &&
      !candidate.locked,
  ))
    await harness.editor.window.tabGroups.close(group, true)
  chat.closeChatTab()
}

// protects=Cycle 0133 D12 (Step 0 run 3, /ship pass 2 smoke S3): after Close All Editors left the earlier run's empty Application group alone in the main editor beside Cursor's Agent part, the next extension run opens its view in its new group in column 1, although Cursor 3.30.14 closes the old empty group when the new group comes above it; fails_when=the next run closes that group and waits for a removal the editor never makes (it keeps a part's last group), so its view is refused after 5 s with "Timed out waiting for owned Codebook group removal", or the creation check expects one group more than before, so the view is refused with "The editor did not create one empty owned Application group."; no_claim=Cursor's own Close All Editors and New Group Above (closeAllEditors and closeEmptiedGroupAtInsertion stand in for them) and where the editor gives the keyboard
test('the next extension run after Close All Editors opens its view while the earlier Application group is the main editor’s only group', async () => {
  // Arrange: an ended run kept its view; then every editor closed, which leaves the locked Application group empty and alone in the main editor.
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('popup.js', 1)
    harness.closeEmptiedGroupAtInsertion()
    const chat = harness.addSeparateEditorPart()
    const first = await openView(harness, 'close-all-run-1', [])
    first.end('Clicked Add note; the saved title read "Bookmark Notes".')
    first.close()
    await closeAllEditors(harness, chat)
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.length,
        locked: Boolean(group.locked),
      })),
      [
        { column: 1, tabs: 0, locked: true },
        { column: 2, tabs: 0, locked: false },
      ],
    )

    // Act
    const second = await openView(harness, 'close-all-run-2', [])

    // Assert: the next run's view stands in its own locked group in column 1; the editor closed the old group at the insertion, and the Agent part's group follows with no tab.
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.equal(application?.viewColumn, 1)
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) => tab.label),
        locked: Boolean(group.locked),
      })),
      [
        { column: 1, tabs: ['codebook · Application close-al'], locked: true },
        { column: 2, tabs: [], locked: false },
      ],
    )
    assert.equal(harness.reader['errors'].size, 0)
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 D12 (/ship QA revalidation R1, Cursor 3.30.14): in a window whose only main group is empty and whose Agent part is listed with no tab, so no group has a tab, an extension run opens its view in a new group above the empty one, although Cursor answers the insertion and the lock with every group a new object; fails_when=the group tracker gives every replaced empty group a new identity, so the earlier groups read as gone and the run's view is refused with "The editor did not create one empty owned Application group." or "Original editor groups changed while preparing the Application."; no_claim=why Cursor keeps this group at the insertion (a group the fake did not empty by a close stays, as after a window reload) and where the editor gives the keyboard
test('an extension run in Cursor opens its view when no group has a tab and Cursor answers each group change with new group objects', async () => {
  // Arrange: the main editor's one group is empty and the Agent part lists no tab; the last tab left with a tab event only, after the last group event, as Cursor 3.30.14 reports it.
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const chat = harness.addSeparateEditorPart()
    chat.closeChatTab()
    for (const tab of [...harness.groups[0]!.tabs]) harness.closeTabByHand(tab)
    harness.replaceGroupObjectsOnTabChanges()
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.length,
      })),
      [
        { column: 1, tabs: 0 },
        { column: 2, tabs: 0 },
      ],
    )

    // Act
    const view = await openView(harness, 'no-tab-run-1', [])

    // Assert: the view stands in its own locked group in column 1; the earlier empty group follows, then the Agent part's group.
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.equal(application?.viewColumn, 1)
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) => tab.label),
        locked: Boolean(group.locked),
      })),
      [
        { column: 1, tabs: ['codebook · Application no-tab-r'], locked: true },
        { column: 2, tabs: [], locked: false },
        { column: 3, tabs: [], locked: false },
      ],
    )
    assert.equal(harness.reader['errors'].size, 0)
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 D12 (/ship QA smoke S3, Cursor 3.30.14): after Close All Editors left the earlier run's empty Application group alone beside Cursor's Agent part with no tab, the next extension run opens its view, although Cursor answers every group change with new group objects and closes the old empty group when the new group comes above it; fails_when=the group tracker loses the identities of the empty groups, or the creation check expects one group more than before, so the run's view is refused with "Original editor groups changed while preparing the Application." or "The editor did not create one empty owned Application group."; no_claim=Cursor's own Close All Editors and New Group Above (closeAllEditors, replaceGroupObjectsOnTabChanges and closeEmptiedGroupAtInsertion stand in for them) and where the editor gives the keyboard
test('the next extension run in Cursor after Close All Editors opens its view while Cursor replaces every group object and closes the old empty group', async () => {
  // Arrange: an ended run kept its view; then every editor closed in Cursor 3.30.14's order: the learner's group goes first, and the Application's tab leaves last with a tab event only, so the locked Application group stays empty and alone in the main editor.
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('popup.js', 1)
    harness.closeEmptiedGroupAtInsertion()
    const chat = harness.addSeparateEditorPart()
    const first = await openView(harness, 'replaced-run-1', [])
    first.end('Clicked Add note; the saved title read "Bookmark Notes".')
    first.close()
    const learnerGroup = harness.groups.find((group) =>
      group.tabs.some((tab) => tab.label === 'popup.js'),
    )
    assert.ok(learnerGroup)
    await harness.editor.window.tabGroups.close([...learnerGroup.tabs], true)
    await harness.editor.window.tabGroups.close(
      harness.groups.find((group) => group.viewColumn === 2)!,
      true,
    )
    chat.closeChatTab()
    await harness.editor.window.tabGroups.close(
      [...harness.groups[0]!.tabs],
      true,
    )
    // The editor tells the tab listeners that the Application's tab left, and sends no group event after it.
    harness.announceTabChange()
    harness.replaceGroupObjectsOnTabChanges()
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.length,
        locked: Boolean(group.locked),
      })),
      [
        { column: 1, tabs: 0, locked: true },
        { column: 2, tabs: 0, locked: false },
      ],
    )

    // Act
    const second = await openView(harness, 'replaced-run-2', [])

    // Assert: the next run's view stands in its own locked group in column 1; the editor closed the old group, and the Agent part's group follows with no tab.
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.equal(application?.viewColumn, 1)
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) => tab.label),
        locked: Boolean(group.locked),
      })),
      [
        { column: 1, tabs: ['codebook · Application replaced'], locked: true },
        { column: 2, tabs: [], locked: false },
      ],
    )
    assert.equal(harness.reader['errors'].size, 0)
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 D12 (/ship QA revalidation R1b, Cursor 3.30.14): after Close All Editors left no learner's group, the next extension run's stop file is not shown into the Agent part's group beside the view, and the view stays in front of its group after the attach; fails_when=the column after the view counts as the learner's group although it lies beyond the main editor's measured groups, so the stop file lands in the Agent part (natively) or in front of the view (the fake redirects a show aimed at the chat part to the active group), and the paused-file watch then moves files between the view's group and the Agent part until the view is refused with "Application ownership changed"; no_claim=where the debugger opens the first pause's file when no learner's group exists (it may cover the view, the frozen D13 boundary) and Cursor's own Close All Editors (the explicit closes and replaceGroupObjectsOnTabChanges stand in for it)
test('the next extension run in Cursor after Close All Editors shows no stop file in the Agent part and keeps its view in front', async () => {
  // Arrange: an ended run kept its view; then every editor closed in Cursor 3.30.14's order, which leaves no learner's group beside the Agent part.
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('popup.js', 1)
    harness.closeEmptiedGroupAtInsertion()
    const chat = harness.addSeparateEditorPart()
    const first = await openView(harness, 'agent-stop-run-1', [])
    first.end('Clicked Add note; the saved title read "Bookmark Notes".')
    first.close()
    const learnerGroup = harness.groups.find((group) =>
      group.tabs.some((tab) => tab.label === 'popup.js'),
    )
    assert.ok(learnerGroup)
    await harness.editor.window.tabGroups.close([...learnerGroup.tabs], true)
    await harness.editor.window.tabGroups.close(
      harness.groups.find((group) => group.viewColumn === 2)!,
      true,
    )
    chat.closeChatTab()
    await harness.editor.window.tabGroups.close(
      [...harness.groups[0]!.tabs],
      true,
    )
    harness.announceTabChange()
    harness.replaceGroupObjectsOnTabChanges()
    const second = await openView(harness, 'agent-stop-run-2', ['settings.js'])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)

    // Act: the run attaches its surface, which opens its stop files before the first click.
    await viewport.attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )

    // Assert: no group shows the stop file, the view stands in front of its group in column 1, and the Agent part's group still holds no tab.
    assert.equal(groupShowing(harness, 'settings.js'), undefined)
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) => tab.label),
        front: group.activeTab?.label,
      })),
      [
        {
          column: 1,
          tabs: ['codebook · Application agent-st'],
          front: 'codebook · Application agent-st',
        },
        { column: 2, tabs: [], front: undefined },
      ],
    )
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 D12 (VS Code shape, no other editor part): after Close All Editors left the earlier run's empty locked Application group as the editor's only group, the next extension run opens its view at once and the old group stays below it as an empty group, still locked; fails_when=the only-group check counts a single listed group as no proof and closes the group, so the editor keeps it and the run waits 5 s for a removal that never comes ("Timed out waiting for owned Codebook group removal"); no_claim=VS Code's own Close All Editors (the fake closes the tabs and keeps the locked group) and where the editor gives the keyboard
test('the next extension run after Close All Editors opens its view when the earlier Application group is the editor’s only group', async () => {
  // Arrange: an ended run kept its view; then every tab closed, which leaves the locked Application group empty and alone, with no other editor part.
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('popup.js', 1)
    const first = await openView(harness, 'sole-group-run-1', [])
    first.end('Clicked Add note; the saved title read "Bookmark Notes".')
    first.close()
    await harness.editor.window.tabGroups.close(
      harness.groups.flatMap((group) => group.tabs),
      true,
    )
    // The editor closes a main group its last tab left empty, unless the group is locked (workbench.editor.closeEmptyGroups).
    for (const group of harness.groups.filter(
      (candidate) => !candidate.tabs.length && !candidate.locked,
    ))
      await harness.editor.window.tabGroups.close(group, true)
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.length,
        locked: Boolean(group.locked),
      })),
      [{ column: 1, tabs: 0, locked: true }],
    )

    // Act
    const second = await openView(harness, 'sole-group-run-2', [])

    // Assert: the next run's view stands in its own locked group in column 1; the old group, released in place, stays below it empty and still locked.
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) => tab.label),
        locked: Boolean(group.locked),
      })),
      [
        { column: 1, tabs: ['codebook · Application sole-gro'], locked: true },
        { column: 2, tabs: [], locked: true },
      ],
    )
    assert.equal(harness.reader['errors'].size, 0)
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 D12 (fixture F3): beside Cursor's Agent part with no tab, an earlier run's empty Application group that is not the main editor's only group is still closed when the next run prepares its view, so no extra empty group is left behind; fails_when=the only-group check counts the learner's group as another part's (three groups listed, or the layout read not consulted) and releases the old group in place, leaving it empty above the learner's file; no_claim=Cursor's own tab closes (the fake closes the earlier view's tab and the chat's tab)
test('the next extension run still closes the earlier empty Application group when the learner’s group stands below it beside Cursor’s Agent part', async () => {
  // Arrange: the earlier run's view closed, which leaves its locked group empty above the learner's group (article-source.ts and popup.js), and the Agent part's group has no tab.
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('popup.js', 1)
    const chat = harness.addSeparateEditorPart()
    const first = await openView(harness, 'two-groups-run-1', [])
    first.end('Clicked Add note; the saved title read "Bookmark Notes".')
    first.close()
    const earlierViewTab = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Application two-grou')
    assert.ok(earlierViewTab)
    await harness.editor.window.tabGroups.close([earlierViewTab], true)
    chat.closeChatTab()
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) => tab.label),
      })),
      [
        { column: 1, tabs: [] },
        { column: 2, tabs: ['article-source.ts', 'popup.js'] },
        { column: 3, tabs: [] },
      ],
    )

    // Act
    const second = await openView(harness, 'two-groups-run-2', [])

    // Assert: the new view's group replaced the old one above the learner's group; no empty group was left between them.
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) => tab.label),
      })),
      [
        { column: 1, tabs: ['codebook · Application two-grou'] },
        { column: 2, tabs: ['article-source.ts', 'popup.js'] },
        { column: 3, tabs: [] },
      ],
    )
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 review round (local CodeRabbit CLI, Major): a file the learner opens in the earlier run's empty Application group while the next run's retirement reads the editor's layout keeps that group and its tab; fails_when=the retirement closes the group it found before the read, and the learner's notes.ts closes with it; no_claim=how long a real layout read takes (the wrapper opens the file right after the read answered, which is the same moment for the retirement)
test('the next extension run keeps the earlier Application group when the learner opens a file in it while the run reads the layout', async () => {
  // Arrange: the earlier run's view closed, which leaves its locked group empty above the learner's group; no other editor part.
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('popup.js', 1)
    const first = await openView(harness, 'layout-race-run-1', [])
    first.end('Clicked Add note; the saved title read "Bookmark Notes".')
    first.close()
    const earlierViewTab = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Application layout-r')
    assert.ok(earlierViewTab)
    await harness.editor.window.tabGroups.close([earlierViewTab], true)
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) => tab.label),
      })),
      [
        { column: 1, tabs: [] },
        { column: 2, tabs: ['article-source.ts', 'popup.js'] },
      ],
    )
    const readLayoutOfOnlyGroup = harness.reader['isOnlyMainEditorGroup'].bind(
      harness.reader,
    )
    harness.reader['isOnlyMainEditorGroup'] = async (group) => {
      const answer = await readLayoutOfOnlyGroup(group)
      // The learner opens notes.ts in the empty group while the layout read is on its way.
      harness.focusMutableDraft('notes.ts', 1)
      return answer
    }

    // Act
    const second = await openView(harness, 'layout-race-run-2', [])

    // Assert: notes.ts is still open in a group of its own column, and that group was not closed.
    assert.deepEqual(
      harness.groups
        .filter((group) => group.tabs.some((tab) => tab.label === 'notes.ts'))
        .map((group) => group.tabs.map((tab) => tab.label)),
      [['notes.ts']],
    )
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 D12 (group gone after the layout read): the learner closes the earlier run's empty Application group while the next run's retirement reads the editor's layout; the next run still opens its view and nothing refuses; fails_when=the retirement treats a group that is gone after the read as not retired, so the run's view is refused instead of opened; no_claim=how long a real layout read takes (the wrapper closes the group right after the read answered, which is the same moment for the retirement)
test('the next extension run opens its view when the learner closes the earlier empty Application group while the run reads the layout', async () => {
  // Arrange: the earlier run's view closed, which leaves its locked group empty above the learner's group; no other editor part.
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('popup.js', 1)
    const first = await openView(harness, 'group-gone-run-1', [])
    first.end('Clicked Add note; the saved title read "Bookmark Notes".')
    first.close()
    const earlierViewTab = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Application group-go')
    assert.ok(earlierViewTab)
    await harness.editor.window.tabGroups.close([earlierViewTab], true)
    const emptyGroup = harness.groups[0]!
    assert.deepEqual(emptyGroup.tabs, [])
    const readLayoutOfOnlyGroup = harness.reader['isOnlyMainEditorGroup'].bind(
      harness.reader,
    )
    harness.reader['isOnlyMainEditorGroup'] = async (group) => {
      const answer = await readLayoutOfOnlyGroup(group)
      // The learner closes the empty group while the layout read is on its way.
      await harness.editor.window.tabGroups.close(emptyGroup, true)
      return answer
    }

    // Act
    const second = await openView(harness, 'group-gone-run-2', [])

    // Assert: the new view stands in column 1 above the learner's group, and no run error was recorded.
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) => tab.label),
      })),
      [
        { column: 1, tabs: ['codebook · Application group-go'] },
        { column: 2, tabs: ['article-source.ts', 'popup.js'] },
      ],
    )
    assert.equal(harness.reader['errors'].size, 0)
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 D12 (old group not active): when Cursor names its Agent part's group active after Close All Editors, the next extension run still opens its view above the earlier empty Application group, which is released in place; fails_when=the release waits for a removal the editor never makes, or needs the old group to be the active one, so the view is refused; no_claim=how long the release takes (the test reads no clock), that the old group is unlocked (a known limitation, a later candidate) and Cursor's own Close All Editors (closeAllEditors stands in for it)
test('the next extension run opens its view when Cursor’s Agent part holds the active group after Close All Editors', async () => {
  // Arrange: an ended run kept its view; then every editor closed, and the learner's click into the Agent part makes its group the active one.
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('popup.js', 1)
    const chat = harness.addSeparateEditorPart()
    const first = await openView(harness, 'not-active-run-1', [])
    first.end('Clicked Add note; the saved title read "Bookmark Notes".')
    first.close()
    await closeAllEditors(harness, chat)
    chat.focusTab()

    // Act
    const second = await openView(harness, 'not-active-run-2', [])

    // Assert: the view stands in its own group in column 1, the old group stays below it empty, and nothing was refused.
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.equal(application?.viewColumn, 1)
    assert.deepEqual(
      harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) => tab.label),
      })),
      [
        { column: 1, tabs: ['codebook · Application not-acti'] },
        { column: 2, tabs: [] },
        { column: 3, tabs: [] },
      ],
    )
    assert.equal(harness.reader['errors'].size, 0)
    second.close()
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

// protects=N62 attempt 2 (Cycle 0062 task 2, Cursor 3.27.22): a stop's paused file that Cursor opens kept (no preview) in the locked Application group moves out too, and stays kept in the group beside the view; fails_when=only a preview moves, so the kept paused file covers the extension view for the rest of the run, as N62 attempt 2 recorded (preview at 265.0 s, kept at 265.5 s); no_claim=why Cursor keeps the tab
test('a paused file Cursor keeps in front of the extension view moves to the source group as a kept tab', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'kept-paused-file-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    // Act
    harness.openAnnouncedTextTab('settings.js', applicationColumn, {
      isPreview: false,
      isDirty: false,
    })
    // Assert
    await waitUntil(
      () =>
        groupShowing(harness, 'settings.js') !== undefined &&
        groupShowing(harness, 'settings.js')?.viewColumn !== applicationColumn,
      'the kept paused file moves out of the Application group',
      5_000,
    )
    const moved = groupShowing(harness, 'settings.js')?.tabs.find(
      (tab) => tab.label === 'settings.js',
    )
    assert.equal(moved?.isPreview, false)
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === applicationColumn)
        ?.tabs.some((tab) => tab.label === 'settings.js'),
      false,
    )
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

// protects=CodeRabbit CLI pass 11 (Cycle 0062): a paused file the watch gave up moving moves again at a later stop once its copy in front of the view has closed; fails_when=the failure count of that file outlives its closed copy, so every later stop of the same file covers the extension view for the rest of the run; no_claim=why the editor refused the first close
test('a paused file given up after refused closes moves again once its copy closed and a later stop opens it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'given-up-then-closed-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    const showsOfPausedFile = () =>
      harness.textDocumentShows().filter((show) => show.name === 'settings.js')
    const copy = harness.openPausedFileInLockedGroup(
      'settings.js',
      applicationColumn,
    )
    const accept = harness.refuseCloseOfTabsShowing('settings.js')
    await waitUntil(
      () => showsOfPausedFile().length >= 2,
      'the watch gives the move up after its attempts',
      5_000,
    )
    accept()
    // Act: the learner closes the copy, and a later stop opens the same file in front of the view again.
    harness.closeTabByHand(copy)
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    // Assert
    await waitUntil(
      () =>
        !harness.groups
          .find((group) => group.viewColumn === applicationColumn)
          ?.tabs.some((tab) => tab.label === 'settings.js'),
      'the later paused file leaves the Application group',
      5_000,
    )
    assert.notEqual(groupShowing(harness, 'settings.js'), undefined)
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

/** A screencast connection that answers every request and sends nothing, for an attach in the fake editor. */
const SILENT_SCREENCAST = {
  on: () => undefined,
  request: async () => ({}),
  subscribe: async () => undefined,
}

/** Names the Application pane's group as the fake editor holds it now; the group object can change at every tab change. */
function applicationGroupOf(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  applicationColumn: number,
) {
  return harness.groups.find((group) => group.viewColumn === applicationColumn)
}

/**
 * Ends a first extension run of the window with its paused file still in front of the kept Application pane, as Cursor 3.30.8 leaves it: the debugger opened the stop's file in the Application's group and every show the watch asked for landed there again.
 * @returns The Application's column.
 */
async function endRunWithPausedFileInFront(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  runId: string,
  filename: string,
): Promise<number> {
  const first = await openView(harness, runId, [filename])
  const applicationColumn = harness.reader['app']?.viewColumn
  assert.ok(applicationColumn)
  const endRedirect = harness.redirectEveryTextDocumentShow(
    harness.editor.Uri.file(join(harness.directory, filename)).toString(),
    applicationColumn,
  )
  try {
    harness.openPausedFileInLockedGroup(filename, applicationColumn)
    // The watch gives up after its second refused move, so no later show can move the file.
    await waitUntil(
      () =>
        harness.textDocumentShows().filter((show) => show.name === filename)
          .length >= 2,
      'the watch tries its two moves',
      5_000,
    )
  } finally {
    endRedirect()
  }
  first.end('The first run ended.')
  first.close()
  return applicationColumn
}

/**
 * Ends a first extension run with its paused file in front of the kept Application pane, as {@link endRunWithPausedFileInFront} does, but keeps every show of that file landing in the Application's group afterwards: Cursor 3.30.8 answers each show that way for as long as its Agent chat holds the keyboard, through the next run too.
 * @returns The Application's column and the function that ends the redirect.
 */
async function endRunWithPausedFileInFrontWhileShowsLandThere(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  runId: string,
  filename: string,
): Promise<{ applicationColumn: number; endRedirect: () => void }> {
  const first = await openView(harness, runId, [filename])
  const applicationColumn = harness.reader['app']?.viewColumn
  assert.ok(applicationColumn)
  const endRedirect = harness.redirectEveryTextDocumentShow(
    harness.editor.Uri.file(join(harness.directory, filename)).toString(),
    applicationColumn,
  )
  harness.openPausedFileInLockedGroup(filename, applicationColumn)
  // The watch gives up after its second refused move, so no later show of the first run moves the file.
  await waitUntil(
    () =>
      harness.textDocumentShows().filter((show) => show.name === filename)
        .length >= 2,
    'the first run’s watch tries its two moves',
    5_000,
  )
  first.end('The first run ended.')
  first.close()
  return { applicationColumn, endRedirect }
}

/** Counts the shows of a document that the workspace asked the editor for, as it notes each one when it sends it (before the editor answers). */
function showsAskedOf(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  uri: string,
): number {
  return harness.reader['documentsShownByCodebook'].filter(
    (shown) => shown.uri === uri,
  ).length
}

// protects=Cycle 0133 D21 (Cycle 0132 CodeRabbit CLI, PR 331 final range): a move of the earlier run's file that the next run's watch started before the attach brought the view forward ends before the view is revealed, so its show cannot bring the file in front of the view again; fails_when=the uncover step reveals the view while that move's show is still held, so the show that lands in the view's group afterwards covers the view and the run's first reveal refuses with "Application ownership changed"; no_claim=how soon a native show answers, or that Cursor starts such a move at that moment (the held show and the redirect of every show to the view's group stand in for Cursor 3.30.8 with its Agent chat holding the keyboard)
test('the next extension run waits for a move of the earlier run’s file that was in flight before its view came forward, so the file does not cover the view', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const { applicationColumn, endRedirect } =
      await endRunWithPausedFileInFrontWhileShowsLandThere(
        harness,
        'in-flight-run-1',
        'settings.js',
      )
    try {
      const second = await openView(harness, 'in-flight-run-2', ['settings.js'])
      const viewport = harness.reader['viewport']
      assert.ok(viewport)
      const application = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')
      assert.ok(application)
      const settingsUri = harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString()
      // The editor reports the view's state, so the run's watch starts moving the earlier run's file, and that show stalls.
      const show = harness.holdNextTextDocumentShow({ uri: settingsUri })
      let attachEndedBeforeRelease = true
      let attached: Promise<void> | undefined
      try {
        let showStarted = false
        void show.started.then(() => {
          showStarted = true
        })
        application.notifyViewState()
        await waitUntil(
          () => showStarted,
          'the watch’s held show of settings.js',
          2_000,
        )
        // Act: the run attaches while the move is in flight; the show is released only after the attach had its time to finish.
        let attachEnded = false
        attached = viewport
          .attach(SILENT_SCREENCAST, new AbortController().signal, 'popup')
          .finally(() => {
            attachEnded = true
          })
        // gstack-timing-ok: a negative check with a budget far below the 5 s bound; an attach that does not wait ends within it.
        await Promise.race([
          attached,
          new Promise((resolve) => setTimeout(resolve, 1_000)),
        ])
        attachEndedBeforeRelease = attachEnded
      } finally {
        // Released on every path, so a failure above leaves no show held.
        show.release()
      }
      await attached
      // Assert
      assert.equal(attachEndedBeforeRelease, false)
      const applicationGroup = applicationGroupOf(harness, applicationColumn)
      assert.equal(
        applicationGroup?.activeTab?.label,
        'codebook · Application in-fligh',
      )
      assert.deepEqual(
        applicationGroup?.tabs.map((tab) => tab.label),
        ['codebook · Application in-fligh', 'settings.js'],
      )
      second.close()
    } finally {
      endRedirect()
    }
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 D13 (left-behind exclusion): a stop file the next extension run shares with the earlier run's file that stands in front of the kept pane is not opened beside the view again, while a stop file that is open nowhere is; fails_when=the lease drops its leftBehindFiles filter, so the shared file is shown into the learner's group during the attach and Cursor answers by bringing its copy in the view's group to the front again; no_claim=how the real Cursor answers that show (the redirect of every show to the view's group stands in for it)
test('the next extension run opens only its new stop file beside the view when the earlier run’s file is one of its stop files', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    await writeRepositoryFile(harness, 'other.js')
    harness.focusMutableDraft('popup.js', 1)
    const { applicationColumn, endRedirect } =
      await endRunWithPausedFileInFrontWhileShowsLandThere(
        harness,
        'left-out-run-1',
        'settings.js',
      )
    try {
      const second = await openView(harness, 'left-out-run-2', [
        'settings.js',
        'other.js',
      ])
      const viewport = harness.reader['viewport']
      assert.ok(viewport)
      const settingsUri = harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString()
      const showsAskedBefore = showsAskedOf(harness, settingsUri)
      // Act
      await viewport.attach(
        SILENT_SCREENCAST,
        new AbortController().signal,
        'popup',
      )
      // Assert
      assert.equal(showsAskedOf(harness, settingsUri), showsAskedBefore)
      assert.equal(
        groupShowing(harness, 'other.js')?.viewColumn,
        applicationColumn + 1,
      )
      assert.equal(
        applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
        'codebook · Application left-out',
      )
      second.close()
    } finally {
      endRedirect()
    }
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 D21 (cancellation): aborting the attach while the uncover step waits for a move in flight ends the attach with the signal's reason, not a timeout, and the view is not revealed over the earlier run's file; fails_when=the wait swallows the abort (waits out the 5 s bound or ends with a timeout) or the uncover step goes on to reveal the pane after the abort; no_claim=what the run does with the cancelled attach afterwards
test('the next extension run’s cancelled attach ends with its signal’s reason while a move of the earlier run’s file is in flight and reveals nothing', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const { applicationColumn, endRedirect } =
      await endRunWithPausedFileInFrontWhileShowsLandThere(
        harness,
        'abort-run-1',
        'settings.js',
      )
    try {
      const second = await openView(harness, 'abort-run-2', ['settings.js'])
      const viewport = harness.reader['viewport']
      assert.ok(viewport)
      const application = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')
      assert.ok(application)
      const settingsUri = harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString()
      // The editor reports the view's state, so the run's watch starts moving the earlier run's file, and that show stalls.
      const show = harness.holdNextTextDocumentShow({ uri: settingsUri })
      try {
        let showStarted = false
        void show.started.then(() => {
          showStarted = true
        })
        application.notifyViewState()
        await waitUntil(
          () => showStarted,
          'the watch’s held show of settings.js',
          2_000,
        )
        const reason = new Error('The run was cancelled during the move wait.')
        const revealsBefore = harness.panelReveals().length
        const controller = new AbortController()
        // Act: the run attaches while the move is in flight, and its signal aborts during the wait.
        const outcome = viewport
          .attach(SILENT_SCREENCAST, controller.signal, 'popup')
          .then(
            () => undefined,
            (error: unknown) => error,
          )
        // gstack-timing-ok: the attach must be inside its wait for the held move before the abort; the abort ends it, so no assertion depends on the pause.
        await new Promise((resolve) => setTimeout(resolve, 300))
        controller.abort(reason)
        const rejection = await outcome
        // Assert, with the show still held: the attach ended with the signal's reason and revealed nothing.
        assert.equal(rejection, reason)
        assert.equal(harness.panelReveals().length, revealsBefore)
        assert.equal(
          applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
          'settings.js',
        )
      } finally {
        // Released on every path, so a failure above leaves no show held.
        show.release()
      }
      second.close()
    } finally {
      endRedirect()
    }
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 D21 (bound): a move of the earlier run's file that outlasts the 5 s placement bound does not hold the attach for good: the attach resolves after the bound and the uncover step still reveals the view; fails_when=the wait has no bound (the attach hangs while the show is held) or a timed-out wait rejects the attach; no_claim=what the file does once the late show lands
test('the next extension run’s attach goes on and shows its view when a move of the earlier run’s file outlasts the placement bound', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const { applicationColumn, endRedirect } =
      await endRunWithPausedFileInFrontWhileShowsLandThere(
        harness,
        'long-move-run-1',
        'settings.js',
      )
    try {
      const second = await openView(harness, 'long-move-run-2', ['settings.js'])
      const viewport = harness.reader['viewport']
      assert.ok(viewport)
      const application = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')
      assert.ok(application)
      const settingsUri = harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString()
      // The editor reports the view's state, so the run's watch starts moving the earlier run's file, and that show is never released within the bound.
      const show = harness.holdNextTextDocumentShow({ uri: settingsUri })
      try {
        let showStarted = false
        void show.started.then(() => {
          showStarted = true
        })
        application.notifyViewState()
        await waitUntil(
          () => showStarted,
          'the watch’s held show of settings.js',
          2_000,
        )
        // Act
        const startedAt = performance.now()
        await viewport.attach(
          SILENT_SCREENCAST,
          new AbortController().signal,
          'popup',
        )
        const elapsedMs = performance.now() - startedAt
        // Assert, with the show still held
        // gstack-timing-ok: a lower bound only: the attach waited for the held move until the 5 s bound; load can lengthen the wait, never shorten it.
        assert.equal(elapsedMs >= 4_500, true)
        assert.equal(
          applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
          'codebook · Application long-mov',
        )
      } finally {
        // Released on every path, so a failure above leaves no show held.
        show.release()
      }
      second.close()
    } finally {
      endRedirect()
    }
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 /ship review (Codex adversarial, High): a move of the earlier run's file that outlasted the uncover step's 5 s bound and lands in the view's group afterwards leaves the next run's view in front again once that move ended; fails_when=the uncover step forgets the move once its wait timed out, so the late show, which lands in the view's group, covers the view for the rest of the pause (the watch leaves that file behind the pane and never moves it); no_claim=how late a native show answers, or that Cursor lands it there (the held show and the redirect of every show to the view's group stand in for Cursor 3.30.14 with its Agent chat holding the keyboard)
test('the next extension run brings its view back in front when a move of the earlier run’s file that outlasted the placement bound lands over it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const { applicationColumn, endRedirect } =
      await endRunWithPausedFileInFrontWhileShowsLandThere(
        harness,
        'late-move-run-1',
        'settings.js',
      )
    try {
      const second = await openView(harness, 'late-move-run-2', ['settings.js'])
      const viewport = harness.reader['viewport']
      assert.ok(viewport)
      const application = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')
      assert.ok(application)
      const settingsUri = harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString()
      // The editor reports the view's state, so the run's watch starts moving the earlier run's file, and that show answers only after the attach went on without it.
      const show = harness.holdNextTextDocumentShow({ uri: settingsUri })
      try {
        let showStarted = false
        void show.started.then(() => {
          showStarted = true
        })
        application.notifyViewState()
        await waitUntil(
          () => showStarted,
          'the watch’s held show of settings.js',
          2_000,
        )
        await viewport.attach(
          SILENT_SCREENCAST,
          new AbortController().signal,
          'popup',
        )
        assert.equal(
          applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
          'codebook · Application late-mov',
        )
        const showsBeforeRelease = harness.textDocumentShows().length
        const revealsBeforeRelease = harness.panelReveals().length
        // Act: the late show answers and lands in the view's group, as every show of the file does; the fake editor puts the file in front in the same step it records the show.
        show.release()
        await waitUntil(
          () => harness.textDocumentShows().length > showsBeforeRelease,
          'the late show of settings.js',
          2_000,
        )
        // Assert
        assert.deepEqual(
          harness.textDocumentShows().slice(showsBeforeRelease),
          [
            {
              name: 'settings.js',
              viewColumn: applicationColumn,
              preserveFocus: true,
            },
          ],
        )
        await waitUntil(
          () =>
            applicationGroupOf(harness, applicationColumn)?.activeTab?.label ===
            'codebook · Application late-mov',
          'the view in front again once the late move ended',
          2_000,
        )
        assert.deepEqual(harness.panelReveals().slice(revealsBeforeRelease), [
          {
            kind: 'codebook.scopedBrowser',
            column: applicationColumn,
            preserveFocus: true,
          },
        ])
      } finally {
        // Released on every path, so a failure above leaves no show held.
        show.release()
      }
      second.close()
    } finally {
      endRedirect()
    }
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0133 D21 (re-read after the wait): a file tab the learner closes in the view's group while the uncover step waits for the move is not covered afterwards, and the view does not take the keyboard from the chat; fails_when=the step reveals the pane from what it read before the wait and takes the keyboard for the file's editor; no_claim=how the editor answers a reveal over no file
test('the next extension run does not take the keyboard when the learner closes the earlier run’s file while its move is awaited', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const { applicationColumn, endRedirect } =
      await endRunWithPausedFileInFrontWhileShowsLandThere(
        harness,
        'closed-run-1',
        'settings.js',
      )
    try {
      const second = await openView(harness, 'closed-run-2', ['settings.js'])
      const viewport = harness.reader['viewport']
      assert.ok(viewport)
      const application = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')
      assert.ok(application)
      const settingsUri = harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString()
      const show = harness.holdNextTextDocumentShow({ uri: settingsUri })
      try {
        let showStarted = false
        void show.started.then(() => {
          showStarted = true
        })
        application.notifyViewState()
        await waitUntil(
          () => showStarted,
          'the watch’s held show of settings.js',
          2_000,
        )
        const revealsBefore = harness.panelReveals().length
        // Act: the run attaches, and the learner closes the file in the view's group while the move is awaited.
        const attached = viewport.attach(
          SILENT_SCREENCAST,
          new AbortController().signal,
          'popup',
        )
        // gstack-timing-ok: the attach must be inside its wait for the held move before the tab closes; the release below ends it, so no assertion depends on the pause.
        await new Promise((resolve) => setTimeout(resolve, 300))
        const leftoverTab = applicationGroupOf(
          harness,
          applicationColumn,
        )?.tabs.find((tab) => tab.label === 'settings.js')
        assert.ok(leftoverTab)
        await harness.editor.window.tabGroups.close([leftoverTab], true)
        // The keyboard is back in the main editor, so the held show now lands where the watch asked: outside the view's group.
        endRedirect()
        show.release()
        await attached
        // Assert
        assert.equal(harness.panelReveals().length, revealsBefore)
        assert.equal(
          harness.informationMessages.some(
            ({ message }) =>
              message === APPLICATION_GROUP_TOOK_KEYBOARD_MESSAGE,
          ),
          false,
        )
      } finally {
        show.release()
      }
      second.close()
    } finally {
      endRedirect()
    }
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0132 task 8 (E4, Cursor 3.30.8): the next extension run that also stops in the file the earlier run left in front of the kept Application pane leaves that file behind its view once the attach brought the view forward, so no show of the run brings the file back in front of the view; fails_when=the next run's paused-file watch moves that file when the editor reports the view's new state, and Cursor, while its Agent chat holds the keyboard, answers the show by bringing the file's copy in the view's group to the front again, so the attach's reveal refuses with "Application ownership changed" and the run records no frame (E2-2 run 2); no_claim=the run's own later stop in that file (the next test), or why Cursor answers shows that way
test('the next extension run that also stops in the earlier run’s file leaves that file behind its view while every show of it lands in the view’s group', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const { applicationColumn, endRedirect } =
      await endRunWithPausedFileInFrontWhileShowsLandThere(
        harness,
        'same-file-run-1',
        'settings.js',
      )
    try {
      const second = await openView(harness, 'same-file-run-2', ['settings.js'])
      const viewport = harness.reader['viewport']
      assert.ok(viewport)
      const application = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')
      assert.ok(application)
      const settingsUri = harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString()
      const showsAskedBefore = showsAskedOf(harness, settingsUri)
      // Act: the run attaches its surface and brings its view forward, and the editor then reports the view's state, as Cursor 3.30.8 does a moment after the reveal.
      await viewport.attach(
        SILENT_SCREENCAST,
        new AbortController().signal,
        'popup',
      )
      await harness.revealApplicationPaneOverPausedFile()
      application.notifyViewState()
      // Assert: the watch, which decides at once on each tab or view report, asked no show of the earlier run's file, and the file stays behind the view.
      assert.equal(showsAskedOf(harness, settingsUri), showsAskedBefore)
      const applicationGroup = applicationGroupOf(harness, applicationColumn)
      assert.equal(
        applicationGroup?.activeTab?.label,
        'codebook · Application same-fil',
      )
      assert.deepEqual(
        applicationGroup?.tabs.map((tab) => tab.label),
        ['codebook · Application same-fil', 'settings.js'],
      )
      second.close()
    } finally {
      endRedirect()
    }
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0132 task 8 (/ship review: Codex structured P1, outside voice 1): the earlier run's file that the next run left behind its view moves out of the view's group once the next run's own stop shows it in front, so the stop's source and the view are seen side by side as at any pause; fails_when=the file stays marked as left for the rest of the run, like a file the watch gave up, so the stop in it covers the view although a move would succeed; no_claim=Cursor's answer to that move while its Agent chat holds the keyboard (the test above models it)
test('the next extension run moves the earlier run’s file out of the view’s group once its own stop shows that file in front', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const { applicationColumn, endRedirect } =
      await endRunWithPausedFileInFrontWhileShowsLandThere(
        harness,
        'left-file-run-1',
        'settings.js',
      )
    const second = await openView(harness, 'left-file-run-2', ['settings.js'])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.ok(application)
    await viewport.attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    await harness.revealApplicationPaneOverPausedFile()
    // The editor reports the view's state after it came forward, with the file behind the view.
    application.notifyViewState()
    assert.equal(
      applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
      'codebook · Application left-fil',
    )
    // The keyboard is back in the main editor, so a show lands where it is asked.
    endRedirect()
    // Act: the run's own stop in that file reveals its tab in front of the view.
    harness.debuggerOpensStopFile('settings.js', applicationColumn)
    // Assert
    await waitUntil(
      () =>
        !applicationGroupOf(harness, applicationColumn)?.tabs.some(
          (tab) => tab.label === 'settings.js',
        ) &&
        harness.groups.some(
          (group) =>
            group.viewColumn !== applicationColumn &&
            group.tabs.some((tab) => tab.label === 'settings.js'),
        ),
      'the stop’s file moves out of the Application group',
      5_000,
    )
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0132 task 8 (/ship review: Codex outside voice 2): closing another copy of the file the earlier run left in front of the kept Application pane keeps that run's note, so the next extension run still shows its view; fails_when=the tab listener drops the note for any closed tab of the same file, also a copy in another group, so the next run's attach refuses with "Application ownership changed" over the run's own tab that still stands in front of the pane; no_claim=a close the editor never reports
test('the next extension run still shows its view after the learner closed another copy of the file the earlier run left in front of it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const applicationColumn = await endRunWithPausedFileInFront(
      harness,
      'other-copy-run-1',
      'settings.js',
    )
    const otherColumn = harness.groups.find(
      (group) => group.viewColumn !== applicationColumn,
    )?.viewColumn
    assert.ok(otherColumn)
    await harness.editor.window.showTextDocument(
      harness.editor.Uri.file(join(harness.directory, 'settings.js')),
      { viewColumn: otherColumn, preserveFocus: true, preview: false },
    )
    const otherCopy = harness.groups
      .find((group) => group.viewColumn === otherColumn)
      ?.tabs.find((tab) => tab.label === 'settings.js')
    assert.ok(otherCopy)
    harness.closeTabByHand(otherCopy)
    assert.equal(
      applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
      'settings.js',
    )
    const second = await openView(harness, 'other-copy-run-2', [
      'service-worker.js',
    ])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)
    // Act
    await viewport.attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    await harness.revealApplicationPaneOverPausedFile()
    // Assert
    assert.equal(
      applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
      'codebook · Application other-co',
    )
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0132 task 8 (E2, Cursor 3.30.8): the next extension run of a window shows its Application view, so its history takes frames, when the earlier run's paused file is still in front of the kept Application pane in its group; fails_when=the next run's attach refuses with "Application ownership changed" over a stop file an earlier run of the window declared, so the run goes on without its view and records no frame; no_claim=why Cursor shows the paused file in the Application group (its Agent part holds the keyboard), or the covering during the first run's own pause
test('the next extension run shows its Application view over a stop file the earlier run left in front of it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    await writeRepositoryFile(harness, 'service-worker.js')
    harness.focusMutableDraft('popup.js', 1)
    const applicationColumn = await endRunWithPausedFileInFront(
      harness,
      'leftover-run-1',
      'settings.js',
    )
    assert.equal(
      applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
      'settings.js',
    )
    const second = await openView(harness, 'leftover-run-2', [
      'service-worker.js',
    ])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)
    // Act: the run attaches its surface, and its viewport then brings the pane to the front as the real one does at the end of an attach.
    await viewport.attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    await harness.revealApplicationPaneOverPausedFile()
    // Assert
    const applicationGroup = applicationGroupOf(harness, applicationColumn)
    assert.equal(
      applicationGroup?.activeTab?.label,
      'codebook · Application leftover',
    )
    assert.deepEqual(
      applicationGroup?.tabs.map((tab) => tab.label),
      ['codebook · Application leftover', 'settings.js'],
    )
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=the reveal guard of Cycle 0132 task 8's fix: a file the learner opened in front of the kept Application pane is not covered by the next extension run; fails_when=the next run's attach shows its view over any unedited text tab of the Application's group, hiding the learner's file; no_claim=what the learner does with the refused view
test('the next extension run still refuses its view over a file the learner opened in front of the kept Application', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    await writeRepositoryFile(harness, 'notes.js')
    harness.focusMutableDraft('popup.js', 1)
    const first = await openView(harness, 'learner-front-run-1', [
      'settings.js',
    ])
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    first.end('The first run ended.')
    first.close()
    harness.openPausedFileInLockedGroup('notes.js', applicationColumn)
    const second = await openView(harness, 'learner-front-run-2', [
      'settings.js',
    ])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)
    // Act: the run attaches its surface, and its viewport then asks to bring the pane to the front as the real one does at the end of an attach.
    await viewport.attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    const reveal = harness.revealApplicationPaneOverPausedFile()
    // Assert
    await assert.rejects(reveal, /Application ownership changed/)
    assert.equal(
      applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
      'notes.js',
    )
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0132 review (CodeRabbit, three passes): the next extension run brings its kept view forward without the keyboard while the learner types in another editor group that the view does not cover; fails_when=the attach takes the keyboard from the learner's editor in another group because the learner's recent typing makes the pause reveal's rule hand the keyboard to the pane; no_claim=the keyboard when the covered stop file's own editor has it (the pause reveal's rule applies then)
test('the next extension run brings its view forward without taking the keyboard from the learner typing in another group', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const applicationColumn = await endRunWithPausedFileInFront(
      harness,
      'typing-run-1',
      'settings.js',
    )
    const learnerColumn = groupShowing(harness, 'popup.js')?.viewColumn
    assert.ok(learnerColumn)
    assert.notEqual(learnerColumn, applicationColumn)
    harness.focusMutableDraft('popup.js', learnerColumn)
    harness.workInActiveTextEditor('keyboard')
    const second = await openView(harness, 'typing-run-2', ['settings.js'])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)
    const revealsBefore = harness.panelReveals().length
    // Act
    await viewport.attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    await harness.revealApplicationPaneOverPausedFile()
    // Assert
    assert.equal(
      applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
      'codebook · Application typing-r',
    )
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [true],
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.path.endsWith(
        '/popup.js',
      ),
      true,
    )
    second.close()
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0132 review (CodeRabbit, two passes): a stop file the learner closed and opened again in front of the kept Application is the learner's tab, and the next extension run does not cover it; fails_when=the next run covers any unedited tab whose path an earlier run declared as a stop file, also one the learner reopened there after closing the run's own tab; no_claim=a learner who only selects the run's own tab without closing it (it stays the run's)
test('the next extension run still refuses its view over a stop file the learner closed and opened again in front of the kept Application', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const applicationColumn = await endRunWithPausedFileInFront(
      harness,
      'reopened-run-1',
      'settings.js',
    )
    const runTab = applicationGroupOf(harness, applicationColumn)?.tabs.find(
      (tab) => tab.label === 'settings.js',
    )
    assert.ok(runTab)
    harness.closeTabByHand(runTab)
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    const second = await openView(harness, 'reopened-run-2', ['settings.js'])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)
    // Act
    await viewport.attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    const reveal = harness.revealApplicationPaneOverPausedFile()
    // Assert
    await assert.rejects(reveal, /Application ownership changed/)
    assert.equal(
      applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
      'settings.js',
    )
    second.close()
  } finally {
    await harness.close()
  }
})

// Value: protects=an extension run's paused file the learner edited since the earlier run ended keeps the front, unsaved text and all; fails_when=the next run's attach brings the kept Application pane over a stop file with unsaved text, hiding the learner's edit behind the view; why_new=the covering tests use unedited stop files and the refusal tests use files the learner opened, so the edited stop file of the note's own set is unchecked; seam=none; no_claim=what the learner does with the refused view
test('the next extension run still refuses its view over a stop file the earlier run left in front and the learner has edited since', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const applicationColumn = await endRunWithPausedFileInFront(
      harness,
      'edited-leftover-run-1',
      'settings.js',
    )
    const leftoverTab = applicationGroupOf(
      harness,
      applicationColumn,
    )?.activeTab
    assert.equal(leftoverTab?.label, 'settings.js')
    // The learner types into the file without saving.
    leftoverTab.isDirty = true
    const second = await openView(harness, 'edited-leftover-run-2', [
      'settings.js',
    ])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)
    // Act
    await viewport.attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    const reveal = harness.revealApplicationPaneOverPausedFile()
    // Assert
    await assert.rejects(reveal, /Application ownership changed/)
    const front = applicationGroupOf(harness, applicationColumn)?.activeTab
    assert.equal(front?.label, 'settings.js')
    assert.equal(front?.isDirty, true)
    second.close()
  } finally {
    await harness.close()
  }
})

// Value: protects=the next extension run brings its view forward and takes the keyboard, with the learner told, when the learner works in the editor of the stop file the earlier run left in front; fails_when=the attach leaves the keyboard in the covered file's editor that the pane now hides, with no notice that the pane took it; why_new=the only keyboard test types in another group, where the pane must keep the keyboard; seam=none; no_claim=the keyboard when the debugger alone gave that editor the keyboard
test('the next extension run takes the keyboard for its view from the learner typing in the stop file the earlier run left in front', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const applicationColumn = await endRunWithPausedFileInFront(
      harness,
      'typing-leftover-run-1',
      'settings.js',
    )
    harness.clickFrontTextTab(applicationColumn)
    harness.workInActiveTextEditor('keyboard')
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.path.endsWith(
        '/settings.js',
      ),
      true,
    )
    const second = await openView(harness, 'typing-leftover-run-2', [
      'settings.js',
    ])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)
    const revealsBefore = harness.panelReveals().length
    // Act
    await viewport.attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    await harness.revealApplicationPaneOverPausedFile()
    // Assert
    assert.equal(
      applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
      'codebook · Application typing-l',
    )
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [false],
    )
    assert.equal(
      harness.informationMessages.some(
        ({ message }) => message === PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE,
      ),
      true,
    )
    second.close()
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who clicks into a file of another group while the next extension run asks the pause reveal's keyboard rule keeps the keyboard there, and is told nothing about the pane; fails_when=the attach decides from the editor it read before the rule's answer and reveals the pane with the keyboard, taking it from the file the learner chose meanwhile (CodeRabbit, PR 331); why_new=the keyboard test where the pane takes the keyboard keeps the covered file's editor active throughout; seam=the rule's answer is wrapped so the learner's click lands while it is on its way; no_claim=which editor the debugger gives the keyboard at the run's own stops
test('the next extension run leaves the keyboard in the file the learner chose while its keyboard rule answered', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const applicationColumn = await endRunWithPausedFileInFront(
      harness,
      'switching-run-1',
      'settings.js',
    )
    const learnerColumn = groupShowing(harness, 'popup.js')?.viewColumn
    assert.ok(learnerColumn)
    assert.notEqual(learnerColumn, applicationColumn)
    harness.clickFrontTextTab(applicationColumn)
    harness.workInActiveTextEditor('keyboard')
    const askKeyboardRule = harness.reader['keepsKeyboardFromPane'].bind(
      harness.reader,
    )
    harness.reader['keepsKeyboardFromPane'] = async () => {
      const answer = await askKeyboardRule()
      // The learner clicks into the file of another group while the rule's answer is on its way.
      harness.focusMutableDraft('popup.js', learnerColumn)
      return answer
    }
    // The editor keeps showing the earlier run's file in the view's group, as Cursor 3.30.8 does while its Agent chat holds the keyboard: the watch's move that the learner's click starts is refused, and the file still covers the view when the attach reads it again (Cycle 0133 D21: the attach now waits for that move).
    const endRedirect = harness.redirectEveryTextDocumentShow(
      harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString(),
      applicationColumn,
    )
    const second = await openView(harness, 'switching-run-2', ['settings.js'])
    const viewport = harness.reader['viewport']
    assert.ok(viewport)
    const revealsBefore = harness.panelReveals().length
    // Act
    await viewport.attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    await harness.revealApplicationPaneOverPausedFile()
    // Assert
    assert.equal(
      applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
      'codebook · Application switchin',
    )
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [true],
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.path.endsWith(
        '/popup.js',
      ),
      true,
    )
    assert.equal(
      harness.informationMessages.some(
        ({ message }) => message === PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE,
      ),
      false,
    )
    endRedirect()
    second.close()
  } finally {
    await harness.close()
  }
})

// Value: protects=the stop file an extension run left in front is covered by one next run only; fails_when=the note outlives the attach that read it, so a later run covers the same file again after the learner brought that tab to the front on purpose; why_new=the covering test spans one next run, so a note kept past its read is unseen; seam=none; no_claim=a learner who closes the tab (the closed-tab test covers that)
test('a third extension run refuses its view over the earlier stop file the learner brought to the front again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const applicationColumn = await endRunWithPausedFileInFront(
      harness,
      'once-run-1',
      'settings.js',
    )
    const viewportOf = () => {
      const viewport = harness.reader['viewport']
      assert.ok(viewport)
      return viewport
    }
    const second = await openView(harness, 'once-run-2', ['settings.js'])
    await viewportOf().attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    await harness.revealApplicationPaneOverPausedFile()
    second.end('The second run ended.')
    second.close()
    // The learner selects the earlier run's file tab again, in front of the kept pane.
    const group = applicationGroupOf(harness, applicationColumn)
    const fileTab = group?.tabs.find((tab) => tab.label === 'settings.js')
    assert.ok(group && fileTab)
    group.activeTab = fileTab
    const third = await openView(harness, 'once-run-3', ['settings.js'])
    // Act
    await viewportOf().attach(
      SILENT_SCREENCAST,
      new AbortController().signal,
      'popup',
    )
    const reveal = harness.revealApplicationPaneOverPausedFile()
    // Assert
    await assert.rejects(reveal, /Application ownership changed/)
    assert.equal(
      applicationGroupOf(harness, applicationColumn)?.activeTab?.label,
      'settings.js',
    )
    third.close()
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

// protects=CXS2 (Cycle 0062 ship review, Codex; CR4): a preview of a file that is not one of the run's stop files, opened in the Application group during the run, stays there; fails_when=the watch moves any unedited preview text tab of the Application group, closing the tab the learner opened; no_claim=how the learner opened the file
test('a preview of a file that is no stop file stays in the Application group while a stop file moves out', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'notes.js')
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'other-preview-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    // Act
    const other = harness.openPausedFileInLockedGroup(
      'notes.js',
      applicationColumn,
    )
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    // Assert
    await waitUntil(
      () =>
        groupShowing(harness, 'settings.js') !== undefined &&
        groupShowing(harness, 'settings.js')?.viewColumn !== applicationColumn,
      'the stop file moves out of the Application group',
      5_000,
    )
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === applicationColumn)
        ?.tabs.includes(other),
      true,
    )
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=LR-W1 (Cycle 0062 ship last round): a stop file the run names through a symlinked folder still moves when the editor opens it by its real path; fails_when=the stop files and the tab's path are compared as plain strings, so the paused file stays in front of the view; no_claim=case folding (unit test)
test(
  'a paused file moves although the run names its stop file through a symlinked folder',
  // A folder symlink needs a privilege Windows grants only to administrators or in developer mode.
  { skip: process.platform === 'win32' },
  async () => {
    // Arrange
    const harness = await workspaceHarness()
    try {
      readerSeams(harness).stopOwnTimer()
      await writeRepositoryFile(harness, 'settings.js')
      await symlink(harness.directory, join(harness.directory, 'link'))
      harness.focusMutableDraft('popup.js', 1)
      const create = harness.reader.presentation.createChromeExtensionViewport
      assert.ok(create)
      const view = await create('symlink-run-1')
      view.setIdentity({
        ...POPUP_IDENTITY,
        stopFiles: [join(harness.directory, 'link', 'settings.js')],
      })
      const applicationColumn = harness.reader['app']?.viewColumn
      assert.ok(applicationColumn)
      // Act
      harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
      // Assert
      await waitUntil(
        () =>
          groupShowing(harness, 'settings.js') !== undefined &&
          groupShowing(harness, 'settings.js')?.viewColumn !==
            applicationColumn,
        'the paused file moves out of the Application group',
        5_000,
      )
      view.close()
    } finally {
      await harness.close()
    }
  },
)

// protects=CXA4 (Cycle 0062 ship review, Codex adversarial challenge): when the editor shows the paused file in the Application group itself instead of the destination, the copy in front of the view is not closed, so the file keeps a tab; fails_when=the move closes the Application group's copy after any resolved show, leaving the paused file with no tab; no_claim=which native condition makes the editor show it there
test('a paused file the editor shows in the Application group again is not left without a tab', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'misplaced-show-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    harness.redirectNextTextDocumentShow(
      harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString(),
      applicationColumn,
    )
    // Act
    harness.openPausedFileInLockedGroup('settings.js', applicationColumn)
    await waitUntil(
      () =>
        harness.textDocumentShows().some((show) => show.name === 'settings.js'),
      'the move shows the file',
      5_000,
    )
    // gstack-timing-ok: a negative check; the close would follow the show within the same move, so one settle shows whether it was sent.
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Assert
    assert.equal(
      harness.groups.some((group) =>
        group.tabs.some((tab) => tab.label === 'settings.js'),
      ),
      true,
    )
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=CX1 (Cycle 0062 ship review, Codex; revised by N62 attempt 2): a paused file the learner edits while its move is under way stays in front of the extension view with its changes, since the close checks the tab again; fails_when=the move closes the tab by its document alone, closing a tab the learner edited during the show; no_claim=the editor's own save prompt
test('a paused file the learner edits during its move stays where the learner edited it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await writeRepositoryFile(harness, 'settings.js')
    harness.focusMutableDraft('popup.js', 1)
    const view = await openView(harness, 'edited-during-move-run-1')
    const applicationColumn = harness.reader['app']?.viewColumn
    assert.ok(applicationColumn)
    const show = harness.holdNextTextDocumentShow({
      uri: harness.editor.Uri.file(
        join(harness.directory, 'settings.js'),
      ).toString(),
    })
    const paused = harness.openPausedFileInLockedGroup(
      'settings.js',
      applicationColumn,
    )
    await show.started
    // Act: the learner edits the tab while the move waits for its show.
    paused.isDirty = true
    show.release()
    await waitUntil(
      () =>
        harness.groups.some(
          (group) =>
            group.viewColumn !== applicationColumn &&
            group.tabs.some((tab) => tab.label === 'settings.js'),
        ),
      'the move shows the file in the group below',
      5_000,
    )
    // gstack-timing-ok: a negative check; the close follows the show within the same move, so one settle shows whether it was sent.
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Assert
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === applicationColumn)
        ?.tabs.includes(paused),
      true,
    )
    view.close()
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
    assert.notEqual(groupShowing(harness, 'settings.js'), undefined)
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

// protects=N62 attempt 1 (Cycle 0062 task 3, Cursor 3.27.22): an extension run started from the Agent chat while the first main group is empty gives the chat its keyboard back after the Application view opens; fails_when=the preparation leaves the keyboard in the new Application group and tells "Click where you want to type", because Cursor 3.27.22 keeps naming the main editor's group while its chat input has the keyboard (probe of 2026-10-30: activeTabGroup the empty main group, the chat part's group inactive, no active text editor); no_claim=Cursor's native focus events (N62)
test('an extension run started from Cursor 3.27’s Agent chat, which names the empty main group, gives the chat its keyboard back', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.groups[0]!.tabs = []
    harness.groups[0]!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    chat.focus()
    // Act
    const view = await openView(harness, 'cursor-3-27-agent-run-1')
    // Assert
    assert.ok(harness.reader['app'])
    assert.equal(chat.focused(), true)
    assert.equal(
      harness.informationMessages.some(
        ({ message }) => message === APPLICATION_GROUP_TOOK_KEYBOARD_MESSAGE,
      ),
      false,
    )
    view.close()
  } finally {
    await harness.close()
  }
})

// protects=N62 attempt 1 (Cycle 0062 task 3, Cursor 3.27.22): an extension run started from the Agent chat while a preview text tab is in front of the first group (N62's manifest.json) gives the chat its keyboard back after the Application view opens; fails_when=the preview counts as no place to return to and the keyboard stays in the new Application group, as N62 attempt 1 showed (three keys typed without a click reached nothing); no_claim=Cursor's native focus events (N62)
test('an extension run started from Cursor 3.27’s Agent chat beside a preview file in the first group gives the chat its keyboard back', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const preview = harness.openAnnouncedTextTab('manifest.json', 1, {
      isPreview: true,
      isDirty: false,
    })
    const chat = harness.addSeparateEditorPart()
    chat.focus()
    // Act
    const view = await openView(harness, 'cursor-3-27-agent-run-2')
    // Assert
    assert.ok(harness.reader['app'])
    assert.equal(chat.focused(), true)
    assert.equal(preview.isPreview, true)
    assert.equal(
      harness.informationMessages.some(
        ({ message }) => message === APPLICATION_GROUP_TOOK_KEYBOARD_MESSAGE,
      ),
      false,
    )
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
    assert.ok(pane)
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

// protects=AC3: the editor's Save learning replay command for an extension run that recorded no history tells why through a notice, stops nothing and changes no stored study; fails_when=the command throws the old refusal, stops the run or writes progress; no_claim=a run with a history (the save tests)
test('Save learning replay of an extension run without a history stores nothing and does not stop the run', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const storage = await harness.reader.learningStorage()
    const progressBefore = await storage.readProgress()
    const { record } = await startFakeChromeExtensionRun(harness)
    // Act
    await harness.reader.saveLearningReplay()
    // Assert
    assert.deepEqual(await storage.readProgress(), progressBefore)
    assert.equal(record.stopped, false)
    assert.deepEqual(
      harness.informationMessages.map((notice) => notice.message),
      ['Learning replay unavailable: no history was started.'],
    )
  } finally {
    await harness.close()
  }
})

// protects=C4 and AC3: an extension run's status item shows the run's phase text from its view beside its learning replay state and offers Save learning replay; fails_when=the item stays hidden during the run, drops the phase text or still says the run is not saved; no_claim=native status bar rendering
test('the status item of an extension run shows its phase text and its learning replay state', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    // Act
    const { record } = await startFakeChromeExtensionRun(harness)
    await readerSeams(harness).refresh()
    // Assert
    assert.equal(harness.saveStatus.visible, true)
    assert.equal(
      harness.saveStatus.text,
      'Waiting for chat · next click 1 of 2 · Learning replay unavailable: no history was started.',
    )
    assert.deepEqual(structuredClone(harness.saveStatus.command), {
      title: 'Save learning replay',
      command: 'codebook.saveLearningReplay',
      arguments: [`${harness.service.instanceId}_${record.id}`],
    })
  } finally {
    await harness.close()
  }
})
