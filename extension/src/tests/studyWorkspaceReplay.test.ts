import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { RecordingStore } from '../recordingStore'
import type { BookObservationBinding } from '../repositorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { bookObservationHash } from '../utils/bookObservationHash'

import {
  workspaceHarness,
  recordedReaderHarness,
  configuredWorkspaceHarness,
} from './studyWorkspaceHarness'
// Value: protects=a moment committed without native values names where to load them, and the hint leaves once they load; fails_when=the Study message never flags the moment, or keeps the hint after Run and Debug loads values until another seek; why_new=the soft inspection gate commits such moments; seam=TestReplayDebugger models the native load notification
test('a replay moment whose recorded values Run and Debug has not loaded tells the learner where to load them until they load', async () => {
  // Arrange: Variables stays hidden, so native Run and Debug does not load the recorded values within the grace.
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const withoutValues = harness.postedMessages().slice(-1)[0]!,
      presentationsWithoutValues = harness.historicalDebugPresentations.length

    // Act: the learner expands Variables, and the native session reports loaded values without another seek.
    harness.loadHistoricalDebugValues()
    const withValues = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.equal(
      harness.historicalDebugPresentations.at(-1)?.snapshot?.variables[0]?.name,
      'nextTheme',
    )
    assert.equal(withoutValues.recording?.presentedMs, 100)
    assert.equal(withoutValues.recording?.nativeValuesUninspected, true)
    assert.equal(withValues.recording?.presentedMs, 100)
    assert.equal(withValues.recording?.nativeValuesUninspected, false)
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsWithoutValues,
      'loading values needs no new presentation',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Run and Debug hint staying visible while Play advances within one recorded stop; fails_when=the hint disappears on the first Play tick although values are still unloaded; why_new=Play ticks replace the committed bundle without presenting the same stop again; seam=none
test('the Run and Debug hint stays while Play advances through the same recorded stop', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const presentationsAtStop = harness.historicalDebugPresentations.length

    // Act
    harness.controller.command({
      action: 'play',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
    })
    await waitUntil(
      () =>
        (harness.postedMessages().slice(-1)[0]?.recording?.presentedMs ?? 0) >
        100,
      'Play advances past the recorded stop time',
      2_000,
    )
    const advanced = harness.postedMessages().slice(-1)[0]!,
      presentationsWhilePlaying = harness.historicalDebugPresentations.length
    harness.controller.command({
      action: 'pause',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert
    assert.ok((advanced.recording?.presentedMs ?? 0) > 100)
    assert.equal(advanced.recording?.nativeValuesUninspected, true)
    assert.equal(
      presentationsWhilePlaying,
      presentationsAtStop,
      'Play ticks within one stop keep its native presentation',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a recorded gap never tells the learner to load values it does not have; fails_when=the hint from a preceding stop stays at an interval without recorded debugger state; why_new=the hint follows the committed stop snapshot; seam=none
test('seeking from a stop without loaded values into missing history drops the Run and Debug hint', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const atStop = harness.postedMessages().slice(-1)[0]!

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 0,
    })
    await harness.controller.settle()
    const atGap = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.equal(atStop.recording?.nativeValuesUninspected, true)
    assert.equal(atGap.recording?.presentedMs, 0)
    assert.equal(atGap.recording?.nativeValuesUninspected, false)
  } finally {
    await harness.close()
  }
})

test('replay reads app, source and sidebar summary then restores their shared layout without changing history', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.hideGridWhileMaximized()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const selection = harness.reader.inspect().view!.model.selection,
      source = harness.reader.inspect().sourceUri
    const bundle = harness.controller.bundle(),
      panels = harness.nativePanels()
    const progress = await (
      await harness.reader.learningStorage()
    ).readProgress()

    // Act
    await harness.reader.action('read-app')
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.maximizedEditorGroup(), true)
    await harness.reader.action('read-source')
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(harness.maximizedEditorGroup(), true)
    await harness.reader.action('read-context')
    assert.equal(harness.summary.visible, true)
    assert.equal(harness.maximizedEditorGroup(), true)
    await harness.reader.action('arrange')

    // Assert
    assert.equal(harness.summary.visible, true)
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.reader.presentationState().reason, undefined)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })
    assert.deepEqual(harness.nativePanels(), panels)
    assert.equal(panels.length, 1)
    assert.deepEqual(harness.reader.inspect().view!.model.selection, selection)
    assert.equal(harness.reader.inspect().sourceUri, source)
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.deepEqual(
      await (await harness.reader.learningStorage()).readProgress(),
      progress,
    )
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('Restore after focused reading recovers the confirmed Study layout when native space is available', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('read-app')
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.equal(harness.reader.presentationState().reason, undefined)
  } finally {
    await harness.close()
  }
})

test('Restore beside a separate editor part keeps the selected explanation after borrowing primary focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  harness.constrainStudyGrid()
  harness.hideGridWhileMaximized()
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.doesNotMatch(
      harness.reader.presentationState().reason ?? '',
      /learner changed native tab focus/i,
    )
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    await harness.close()
  }
})

test('Restore beside a separate editor part preserves a learner tab chosen during its focus borrow', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  harness.constrainStudyGrid()
  harness.hideGridWhileMaximized()
  let release = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    const held = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    release = held.release

    // Act
    const restoring = harness.reader.action('arrange')
    await held.started
    const draft = harness.focusMutableDraft('newer-scope-notes.txt', 3)
    release()
    await restoring

    // Assert
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 3)?.activeTab,
      draft.tab,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /learner changed native tab focus/i,
    )
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    release()
    await harness.close()
  }
})

