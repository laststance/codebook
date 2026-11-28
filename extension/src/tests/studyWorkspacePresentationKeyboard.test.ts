import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'
import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  workspaceHarness,
  readerSeams,
  recordedReaderHarness,
} from './studyWorkspaceHarness'
import {
  advanceClockUntil,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'

/** Lists the commands a reader ran that move the keyboard between editor groups or to Cursor's chat, in order: the editor's group focus commands and Cursor's "Focus Agent". @example keyboardCommands(harness) // => ['workbench.action.focusFirstEditorGroup', 'composer.focusComposer'] */
const keyboardCommands = (
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
): string[] => harness.commands.filter(isKeyboardCommand)

/** Tells whether a command moves the keyboard between editor groups or to Cursor's chat; see {@link keyboardCommands}. @example isKeyboardCommand('composer.focusComposer') // => true */
function isKeyboardCommand(command: string): boolean {
  return /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
    command,
  )
}

/** Starts a run of the harness's configured study and follows it to its first pause, as an agent's start and input do; the reader is left as it was. @example const record = await pauseLiveRun(harness) */
const pauseLiveRun = async (
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
) => {
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: randomUUID(),
  })
  const record = harness.service.record(receipt)
  await record.preparation
  harness.service.action({
    instanceId: harness.service.instanceId,
    runId: record.id,
    key: randomUUID(),
    action: 'repository-click',
  })
  return record
}

// Value: protects=a presentation select answering with the opened reader after the learner closed the Study workspace during a paused run; fails_when=Close keeps the live or replay arrangement flag, so the next select arranges panes of a closed reader and is refused until Open Study Workspace is run; why_new=Cycle 0045 NF-21: no test selected a presentation after a close that ended a live arrangement; seam=workspace harness with the controlled runtime
test('a selection after Close Study Workspace during a paused run opens the reader instead of refusing the live layout', async () => {
  // Arrange: the learner followed a run to its pause in the live arrangement, then closed the Study workspace, which stops the run.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await pauseLiveRun(harness)
    await harness.reader.open()
    const liveBeforeClose = readerSeams(harness).isLiveArrangement()
    await harness.reader.close()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(liveBeforeClose, true)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, 3)
  } finally {
    await harness.close()
  }
})

// Value: protects=a presentation select answering with the opened reader after a first entry during a paused run was refused; fails_when=the refused entry keeps the live arrangement flag of a reader that is not open, so the next select arranges two rows in a window that holds no Codebook pane and is refused until Open Study Workspace, Open replay or Close; why_new=Cycle 0045 local review study-1 #2 (NF-21 reset the flags in Close only); seam=workspace harness with the controlled runtime and failNextPanelCreation
test('a selection after a first entry that was refused during a paused run opens the reader in the live arrangement', async () => {
  // Arrange: an agent's run is paused, the reader is closed and the learner's file has the focus; the first selection is refused inside the entry, after the entry chose the live arrangement.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    harness.focusMutableDraft()
    await pauseLiveRun(harness)
    const closed = harness.reader.presentationState()
    harness.failNextPanelCreation('codebook.scopedBrowser')
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: closed.presentationId,
        expectedRevision: closed.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      }),
    )
    const refused = {
      state: harness.reader.presentationState().state,
      live: readerSeams(harness).isLiveArrangement(),
      panels: harness.counts().panels,
    }
    const state = harness.reader.presentationState()

    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert
    assert.deepEqual(refused, { state: 'closed', live: false, panels: 0 })
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(readerSeams(harness).isLiveArrangement(), true)
  } finally {
    await harness.close()
  }
})

/** The editor commands that hide or show a side bar; a reading whose side bars could not be measured runs none of them. */
const SIDE_BAR_COMMANDS = [
  'workbench.action.closeSidebar',
  'workbench.action.maximizeEditorHideSidebar',
  'workbench.action.focusSideBar',
  'workbench.action.focusAuxiliaryBar',
]

for (const open of [
  { primary: false, auxiliary: true },
  { primary: true, auxiliary: false },
  { primary: false, auxiliary: false },
  { primary: true, auxiliary: true },
])
  // Value: protects=the learner's side bars through a Read of the Application pane during a live run and the Restore that ends it: each bar is open or closed as the learner had it; fails_when=the live arrangement's two rows give the reader no width to measure the bars by, the Read hides both anyway and its end shows both, so a learner who keeps the file explorer or the chat closed gets it opened by every Read; why_new=Cycle 0045 local review study-1 #1 (the "stays closed" tests of NF-22 used the three-pane columns only); seam=the workspace harness's side bar model, the controlled runtime and the fake editor's maximized group
  test(`a Read in the live arrangement and its Restore leave the side bars as the learner has them, with the primary side bar ${open.primary ? 'open' : 'closed'} and the secondary one ${open.auxiliary ? 'open' : 'closed'}`, async () => {
    // Arrange: a paused live run in its two rows; the learner reads the Application pane enlarged.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.modelSideBars(open)
    try {
      await pauseLiveRun(harness)
      await harness.reader.open()
      const liveBeforeRead = readerSeams(harness).isLiveArrangement()
      await harness.reader.action('read-app')
      const duringRead = {
        ...harness.sideBars(),
        maximized: harness.maximizedEditorGroup(),
      }
      const state = harness.reader.presentationState()

      // Act
      const restored = await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })

      // Assert
      assert.equal(liveBeforeRead, true)
      assert.deepEqual(duringRead, {
        ...open,
        hasKeyboard: false,
        maximized: true,
      })
      assert.deepEqual(harness.sideBars(), { ...open, hasKeyboard: false })
      assert.equal(harness.maximizedEditorGroup(), false)
      assert.equal(restored.layoutConfirmed, true)
      assert.equal(restored.reason, undefined)
      // No bar is hidden for a measurement that cannot be made, and none is shown.
      assert.deepEqual(
        harness.commands.filter((command) =>
          SIDE_BAR_COMMANDS.includes(command),
        ),
        [],
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=a Restore after a Read in a live run ending confirmed, with the keyboard on the pane that had it, when the editor names another group as the active one for a moment while the Read's maximization ends; fails_when=that event of the Restore's own un-maximize is read as the learner choosing another tab, and the Restore, which arranged the panes, answers "The learner changed native tab focus while the Study layout command was pending. The newer choice was preserved." although nobody touched the window; why_new=Cycle 0046 row 4 (Cycle 0045 NF-7b, Cursor checks F8 and F6); seam=the workspace harness's nameAnotherGroupWhenMaximizationEnds and the controlled runtime
test('a Restore after a Read in a live run is confirmed when the editor names another group for a moment while the maximization ends', async () => {
  // Arrange: a paused live run in its two rows; the learner read the Application pane enlarged, and the editor names the source's group for 40 ms when that maximization ends.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.nameAnotherGroupWhenMaximizationEnds(2, 40)
  try {
    await pauseLiveRun(harness)
    await harness.reader.open()
    await harness.reader.action('read-app')
    const focusedBefore = harness.focusedPanel()
    const state = harness.reader.presentationState()

    // Act
    const restored = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })

    // Assert
    assert.equal(focusedBefore, 'codebook.scopedBrowser')
    assert.equal(restored.layoutConfirmed, true)
    assert.equal(restored.reason, undefined)
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.maximizedEditorGroup(), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=the pane's Restore after a Read in the three-pane Study layout ending confirmed when the editor names another group as the active one for a moment while the Read's maximization ends; fails_when=the three-pane Restore reads that event of its own un-maximize as the learner choosing another tab and leaves the layout unconfirmed with "The learner changed native tab focus while the Study layout command was pending. The newer choice was preserved."; why_new=Cycle 0046 row 4 (the three-pane Restore uses the same guard as the live one); seam=the workspace harness's nameAnotherGroupWhenMaximizationEnds
test('a Restore after a Read in the three-pane Study layout is confirmed when the editor names another group for a moment while the maximization ends', async () => {
  // Arrange: the learner read the explanation enlarged; the editor names the Application pane's group for 40 ms when that maximization ends.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.nameAnotherGroupWhenMaximizationEnds(1, 40)
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.maximizedEditorGroup(), false)
    const restored = await harness.reader.readPresentationState()
    assert.equal(restored.layoutConfirmed, true)
    assert.equal(restored.reason, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner who selects another tab while a Restore after a Read in a live run ends the maximization keeping that tab, the Restore refused with the sentence that says so; fails_when=the allowance for the editor's own events of the un-maximize also swallows a change that lasts, and the Restore takes the keyboard back from the learner's tab; why_new=Cycle 0046 row 4 (the separation of the editor's event from a learner's change needs its other side); seam=holdNextCommand on the Restore's un-maximize, the learner's focusMutableDraft, the controlled runtime
test('a learner who selects another tab while a Restore in a live run ends the maximization keeps that tab and the Restore says so', async () => {
  // Arrange: a paused live run in its two rows; the learner read the Application pane enlarged.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await pauseLiveRun(harness)
    await harness.reader.open()
    await harness.reader.action('read-app')
    const state = harness.reader.presentationState()
    const held = harness.holdNextCommand(
      'workbench.action.minimizeOtherEditors',
    )
    release = held.release

    // Act: while the Restore ends the maximization, the learner selects a file of their own in the source's group.
    const restoring = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    await held.started
    const draft = harness.focusMutableDraft('newer-notes.txt', 2)
    release()
    const refusal = await restoring.then(
      () => 'restored',
      (error: unknown) => String(error),
    )

    // Assert
    assert.equal(
      refusal,
      'Error: The learner changed native tab focus while the Study layout command was pending. The newer choice was preserved.',
    )
    assert.equal(
      harness.editor.window.tabGroups.activeTabGroup.activeTab,
      draft.tab,
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=the learner's side bars through a Read of the captured source in a recording and Close Study Workspace: a bar the learner keeps closed is closed afterwards and an open one is open; fails_when=the replay arrangement's two rows give no width, the Read hides both bars and Close shows both, which opens the bar the learner had closed; why_new=Cycle 0045 local review study-1 #1 (the replay arrangement was covered only by a test that pinned both show commands); seam=the recorded reader harness, the workspace harness's side bar model and the fake editor's maximized group
test('a Read in a recording and Close Study Workspace leave a side bar the learner had closed as it was', async () => {
  // Arrange: a recording is open in its two rows, the primary side bar closed and the secondary one open; the learner reads the captured source enlarged.
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: false, auxiliary: true })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.action('read-source')
    const duringRead = {
      ...harness.sideBars(),
      maximized: harness.maximizedEditorGroup(),
    }

    // Act
    await harness.reader.close()

    // Assert
    assert.deepEqual(duringRead, {
      primary: false,
      auxiliary: true,
      hasKeyboard: false,
      maximized: true,
    })
    assert.deepEqual(harness.sideBars(), {
      primary: false,
      auxiliary: true,
      hasKeyboard: false,
    })
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.deepEqual(
      harness.commands.filter((command) => SIDE_BAR_COMMANDS.includes(command)),
      [],
    )
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's first presentation select during a paused run answering with the live panes arranged and confirmed; fails_when=the selection that opened a closed reader into the live arrangement still waits for a Study pane's render, which that arrangement does not have, and is refused after five seconds; why_new=Cycle 0045 NF-19: every selection test of a closed reader ran without a current run; seam=workspace harness with the controlled runtime
test('the first presentation select during a paused live run with the reader closed arranges the live panes and answers a confirmed layout', async () => {
  // Arrange: an agent's run is paused at its stop and the learner has not opened the Study workspace; the learner's file has the focus.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const draft = harness.focusMutableDraft()
    await pauseLiveRun(harness)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(state.state, 'closed')
    assert.equal(selected.state, 'open')
    assert.equal(selected.mode, 'study-workspace')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, undefined)
    assert.equal(readerSeams(harness).isLiveArrangement(), true)
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(draft.tab),
      true,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

for (const replacesGroupObjects of [false, true])
  // Value: protects=an agent's presentation select being admitted while the agent's own chat tab has the keyboard focus, with the chat left as it is and focused again afterwards; fails_when=the admission refuses every focused tab that is no text editor, or the arranged panes keep the focus, or the group objects the editor replaces with each tab change make the arrangement lose its groups; why_new=Cycle 0045 cause 7 of the baseline round (Cursor: the Agent chat is a tab of an editor group with no known input, and nobody can focus anything else while the agent works); seam=workspace harness with a separate editor part and the fake editor's group object replacement
  test(`a presentation selection made while a tab that is not a text editor has the focus in another group arranges the Study panes and gives that group the focus back, ${replacesGroupObjects ? 'also when the editor replaces every tab group object with each tab change as Cursor does' : 'in an editor that keeps its tab group objects'}`, async () => {
    // Arrange: the agent's chat is a tab of its own editor part and has the keyboard focus; the reader is closed.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const chat = harness.addSeparateEditorPart()
    if (replacesGroupObjects) harness.replaceGroupObjectsOnTabChanges()
    try {
      chat.focusTab()
      const state = harness.reader.presentationState()
      // Act
      const selected = await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      // Assert
      const chatGroup = harness.groups.find((group) =>
        group.tabs.includes(chat.tab),
      )
      assert.equal(selected.state, 'open')
      assert.equal(selected.layoutConfirmed, true)
      assert.equal(selected.reason, undefined)
      assert.equal(selected.panes.appColumn, 1)
      assert.equal(selected.panes.sourceColumn, 2)
      assert.equal(selected.panes.contextColumn, 3)
      // The chat tab was neither closed nor moved into a Study group: it is the only tab of its own group, behind the three Study groups.
      assert.equal(chatGroup?.viewColumn, 4)
      assert.equal(chatGroup?.tabs.length, 1)
      assert.equal(chatGroup?.activeTab, chat.tab)
      // The chat has the keyboard again through Cursor's own command; the focus command of the chat's column, which would open a new empty group in the main editor, was not run.
      assert.deepEqual(keyboardCommands(harness), [
        'workbench.action.focusFirstEditorGroup',
        'composer.focusComposer',
      ])
      assert.equal(harness.groups.length, 4)
      assert.equal(chat.focused(), true)
      assert.equal(harness.editor.window.activeTextEditor, undefined)
    } finally {
      await harness.close()
    }
  })

for (const reader of ['closed', 'open'] as const)
  // Value: protects=the refusal for a preview tab that would be replaced by a placed pane naming that tab and the step that clears it, also when that tab itself has the focus; fails_when=a focused image preview is answered with a refusal that names no tab, or the selection moves panes over it; why_new=Cycle 0045 NF-26: the tab was named only while a text editor had the focus (the refusal read "Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely."); seam=addOpaqueTab, focusOpaqueTab
  test(`a selection refused while an image preview has the focus names that tab and how to clear it, on ${reader === 'closed' ? 'a closed' : 'an open'} reader`, async () => {
    // Arrange: the learner single-clicked an image, which the editor shows as a preview tab in the first column, and it has the focus.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      if (reader === 'open') await harness.reader.open()
      else await harness.reader.attach(harness.service)
      const image = harness.addOpaqueTab('logo.png', 1)
      image.isPreview = true
      harness.focusOpaqueTab(image)
      const state = harness.reader.presentationState(),
        commands = [...harness.commands],
        reveals = harness.panelReveals(),
        tabsBefore = harness.groups.flatMap((group) => group.tabs)
      // Act
      const refused = (async () =>
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'living-book',
          action: 'select',
        }))()
      // Assert
      await assert.rejects(refused, {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'A destination group contains a foreign preview: "logo.png" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
      })
      assert.equal(image.isPreview, true)
      assert.deepEqual(
        harness.groups.flatMap((group) => group.tabs),
        tabsBefore,
      )
      assert.deepEqual(harness.commands, commands)
      assert.deepEqual(harness.panelReveals(), reveals)
      assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      assert.equal(harness.presentationPreferences.size, 0)
    } finally {
      await harness.close()
    }
  })

// Value: protects=the refusal of a live arrangement naming the tab that covers the captured source and the step that clears it; fails_when=the cause reads "The current captured source is not ready in its native pane. Wait for it, …", which names no tab and nothing the reader can do about one; why_new=Cycle 0045 NF-26: the live branch of a selection inspected no tab; seam=workspace harness with the controlled runtime, addOpaqueTab, focusOpaqueTab
test('a live selection refused because a tab covers the captured source names that tab', async () => {
  // Arrange: the reader follows a paused run in the live arrangement; the learner opened an image in the source group, where it covers the captured source and has the focus.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await pauseLiveRun(harness)
    await harness.reader.open()
    const image = harness.addOpaqueTab('logo.png', 2)
    harness.focusOpaqueTab(image)
    const state = harness.reader.presentationState()
    // Act
    const refused = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    await assert.rejects(refused, {
      code: 'PRESENTATION_UNAVAILABLE',
      message: 'The live Study layout could not be confirmed after Restore.',
      causeDetail:
        'The tab "logo.png" is in front of the captured source in editor group 2. Close that tab or select the captured source\'s tab, then restore the layout again.',
    })
    assert.equal(readerSeams(harness).isLiveArrangement(), true)
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 2)?.activeTab,
      image,
    )
  } finally {
    await harness.close()
  }
})

for (const reader of ['closed', 'open'] as const)
  // Value: protects=an agent's presentation select during its own paused run in Cursor ending with the live panes confirmed and the agent's chat focused, whether the Study workspace was closed or already followed the run; fails_when=the selection is refused for the focused chat tab, the live panes lose their groups to the group objects Cursor replaces, or the focus stays in the main editor after the layout was measured; why_new=Cycle 0045 cause 7 with NF-19 (the baseline round's Cursor run: the select was refused and the run showed no stopped source); seam=workspace harness with the controlled runtime, a separate editor part and the fake editor's group object replacement
  test(`a presentation ${reader === 'open' ? 'restore' : 'select'} during a paused live run, made while the agent chat's tab has the focus in Cursor, confirms the live panes and gives the chat the focus back, with the reader ${reader}`, async () => {
    // Arrange: Cursor replaces every tab group object with each tab change; the agent's chat is a tab of its own editor part and has the keyboard focus while its run is paused.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    try {
      await pauseLiveRun(harness)
      if (reader === 'open') await harness.reader.open()
      chat.focusTab()
      const state = harness.reader.presentationState()
      // Act
      const selected = await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        // A select of the live layout that is confirmed already is answered without arranging (Cycle 0045 cause 12 (e)); on the open reader the arrangement is asked for with a restore.
        action: reader === 'open' ? 'restore' : 'select',
      })
      // Assert
      const chatGroup = harness.groups.find((group) =>
        group.tabs.includes(chat.tab),
      )
      assert.equal(state.state, reader)
      assert.equal(selected.state, 'open')
      assert.equal(selected.layoutConfirmed, true)
      assert.equal(selected.reason, undefined)
      assert.equal(selected.panes.appColumn, 1)
      assert.equal(selected.panes.sourceColumn, 2)
      assert.equal(readerSeams(harness).isLiveArrangement(), true)
      assert.equal(chatGroup?.viewColumn, 4)
      assert.equal(chatGroup?.activeTab, chat.tab)
      // The chat has the keyboard again through Cursor's own command; the focus command of the chat's column, which would open a new empty group in the main editor, was not run.
      assert.equal(keyboardCommands(harness).at(-1), 'composer.focusComposer')
      assert.equal(harness.groups.length, 4)
      assert.equal(chat.focused(), true)
    } finally {
      await harness.close()
    }
  })

