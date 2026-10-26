import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'
import { startLiveTestRun } from './utils/startLiveTestRun'

// Value: protects=the first Open replay after a node-test run whose live Application pane closed at the run's end and left its empty, locked group at column 1 beside a learner's source group and a Welcome group (F382, VS Code 1.142.0 N50 round 1): the replay is shown with the Application at column 1 in the summary composition (no Study pane since Cycle 0051, moves with D8, F123), nothing is written as a refused placement, and the learner's Welcome and source tabs stay; fails_when=the first Open replay refuses with the placement sentence, writes a placement-refused entry, shows no replay, or loses the learner's tabs; why_new=Cycle 0050 F382 (the native layout before the press: an empty locked group above the source group and a Welcome group to the right); seam=workspaceHarness with the fake owned Node run, the run's own Application preparation with the reader closed (prepareApplicationGroup), closeApplicationPaneOfEndedRun with refuseNextGroupClose (the group the editor keeps), the diagnostics log; no_claim=this passes on the code of 5868b54, so it does not show F382's cause: the native refusal is not reproduced by the fake editor
test('the first Open replay after a node-test run that left its empty locked Application group shows the replay without a placement refusal', async () => {
  // Arrange: the run's Application stood in its own locked group above the source group; the run ended, the pane closed and the editor kept the emptied group.
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.addOpaqueTab('Welcome', 2)
    const { record, studyId } = await startLiveTestRun(harness, 'f382')
    harness.focusMutableDraft('utils.ts', 1)
    await readerSeams(harness).refresh()
    await harness.reader['prepareApplicationGroup'](
      undefined,
      undefined,
      false,
      undefined,
      true,
    )
    for (const generation of [1, 2])
      await harness.service.continue({
        instanceId: harness.service.instanceId,
        runId: record.id,
        participant: 'server',
        sessionId: 'owned-session',
        threadId: 7,
        generation,
      })
    await harness.service.stop({
      instanceId: harness.service.instanceId,
      runId: record.id,
    })
    await readerSeams(harness).refresh()
    harness.refuseNextGroupClose()
    await harness.reader['closeApplicationPaneOfEndedRun']()
    await harness.reader.saveLearningReplay(studyId)

    // Act
    await harness.reader.openLearningReplay(studyId)

    // Assert: the summary composition (Cycle 0051, DS-A) has no Study pane; the leftover group stands empty no more.
    assert.equal(
      harness.groups.some((group) => group.tabs.length === 0),
      false,
    )
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(
      harness.reader.inspect().view?.nodeHistory?.header.studyId,
      studyId,
    )
    assert.deepEqual(
      logged.filter(
        (entry) => entry.surface === 'presentation:placement-refused',
      ),
      [],
    )
    assert.deepEqual(harness.errorMessages, [])
    const tabLabels = harness.groups.flatMap((group) =>
      group.tabs.map((tab) => tab.label),
    )
    assert.ok(tabLabels.includes('Welcome'))
    assert.ok(tabLabels.includes('utils.ts'))
  } finally {
    await harness.close()
  }
})

// Value: protects=the first Open replay after Developer: Reload Window left the earlier window's empty, locked Application group at column 1 above the learner's source group, with the Welcome group at the right and the earlier window's record proving that group (F382, VS Code 1.142.0 round 1 and x4): Codebook retires the proven leftover as its own removal, shows the replay, writes nothing as a refused placement, and the learner's Welcome and Notes tabs stay; the Application then shares the source group as it does after a cold open without any leftover; fails_when=the first Open replay refuses with the placement sentence, writes a placement-refused entry, shows no replay, leaves the empty locked group standing, or loses a learner tab; why_new=Cycle 0050 F382 (the native precondition is the editor's restore of the earlier window's group, not a run's leftover); seam=workspaceHarness (a fresh reader over the earlier window's applicationGroupMarkers record), leaveEmptyLockedGroup, the fake owned Node run, focusChatInSecondarySideBar (the chat view has the keyboard), the diagnostics log; no_claim=this passes on the code of c698cbb, so it does not show why the native entry refused: the fake editor reports the removal and the active group in one turn
test('the first Open replay after a window reload retires the restored empty locked Application group and shows the replay without a placement refusal', async () => {
  // Arrange: the editor restored [empty locked group, Notes group, Welcome group]; the earlier window's record proves the first one; a run ended with no Application pane; the chat view has the keyboard.
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
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
    harness.groups[1]!.tabs = []
    harness.addOpaqueTab('Notes', 2)
    harness.addOpaqueTab('Welcome', 3)
    const { record, studyId } = await startLiveTestRun(harness, 'f382-reload')
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    for (const generation of [1, 2])
      await harness.service.continue({
        instanceId: harness.service.instanceId,
        runId: record.id,
        participant: 'server',
        sessionId: 'owned-session',
        threadId: 7,
        generation,
      })
    await harness.service.stop({
      instanceId: harness.service.instanceId,
      runId: record.id,
    })
    await readerSeams(harness).refresh()
    await harness.reader.saveLearningReplay(studyId)
    harness.focusChatInSecondarySideBar()

    // Act
    await harness.reader.openLearningReplay(studyId)

    // Assert
    assert.equal(harness.groups.includes(leftover), false)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    // The summary composition (Cycle 0051, DS-A) has no Study pane.
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(
      harness.reader.inspect().view?.nodeHistory?.header.studyId,
      studyId,
    )
    assert.deepEqual(
      logged.filter(
        (entry) => entry.surface === 'presentation:placement-refused',
      ),
      [],
    )
    assert.deepEqual(harness.errorMessages, [])
    const tabLabels = harness.groups.flatMap((group) =>
      group.tabs.map((tab) => tab.label),
    )
    assert.ok(tabLabels.includes('Welcome'))
    assert.ok(tabLabels.includes('Notes'))
  } finally {
    await harness.close()
  }
})