test('Restore stops after the learner leaves the work window during its primary focus borrow', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  harness.constrainStudyGrid()
  harness.hideGridWhileMaximized()
  let release = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    const held = harness.holdNextPrimaryFocusResponse()
    release = held.release
    const restoring = harness.reader.action('arrange')
    await held.started
    const layoutChanges = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length

    // Act
    harness.changeWindowFocus(false)
    harness.changeWindowFocus(true)
    release()
    await restoring

    // Assert
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      layoutChanges,
    )
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /learner changed native tab focus/i,
    )
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    release()
    await harness.close()
  }
})

test('successful Study reading clears an earlier background-window reading error', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    harness.changeWindowFocus(false)
    harness.receive({
      type: 'action',
      revision: harness.reader.inspect().view!.revision,
      action: 'read-app',
    })
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.errors.some((error) =>
            error.includes('Focus the Codebook work window'),
          ),
      'background reading error',
      1_000,
    )

    // Act
    harness.changeWindowFocus(true)
    await harness.reader.action('read-app')

    // Assert
    assert.equal(
      harness.reader
        .inspect()
        .view!.errors.some((error) =>
          error.includes('Focus the Codebook work window'),
        ),
      false,
    )
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /Focused application/,
    )
  } finally {
    await harness.close()
  }
})

test('reading a Study pane does not claim focus after the learner selects a draft during native maximization', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.open()
    const held = harness.holdNextCommand(
      'workbench.action.maximizeEditorHideSidebar',
    )
    release = held.release

    // Act
    const reading = harness.reader.action('read-app')
    await held.started
    const draft = harness.focusMutableDraft('later-learner-notes.txt', 1)
    release()

    // Assert
    await assert.rejects(reading, /focus changed|learner.*focus/i)
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 1)?.activeTab,
      draft.tab,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.doesNotMatch(
      harness.reader.presentationState().reason ?? '',
      /Focused application/,
    )
  } finally {
    release()
    await harness.close()
  }
})

test('Read captured source keeps the learner cursor when the selected source is already displayed', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('source')
    harness.changeFocusedSourceSelection(46)
    harness.retainReadingRange(40, 50)
    await harness.reader.action('read-app')

    // Act
    await harness.reader.action('read-source')

    // Assert
    assert.equal(harness.focusedSource()?.selections[0]?.active.line, 46)
    assert.equal(harness.isReadingLineVisible(46), true)
  } finally {
    await harness.close()
  }
})

test('Read captured source accepts an unchanged settings tab before focusing its owned source', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('focus-context')
    const settings = harness.addOpaqueTab('Settings', 3)
    const explanationGroup = harness.groups.find(
      (group) => group.viewColumn === 3,
    )!
    explanationGroup.activeTab = settings

    // Act
    await harness.reader.action('read-source')

    // Assert
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(
      harness.focusedSource()?.document.uri.toString(),
      harness.reader.inspect().sourceUri,
    )
    assert.equal(explanationGroup.tabs.includes(settings), true)
  } finally {
    await harness.close()
  }
})

test('Read captured source preserves a newer draft choice while its existing document opens', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.action('read-app')
    const held = harness.holdNextSource()
    release = held.release

    // Act
    const reading = harness.reader.action('read-source')
    await held.started
    const draft = harness.focusMutableDraft('newer-source-notes.txt', 1)
    release()

    // Assert
    await assert.rejects(reading, /focus changed|learner.*focus/i)
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 1)?.activeTab,
      draft.tab,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.doesNotMatch(
      harness.reader.presentationState().reason ?? '',
      /Focused source/,
    )
  } finally {
    release()
    await harness.close()
  }
})

test('Restore does not rearrange Study after the learner selects a draft during native unmaximize', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.action('read-app')
    const previousArrangements = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    const held = harness.holdNextCommand(
      'workbench.action.minimizeOtherEditors',
    )
    release = held.release

    // Act
    const restoring = harness.reader.action('arrange')
    await held.started
    const draft = harness.focusMutableDraft('later-restore-notes.txt', 3)
    release()
    await restoring

    // Assert
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      previousArrangements,
    )
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 3)?.activeTab,
      draft.tab,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
  } finally {
    release()
    await harness.close()
  }
})

test('constrained Restore keeps a later learner draft active while the native layout receipt settles', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.constrainStudyGrid()
  harness.hideGridWhileMaximized()
  let releaseLayout = (): void => {},
    releaseReceipt = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.action('read-app')
    const layout = harness.holdNextCommand('runCommands')
    releaseLayout = layout.release

    // Act
    const restoring = harness.reader.action('arrange')
    await layout.started
    const receipt = harness.holdNextCommand('vscode.getEditorLayout')
    releaseReceipt = receipt.release
    releaseLayout()
    await receipt.started
    const draft = harness.focusMutableDraft('later-settlement-notes.txt', 3)
    releaseReceipt()
    await restoring

    // Assert
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 3)?.activeTab,
      draft.tab,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /learner changed native tab focus/i,
    )
  } finally {
    releaseLayout()
    releaseReceipt()
    await harness.close()
  }
})

test('constrained Restore leaves the learner draft active when a later topology check completes', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.constrainStudyGrid()
  harness.hideGridWhileMaximized()
  try {
    await harness.reader.open()
    await harness.reader.action('read-app')
    const checkTopology = harness.reader['hasRetainedStudyTopology'].bind(
      harness.reader,
    )
    let newerDraft: ReturnType<typeof harness.focusMutableDraft> | undefined
    harness.reader['hasRetainedStudyTopology'] = async (
      signal,
      beforeScopeFocus,
    ) => {
      const retained = await checkTopology(signal, beforeScopeFocus)
      if (retained)
        newerDraft = harness.focusMutableDraft('later-topology-notes.txt', 3)
      return retained
    }

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.ok(newerDraft)
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 3)?.activeTab,
      newerDraft.tab,
    )
    assert.equal(newerDraft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /learner changed native tab focus/i,
    )
  } finally {
    await harness.close()
  }
})