// Value: protects=an agent's cold Study selection during a paused live run made while Cursor's chat tab has the keyboard (the five-stop flow's cold order): the selection's first measurement borrows the main editor, after which Cursor reports the first group's file as the active text editor while it still names the chat's group, and the selection confirms the live panes and gives the chat its keyboard back; fails_when=the Application preparation captures that borrowed file as the learner's focus with the chat's group as its group, and its return refuses the selection with "The previously focused source group changed; focus was not guessed." (C57 c57-5-cu-cold and c57-5-cu-4-cold, twice in two attempts); why_new=Cycle 0046 row 643 (the addendum's case without a reload); seam=workspace harness with the controlled runtime, addSeparateEditorPart and its focusTab, leavePaneFocusUnreportedBesideChat (Cursor's stale group name, finding 588), the service's selectPresentation (codebook_presentation) and the command log
test('an agent’s cold Study selection during a paused live run made while Cursor’s chat tab has the keyboard confirms the live panes and gives the chat its keyboard back', async () => {
  // Arrange: Cursor with login-form.tsx in front of the first group, auth.ts in the second, and the Agent chat as a tab of its own editor part; a run paused, the Study is closed, and the chat input has the keyboard while the editor names the chat's group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusMutableDraft('auth.ts', 2)
    harness.focusMutableDraft('login-form.tsx', 1)
    await pauseLiveRun(harness)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    const commandsBefore = harness.commands.length

    // Act
    let refusal: unknown
    const answer = await harness.service
      .selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .catch((error: unknown) => {
        refusal = error
        return undefined
      })

    // Assert: the live panes are confirmed, and Cursor's own command gave the chat input its keyboard back last.
    assert.deepEqual(
      {
        refusal: (refusal as { causeDetail?: unknown } | undefined)
          ?.causeDetail,
        layoutConfirmed: answer?.layoutConfirmed,
        reason: answer?.reason,
        appColumn: answer?.panes.appColumn,
        sourceColumn: answer?.panes.sourceColumn,
        lastKeyboardCommand: harness.commands
          .slice(commandsBefore)
          .filter(isKeyboardCommand)
          .at(-1),
        chatHasKeyboard: chat.focused(),
      },
      {
        refusal: undefined,
        layoutConfirmed: true,
        reason: undefined,
        appColumn: 1,
        sourceColumn: 2,
        lastKeyboardCommand: 'composer.focusComposer',
        chatHasKeyboard: true,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's file during an agent's cold Study selection made from Cursor's chat (the five-stop flow's cold order): beside the chat part a layout read answers for the active part only (Cursor 3.23.12 workbench.desktop.main.js 17501:90249), so the first measurement borrows the main editor with the first group's focus, and Cursor then reports that group's file as the active text editor, which proves the main editor the active part (17264:2840, 17264:3411: no text editor is active while the chat part is); the later measurements read the main editor without a second borrow, so Codebook never shows the learner's file with the keyboard on purpose, and the chat gets its keyboard back with the arrangement's sentence told once; fails_when=a later measurement borrows the first group again and gives the borrowed file the keyboard back with showTextDocument(preserveFocus: false), the +423 ms give-back of C57 and C58's c58-5-cu-cold; why_new=Cycle 0046 row 655; seam=workspace harness with the controlled runtime, addSeparateEditorPart and its focusTab, leavePaneFocusUnreportedBesideChat (Cursor's stale group name), the service's selectPresentation (codebook_presentation), textDocumentShows, the command log and the information messages
test('an agent’s cold Study selection made while Cursor’s chat tab has the keyboard shows no learner file with the keyboard, borrows the first group for one measurement only and says once that the chat got the keyboard back', async () => {
  // Arrange: Cursor with login-form.tsx in front of the first group, auth.ts in the second, and the Agent chat as a tab of its own editor part; a run paused, the Study is closed, and the chat input has the keyboard while the editor names the chat's group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusMutableDraft('auth.ts', 2)
    harness.focusMutableDraft('login-form.tsx', 1)
    await pauseLiveRun(harness)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    const commandsBefore = harness.commands.length,
      showsBefore = harness.textDocumentShows().length

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the live panes are confirmed; no learner file was shown with the keyboard, the first group was focused for one measurement and once more for the Application's new group above it, Cursor's own command gave the chat its keyboard back, and the sentence was told once.
    assert.deepEqual(
      {
        layoutConfirmed: answer.layoutConfirmed,
        learnerFilesShownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter(
            (shown) =>
              !shown.preserveFocus && !shown.name.startsWith('Captured-'),
          ),
        focusAndPlacementCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            [
              'workbench.action.focusFirstEditorGroup',
              'workbench.action.newGroupAbove',
              'composer.focusComposer',
            ].includes(command),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        layoutConfirmed: true,
        learnerFilesShownWithKeyboard: [],
        focusAndPlacementCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.newGroupAbove',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook placed its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer place when, during an agent's cold Study selection made from Cursor's chat tab, the learner clicks into login-form.tsx, the first group's file the measurement's borrow focused, while the editor inserts the Application's group above it (the click moves no caret): the selection is confirmed, the keyboard stays in that file, the chat gets nothing back and nothing is told; fails_when=the chat return (the function retainForeignTabFocus answers) asks only where the measurement left the keyboard and not whether the learner clicked or typed there since, so performPresentation's last step runs Focus Agent and tells the arrangement's sentence; why_new=Cycle 0046 row 741 (performPresentation is one of the entries that share the return); seam=workspace harness with the controlled runtime, addSeparateEditorPart and its focusTab, leavePaneFocusUnreportedBesideChat, holdNextCommand on workbench.action.newGroupAbove, workInActiveTextEditor('mouse'), the service's selectPresentation, the command log and the information messages
test('in Cursor beside its chat part, an agent’s cold Study selection from the chat tab after the learner’s click into the first group’s file after its borrow is confirmed, keeps the keyboard there, gives the chat nothing and tells nothing', async () => {
  // Arrange: as in row 655's test; while the editor inserts the Application's group above the first group after the measurement's borrow, the learner clicks into login-form.tsx there.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusMutableDraft('auth.ts', 2)
    harness.focusMutableDraft('login-form.tsx', 1)
    await pauseLiveRun(harness)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const insertion = harness.holdNextCommand('workbench.action.newGroupAbove')
    void insertion.started.then(() => {
      harness.workInActiveTextEditor('mouse')
      insertion.release()
    })

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: confirmed; only the measurement's focus commands ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(
      {
        layoutConfirmed: answer.layoutConfirmed,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        layoutConfirmed: true,
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusFirstEditorGroup',
        ],
        chatHasKeyboard: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

for (const host of ['Cursor', 'VS Code'] as const)
  // Value: protects=an agent's cold Study selection after Developer: Reload Window whose learner had the keyboard in a file of the group behind the earlier window's empty locked Application group: the selection retires that proven leftover, the learner's group moves one column to the left, and the selection still finds that group by its identity, so it confirms the Study layout; fails_when=the leftover's close is no issued removal, Cursor gives every group a new object with the new tab model (Cursor 3.23.12 workbench.desktop.main.js 17269:26248), the moved group gets a new identity, and the selection's focus return refuses with "The previously focused source group changed; focus was not guessed." (C57 c57-cursor-1a, 1b and 1b-probe; VS Code keeps its group objects); why_new=Cycle 0046 row 643; seam=applicationGroupMarkers (a record that proves the leftover), leaveEmptyLockedGroup, addSeparateEditorPart, replaceGroupObjectsOnTabChanges (Cursor's group objects), focusMutableDraft, the service's selectPresentation and harness.groups
  test(`in ${host}, an agent’s cold Study selection after a reload whose learner had the keyboard in the group behind the earlier window’s leftover retires the leftover and confirms the Study layout`, async () => {
    // Arrange: the earlier window recorded its Application group at column 1 of three rows; after the reload that group stands empty and locked, login-form.tsx is in the second row and the learner works in auth.ts in the third. In Cursor the Agent chat's part stands beside the main editor, and every tab change gives each group a new object.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}, {}] })
    if (host === 'Cursor') {
      harness.addSeparateEditorPart()
      harness.replaceGroupObjectsOnTabChanges()
    }
    try {
      harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
        version: 1,
        writer: 'the window before the reload',
        column: 1,
        groupCount: 3,
        layout: {
          orientation: 1,
          groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
        },
      })
      harness.leaveEmptyLockedGroup(1)
      const leftover = harness.groups.find((group) => group.viewColumn === 1)!
      const loginForm = harness.focusMutableDraft('login-form.tsx', 2)
      const auth = harness.focusMutableDraft('auth.ts', 3)
      const selection = harness.reader.presentationState()

      // Act
      let refusal: unknown
      const answer = await harness.service
        .selectPresentation({
          instanceId: harness.service.instanceId,
          presentationId: selection.presentationId,
          expectedRevision: selection.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        })
        .catch((error: unknown) => {
          refusal = error
          return undefined
        })

      // Assert: confirmed; the leftover is gone and both learner files keep their groups, now one column to the left.
      /** Names the column of the group that holds a tab. */
      const columnOf = (tab: unknown): number | undefined =>
        harness.groups.find((group) => group.tabs.some((held) => held === tab))
          ?.viewColumn
      assert.deepEqual(
        {
          refusal: (refusal as { causeDetail?: unknown } | undefined)
            ?.causeDetail,
          layoutConfirmed: answer?.layoutConfirmed,
          reason: answer?.reason,
          leftoverStands: harness.groups.some(
            (group) =>
              group.viewColumn === leftover.viewColumn &&
              group.tabs.length === 0 &&
              group.locked,
          ),
          loginFormColumn: columnOf(loginForm.tab),
          authColumn: columnOf(auth.tab),
        },
        {
          refusal: undefined,
          layoutConfirmed: true,
          reason: undefined,
          leftoverStands: false,
          loginFormColumn: 1,
          authColumn: 2,
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner's knowledge of where the keyboard is after an agent's Study selection (codebook_presentation) beside Cursor's Agent chat part while a learner's file of the main editor was the active text editor without a fresh sign: Cursor keeps the main editor the active part after a click from that file into the terminal or a view (Cursor 3.23.12 workbench.desktop.main.js 17501:84373, 17501:88693), so the file reads the same as in VS Code's only editor part and row 613's rule holds: the captured source keeps the keyboard the placement gave it, no unproven file gets it back, and the learner is told once; fails_when=beside another editor part the selection makes its ordinary return, which gives the file in the captured source's group nothing visible to hold, so the source covers that file and keeps the keyboard with nothing told; why_new=Cycle 0046 row 656 (the Study selection's half of the same rule); seam=useNativeLayout, addSeparateEditorPart (Cursor's chat part, not focused), focusMutableDraft, the service's selectPresentation, the editor's active text editor, textDocumentShows and the information messages
test('in Cursor beside its chat part, an agent’s Study selection made while a learner’s file is the active text editor gives that file nothing back and says once that the captured source has the keyboard', async () => {
  // Arrange: Cursor's Agent chat stands in its own editor part without the keyboard; login-form.tsx is in front of the first group and actions.ts, the active text editor, in front of the second, put there without a key press.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.addSeparateEditorPart()
  try {
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.focusMutableDraft('actions.ts', 2)
    const selection = harness.reader.presentationState()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the Study layout is confirmed; actions.ts, the active text editor in front of the second group, proves the main editor the active part, so no measurement borrowed the first group or showed actions.ts again with the keyboard (Cycle 0046 row 663: twice before), the captured source took the keyboard at its placement and no file got it after that, the source is the active text editor, and the sentence says so once.
    assert.deepEqual(
      {
        layoutConfirmed: answer.layoutConfirmed,
        showsWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus)
          .map((shown) => `${shown.name}@${shown.viewColumn}`),
        focusFirstGroupCommands: harness.commands.filter(
          (command) => command === 'workbench.action.focusFirstEditorGroup',
        ).length,
        activeTextEditor: harness.editor.window.activeTextEditor?.document.uri
          .toString()
          .split('/')
          .at(-1),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        layoutConfirmed: true,
        showsWithKeyboard: ['Captured-overview.mts@2'],
        focusFirstGroupCommands: 0,
        activeTextEditor: 'Captured-overview.mts',
        messages: [
          'Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now: placing the panes needed the focus of the source, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's cold Study selection beside Cursor's Agent chat part made while the learner types in a file of the second group and Cursor still names its chat part's group (C61 c61-cu-692: a genuine click into auth.ts renamed no group; rows 702 and 712): the selection completes, its focus capture takes the group of the text editor that has the keyboard rather than the chat part's group Cursor names, and the keyboard ends on no page body; fails_when=the capture takes the named chat part's group for auth.ts's, so the focus return finds no auth.ts there and the selection is refused with "The previously focused source group changed; focus was not guessed." after its borrow and insertion, the keyboard left on the page body (C61); why_new=Cycle 0046 row 712; seam=useNativeLayout, addSeparateEditorPart and its focusTab (the chat tab named), leavePaneFocusUnreportedBesideChat, keepChatPartNameAtLearnersFileClick, focusMutableDraft and its focus (the learner's click), workInActiveTextEditor (the click's sign), the service's selectPresentation, keyboardOnBody, the editor's active text editor and the information messages
test('in Cursor beside its chat part, an agent’s cold Study selection made while the learner types in a file of the second group under the chat part’s group name completes and leaves the keyboard on no page body', async () => {
  // Arrange: login-form.tsx is in front of the first group and auth.ts in front of the second; the learner clicked the chat tab, then into auth.ts, and Cursor still names its chat part's group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusMutableDraft('login-form.tsx', 1)
    const auth = harness.focusMutableDraft('auth.ts', 2)
    chat.focusTab()
    harness.keepChatPartNameAtLearnersFileClick()
    auth.focus()
    harness.workInActiveTextEditor('mouse')
    const before = {
      named: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
      activeTextEditor: harness.editor.window.activeTextEditor?.document.uri
        .toString()
        .split('/')
        .at(-1),
    }
    const selection = harness.reader.presentationState()

    // Act
    const answer = await harness.service
      .selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        (value) => ({ layoutConfirmed: value.layoutConfirmed }),
        (error: unknown) => ({ refusal: String(error) }),
      )

    // Assert: the selection is confirmed; the captured source placed in front of the second group over auth.ts has the keyboard, and the learner was told once that a Codebook pane came over the file.
    assert.deepEqual(
      {
        before,
        answer,
        keyboardOnBody: harness.keyboardOnBody(),
        chatHasKeyboard: chat.focused(),
        activeTextEditor: harness.editor.window.activeTextEditor?.document.uri
          .toString()
          .split('/')
          .at(-1),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        before: { named: 3, activeTextEditor: 'auth.ts' },
        answer: { layoutConfirmed: true },
        keyboardOnBody: false,
        chatHasKeyboard: false,
        activeTextEditor: 'Captured-overview.mts',
        messages: [
          'A Codebook pane (the Application pane or the captured source) came to the front over the file you were working in and has the keyboard now: a hidden file cannot keep it. Click where you want to type.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=row 712's native order (C61 c61-cu-692, five_stop.py's file-select mode): a run paused and the Study closed beside Cursor's Agent chat part, the learner clicked into auth.ts in front of the second group while Cursor still names its chat part's group, then the agent's cold Study selection measures with the first group's focus (the borrow), inserts the Application's group above it, completes, and gives auth.ts its keyboard back in its group; fails_when=the selection's focus capture takes the chat part's group Cursor names for auth.ts's, so after the borrow, the insertion and the lock it is refused with "The presentation was not confirmed. …" and the keyboard stays on the page body, as on C61 (getEditorLayout, focusFirstEditorGroup, newGroupAbove, lockEditorGroup, getEditorLayout, the cleanup, then BODY to the end); why_new=Cycle 0046 row 712 (the native order of its round); seam=useNativeLayout, addSeparateEditorPart and its focusTab, leavePaneFocusUnreportedBesideChat, keepChatPartNameAtLearnersFileClick, focusMutableDraft and its focus, workInActiveTextEditor, pauseLiveRun, the service's selectPresentation, the command log, textDocumentShows, keyboardOnBody, the editor's active text editor and the information messages
test('in Cursor beside its chat part, an agent’s cold Study selection during a paused run, made while the learner types in a file of the second group under the chat part’s group name, inserts the Application’s group and gives that file its keyboard back', async () => {
  // Arrange: login-form.tsx is in front of the first group and auth.ts in front of the second; a run paused; the learner clicked the chat tab, then into auth.ts, and Cursor still names its chat part's group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusMutableDraft('login-form.tsx', 1)
    const auth = harness.focusMutableDraft('auth.ts', 2)
    await pauseLiveRun(harness)
    chat.focusTab()
    harness.keepChatPartNameAtLearnersFileClick()
    auth.focus()
    harness.workInActiveTextEditor('mouse')
    const selection = harness.reader.presentationState()
    const commandsBefore = harness.commands.length,
      showsBefore = harness.textDocumentShows().length

    // Act
    const answer = await harness.service
      .selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        (value) => ({ layoutConfirmed: value.layoutConfirmed }),
        (error: unknown) => ({ refusal: String(error) }),
      )

    // Assert: the borrow and the insertion ran, the selection is confirmed, and auth.ts, shown again with the keyboard in its group (now the third column), has the keyboard; nothing needed telling.
    assert.deepEqual(
      {
        answer,
        focusAndPlacementCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            [
              'workbench.action.focusFirstEditorGroup',
              'workbench.action.newGroupAbove',
              'composer.focusComposer',
            ].includes(command),
          ),
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus)
          .map((shown) => `${shown.name}@${shown.viewColumn}`),
        keyboardOnBody: harness.keyboardOnBody(),
        activeTextEditor: harness.editor.window.activeTextEditor?.document.uri
          .toString()
          .split('/')
          .at(-1),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        answer: { layoutConfirmed: true },
        focusAndPlacementCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.newGroupAbove',
        ],
        shownWithKeyboard: ['auth.ts@3'],
        keyboardOnBody: false,
        activeTextEditor: 'auth.ts',
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

/**
 * Opens the workspace harness as Cursor beside its Agent chat part with a run paused and the Study closed: login-form.tsx is in front of the first group and auth.ts in front of the second, and the next lock of an editor group fails, so an agent's cold Study selection is refused right after its measurement borrowed the first group and the Application's group was inserted, the point at which C61 refused (c61-cu-692, Cycle 0046 rows 712 and 718).
 * @returns The harness, its chat part and auth.ts's draft.
 * @example const { harness, chat, auth } = await cursorSelectionRefusedAfterInsertion()
 */
async function cursorSelectionRefusedAfterInsertion() {
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.focusMutableDraft('login-form.tsx', 1)
  const auth = harness.focusMutableDraft('auth.ts', 2)
  await pauseLiveRun(harness)
  harness.failNextCommand('workbench.action.lockEditorGroup')
  return { harness, chat, auth }
}

/**
 * Makes the agent's cold Study selection (codebook_presentation select) and reads where the keyboard went, for row 718's tests of a refusal after the borrow and the insertion.
 * @param harness - The harness {@link cursorSelectionRefusedAfterInsertion} opened.
 * @param chat - Its chat part.
 * @returns The refusal's message and its cause (the `causeDetail` of the StudyError the service answered with, which names what refused it), the commands that move the keyboard, the documents shown with the keyboard, the keyboard's place and the sentences told.
 * @example const outcome = await refusedSelectionOutcome(harness, chat) // outcome.cause === 'Error: Native layout command failed' after a failed lock
 */
async function refusedSelectionOutcome(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  chat: ReturnType<
    Awaited<ReturnType<typeof workspaceHarness>>['addSeparateEditorPart']
  >,
) {
  const selection = harness.reader.presentationState()
  const commandsBefore = harness.commands.length,
    showsBefore = harness.textDocumentShows().length,
    messagesBefore = harness.informationMessages.length
  const error = await harness.service
    .selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    .then(
      () => undefined,
      (refused: unknown) => refused,
    )
  return {
    refusal: error === undefined ? undefined : String(error),
    // The service answers every refusal with the same sentence; its cause names what refused the selection (row 734).
    cause: error instanceof StudyError ? error.causeDetail : undefined,
    keyboardCommands: harness.commands
      .slice(commandsBefore)
      .filter((command) =>
        [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.newGroupAbove',
          'composer.focusComposer',
        ].includes(command),
      ),
    shownWithKeyboard: harness
      .textDocumentShows()
      .slice(showsBefore)
      .filter((shown) => !shown.preserveFocus)
      .map((shown) => `${shown.name}@${shown.viewColumn}`),
    keyboardOnBody: harness.keyboardOnBody(),
    chatHasKeyboard: chat.focused(),
    activeTextEditor: harness.editor.window.activeTextEditor?.document.uri
      .toString()
      .split('/')
      .at(-1),
    groups: harness.groups.length,
    messages: harness.informationMessages
      .slice(messagesBefore)
      .map((message) => message.message),
  }
}

// Value: protects=the learner's keyboard when an agent's cold Study selection beside Cursor's chat part is refused after its measurement borrowed the first group and the Application's group was inserted, while the learner typed in auth.ts a moment before: the refusal gives auth.ts back the keyboard the borrow took, in its group, instead of leaving it on the page body; fails_when=the refused selection gives nothing back, so the borrow's keyboard, which the inserted group's element took and its cleanup dropped, stays on the page body (C61 c61-cu-692: BODY from +464 ms to the end, after the cleanup no focus command and no showTextDocument); why_new=Cycle 0046 row 718 (the fork of row 712's report); seam=cursorSelectionRefusedAfterInsertion (failNextCommand on workbench.action.lockEditorGroup forces the refusal after the insertion, since row 712's fix removed C61's cause), keepChatPartNameAtLearnersFileClick, workInActiveTextEditor (the learner's fresh click), the service's selectPresentation, the command log, textDocumentShows, keyboardOnBody and the information messages
test('in Cursor beside its chat part, an agent’s cold Study selection refused after its borrow and the Application group’s insertion gives the file the learner typed in its keyboard back', async () => {
  // Arrange: the learner clicked the chat tab, then into auth.ts, while Cursor still names its chat part's group.
  const { harness, chat, auth } = await cursorSelectionRefusedAfterInsertion()
  try {
    chat.focusTab()
    harness.keepChatPartNameAtLearnersFileClick()
    auth.focus()
    harness.workInActiveTextEditor('mouse')

    // Act
    const outcome = await refusedSelectionOutcome(harness, chat)

    // Assert: refused after the borrow and the insertion, whose group the cleanup removed; auth.ts was shown with the keyboard in its group again and has it; nothing needed telling.
    assert.deepEqual(outcome, {
      refusal:
        'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
      cause: 'Error: Native layout command failed',
      keyboardCommands: [
        'workbench.action.focusFirstEditorGroup',
        'workbench.action.newGroupAbove',
      ],
      shownWithKeyboard: ['auth.ts@2'],
      keyboardOnBody: false,
      chatHasKeyboard: false,
      activeTextEditor: 'auth.ts',
      groups: 3,
      messages: [],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard and the truth of what the learner is told when an agent's cold Study selection made from Cursor's chat tab is refused after its measurement's borrow and the Application group's insertion: the chat gets its keyboard back with Focus Agent, and the sentence says that Codebook could not finish arranging its panes; fails_when=the refusal tells the arrangement's sentence, "Codebook placed its panes and gave the keyboard back to the chat. …", although nothing was placed, or leaves the chat without its keyboard; why_new=Cycle 0046 row 718 (its chat half, under CHAT_KEYBOARD_RETURNED_MESSAGES' rule); seam=cursorSelectionRefusedAfterInsertion, the chat's focusTab, the service's selectPresentation, the command log and the information messages
test('in Cursor beside its chat part, an agent’s cold Study selection from the chat tab refused after its borrow and the Application group’s insertion gives the chat its keyboard back and says that nothing was arranged', async () => {
  // Arrange: the chat tab has the keyboard.
  const { harness, chat } = await cursorSelectionRefusedAfterInsertion()
  try {
    chat.focusTab()

    // Act
    const outcome = await refusedSelectionOutcome(harness, chat)

    // Assert: the measurement's borrow, the preparation's focus and the insertion ran; Focus Agent gave the chat its keyboard back, and the sentence says that the arrangement was not finished.
    assert.deepEqual(outcome, {
      refusal:
        'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
      cause: 'Error: Native layout command failed',
      keyboardCommands: [
        'workbench.action.focusFirstEditorGroup',
        'workbench.action.focusFirstEditorGroup',
        'workbench.action.newGroupAbove',
        'composer.focusComposer',
      ],
      shownWithKeyboard: [],
      keyboardOnBody: false,
      chatHasKeyboard: true,
      activeTextEditor: undefined,
      groups: 3,
      messages: [
        'Codebook could not finish arranging its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
      ],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when an agent's cold Study selection beside Cursor's chat part is refused after its borrow and the Application group's insertion while the editor reported a learner's file without a fresh sign of the learner's hand (the keyboard may have been in that file, the terminal or a view): the file the editor reported gets the keyboard back instead of the page body, and the sentence says so without claiming that the learner typed there (rows 613 and 656); fails_when=the refusal leaves the keyboard on the page body with nothing told; why_new=Cycle 0046 row 718 (its unknown half); seam=cursorSelectionRefusedAfterInsertion, the chat's focusTab, keepChatPartNameAtLearnersFileClick and auth.ts's focus (a click on its tab with no selection, so no sign), the service's selectPresentation, the command log, textDocumentShows, keyboardOnBody and the information messages
test('in Cursor beside its chat part, an agent’s cold Study selection refused after its borrow and the Application group’s insertion gives the file the editor reported its keyboard back and says so once, when the learner was not known to type there', async () => {
  // Arrange: the learner clicked the chat tab, then auth.ts's tab, which gives no sign of typing there.
  const { harness, chat, auth } = await cursorSelectionRefusedAfterInsertion()
  try {
    chat.focusTab()
    harness.keepChatPartNameAtLearnersFileClick()
    auth.focus()

    // Act
    const outcome = await refusedSelectionOutcome(harness, chat)

    // Assert: auth.ts was shown with the keyboard in its group again and has it, and the learner was told once.
    assert.deepEqual(outcome, {
      refusal:
        'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
      cause: 'Error: Native layout command failed',
      keyboardCommands: [
        'workbench.action.focusFirstEditorGroup',
        'workbench.action.newGroupAbove',
      ],
      shownWithKeyboard: ['auth.ts@2'],
      keyboardOnBody: false,
      chatHasKeyboard: false,
      activeTextEditor: 'auth.ts',
      groups: 3,
      messages: [
        'Codebook could not finish the Study arrangement an agent asked for, and the file you had open has the keyboard again. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
      ],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer choice when an agent's cold Study selection beside Cursor's chat part is refused after its borrow and the Application group's insertion: while the lock of the inserted group waited, the learner clicked README.md, a second tab of the former first group, which gives no sign of the learner's hand; the refusal leaves README.md the keyboard and shows auth.ts, where the learner had typed before, with none; fails_when=the give-back's guard asks only the window's focus, the learner's sign and that the reported text editor stands in the first group, so the focus return shows auth.ts with the keyboard over the learner's README.md; why_new=Cycle 0046 row 728 (the OCR delegate's review of 8ac142df..b5f8bf97, row 718's assertKeyboardWhereBorrowLeftIt); seam=workspaceHarness's Cursor model, addSeparateEditorPart and its focusTab, leavePaneFocusUnreportedBesideChat, keepChatPartNameAtLearnersFileClick, focusMutableDraft and README.md's focus (a click on its tab, no sign), workInActiveTextEditor, holdNextCommand and failNextCommand on workbench.action.lockEditorGroup, refusedSelectionOutcome
test('in Cursor beside its chat part, an agent’s cold Study selection refused after its borrow and the Application group’s insertion leaves the keyboard in the first group’s tab the learner chose meanwhile', async () => {
  // Arrange: README.md stands behind login-form.tsx in the first group; the learner clicked the chat tab, then typed in auth.ts. The lock of the inserted group will wait while the learner clicks README.md's tab, and then fail.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    const readme = harness.focusMutableDraft('README.md', 1)
    harness.focusMutableDraft('login-form.tsx', 1)
    const auth = harness.focusMutableDraft('auth.ts', 2)
    await pauseLiveRun(harness)
    chat.focusTab()
    harness.keepChatPartNameAtLearnersFileClick()
    auth.focus()
    harness.workInActiveTextEditor('mouse')
    const lock = harness.holdNextCommand('workbench.action.lockEditorGroup')
    harness.failNextCommand('workbench.action.lockEditorGroup')
    void lock.started.then(() => {
      readme.focus()
      lock.release()
    })

    // Act
    const outcome = await refusedSelectionOutcome(harness, chat)

    // Assert: refused after the borrow and the insertion; nothing was shown with the keyboard, README.md is the active text editor, and nothing was told.
    assert.deepEqual(outcome, {
      refusal:
        'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
      cause: 'Error: Native layout command failed',
      keyboardCommands: [
        'workbench.action.focusFirstEditorGroup',
        'workbench.action.newGroupAbove',
      ],
      shownWithKeyboard: [],
      keyboardOnBody: false,
      chatHasKeyboard: false,
      activeTextEditor: 'README.md',
      groups: 3,
      messages: [],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer input when an agent's cold Study selection beside VS Code's floating window is refused for it: the learner typed in notes.ts of the floating window, the measurement borrowed the main editor's first group, and the learner then changed login-form.tsx there before the layout read, which gave no sign of the learner's hand; the refusal names the learner's newer focus, gives nothing back to notes.ts and tells nothing; fails_when=the refusal path gives the borrowed keyboard back after a refusal for a learner's change while the first group and the active text editor still read as the borrow left them, so notes.ts is shown with the keyboard over the learner's edit and "the file you had open has the keyboard again" is told; why_new=Cycle 0046 row 728 (its second half: a refusal that names a learner's change); seam=useNativeLayout, focusMutableDraft and its replaceContent, addFloatingEditorWindow and its focus, holdNextCommand on workbench.action.focusFirstEditorGroup and on the layout read after it, the service's selectPresentation, textDocumentShows, the active text editor and the information messages
test('beside VS Code’s floating window, an agent’s cold Study selection refused for the learner’s change of the first group’s file after its borrow gives no keyboard back and tells nothing', async () => {
  // Arrange: a run is paused; login-form.tsx is in front of the main editor's only group, and the learner typed in notes.ts of the floating window. Right after the measurement's borrow, the learner will change login-form.tsx.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const loginForm = harness.focusMutableDraft('login-form.tsx', 1)
    await pauseLiveRun(harness)
    harness.addFloatingEditorWindow(['notes.ts']).focus(0)
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        loginForm.replaceContent('export const changedByLearner = true\n')
        readAfterBorrow.release()
      })
      borrow.release()
    })
    const selection = harness.reader.presentationState(),
      showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length

    // Act
    const refusal = await harness.service
      .selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        () => undefined,
        (error: unknown) =>
          error instanceof StudyError ? error.causeDetail : String(error),
      )

    // Assert: refused for the learner's change; nothing was shown with the keyboard, login-form.tsx is still the active text editor, and nothing was told.
    assert.deepEqual(
      {
        refusal,
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus)
          .map((shown) => `${shown.name}@${shown.viewColumn}`),
        activeTextEditor: harness.editor.window.activeTextEditor?.document.uri
          .toString()
          .split('/')
          .at(-1),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal:
          'Error: The primary editor content or selection changed during scope measurement; the newer learner focus was preserved.',
        shownWithKeyboard: [],
        activeTextEditor: 'login-form.tsx',
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer choice when an agent's cold Study selection made from Cursor's chat tab is refused for it: right after the measurement's borrow of the first group, during its layout read, the learner clicked README.md, a second tab of that group, and the refusal says that the learner arrangement was preserved; README.md keeps the keyboard, the chat gets none and nothing is told; fails_when=the refusal path gives the chat its keyboard back after a refusal that names the learner's change, reading README.md in front of the first group under the chat part's name as the file the borrow focused, so Focus Agent takes the keyboard from README.md and "Codebook could not finish arranging its panes …" is told; why_new=Cycle 0046 row 732 (the fixer of rows 725 to 730, found beside row 728); seam=workspaceHarness's Cursor model, addSeparateEditorPart and its focusTab, leavePaneFocusUnreportedBesideChat, focusMutableDraft and README.md's focus (a click on its tab), holdNextCommand on workbench.action.focusFirstEditorGroup and on the layout read after it, refusedSelectionOutcome and the named group
test('in Cursor beside its chat part, an agent’s cold Study selection from the chat tab refused for the learner’s tab of the first group chosen during its layout read leaves that tab the keyboard and gives the chat none', async () => {
  // Arrange: README.md stands behind login-form.tsx in the first group; a run is paused and the chat tab has the keyboard. Right after the measurement's borrow the learner will click README.md's tab.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    const readme = harness.focusMutableDraft('README.md', 1)
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.focusMutableDraft('auth.ts', 2)
    await pauseLiveRun(harness)
    chat.focusTab()
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        readme.focus()
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    const outcome = await refusedSelectionOutcome(harness, chat)

    // Assert: refused for the learner's change after the borrow; no Focus Agent ran, the chat has no keyboard, README.md is in front of the first group, and nothing was told.
    assert.deepEqual(
      {
        ...outcome,
        firstGroupFront: harness.groups.find((group) => group.viewColumn === 1)
          ?.activeTab?.label,
      },
      {
        refusal:
          'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
        cause:
          'Error: Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        shownWithKeyboard: [],
        keyboardOnBody: false,
        chatHasKeyboard: false,
        activeTextEditor: 'README.md',
        groups: 3,
        messages: [],
        firstGroupFront: 'README.md',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer input when an agent's cold Study selection made from Cursor's chat tab is refused for it while the first group still shows the file the borrow focused: right after the measurement's borrow the learner changed login-form.tsx there, and the refusal says that the newer learner focus was preserved; the chat gets no keyboard back over the learner's edit and nothing is told; fails_when=the refusal path gives the chat its keyboard back after a refusal that names the learner's change, because the first group and the active text editor still read as the borrow left them; why_new=Cycle 0046 row 732 (its first half: no chat give-back after a refusal for the learner's change); seam=workspaceHarness's Cursor model, addSeparateEditorPart and its focusTab, leavePaneFocusUnreportedBesideChat, focusMutableDraft and its replaceContent, holdNextCommand on workbench.action.focusFirstEditorGroup and on the layout read after it, refusedSelectionOutcome
test('in Cursor beside its chat part, an agent’s cold Study selection from the chat tab refused for the learner’s change of the first group’s file during its layout read gives the chat no keyboard and tells nothing', async () => {
  // Arrange: login-form.tsx is in front of the first group; a run is paused and the chat tab has the keyboard. Right after the measurement's borrow the learner will change login-form.tsx.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    const loginForm = harness.focusMutableDraft('login-form.tsx', 1)
    harness.focusMutableDraft('auth.ts', 2)
    await pauseLiveRun(harness)
    chat.focusTab()
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        loginForm.replaceContent('export const changedByLearner = true\n')
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    const outcome = await refusedSelectionOutcome(harness, chat)

    // Assert: refused for the learner's change after the borrow; no Focus Agent ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(outcome, {
      refusal:
        'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
      cause:
        'Error: The primary editor content or selection changed during scope measurement; the newer learner focus was preserved.',
      keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
      shownWithKeyboard: [],
      keyboardOnBody: false,
      chatHasKeyboard: false,
      activeTextEditor: 'login-form.tsx',
      groups: 3,
      messages: [],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer choice when an agent's cold Study selection made from Cursor's chat tab is refused for a reason of the editor's (the lock of the inserted Application group fails) after the learner clicked README.md, a second tab of the first group, while that lock waited: README.md keeps the keyboard, the chat gets none and nothing is told; fails_when=the chat return takes the first group, which the editor names with README.md in front, for the place the measurement's borrow left the keyboard in, so Focus Agent takes the keyboard from README.md and "Codebook could not finish arranging its panes …" is told; why_new=Cycle 0046 row 732 (its second half: leftByMeasurement asks the first group's front tab the borrow left); seam=workspaceHarness's Cursor model, addSeparateEditorPart and its focusTab, leavePaneFocusUnreportedBesideChat, focusMutableDraft and README.md's focus, holdNextCommand and failNextCommand on workbench.action.lockEditorGroup, refusedSelectionOutcome and the named group
test('in Cursor beside its chat part, an agent’s cold Study selection from the chat tab refused after the learner chose another tab of the first group leaves that tab the keyboard and gives the chat none', async () => {
  // Arrange: README.md stands behind login-form.tsx in the first group; a run is paused and the chat tab has the keyboard. While the lock of the inserted group waits the learner will click README.md's tab, and then the lock fails.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    const readme = harness.focusMutableDraft('README.md', 1)
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.focusMutableDraft('auth.ts', 2)
    await pauseLiveRun(harness)
    chat.focusTab()
    const lock = harness.holdNextCommand('workbench.action.lockEditorGroup')
    harness.failNextCommand('workbench.action.lockEditorGroup')
    void lock.started.then(() => {
      readme.focus()
      lock.release()
    })

    // Act
    const outcome = await refusedSelectionOutcome(harness, chat)

    // Assert: refused by the editor after both borrows and the insertion; no Focus Agent ran, the chat has no keyboard, the editor names README.md's group, and nothing was told.
    const named = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        ...outcome,
        named: `${named.viewColumn}:${named.activeTab?.label}`,
      },
      {
        refusal:
          'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
        cause: 'Error: Native layout command failed',
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.newGroupAbove',
        ],
        shownWithKeyboard: [],
        keyboardOnBody: false,
        chatHasKeyboard: false,
        activeTextEditor: 'README.md',
        groups: 3,
        messages: [],
        named: '1:README.md',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Study pane's keyboard and the truth of what the learner is told when an agent's Study selection beside VS Code's floating window is refused right after its measurement borrowed the main editor's first group, while the Study pane had the keyboard (the learner clicked its tab after typing in the floating window's file, which VS Code goes on reporting as the active text editor): the Study pane gets its keyboard back and the sentence names the Study pane; fails_when=the refusal's record counts that reported text editor as a file with the keyboard (activeTextEditorWithKeyboard reads past the panes' tabs for callers that ask the panes first), so the learner is told "the file you had open has the keyboard again" while the Study pane has it, or the refusal leaves the keyboard on the Application pane the borrow focused; why_new=Cycle 0046 row 726 (CodeRabbit on 8ac142df..b5f8bf97, row 718's refusal record); seam=useNativeLayout, the learner's Guided walkthrough (the saved layout an agent's selection still leaves), addFloatingEditorWindow, focusWebviewTabKeepingTextEditorReport on the Study pane's tab, holdNextCommand on workbench.action.focusFirstEditorGroup with failNextCommand on the layout read after it, the service's selectPresentation, the command log, focusedPanel, keyboardOnBody and the information messages
test('beside VS Code’s floating window, an agent’s Study selection refused right after its borrow while the Study pane had the keyboard gives the Study pane its keyboard back and names that pane, not a file', async () => {
  // Arrange: the learner reads in the Guided walkthrough, typed in notes.ts of the floating window, then clicked the Study pane's tab; VS Code still reports notes.ts. The layout read after the borrow will fail.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const initial = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: initial.presentationId,
      expectedRevision: initial.presentationControlRevision,
      mode: 'guided-walkthrough',
      action: 'select',
    })
    harness.addFloatingEditorWindow(['notes.ts']).focus(0)
    const studyPane = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.studyContext')
    assert.ok(studyPane)
    harness.focusWebviewTabKeepingTextEditorReport(studyPane.nativeTab)
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const selection = harness.reader.presentationState()

    // Act: the agent selects the Study workspace; its borrow runs, and the layout read after it fails.
    const selecting = harness.service
      .selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await borrow.started
    harness.failNextCommand('vscode.getEditorLayout')
    borrow.release()
    const refusal = await selecting

    // Assert: refused after the borrow; the Study pane has the keyboard again, and the sentence names it.
    assert.deepEqual(
      {
        refusal,
        commands: harness.commands.slice(commandsBefore),
        focusedPanel: harness.focusedPanel(),
        keyboardOnBody: harness.keyboardOnBody(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal:
          'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
        commands: [
          'vscode.getEditorLayout',
          'workbench.action.focusFirstEditorGroup',
          'vscode.getEditorLayout',
        ],
        focusedPanel: 'codebook.studyContext',
        keyboardOnBody: false,
        messages: [
          'Codebook could not finish the Study arrangement an agent asked for, and the Study pane has the keyboard now. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

/**
 * Opens the workspace harness as Cursor beside its Agent chat part with a run paused, and has an agent's cold Study selection arrange the live panes from the chat tab, which gets its keyboard back (rows 718 and 732's setup); then the chat tab has the keyboard again. The Application pane stands in front of the first group, so a later measurement borrows through the captured source in the second group (readMainEditorGrid's sourceBorrow), for rows 738 and 739.
 * @returns The harness and its chat part.
 * @example const { harness, chat } = await cursorConfirmedLiveArrangementFromChat()
 */
async function cursorConfirmedLiveArrangementFromChat() {
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.focusMutableDraft('login-form.tsx', 1)
  harness.focusMutableDraft('auth.ts', 2)
  await pauseLiveRun(harness)
  chat.focusTab()
  const selection = harness.reader.presentationState()
  const selected = await harness.service.selectPresentation({
    instanceId: harness.service.instanceId,
    presentationId: selection.presentationId,
    expectedRevision: selection.presentationControlRevision,
    mode: 'study-workspace',
    action: 'select',
  })
  assert.equal(selected.layoutConfirmed, true)
  chat.focusTab()
  return { harness, chat }
}

/**
 * Makes an agent's restore of the confirmed live arrangement (codebook_presentation restore) and reads where the keyboard went, for rows 738 and 739.
 * @param harness - The harness {@link cursorConfirmedLiveArrangementFromChat} opened.
 * @param chat - Its chat part.
 * @returns The restore's answer or refusal with its cause, the documents shown with the keyboard, the commands that move the keyboard, the chat's keyboard and the sentences told.
 * @example const outcome = await restoredLiveArrangementOutcome(harness, chat)
 */
async function restoredLiveArrangementOutcome(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  chat: ReturnType<
    Awaited<ReturnType<typeof workspaceHarness>>['addSeparateEditorPart']
  >,
) {
  const restore = harness.reader.presentationState()
  const commandsBefore = harness.commands.length,
    showsBefore = harness.textDocumentShows().length,
    messagesBefore = harness.informationMessages.length
  const answer = await harness.service
    .selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: restore.presentationId,
      expectedRevision: restore.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    .then(
      (state) => ({
        layoutConfirmed: state.layoutConfirmed,
        refusal: undefined,
      }),
      (error: unknown) => ({
        layoutConfirmed: undefined,
        refusal:
          error instanceof StudyError ? error.causeDetail : String(error),
      }),
    )
  return {
    ...answer,
    shownWithKeyboard: harness
      .textDocumentShows()
      .slice(showsBefore)
      .filter((shown) => !shown.preserveFocus)
      .map((shown) => `${shown.name}@${shown.viewColumn}`),
    keyboardCommands: harness.commands
      .slice(commandsBefore)
      .filter((command) =>
        /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
          command,
        ),
      ),
    chatHasKeyboard: chat.focused(),
    messages: harness.informationMessages
      .slice(messagesBefore)
      .map((message) => message.message),
  }
}

// Value: protects=an agent's restore of the confirmed live arrangement (codebook_presentation restore) made from Cursor's chat tab: the measurement borrows through the captured source in the second group (the Application pane stands in front of the first), Cursor reports that source as the active text editor while it goes on naming its chat part's group (rows 673 and 674), the arrangement is confirmed and the chat gets its keyboard back; fails_when=the borrow's announced target accepts only the source's own group as the named one, so the Study pane's focus watch (trackFocusedStudyPane) reads the measurement's own borrow as the learner's change and refuses the restore with "The learner changed native tab focus while the Study layout command was pending …", and the chat gets nothing back; why_new=Cycle 0046 row 739 (the fixer of rows 725 to 737, found beside row 736); seam=workspaceHarness's Cursor model, addSeparateEditorPart and its focusTab, leavePaneFocusUnreportedBesideChat, the agent's cold selection and restore through the service's selectPresentation, textDocumentShows, the command log and the information messages
test('in Cursor beside its chat part, an agent’s restore of the confirmed live arrangement from the chat tab borrows through the captured source, is confirmed and gives the chat its keyboard back', async () => {
  // Arrange: the agent's cold selection arranged the live panes from the chat tab, and the chat tab has the keyboard again.
  const { harness, chat } = await cursorConfirmedLiveArrangementFromChat()
  try {
    // Act
    const outcome = await restoredLiveArrangementOutcome(harness, chat)

    // Assert: the measurement showed the captured source with the keyboard, the restore is confirmed, and Focus Agent gave the chat its keyboard back; the arrangement's sentence was told at the selection already.
    assert.deepEqual(outcome, {
      layoutConfirmed: true,
      refusal: undefined,
      shownWithKeyboard: ['Captured-theme.ts@2'],
      keyboardCommands: ['composer.focusComposer'],
      chatHasKeyboard: true,
      messages: [],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the truth of what the learner is told when an agent's restore of the live arrangement made from Cursor's chat tab is refused right after its measurement borrowed through the captured source: the chat gets its keyboard back with Focus Agent, and the sentence says that Codebook could not finish arranging its panes; fails_when=the arrangement's failure path (returnForeignFocusAfterFailure) gives the chat its keyboard back with no cause, so the return's own rule picks the arrangement's sentence, "Codebook placed its panes …", which this session told already, and nothing true is told; why_new=Cycle 0046 row 738 (next to row 736; reachable since row 739's fix); seam=cursorConfirmedLiveArrangementFromChat, changeAfterNextSourceDisplay (the borrow's show of the captured source) with failNextCommand on the layout read after it, restoredLiveArrangementOutcome
test('in Cursor beside its chat part, an agent’s restore of the live arrangement from the chat tab refused right after its borrow gives the chat its keyboard back and says that nothing was arranged', async () => {
  // Arrange: as in row 739's test; the layout read right after the measurement's show of the captured source will fail.
  const { harness, chat } = await cursorConfirmedLiveArrangementFromChat()
  try {
    harness.changeAfterNextSourceDisplay(() => {
      harness.failNextCommand('vscode.getEditorLayout')
    })

    // Act
    const outcome = await restoredLiveArrangementOutcome(harness, chat)

    // Assert: refused after the borrow; Focus Agent gave the chat its keyboard back, and the one sentence says that nothing was arranged.
    assert.deepEqual(outcome, {
      layoutConfirmed: undefined,
      refusal: 'Error: Native layout command failed',
      shownWithKeyboard: ['Captured-theme.ts@2'],
      keyboardCommands: ['composer.focusComposer'],
      chatHasKeyboard: true,
      messages: [
        'Codebook could not finish arranging its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
      ],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer choice when an agent's restore of the live arrangement made from Cursor's chat tab is refused for it: right after the measurement's borrow through the captured source the learner opened notes.ts in front of the first group, the Application's group the measurement watches, and the refusal says that the newer learner focus was preserved; the chat gets no keyboard back and nothing is told; fails_when=the arrangement's failure path gives the chat its keyboard back after a refusal that names the learner's change, because the Study pane's focus watch still reads the borrow's captured source under the chat part's name; why_new=Cycle 0046 row 738 (its learner-change half, row 732's rule); seam=cursorConfirmedLiveArrangementFromChat, changeAfterNextSourceDisplay with openFileWithoutKeyboard in the first group, restoredLiveArrangementOutcome
test('in Cursor beside its chat part, an agent’s restore of the live arrangement from the chat tab refused for the learner’s file opened in the first group after its borrow gives the chat no keyboard and tells nothing', async () => {
  // Arrange: as in row 739's test; right after the measurement's show of the captured source the learner opens notes.ts in front of the first group.
  const { harness, chat } = await cursorConfirmedLiveArrangementFromChat()
  try {
    harness.changeAfterNextSourceDisplay(() => {
      harness.openFileWithoutKeyboard('notes.ts', 1)
    })

    // Act
    const outcome = await restoredLiveArrangementOutcome(harness, chat)

    // Assert: refused for the learner's change; no Focus Agent ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(outcome, {
      layoutConfirmed: undefined,
      refusal:
        'Error: The primary editor selection changed during scope measurement; the newer learner focus was preserved.',
      shownWithKeyboard: ['Captured-theme.ts@2'],
      keyboardCommands: [],
      chatHasKeyboard: false,
      messages: [],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer choice when, during an agent's restore of the live arrangement made from Cursor's chat tab, the learner clicks into the captured source that the measurement's borrow showed with the keyboard: the click moves the caret during the layout read right after the borrow, the restore is refused with "The captured source content or selection changed during scope measurement; the newer learner focus was preserved.", the keyboard stays in the source and the chat gets nothing back, as for the first group's file (the primary branch's latch); fails_when=the borrow through the captured source latches neither the source's selections nor its document version, so the restore is confirmed and Focus Agent takes the keyboard from the place the learner chose; why_new=Cycle 0046 row 740 (found beside rows 738 and 739); seam=cursorConfirmedLiveArrangementFromChat, changeAfterNextSourceDisplay with holdNextCommand on the layout read after the borrow, changeFocusedSourceSelection with workInActiveTextEditor, restoredLiveArrangementOutcome
test('in Cursor beside its chat part, an agent’s restore of the live arrangement from the chat tab refused for the learner’s click in the captured source during its layout read keeps the keyboard there, gives the chat nothing and tells nothing', async () => {
  // Arrange: as in row 739's test; during the layout read right after the measurement's show of the captured source the learner clicks into that source on line 12.
  const { harness, chat } = await cursorConfirmedLiveArrangementFromChat()
  try {
    harness.changeAfterNextSourceDisplay(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        harness.changeFocusedSourceSelection(12)
        harness.workInActiveTextEditor('mouse')
        readAfterBorrow.release()
      })
    })

    // Act
    const outcome = await restoredLiveArrangementOutcome(harness, chat)

    // Assert: refused for the learner's click; no Focus Agent ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(outcome, {
      layoutConfirmed: undefined,
      refusal:
        'Error: The captured source content or selection changed during scope measurement; the newer learner focus was preserved.',
      shownWithKeyboard: ['Captured-theme.ts@2'],
      keyboardCommands: [],
      chatHasKeyboard: false,
      messages: [],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer place when an agent's restore of the live arrangement made from Cursor's chat tab fails after its layout read: the learner clicked into the captured source that the measurement's borrow left with the keyboard while the editor held the layout's commands, and those commands then failed; the keyboard stays in the source, the chat gets nothing back and nothing is told; fails_when=the chat return (the function retainForeignTabFocus answers) asks only where the arrangement or its measurement left the keyboard and not whether the learner clicked or typed there since, so the arrangement's failure path (returnForeignFocusAfterFailure) runs Focus Agent and tells that nothing was arranged; why_new=Cycle 0046 row 741 (CodeRabbit and the OCR delegate on row 740's delta); seam=cursorConfirmedLiveArrangementFromChat, holdNextCommand on the layout's runCommands with failNextCommand on that runCommands, workInActiveTextEditor('mouse'), restoredLiveArrangementOutcome
test('in Cursor beside its chat part, an agent’s restore of the live arrangement from the chat tab that fails after the learner clicked into the captured source after its layout read keeps the keyboard there, gives the chat nothing and tells nothing', async () => {
  // Arrange: as in row 739's test; after the layout read that follows the borrow, while the editor holds the layout's commands, the learner clicks into the captured source, and those commands then fail.
  const { harness, chat } = await cursorConfirmedLiveArrangementFromChat()
  try {
    const layoutCommands = harness.holdNextCommand('runCommands')
    void layoutCommands.started.then(() => {
      harness.workInActiveTextEditor('mouse')
      harness.failNextCommand('runCommands')
      layoutCommands.release()
    })

    // Act
    const outcome = await restoredLiveArrangementOutcome(harness, chat)

    // Assert: refused for the failed layout commands; no Focus Agent ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(outcome, {
      layoutConfirmed: undefined,
      refusal: 'Error: Native layout command failed',
      shownWithKeyboard: ['Captured-theme.ts@2'],
      keyboardCommands: [],
      chatHasKeyboard: false,
      messages: [],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer place when an agent's restore of the live arrangement made from Cursor's chat tab is confirmed: the learner clicked into the captured source that the measurement's borrow left with the keyboard while the editor applied the layout, after the layout read; the restore is confirmed, the keyboard stays in the source, the chat gets nothing back and nothing is told; fails_when=the chat return (the function retainForeignTabFocus answers) asks only where the arrangement or its measurement left the keyboard and not whether the learner clicked or typed there since, so the arrangement's success path runs Focus Agent and takes the keyboard from the place the learner chose; why_new=Cycle 0046 row 741 (CodeRabbit and the OCR delegate on row 740's delta); seam=cursorConfirmedLiveArrangementFromChat, holdNextCommand on vscode.setEditorLayout, workInActiveTextEditor('mouse'), restoredLiveArrangementOutcome
test('in Cursor beside its chat part, an agent’s restore of the live arrangement from the chat tab confirmed after the learner clicked into the captured source after its layout read keeps the keyboard there, gives the chat nothing and tells nothing', async () => {
  // Arrange: as in row 739's test; while the editor applies the layout after the layout read that follows the borrow, the learner clicks into the captured source.
  const { harness, chat } = await cursorConfirmedLiveArrangementFromChat()
  try {
    const layout = harness.holdNextCommand('vscode.setEditorLayout')
    void layout.started.then(() => {
      harness.workInActiveTextEditor('mouse')
      layout.release()
    })

    // Act
    const outcome = await restoredLiveArrangementOutcome(harness, chat)

    // Assert: confirmed; no Focus Agent ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(outcome, {
      layoutConfirmed: true,
      refusal: undefined,
      shownWithKeyboard: ['Captured-theme.ts@2'],
      keyboardCommands: [],
      chatHasKeyboard: false,
      messages: [],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the Application pane's keyboard and the truth of what the learner is told when an agent's Study selection beside VS Code's floating window is refused right after its measurement borrowed the main editor's first group, while the Application pane had the keyboard (the learner clicked its tab after typing in the floating window's file, which VS Code goes on reporting as the active text editor; the pane's document took the keyboard with its frame): the Application pane gets its keyboard back and the sentence names the Application pane, whose page reports no keyboard, so an agent's selection always tells it; fails_when=the refusal's record does not ask the Application pane's active flag first and counts the reported text editor as a file with the keyboard, so "the file you had open has the keyboard again" is told while the Application pane has it; why_new=Cycle 0046 row 726's gap (root, 2026-10-17: the `application` branch had no test); seam=useNativeLayout, the learner's Living book (the saved layout that puts the Application pane in the second group), addFloatingEditorWindow, focusWebviewTabKeepingTextEditorReport on the Application pane's tab with its document taking the keyboard, holdNextCommand on workbench.action.focusFirstEditorGroup with failNextCommand on the layout read after it, the service's selectPresentation, the command log, focusedPanel, keyboardOnBody and the information messages
test('beside VS Code’s floating window, an agent’s Study selection refused right after its borrow while the Application pane had the keyboard gives the Application pane its keyboard back and names that pane, not a file', async () => {
  // Arrange: the learner reads in the Living book, whose Application pane stands in the second group; the learner typed in notes.ts of the floating window, then clicked the Application pane's tab; VS Code still reports notes.ts. The layout read after the borrow will fail.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const initial = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: initial.presentationId,
      expectedRevision: initial.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    harness.addFloatingEditorWindow(['notes.ts']).focus(0)
    const applicationPane = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.ok(applicationPane)
    harness.focusWebviewTabKeepingTextEditorReport(
      applicationPane.nativeTab,
      true,
    )
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const selection = harness.reader.presentationState()

    // Act: the agent selects the Study workspace; its borrow runs, and the layout read after it fails.
    const selecting = harness.service
      .selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await borrow.started
    harness.failNextCommand('vscode.getEditorLayout')
    borrow.release()
    const refusal = await selecting

    // Assert: refused after the borrow; the Application pane has the keyboard again, and the sentence names it.
    assert.deepEqual(
      {
        refusal,
        commands: harness.commands.slice(commandsBefore),
        focusedPanel: harness.focusedPanel(),
        keyboardOnBody: harness.keyboardOnBody(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal:
          'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
        commands: [
          'vscode.getEditorLayout',
          'workbench.action.focusFirstEditorGroup',
          'vscode.getEditorLayout',
        ],
        focusedPanel: 'codebook.scopedBrowser',
        keyboardOnBody: false,
        messages: [
          'Codebook could not finish the Study arrangement an agent asked for, and the Application pane has the keyboard now. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own change during a cold Study selection after a reload in Cursor: the leftover's issued removal lets only that one shift keep a group's identity, so a learner who closes the file the selection would give its focus back to while the layout command waits still has the selection refused instead of a guessed focus; fails_when=the issued removal stays in force after the leftover's close, or the identity follows any later move, so the selection gives a focus nobody had; why_new=Cycle 0046 row 643 (the bound of the issued shift); the selection is the learner's since row 656: an agent's selection beside Cursor's chat part gives no unproven file its focus back, so only the learner's own selection still makes that return; seam=applicationGroupMarkers, leaveEmptyLockedGroup, addSeparateEditorPart, replaceGroupObjectsOnTabChanges, holdNextCommand on vscode.setEditorLayout, closeTabByHand and the reader's changePresentation for the learner
test('in Cursor, a learner’s cold Study selection after a reload is still refused when the learner closes the file it would give its focus back to while its layout command waits', async () => {
  // Arrange: as above in Cursor; the selection's layout command will wait until the learner closed auth.ts.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}, {}] })
  harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 1,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.focusMutableDraft('login-form.tsx', 2)
    harness.focusMutableDraft('auth.ts', 3)
    const authTab = harness.groups.find(
      (group) => group.viewColumn === 3,
    )!.activeTab!
    const selection = harness.reader.presentationState()
    const layoutCommand = harness.holdNextCommand('runCommands')

    // Act
    let refusal: unknown
    const selecting = harness.reader
      .changePresentation({
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .catch((error: unknown) => {
        refusal = error
      })
    await layoutCommand.started
    harness.closeTabByHand(authTab)
    layoutCommand.release()
    await selecting

    // Assert: refused; nothing guessed a focus for the closed file.
    assert.equal(
      (refusal as { code?: unknown } | undefined)?.code,
      'PRESENTATION_UNAVAILABLE',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the agent chat's keyboard after a restore of the live panes that failed once the arrangement had moved the keyboard into the main editor: the chat has it again; fails_when=only the successful arrangement gives the focus back, so a restore the editor fails leaves the keyboard in the main editor and the agent's next key press goes there; why_new=Cycle 0045 local review coderabbit #6 (the live and replay branch returned the focus on success only, unlike a selection and an open); seam=workspace harness with the controlled runtime, a separate editor part, and failNextCommand on the arrangement's command batch
test("a restore of the live panes that the editor fails after the arrangement took the keyboard, made while the agent chat's tab has the focus in Cursor, gives the chat the keyboard back", async () => {
  // Arrange: the reader follows a paused run in Cursor and the agent's chat has the keyboard; the editor will fail the command batch of the restore's arrangement.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  try {
    await pauseLiveRun(harness)
    await harness.reader.open()
    chat.focusTab()
    const state = harness.reader.presentationState()
    harness.failNextCommand('runCommands')

    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      }),
      /Native layout command failed/,
    )

    // Assert
    assert.equal(chat.focused(), true)
    assert.equal(keyboardCommands(harness).at(-1), 'composer.focusComposer')
    assert.equal(harness.groups.length, 4)
    assert.equal(
      harness.reader.presentationState().reason,
      'Error: Native layout command failed',
    )
  } finally {
    await harness.close()
  }
})

for (const action of ['select', 'restore'] as const)
  for (const replacesGroupObjects of [false, true])
    // Value: protects=an agent's presentation select or restore being admitted in the state a real Cursor chat submission is in (the chat input holds the keyboard, and the editor names a learner's file of the main editor as the active tab without an active text editor), and the chat having the keyboard again afterwards; fails_when=every text tab without an active text editor is refused as if it were a captured source the editor kept, which only a click into an editor clears, and an agent cannot click, or the keyboard stays on the captured source after the measurement borrowed it; why_new=Cycle 0045 cause 12 (a) (second native round, N14-b2 and owed check 1, take A2: both calls refused with "has no text editor", the run showed no stopped source); seam=workspace harness with a separate editor part that holds the keyboard while the main group stays the active tab group
    test(`a ${action === 'select' ? 'selection' : 'restore'} made while the chat input has the focus and the editor names a text tab without an active text editor arranges the Study panes and closes or moves no tab, ${replacesGroupObjects ? 'also when the editor replaces every tab group object with each tab change as Cursor does' : 'in an editor that keeps its tab group objects'}`, async () => {
      // Arrange: as the editor API reported it in Cursor: group 1 is the active tab group and shows the learner's file beside a settings page, group 2 below it is empty, and the Agent chat's own editor part holds the keyboard, so no text editor is active while that file's editor is visible.
      const harness = await workspaceHarness(false)
      harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
      harness.groups.at(-1)!.tabs = []
      harness.groups.at(-1)!.activeTab = undefined
      const chat = harness.addSeparateEditorPart()
      if (replacesGroupObjects) harness.replaceGroupObjectsOnTabChanges()
      try {
        const settings = harness.addOpaqueTab('Cursor Settings', 1),
          learnerFile = harness.focusMutableDraft('actions.ts', 1)
        chat.focus()
        const state = harness.reader.presentationState(),
          activeBefore = harness.editor.window.tabGroups.activeTabGroup,
          tabsOfFirstGroupBefore = [...activeBefore.tabs]
        const stateBefore = {
          chatHasKeyboard: chat.focused(),
          chatColumn: harness.groups.find((group) =>
            group.tabs.includes(chat.tab),
          )?.viewColumn,
          activeColumn: activeBefore.viewColumn,
          activeTabIsLearnerFile: activeBefore.activeTab === learnerFile.tab,
          hasActiveTextEditor:
            harness.editor.window.activeTextEditor !== undefined,
          visibleEditors: harness.editor.window.visibleTextEditors.length,
        }
        // Act
        const arranged = await harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action,
        })
        // Assert
        const firstGroup = harness.groups.find(
          (group) => group.viewColumn === 1,
        )!
        assert.deepEqual(stateBefore, {
          chatHasKeyboard: true,
          chatColumn: 3,
          activeColumn: 1,
          activeTabIsLearnerFile: true,
          hasActiveTextEditor: false,
          visibleEditors: 1,
        })
        assert.equal(arranged.state, 'open')
        assert.equal(arranged.layoutConfirmed, true)
        assert.equal(arranged.reason, undefined)
        assert.equal(arranged.panes.appColumn, 1)
        assert.equal(arranged.panes.sourceColumn, 2)
        assert.equal(arranged.panes.contextColumn, 3)
        // No tab was closed or moved: the first group still holds its tabs in their order, before the Application pane, and the chat tab is alone in its group behind the Study groups.
        assert.deepEqual(harness.tabCloseRequests(), [])
        assert.deepEqual(
          firstGroup.tabs.slice(0, tabsOfFirstGroupBefore.length),
          tabsOfFirstGroupBefore,
        )
        assert.equal(firstGroup.tabs.includes(settings), true)
        assert.equal(learnerFile.tab.isDirty, true)
        assert.equal(
          learnerFile.document.getText(),
          'Original learner draft.\n',
        )
        assert.equal(
          harness.groups.find((group) => group.tabs.includes(chat.tab))
            ?.viewColumn,
          4,
        )
        // The measurement borrowed the keyboard for the main editor; the chat has it again through Cursor's own command. The focus command of the chat's column, which would open a new empty group in the main editor, was not run.
        assert.equal(chat.focused(), true)
        assert.equal(harness.editor.window.activeTextEditor, undefined)
        assert.deepEqual(keyboardCommands(harness), [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ])
        assert.equal(harness.groups.length, 4)
      } finally {
        await harness.close()
      }
    })

for (const reader of ['closed', 'open'] as const)
  // Value: protects=an agent's presentation select during its own paused run in the state of a real Cursor chat submission (the chat input holds the keyboard, the editor names a file in an original main group, no text editor is active) ending with the live panes confirmed and the keyboard back in the chat; fails_when=the selection is refused for the text tab without an active text editor, or the keyboard stays on that file after the measurement focused the first editor group; why_new=Cycle 0045 cause 12 (a) (N14-b2: the debugger's source shared group 1 with the Application pane and every presentation call was refused); seam=workspace harness with the controlled runtime, a separate editor part that holds the keyboard and the fake editor's group object replacement
  test(`a presentation ${reader === 'open' ? 'restore' : 'select'} during a paused live run, made while the chat input has the focus and the editor names a text tab without an active text editor, confirms the live panes and gives the chat the keyboard back, with the reader ${reader}`, async () => {
    // Arrange: the original second main group holds the named file before or after App allocation; the chat's own editor part holds the keyboard, so the editor names that file's tab and no active text editor.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    try {
      await pauseLiveRun(harness)
      if (reader === 'open') await harness.reader.open()
      const namedFile = harness.focusMutableDraft(
        'login-form.tsx',
        reader === 'open' ? 3 : 2,
      )
      chat.focus()
      const state = harness.reader.presentationState()
      const stateBefore = {
        chatHasKeyboard: chat.focused(),
        activeTabIsNamedFile:
          harness.editor.window.tabGroups.activeTabGroup.activeTab ===
          namedFile.tab,
        hasActiveTextEditor:
          harness.editor.window.activeTextEditor !== undefined,
      }
      // Act
      const selected = await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        // A select of the live layout that is confirmed already is answered without arranging (Cycle 0045 cause 12 (e)); on the open reader the arrangement is asked for with a restore.
        action: reader === 'open' ? 'restore' : 'select',
      })
      // Assert
      const chatGroup = harness.groups.find((group) =>
        group.tabs.includes(chat.tab),
      )
      assert.deepEqual(stateBefore, {
        chatHasKeyboard: true,
        activeTabIsNamedFile: true,
        hasActiveTextEditor: false,
      })
      assert.equal(state.state, reader)
      assert.equal(selected.state, 'open')
      assert.equal(selected.layoutConfirmed, true)
      assert.equal(selected.reason, undefined)
      assert.equal(selected.panes.appColumn, 1)
      assert.equal(selected.panes.sourceColumn, 2)
      assert.equal(readerSeams(harness).isLiveArrangement(), true)
      assert.equal(
        harness.groups
          .find((group) => group.viewColumn === 3)
          ?.tabs.includes(namedFile.tab),
        true,
      )
      assert.deepEqual(harness.tabCloseRequests(), [])
      assert.equal(namedFile.document.getText(), 'Original learner draft.\n')
      assert.equal(namedFile.tab.isDirty, true)
      assert.equal(chatGroup?.viewColumn, 4)
      // The chat has the keyboard again through Cursor's own command; the focus command of the chat's column, which would open a new empty group in the main editor, was not run.
      assert.equal(keyboardCommands(harness).at(-1), 'composer.focusComposer')
      assert.equal(harness.groups.length, 4)
      assert.equal(chat.focused(), true)
    } finally {
      await harness.close()
    }
  })

// Value: protects=a refused presentation selection leaving the window as it found it: no Codebook pane is opened, no tab changes, and the chat input keeps the keyboard; fails_when=the refusal is answered only after the Application pane was opened in the first group and the keyboard had moved from the chat to it, and both stay; why_new=Cycle 0045 cause 12 (b) (owed check 1, take A1: refused after 5.2 s, the Application pane open in group 1 with the keyboard); seam=workspace harness with a separate editor part whose group the editor names as active, the fake editor's group object replacement and its unreported pane focus beside the chat
test('a selection refused for a preview tab opens no pane and leaves the keyboard focus where it was', async () => {
  // Arrange: Cursor names the chat's group as the active one and its input has the keyboard; the first group shows the learner's file and holds an image the learner opened by a single click, a preview tab that Codebook cannot keep open for the learner.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    await harness.reader.attach(harness.service)
    const image = harness.addOpaqueTab('logo.png', 1)
    image.isPreview = true
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focusTab()
    const state = harness.reader.presentationState(),
      commands = [...harness.commands],
      tabsBefore = harness.groups.map((group) => [...group.tabs])
    // Act
    const refused = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    await assert.rejects(refused, {
      code: 'PRESENTATION_UNAVAILABLE',
      message:
        'A destination group contains a foreign preview: "logo.png" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
    })
    assert.equal(harness.counts().panels, 0)
    assert.deepEqual(
      harness.groups.map((group) => [...group.tabs]),
      tabsBefore,
    )
    assert.equal(image.isPreview, true)
    assert.deepEqual(harness.tabCloseRequests(), [])
    // Nothing was focused, measured or revealed: the chat's group is the active one and its input has the keyboard.
    assert.deepEqual(harness.commands, commands)
    assert.deepEqual(harness.panelReveals(), [])
    assert.equal(
      harness.editor.window.tabGroups.activeTabGroup.tabs.includes(chat.tab),
      true,
    )
    assert.equal(chat.focused(), true)
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    await harness.close()
  }
})

// Value: protects=the first presentation selection of a chat request in Cursor being arranged beside the preview tab the debugger of an earlier run left in the first group, with that tab kept open; fails_when=the main editor is measured only after the Application pane was placed in front of the first group's text editor, where Cursor reports no focus while it names the chat's group, so the wait for that report ends after five seconds and the refusal names the preview tab; why_new=Cycle 0045 cause 12 (b) (owed check 1, take A1, and item 2's first try: "A destination group contains a foreign preview: "actions.ts" in editor group 1. …" twice, the preview was not replaced either time); seam=workspace harness with a separate editor part whose group the editor names as active, addTextPreview, the fake editor's group object replacement and its unreported pane focus beside the chat
test("a selection made from the chat beside the debugger's leftover preview tab arranges the Study panes and keeps that tab open", async () => {
  // Arrange: as the editor API reported it in Cursor: the first group shows the learner's file and holds the debugger's unedited preview and a settings page, the group below is empty, and the editor names the chat's group, whose input has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    const debuggerFile = join(harness.directory, 'actions.ts')
    await writeFile(debuggerFile, 'export const authenticate = 1\n')
    const settings = harness.addOpaqueTab('Cursor Settings', 1),
      learnerFile = harness.focusMutableDraft('login-form.tsx', 1),
      debuggerPreview = harness.addTextPreview(debuggerFile, 1)
    chat.focusTab()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    const firstGroup = harness.groups.find((group) => group.viewColumn === 1)!,
      chatGroup = harness.groups.find((group) => group.tabs.includes(chat.tab))
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, 3)
    // The debugger's tab is still a tab of the first group, kept open as a double-click on its tab keeps it; nothing was closed.
    assert.equal(firstGroup.tabs.includes(debuggerPreview), true)
    assert.equal(debuggerPreview.isPreview, false)
    assert.equal(firstGroup.tabs.includes(settings), true)
    assert.equal(firstGroup.tabs.includes(learnerFile.tab), true)
    assert.deepEqual(harness.tabCloseRequests(), [])
    assert.equal(chatGroup?.viewColumn, 4)
    // The chat has the keyboard again through Cursor's own command; the focus command of the chat's column, which would open a new empty group in the main editor, was not run.
    assert.deepEqual(keyboardCommands(harness), [
      'workbench.action.focusFirstEditorGroup',
      'composer.focusComposer',
    ])
    assert.equal(harness.groups.length, 4)
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection that is refused because the main editor never reports the keyboard focus the measurement gave it leaving the window as it found it, with a text that says what the reader does next; fails_when=the Application pane the selection created stays open with the keyboard, the chat does not get the keyboard back because the editor still names its group, or the refusal reads "Timed out waiting for identifiable primary editor focus"; why_new=Cycle 0045 cause 12 (b) (owed check 1, take A1: Cursor kept naming the chat's group while the Application pane had the keyboard, and the pane stayed); seam=workspace harness with a separate editor part whose group the editor names as active, the fake editor's unreported pane focus beside the chat, and the fake clock for the five seconds of the wait
test('a selection refused because the main editor reports no keyboard focus closes the Application pane it opened and gives the chat the keyboard back', async (context) => {
  // Arrange: Cursor names the chat's group as the active one and its input has the keyboard; the first group shows a settings page, so the measurement can only focus the Application pane the selection places there, and Cursor reports no focus of that pane.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    await harness.reader.attach(harness.service)
    harness.focusOpaqueTab(harness.addOpaqueTab('Cursor Settings', 1))
    chat.focusTab()
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.map((group) => [...group.tabs]),
      layoutBefore = structuredClone(harness.editorLayout())
    // Act: the five seconds of the wait for the focus report pass on a faked clock.
    let answer: unknown
    void harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        (arranged) => {
          answer = arranged
        },
        (error: unknown) => {
          answer = error
        },
      )
    enableFakeClock(context)
    const refusedAfterMs = await advanceClockUntil(
      context,
      () => answer !== undefined,
      6_000,
    )
    resetFakeClock(context)
    // Assert
    // The faked clock moves in steps of 50 ms, and the refusal is seen one step after the bound at the latest.
    assert.equal(
      refusedAfterMs !== undefined &&
        refusedAfterMs >= 5_000 &&
        refusedAfterMs <= 5_050,
      true,
    )
    assert.equal(
      answer instanceof Error && answer.message,
      'The Codebook panes were not arranged: the main editor did not report the keyboard focus within 5 s after Codebook focused its first editor group. Click into a file in the main editor, then try again.',
    )
    assert.equal(harness.counts().panels, 0)
    assert.deepEqual(
      harness.groups.map((group) => [...group.tabs]),
      tabsBefore,
    )
    assert.equal(chat.focused(), true)
    assert.equal(harness.reader.presentationState().state, 'closed')
    // The grid is as the call found it: no editor group was opened for the focus return (Cycle 0045 cause 12 (d)).
    assert.equal(harness.groups.length, 3)
    assert.deepEqual(harness.editorLayout(), layoutBefore)
    assert.deepEqual(keyboardCommands(harness), [
      'workbench.action.focusFirstEditorGroup',
      'composer.focusComposer',
    ])
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

for (const reader of ['study-workspace', 'living-book'] as const)
  // Value: protects=the presentation resource offering an agent only layouts its next select is accepted for; fails_when=the resource lists Living book and Guided walkthrough beside Study workspace, and a select of either is refused as retired; why_new=Cycle 0045 SM-10 (`presentationState` listed all three modes while `selectPresentation` refused two of them); seam=none
  test(`the presentation resource offers only layouts a select accepts: Study workspace, and a retired layout only while the reader is in it (reader in ${reader})`, async () => {
    // Arrange: an earlier version may have saved a layout that is retired now; the reader still opens in it.
    const harness = await workspaceHarness()
    try {
      if (reader === 'living-book') {
        harness.presentationPreferences.set('codebook.presentation.v1', {
          version: 1,
          mode: 'living-book',
        })
        await harness.reader.close()
        harness.useNativeLayout({ orientation: 0, groups: [{}] })
        await harness.reader.open()
      }
      // Act
      const resource = await harness.service.presentationState(
        harness.service.instanceId,
      )
      // Assert
      assert.equal(resource.mode, reader)
      assert.deepEqual(
        resource.modes.map((offered) => offered.mode),
        reader === 'living-book'
          ? ['study-workspace', 'living-book']
          : ['study-workspace'],
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=a run started while the open reader shows a saved study ending before the application gets any input, with the step that makes the next start possible; fails_when=the run is admitted, starts the application and fails about 25 s later at its first capture with "Learner is viewing history; current capture was not displayed.", which names no step; why_new=Cycle 0045 finding OBS-1 (native observation round, and again in owed check 2: run 303345e4 ended after 25.6 s); seam=the recorded reader harness with the real service and reader
test('a run started while the reader shows a saved study is refused before any input and names the return to the current run', async () => {
  // Arrange: the open reader shows a saved study's recording, so it does not follow the current run.
  const harness = await recordedReaderHarness()
  const service = harness.service
  let refused: ReturnType<typeof service.start> | undefined,
    repeated: ReturnType<typeof service.start> | undefined
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const shown = harness.reader.presentationState(),
      runtimesBefore = harness.runtimes.length,
      library = await harness.reader.learningStorage(),
      savedStudiesBefore = await library.savedStudyCount()
    // Act
    refused = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'while-the-reader-shows-a-saved-study',
    })
    const refusedRecord = service.record(refused)
    await refusedRecord.preparation
    await waitUntil(() => refusedRecord.stopped, 'the refused run ended', 1_000)
    // Assert
    assert.equal(shown.state, 'open')
    assert.equal(shown.reader.followingCurrentRun, false)
    assert.equal(shown.reader.contentRevision, 3)
    assert.equal(refusedRecord.error?.code, 'PRESENTATION_UNAVAILABLE')
    assert.equal(
      refusedRecord.error?.message,
      "The run was not started: the reader shows saved history and does not follow the current run (reader.followingCurrentRun is false), so none of this run's captures would be displayed. Call codebook_return_current with expectedRevision 3 (reader.contentRevision), then start again with a new key.",
    )
    // No runtime was created: the application was not started and got no input.
    assert.equal(refusedRecord.runtime, undefined)
    assert.equal(harness.runtimes.length, runtimesBefore)
    // The refused run left nothing behind: no study was saved for it.
    assert.equal(refusedRecord.historyExcluded, 'refused-at-admission')
    assert.equal(await library.savedStudyCount(), savedStudiesBefore)
    assert.equal(savedStudiesBefore, 1)
    // The step the text names makes the next start possible.
    const returned = await harness.reader.returnToCurrent({
      presentationId: shown.presentationId,
      expectedRevision: shown.reader.contentRevision,
    })
    repeated = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'after-the-return-to-the-current-run',
    })
    await service.record(repeated).preparation
    assert.equal(returned.reader.followingCurrentRun, true)
    assert.equal(service.record(repeated).error, undefined)
    assert.equal(service.record(repeated).prepared, true)
    // The status help, which names followingCurrentRun, says the same.
    assert.equal(
      (await service.status()).presentation?.instructions.includes(
        'Before a new run, if reader.contentTab is not live or reader.followingCurrentRun is false, use codebook_return_current with reader.contentRevision as expectedRevision; verify both live and followingCurrentRun true so captured values and explanations are visible. A run started while an open reader has followingCurrentRun false is not started: it ends before any application input and names this step; start again with a new key after it.',
      ),
      true,
    )
  } finally {
    try {
      if (repeated) await service.stop(repeated)
    } finally {
      await harness.close()
    }
  }
})

// Value: protects=the Application pane being in front after a cold selection made from a learner's file that shares its group, with the keyboard focus that file had, and the file still open; fails_when=the selection fronts and focuses the learner's file again, so the Application pane the layout was confirmed for stays hidden behind it; why_new=Cycle 0045 NF-1 as DR-5 (presenting never leaves the Application pane behind a learner's tab; the pane takes the focus only from an editor Codebook knows held it); seam=focusMutableDraft
test("after a cold selection the Application pane is in front of the learner's own file that shares its group, holds the keyboard focus, and that file is still open", async () => {
  // Arrange: the learner types in a file of the first group, where the selection places the Application pane.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const draft = harness.focusMutableDraft('notes.txt', 1)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    const applicationGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    assert.equal(state.state, 'closed')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(
      applicationGroup.activeTab?.input instanceof
        harness.editor.TabInputWebview,
      true,
    )
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.editor.window.activeTextEditor, undefined)
    assert.equal(applicationGroup.tabs.includes(draft.tab), true)
    assert.equal(draft.tab.isDirty, true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(harness.tabCloseRequests(), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection made from Cursor's chat being arranged when the editor answers the focus command with the first group's text editor as the active text editor and still names the chat's group, and the keyboard going back to the chat without a new editor group; fails_when=the measurement waits for the first group to be named as the active tab group, which Cursor does not do, and refuses after five seconds, or the focus is given back with the focus command of the chat's column, which opens a new empty group in the main editor; why_new=Cycle 0045 cause 12 (d) (obs15 P2: refused after 5.28 s, a new empty group at column 3, the caret not in the chat); seam=workspace harness with a separate editor part whose group the editor names, the fake Cursor's stale group name, its group focus commands and its "Focus Agent" command
test("a selection made from Cursor's chat is arranged when the editor reports the first group's text editor without naming its group, and the chat gets the keyboard back without a new editor group", async () => {
  // Arrange: as the editor API reported it in Cursor: group 1 holds two files (the second one shown, its text editor visible) and a settings page, group 2 is empty, and the editor names the chat's group, whose input has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    const settings = harness.addOpaqueTab('Cursor Settings', 1),
      learnerFile = harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    const firstGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, 3)
    assert.equal(firstGroup.tabs.includes(learnerFile.tab), true)
    assert.equal(firstGroup.tabs.includes(settings), true)
    assert.deepEqual(harness.tabCloseRequests(), [])
    // Three groups of the main editor and the chat's: no group was opened for the focus return, and none is empty.
    assert.equal(harness.groups.length, 4)
    assert.equal(
      harness.groups.some((group) => group.tabs.length === 0),
      false,
    )
    assert.deepEqual(keyboardCommands(harness), [
      'workbench.action.focusFirstEditorGroup',
      'composer.focusComposer',
    ])
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the answer an agent gets for its own select from the chat reading confirmed; fails_when=the answer is read after the focus return changed the editor groups, or the read that follows the select cannot measure the grid from the chat and answers layoutConfirmed false with "Main editor layout could not be checked without changing focus. …", which the agent relays to the learner; why_new=Cycle 0045 cause 12 (d) (obs15 P1: the select arranged the three panes and answered layoutConfirmed false with that reason and no layoutMeasured member); seam=the service's selectPresentation on the workspace harness with a separate editor part that has the keyboard
test("the answer to a selection made from Cursor's chat input reads the layout as confirmed and says that the grid was not measured again", async () => {
  // Arrange: the chat input has the keyboard while the editor names the learner's file of group 1 without an active text editor.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focus()
    const state = harness.reader.presentationState()
    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(answer.state, 'open')
    assert.equal(answer.layoutConfirmed, true)
    assert.equal(answer.layoutMeasured, false)
    assert.equal(answer.reason, undefined)
    assert.equal(answer.panes.appColumn, 1)
    assert.equal(answer.panes.sourceColumn, 2)
    assert.equal(answer.panes.contextColumn, 3)
    assert.equal(harness.groups.length, 4)
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when an agent selects the Study workspace through codebook_presentation while VS Code's chat view (or Cursor's chat in the side bar) has it: the placement needs the captured source's focus, and afterwards no file the learner is not known to work in gets the keyboard; the learner is told once that the captured source has it; fails_when=the selection's focus return shows the learner's active file with the keyboard, so the chat input the request was typed in loses its keyboard to that file without a word; why_new=Cycle 0046 row 613; seam=useNativeLayout, focusMutableDraft, focusView (the chat view's input, which the editor does not report), the service's selectPresentation (the codebook_presentation tool's handler), textDocumentShows, focusedSource and the information messages
test('an agent’s Study selection made while the chat view has the keyboard gives no learner’s file the keyboard and says once that the captured source has it', async () => {
  // Arrange: the learner's notes stand in the second group and readme.md is the active editor of the third; then the learner typed the request into the chat view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length
    const state = harness.reader.presentationState()

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: no learner's file was shown with the keyboard, the captured source has it, and the sentence says so; the Study stands confirmed.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus)
        .map((shown) => shown.name),
      ['Captured-overview.mts'],
    )
    assert.equal(
      harness
        .focusedSource()
        ?.document.uri.path.endsWith('/Captured-overview.mts'),
      true,
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now: placing the panes needed the focus of the source, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
    assert.equal(answer.layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

for (const failure of [
  {
    holder: 'the Application pane',
    paneTakingKeyboard: 'app',
    focusedPanel: 'codebook.scopedBrowser',
    focusedSourceIsCaptured: false,
    sentence:
      'Codebook could not finish the Study arrangement an agent asked for, and the Application pane has the keyboard now. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
  },
  {
    holder: 'the Study pane',
    paneTakingKeyboard: 'contextPanel',
    focusedPanel: 'codebook.studyContext',
    focusedSourceIsCaptured: false,
    sentence:
      'Codebook could not finish the Study arrangement an agent asked for, and the Study pane has the keyboard now. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
  },
  {
    holder: 'the captured source',
    paneTakingKeyboard: undefined,
    focusedPanel: undefined,
    focusedSourceIsCaptured: true,
    sentence:
      'Codebook could not finish the Study arrangement an agent asked for, and the captured source has the keyboard now. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
  },
] as const)
  // Value: protects=the learner told where the keyboard is when an agent's Study selection (codebook_presentation) fails after its placement focused the captured source, while VS Code's chat view had the keyboard: no learner's file gets the keyboard (row 613's rule holds on the failure path too), and the one sentence names the place that has it now, the captured source, the Application pane or the Study pane, and says that the arrangement could not be finished; fails_when=the failure path tells the captured source's sentence ("… its captured source has the keyboard now …") without reading where the keyboard is, so a learner whose Application or Study pane took it is sent to the wrong place, or tells a successful selection's sentence ("Codebook arranged the Study workspace an agent asked for …") for an arrangement that was refused; why_new=Cycle 0046 row 634 (CodeRabbit on 2d7d660c..dc60b8f6, performPresentation's catch path and keepsKeyboardAfterAgentSelection) and row 637 (the captured source's sentence on the failure path); seam=useNativeLayout, changeEditorLayout (an unconfirmed Study layout), focusMutableDraft, focusChatInSecondarySideBar, holdNextCommand and failNextCommand on vscode.setEditorLayout, a pane's reveal with the keyboard while that command is pending, the service's selectPresentation, focusedPanel, focusedSource, textDocumentShows and the information messages
  test(`an agent’s Study selection that fails after its placement while ${failure.holder} has the keyboard gives no learner’s file the keyboard and says once that ${failure.holder} has it`, async () => {
    // Arrange: the Study workspace is open; the learner resized its panes, went back to actions.ts in the first group, and typed the request into VS Code's chat view. The editor will give ${failure.holder} the keyboard while the placement's layout command is pending, and then refuse that command.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await harness.reader.open()
      harness.focusMutableDraft('actions.ts', 1)
      harness.changeEditorLayout({
        orientation: 0,
        groups: [
          { size: 0.7, groups: [{ size: 0.3 }, { size: 0.7 }] },
          { size: 0.3 },
        ],
      })
      const unconfirmed = await harness.reader.readPresentationState()
      harness.focusChatInSecondarySideBar()
      const showsBefore = harness.textDocumentShows().length,
        messagesBefore = harness.informationMessages.length
      harness.failNextCommand('vscode.setEditorLayout')
      const layoutCommand = harness.holdNextCommand('vscode.setEditorLayout')

      // Act
      let refusal: unknown
      const selecting = harness.service
        .selectPresentation({
          instanceId: harness.service.instanceId,
          presentationId: unconfirmed.presentationId,
          expectedRevision: unconfirmed.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        })
        .catch((error: unknown) => {
          refusal = error
        })
      await layoutCommand.started
      if (failure.paneTakingKeyboard)
        harness.reader[failure.paneTakingKeyboard]!.reveal(undefined, false)
      layoutCommand.release()
      await selecting

      // Assert: the selection was refused; the only document shown with the keyboard is the captured source the placement needed, and the sentence names the place that has the keyboard now.
      assert.deepEqual(
        {
          refusal: String(refusal),
          focusedPanel: harness.focusedPanel(),
          focusedSourceIsCaptured: Boolean(
            harness
              .focusedSource()
              ?.document.uri.path.endsWith('/Captured-overview.mts'),
          ),
          shownWithKeyboard: harness
            .textDocumentShows()
            .slice(showsBefore)
            .filter((shown) => !shown.preserveFocus)
            .map((shown) => shown.name),
          messages: harness.informationMessages
            .slice(messagesBefore)
            .map((message) => message.message),
        },
        {
          refusal:
            'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
          focusedPanel: failure.focusedPanel,
          focusedSourceIsCaptured: failure.focusedSourceIsCaptured,
          shownWithKeyboard: ['Captured-overview.mts'],
          messages: [failure.sentence],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner's own Study selection that fails after its placement focused the captured source: the failure path still gives the learner's file the keyboard back, as it did before row 634 changed the agent's failure path; fails_when=the agent's rule (no unproven file gets the keyboard) or its sentence reaches the learner's own failed selection; why_new=Cycle 0046 row 634 (the learner's half); seam=useNativeLayout, changeEditorLayout, focusMutableDraft, failNextCommand on vscode.setEditorLayout, the reader's changePresentation (the learner's control), the active text editor and the information messages
test('a learner’s own Study selection that fails after its placement gives the learner’s file its keyboard back and tells nothing', async () => {
  // Arrange: the Study workspace is open; the learner resized its panes and works in actions.ts in the first group. The editor will refuse the placement's layout command.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    harness.focusMutableDraft('actions.ts', 1)
    harness.changeEditorLayout({
      orientation: 0,
      groups: [
        { size: 0.7, groups: [{ size: 0.3 }, { size: 0.7 }] },
        { size: 0.3 },
      ],
    })
    const unconfirmed = await harness.reader.readPresentationState()
    const messagesBefore = harness.informationMessages.length
    harness.failNextCommand('vscode.setEditorLayout')

    // Act
    let refusal: unknown
    await harness.reader
      .changePresentation({
        presentationId: unconfirmed.presentationId,
        expectedRevision: unconfirmed.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .catch((error: unknown) => {
        refusal = error
      })

    // Assert: refused, actions.ts has the keyboard again, and nothing is told.
    assert.deepEqual(
      {
        refusal: String(refusal),
        activeTextEditor:
          harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal:
          'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
        activeTextEditor: 'actions.ts',
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when an agent selects the Study workspace right after Developer: Reload Window, with the earlier window's empty Application group still the active group and the chat view holding the keyboard: no editor group is focused after the placement and the learner is told once that the captured source has the keyboard; fails_when=the selection's focus return focuses the active editor group it captured (the empty leftover's), taking the keyboard from the chat input without a word; why_new=Cycle 0046 row 613 (with a reload: row 608's path); seam=applicationGroupMarkers, leaveEmptyLockedGroup, focusMutableDraft, the editor's focusFirstEditorGroup (the learner's last click into the empty group), focusView (the chat view's input), the service's selectPresentation, the command log, focusedSource and the information messages
test('an agent’s Study selection right after a reload while the chat view has the keyboard focuses no editor group afterwards and says once that the captured source has it', async () => {
  // Arrange: the earlier window recorded its Application group at column 1; after the reload it stands empty, locked and active beside the learner's notes in column 2 and readme.md in column 3, and the learner typed the request into the chat view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
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
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    harness.focusView()
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: no focus command ran after the placement, the captured source has the keyboard, and the sentence says so.
    assert.deepEqual(
      harness.commands
        .slice(commandsBefore)
        .filter((command) => /^workbench\.action\.focus/.test(command)),
      [],
    )
    assert.equal(
      harness
        .focusedSource()
        ?.document.uri.path.endsWith('/Captured-overview.mts'),
      true,
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now: placing the panes needed the focus of the source, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own Study selection (the Study pane's control or a command) while a side view has the keyboard: as before row 613, the keyboard goes back to the learner's active file after the placement and nothing is told; fails_when=row 613's rule for an agent's selection also withholds the keyboard from a learner who selected the Study workspace themselves; why_new=Cycle 0046 row 613 (its bound: only an agent's request is treated so); seam=useNativeLayout, focusMutableDraft, focusView, the reader's changePresentation (the learner's path), textDocumentShows and the information messages
test('a learner’s own Study selection gives the keyboard back to the learner’s active file as before and tells nothing', async () => {
  // Arrange: the learner's notes stand in the second group and readme.md is the active editor of the third; a side view has the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus)
        .map((shown) => shown.name),
      ['Captured-overview.mts', 'learner-readme.md'],
    )
    assert.equal(
      harness.focusedSource()?.document.uri.path.endsWith('/learner-readme.md'),
      true,
    )
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard in an agent's cold order (select, Return Current, start) in VS Code: the Return Current that enters the live arrangement prepares its Application group as an agent's, and where that preparation had to focus an editor group the learner is told once that the new group has the keyboard; fails_when=the Return's preparation takes the chat view's keyboard with the first group's focus command and nothing tells the learner, because a Live Return keeps the final handoff for itself; why_new=Cycle 0046 finding on codebook_return_current; seam=useNativeLayout, focusMutableDraft, focusView (the chat view's input), the service's selectPresentation and returnToCurrent (the codebook_presentation and codebook_return_current handlers), textDocumentShows and the information messages
test('an agent’s Return Current after its own Study selection, made while the chat view has the keyboard, gives no file the keyboard and says once that the Application’s group has it', async () => {
  // Arrange: the agent selected the Study workspace from the chat view, and the learner typed the next request there again.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusView()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.focusView()
    const state = harness.reader.presentationState(),
      showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })

    // Assert: no document was shown with the keyboard, and the sentence says that the new Application group has it.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's knowledge of where the keyboard is when an agent selects the Study workspace while VS Code's chat editor tab (Chat: Open Chat in Editor) has the keyboard in a group the Study's panes then cover: the chat tab cannot be given its keyboard back without uncovering it, so the captured source keeps the keyboard the placement needed and the learner is told once; fails_when=the selection, having remembered a foreign tab, skips row 613's sentence and its return to that tab finds the tab behind a Study pane, so the keyboard moves to the captured source without a word; why_new=Cycle 0046 row 625; seam=useNativeLayout, focusMutableDraft, focusChatEditorTab, the service's selectPresentation (codebook_presentation), focusedSource and the information messages
test('an agent’s Study selection that covers the group of VS Code’s chat editor tab says once that the captured source has the keyboard', async () => {
  // Arrange: notes stand in the second group and readme.md in the third, where the learner typed the request into the chat opened as an editor tab.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    harness.focusChatEditorTab(3)
    const state = harness.reader.presentationState()

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the Study pane stands in front of the chat's group, the captured source has the keyboard, and the sentence says so.
    assert.equal(answer.layoutConfirmed, true)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(
      harness
        .focusedSource()
        ?.document.uri.path.endsWith('/Captured-overview.mts'),
      true,
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now: placing the panes needed the focus of the source, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of VS Code's chat editor tab that the learner moved into a floating window, where the agent's request was typed: the agent's Study selection arranges the panes and gives the chat its keyboard back through the numbered focus command of its group's column, which VS Code counts across its editor parts, so no sentence sends the learner to the captured source; the measurement's focus of the first group gave the learner's file the keyboard for a moment, and the chat's return says so once, since the editor reads the same whether the chat or a view had the keyboard (rows 647 and 655); fails_when=the floating window's group counts as another editor part whose only give-back is Cursor's Focus Agent, so VS Code runs nothing, the captured source keeps the keyboard and the learner is told "Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now …", or the return after the measurement's borrow is made without a word; why_new=Cycle 0046 row 636, and rows 647 and 655 (the sentence); seam=useNativeLayout, focusMutableDraft, addSeparateEditorPart('vscode-floating-chat') and its focusTab, the service's selectPresentation (codebook_presentation), the command log, the chat's keyboard and the information messages
test('an agent’s Study selection made from VS Code’s chat editor tab in a floating window gives that chat its keyboard back and says once that a file of the main editor had it for a moment', async () => {
  // Arrange: actions.ts is in the first group; the learner typed the request into the chat editor tab moved into a floating window, whose group the editor counts at column 3.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart('vscode-floating-chat')
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    const commandsBefore = harness.commands.length

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the Study layout is confirmed; the floating window's group, now column 4, got the keyboard back through its numbered focus command after the measurement's focus of the first group, and the arrangement's sentence was told once.
    assert.deepEqual(
      {
        layoutConfirmed: answer.layoutConfirmed,
        chatColumn: harness.groups.find((group) =>
          group.tabs.includes(chat.tab),
        )?.viewColumn,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        layoutConfirmed: true,
        chatColumn: 4,
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusFourthEditorGroup',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook placed its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=what an agent reads from its Return Current while the Study workspace is closed: a closed reader only remembers the current run in Live (row 616's reviewed path) and displays no source, so the answer is that state, closed and following the current run, nothing native changes, and the agent's codebook_presentation select then opens the Study following the run; fails_when=returnToCurrent refuses after the Return with EVIDENCE_UNAVAILABLE "Current source is not displayed in the native reader. Inspect its error and retry explicitly." and the recovery "Inspect the evidence failure and storage availability. …" for a source a closed Study never displays, after the Return already changed the reader's content revision, so the agent looks for an error that does not exist and every retry fails the same way; why_new=Cycle 0046 row 697 (C60 c60-vs-684-reset in VS Code 1.140.0); seam=workspaceHarness's VS Code model, useNativeLayout, focusMutableDraft, the service's returnToCurrent and selectPresentation (the codebook_return_current and codebook_presentation handlers), harness.groups and textDocumentShows
test('an agent’s Return Current while the Study workspace is closed answers the closed reader following the current run, and the agent’s select then opens the Study following it', async () => {
  // Arrange: the Study workspace is closed and the learner's actions.ts is in front of the first group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    const before = harness.reader.presentationState(),
      groupsBefore = harness.groups.map((group) =>
        group.tabs.map((tab) => tab.label),
      ),
      showsBefore = harness.textDocumentShows().length

    // Act
    const answer = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: before.presentationId,
        expectedRevision: before.reader.contentRevision,
      })
      .then(
        (state) => ({
          state: state.state,
          layoutConfirmed: state.layoutConfirmed,
          reader: { ...state.reader },
        }),
        (error: unknown) =>
          error instanceof StudyError ? error.describe() : String(error),
      )
    const groupsAfterReturn = harness.groups.map((group) =>
        group.tabs.map((tab) => tab.label),
      ),
      showsOfReturn = harness.textDocumentShows().slice(showsBefore)
    const afterReturn = harness.reader.presentationState()
    const opened = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: afterReturn.presentationId,
      expectedRevision: afterReturn.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the Return answered the closed reader following the current run and changed nothing native; the select opened the Study following it.
    assert.deepEqual(
      {
        before: { state: before.state, reader: { ...before.reader } },
        answer,
        groupsUnchanged:
          JSON.stringify(groupsAfterReturn) === JSON.stringify(groupsBefore),
        showsOfReturn,
        opened: { state: opened.state, reader: { ...opened.reader } },
      },
      {
        before: {
          state: 'closed',
          reader: {
            contentRevision: 1,
            contentTab: 'live',
            followingCurrentRun: true,
          },
        },
        answer: {
          state: 'closed',
          layoutConfirmed: false,
          reader: {
            contentRevision: 2,
            contentTab: 'live',
            followingCurrentRun: true,
          },
        },
        groupsUnchanged: true,
        showsOfReturn: [],
        opened: {
          state: 'open',
          reader: {
            contentRevision: 3,
            contentTab: 'live',
            followingCurrentRun: true,
          },
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=VS Code's chat editor tab keyboard in an agent's cold order (select, Return Current): the Return's preparation focuses the first group to place the Application, and the Return's own end gives the chat tab, in front of its group behind the new Application group, its keyboard back; no sentence says that the Application's group has the keyboard; fails_when=the preparation tells row 612's sentence ("that group has the keyboard now") and the Return then gives the chat tab the keyboard, so the learner is told the opposite of where the keyboard is; why_new=Cycle 0046 row 625; seam=useNativeLayout, focusMutableDraft, focusChatEditorTab and focusOpaqueTab (the learner clicking the chat tab again, in front of the Study pane), the service's selectPresentation and returnToCurrent (codebook_presentation, codebook_return_current), the active tab group and the information messages
test('an agent’s Return Current while VS Code’s chat editor tab has the keyboard gives that chat tab its keyboard back without saying that the Application’s group has it', async () => {
  // Arrange: the agent selected the Study from the chat opened as an editor tab of the third group, and the learner clicked the chat tab and typed the next request there.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    const chat = harness.focusChatEditorTab(3)
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.focusOpaqueTab(chat)
    const state = harness.reader.presentationState(),
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })

    // Assert: the Application stands in its own group at column 1, the chat tab's group (now column 4) has the keyboard with the chat in front, and nothing was told.
    const active = harness.editor.window.tabGroups.activeTabGroup
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(active.viewColumn, 4)
    assert.equal(active.activeTab, chat)
    assert.equal(harness.focusedSource(), undefined)
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's knowledge of where the keyboard is when an agent's Return Current cannot give VS Code's chat editor tab its keyboard back, because the live arrangement shows the captured source in front of the chat's group (the group directly below the Application's own): the Return's end tells once where the keyboard is, as row 614 does; fails_when=row 625 defers the preparation's sentence to the Return's end and drops it when the chat gets nothing back; why_new=Cycle 0046 row 625 guard; seam=useNativeLayout, focusMutableDraft, focusChatEditorTab and focusOpaqueTab, the service's selectPresentation and returnToCurrent, the active tab group and the information messages
test('an agent’s Return Current whose live arrangement covers the group of VS Code’s chat editor tab says once that the Application’s group has the keyboard', async () => {
  // Arrange: the learner typed the requests into the chat opened as an editor tab of the first group, in front of article-source.ts; the Study's selection covered it with the Application pane, and the learner brought it to the front again. The live arrangement shows the captured source in that group, directly below the Application's own group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    const chat = harness.focusChatEditorTab(1)
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.focusOpaqueTab(chat)
    const state = harness.reader.presentationState(),
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })

    // Assert: the new Application group, added above the chat's group without another group's focus, has the keyboard, and row 614's sentence says that an editor tab's keyboard went there.
    const active = harness.editor.window.tabGroups.activeTabGroup
    assert.equal(active.viewColumn, 1)
    assert.notEqual(active.activeTab, chat)
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's second group and the one-tab-per-capture rule when an agent's Study selection is followed by its Return Current beside two learner groups: the selection shows the captured source in front of the learner's second group (column 2), and the Return inserts the Application's own group above the first and shows the source again directly below the Application (the first learner group, now column 2); the copy the Study left in the second group (now column 3) is closed, so that group shows the learner's auth.ts again, and Close still returns both groups exactly; fails_when=the Return leaves the Study's Source tab in front of the second group, so the same capture is shown twice and covers auth.ts until Close (Cycle 0046 C56 1a natively in VS Code 1.140.0: layout 229/229/229 with [Application], [actions.ts … Captured-login-form.tsx], [auth.ts, Captured-login-form.tsx]); why_new=Cycle 0046 row 627; seam=useNativeLayout with two learner groups (leaveEmptyGroup, focusMutableDraft), addSeparateEditorPart and focusTab for Cursor's chat part, the service's selectPresentation and returnToCurrent (the codebook_presentation and codebook_return_current handlers), harness.groups, Close
for (const host of ['VS Code', 'Cursor'] as const)
  test(`an agent’s Return Current after its Study selection beside two learner groups shows the captured source once, below the Application, and gives the second group its own front tab back (${host})`, async () => {
    // Arrange: the learner's groups G1 [actions.ts] and G2 [auth.ts, a draft whose caret is on line 8]; in Cursor its chat tab, in a separate editor part, has the keyboard.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    try {
      harness.leaveEmptyGroup(1)
      harness.leaveEmptyGroup(2)
      const auth = harness.focusMutableDraft('auth.ts', 2)
      const caret = auth.editor.selections[0]!
      auth.editor.selections = [
        { anchor: caret.anchor.with(7, 0), active: caret.active.with(7, 0) },
      ]
      harness.focusMutableDraft('actions.ts', 1)
      const chat =
        host === 'Cursor' ? harness.addSeparateEditorPart() : undefined
      if (host === 'Cursor') harness.leavePaneFocusUnreportedBesideChat()
      chat?.focusTab()
      const selection = harness.reader.presentationState()
      await harness.service.selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      chat?.focusTab()
      const state = harness.reader.presentationState()

      // Act
      await harness.service.returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      const afterReturn = harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) =>
          'uri' in tab.input
            ? `${tab === group.activeTab ? '*' : ''}${tab.input.uri.path.split('/').at(-1)}`
            : `${tab === group.activeTab ? '*' : ''}${'viewType' in tab.input ? tab.input.viewType : 'chat'}`,
        ),
      }))
      const authCaretAfterReturn = auth.editor.selections[0]!.active.line
      await harness.close()

      // Assert: the Application above the captured source, which is shown once; the second learner group shows auth.ts in front with its caret, and Close returns both groups.
      assert.deepEqual(afterReturn, [
        { column: 1, tabs: ['*codebook.scopedBrowser'] },
        { column: 2, tabs: ['actions.ts', '*Captured-overview.mts'] },
        { column: 3, tabs: ['*auth.ts'] },
        ...(host === 'Cursor' ? [{ column: 4, tabs: ['*chat'] }] : []),
      ])
      assert.equal(authCaretAfterReturn, 7)
      assert.equal(auth.document.getText(), 'Original learner draft.\n')
      assert.deepEqual(
        harness.groups.map((group) =>
          group.tabs.map((tab) =>
            'uri' in tab.input ? tab.input.uri.path.split('/').at(-1) : 'chat',
          ),
        ),
        [['actions.ts'], ['auth.ts'], ...(host === 'Cursor' ? [['chat']] : [])],
      )
    } finally {
      await harness.close()
    }
  })

for (const situation of [
  {
    host: 'Cursor',
    keyboard: 'the captured source below the Application',
    activeColumn: 2,
    activeTextEditor: 'Captured-overview.mts',
  },
  {
    host: 'VS Code',
    keyboard: 'the Application’s new group',
    activeColumn: 1,
    activeTextEditor: undefined,
  },
] as const)
  // Value: protects=the one-tab-per-capture rule of row 627 when the Study's copy of the captured source has the keyboard only because Codebook's own selection left it there (row 613; in Cursor beside its chat part when the chat's Focus Agent was refused, C57 cursor-prep: [App], [G1 + Captured-login-form.tsx], [G2 + another Captured-login-form.tsx with the keyboard]): the agent's Return Current closes that copy, the second learner group shows auth.ts again, and the keyboard goes where the agent rule puts it, in Cursor to the captured source below the Application, in VS Code to the Application's new group as before; fails_when=retireMovedSourceCopies keeps every copy that has the keyboard, so the capture is shown twice, auth.ts stays covered, and the keyboard stays on the copy the live arrangement does not use; why_new=Cycle 0046 row 642; seam=useNativeLayout with two learner groups, addSeparateEditorPart and failNextCommand on Cursor's Focus Agent (the select leaves the keyboard on the source), focusChatInSecondarySideBar for VS Code's chat view, the service's selectPresentation and returnToCurrent, harness.groups and the active text editor
  test(`an agent’s Return Current after its Study selection left the keyboard on the captured source shows the source once and gives the second learner group its front tab back, with the keyboard in ${situation.keyboard} (${situation.host})`, async () => {
    // Arrange: the learner's groups G1 [actions.ts] and G2 [auth.ts]; the agent selected the Study from its chat, and Codebook's selection left the keyboard on the captured source in front of G2 (in Cursor its chat's Focus Agent was refused).
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat =
      situation.host === 'Cursor' ? harness.addSeparateEditorPart() : undefined
    try {
      harness.leaveEmptyGroup(1)
      harness.leaveEmptyGroup(2)
      harness.focusMutableDraft('auth.ts', 2)
      harness.focusMutableDraft('actions.ts', 1)
      if (chat) {
        harness.leavePaneFocusUnreportedBesideChat()
        chat.focusTab()
        harness.failNextCommand('composer.focusComposer')
      } else harness.focusChatInSecondarySideBar()
      const selection = harness.reader.presentationState()
      await harness.service.selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      const keyboardAfterSelect =
        harness.editor.window.activeTextEditor?.document.uri.path
          .split('/')
          .at(-1)
      const state = harness.reader.presentationState()

      // Act
      await harness.service.returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })

      // Assert: the Application above the captured source, which is shown once; the second learner group shows auth.ts in front, and the keyboard is where the agent rule puts it.
      assert.deepEqual(
        {
          keyboardAfterSelect,
          groups: harness.groups.map((group) => ({
            column: group.viewColumn,
            tabs: group.tabs.map((tab) =>
              'uri' in tab.input
                ? `${tab === group.activeTab ? '*' : ''}${tab.input.uri.path.split('/').at(-1)}`
                : `${tab === group.activeTab ? '*' : ''}${'viewType' in tab.input ? tab.input.viewType : 'chat'}`,
            ),
          })),
          activeColumn:
            harness.editor.window.tabGroups.activeTabGroup.viewColumn,
          activeTextEditor:
            harness.editor.window.activeTextEditor?.document.uri.path
              .split('/')
              .at(-1),
        },
        {
          keyboardAfterSelect: 'Captured-overview.mts',
          groups: [
            { column: 1, tabs: ['*codebook.scopedBrowser'] },
            { column: 2, tabs: ['actions.ts', '*Captured-overview.mts'] },
            { column: 3, tabs: ['*auth.ts'] },
            ...(chat ? [{ column: 4, tabs: ['*chat'] }] : []),
          ],
          activeColumn: situation.activeColumn,
          activeTextEditor: situation.activeTextEditor,
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=a copy of the captured source the learner works in: after Codebook's selection left the keyboard on it, the learner clicked into it, so the agent's Return Current keeps that copy with its keyboard, as row 627 keeps a copy with the keyboard; fails_when=row 642's retirement takes every copy whose keyboard Codebook placed once, also after the learner's own click, and moves the learner out of the source they read; why_new=Cycle 0046 row 642 (the learner's half); seam=useNativeLayout with two learner groups, addSeparateEditorPart and failNextCommand on Cursor's Focus Agent, workInActiveTextEditor (the learner's click), the service's selectPresentation and returnToCurrent, harness.groups and the active text editor
test('an agent’s Return Current keeps the Study’s copy of the captured source the learner clicked into after the selection, with its keyboard', async () => {
  // Arrange: as above in Cursor; after the selection the learner clicks into the captured source in front of G2.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.leaveEmptyGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('auth.ts', 2)
    harness.focusMutableDraft('actions.ts', 1)
    harness.leavePaneFocusUnreportedBesideChat()
    chat.focusTab()
    harness.failNextCommand('composer.focusComposer')
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.workInActiveTextEditor('mouse')
    const state = harness.reader.presentationState()

    // Act
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })

    // Assert: the copy the learner clicked into stays in front of the second learner group with the keyboard.
    assert.deepEqual(
      {
        thirdColumn: harness.groups
          .find((group) => group.viewColumn === 3)
          ?.tabs.map((tab) =>
            'uri' in tab.input ? tab.input.uri.path.split('/').at(-1) : 'other',
          ),
        activeTextEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        thirdColumn: ['auth.ts', 'Captured-overview.mts'],
        activeTextEditor: { name: 'Captured-overview.mts', column: 3 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a copy of the captured source the learner reached by the editor's numbered group focus command after Codebook's selection had left the keyboard on it and the learner had gone to the chat: the editor reported the learner's move away and back as changes of the active text editor that Codebook did not make, so the copy's keyboard is the learner's and the agent's Return Current keeps that copy with its keyboard, as for a click (row 642's learner half); fails_when=only a click or a key press in the copy counts as the learner's sign, so the Return takes the keyboard placed by Codebook's selection for still Codebook's and closes the copy the learner chose; why_new=Cycle 0046 row 654; seam=useNativeLayout with two learner groups, addSeparateEditorPart and failNextCommand on Cursor's Focus Agent (the select leaves the keyboard on the source), the chat's focusTab, workbench.action.focusSecondEditorGroup, the service's selectPresentation and returnToCurrent, harness.groups and the active text editor
test('an agent’s Return Current keeps the Study’s copy of the captured source the learner reached by its group’s numbered focus command after going to the chat, with its keyboard', async () => {
  // Arrange: as for the learner's click in Cursor; after the selection the learner types in the chat, then focuses the copy's group, the second, with the editor's numbered command.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.leaveEmptyGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('auth.ts', 2)
    harness.focusMutableDraft('actions.ts', 1)
    harness.leavePaneFocusUnreportedBesideChat()
    chat.focusTab()
    harness.failNextCommand('composer.focusComposer')
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    const copyColumnAfterSelect =
      harness.editor.window.tabGroups.activeTabGroup.viewColumn
    chat.focusTab()
    await harness.editor.commands.executeCommand(
      'workbench.action.focusSecondEditorGroup',
    )
    const keyboardAfterCommand = {
      name: harness.editor.window.activeTextEditor?.document.uri.path
        .split('/')
        .at(-1),
      column: harness.editor.window.activeTextEditor?.viewColumn,
    }
    const state = harness.reader.presentationState()

    // Act
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })

    // Assert: the copy the learner reached by the command stays in front of the second learner group with the keyboard.
    assert.deepEqual(
      {
        copyColumnAfterSelect,
        keyboardAfterCommand,
        thirdColumn: harness.groups
          .find((group) => group.viewColumn === 3)
          ?.tabs.map((tab) =>
            'uri' in tab.input ? tab.input.uri.path.split('/').at(-1) : 'other',
          ),
        activeTextEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        copyColumnAfterSelect: 2,
        keyboardAfterCommand: { name: 'Captured-overview.mts', column: 2 },
        thirdColumn: ['auth.ts', 'Captured-overview.mts'],
        activeTextEditor: { name: 'Captured-overview.mts', column: 3 },
      },
    )
  } finally {
    await harness.close()
  }
})

for (const situation of [
  { host: 'VS Code', entry: 'the learner’s Open Study Workspace' },
  { host: 'Cursor', entry: 'the learner’s Open Study Workspace' },
  { host: 'Cursor', entry: 'the reader’s own Live entry of the agent’s run' },
] as const)
  // Value: protects=the one-tab-per-capture rule of row 627 and the learner's second group when the Live arrangement is entered after an agent's Study selection left the keyboard on the captured source in front of the second learner group (row 613; in Cursor beside its chat part when the chat's Focus Agent was refused) and the agent started a run: the Application's preparation takes the keyboard for its new group and gives it back to that copy, which is Codebook's own focus change, so the copy's keyboard stays Codebook's placement and the entry's reentry below the Application retires the copy and gives the source below the Application the keyboard (row 642); fails_when=the preparation's focus return (returnPreparationFocus, showTextDocument with preserveFocus false) is taken for the learner's move onto the copy (endSourceKeyboardPlacementAtLearnersMove), so the reentry keeps the copy with the keyboard: the run's capture is shown twice, over auth.ts, until Close; why_new=Cycle 0046 row 692 (its scenario found this; the fixer's further finding); seam=useNativeLayout with two learner groups (leaveEmptyGroup, focusMutableDraft), addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, the chat's focusTab and failNextCommand on Cursor's Focus Agent, focusChatInSecondarySideBar for VS Code's chat view, the service's selectPresentation and start (the codebook_presentation and codebook_start handlers), stopOwnTimer and the reader's open and refresh (the learner's Open Study Workspace, the reader's timer), harness.groups and the active text editor
  test(`${situation.entry} after an agent’s Study selection left the keyboard on the captured source and a run started shows the run’s source once, below the Application, and gives the second learner group its front tab back (${situation.host})`, async () => {
    // Arrange: the learner's groups G1 [actions.ts] and G2 [auth.ts]; the agent selected the Study from its chat, which left the keyboard on the captured source in front of G2, and started a run the reader has not entered yet.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat =
      situation.host === 'Cursor' ? harness.addSeparateEditorPart() : undefined
    try {
      harness.leaveEmptyGroup(1)
      harness.leaveEmptyGroup(2)
      harness.focusMutableDraft('auth.ts', 2)
      harness.focusMutableDraft('actions.ts', 1)
      if (chat) {
        harness.leavePaneFocusUnreportedBesideChat()
        chat.focusTab()
        harness.failNextCommand('composer.focusComposer')
      } else harness.focusChatInSecondarySideBar()
      const selection = harness.reader.presentationState()
      await harness.service.selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      const keyboardAfterSelect =
        harness.editor.window.activeTextEditor?.document.uri.path
          .split('/')
          .at(-1)
      readerSeams(harness).stopOwnTimer()
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      await harness.service.record(receipt).preparation

      // Act
      if (situation.entry === 'the learner’s Open Study Workspace')
        await harness.reader.open()
      else await readerSeams(harness).refresh()

      // Assert: the Application above the run's captured source, which is shown once and has the keyboard; the second learner group shows auth.ts in front.
      assert.deepEqual(
        {
          keyboardAfterSelect,
          groups: harness.groups.map((group) => ({
            column: group.viewColumn,
            tabs: group.tabs.map((tab) =>
              'uri' in tab.input
                ? `${tab === group.activeTab ? '*' : ''}${tab.input.uri.path.split('/').at(-1)}`
                : `${tab === group.activeTab ? '*' : ''}${'viewType' in tab.input ? tab.input.viewType : 'chat'}`,
            ),
          })),
          activeTextEditor: {
            name: harness.editor.window.activeTextEditor?.document.uri.path
              .split('/')
              .at(-1),
            column: harness.editor.window.activeTextEditor?.viewColumn,
          },
        },
        {
          keyboardAfterSelect: 'Captured-overview.mts',
          groups: [
            { column: 1, tabs: ['*codebook.scopedBrowser'] },
            { column: 2, tabs: ['actions.ts', '*Captured-theme.ts'] },
            { column: 3, tabs: ['*auth.ts'] },
            ...(chat ? [{ column: 4, tabs: ['*chat'] }] : []),
          ],
          activeTextEditor: { name: 'Captured-theme.ts', column: 2 },
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner's place an agent's next request reads after a reentry below the Application gave the captured source the keyboard in place of a copy it retired: the reentry's focus (focusLiveSource, while the render's display is pending) is Codebook's own, so Codebook's placement note stays and the learner's place stays unknown, and an agent's next selection or Return keeps the keyboard where Codebook put it and says so once (rows 613, 642 and 654); fails_when=that focus is taken for the learner's move onto the captured source (endSourceKeyboardPlacementAtLearnersMove), so the next request reads the source as the learner's known place, gives the keyboard back as usual and tells nothing; why_new=Cycle 0046 row 692 (row 684's second path: its guard, pendingSourceDisplay, covers this reentry, which no harness scenario reached); seam=useNativeLayout with two learner groups, addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, the chat's focusTab and failNextCommand on Cursor's Focus Agent, the service's selectPresentation and start, stopOwnTimer and the reader's refresh (the reader's own Live entry of the agent's run), and readerSeams' knowsLearnersPlace (what an agent's next request reads)
test("the reentry's focus of the captured source below the Application, in place of the copy it retires, is no learner's move, so an agent's next request reads the learner's place as unknown", async () => {
  // Arrange: in Cursor beside its chat part, the agent's Study selection left the keyboard on the captured source in front of the second learner group, and the agent started a run the reader has not entered yet.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.leaveEmptyGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('auth.ts', 2)
    harness.focusMutableDraft('actions.ts', 1)
    harness.leavePaneFocusUnreportedBesideChat()
    chat.focusTab()
    harness.failNextCommand('composer.focusComposer')
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    readerSeams(harness).stopOwnTimer()
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation

    // Act: the reader's timer enters the Live arrangement of the run; its reentry retires the copy that had the keyboard and focuses the source below the Application.
    await readerSeams(harness).refresh()

    // Assert
    assert.deepEqual(
      {
        activeTextEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
        knowsLearnersPlace: readerSeams(harness).knowsLearnersPlace(),
      },
      {
        activeTextEditor: { name: 'Captured-theme.ts', column: 2 },
        knowsLearnersPlace: false,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard in VS Code when an agent starts a run right after its own Study selection, without Return Current: the reader's next refresh (every 250 ms, well before the run's Application viewport) enters the Live arrangement as the agent's run, so no file gets the keyboard and the learner is told once that the new Application group has it; fails_when=that entry prepares the Application as the learner's and its focus return shows the captured source, the active text editor, with the keyboard, and nothing tells the learner; why_new=Cycle 0046 finding on codebook_start (the reader's own Live entry of a run); seam=readerSeams stopOwnTimer (the refresh the test asks for is the reader's only one, so it runs the Live entry itself: a refresh asked for while one of the timer's is under way is answered when that one's reading ends, before its entry, which made this test fail under the load of a coverage run, FL2), useNativeLayout, focusMutableDraft, focusView (the chat view's input), the service's selectPresentation and start (the codebook_presentation and codebook_start handlers), the reader's refresh as its timer runs it, textDocumentShows and the information messages
test('an agent’s run started right after its own Study selection, while the chat view has the keyboard, enters Live with no file given the keyboard and says once that the Application’s group has it', async () => {
  // Arrange: the agent selected the Study workspace from the chat view, and the learner typed the next request there again; the reader's own timer is stopped, so the refresh below is its only one.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    readerSeams(harness).stopOwnTimer()
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusView()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation

    // Act: the reader refreshes, as its timer does, before the run creates its Application viewport.
    await readerSeams(harness).refresh()

    // Assert: no document was shown with the keyboard, and the sentence says that the new Application group has it.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat view's keyboard in VS Code when an agent's Return Current (codebook_return_current) meets a run the reader has not entered yet: the Return's own refresh enters the Live arrangement of that run, and that entry follows the Return's requester, so it is the agent's: no file gets the keyboard and the learner is told once that the new Application group has it; fails_when=the reader's Live entry inside a running Return ignores who asked for the Return and prepares the Application as the learner's, whose preparation adds no focus return of its own, so nothing tells the learner where the keyboard went; why_new=Cycle 0046 row 623 (commit 60bf03d8 made that entry follow the Return's requester without a test reaching it); seam=readerSeams stopOwnTimer (only the Return's own refresh runs), useNativeLayout, focusMutableDraft, focusView (the chat view's input), the service's selectPresentation, start and returnToCurrent (the codebook_presentation, codebook_start and codebook_return_current handlers), textDocumentShows and the information messages
test('an agent’s Return Current that meets a run the reader has not entered yet enters it as the agent’s, giving no file the chat view’s keyboard and saying once that the Application’s group has it', async () => {
  // Arrange: the agent selected the Study workspace from the chat view and started a run; the reader's own refresh has not entered it.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  readerSeams(harness).stopOwnTimer()
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusView()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    harness.focusView()
    const state = harness.reader.presentationState(),
      showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })

    // Assert: the run is the one the reader follows now, no document was shown with the keyboard, and the agent's sentence was told once.
    assert.equal(harness.reader['liveEntryRunId'], receipt.runId)
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own Return to current pause, run while the Study pane has the keyboard, when it meets a run the reader has not entered yet (the learner reads the Overview tab while following, so an agent's run is accepted and the reader's refresh does not enter it): the Return's own refresh enters the Live arrangement of that run as the learner's, so the agent's rule beside a chat view is not applied to the learner's own request and only the learner's sentence is told; fails_when=the reader's Live entry inside a running Return ignores who asked for the Return and treats every such entry as the agent's run, so the learner is also told the agent's sentence that this editor does not say where they were typing; why_new=Cycle 0046 row 623 (the other requester of the same entry); seam=readerSeams stopOwnTimer (only the Return's own refresh runs), the Study pane's tab message, the service's start (codebook_start), the Study pane's pane-focus report, the return-current action (the command Codebook: Return to Current Pause) and the information messages
test('the learner’s Return to current pause from the Study pane that meets a run the reader has not entered yet enters it as the learner’s and tells only the learner’s sentence', async () => {
  // Arrange: the learner follows the current run on the Overview tab of the Study pane when the agent starts a run, and the Study pane has the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  readerSeams(harness).stopOwnTimer()
  try {
    await harness.reader.open()
    harness.receiveContext({
      type: 'tab',
      tab: 'overview',
      revision: harness.reader.inspect().view!.revision,
    })
    await waitUntil(
      () => harness.reader.presentationState().reader.contentTab === 'overview',
      'the Overview tab the learner chose',
    )
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    harness.receiveContext({ type: 'pane-focus', focused: true })
    const messagesBefore = harness.informationMessages.length

    // Act: the learner runs Return to Current Pause while the Study pane has the keyboard.
    await harness.reader.action('return-current')

    // Assert: the run is the one the reader follows now, and only the learner's sentence was told.
    assert.equal(harness.reader['liveEntryRunId'], receipt.runId)
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Return to current pause closed the Study pane, which had the keyboard, to arrange the live run. The active editor group has the keyboard now (the Application pane’s, once it is placed). Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who presses Return to current pause in the Study pane while it has the keyboard: the live arrangement closes that pane, so its keyboard would be on no element (a key pressed then goes nowhere) with the new Application group named as the active one; the keyboard is given to that group and the learner is told once where it is; fails_when=a learner's Live Return adds no focus return of its own (returnPreparationFocus returns at once for it, finishCurrentReturn gives the keyboard back only to a foreign tab), so the keyboard stays on the page body and nothing is told; why_new=Cycle 0046 row 624; seam=the workspace harness in VS Code's model (one editor part) and in Cursor's (addSeparateEditorPart), the Study pane's pane-focus report, the pane's return-current action, keyboardOnBody, focusedPanel and the information messages
for (const host of ['VS Code', 'Cursor'] as const)
  test(`Return to current pause pressed in the Study pane in ${host} gives the Application's group the keyboard the closed Study pane had and says so once`, async () => {
    // Arrange: the learner reads a saved item while a run is current, and the Study pane has the keyboard.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    if (host === 'Cursor') harness.addSeparateEditorPart()
    try {
      await harness.reader.open()
      await harness.reader.select('repository/workspace/overview')
      await harness.reader.action('focus-context')
      harness.receiveContext({ type: 'pane-focus', focused: true })
      const messagesBefore = harness.informationMessages.length

      // Act: the learner presses Return to current pause in the Study pane.
      await harness.reader.action('return-current', true)

      // Assert: the Study pane is gone, the Application's group has the keyboard, and the sentence says so once.
      assert.deepEqual(
        {
          studyPaneOpen: Boolean(harness.reader['contextPanel']),
          keyboardOnBody: harness.keyboardOnBody(),
          activeTab: harness.focusedPanel(),
          messages: harness.informationMessages
            .slice(messagesBefore)
            .map((message) => message.message),
        },
        {
          studyPaneOpen: false,
          keyboardOnBody: false,
          activeTab: 'codebook.scopedBrowser',
          messages: [
            'Return to current pause closed the Study pane, which had the keyboard, to arrange the live run. The active editor group has the keyboard now (the Application pane’s, once it is placed). Click where you want to type.',
          ],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner whose Return to current pause, pressed in the Study pane while it had the keyboard, is refused after the live arrangement already closed that pane (here the editor rejects the new Application group): the keyboard the closed pane had would be on no element, so the Return's end still gives the active editor group the keyboard and tells once where it is, as the Return that succeeds does; fails_when=only a Return that succeeds settles the learner's place (the refusal skips settleLearnersReturnKeyboard), so after the refusal the keyboard stays on the page body and nothing is told; why_new=Cycle 0046 row 629 (row 624's refusal branch had no test); seam=the workspace harness in VS Code's and Cursor's models, failNextCommand (the editor rejects workbench.action.newGroupAbove), the Study pane's pane-focus report, the pane's return-current action, keyboardOnBody, the command log and the information messages
for (const host of ['VS Code', 'Cursor'] as const)
  test(`Return to current pause pressed in the Study pane in ${host} and refused after it closed that pane gives the active editor group the keyboard and says so once`, async () => {
    // Arrange: the learner reads a saved item while a run is current, and the Study pane has the keyboard; the editor will reject the Application's new group.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    if (host === 'Cursor') harness.addSeparateEditorPart()
    try {
      await harness.reader.open()
      await harness.reader.select('repository/workspace/overview')
      await harness.reader.action('focus-context')
      harness.receiveContext({ type: 'pane-focus', focused: true })
      const messagesBefore = harness.informationMessages.length,
        commandsBefore = harness.commands.length
      harness.failNextCommand('workbench.action.newGroupAbove')

      // Act: the learner presses Return to current pause in the Study pane.
      let refusal: unknown
      await harness.reader
        .action('return-current', true)
        .catch((error: unknown) => {
          refusal = error
        })

      // Assert: the Return was refused after the Study pane closed; the active editor group got the keyboard as the last command, and the sentence says so once.
      assert.deepEqual(
        {
          refusal: String(refusal),
          studyPaneOpen: Boolean(harness.reader['contextPanel']),
          lastCommand: harness.commands.slice(commandsBefore).at(-1),
          keyboardOnBody: harness.keyboardOnBody(),
          messages: harness.informationMessages
            .slice(messagesBefore)
            .map((message) => message.message),
        },
        {
          refusal: 'Error: Native layout command failed',
          studyPaneOpen: false,
          lastCommand: 'workbench.action.focusActiveEditorGroup',
          keyboardOnBody: false,
          messages: [
            'Return to current pause closed the Study pane, which had the keyboard, to arrange the live run. The active editor group has the keyboard now (the Application pane’s, once it is placed). Click where you want to type.',
          ],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner who presses Return to current pause in the Observed moments view of the bottom panel, which outlives the Study pane the live arrangement closes: that view gets its keyboard back with its own focus command (VS Code 1.140.0 workbench.desktop.main.js 1639:157156: the view's focus command opens it with the focus unless asked to keep it), and nothing is told; fails_when=in Cursor's model the Application group's preparation focused the first editor group, which took the view's keyboard, and the Return gives it back to no one, so it ends on the page body without a word; why_new=Cycle 0046 row 624 (the Return control the learner pressed still exists there); seam=the workspace harness in VS Code's and Cursor's models, the bottom view's pane-focus report, focusView (a view that is no editor has the keyboard), viewFocusCommands and the information messages
for (const host of ['VS Code', 'Cursor'] as const)
  test(`Return to current pause pressed in the Observed moments view in ${host} gives that view its keyboard back and tells nothing`, async () => {
    // Arrange: the learner reads a saved item while a run is current, opened Observed moments in the bottom panel and clicked into it.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    if (host === 'Cursor') harness.addSeparateEditorPart()
    try {
      await harness.reader.open()
      await harness.reader.select('repository/workspace/overview')
      await harness.editor.commands.executeCommand(
        'codebook.observedMoments.focus',
      )
      harness.focusView()
      harness.receivePlaybackPanel({ type: 'pane-focus', focused: true })
      const viewFocusBefore = harness.viewFocusCommands.length,
        messagesBefore = harness.informationMessages.length

      // Act: the learner presses Return to current pause in Observed moments.
      await harness.reader.action('return-current', true)

      // Assert: the Study pane is gone, the view's focus command ran once with the focus, and nothing is told.
      assert.deepEqual(
        {
          studyPaneOpen: Boolean(harness.reader['contextPanel']),
          viewFocusCommands: harness.viewFocusCommands.slice(viewFocusBefore),
          messages: harness.informationMessages
            .slice(messagesBefore)
            .map((message) => message.message),
        },
        {
          studyPaneOpen: false,
          viewFocusCommands: [
            {
              command: 'codebook.observedMoments.focus',
              preserveFocus: false,
            },
          ],
          messages: [],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the main editor's grid when the chat cannot be given the keyboard back: in an editor without Cursor's "Focus Agent" command the focus stays where the arrangement ended and no group is opened; fails_when=the focus command of the other editor part's column is run, which opens a new empty group in the main editor; why_new=Cycle 0045 cause 12 (d) (the numbered focus commands count the main editor's groups only); seam=workspace harness with a separate editor part, removeHostCommands
test('a selection made while another editor part holds the keyboard, in an editor without a command that focuses that part, leaves the focus where the arrangement ended and opens no editor group', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.removeHostCommands('composer.focusComposer')
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focus()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(harness.groups.length, 4)
    assert.deepEqual(keyboardCommands(harness), [
      'workbench.action.focusFirstEditorGroup',
    ])
    // The keyboard is on the captured source the arrangement placed last.
    assert.equal(chat.focused(), false)
    assert.equal(harness.editor.window.activeTextEditor?.viewColumn, 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's restore, or its second selection, right after its own selection from Cursor's chat being answered confirmed, with the keyboard left in the chat input and nothing arranged again; fails_when=the restore is refused with "… the focused tab "Captured-login-form.tsx" in editor group 2 has no text editor, so the focus could not be given back to it. …" because the editor names the reader's own captured source without an active text editor while the chat input has the keyboard; why_new=Cycle 0045 cause 12 (g) (obs15 R, a2-restore: refused after 172 ms; an agent that calls select and then restore got this); seam=workspace harness with a separate editor part that holds the keyboard, the fake Cursor's stale group name and its command log
for (const action of ['restore', 'select'] as const)
  test(`a ${action === 'restore' ? 'restore' : 'second selection'} made from Cursor's chat right after its own selection answers the confirmed layout and leaves the keyboard in the chat`, async () => {
    // Arrange: as the editor API reported it in Cursor after a selection made from the chat input: the three panes are arranged, the chat input has the keyboard again, and the editor names the reader's own captured source in group 2, whose text editor is visible, without an active text editor.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    try {
      harness.focusMutableDraft('actions.ts', 1)
      chat.focus()
      const closed = harness.reader.presentationState()
      const selected = await harness.reader.changePresentation({
        presentationId: closed.presentationId,
        expectedRevision: closed.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      const named = harness.editor.window.tabGroups.activeTabGroup,
        namedInput: unknown = named.activeTab?.input
      const stateBefore = {
        namedColumn: named.viewColumn,
        namedTabIsCapturedSource:
          namedInput instanceof harness.editor.TabInputText &&
          namedInput.uri.scheme === 'codebook-source',
        hasActiveTextEditor:
          harness.editor.window.activeTextEditor !== undefined,
        sourceEditorVisibleInColumn: harness.editor.window.visibleTextEditors
          .filter((editor) => editor.document.uri.scheme === 'codebook-source')
          .map((editor) => editor.viewColumn),
        chatHasKeyboard: chat.focused(),
      }
      const commandsBefore = harness.commands.length,
        tabsBefore = harness.groups.map((group) => [...group.tabs])
      // Act
      const restored = await harness.reader.changePresentation({
        presentationId: selected.presentationId,
        expectedRevision: selected.presentationControlRevision,
        mode: 'study-workspace',
        action,
      })
      // Assert
      assert.deepEqual(stateBefore, {
        namedColumn: 2,
        namedTabIsCapturedSource: true,
        hasActiveTextEditor: false,
        sourceEditorVisibleInColumn: [2],
        chatHasKeyboard: true,
      })
      assert.equal(selected.layoutConfirmed, true)
      assert.equal(restored.state, 'open')
      assert.equal(restored.layoutConfirmed, true)
      // The grid cannot be measured from the chat without taking its keyboard: the answer repeats the selection's confirmation and says so.
      assert.equal(restored.layoutMeasured, false)
      assert.equal(restored.reason, undefined)
      assert.equal(restored.panes.appColumn, 1)
      assert.equal(restored.panes.sourceColumn, 2)
      assert.equal(restored.panes.contextColumn, 3)
      // One layout read, as a status read makes it: nothing was arranged, focused or closed.
      assert.deepEqual(harness.commands.slice(commandsBefore), [
        'vscode.getEditorLayout',
      ])
      assert.deepEqual(
        harness.groups.map((group) => [...group.tabs]),
        tabsBefore,
      )
      assert.deepEqual(harness.tabCloseRequests(), [])
      assert.equal(chat.focused(), true)
    } finally {
      await harness.close()
    }
  })

// Value: protects=an agent's restore from Cursor's chat being admitted and arranged when the learner resized the panes since its selection, while the editor names the reader's own captured source without an active text editor, and the chat having the keyboard again afterwards; fails_when=the reader's own current captured source is refused like a leftover one that no text editor shows ("… has no text editor, so the focus could not be given back to it. …"), which only a click into an editor clears, and an agent cannot click; why_new=Cycle 0045 cause 12 (g) (obs15 R, a2-restore); seam=workspace harness with a separate editor part that holds the keyboard, changeEditorLayout
test("a restore made from Cursor's chat after the learner resized the panes arranges them again while the editor names the reader's captured source without an active text editor", async () => {
  // Arrange: a selection from the chat input arranged the three panes; the learner then clicked into the captured source and dragged two sashes, a status read saw the changed grid, and the learner went back to the chat input, so the editor names the captured source in group 2 without an active text editor.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focus()
    const closed = harness.reader.presentationState()
    const selected = await harness.reader.changePresentation({
      presentationId: closed.presentationId,
      expectedRevision: closed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    const source = harness.editor.window.visibleTextEditors.find(
      (editor) => editor.document.uri.scheme === 'codebook-source',
    )
    assert.ok(source)
    await harness.editor.window.showTextDocument(source.document, {
      viewColumn: 2,
    })
    harness.changeEditorLayout({
      orientation: 0,
      groups: [
        { size: 0.7, groups: [{ size: 0.3 }, { size: 0.7 }] },
        { size: 0.3 },
      ],
    })
    const unconfirmed = await harness.reader.readPresentationState()
    chat.focus()
    const named = harness.editor.window.tabGroups.activeTabGroup,
      namedInput: unknown = named.activeTab?.input
    const stateBefore = {
      namedColumn: named.viewColumn,
      namedTabIsCapturedSource:
        namedInput instanceof harness.editor.TabInputText &&
        namedInput.uri.scheme === 'codebook-source',
      hasActiveTextEditor: harness.editor.window.activeTextEditor !== undefined,
      chatHasKeyboard: chat.focused(),
    }
    const commandsBefore = harness.commands.length
    // Act
    const restored = await harness.reader.changePresentation({
      presentationId: unconfirmed.presentationId,
      expectedRevision: unconfirmed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    // Assert
    assert.deepEqual(stateBefore, {
      namedColumn: 2,
      namedTabIsCapturedSource: true,
      hasActiveTextEditor: false,
      chatHasKeyboard: true,
    })
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(unconfirmed.layoutConfirmed, false)
    assert.equal(
      unconfirmed.reason,
      'The Study arrangement is not confirmed: the editor grid no longer has the sizes of the confirmed layout. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.',
    )
    assert.equal(restored.state, 'open')
    assert.equal(restored.layoutConfirmed, true)
    assert.equal(restored.reason, undefined)
    assert.equal(restored.panes.appColumn, 1)
    assert.equal(restored.panes.sourceColumn, 2)
    assert.equal(restored.panes.contextColumn, 3)
    // The grid has the sizes of the Study layout again; three groups of the main editor and the chat's, none of them empty.
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    assert.equal(harness.groups.length, 4)
    assert.equal(
      harness.groups.some((group) => group.tabs.length === 0),
      false,
    )
    // The arrangement entered the main editor through the captured source's text editor (Cursor reports no focus of the Application pane the first group shows); the chat has the keyboard again through Cursor's own command.
    assert.deepEqual(
      harness.commands.slice(commandsBefore).filter(isKeyboardCommand),
      ['composer.focusComposer'],
    )
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's Restore made from Cursor's chat right after its own Return Current: the Return gave the chat input its keyboard back with Cursor's Focus Agent, which changes no tab or group, so the editor names the Application pane's tab while that pane is not active; the Restore arranges the live panes again, answers confirmed and gives the chat its keyboard back; fails_when=the Restore takes the named Application pane for the learner's focus, its measurement moves the keyboard into the main editor, and it refuses with "The Study pane did not regain native focus after layout measurement." although no Study pane was pressed, leaving the chat without the keyboard; why_new=Cycle 0046 row 628; seam=useNativeLayout, addSeparateEditorPart (Cursor's chat part and its Focus Agent command), the service's selectPresentation and returnToCurrent (codebook_presentation, codebook_return_current), focusedPanel and the command log
test('an agent’s Restore right after its own Return Current from Cursor’s chat reaches the confirmed live arrangement and gives the chat its keyboard back', async () => {
  // Arrange: the agent selected the Study workspace from Cursor's chat and returned it to the current run; the Return gave the chat input the keyboard back, and the editor still names the Application pane's tab.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    chat.focusTab()
    const beforeReturn = harness.reader.presentationState()
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: beforeReturn.presentationId,
      expectedRevision: beforeReturn.reader.contentRevision,
    })
    const afterReturn = harness.reader.presentationState()
    const stateBefore = {
      contentTab: afterReturn.reader.contentTab,
      layoutConfirmed: afterReturn.layoutConfirmed,
      namedTab: harness.focusedPanel(),
      chatHasKeyboard: chat.focused(),
    }
    const commandsBefore = harness.commands.length

    // Act
    const restored = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: afterReturn.presentationId,
      expectedRevision: afterReturn.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })

    // Assert: the live arrangement is confirmed again, and Cursor's own command gave the chat input its keyboard back.
    assert.deepEqual(stateBefore, {
      contentTab: 'live',
      layoutConfirmed: true,
      namedTab: 'codebook.scopedBrowser',
      chatHasKeyboard: true,
    })
    assert.deepEqual(
      {
        layoutConfirmed: restored.layoutConfirmed,
        reason: restored.reason,
        appColumn: restored.panes.appColumn,
        sourceColumn: restored.panes.sourceColumn,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter(isKeyboardCommand),
        chatHasKeyboard: chat.focused(),
      },
      {
        layoutConfirmed: true,
        reason: undefined,
        appColumn: 1,
        sourceColumn: 2,
        keyboardCommands: ['composer.focusComposer'],
        chatHasKeyboard: true,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's Restore made from VS Code's chat view right after its own Return Current: VS Code names the Application pane as the active one beside its chat view, the Restore arranges the live panes again, answers confirmed, and takes nothing from the view that has the keyboard; fails_when=a change for Cursor's chat part (row 628) runs a chat focus command or refuses the Restore in VS Code; why_new=Cycle 0046 row 628 (VS Code's chat-view model); seam=useNativeLayout, focusChatInSecondarySideBar, the service's selectPresentation and returnToCurrent, keyboardInView and the command log
test('an agent’s Restore right after its own Return Current from VS Code’s chat view reaches the confirmed live arrangement and leaves the keyboard in that view', async () => {
  // Arrange: the agent selected the Study workspace from VS Code's chat view and returned it to the current run; the learner typed the next request into the chat view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusChatInSecondarySideBar()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.focusChatInSecondarySideBar()
    const beforeReturn = harness.reader.presentationState()
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: beforeReturn.presentationId,
      expectedRevision: beforeReturn.reader.contentRevision,
    })
    harness.focusChatInSecondarySideBar()
    const afterReturn = harness.reader.presentationState()
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length

    // Act
    const restored = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: afterReturn.presentationId,
      expectedRevision: afterReturn.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })

    // Assert: the live arrangement is confirmed again; no focus command ran, the chat view keeps the keyboard, and nothing is told.
    assert.deepEqual(
      {
        contentTab: afterReturn.reader.contentTab,
        layoutConfirmed: restored.layoutConfirmed,
        reason: restored.reason,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter(isKeyboardCommand),
        viewHasKeyboard: harness.keyboardInView(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        contentTab: 'live',
        layoutConfirmed: true,
        reason: undefined,
        keyboardCommands: [],
        viewHasKeyboard: true,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own Restore from the command palette or its shortcut (Codebook: Arrange Study Workspace) right after an agent's Return Current from Cursor's chat: the Return gave the chat input its keyboard back with Cursor's Focus Agent, which changes no tab or group, so the editor names the Application pane's tab while that pane is not active; the command arranges the live panes again, answers confirmed and gives the chat its keyboard back; fails_when=the command's Restore takes the named Application pane for the learner's focus, its measurement moves the keyboard into the main editor, and it is refused with "The Study pane did not regain native focus after layout measurement." although no Study pane was pressed, leaving the chat without the keyboard (row 628 fixed only the agent's Restore); why_new=Cycle 0046 row 638; seam=useNativeLayout, addSeparateEditorPart (Cursor's chat part and its Focus Agent command), the service's selectPresentation and returnToCurrent, the reader's action('arrange') as the command runs it, the reader's error lines, focusedPanel and the command log
test('a learner’s Arrange Study Workspace command right after an agent’s Return Current from Cursor’s chat reaches the confirmed live arrangement and gives the chat its keyboard back', async () => {
  // Arrange: the agent selected the Study workspace from Cursor's chat and returned it to the current run; the Return gave the chat input the keyboard back, and the editor still names the Application pane's tab. The learner then runs Codebook: Arrange Study Workspace from the command palette, which gives the keyboard back to the chat input when it closes.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    chat.focusTab()
    const beforeReturn = harness.reader.presentationState()
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: beforeReturn.presentationId,
      expectedRevision: beforeReturn.reader.contentRevision,
    })
    const afterReturn = harness.reader.presentationState()
    const stateBefore = {
      contentTab: afterReturn.reader.contentTab,
      layoutConfirmed: afterReturn.layoutConfirmed,
      namedTab: harness.focusedPanel(),
      chatHasKeyboard: chat.focused(),
    }
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.reader.action('arrange')

    // Assert: the live arrangement is confirmed again with no error line, and Cursor's own command gave the chat input its keyboard back.
    const restored = harness.reader.presentationState()
    assert.deepEqual(stateBefore, {
      contentTab: 'live',
      layoutConfirmed: true,
      namedTab: 'codebook.scopedBrowser',
      chatHasKeyboard: true,
    })
    assert.deepEqual(
      {
        errorLines: readerSeams(harness).errorLines(),
        layoutConfirmed: restored.layoutConfirmed,
        reason: restored.reason,
        appColumn: restored.panes.appColumn,
        sourceColumn: restored.panes.sourceColumn,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter(isKeyboardCommand),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        errorLines: [],
        layoutConfirmed: true,
        reason: undefined,
        appColumn: 1,
        sourceColumn: 2,
        keyboardCommands: ['composer.focusComposer'],
        chatHasKeyboard: true,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own Restore after an agent's Return Current where the keyboard is in VS Code's chat view: the command run from that view arranges the live panes, answers confirmed and leaves the keyboard in the view; fails_when=the change for the command's Restore from Cursor's chat (row 638) runs a focus command or refuses the command's Restore in VS Code; why_new=Cycle 0046 row 638 (VS Code's chat-view model; its Cursor case, a press in a Study view, is row 647's test below, whose verdict the corrected Cursor model changed); seam=useNativeLayout, focusChatInSecondarySideBar, the service's selectPresentation and returnToCurrent, the reader's action('arrange') without a pane's press, keyboardInView, the reader's error lines and the command log
test('the learner’s Arrange Study Workspace command run from VS Code’s chat view right after an agent’s Return Current reaches the confirmed live arrangement and leaves the keyboard in that view', async () => {
  // Arrange: the agent selected the Study workspace from VS Code's chat view and returned it to the current run; the learner then typed in that chat view again.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusChatInSecondarySideBar()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.focusChatInSecondarySideBar()
    const beforeReturn = harness.reader.presentationState()
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: beforeReturn.presentationId,
      expectedRevision: beforeReturn.reader.contentRevision,
    })
    harness.focusChatInSecondarySideBar()
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.reader.action('arrange')

    // Assert: the live arrangement is confirmed again with no error line; no focus command ran, the view keeps the keyboard, and nothing is told.
    const restored = harness.reader.presentationState()
    assert.deepEqual(
      {
        errorLines: readerSeams(harness).errorLines(),
        contentTab: restored.reader.contentTab,
        layoutConfirmed: restored.layoutConfirmed,
        reason: restored.reason,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter(isKeyboardCommand),
        viewHasKeyboard: harness.keyboardInView(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        errorLines: [],
        contentTab: 'live',
        layoutConfirmed: true,
        reason: undefined,
        keyboardCommands: [],
        viewHasKeyboard: true,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

for (const situation of [
  {
    where: 'the terminal',
    learnerMovesTo: 'terminal',
    pressedInStudyView: false,
  },
  {
    where: 'a Study view',
    learnerMovesTo: 'view',
    pressedInStudyView: true,
  },
] as const)
  // Value: protects=the learner told where the keyboard is when the learner's own Restore is run beside Cursor's chat part from ${situation.where} right after an agent's Return Current from that chat: Cursor keeps its chat part the active editor part after a click into the terminal or a view (Cursor 3.23.12 workbench.desktop.main.js 17501:84373, 17501:88693), so the layout read answers for the chat part (17501:90249) and the arrangement borrows the main editor's focus; the editor names the Application pane's tab Focus Agent left named, which the Restore reads as the chat's place, gives the chat its keyboard back, and the arrangement's sentence is told once in the session; fails_when=the Restore moves the keyboard from the terminal or the view into the chat without a word, or a press in a Study view is refused with "The Study pane did not regain native focus after layout measurement." because the measurement's borrow did not give back the stale named tab; why_new=Cycle 0046 row 647 (row 638's pin of a press in a Study view passed in the harness only, whose Cursor model answered layout reads for the main editor once a view had the keyboard); seam=useNativeLayout, addSeparateEditorPart (Cursor's chat part, which stays the active part after focusTerminalInBottomPanel and focusView), the service's selectPresentation and returnToCurrent, the reader's action('arrange') with and without a pane's press, keyboardInView, the reader's error lines, the command log and the information messages
  test(`the learner’s Restore run beside Cursor’s chat part from ${situation.where} right after an agent’s Return Current reaches the confirmed live arrangement, gives the chat its keyboard back and has told once where the keyboard is`, async () => {
    // Arrange: the agent selected the Study workspace from Cursor's chat and returned it to the current run; the learner then clicked into ${situation.where}, which leaves Cursor's chat part the active editor part.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    try {
      harness.focusMutableDraft('actions.ts', 1)
      chat.focusTab()
      const selection = harness.reader.presentationState()
      await harness.service.selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      chat.focusTab()
      const beforeReturn = harness.reader.presentationState()
      await harness.service.returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: beforeReturn.presentationId,
        expectedRevision: beforeReturn.reader.contentRevision,
      })
      if (situation.learnerMovesTo === 'terminal')
        harness.focusTerminalInBottomPanel()
      else harness.focusView()
      const commandsBefore = harness.commands.length

      // Act
      await harness.reader.action('arrange', situation.pressedInStudyView)

      // Assert: the live arrangement is confirmed with no error line, Cursor's Focus Agent gave the chat the keyboard, and the session's sentence for a return after the measurement's borrow was told once.
      const restored = harness.reader.presentationState()
      assert.deepEqual(
        {
          errorLines: readerSeams(harness).errorLines(),
          contentTab: restored.reader.contentTab,
          layoutConfirmed: restored.layoutConfirmed,
          reason: restored.reason,
          keyboardCommands: harness.commands
            .slice(commandsBefore)
            .filter(isKeyboardCommand),
          viewHasKeyboard: harness.keyboardInView(),
          chatHasKeyboard: chat.focused(),
          messages: harness.informationMessages.map(
            (message) => message.message,
          ),
        },
        {
          errorLines: [],
          contentTab: 'live',
          layoutConfirmed: true,
          reason: undefined,
          keyboardCommands: ['composer.focusComposer'],
          viewHasKeyboard: false,
          chatHasKeyboard: true,
          messages: [
            'Codebook placed its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
          ],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=an agent's selection after the learner watched a replay and closed the Study workspace: the reader still holds that recording, and the selection arranges its panes and answers confirmed once the recorded source is shown; fails_when=the selection is answered while the recorded source is still opening, with "The live Study layout could not be confirmed after Restore." and the panes it opened left behind, again at every repeat; why_new=Cycle 0045 cause 12 (e) (obs15 P4: two selects refused after 473 ms and 446 ms with the cause "The recorded source is opening in its native pane."); seam=the recorded reader harness, focusMutableDraft
test("a selection made on a closed reader that holds a recording arranges the recording's panes and answers confirmed once the recorded source is shown", async () => {
  // Arrange: a recording was opened and the Study workspace closed; the learner types in a file.
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.close()
    const learnerFile = harness.focusMutableDraft('actions.ts', 1)
    const closed = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: closed.presentationId,
      expectedRevision: closed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(closed.state, 'closed')
    assert.equal(closed.reader.contentTab, 'recording')
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.reader.contentTab, 'recording')
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, undefined)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(learnerFile.document.getText(), 'Original learner draft.\n')
    assert.equal(learnerFile.tab.isDirty, true)
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 2)
        ?.tabs.includes(learnerFile.tab),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's selection on a closed reader whose recording was never read to its end (the Study workspace was closed while the recording was loading, or its load had failed): the selection reads the recording again, arranges its panes and answers confirmed; fails_when=the read that the selection's own entry restarts opens the reader a second time, which the selection's pending presentation change refuses ("A presentation change or reader close is pending. …"), so the recording fails to load and the selection is refused with "The recording's Study layout could not be confirmed after Restore." at every repeat; why_new=Cycle 0045 cause 12 (e), second native result (obs15 R, e-select1 and e-select2: refused after 1.93 s and 194 ms, the Application tab never got the recording's title, the reader's content revision went from 9 to 12); seam=the recorded reader harness, focusMutableDraft
test('a selection made on a closed reader whose recording was closed while it was loading reads the recording again and answers confirmed', async () => {
  // Arrange: a recording was opened and the Study workspace closed before the recording was read; the learner types in a file.
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.reader.close()
    harness.focusMutableDraft('actions.ts', 1)
    const closed = harness.reader.presentationState(),
      readBeforeSelect = {
        readiness: harness.controller.state().readiness,
        presentedMs: harness.controller.state().presentedMs,
      }
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: closed.presentationId,
      expectedRevision: closed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(closed.state, 'closed')
    assert.equal(closed.reader.contentTab, 'recording')
    assert.deepEqual(readBeforeSelect, {
      readiness: 'idle',
      presentedMs: undefined,
    })
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.reader.contentTab, 'recording')
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, undefined)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().reason, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=the cause an agent reads when the recording the reader holds failed to load: it names the failure and the step that loads the recording again; fails_when=the state and the refusal say "The current captured source is not ready in its native pane. Wait for it, or use Return to current …", which names a step that loads no recording, so the agent waits or returns to the current run and the select is refused again; why_new=Cycle 0045 cause 12 (e), second native result (obs15 R: that sentence stood in the state after both refused selects while the recording's load had failed); seam=the recorded reader harness, failNextCommand
test('the refusal of a selection on a reader whose recording failed to load names that failure and the step that loads the recording again', async () => {
  // Arrange: the Study workspace is open; a recording is opened and the editor fails the layout read of its entry, so the recording's load fails with the reader open.
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}] })
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    harness.failNextCommand('vscode.getEditorLayout')
    harness.controller.command({
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    const failed = harness.reader.presentationState()
    // Act
    const refused = harness.reader.changePresentation({
      presentationId: failed.presentationId,
      expectedRevision: failed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(failed.state, 'open')
    assert.equal(failed.layoutConfirmed, false)
    assert.equal(
      failed.reason,
      'The recording is not shown: it could not be loaded (Native layout command failed). Open the recording again, then restore the layout.',
    )
    await assert.rejects(refused, {
      code: 'PRESENTATION_UNAVAILABLE',
      message:
        "The recording's Study layout could not be confirmed after Restore.",
      causeDetail:
        'The recording is not shown: it could not be loaded (Native layout command failed). Open the recording again, then restore the layout.',
    })
  } finally {
    await harness.close()
  }
})

// protects=a replay the learner opens from the Save notice, the status item or Saved studies while Cursor's Agent chat group is the active editor group and takes the keyboard back right after the first group's focus command: the panes are arranged and confirmed with no manual click and the chat has the keyboard again; fails_when=the wait for the main editor's focus report ends after five seconds with "The Codebook panes were not arranged: the main editor did not report the keyboard focus within 5 s …" because the pane's focus was reported only for a moment (N60, Cursor 3.27.12); no_claim=the real Cursor's answer of the layout read after that moment (native check)
test("a recording opened beside Cursor's Agent chat that takes the keyboard back right after the first group's focus is arranged without a manual click", async (context) => {
  // Arrange
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.takesKeyboardBackFromFirstGroupBesideChat()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    // The learner's front tab of the source group is another file than the captured source, as in the N60 take.
    harness.focusMutableDraft('auth.ts', 2)
    chat.focusTab()
    await harness.reader.readPresentationState()
    const commandsBefore = harness.commands.length

    // Act
    harness.controller.command({
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    enableFakeClock(context)
    await advanceClockUntil(
      context,
      () => harness.controller.state().readiness !== 'loading',
      6_000,
    )
    resetFakeClock(context)
    await harness.controller.settle()

    // Assert
    const opened = await harness.reader.readPresentationState()
    assert.equal(harness.controller.state().reason, undefined)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(opened.state, 'open')
    assert.equal(opened.layoutConfirmed, true)
    assert.equal(opened.panes.appColumn, 1)
    assert.equal(chat.focused(), true)
    assert.equal(
      harness.commands.slice(commandsBefore).filter(isKeyboardCommand).at(-1),
      'composer.focusComposer',
    )
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

// protects=a replay opened beside Cursor's Agent chat whose focus is taken back right after the first group's focus command while the learner moves to their own tab in the first group before the command answers: the learner's tab keeps the keyboard and the open is refused as a learner change; fails_when=the pane's moment of reported focus (the latch) is taken for the main editor's focus report and the arrangement goes on over the learner's tab, or the refusal reads "did not report the keyboard focus within 5 s"; no_claim=the real Cursor's event order for that click
test("a recording opened beside Cursor's Agent chat is refused as a learner change when the learner moves to their own tab while the pane's focus was reported for a moment", async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.takesKeyboardBackFromFirstGroupBesideChat()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    harness.focusMutableDraft('auth.ts', 2)
    chat.focusTab()
    await harness.reader.readPresentationState()
    const focus = harness.holdNextPrimaryFocusResponse()

    // Act: the first group's focus command has been applied (the pane reported itself active) and its answer is held while the learner opens their own tab in the first group.
    harness.controller.command({
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await focus.started
    const learnerTab = harness.addOpaqueTab('Cursor Settings', 1)
    harness.focusOpaqueTab(learnerTab)
    focus.release()
    await harness.controller.settle()

    // Assert
    const refused = await harness.reader.readPresentationState()
    assert.equal(refused.layoutConfirmed, false)
    assert.equal(harness.controller.state().readiness, 'failed')
    // The refusal names the learner's newer focus, the learner-change reason.
    assert.match(
      harness.controller.state().reason ?? '',
      /The primary editor selection changed during scope measurement; the newer learner focus was preserved\./,
    )
    assert.doesNotMatch(
      harness.controller.state().reason ?? '',
      /did not report the keyboard focus/,
    )
    // The learner's tab stays in front of the first group: the arrangement did not go on over it.
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 1)?.activeTab,
      learnerTab,
    )
  } finally {
    await harness.close()
  }
})

// protects=a main editor measurement refused before the first group is focused (the learner left, or a borrow is pending) beside Cursor's Agent chat: the pane view-state watches of the unreported-focus latch are not registered, so no listener stays on the Application or Study pane; fails_when=the watches are created before that refusal and never disposed (the listener count stays above its start); no_claim=the disposal of the watches after a wait that ran
test("a main editor measurement refused before the first group is focused leaves no view-state listener on the Codebook panes beside Cursor's chat", async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    // The learner's front tab of the source group is another file than the captured source, so no captured source is borrowed.
    harness.focusMutableDraft('auth.ts', 2)
    chat.focusTab()
    await harness.reader.readPresentationState()
    const listenersBefore = harness.focusListenerCount()

    // Act
    await assert.rejects(
      readerSeams(harness).measureMainEditorGridRefusedBeforeFocus(),
      { message: 'refused before the focus command' },
    )

    // Assert
    assert.equal(harness.focusListenerCount(), listenersBefore)
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's replay opened from Cursor's chat while the Study workspace is open: the recording is read, its two panes are arranged and confirmed, and the chat has the keyboard again; fails_when=the entry measures the main editor by focusing its first group, which shows the Application pane, Cursor reports no focus of a pane beside the chat, the wait ends after five seconds and the recording fails to load with "The Codebook panes were not arranged: the main editor did not report the keyboard focus within 5 s …"; why_new=Cycle 0045 cause 12 (e), second native result (obs15 R: `codebook_playback` open made with the caret in the chat on the three-pane layout; 3.7 s later the state read open, unconfirmed, "The native editor layout receipt no longer matches the Study panes. …", and the recording was never read); seam=the recorded reader harness with a separate editor part whose group the editor names, the fake Cursor's unreported pane focus and stale group name
for (const named of ["the chat's group", 'the captured source'] as const)
  test(`a recording opened from Cursor's chat while the Study workspace is open is arranged and confirmed, and the chat gets the keyboard back, while the editor names ${named}`, async () => {
    // Arrange: the three Study panes are open (the Application pane is the tab the first group shows) and the chat has the keyboard. The editor names the chat's group after a click on the chat's tab; after a selection made from the chat input it names the captured source in group 2 without an active text editor, which is the state of the trace.
    const harness = await recordedReaderHarness()
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    try {
      const original = harness.focusMutableDraft('actions.ts', 1)
      if (named === "the chat's group") {
        await harness.reader.open()
        chat.focusTab()
      } else {
        chat.focus()
        const closed = harness.reader.presentationState()
        await harness.reader.changePresentation({
          presentationId: closed.presentationId,
          expectedRevision: closed.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        })
      }
      const before = await harness.reader.readPresentationState(),
        namedBefore = harness.editor.window.tabGroups.activeTabGroup,
        stateBefore = {
          namesChatGroup: namedBefore.tabs.includes(chat.tab),
          namedColumn: namedBefore.viewColumn,
          hasActiveTextEditor:
            harness.editor.window.activeTextEditor !== undefined,
          chatHasKeyboard: chat.focused(),
        },
        commandsBefore = harness.commands.length
      // Act
      harness.controller.command({
        studyId: harness.studyId,
        action: 'open',
        expectedRevision: harness.controller.state().revision,
      })
      await harness.controller.settle()
      // Assert
      const opened = await harness.reader.readPresentationState()
      assert.deepEqual(
        stateBefore,
        named === "the chat's group"
          ? {
              namesChatGroup: true,
              namedColumn: 4,
              hasActiveTextEditor: false,
              chatHasKeyboard: true,
            }
          : {
              namesChatGroup: false,
              namedColumn: 2,
              hasActiveTextEditor: false,
              chatHasKeyboard: true,
            },
      )
      assert.equal(before.layoutConfirmed, true)
      assert.equal(before.panes.contextColumn, 3)
      assert.equal(
        harness.controller.state().readiness,
        'ready',
        harness.controller.state().reason,
      )
      assert.equal(harness.controller.state().reason, undefined)
      assert.equal(opened.state, 'open')
      assert.equal(opened.reader.contentTab, 'recording')
      assert.equal(opened.layoutConfirmed, true)
      assert.equal(opened.reason, undefined)
      assert.equal(opened.panes.appColumn, 1)
      assert.equal(opened.panes.sourceColumn, 2)
      assert.equal(opened.panes.contextColumn, undefined)
      // Dedicated App preparation retains both original main groups and the auxiliary chat.
      assert.deepEqual(
        harness.groups.map((group) => [group.viewColumn, group.tabs.length]),
        [
          [1, 1],
          [2, 3],
          [3, 0],
          [4, 1],
        ],
      )
      // Explicit reservation may borrow native source, then returns input through Cursor's own chat command.
      assert.equal(
        harness.commands.slice(commandsBefore).filter(isKeyboardCommand).at(-1),
        'composer.focusComposer',
      )
      assert.equal(harness.groups[1]!.tabs.includes(original.tab), true)
      assert.equal(original.document.getText(), 'Original learner draft.\n')
      assert.equal(original.tab.isDirty, true)
      assert.equal(chat.focused(), true)
    } finally {
      await harness.close()
    }
  })

// Value: protects=a repeated selection on a reader whose recording layout is confirmed answering confirmed without arranging, measuring by focus or focusing anything; fails_when=the selection runs the whole arrangement again (the expand command, the grid, a focus hand-over), which in Cursor ended with "The learner changed native tab focus while the Study layout command was pending. The newer choice was preserved." although nobody touched the window; why_new=Cycle 0045 cause 12 (e) (obs15 P4, third select); seam=the recorded reader harness and its command log
test('a repeated selection on the confirmed layout of a recording answers confirmed and runs no layout or focus command', async () => {
  // Arrange: the reader shows a recording in its two confirmed panes; the keyboard is in the captured source.
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const confirmed = await harness.reader.readPresentationState(),
      commandsBefore = harness.commands.length
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: confirmed.presentationId,
      expectedRevision: confirmed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(confirmed.layoutConfirmed, true)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(
      selected.presentationControlRevision,
      confirmed.presentationControlRevision,
    )
    // One layout read, as a status read makes it; nothing was expanded, applied or focused.
    assert.deepEqual(harness.commands.slice(commandsBefore), [
      'vscode.getEditorLayout',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the reason of a refused presentation change leaving the state once the layout is confirmed; fails_when=a status read answers layoutConfirmed true beside the sentence of an earlier refusal, which an agent relays as the current state; why_new=Cycle 0045 cause 12 (e) (obs15 P4: state open, layoutConfirmed true and reason "Error: The live Study layout could not be confirmed after Restore." two seconds after a refused select); seam=workspace harness, addOpaqueTab
test('the reason of a refused selection is gone from the presentation state once the layout is confirmed', async () => {
  // Arrange: a selection was refused for an image the learner opened by a single click (a preview Codebook cannot keep); the learner then keeps that tab open and opens the Study workspace.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const image = harness.addOpaqueTab('logo.png', 1)
    image.isPreview = true
    const closed = harness.reader.presentationState()
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: closed.presentationId,
        expectedRevision: closed.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      }),
    )
    const refused = harness.reader.presentationState()
    image.isPreview = false
    // Act
    await harness.reader.open()
    // Assert
    const opened = await harness.reader.readPresentationState()
    assert.equal(
      refused.reason,
      'Error: A destination group contains a foreign preview: "logo.png" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
    )
    assert.equal(opened.layoutConfirmed, true)
    assert.equal(opened.reason, undefined)
  } finally {
    await harness.close()
  }
})