// Value: protects=the refusal report of N55-F4 refusal 1's diagnostics: a refusal of the focus guard names its call site, the comparison that failed, the tab each group showed, the focused tab at arming against the active tab at the refusal and the editor command Codebook itself issued since arming; fails_when=the report names only the guard and the groups, so a native take cannot tell the editor's late report from Codebook's own focus effect; why_new=Cycle 0056 task 17 stage 1; seam=workspaceHarness with two groups, the guard armed through its seam, Codebook's own focus command, the diagnostics log; no_claim=which of Cursor's reports caused the native refusal (N56 step 1)
test('a refused focus guard names its call site, the failed comparison, the front tabs and Codebook’s own effect', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.focusMutableDraft('first.ts', 1)
    harness.focusMutableDraft('second.ts', 2)
    const assertPlacement = harness.reader['retainPresentationPlacement'](
      'exampleCaller/assertExample',
    )

    // Act: Codebook itself moves the keyboard to the first group while the guard waits.
    await harness.reader['executeEditorCommand'](
      'workbench.action.focusFirstEditorGroup',
    )
    let refusal: unknown
    try {
      assertPlacement()
    } catch (error) {
      refusal = error
    }

    // Assert
    assert.equal(
      String(refusal),
      'Error: Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
    )
    const entries = logged.filter(
      (entry) => entry.surface === 'presentation:placement-refused',
    )
    assert.equal(entries.length, 1)
    const lines = entries[0]!.cause.split('\n')
    assert.deepEqual(lines.slice(0, 3), [
      'Guard: retainPresentationPlacement',
      'Call site: exampleCaller/assertExample',
      'Failed checks: focus group, source',
    ])
    assert.deepEqual(
      lines.filter(
        (line) =>
          line.startsWith('Front tabs') ||
          line.startsWith('Focused tab') ||
          line.startsWith('Active tab'),
      ),
      [
        'Front tabs before: 1 "first.ts" (text) | 2* "second.ts" (text)',
        'Front tabs after: 1* "first.ts" (text) | 2 "second.ts" (text)',
        'Focused tab at arming: "second.ts" (text)',
        'Active tab at refusal: "first.ts" (text)',
      ],
    )
    assert.match(
      entries[0]!.cause,
      /Codebook’s own effects since arming:\n {2}\+\d+ ms command workbench\.action\.focusFirstEditorGroup$/,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the editor reports a refusal's entry lists besides the group changes: the tab operation (which tab closed) and the view-state report of an owned pane (active, visible, column); fails_when=a refusal after a tab closed or a pane reported its view state lists no such event, so a native take cannot tell which report preceded the refusal; why_new=Cycle 0056 task 17 stage 1 (the group events were all the log held); seam=workspaceHarness with an open reader, the guard armed through its seam, closeTabByHand, the Application pane's view-state notification, the diagnostics log; no_claim=the order Cursor sends them in
test('a refused guard lists the tab operation and the pane view-state report the editor sent while it waited', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    const learnerDraft = harness.focusMutableDraft('learner.ts', 2)
    await harness.reader.open()
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.ok(application)
    const assertPlacement = harness.reader['retainPresentationPlacement'](
      'exampleCaller/assertEvents',
    )

    // Act
    application.notifyViewState()
    harness.closeTabByHand(learnerDraft.tab)
    // The learner then puts the keyboard in another file, which the guard refuses.
    harness.focusMutableDraft('other.ts', 1)
    try {
      assertPlacement()
    } catch {
      // The refusal is written to the log; the test reads it there.
    }

    // Assert
    const entries = logged.filter(
      (entry) => entry.surface === 'presentation:placement-refused',
    )
    assert.equal(entries.length, 1)
    assert.match(
      entries[0]!.cause,
      /Events while armed:\n(?:.*\n)*? {2}\+\d+ ms Application view state active=(?:true|false) visible=(?:true|false) column=\d+\n(?:.*\n)*? {2}\+\d+ ms tabs opened \[\] closed \["learner\.ts"\] changed \[\]/,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Codebook: Close Study Workspace after a replay opened (N56 native finding on 8b76a578): panes the editor already disposed with their tabs are disposed again without reading their identity, so the close ends without `Webview is disposed`; fails_when=the effect note reads viewType or viewColumn of a disposed panel, which throws as the editor's WebviewPanel does, and the close rejects; why_new=Cycle 0056 task 17 stage 1 (the new disposal note); seam=workspaceHarness whose disposed panels throw from viewType and viewColumn, an open reader with both panes; no_claim=the editor's own dialog
test('closing the Study workspace ends without an error when the editor already disposed its panes', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.throwFromDisposedPanelGetters()
  try {
    await harness.reader.open()

    // Act
    const closing = harness.reader.close().then(
      () => 'closed',
      (error: unknown) => String(error),
    )

    // Assert
    assert.equal(await closing, 'closed')
  } finally {
    await harness.close()
  }
})