for (const initial of [
  { mainGroups: 1, separatePart: false, globalGroups: 1 },
  { mainGroups: 1, separatePart: true, globalGroups: 2 },
  { mainGroups: 2, separatePart: true, globalGroups: 3 },
])
  test(`failed initial pane reservation with ${initial.mainGroups} main panes and ${initial.separatePart ? 'a separate part' : 'one part'} cannot create Context before an explicit retry`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: Array.from({ length: initial.mainGroups }, () => ({})),
    })
    const chat = initial.separatePart
        ? harness.addSeparateEditorPart()
        : undefined,
      draft = harness.focusMutableDraft()
    const original = harness.editorLayout()
    harness.failNextCommand('vscode.setEditorLayout')
    try {
      // Act
      await assert.rejects(
        harness.reader.open(),
        /could not reserve separate Codebook panes/,
      )
      await harness.reader['refresh']()

      // Assert
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        1,
      )
      assert.deepEqual(harness.editorLayout(), original)
      assert.equal(harness.groups.length, initial.globalGroups)
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.equal(harness.reader.inspect().sourceUri, undefined)
      assert.equal(harness.reader.inspect().opened, false)
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      if (chat) {
        assert.equal(harness.groups.at(-1)!.tabs.includes(chat.tab), true)
        assert.deepEqual(chat.layout(), {
          orientation: 1,
          groups: [{ size: 743 }],
        })
      }
      assert.equal(
        harness.reader
          .inspect()
          .view!.errors.some((error) =>
            error.includes(
              'The editor did not retain the requested Codebook layout',
            ),
          ),
        true,
      )
      assert.equal(harness.runtimes.length, 0)

      await harness.reader.open()
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.panelColumn('codebook.studyContext'), 3)
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      if (chat) {
        assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
        assert.deepEqual(chat.layout(), {
          orientation: 1,
          groups: [{ size: 743 }],
        })
      }
    } finally {
      await harness.close()
    }
  })

test('ordinary Study entry retains manually shared pane columns until the learner explicitly arranges them', async () => {
  // Arrange
  const harness = await workspaceHarness(false),
    manual = { orientation: 0, groups: [{}, {}] }
  try {
    await harness.reader.open()
    harness.movePanel('codebook.scopedBrowser', 2)
    harness.movePanel('codebook.studyContext', 2)
    harness.changeEditorLayout(manual)

    // Act
    await harness.reader.open()

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 2)
    assert.deepEqual(harness.editorLayout(), manual)
  } finally {
    await harness.close()
  }
})

test('opening a recording restores its captured source after context focus covers the manually moved source group', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  harness.coverSourceWhenContextFocused()
  try {
    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    // Assert
    const state = harness.reader.inspect()
    assert.equal(
      state.view?.recording?.readiness,
      'ready',
      state.view?.recording?.reason,
    )
    const input = harness.groups[0]?.activeTab?.input
    assert.ok(input && 'uri' in input)
    assert.equal(input.uri.toString(), state.sourceUri)
  } finally {
    await harness.close()
  }
})

test('one bottom playback seek from a hidden Application commits the requested recorded moment without another target action', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    const application = viewport.panel
    const applicationGroup = harness.groups.find(
      (group) => group.activeTab === application.nativeTab,
    )
    assert.ok(applicationGroup)
    const reveal = viewport.reveal.bind(viewport)
    // Model the native visibility notification that the existing renderer port omits.
    viewport.reveal = async (): Promise<void> => {
      await reveal()
      application.reveal(undefined, true)
    }
    applicationGroup.activeTab = undefined
    application.notifyViewState()
    assert.equal(application.visible, false)
    const targetActionsBefore = harness.runtimes[0]!.dispatches
    const view = harness.playbackPanelMessages.at(-1)!

    // Act
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 100,
      revision: view.revision,
      expectedRevision: harness.controller.state().revision,
    })
    await new Promise((resolve) => setImmediate(resolve))
    await harness.controller.settle()

    // Assert
    assert.equal(application.visible, true)
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(
      harness.controller.bundle()?.projection.observation?.elapsedMs,
      100,
    )
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
    assert.equal((await harness.store.readPreference())?.positionMs, 100)
    assert.equal(harness.runtimes[0]!.dispatches, targetActionsBefore)
  } finally {
    await harness.close()
  }
})

test('saved replay survives one recorded viewport paint loss without rerunning the target', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    const originalPresent = viewport.present.bind(viewport)
    const revealsBefore = harness.viewportEvents.filter(
      (event) => event === 'reveal:recording',
    ).length
    const targetActionsBefore = harness.runtimes[0]!.dispatches
    let presentations = 0
    viewport.present = async (image): Promise<void> => {
      presentations++
      if (presentations === 1)
        throw new Error('Viewport frame acknowledgement timed out')
      await originalPresent(image)
    }

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(presentations, 2)
    assert.equal(
      harness.viewportEvents.filter((event) => event === 'reveal:recording')
        .length,
      revealsBefore + 1,
    )
    assert.equal(harness.runtimes[0]!.dispatches, targetActionsBefore)
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
  } finally {
    await harness.close()
  }
})

test('saved replay reports a second viewport paint loss without advancing the saved position', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    let presentations = 0
    viewport.present = async () => {
      presentations++
      throw new Error('Viewport frame acknowledgement timed out')
    }

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(presentations, 2)
    assert.equal((await harness.store.readPreference())?.positionMs, 0)
  } finally {
    await harness.close()
  }
})

test('saved replay does not retry a non-paint viewport failure', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    const revealsBefore = harness.viewportEvents.filter(
      (event) => event === 'reveal:recording',
    ).length
    let presentations = 0
    viewport.present = async () => {
      presentations++
      throw new Error('Recorded viewport is closed')
    }

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(presentations, 1)
    assert.equal(
      harness.viewportEvents.filter((event) => event === 'reveal:recording')
        .length,
      revealsBefore,
    )
  } finally {
    await harness.close()
  }
})

test('a repeated recorded paint loss names each attempt’s renderer progress in Recording error details', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    const originalReveal = viewport.reveal.bind(viewport)
    viewport.reveal = async (): Promise<void> => {
      await originalReveal()
      viewport.record('viewport.ready', {
        epoch: '22222222-2222-2222-2222-222222222222',
      })
    }
    let presentations = 0
    viewport.present = async () => {
      presentations++
      viewport.record('viewport.sent', {
        epoch: '11111111-1111-1111-1111-111111111111',
        id: presentations,
        hash: 'recorded-image-hash',
        phase: 'Recorded · 0.10 s',
      })
      if (presentations === 1) {
        viewport.record('viewport.frame-stage', {
          id: 1,
          stage: 'received',
          visibility: 'visible',
          hasArea: true,
        })
        viewport.record('viewport.frame-stage', {
          id: 1,
          stage: 'decoded',
          visibility: 'visible',
          hasArea: true,
        })
        viewport.record('viewport.frame-stage', {
          id: 1,
          stage: 'paint-queued',
          visibility: 'visible',
          hasArea: true,
        })
      } else
        viewport.record('viewport.frame-stage', {
          id: 2,
          stage: 'received',
          visibility: 'hidden',
          hasArea: false,
        })
      viewport.record('viewport.delivery-rejected', {
        id: presentations,
        phase: 'Recorded · 0.10 s',
        reason: 'Viewport frame acknowledgement timed out',
      })
      throw new Error('Viewport frame acknowledgement timed out')
    }

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(
      harness.controller.state().reason,
      'Error: Viewport frame acknowledgement timed out again after one same-frame retry. ' +
        'First attempt: sent #1; received (visible, area); decoded; paint-queued; rejected #1: Viewport frame acknowledgement timed out; panel visible. ' +
        'Retry: ready 22222222; sent #2; received (hidden, no area); rejected #2: Viewport frame acknowledgement timed out; panel visible.',
    )
    assert.equal(presentations, 2)
    assert.equal((await harness.store.readPreference())?.positionMs, 0)
  } finally {
    await harness.close()
  }
})

test('a failed renderer re-handshake after a recorded paint loss keeps the first attempt in Recording error details', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    viewport.reveal = async () => {
      throw new Error('Timed out waiting for owned viewport ready')
    }
    let presentations = 0
    viewport.present = async () => {
      presentations++
      viewport.record('viewport.sent', {
        epoch: '11111111-1111-1111-1111-111111111111',
        id: 1,
        hash: 'recorded-image-hash',
        phase: 'Recorded · 0.10 s',
      })
      viewport.record('viewport.frame-stage', {
        id: 1,
        stage: 'received',
        visibility: 'visible',
        hasArea: false,
      })
      viewport.record('viewport.delivery-rejected', {
        id: 1,
        phase: 'Recorded · 0.10 s',
        reason: 'Viewport frame acknowledgement timed out',
      })
      throw new Error('Viewport frame acknowledgement timed out')
    }

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(
      harness.controller.state().reason,
      'Error: Viewport frame acknowledgement timed out; the same-frame retry could not re-handshake the renderer: Error: Timed out waiting for owned viewport ready. ' +
        'First attempt: sent #1; received (visible, no area); rejected #1: Viewport frame acknowledgement timed out; panel visible. ' +
        'Re-handshake: no renderer receipts; panel visible.',
    )
    assert.equal(presentations, 1)
    assert.equal((await harness.store.readPreference())?.positionMs, 0)
  } finally {
    await harness.close()
  }
})

test('Pause during a late recorded image restores the previous source and preserves only the confirmed position', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const delayed = harness.holdNextImage()
    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await delayed.started
    assert.equal(harness.reader.inspect().view?.loading, true)
    harness.controller.command({
      action: 'pause',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
    })
    delayed.release()
    await harness.controller.settle()
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.recording?.readiness, 'ready', view.recording?.reason)
    assert.equal(view.recording?.presentedMs, 0)
    assert.equal(view.model.observation, undefined)
    assert.equal(
      view.model.source.text,
      '// No source was observed by this recorded position.\n',
    )
    assert.equal(harness.displayedImage(), undefined)
    assert.equal((await harness.store.readPreference())?.positionMs, 0)
  } finally {
    await harness.close()
  }
})

test('a fresh reader restores the saved recording position paused and a live-runtime retirement does not exit playback', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  let reloaded: ReturnType<typeof harness.createReader> | undefined
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    await harness.reader.dispose()
    // Act
    reloaded = harness.createReader()
    await reloaded.attach(harness.service)
    await reloaded.openRecording(harness.studyId)
    await harness.service.playbackController!.settle()
    const restored = reloaded.inspect().view!
    await reloaded.retire(harness.service)
    // Assert
    assert.equal(
      restored.recording?.readiness,
      'ready',
      restored.recording?.reason,
    )
    assert.equal(restored.recording?.presentedMs, 100)
    assert.equal(restored.recording?.mode, 'paused')
    assert.equal(reloaded.inspect().view?.contentTab, 'recording')
    assert.equal(
      reloaded.inspect().view?.model.observation?.values['value:nextTheme'],
      'dark',
    )
    assert.equal(harness.runtimes.length, 1)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await reloaded?.dispose()
    await harness.close()
  }
})

test('saved Study sends captured facts without copying retained source bodies into its webviews', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    await harness.start()
    // Act
    await harness.reader.action('click')
    await harness.reader.action('stop')
    await harness.reader.select('repository/interface/theme')
    const posted = harness
      .postedMessages()
      .findLast(
        (message) => message.model.observation?.actionId === 'repository-click',
      )
    // Assert: native/archive source stays intact while webview metadata remains sufficient.
    assert.ok(posted?.model.observation?.actionId === 'repository-click')
    assert.equal(posted.model.source.text, '')
    assert.equal(posted.model.observation.source.text, '')
    assert.equal(posted.model.observation.values['value:enabled'], false)
    assert.equal(
      harness.reader.inspect().view!.model.source.text,
      'const nextTheme = "dark";\n',
    )
    assert.equal(
      harness.reader.inspect().view!.model.observation!.source.text,
      'const nextTheme = "dark";\n',
    )
  } finally {
    await harness.close()
  }
})

test('configured captured and current native readers accept unchanged BOM and mixed line endings without changing retained bytes', async () => {
  // Arrange
  const source =
      '\uFEFFconst nextTheme = "dark";\r\n// Retained second line.\r',
    harness = await configuredWorkspaceHarness(source)
  try {
    // Act
    const record = await harness.start()
    await harness.reader.action('source')
    await harness.reader.action('current-file')
    // Assert
    assert.equal(harness.reader.inspect().view!.loading, false)
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
    assert.equal(harness.reader.inspect().view!.model.source.text, source)
    assert.equal(
      harness.reader.inspect().view!.model.source.hash,
      sha256(source),
    )
    assert.equal(
      await readFile(join(harness.directory, 'src/theme.ts'), 'utf8'),
      source,
    )
    // Capture and persist the custom bytes too; preparation alone cannot verify fixture fidelity.
    await harness.reader.action('click')
    assert.equal(
      harness.reader.inspect().view!.model.observation!.source.text,
      '\uFEFFconst nextTheme = "dark";\r\n// Retained second line.\r',
    )
    await harness.reader.action('stop')
    const saved = await harness.library.readStudy(
      `${harness.service.instanceId}_${record.id}`,
    )
    assert.equal(
      saved.observations[0]!.source.text,
      '\uFEFFconst nextTheme = "dark";\r\n// Retained second line.\r',
    )
    assert.equal(
      saved.observations[0]!.source.hash,
      '1859ebb4deb7f0440871f8ddbc3cea090984845ce0cfde0ab648ebb493bf01f2',
    )
  } finally {
    await harness.close()
  }
})

test('failed evidence navigation preserves the previous exact article return pose in memory and after restart', async (context) => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  let restarted: ReturnType<typeof harness.createReader> | undefined
  try {
    const record = await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    const study = await harness.library.readStudy(
        `${harness.service.instanceId}_${record.id}`,
      ),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'theme',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: bookObservationHash(observation),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    const origin = {
      bookId: 'interface',
      revision: 1,
      nodeId: 'theme',
      anchorIndex: 1,
      location: { sectionIndex: 2, fraction: 0.75, focusId: 'section-2' },
    }
    await harness.reader.openRepositoryEvidence(
      binding,
      false,
      undefined,
      origin,
    )
    context.mock.method(RecordingStore.prototype, 'readContext', async () => {
      throw new Error('Injected missing recording context')
    })
    // Act
    await assert.rejects(
      harness.reader.openRepositoryEvidence(binding, true, undefined, {
        ...origin,
        anchorIndex: 0,
        location: { sectionIndex: 0, fraction: 0, focusId: 'section-0' },
      }),
      /Injected missing/,
    )
    await harness.reader.action('return-wiki')
    await harness.reader.close()
    restarted = harness.createReader()
    await restarted.open()
    await restarted.action('return-wiki')
    // Assert
    assert.equal(
      JSON.stringify(harness.articleReturns),
      JSON.stringify([origin, origin]),
    )
    assert.equal(
      JSON.stringify((await harness.library.readProgress()).repositoryReturn),
      JSON.stringify({ studyId: study.id, selection: origin }),
    )
  } finally {
    context.mock.restoreAll()
    await restarted?.dispose()
    await harness.close()
  }
})

test('agent-configured input uses the shared reader and complete article understanding without opening or closing a raw target tab', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    const draft = harness.addForeignDraft()
    await harness.library.decide({
      id: randomUUID(),
      item: 'repository/interface/theme',
      sourceHash: harness.study.configuration.source.hash,
      context: harness.study.descriptor!.citationContext,
      understood: true,
      at: '2026-09-20T00:00:00.000Z',
    })
    const record = await harness.start()
    // Act
    harness.configuredClock(2000)
    await harness.reader.action('click')
    await harness.reader.presentation.revealSource(
      harness.configuredRuntimes[0]!.snapshots[0]!,
      'unused raw path',
    )
    const view = harness.reader.inspect().view!
    // Assert
    assert.equal(view.model.selection.itemId, 'repository/interface/theme')
    assert.equal(view.model.progressByItem.length, 1)
    assert.equal(view.nextAction, undefined)
    assert.equal(view.model.matching, true)
    assert.equal(view.model.currentItemTitle, 'Theme')
    assert.equal(view.model.selectedUnderstanding.understood, true)
    assert.equal(view.model.understoodCount, 1)
    assert.ok(view.model.observation?.actionId === 'repository-click')
    assert.equal(view.model.observation.values['value:selection'], null)
    assert.match(harness.reader.inspect().sourceUri!, /^codebook-source:/)
    assert.equal(
      harness.groups
        .flatMap((group) => group.tabs)
        .some(
          (tab) =>
            tab.input instanceof Object &&
            'uri' in tab.input &&
            tab.input.uri.fsPath === join(harness.directory, 'src/theme.ts'),
        ),
      false,
    )
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
    assert.equal(record.profile, 'repository-browser')
    await harness.reader.close()
    assert.equal(harness.groups[0]!.tabs.includes(draft), true)
    assert.equal(draft.isDirty, true)
  } finally {
    await harness.close()
  }
})

test('configured recording-context failure remains visible beside independently saved observation history', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    const saveContext = harness.service.recordings!.saveContext.bind(
      harness.service.recordings!,
    )
    harness.service.recordings!.saveContext = async () => {
      throw new Error('Injected recording context write failure')
    }
    // Act
    const record = await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    const view = harness.reader.inspect().view!
    // Assert
    assert.equal(record.recordingReceipt?.status, 'failed')
    assert.equal(view.study?.historyOutcome, 'saved')
    assert.equal(view.study?.recordingSave?.contextStatus, 'failed')
    assert.match(
      view.study?.recordingSave?.contextReason ?? '',
      /Injected recording context write failure/,
    )
    assert.ok(view.model.observation)
    assert.equal(view.model.continueArguments, undefined)
    harness.service.recordings!.saveContext = saveContext
    await harness.reader.action('retry')
    assert.equal(
      harness.reader.inspect().view?.study?.recordingSave?.contextStatus,
      'saved',
    )
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('configured history rejects learner Run and only a fresh agent request creates another run without dispatching input', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    const first = await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    // Act
    assert.equal(harness.reader.inspect().view!.canRun, false)
    await assert.rejects(
      harness.reader.action('run'),
      /agent.*prepare a study in the open repository/i,
    )
    assert.equal(harness.service.records.size, 1)
    assert.equal(harness.configuredRuntimes.length, 1)
    const second = await harness.start()
    // Assert
    assert.notEqual(second.id, first.id)
    assert.equal(second.profile, 'repository-browser')
    assert.ok(second.profile === 'repository-browser')
    assert.equal(
      JSON.stringify(second.configuration),
      JSON.stringify(harness.study.configuration),
    )
    assert.notEqual(second.key, first.key)
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
    assert.equal(harness.configuredRuntimes[1]!.dispatches, 0)
    assert.equal(
      harness.reader.inspect().view!.model.selection.itemId,
      'repository/interface/theme',
    )
    assert.equal(harness.reader.inspect().view!.canClick, true)
  } finally {
    await harness.close()
  }
})

test('a configured article decision survives reader restart and secondary-file drift without changing its saved citation context', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  let restarted: ReturnType<typeof harness.createReader> | undefined
  try {
    await harness.start()
    await harness.reader.action('click')
    await harness.reader.understand(true)
    await harness.reader.action('stop')
    const before = (await harness.library.readProgress()).decisions
    await harness.reader.close()
    restarted = harness.createReader()
    await restarted.open()
    assert.equal(restarted.inspect().view!.model.understoodCount, 1)
    // Act
    await writeFile(
      join(harness.directory, 'src/mode.ts'),
      'export const mode = "contrast";\n',
    )
    await restarted.action('retry')
    const view = restarted.inspect().view!
    // Assert
    assert.equal(view.model.sourceChanged, true)
    assert.equal(view.model.reviewCount, 1)
    assert.equal(view.model.understoodCount, 0)
    assert.equal(view.model.selectedUnderstanding.understood, true)
    assert.equal(view.model.selectedUnderstanding.context?.anchors.length, 2)
    assert.equal(view.model.source.text, 'const nextTheme = "dark";\n')
    assert.equal(view.model.continueArguments, undefined)
    assert.equal(
      JSON.stringify((await harness.library.readProgress()).decisions),
      JSON.stringify(before),
    )
    assert.equal(harness.configuredRuntimes.length, 1)
  } finally {
    await restarted?.dispose()
    await harness.close()
  }
})

test('a configured outline cannot write historical understanding after a secondary citation changes', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    assert.equal(
      harness.outlineItem('repository/interface/theme').checkboxState,
      0,
    )
    harness.changeOutlineCheckbox('repository/interface/theme', true)
    await waitUntil(
      () => harness.reader.inspect().view!.model.understoodCount === 1,
      'current citation understanding',
      1_000,
    )
    assert.equal(
      harness.outlineItem('repository/interface/theme').checkboxState,
      1,
    )
    const before = JSON.stringify(
      (await harness.library.readProgress()).decisions,
    )
    // Act
    await writeFile(
      join(harness.directory, 'src/mode.ts'),
      'export const mode = "contrast";\n',
    )
    await harness.reader.action('retry')
    const item = harness.outlineItem('repository/interface/theme')
    assert.equal(item.checkboxState, undefined)
    assert.equal(item.description, 'Review needed')
    harness.changeOutlineCheckbox('repository/interface/theme', false)
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.errors.some((error) =>
            error.includes('Current citations differ'),
          ),
      'rejected stale outline event',
      1_000,
    )
    // Assert
    assert.equal(
      JSON.stringify((await harness.library.readProgress()).decisions),
      before,
    )
    assert.equal(
      harness.reader.inspect().view!.model.selectedUnderstanding.understood,
      true,
    )
    assert.equal(harness.reader.inspect().view!.model.understoodCount, 0)
    await harness.reader.understand(false)
    assert.equal(
      harness.reader.inspect().view!.model.selectedUnderstanding.understood,
      false,
    )
    const decisions = (await harness.library.readProgress()).decisions
    assert.equal(decisions.length, 2)
    assert.equal(decisions[1]!.understood, false)
    assert.equal(
      JSON.stringify(decisions[1]!.context),
      JSON.stringify(decisions[0]!.context),
    )
  } finally {
    await harness.close()
  }
})

test('direct configured entry opens its article at the beginning while actual article origins restore their exact pose after restart', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  let restarted: ReturnType<typeof harness.createReader> | undefined
  try {
    await harness.library.selectRepository({
      bookId: 'unrelated',
      revision: 3,
      nodeId: 'other',
      anchorIndex: 0,
      location: { sectionIndex: 2, fraction: 0.9, focusId: 'section-2' },
    })
    const record = await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    assert.equal(
      harness.reader.inspect().view!.repositoryReturnAvailable,
      false,
    )
    assert.equal(
      harness.reader.inspect().view!.repositoryArticleAvailable,
      true,
    )
    await assert.rejects(
      harness.reader.action('return-wiki'),
      /No article return/,
    )
    await harness.reader.action('open-article')
    assert.equal(
      JSON.stringify(harness.articleOpens),
      JSON.stringify([
        { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 },
      ]),
    )
    const study = await harness.library.readStudy(
        `${harness.service.instanceId}_${record.id}`,
      ),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'theme',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: bookObservationHash(observation),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    const origin = {
      bookId: 'interface',
      revision: 1,
      nodeId: 'theme',
      anchorIndex: 1,
      location: { sectionIndex: 1, fraction: 0.65, focusId: 'section-1' },
    }
    // Act
    await harness.reader.openRepositoryEvidence(
      binding,
      false,
      undefined,
      origin,
    )
    await harness.reader.close()
    restarted = harness.createReader()
    await restarted.open()
    await restarted.action('return-wiki')
    // Assert
    assert.equal(restarted.inspect().view!.repositoryReturnAvailable, true)
    assert.equal(
      JSON.stringify(harness.articleReturns),
      JSON.stringify([origin]),
    )
    assert.equal(
      JSON.stringify((await harness.library.readProgress()).repositoryReturn),
      JSON.stringify({ studyId: study.id, selection: origin }),
    )
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  } finally {
    await restarted?.dispose()
    await harness.close()
  }
})

test('configured recording seeks actual facts through the shared reader after runtime exit with no future source or execution authority', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    const record = await harness.start(),
      png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
        'base64',
      )
    assert.ok(record.recording)
    record.recording.frame({ bytes: png, elapsedMs: 100, kind: 'stream' })
    harness.configuredClock(2000)
    await harness.reader.action('click')
    record.recording.frame({ bytes: png, elapsedMs: 2100, kind: 'stream' })
    harness.configuredClock(4000)
    await harness.reader.action('stop')
    const controller = harness.service.playbackController!,
      studyId = record.recording.header.studyId
    // Act
    await harness.reader.openRecording(studyId)
    await controller.settle()
    const before = harness.reader.inspect().view!
    controller.command({
      action: 'seek',
      studyId,
      expectedRevision: controller.state().revision,
      positionMs: 2100,
    })
    await controller.settle()
    const paused = harness.reader.inspect().view!
    // Assert
    assert.equal(before.recording?.readiness, 'ready', before.recording?.reason)
    assert.equal(before.model.observation, undefined)
    assert.equal(
      before.model.source.text,
      '// No source was observed by this recorded position.\n',
    )
    assert.equal(before.model.selectedUnderstanding.known, false)
    assert.equal(paused.recording?.readiness, 'ready', paused.recording?.reason)
    assert.equal(paused.recording?.presentedMs, 2100)
    assert.ok(paused.model.observation?.actionId === 'repository-click')
    assert.equal(paused.model.observation.values['value:enabled'], false)
    assert.equal(paused.model.observation.values['value:selection'], null)
    assert.equal(paused.model.continueArguments, undefined)
    assert.equal(paused.model.matching, false)
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
    assert.equal(harness.displayedImage(), png.toString('base64'))
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  } finally {
    await harness.close()
  }
})

for (const failure of ['corrupt', 'future', 'missing'] as const)
  test(`a ${failure} configured recording keeps the real article return pose, learner ledger and input count intact`, async () => {
    // Arrange
    const harness = await configuredWorkspaceHarness()
    try {
      const record = await harness.start()
      await harness.reader.action('click')
      await harness.reader.understand(true)
      await harness.reader.action('stop')
      const study = await harness.library.readStudy(
          `${harness.service.instanceId}_${record.id}`,
        ),
        observation = study.observations[0]!
      const binding: BookObservationBinding = {
        nodeId: 'theme',
        linkIndex: 0,
        studyId: study.id,
        observationId: observation.id,
        sourceHash: observation.source.hash,
        itemId: observation.itemId,
        observationHash: bookObservationHash(observation),
        elapsedMs: observation.elapsedMs,
        outcome: study.finalOutcome,
      }
      const origin = {
        bookId: 'interface',
        revision: 1,
        nodeId: 'theme',
        anchorIndex: 1,
        location: { sectionIndex: 2, fraction: 0.75, focusId: 'section-2' },
      }
      await harness.reader.openRepositoryEvidence(
        binding,
        false,
        undefined,
        origin,
      )
      const ledger = JSON.stringify(
          (await harness.library.readProgress()).decisions,
        ),
        store = new RecordingStore(
          harness.library.directory,
          harness.library.workspaceKey,
        )
      const path = join(store.path(study.id, 2), 'header.json'),
        header = await readFile(path)
      // Act
      if (failure === 'missing') await unlink(path)
      else
        await writeFile(
          path,
          failure === 'corrupt'
            ? '{broken'
            : JSON.stringify({ ...JSON.parse(header.toString()), version: 99 }),
        )
      await harness.reader.openRecording(study.id)
      await harness.service.playbackController!.settle()
      const failed = harness.reader.inspect().view!
      await harness.reader.action('return-wiki')
      // Assert
      assert.equal(failed.recording?.readiness, 'failed')
      assert.equal(failed.repositoryReturnAvailable, true)
      assert.equal(failed.model.continueArguments, undefined)
      assert.equal(
        JSON.stringify(harness.articleReturns),
        JSON.stringify([origin]),
      )
      assert.equal(
        JSON.stringify((await harness.library.readProgress()).decisions),
        ledger,
      )
      assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
      assert.equal(harness.service.playbackController!.state().mode, 'paused')
      if (failure !== 'missing')
        assert.equal(
          await readFile(path, 'utf8'),
          failure === 'corrupt'
            ? '{broken'
            : JSON.stringify({ ...JSON.parse(header.toString()), version: 99 }),
        )
      await writeFile(path, header)
    } finally {
      await harness.close()
    }
  })

// Value: protects=a reopened reader never pointing at Run and Debug values from the native session that closing disposed; fails_when=closing keeps the replay moment's hint, which the reopened reader shows for the retained moment; why_new=Cycle 0032 T2, the close reset had no replay test; seam=none
test('a reader reopened after closing never shows the Run and Debug hint of the replay moment it showed before', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  let release = (): void => {}
  try {
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const beforeClose = harness.postedMessages().slice(-1)[0]!

    // Act: observe the reopened reader while its new session is still presenting the retained moment.
    await harness.reader.close()
    const presenting = harness.holdHistoricalDebugPresentation()
    release = presenting.release
    const reopening = harness.reader.open()
    await presenting.started
    const whilePresenting = harness.postedMessages().slice(-1)[0]!
    presenting.release()
    await reopening
    await harness.controller.settle()

    // Assert
    assert.equal(beforeClose.recording?.nativeValuesUninspected, true)
    assert.equal(whilePresenting.recording?.presentedMs, 100)
    assert.equal(whilePresenting.recording?.nativeValuesUninspected, false)
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=the reader showing why native values did not update, then dropping that stale error once a notification is handled; fails_when=the failed callback stops reaching report, or the 'replay-debugger' error is never cleared; why_new=Cycle 0033 M1 (d) and S7 failed→report wiring; seam=none
test('a native values notification the reader failed to handle is shown, and the next handled notification clears it', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Act
    harness.failHistoricalDebugNotification(new Error('Reader update failed'))
    const afterFailure = harness.postedMessages().slice(-1)[0]!
    harness.loadHistoricalDebugValues()
    const afterValuesLoaded = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.ok(afterFailure.errors.includes('Error: Reader update failed'))
    assert.equal(
      afterValuesLoaded.errors.includes('Error: Reader update failed'),
      false,
    )
    assert.equal(afterValuesLoaded.recording?.nativeValuesUninspected, false)
  } finally {
    await harness.close()
  }
})

// Value: protects=closing the reader while a recorded frame never paints, for example behind a hidden replay panel; fails_when=close() waits on the presentation loop without a bound, or the loop waits on a frame whose presentation was retired; why_new=Cycle 0033 L2/O2/O4 (the close settle had no bound); seam=none
test(
  'closing the reader while a recorded frame never paints still finishes',
  { timeout: 30_000 },
  async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    let release = (): void => {}
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      const neverPainted = harness.holdNextImage()
      release = neverPainted.release
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 100,
      })
      await neverPainted.started

      // Act
      const outcome = await Promise.race([
        harness.reader.close().then(
          () => 'closed',
          (error: unknown) => String(error),
        ),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('still closing'), 7_000),
        ),
      ])

      // Assert
      assert.equal(outcome, 'closed')
    } finally {
      release()
      await harness.close()
    }
  },
)

// Value: protects=closing the reader while native Run and Debug never answers a recorded stop; fails_when=close() waits on the presentation loop without a bound while that loop waits on a debugger presentation that ignores its cancellation; why_new=Cycle 0033 O4 (the never-painting close test passes on b9c846b, so the close bound had no failing-first test); seam=none
test(
  'closing the reader while the native debugger never answers a recorded stop still finishes',
  { timeout: 30_000 },
  async () => {
    // Arrange
    const harness = await recordedReaderHarness(true, true)
    const stuckDebugger = harness.holdHistoricalDebugPresentation(true)
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 100,
      })
      await stuckDebugger.started

      // Act
      const outcome = await Promise.race([
        harness.reader.close().then(
          () => 'closed',
          (error: unknown) => String(error),
        ),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('still closing'), 7_000),
        ),
      ])

      // Assert
      assert.equal(outcome, 'closed')
    } finally {
      stuckDebugger.release()
      await harness.close()
    }
  },
)
