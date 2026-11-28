import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import {
  readerSeams,
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import {
  advanceClock,
  advanceClockUntil,
  advanceClockUntilSettled,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'

// Value: protects=the record of the groups a Study Open created beside the learner's one group, without any reservation of the Application's group (the Application shares the learner's group); fails_when=only a reservation starts the record, so the created Source and Context groups a reload leaves empty are never named, or the created Source group is left out; why_new=Cycle 0046 finding 599 (observations 1 and 2 of its first repair: no record without a reservation, and the created Source group unnamed); seam=applicationGroupMarkers
test('a Study Open without an Application reservation records the Source and Context groups it created at the layout it confirmed', async () => {
  // Arrange: the learner has one editor group; the Application will share it.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    // Act
    await harness.reader.open()

    // Assert: the Source group at column 2 and the Context group at column 3, in the confirmed three-group Study grid, written by this reader.
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      {
        ...marker,
        writer:
          marker?.writer === harness.reader['applicationGroupMarkerWriter'],
      },
      {
        version: 2,
        writer: true,
        columns: [2, 3],
        groupCount: 3,
        layout: {
          orientation: 0,
          groups: [
            { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 0.45 },
          ],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

for (const editor of [
  { keeps: 'keeps', removesEmptiedGroups: false },
  { keeps: 'removes', removesEmptiedGroups: true },
] as const)
  // Value: protects=a cold Study select after a window reload of a Study Open that created the Source and Context groups beside the learner's group: the restored captured source stands alone in the Source group, the Context group is empty; fails_when=the cold entry closes the restored captured source first, so an editor that removes emptied groups (workbench.editor.closeEmptyGroups on) shrinks the grid and the Context group can no longer be proved, or the Source group an editor keeps stays empty; why_new=Cycle 0046 finding 599 (observation 2 of its first repair); seam=applicationGroupMarkers (the record of the window before the reload), leaveEmptyGroup, restoreLeftoverCapturedSource and closeDisposedPanelTabsLater for the editor that removes emptied groups
  test(`a cold Study select after a reload retires the recorded Source group with its restored captured source and the empty Context group, in an editor that ${editor.keeps} emptied groups`, async () => {
    // Arrange: the window before the reload recorded its Source group at column 2 and its Context group at column 3; after the reload the learner's file stands in column 1, the captured source is restored without an editor in column 2, and column 3 is empty.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 0.55, groups: [{}, {}] }, { size: 0.45 }],
    })
    if (editor.removesEmptiedGroups) harness.closeDisposedPanelTabsLater()
    try {
      harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
        version: 2,
        writer: 'the window before the reload',
        columns: [2, 3],
        groupCount: 3,
        layout: {
          orientation: 0,
          groups: [
            { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 0.45 },
          ],
        },
      })
      harness.leaveEmptyGroup(2)
      const restoredSource = harness.restoreLeftoverCapturedSource({
        column: 2,
        active: false,
      })
      const sourceLeftover = harness.groups.find(
          (group) => group.viewColumn === 2,
        )!,
        contextLeftover = harness.groups.find(
          (group) => group.viewColumn === 3,
        )!,
        learnersGroup = harness.groups.find((group) => group.viewColumn === 1)!
      const learnersTabs = [...learnersGroup.tabs]
      const state = harness.reader.presentationState()

      // Act
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })

      // Assert: both leftovers and the restored captured source are gone, the learner's file keeps its group, and the earlier window's record is replaced by this window's own.
      assert.equal(harness.groups.includes(sourceLeftover), false)
      assert.equal(harness.groups.includes(contextLeftover), false)
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(restoredSource)),
        false,
      )
      assert.equal(
        learnersTabs.every((tab) => learnersGroup.tabs.includes(tab)),
        true,
      )
      assert.notEqual(
        (
          harness.applicationGroupMarkers.get(
            'codebook.applicationGroup.v1',
          ) as { writer?: unknown } | undefined
        )?.writer,
        'the window before the reload',
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=a cold Study select after a window reload whose focused tab is the earlier session's restored captured source, in an editor that removes emptied groups (workbench.editor.closeEmptyGroups on, the default); fails_when=the selection closes that leftover tab before the recorded leftovers are retired, the editor removes the Source group with it, the grid no longer equals the record, and the Application's and Context's leftovers stay unproven (row 590's failure); why_new=Cycle 0046 row 608; seam=applicationGroupMarkers (the record of the window before the reload), leaveEmptyLockedGroup, leaveEmptyGroup, restoreLeftoverCapturedSource (focused) and closeDisposedPanelTabsLater
test('a cold Study select after a reload with the restored captured source focused retires every recorded leftover before that tab closes, and Close gives the learner’s group back', async () => {
  // Arrange: the window before the reload recorded its Application group at column 1, its Source group at column 3 and its Context group at column 4; after the reload the learner's notes stand in column 2, the restored captured source has the keyboard in column 3, and the editor removes a group its last tab left.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}, {}] })
  harness.closeDisposedPanelTabsLater()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 2,
      writer: 'the window before the reload',
      columns: [1, 3, 4],
      groupCount: 4,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    const restoredSource = harness.restoreLeftoverCapturedSource({ column: 3 })
    const [applicationLeftover, , sourceLeftover, contextLeftover] =
      harness.groups
    const state = harness.reader.presentationState()

    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the three leftovers and the restored captured source are gone before any pane is placed, and the Application stands in column 1 beside the learner's notes with the layout confirmed.
    const leftoversAfterSelect = [
      applicationLeftover,
      sourceLeftover,
      contextLeftover,
    ].filter((group) => harness.groups.includes(group!))
    assert.deepEqual(leftoversAfterSelect, [])
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(restoredSource)),
      false,
    )
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.layoutConfirmed, true)
    // Close then gives the learner's group back, alone with its notes.
    await harness.reader.close()
    assert.deepEqual(
      harness.groups.map((group) => group.tabs),
      [[learnerNotes.tab]],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard and the recorded leftovers at a cold Study select made from Cursor's chat after an extension-host restart left a dead Study pane in the earlier window's Context group, in an editor that removes emptied groups; fails_when=the selection closes the dead pane before the leftovers are retired, so the grid shrinks and nothing is proved, or the retirement's focus commands take the keyboard from the chat before the selection captured it, so the chat does not get it back; why_new=Cycle 0046 row 608; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, leaveDeadCodebookPane, addSeparateEditorPart with the chat's focusTab, and closeDisposedPanelTabsLater
test('a cold Study select from the chat beside a dead pane in a recorded group retires the recorded leftovers first and gives the chat its keyboard back', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 and its Context group at column 3; the old host's Study pane is left dead in column 3, the learner's notes stand in column 2, and the chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  harness.closeDisposedPanelTabsLater()
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 2,
      writer: 'the window before the reload',
      columns: [1, 3],
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    const deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    chat.focusTab()
    const state = harness.reader.presentationState()

    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: both leftovers and the dead pane are gone, the Application stands in column 1 with the layout confirmed, and the chat has the keyboard again.
    assert.equal(harness.groups.includes(applicationLeftover), false)
    assert.equal(harness.groups.includes(contextLeftover), false)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(deadStudy)),
      false,
    )
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold Study select in Cursor after a reload, where a dead pane of the earlier host that the editor will not close stands in a learner's group beside the earlier window's recorded leftover: the leftover's retirement makes Cursor build every tab object anew, and the selection still ends with the instruction to close the dead pane before any panel exists; fails_when=the close after the retirement requests and counts the tab objects read before it, which are in no group any more, so the dead pane is never requested, is counted as closed, and the Study opens beside it (Cycle 0046 OCR1-1); why_new=Cycle 0046 OCR1-1; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, leaveDeadCodebookPane with refuseClose, focusMutableDraft, replaceGroupObjectsOnTabChanges and rebuildTabObjectsAtGroupRemoval (Cursor's new tab objects after a removed group), counts and harness.groups
test('in Cursor, a cold Study select after a reload that retired the earlier window’s leftover group still refuses beside a dead pane the editor keeps, though the retirement made every tab object new', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked; the old host's Repository Wiki pane, which the editor will not close, is left dead in column 2 behind the learner's notes, which have the keyboard. The editor is Cursor: a removed group brings new group and tab objects.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.replaceGroupObjectsOnTabChanges()
  harness.rebuildTabObjectsAtGroupRemoval()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.leaveDeadCodebookPane('codebook.repositoryWiki', 2, {
      refuseClose: true,
    })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const state = harness.reader.presentationState()

    // Act
    const answer = await harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        () => 'selected',
        (error: unknown) => (error instanceof Error ? error.message : error),
      )

    // Assert: the leftover group is gone, the selection tells the learner to close the dead pane, no panel was created, and the dead pane is still the one tab of the Repository Wiki.
    assert.deepEqual(
      {
        answer,
        groupCount: harness.groups.length,
        panels: harness.counts().panels,
        deadWikiTabs: harness.groups
          .flatMap((group) => group.tabs)
          .filter((tab) => tab.label === 'codebook · Repository Wiki').length,
      },
      {
        answer:
          'A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        groupCount: 1,
        panels: 0,
        deadWikiTabs: 1,
      },
    )
  } finally {
    harness.acceptDeadPaneClose()
    await harness.close()
  }
})

// Value: protects=the chat's keyboard when an agent's cold Study select in Cursor after a reload ends because the editor refuses to close the earlier window's leftover group: the proof focused that group before the close, so the chat gets its keyboard back before the refusal reaches the agent, and the learner is told once why, without saying that the groups closed; fails_when=the proof's fact that it took the keyboard is lost with the throw, so the selection gives nothing back and tells nothing, and the keyboard stays in the leftover group (Cycle 0046 OCR1-2); why_new=Cycle 0046 OCR1-2; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, refuseNextGroupClose, the reader's changePresentation for an agent, the command log and the information messages
test('in Cursor, an agent’s cold Study select from the chat whose leftover group the editor refuses to close gives the chat its keyboard back and says once that Codebook could not close the groups', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked beside the learner's notes; Cursor's chat has the keyboard, and the editor will refuse to close the leftover group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()
    harness.refuseNextGroupClose()
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    const answer = await harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      .then(
        () => 'selected',
        (error: unknown) => String(error),
      )

    // Assert: the selection is refused, the proof focused the leftover and Focus Agent gave the chat its keyboard back, and the learner is told once that the groups could not be closed.
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter(
            (command) =>
              command.startsWith('workbench.action.focus') ||
              command === 'composer.focusComposer',
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        answer:
          'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook gave the keyboard back to the chat after it could not close the editor groups an earlier window had left: proving them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard when an agent's cold Study select in Cursor after a reload meets a dead pane of the earlier host, so the selection closes the leftover tabs itself, and the editor refuses to close the earlier window's leftover group: the proof focused that group before the close, so the chat gets its keyboard back before the refusal reaches the agent, and the learner is told once why; fails_when=the close of the leftover tabs throws with the proof's fact that it took the keyboard, so the selection's own give-back after that close never runs (Cycle 0046 OCR1-2); why_new=Cycle 0046 OCR1-2; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, leaveDeadCodebookPane, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, refuseNextGroupClose, the reader's changePresentation for an agent and the information messages
test('in Cursor, an agent’s cold Study select from the chat beside a dead pane, whose leftover group the editor refuses to close, gives the chat its keyboard back and says once that Codebook could not close the groups', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked; the old host's Repository Wiki pane is left dead in column 2 behind the learner's notes; Cursor's chat has the keyboard, and the editor will refuse to close the leftover group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.leaveDeadCodebookPane('codebook.repositoryWiki', 2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()
    harness.refuseNextGroupClose()
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    const answer = await harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      .then(
        () => 'selected',
        (error: unknown) => String(error),
      )

    // Assert: the selection reports the refused close, the chat has the keyboard again, and the learner is told once that the groups could not be closed.
    assert.deepEqual(
      {
        answer,
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        chatHasKeyboard: true,
        messages: [
          'Codebook gave the keyboard back to the chat after it could not close the editor groups an earlier window had left: proving them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard when an agent's first run in Cursor after a reload, before any Study select, fails because the editor refuses to close the earlier window's leftover group: the proof focused that group before the close, so the chat gets its keyboard back before the preparation's refusal reaches the run, and the learner is told once why; fails_when=the retirement before the preparation loses the fact that its proof took the keyboard with the throw, so no return is owed and the keyboard stays in the leftover group without a word (Cycle 0046 OCR1-2); why_new=Cycle 0046 OCR1-2; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, refuseNextGroupClose, presentation.createViewport (the MCP-first preparation) and the information messages
test('in Cursor, the first Application preparation of a reloaded window whose leftover group the editor refuses to close gives the chat its keyboard back before the run fails', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked beside the learner's notes; Cursor's chat has the keyboard, and the editor will refuse to close the leftover group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()
    harness.refuseNextGroupClose()

    // Act
    let answer: string
    try {
      const viewport = await harness.reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      )
      viewport.close()
      answer = 'prepared'
    } catch (error) {
      answer = String(error)
    }

    // Assert: the run's preparation reports the refused close, the chat has the keyboard again, and the learner is told once that the groups could not be closed.
    assert.deepEqual(
      {
        answer,
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        chatHasKeyboard: true,
        messages: [
          'Codebook gave the keyboard back to the chat after it could not close the editor groups an earlier window had left: proving them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload meets an empty group at the column the earlier window recorded, in a grid the learner resized since, so the record proves nothing: the proof that focused that group gives the learner's file its keyboard back at once, and the record stays, as a failed proof forgets nothing (finding 599); fails_when=the failed proof leaves the keyboard in the empty group (its caller gives a keyboard back only to a chat), and since the record stays, every later cold entry takes the keyboard from the learner's file the same way (Cycle 0046 CR5-4); why_new=Cycle 0046 CR5-4; seam=useNativeLayout (three columns the learner resized), applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, the reader's open, the command log
test('a cold Study open after a reload whose resized grid no longer proves the earlier window’s record gives the learner’s file its keyboard back right after the proof', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of three equal columns; after the reload that group stands empty and locked, the learner widened the second column, and the learner's notes there have the keyboard beside auth.ts in the third.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 300 }, { size: 600 }, { size: 300 }],
  })
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
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('learner-notes.ts', 2)
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.open()

    // Assert: the proof focused the empty group, and the second group's focus command gave the notes their keyboard back right after it; the earlier window's record stays for a later proof.
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      {
        firstFocusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => command.startsWith('workbench.action.focus'))
          .slice(0, 2),
        earlierRecordKept: marker?.writer === 'the window before the reload',
      },
      {
        firstFocusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusSecondEditorGroup',
        ],
        earlierRecordKept: true,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group and the editor then refuses to close it: the proof's focus command took the keyboard from the learner's notes, and the notes get it back before the refusal reaches the learner, as after a proof that failed without a throw; fails_when=only the path without an exception gives a text editor its keyboard back, and the chat's give-back the throw runs is none while a text editor had the keyboard, so the keyboard stays in the unlocked leftover group (Cycle 0046 P2CR-1); why_new=Cycle 0046 P2CR-1; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, refuseNextGroupClose, the reader's open, the command log and the active text editor
test('a cold Study open after a reload whose leftover group the editor refuses to close gives the learner’s file its keyboard back before the refusal', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands empty and locked beside the learner's notes, which have the keyboard, and the editor will refuse to close the leftover group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.refuseNextGroupClose()
    const commandsBefore = harness.commands.length

    // Act
    const answer = await harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )

    // Assert: the open reports the refused close, the proof focused the leftover group, and the second group's focus command gave the notes their keyboard back right after it.
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusSecondEditorGroup',
        ],
        keyboardEditor: { name: 'learner-notes.ts', column: 2 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, the learner clicks into a file of a third group while the editor's answer to the group's close is pending, and the editor then refuses the close: the file the learner clicked into keeps the keyboard; fails_when=the give-back after a proof that threw checks only that the notes it took the keyboard from are still in front of their group, so the second group's focus command takes the keyboard from the file the learner moved to (Cycle 0047 row 44); why_new=Cycle 0047 row 44 (P3dCR-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft and its focus, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active text editor; no_claim=a move to the terminal or a view, which the editor does not report
test('a cold Study open after a reload whose leftover group the editor refuses to close leaves the keyboard in the file the learner clicked into while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of three equal columns; after the reload that group stands empty and locked, the learner's notes in the second group have the keyboard beside auth.ts in the third, and the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
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
    const authFile = harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: the learner clicks into auth.ts while the editor's answer to the close is pending.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    authFile.focus()
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, no focus command ran after the learner's click, and auth.ts keeps the keyboard.
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        keyboardEditor: { name: 'auth.ts', column: 3 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, the learner focuses a page that is no text editor in a third group while the editor's answer to the group's close is pending, and the editor then refuses the close: that page keeps the keyboard; fails_when=the give-back after a proof that threw reads no change of the named group, so the second group's focus command takes the keyboard from the page the learner moved to, where no text editor reports the move (Cycle 0047 row 44); why_new=Cycle 0047 row 44 (P3dCR-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addOpaqueTab, focusOpaqueTab, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active tab group; no_claim=a move to the terminal or a view, which the editor does not report
test('a cold Study open after a reload whose leftover group the editor refuses to close leaves the keyboard on the page the learner focused in another group while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of three equal columns; after the reload that group stands empty and locked, the learner's notes in the second group have the keyboard, an extension page stands in the third, and the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
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
    const extensionPage = harness.addOpaqueTab('Extension page', 3)
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: the learner clicks the extension page's tab while the editor's answer to the close is pending.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.focusOpaqueTab(extensionPage)
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, no focus command ran after the learner's click, and the third group with the extension page in front is still the active one.
    const activeGroup = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        activeGroup: {
          column: activeGroup.viewColumn,
          tab: activeGroup.activeTab?.label,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        activeGroup: { column: 3, tab: 'Extension page' },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, which still shows the earlier session's restored captured sources, the learner selects another of those captured sources in that group while the editor's answer to the group's close is pending, and the editor then refuses the close: the captured source the learner selected keeps the keyboard; fails_when=the give-back takes no captured source for a move of the learner's, so a selection in a group the proof may name (the leftover's own, or the one named before the proof) is not seen and the second group's focus command takes the keyboard from it (Cycle 0047 row 99); why_new=Cycle 0047 row 99 (CR1-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, restoreLeftoverCapturedSource, focusMutableDraft, focusOpaqueTab, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active text editor; no_claim=a move to the terminal or a view, which the editor does not report
test('a cold Study open after a reload whose leftover group the editor refuses to close leaves the keyboard in the captured source the learner selected in that group while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's restored captured sources, Captured-login-form.tsx in front without a text editor and Captured-auth-form.tsx behind it, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.restoreLeftoverCapturedSource({ column: 1 })
    const authSource = harness.restoreLeftoverCapturedSource({
      column: 1,
      file: 'Captured-auth-form.tsx',
      active: false,
      textEditor: true,
    })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: the learner selects Captured-auth-form.tsx in the leftover group while the editor's answer to the close is pending.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.focusOpaqueTab(authSource)
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, no focus command ran after the learner's click, and Captured-auth-form.tsx keeps the keyboard.
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        keyboardEditor: { name: 'Captured-auth-form.tsx', column: 1 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, the editor comes to show that group's restored captured source in a text editor while the group has the keyboard and its close is pending, and the editor then refuses the close: the learner's notes get the keyboard back, since the learner did not move; fails_when=every captured source that has the keyboard counts as a move of the learner's, also the one the focused leftover itself shows in front, so nothing is given back and the keyboard stays in the leftover group the editor did not close (Cycle 0047 row 99, the limit of its fix); why_new=Cycle 0047 row 99 (CR1-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, restoreLeftoverCapturedSource, resolveRestoredCapturedSource, focusMutableDraft, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active text editor; no_claim=whether and when an editor shows a restored captured source in a text editor by itself (no native trace)
test('a cold Study open after a reload whose leftover group comes to show its restored captured source while the close is pending, and is refused the close, gives the learner’s file its keyboard back', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's restored captured source in front, without a text editor, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    const restoredSource = harness.restoreLeftoverCapturedSource({ column: 1 })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: while the close is pending, the editor shows the leftover's restored captured source in a text editor, in the group that has the keyboard.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.resolveRestoredCapturedSource(restoredSource)
    const shownByTheLeftover =
      harness.editor.window.activeTextEditor?.document.uri.path
        .split('/')
        .at(-1)
    const commandsWhileTheCloseWasPending = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, the second group's focus command gave the notes their keyboard back after it, and the notes have it.
    assert.deepEqual(
      {
        shownByTheLeftover,
        answer,
        focusCommands: harness.commands
          .slice(commandsWhileTheCloseWasPending)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        shownByTheLeftover: 'Captured-login-form.tsx',
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: ['workbench.action.focusSecondEditorGroup'],
        keyboardEditor: { name: 'learner-notes.ts', column: 2 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, which still shows the earlier session's restored captured source in front of its dead Application pane, the learner selects that pane's tab in the group while the editor's answer to the group's close is pending, and the editor then refuses the close: the pane keeps the keyboard; fails_when=the give-back reads the learner's move only from the active text editor and the group the editor names, so a page that is no text editor selected in the proof's own group (no active text editor, a group the proof named) is not seen and the second group's focus command takes the keyboard from it (Cycle 0047 row 128, CR2-1); why_new=Cycle 0047 row 128 (CR2-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveDeadCodebookPane, restoreLeftoverCapturedSource, focusMutableDraft, focusOpaqueTab, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active tab group; no_claim=a move to the terminal or a view, which the editor does not report
test('a cold Study open after a reload whose leftover group the editor refuses to close leaves the keyboard on the page the learner selected in that group while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's dead Application pane and its restored captured source in front of it, without a text editor, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
    )
    harness.restoreLeftoverCapturedSource({ column: 1 })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: the learner selects the dead Application pane's tab in the leftover group while the editor's answer to the close is pending.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.focusOpaqueTab(deadApplication)
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, no focus command ran after the learner's click, and the leftover group with the pane in front is still the active one.
    const activeGroup = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        activeGroup: {
          column: activeGroup.viewColumn,
          tab: activeGroup.activeTab?.label,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        activeGroup: { column: 1, tab: 'codebook · Application' },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, the editor comes to show the restored captured source in front of it in a text editor, the learner then selects another restored captured source of that group while the close is pending, the editor goes on reporting the first one's text editor as the active one, and the editor then refuses the close: the captured source the learner selected keeps the keyboard; fails_when=the give-back takes the stale active text editor, which shows the captured source the proof's group had in front, for no move, so the selection is not seen and the second group's focus command takes the keyboard from it (Cycle 0047 row 128, CR2-1); why_new=Cycle 0047 row 128 (CR2-1); seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, restoreLeftoverCapturedSource, resolveRestoredCapturedSource, retainActiveTextEditorReport, focusMutableDraft, focusOpaqueTab, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active tab group; no_claim=how long a real editor's report lags (no native trace)
test('a cold Study open after a reload whose leftover group the editor refuses to close leaves the keyboard in the captured source the learner selected in that group while the editor still reported the one in front before', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's restored captured sources, Captured-login-form.tsx in front and Captured-auth-form.tsx behind it, both without a text editor, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    const loginSource = harness.restoreLeftoverCapturedSource({ column: 1 })
    const authSource = harness.restoreLeftoverCapturedSource({
      column: 1,
      file: 'Captured-auth-form.tsx',
      active: false,
    })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: while the close is pending, the editor shows Captured-login-form.tsx in a text editor, and the learner selects Captured-auth-form.tsx while the editor still reports that text editor as the active one.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.resolveRestoredCapturedSource(loginSource)
    const endStaleReport = harness.retainActiveTextEditorReport()
    harness.focusOpaqueTab(authSource)
    const reportedAfterTheLearnersClick =
      harness.editor.window.activeTextEditor?.document.uri.path
        .split('/')
        .at(-1)
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening
    endStaleReport()

    // Assert: the editor still reported Captured-login-form.tsx, the open reports the refused close, no focus command ran after the learner's click, and the leftover group with Captured-auth-form.tsx in front is still the active one.
    const activeGroup = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        reportedAfterTheLearnersClick,
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        activeGroup: {
          column: activeGroup.viewColumn,
          tab: activeGroup.activeTab?.label,
        },
      },
      {
        reportedAfterTheLearnersClick: 'Captured-login-form.tsx',
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        activeGroup: { column: 1, tab: 'Captured-auth-form.tsx' },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, which stands empty, the learner opens a page that is no text editor in that group while the editor's answer to the group's close is pending, and the editor then refuses the close: the page keeps the keyboard; fails_when=a group that had no tab at the proof's start counts no tab in front of it now as the learner's move, so the page, which no active text editor reports and which stands in a group the proof named, is not seen and the second group's focus command takes the keyboard from it (Cycle 0047 row 151 (b)); why_new=Cycle 0047 row 151 (P3COV-3 = P3TEST-6): no test reached the empty front of the proof's group; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, focusMutableDraft, addOpaqueTab, focusOpaqueTab, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active tab group; no_claim=a move to the terminal or a view, which the editor does not report
test('a cold Study open after a reload whose empty leftover group the editor refuses to close leaves the keyboard on the page the learner opened in that group while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands empty and locked beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: the learner opens an extension page in the empty leftover group while the editor's answer to the close is pending.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.focusOpaqueTab(harness.addOpaqueTab('Extension page', 1))
    const commandsAfterLearnersClick = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the open reports the refused close, no focus command ran after the learner's click, and the leftover group with the page in front is still the active one.
    const activeGroup = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterLearnersClick)
          .filter((command) => command.startsWith('workbench.action.focus')),
        activeGroup: {
          column: activeGroup.viewColumn,
          tab: activeGroup.activeTab?.label,
        },
      },
      {
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: [],
        activeGroup: { column: 1, tab: 'Extension page' },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, which still shows the earlier session's restored captured source in front of its dead Application pane, that captured source closes while the editor's answer to the group's close is pending, and the editor then refuses the close: the learner's notes get the keyboard back, since the pane came to the front only because the tab before it closed; fails_when=any other tab in front of the proof's group counts as the learner's move, also one that came there because the tab in front left the group, so nothing is given back and the keyboard stays in the leftover group the editor did not close (Cycle 0047 row 151 (c)); why_new=Cycle 0047 row 151 (P3COV-3 = P3TEST-6): no test closed the tab in front of the proof's group; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveDeadCodebookPane, restoreLeftoverCapturedSource, focusMutableDraft, closeTabByHand, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active text editor; no_claim=what closes a restored tab in a real editor while a group close is pending (no native trace)
test('a cold Study open after a reload whose leftover group loses its restored captured source while the close is pending, and is refused the close, gives the learner’s file its keyboard back', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's dead Application pane and its restored captured source in front of it, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveDeadCodebookPane('codebook.scopedBrowser', 1)
    const restoredSource = harness.restoreLeftoverCapturedSource({ column: 1 })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: while the close is pending, the restored captured source closes, and the dead pane behind it comes to the front of the leftover group.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.closeTabByHand(restoredSource)
    const frontAfterTheClose =
      harness.editor.window.tabGroups.activeTabGroup.activeTab?.label
    const commandsWhileTheCloseWasPending = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the pane came to the front, the open reports the refused close, the second group's focus command gave the notes their keyboard back after it, and the notes have it.
    assert.deepEqual(
      {
        frontAfterTheClose,
        answer,
        focusCommands: harness.commands
          .slice(commandsWhileTheCloseWasPending)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        frontAfterTheClose: 'codebook · Application',
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: ['workbench.action.focusSecondEditorGroup'],
        keyboardEditor: { name: 'learner-notes.ts', column: 2 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when a cold Study open after a reload proves the earlier window's leftover group, a page opens in a new group beside without taking the keyboard while the editor's answer to the group's close is pending, and the editor then refuses the close: the learner's notes get the keyboard back, since the keyboard is still where the proof left it; fails_when=a grid that gained or lost a group is taken for the learner's move, so nothing is given back and the keyboard stays in the leftover group the editor did not close (Cycle 0047 row 151 (a)); why_new=Cycle 0047 row 151 (P3COV-3 = P3TEST-6): no test changed the number of groups while the close was pending; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, restoreLeftoverCapturedSource, focusMutableDraft, openPageInNewGroup, holdNextGroupClose, refuseNextGroupClose, the reader's open, the command log and the active text editor; no_claim=which extension opens a page beside while a group close is pending, and a group that came or went left of the proof's column, which moves the proof's group to another column
test('a cold Study open after a reload whose leftover group the editor refuses to close gives the learner’s file its keyboard back when a page opened in a new group beside while the close was pending', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands locked with the earlier session's restored captured source in front, beside the learner's notes, which have the keyboard; the editor holds its answer to the group's close and then refuses it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.restoreLeftoverCapturedSource({ column: 1 })
    harness.focusMutableDraft('learner-notes.ts', 2)
    const groupClose = harness.holdNextGroupClose()
    harness.refuseNextGroupClose()

    // Act: while the close is pending, an extension page opens in a new third group without taking the keyboard.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await groupClose.started
    harness.openPageInNewGroup('Extension page')
    const groupsWhileTheCloseWasPending =
      harness.editor.window.tabGroups.all.length
    const commandsWhileTheCloseWasPending = harness.commands.length
    groupClose.release()
    const answer = await opening

    // Assert: the editor named three groups, the open reports the refused close, the second group's focus command gave the notes their keyboard back after it, and the notes have it.
    assert.deepEqual(
      {
        groupsWhileTheCloseWasPending,
        answer,
        focusCommands: harness.commands
          .slice(commandsWhileTheCloseWasPending)
          .filter((command) => command.startsWith('workbench.action.focus')),
        keyboardEditor: {
          name: harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
          column: harness.editor.window.activeTextEditor?.viewColumn,
        },
      },
      {
        groupsWhileTheCloseWasPending: 3,
        answer:
          'Error: The editor refused to retire the empty Application group an earlier window left.',
        focusCommands: ['workbench.action.focusSecondEditorGroup'],
        keyboardEditor: { name: 'learner-notes.ts', column: 2 },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of whoever owns the window after a cold Study open is cancelled while the proof of the earlier window's leftover group runs its focus command: the cancelled entry gives the learner's file nothing back, since nothing was refused and a newer owner may hold the keyboard; fails_when=the text editor's give-back after a proof that threw runs for every rejection, also the entry's own cancellation, so the cancelled entry runs a group's focus command outside the layout queue it no longer owns (Cycle 0046 P2CR-1 with P2OCR1-1); why_new=Cycle 0046 P2CR-1; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, holdNextCommand('workbench.action.focusFirstEditorGroup'), the entry's AbortController, the reader's open and the command log
test('a cold Study open that is cancelled while the leftover proof focuses the earlier window’s group gives the learner’s file nothing back', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked beside the learner's notes, which have the keyboard; the editor holds the proof's focus command.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
    version: 1,
    writer: 'the window before the reload',
    column: 1,
    groupCount: 2,
    layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
  })
  harness.leaveEmptyLockedGroup(1)
  harness.leaveEmptyGroup(2)
  harness.focusMutableDraft('learner-notes.ts', 2)
  const proofFocus = harness.holdNextCommand(
    'workbench.action.focusFirstEditorGroup',
  )
  const entry = new AbortController()
  try {
    // Act: the entry is cancelled while the proof's focus command runs.
    const opening = harness.reader.open(entry.signal).then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await proofFocus.started
    const commandsAfterProofFocus = harness.commands.length
    entry.abort(new Error('The Study entry was cancelled.'))
    proofFocus.release()
    const answer = await opening

    // Assert: the open reports its cancellation, and the cancelled entry ran no focus command after the proof's.
    assert.deepEqual(
      {
        answer,
        focusCommands: harness.commands
          .slice(commandsAfterProofFocus)
          .filter((command) => command.startsWith('workbench.action.focus')),
      },
      {
        answer: 'Error: The Study entry was cancelled.',
        focusCommands: [],
      },
    )
  } finally {
    proofFocus.release()
    await harness.close()
  }
})

// Value: protects=the keyboard of whoever owns the window after a cold Study open from Cursor's chat is cancelled while the proof of the earlier window's leftover group runs its focus command: the cancelled entry gives the chat nothing back and tells no sentence, since nothing was refused; fails_when=the give-back after a proof that took the keyboard runs for every rejection, also the entry's own cancellation, so the cancelled entry runs Focus Agent outside the layout queue it no longer owns and tells that Codebook could not close the groups (Cycle 0046 P2OCR1-1); why_new=Cycle 0046 P2OCR1-1; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, holdNextCommand('workbench.action.focusFirstEditorGroup'), the entry's AbortController, the reader's open, the command log and the information messages
test('in Cursor, a cold Study open from the chat that is cancelled while the leftover proof focuses the earlier window’s group gives the chat nothing back and tells nothing', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked beside the learner's notes; Cursor's chat has the keyboard, and the editor holds the proof's focus command.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
    version: 1,
    writer: 'the window before the reload',
    column: 1,
    groupCount: 2,
    layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
  })
  harness.leaveEmptyLockedGroup(1)
  harness.leaveEmptyGroup(2)
  harness.focusMutableDraft('learner-notes.ts', 2)
  chat.focusTab()
  const proofFocus = harness.holdNextCommand(
    'workbench.action.focusFirstEditorGroup',
  )
  const entry = new AbortController()
  const messagesBefore = harness.informationMessages.length
  try {
    // Act: the entry is cancelled while the proof's focus command runs.
    const opening = harness.reader.open(entry.signal).then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await proofFocus.started
    const commandsAfterProofFocus = harness.commands.length
    entry.abort(new Error('The Study entry was cancelled.'))
    proofFocus.release()
    const answer = await opening

    // Assert: the open reports its cancellation, and the cancelled entry ran no focus command after the proof's and told nothing.
    assert.deepEqual(
      {
        answer,
        keyboardCommands: harness.commands
          .slice(commandsAfterProofFocus)
          .filter(
            (command) =>
              command === 'composer.focusComposer' ||
              command.startsWith('workbench.action.focus'),
          ),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        answer: 'Error: The Study entry was cancelled.',
        keyboardCommands: [],
        messages: [],
      },
    )
  } finally {
    proofFocus.release()
    await harness.close()
  }
})

// Value: protects=the window after the learner closed the Study workspace while a cold Study open from Cursor's chat ran the proof's focus command for the earlier window's leftover group: the closed reader gives the chat nothing back and tells no sentence; fails_when=the give-back after a proof that took the keyboard runs for the lifetime the Close ended, so the closed reader runs Focus Agent beside the Close's own work and tells that Codebook could not close the groups (Cycle 0046 P2OCR1-1); why_new=Cycle 0046 P2OCR1-1; seam=useNativeLayout, applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, holdNextCommand('workbench.action.focusFirstEditorGroup'), the reader's open and close, the command log and the information messages
test('in Cursor, a cold Study open from the chat whose reader closes while the leftover proof focuses the earlier window’s group runs no Focus Agent after the Close and tells nothing', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, which stands empty and locked beside the learner's notes; Cursor's chat has the keyboard, and the editor holds the proof's focus command.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
    version: 1,
    writer: 'the window before the reload',
    column: 1,
    groupCount: 2,
    layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
  })
  harness.leaveEmptyLockedGroup(1)
  harness.leaveEmptyGroup(2)
  harness.focusMutableDraft('learner-notes.ts', 2)
  chat.focusTab()
  const proofFocus = harness.holdNextCommand(
    'workbench.action.focusFirstEditorGroup',
  )
  const messagesBefore = harness.informationMessages.length
  try {
    // Act: the learner closes the reader while the proof's focus command runs.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await proofFocus.started
    const closing = harness.reader.close()
    const commandsAfterClose = harness.commands.length
    proofFocus.release()
    const answer = await opening
    await closing

    // Assert: the open reports the Close, and the closed reader ran no Focus Agent and told nothing.
    assert.deepEqual(
      {
        answer,
        chatCommands: harness.commands
          .slice(commandsAfterClose)
          .filter((command) => command === 'composer.focusComposer'),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        answer:
          'Error: The study workspace was closed; repeat the action explicitly if needed.',
        chatCommands: [],
        messages: [],
      },
    )
  } finally {
    proofFocus.release()
    await harness.close()
  }
})

// Value: protects=the learner's own Study Application pane when an agent's run prepares its Application while the layout queue is busy and the learner's Open makes that pane outside the queue meanwhile: the run's preparation, refused afterwards by its focus return, retires only what it made itself, so the Open's pane and the Study stay; fails_when=the preparation decides what it made from the pane it saw before it waited for the queue, so the refused focus return disposes the pane the Open made and closes the group it was moved into, and the Open is left without its Application (Cycle 0046 OCR1-7); why_new=Cycle 0046 OCR1-7; seam=the reader's withLayout held by the test (another layout operation in the queue), focusMutableDraft with workInActiveTextEditor and replaceContent (the learner typing during the placement), holdNextCommand on workbench.action.lockEditorGroup, presentation.createViewport (the MCP-first preparation), the reader's open, counts and panelColumn
test('a run’s Application preparation refused by its focus return after it waited for the layout queue leaves the Application pane the learner’s Open made meanwhile', async () => {
  // Arrange: the learner works in notes.ts in the second of two groups; another layout operation holds the queue, so an agent's run's preparation waits for it, and the learner's Open makes the Application pane outside the queue meanwhile.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  let releaseQueue = (): void => {}
  try {
    const notes = harness.focusMutableDraft('notes.ts', 2)
    harness.workInActiveTextEditor('keyboard')
    const queueHeld = harness.reader['withLayout'](
      undefined,
      () =>
        new Promise<void>((resolve) => {
          releaseQueue = resolve
        }),
    )
    const preparing = Promise.resolve(
      harness.reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      ),
    ).then(
      (viewport) => {
        viewport.close()
        return 'prepared'
      },
      (error: unknown) => String(error),
    )
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await waitUntil(
      () => harness.counts().panels > 0,
      'the Open’s Application pane',
      2_000,
    )
    const lock = harness.holdNextCommand('workbench.action.lockEditorGroup')

    // Act: the queue frees; the learner types in notes.ts while the run's new group is locked, so the run's focus return refuses.
    releaseQueue()
    await queueHeld
    await lock.started
    notes.replaceContent('The learner typed during the placement.\n')
    lock.release()
    const preparation = await preparing
    const open = await opening

    // Assert: the run's preparation is refused for the learner's typing, and the Open's Application pane stands in column 1 beside the Study.
    assert.deepEqual(
      {
        preparation,
        open,
        panels: harness.counts().panels,
        applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
      },
      {
        preparation:
          'Error: The previously focused document changed during presentation; its current reading position was preserved.',
        open: 'opened',
        panels: 2,
        applicationColumn: 1,
      },
    )
  } finally {
    releaseQueue()
    await harness.close()
  }
})

// Value: protects=the truth of what the learner is told when an agent's cold Study select in Cursor after a reload, beside a dead pane of the earlier host, checks the empty group at the recorded column in a grid the learner resized since: the proof focused that group and closed nothing, so the chat gets its keyboard back with a sentence that says nothing was closed; fails_when=the selection's give-back after the leftover close tells the sentence of a proof that closed the groups, "Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, …", for a proof that closed none (Cycle 0046 FX-D1-1); why_new=Cycle 0046 FX-D1-1; seam=useNativeLayout (columns the learner resized), applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, leaveDeadCodebookPane, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, the reader's changePresentation for an agent and the information messages
test('in Cursor, an agent’s cold Study select from the chat beside a dead pane, whose resized grid no longer proves the earlier window’s record, gives the chat its keyboard back saying that no group was closed', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands empty and locked, the learner widened the second column, the old host's Repository Wiki pane is left dead there behind the learner's notes, and Cursor's chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 300 }, { size: 600 }],
  })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.leaveDeadCodebookPane('codebook.repositoryWiki', 2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    await harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      .catch(() => undefined)

    // Assert: the first sentence the learner is told says that the check closed no group.
    assert.equal(
      harness.informationMessages[0]?.message,
      'Codebook gave the keyboard back to the chat after it checked the empty editor groups an earlier window may have left and closed none of them: checking them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the truth of what the learner is told when an agent's first run in Cursor after a reload checks the empty group at the recorded column in a grid the learner resized since: the proof focused that group and closed nothing, so the chat's keyboard comes back with a sentence that says nothing was closed; fails_when=the preparation's give-back after the proof tells the sentence of a proof that closed the groups, "Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, …", for a proof that closed none (Cycle 0046 FX-D1-1); why_new=Cycle 0046 FX-D1-1; seam=useNativeLayout (columns the learner resized), applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, focusMutableDraft, addSeparateEditorPart with the chat's focusTab, presentation.createViewport (the MCP-first preparation) and the information messages
test('in Cursor, an agent’s first run after a reload whose resized grid no longer proves the earlier window’s record gives the chat its keyboard back saying that no group was closed', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 of two equal columns; after the reload that group stands empty and locked, the learner widened the second column with the notes, and Cursor's chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 300 }, { size: 600 }],
  })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 2,
      layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()

    // Act
    await Promise.resolve(
      harness.reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      ),
    ).then(
      (viewport) => viewport.close(),
      () => undefined,
    )

    // Assert: the chat has the keyboard again, and the first sentence the learner is told says that the check closed no group.
    assert.deepEqual(
      {
        chatHasKeyboard: chat.focused(),
        firstMessage: harness.informationMessages[0]?.message,
      },
      {
        chatHasKeyboard: true,
        firstMessage:
          'Codebook gave the keyboard back to the chat after it checked the empty editor groups an earlier window may have left and closed none of them: checking them moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an open Study in Cursor beside a dead Study pane of the earlier host that the editor kept: after the learner closes one of their own groups, Cursor builds every tab object anew, and the next selection still knows the kept pane for the earlier host's and names it, while this host's own Study pane stays; fails_when=the note of the dead pane is kept per tab object only, and while this host holds a Study pane of its own the rebuilt dead tab is not noted again, so the selection no longer names the kept pane and is refused for "The Study panes changed during Restore." instead (Cycle 0046 FX-D1-2); why_new=Cycle 0046 FX-D1-2; seam=useNativeLayout with five groups, leaveEmptyGroup, focusMutableDraft, leaveDeadCodebookPane with refuseClose, replaceGroupObjectsOnTabChanges and rebuildTabObjectsAtGroupRemoval (Cursor's new tab objects after a removed group), the editor's tabGroups.close of the learner's group, the reader's open and changePresentation, counts and panelColumn
test('in Cursor, a selection after the learner closed one of their groups still names the earlier host’s dead Study pane the editor kept, though the removal made every tab object new', async () => {
  // Arrange: five groups: the learner's notes, two empty groups, other.ts, the old host's Study pane (which the editor will not close) and scratch.ts; the Study opens beside the kept dead pane, and the learner then closes the group of scratch.ts. The editor is Cursor: a removed group brings new group and tab objects.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}, {}, {}] })
  harness.replaceGroupObjectsOnTabChanges()
  harness.rebuildTabObjectsAtGroupRemoval()
  try {
    harness.leaveEmptyGroup(2)
    harness.leaveEmptyGroup(3)
    harness.focusMutableDraft('other.ts', 3)
    harness.leaveDeadCodebookPane('codebook.studyContext', 4, {
      refuseClose: true,
    })
    harness.focusMutableDraft('scratch.ts', 5)
    harness.focusMutableDraft('notes.ts', 1)
    await harness.reader.open()
    const studyColumnAtOpen = harness.panelColumn('codebook.studyContext')
    const scratchGroup = harness.groups.find((group) =>
      group.tabs.some((tab) => tab.label === 'scratch.ts'),
    )!
    await harness.editor.window.tabGroups.close(scratchGroup, true)
    const state = harness.reader.presentationState()

    // Act
    const answer = await harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        () => 'selected',
        (error: unknown) => String(error),
      )

    // Assert: the selection names the kept dead pane; this host's own Study pane stays in its column beside the dead one.
    assert.deepEqual(
      {
        studyColumnAtOpen,
        answer,
        studyPaneColumn: harness.panelColumn('codebook.studyContext'),
        studyTabColumns: harness.groups
          .filter((group) =>
            group.tabs.some((tab) => tab.label === 'codebook · Study'),
          )
          .map((group) => group.viewColumn),
      },
      {
        studyColumnAtOpen: 3,
        answer:
          'Error: A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        studyPaneColumn: 3,
        studyTabColumns: [3, 4],
      },
    )
  } finally {
    harness.acceptDeadPaneClose()
    await harness.close()
  }
})

// Value: protects=an open Study in Cursor whose own Study pane is named exactly as the dead Study pane of the earlier host (one view type, one title, as the editors name a live and a dead pane alike): after a removed group made every tab object new, the next selection still knows the dead pane, and this host's own pane stays its own; fails_when=the rebuilt tab of this host's own Study pane, in that pane's own column, is taken for a successor of the dead pane's note, so two tabs answer one note and the dead pane is no longer known, or this host's own pane is taken for a dead one (Cycle 0046 FX-D1-2's own-column rule); why_new=the harness names this host's panes without the main-thread prefix of the dead ones, so the FX-D1-2 test passes with that rule removed (second Step 7 audit); seam=as the FX-D1-2 test, and the dead pane's input renamed to the view type this host's own Study pane carries; no_claim=a successor in a column where this host's pane does not stand, which the rule that more successors than notes are none decides (not covered)
test('in Cursor, a selection after the learner closed one of their groups still names the earlier host’s dead Study pane, though this host’s own Study pane carries the same view type and title', async () => {
  // Arrange: as the test above, with the dead Study pane named as this host's own Study pane is named here, so that only its column tells the two apart.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}, {}, {}] })
  harness.replaceGroupObjectsOnTabChanges()
  harness.rebuildTabObjectsAtGroupRemoval()
  try {
    harness.leaveEmptyGroup(2)
    harness.leaveEmptyGroup(3)
    harness.focusMutableDraft('other.ts', 3)
    const deadStudy = harness.leaveDeadCodebookPane(
      'codebook.studyContext',
      4,
      { refuseClose: true },
    )
    deadStudy.input = new harness.editor.TabInputWebview(
      'codebook.studyContext',
    )
    harness.focusMutableDraft('scratch.ts', 5)
    harness.focusMutableDraft('notes.ts', 1)
    await harness.reader.open()
    const studyColumnAtOpen = harness.panelColumn('codebook.studyContext')
    const scratchGroup = harness.groups.find((group) =>
      group.tabs.some((tab) => tab.label === 'scratch.ts'),
    )!
    await harness.editor.window.tabGroups.close(scratchGroup, true)
    const state = harness.reader.presentationState()

    // Act
    const answer = await harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        () => 'selected',
        (error: unknown) => String(error),
      )

    // Assert: the selection names the kept dead pane; this host's own Study pane stays in its column beside the dead one.
    assert.deepEqual(
      {
        studyColumnAtOpen,
        answer,
        studyPaneColumn: harness.panelColumn('codebook.studyContext'),
        studyTabColumns: harness.groups
          .filter((group) =>
            group.tabs.some((tab) => tab.label === 'codebook · Study'),
          )
          .map((group) => group.viewColumn),
      },
      {
        studyColumnAtOpen: 3,
        answer:
          'Error: A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        studyPaneColumn: 3,
        studyTabColumns: [3, 4],
      },
    )
  } finally {
    harness.acceptDeadPaneClose()
    await harness.close()
  }
})

// Value: protects=this host's own Study pane when its panel reports a column other than its tab's group, beside a dead Study pane of the earlier host named exactly as this host's own: after a removed group made every tab object new, the dead pane's one note meets two unnoted Study tabs of its key outside the column the panel reports, so none of them takes the note, and this host's own pane is never taken for a dead one; fails_when=every successor of a vanished key is noted, so this host's own Study pane is noted dead too, and the selection closes it with the earlier host's leftover tabs (Cycle 0046 FX-D1-2's rule that more successors than notes are none); why_new=second Step 7 audit, path 23 (a mutation of that rule passed every Entry, EntryObstacles and Lifecycle test); seam=as the FX-D1-2 test, the dead pane's input renamed to the view type this host's own Study pane carries, and reportPanelColumn (a test-only harness option for a panel whose viewColumn differs from its tab's group) while the selection's admission reads the dead panes; no_claim=whether Cursor reports such a column
test('in Cursor, a selection after a removed group made every tab object new keeps this host’s own Study pane, whose panel reported another column, when a dead Study pane of the same name stands beside it', async () => {
  // Arrange: as the test above, with the dead Study pane named as this host's own Study pane; the learner closes the group of scratch.ts, and Cursor builds every tab object anew.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}, {}, {}] })
  harness.replaceGroupObjectsOnTabChanges()
  harness.rebuildTabObjectsAtGroupRemoval()
  try {
    harness.leaveEmptyGroup(2)
    harness.leaveEmptyGroup(3)
    harness.focusMutableDraft('other.ts', 3)
    const deadStudy = harness.leaveDeadCodebookPane(
      'codebook.studyContext',
      4,
      { refuseClose: true },
    )
    deadStudy.input = new harness.editor.TabInputWebview(
      'codebook.studyContext',
    )
    harness.focusMutableDraft('scratch.ts', 5)
    harness.focusMutableDraft('notes.ts', 1)
    await harness.reader.open()
    const studyColumnAtOpen = harness.panelColumn('codebook.studyContext')
    const scratchGroup = harness.groups.find((group) =>
      group.tabs.some((tab) => tab.label === 'scratch.ts'),
    )!
    await harness.editor.window.tabGroups.close(scratchGroup, true)
    const state = harness.reader.presentationState()

    // Act: the selection's admission reads the dead panes first, while this host's Study panel reports the captured source's column instead of its tab's; the panel reports its own column again right after.
    harness.reportPanelColumn('codebook.studyContext', 2)
    const selecting = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.reportPanelColumn('codebook.studyContext')
    await selecting.catch(() => undefined)

    // Assert: this host's own Study pane still stands in its column, beside the dead one.
    assert.deepEqual(
      {
        studyColumnAtOpen,
        studyPaneColumn: harness.panelColumn('codebook.studyContext'),
        studyTabColumns: harness.groups
          .filter((group) =>
            group.tabs.some((tab) => tab.label === 'codebook · Study'),
          )
          .map((group) => group.viewColumn),
      },
      { studyColumnAtOpen: 3, studyPaneColumn: 3, studyTabColumns: [3, 4] },
    )
  } finally {
    harness.reportPanelColumn('codebook.studyContext')
    harness.acceptDeadPaneClose()
    await harness.close()
  }
})

// Value: protects=the learner's knowledge of why VS Code's chat editor tab has the keyboard again after an agent's cold Study select retired the earlier window's leftover group: the proof focused that group, its removal gave the keyboard to the group before it, and the chat tab's group gets it back through its focus command; the sentence told once names the leftover's close and no pause; fails_when=the leftover proof's give-back tells row 632's pause sentence, "(at a pause, to the paused file the debugger opened)", for a pause that did not happen; why_new=Cycle 0046 row 648; seam=applicationGroupMarkers, leaveEmptyGroup, leaveDeadCodebookPane, focusChatEditorTab (VS Code's TabInputChat), closeDisposedPanelTabsLater, the reader's changePresentation for an agent (codebook_presentation), the command log and the information messages
test('an agent’s cold Study select in VS Code that retires the earlier window’s leftover group while the chat editor tab has the keyboard gives that chat its keyboard back and says once that closing the leftover moved it, naming no pause', async () => {
  // Arrange: the earlier window recorded its Application group at column 1, where the old host's Application pane is left dead; the learner's notes stand in column 2, and VS Code's chat editor tab in column 3 has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  harness.closeDisposedPanelTabsLater()
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
    harness.leaveEmptyGroup(1)
    harness.leaveDeadCodebookPane('codebook.scopedBrowser', 1)
    const applicationLeftover = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    harness.focusChatEditorTab(3)
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    await harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      .catch(() => undefined)

    // Assert: the leftover is gone; the proof focused it, and the chat tab's group, now column 2, was focused by its number once the proof had moved the keyboard; the chat's sentence names the leftover's close and no pause, before the selection's own sentence for the captured source that covers the chat afterwards.
    assert.deepEqual(
      {
        leftoverGone: !harness.groups.includes(applicationLeftover),
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => command.startsWith('workbench.action.focus')),
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        leftoverGone: true,
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusSecondEditorGroup',
        ],
        messages: [
          'Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, which moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
          'Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now: placing the panes needed the focus of the source, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of VS Code's chat editor tab in a group before the earlier window's leftover when an agent's cold Study select retires that leftover: its removal leaves the chat's group at its column, the chat's group gets its keyboard back through its focus command and the leftovers' sentence is told once; fails_when=the return shifts the remembered column by the group count as if the removed group stood before the chat's, finds no group showing the chat at column 0, and gives nothing back, so the captured source takes the keyboard and only its sentence is told; why_new=Cycle 0046 row 648's further finding (the fixer's own); seam=applicationGroupMarkers, leaveEmptyGroup, leaveDeadCodebookPane, focusChatEditorTab (VS Code's TabInputChat), closeDisposedPanelTabsLater, the reader's changePresentation for an agent, the command log and the information messages
test('an agent’s cold Study select in VS Code that retires the earlier window’s leftover group after the chat editor tab’s group gives that chat its keyboard back at its unchanged column and says once that closing the leftover moved it', async () => {
  // Arrange: the earlier window recorded its Application group at column 3, where the old host's Application pane is left dead; the learner's notes stand in column 2, and VS Code's chat editor tab in column 1 has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  harness.closeDisposedPanelTabsLater()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 3,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyGroup(3)
    harness.leaveDeadCodebookPane('codebook.scopedBrowser', 3)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(1)
    harness.focusChatEditorTab(1)
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    await harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      .catch(() => undefined)

    // Assert: the proof focused the leftover at column 3, and the chat tab's group, still column 1, got the keyboard back by its number before the selection went on; the leftovers' sentence was told first.
    assert.deepEqual(
      {
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => command.startsWith('workbench.action.focus'))
          .slice(0, 2),
        firstMessage: harness.informationMessages[0]?.message,
      },
      {
        focusCommands: [
          'workbench.action.focusThirdEditorGroup',
          'workbench.action.focusFirstEditorGroup',
        ],
        firstMessage:
          'Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, which moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's knowledge of where the keyboard is after an agent's cold Study select in Cursor retired the earlier window's leftover groups from the Agent chat: the proofs focused those groups, and Cursor's Focus Agent gave the chat its keyboard back, which Cursor reads the same whether the chat input or the terminal or a view had it (Cursor 3.23.12 17501:84373, 17501:88693, 17264:2840, 17264:3411), so the learner is told once, as at a pause (row 635), with the leftover's own sentence; fails_when=the leftover proof's return to Cursor's chat moves the keyboard into the chat without a word, or tells row 632's pause sentence; why_new=Cycle 0046 row 648 (Cursor's half of the same give-back); seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, leaveDeadCodebookPane, addSeparateEditorPart with the chat's focusTab, closeDisposedPanelTabsLater, the reader's changePresentation for an agent, the command log and the information messages
test('in Cursor, an agent’s cold Study select from the chat that retires the earlier window’s leftover groups gives the chat its keyboard back and says once that closing the leftovers moved it', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 and its Context group at column 3; the old host's Study pane is left dead in column 3, the learner's notes stand in column 2, and the chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  harness.closeDisposedPanelTabsLater()
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 2,
      writer: 'the window before the reload',
      columns: [1, 3],
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    chat.focusTab()
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act: the agent's codebook_presentation select, as the service passes it on.
    const selected = await harness.reader.changePresentation(
      {
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      },
      'agent',
    )

    // Assert: the layout is confirmed, Focus Agent gave the chat its keyboard back after the proofs, and the learner is told once why, with the leftovers' sentence; the selection's own return after its measurement's borrow then tells the arrangement's sentence (rows 647 and 655).
    assert.deepEqual(
      {
        layoutConfirmed: selected.layoutConfirmed,
        chatHasKeyboard: chat.focused(),
        focusAgentRuns: harness.commands
          .slice(commandsBefore)
          .filter((command) => command === 'composer.focusComposer').length,
        messages: harness.informationMessages.map((message) => message.message),
      },
      {
        layoutConfirmed: true,
        chatHasKeyboard: true,
        focusAgentRuns: 2,
        messages: [
          'Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, which moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
          'Codebook placed its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's window when an agent's run prepares the Application right after Developer: Reload Window, before any Study select: the earlier window's recorded leftovers are retired before the new Application group is allocated, and the chat keeps its keyboard; fails_when=the preparation allocates beside the leftovers and writes this window's record over the earlier one, so those empty groups are never proved or retired, or the retirement takes the keyboard from the chat; why_new=Cycle 0046 row 609; seam=applicationGroupMarkers, leaveEmptyLockedGroup, leaveEmptyGroup, presentation.createViewport (the MCP-first preparation) and addSeparateEditorPart with the chat's focusTab
test('the first Application preparation of a reloaded window retires the earlier window’s recorded leftovers before it allocates, and the chat keeps its keyboard', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 and its Context group at column 3; after the reload both stand empty beside the learner's notes in column 2, and the chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 2,
      writer: 'the window before the reload',
      columns: [1, 3],
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    chat.focusTab()

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: both leftovers are gone; the new Application group stands alone and locked in column 1 beside the learner's group, the record is this window's own, and the chat has the keyboard again.
      assert.equal(harness.groups.includes(applicationLeftover), false)
      assert.equal(harness.groups.includes(contextLeftover), false)
      const mainGroups = harness.groups.filter(
        (group) => !group.tabs.includes(chat.tab),
      )
      assert.deepEqual(
        mainGroups.map((group) => ({
          column: group.viewColumn,
          locked: Boolean(group.locked),
          tabs: group.tabs.length,
          holdsNotes: group.tabs.includes(learnerNotes.tab),
        })),
        [
          { column: 1, locked: true, tabs: 1, holdsNotes: false },
          { column: 2, locked: false, tabs: 1, holdsNotes: true },
        ],
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      const marker = harness.applicationGroupMarkers.get(
        'codebook.applicationGroup.v1',
      ) as { writer?: unknown } | undefined
      assert.equal(
        marker?.writer,
        harness.reader['applicationGroupMarkerWriter'],
      )
      assert.equal(chat.focused(), true)
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner told where the keyboard went when an agent's first run in Cursor after Developer: Reload Window retires the earlier window's proven leftover at column 1: the proof focuses that empty group for its layout read and its unlock, and Cursor's close of a focused group gives the next group's file the keyboard (Cursor 3.23.12 workbench.desktop.main.js 17269:33927 `$closeGroup` → `removeGroup`, 17501:61528 `doRemoveEmptyGroup` with 17501:43055 `shouldRestoreFocus`), the same group the Application's allocation focuses right after (row 655), so the chat gets the keyboard back at the end and the learner is told once with the leftovers' sentence; Codebook itself shows no learner file with the keyboard; fails_when=the chat's return after the proof is made without a word, or Codebook gives the learner's file the keyboard on purpose; why_new=Cycle 0046 row 657 (C58 c58-cu-1f-reload: login-form.tsx had the keyboard for 124 ms after the leftover's close); seam=useNativeLayout (three stacked rows), applicationGroupMarkers (a record the grid still equals), leaveEmptyLockedGroup, focusMutableDraft, addSeparateEditorPart with focusTab, leavePaneFocusUnreportedBesideChat, presentation.createViewport (the MCP-first preparation), textDocumentShows and the information messages
test('in Cursor, the first Application preparation of a reloaded window whose proof focuses the leftover at column 1 shows no learner file with the keyboard, gives the chat its keyboard back and says once that closing the leftover moved it', async () => {
  // Arrange: three stacked rows: the earlier window's empty locked Application group, login-form.tsx and auth.ts; the record still describes this grid, and Cursor's chat tab has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 219 }, { size: 219 }, { size: 219 }],
  })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 1,
        groups: [{ size: 219 }, { size: 219 }, { size: 219 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    const leftover = harness.groups.find((group) => group.viewColumn === 1)!
    harness.focusMutableDraft('auth.ts', 3)
    harness.focusMutableDraft('login-form.tsx', 2)
    chat.focusTab()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: the leftover is gone, Codebook showed no learner file with the keyboard, the chat has the keyboard again, and the leftovers' sentence was told once before the arrangement's.
      assert.deepEqual(
        {
          leftoverStands: harness.groups.includes(leftover),
          learnerFilesShownWithKeyboard: harness
            .textDocumentShows()
            .slice(showsBefore)
            .filter(
              (shown) =>
                !shown.preserveFocus && !shown.name.startsWith('Captured-'),
            ),
          chatHasKeyboard: chat.focused(),
          messages: harness.informationMessages.map(
            (message) => message.message,
          ),
        },
        {
          leftoverStands: false,
          learnerFilesShownWithKeyboard: [],
          chatHasKeyboard: true,
          messages: [
            'Codebook gave the keyboard back to the chat after it closed the editor groups an earlier window had left, which moved the keyboard to another group. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
          ],
        },
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's first run in Cursor right after Developer: Reload Window, before any Study select: the earlier window's proven leftover is retired, the Application stands alone in its own locked group, the run's preparation answers, and the chat gets its keyboard back; fails_when=the reader gives the chat its keyboard back with Focus Agent between the leftover's retirement and the Application's allocation, Cursor's chat input takes the keyboard only after that command answered (workbench.desktop.main.js 17914:19364, 18566:8949, 18566:8198), so the chat's part has the focus again while the allocation reads its layout and the preparation fails ("The dedicated Application layout could not be confirmed.", C57 c57-cursor-1f2; "Native pane, group or focus changed while presentation waited; …", c57-cursor-1f); why_new=Cycle 0046 row 646; seam=useNativeLayout (three stacked rows), applicationGroupMarkers (a record the grid still equals), leaveEmptyLockedGroup, focusMutableDraft, addSeparateEditorPart with focusTab, leavePaneFocusUnreportedBesideChat, focusAgentLater, presentation.createViewport (the MCP-first preparation)
for (const landing of [
  // Before the reservation's first command: C57 c57-cursor-1f failed with "Native pane, group or focus changed while presentation waited; the learner arrangement was preserved."
  { commandsBeforeFocus: 1, nativeRound: 'c57-cursor-1f' },
  // Amid the allocation: C57 c57-cursor-1f2 failed with "The dedicated Application layout could not be confirmed."
  { commandsBeforeFocus: 4, nativeRound: 'c57-cursor-1f2' },
] as const)
  test(`in Cursor, the first Application preparation of a reloaded window whose chat takes its keyboard late (as in ${landing.nativeRound}) retires the leftover, stands alone in its own group, and gives the chat its keyboard back`, async () => {
    // Arrange: three stacked rows: the earlier window's empty locked Application group, the Repository Wiki's tab with login-form.tsx, and auth.ts; the record still describes this grid. Cursor's chat tab has the keyboard, and Cursor gives the chat input the keyboard only after Focus Agent answered.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 219 }, { size: 219 }, { size: 219 }],
    })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusAgentLater(landing.commandsBeforeFocus)
    try {
      harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
        version: 1,
        writer: 'the window before the reload',
        column: 1,
        groupCount: 3,
        layout: {
          orientation: 1,
          groups: [{ size: 219 }, { size: 219 }, { size: 219 }],
        },
      })
      harness.leaveEmptyLockedGroup(1)
      const leftover = harness.groups.find((group) => group.viewColumn === 1)!
      const learnerAuth = harness.focusMutableDraft('auth.ts', 3)
      const learnerLogin = harness.focusMutableDraft('login-form.tsx', 2)
      chat.focusTab()

      // Act
      let viewport: { close(): void } | undefined
      const prepared = await Promise.resolve()
        .then(() =>
          harness.reader.presentation.createViewport(
            'mcp-first-run',
            () => {},
            () => {},
            'normal',
          ),
        )
        .then(
          (created) => {
            viewport = created
            return 'prepared'
          },
          (error: unknown) => String(error),
        )
      // Cursor's chat takes the keyboard of the last Focus Agent a moment after it answered.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      // Assert: the preparation answered; the leftover is gone, the Application's group stands alone and locked at column 1 above the learner's two groups, and the chat has the keyboard.
      const mainGroups = harness.groups
        .filter((group) => !group.tabs.includes(chat.tab))
        .toSorted((left, right) => left.viewColumn - right.viewColumn)
      assert.deepEqual(
        {
          prepared,
          leftoverStands: harness.groups.includes(leftover),
          mainGroups: mainGroups.map((group) => ({
            column: group.viewColumn,
            locked: Boolean(group.locked),
            tabs: group.tabs.length,
          })),
          loginColumn: mainGroups.find((group) =>
            group.tabs.includes(learnerLogin.tab),
          )?.viewColumn,
          authColumn: mainGroups.find((group) =>
            group.tabs.includes(learnerAuth.tab),
          )?.viewColumn,
          chatHasKeyboard: chat.focused(),
        },
        {
          prepared: 'prepared',
          leftoverStands: false,
          mainGroups: [
            { column: 1, locked: true, tabs: 1 },
            { column: 2, locked: false, tabs: 2 },
            { column: 3, locked: false, tabs: 1 },
          ],
          loginColumn: 2,
          authColumn: 3,
          chatHasKeyboard: true,
        },
      )
      viewport?.close()
    } finally {
      await harness.close()
    }
  })

// Value: protects=an agent's first run right after a reload whose record no longer proves the earlier window's leftovers (the learner resized a group), beside Cursor's chat: the preparation is refused at once with a sentence that names the empty first group and its remedy, nothing is unlocked or closed, the record stays and the chat keeps its keyboard; fails_when=the preparation waits 5 s for a focus report the empty first group never gives and refuses with a sentence that names no group, or a failed proof unlocks, closes or forgets anything; why_new=Cycle 0046 row 610 (and the guard of row 609's path when the proof fails); seam=applicationGroupMarkers (a record the resized grid no longer equals), leaveEmptyLockedGroup, leaveEmptyGroup, presentation.createViewport (the MCP-first preparation) and addSeparateEditorPart with the chat's focusTab
test('an agent’s first run after a reload whose record no longer proves the empty first group is refused at once with that group named, touching nothing', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 and its Context group at column 3 in a grid the learner has since resized; both stand empty beside the learner's notes in column 2, and the chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const earlierRecord = {
      version: 2,
      writer: 'the window before the reload',
      columns: [1, 3],
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 3 }, { size: 1 }, { size: 1 }],
      },
    }
    harness.applicationGroupMarkers.set(
      'codebook.applicationGroup.v1',
      earlierRecord,
    )
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    chat.focusTab()
    const commandsBefore = harness.commands.length

    // Act
    const outcome = await Promise.resolve(
      harness.reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      ),
    ).catch((error: unknown) => error)

    // Assert: the refusal names the empty first group and its remedy; both leftovers stand as they were, nothing was unlocked, the record is the earlier window's, and the chat has the keyboard.
    assert.equal(
      outcome instanceof Error ? outcome.message : outcome,
      'The Codebook panes were not arranged: the first editor group (column 1) is empty, and beside the chat the editor reports no keyboard focus in an empty group. Open a file in that group or close it, then try again.',
    )
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.unlockEditorGroup'),
      false,
    )
    assert.deepEqual(
      [applicationLeftover, contextLeftover].map((group) => ({
        stands: harness.groups.includes(group),
        locked: Boolean(group.locked),
        tabs: group.tabs.length,
      })),
      [
        { stands: true, locked: true, tabs: 0 },
        { stands: true, locked: false, tabs: 0 },
      ],
    )
    assert.deepEqual(
      harness.applicationGroupMarkers.get('codebook.applicationGroup.v1'),
      earlierRecord,
    )
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's first run beside Cursor's chat when the learner's own first editor group is empty (workbench.editor.closeEmptyGroups off), with no reload and no record: the preparation is refused at once with a sentence that names that group and its remedy, the group stays, and the chat keeps its keyboard; fails_when=the preparation waits 5 s for a focus report the empty group never gives and refuses with a sentence that names no group; why_new=Cycle 0046 row 610 (the same refusal without any reload); seam=leaveEmptyGroup, presentation.createViewport (the MCP-first preparation) and addSeparateEditorPart with the chat's focusTab
test('an agent’s first run beside the chat with the learner’s own empty first group is refused at once with that group named, and the group stays', async () => {
  // Arrange: the learner's first editor group is empty and the editor keeps it; the learner's notes stand in column 2, and the chat has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.leaveEmptyGroup(1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    const learnersEmptyGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    chat.focusTab()

    // Act
    const outcome = await Promise.resolve(
      harness.reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      ),
    ).catch((error: unknown) => error)

    // Assert
    assert.equal(
      outcome instanceof Error ? outcome.message : outcome,
      'The Codebook panes were not arranged: the first editor group (column 1) is empty, and beside the chat the editor reports no keyboard focus in an empty group. Open a file in that group or close it, then try again.',
    )
    assert.equal(harness.groups.includes(learnersEmptyGroup), true)
    assert.equal(learnersEmptyGroup.tabs.length, 0)
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the earlier window's unproven leftovers at an agent's first run after a reload in an editor without another editor part: the Application gets its own new group at column 1 beside them, and nothing is unlocked, closed or merged; fails_when=a failed proof unlocks or closes a leftover, or the preparation puts the Application into the empty locked group; why_new=Cycle 0046 rows 609 and 610 (the guard of row 591's rule on the preparation's path when the proof fails); seam=applicationGroupMarkers (a record the resized grid no longer equals), leaveEmptyLockedGroup, leaveEmptyGroup and presentation.createViewport (the MCP-first preparation)
test('an agent’s first run after a reload whose record no longer proves the leftovers places the Application in its own group beside them and unlocks or closes nothing', async () => {
  // Arrange: the earlier window recorded its Application group at column 1 and its Context group at column 3 in a grid the learner has since resized; both stand empty beside the learner's notes in column 2; no chat part.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 2,
      writer: 'the window before the reload',
      columns: [1, 3],
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 3 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.leaveEmptyGroup(2)
    const learnerNotes = harness.focusMutableDraft('learner-notes.ts', 2)
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!,
      contextLeftover = harness.groups.find((group) => group.viewColumn === 3)!
    const commandsBefore = harness.commands.length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: the Application stands alone in a new locked group at column 1; both leftovers stand beside it as they were, and nothing was unlocked.
      assert.equal(
        harness.commands
          .slice(commandsBefore)
          .includes('workbench.action.unlockEditorGroup'),
        false,
      )
      assert.deepEqual(
        harness.groups.map((group) => ({
          column: group.viewColumn,
          locked: Boolean(group.locked),
          tabs: group.tabs.length,
          leftover: group === applicationLeftover || group === contextLeftover,
          holdsNotes: group.tabs.includes(learnerNotes.tab),
        })),
        [
          {
            column: 1,
            locked: true,
            tabs: 1,
            leftover: false,
            holdsNotes: false,
          },
          {
            column: 2,
            locked: true,
            tabs: 0,
            leftover: true,
            holdsNotes: false,
          },
          {
            column: 3,
            locked: false,
            tabs: 1,
            leftover: false,
            holdsNotes: true,
          },
          {
            column: 4,
            locked: false,
            tabs: 0,
            leftover: true,
            holdsNotes: false,
          },
        ],
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard in VS Code, and in Cursor with its chat in the side bar, when an agent's run prepares the Application while the Study workspace is closed and the learner's file is the active editor of the first group: the Application gets its own locked group without any editor group's focus, no file gets the keyboard, and the one sentence the editor's ambiguity calls for (row 614) says that a view keeps it; fails_when=the preparation focuses the first group and its focus return shows the learner's active file with the keyboard, so the chat input the learner just typed in loses its keyboard to that file for good, without a word; why_new=Cycle 0046 row 612 (C56 run c56-1f-control: focusFirstEditorGroup, then showTextDocument(actions.ts, preserveFocus false) from restorePreparationFocus); seam=useNativeLayout, focusMutableDraft, focusView (the chat view's input, which the editor does not report), presentation.createViewport (the MCP-first preparation), keyboardInView, textDocumentShows and the information messages
test('an agent’s run that prepares the Application while the chat view has the keyboard leaves the keyboard in the chat, focuses nothing and says once where the keyboard may be', async () => {
  // Arrange: the learner's actions.ts is the active editor of the first group and auth.ts stands in the second; then the learner typed the request into the chat view, which the editor does not report.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    const auth = harness.focusMutableDraft('auth.ts', 2)
    harness.leaveEmptyGroup(1)
    const actions = harness.focusMutableDraft('actions.ts', 1)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: no document was shown with the keyboard and the chat view still has it; the Application stands alone in its locked group at column 1 beside the learner's two groups, and the sentence names both places the keyboard may be.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      assert.equal(harness.keyboardInView(), true)
      assert.deepEqual(
        harness.groups.map((group) => ({
          column: group.viewColumn,
          locked: Boolean(group.locked),
          holdsActions: group.tabs.includes(actions.tab),
          holdsAuth: group.tabs.includes(auth.tab),
        })),
        [
          { column: 1, locked: true, holdsActions: false, holdsAuth: false },
          { column: 2, locked: false, holdsActions: true, holdsAuth: false },
          { column: 3, locked: false, holdsActions: false, holdsAuth: true },
        ],
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        [
          'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
        ],
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard in VS Code when an agent's first run after Developer: Reload Window retires the earlier window's empty Application group, which the editor restored as its active group: the proof and the close of that group and the new Application group take no editor group's focus, no file gets the keyboard, and the one sentence the editor's ambiguity calls for (row 614) says that a view keeps it; fails_when=the leftover proof focuses the recorded column, the removal of the focused group hands the keyboard to the learner's file, and the preparation's focus return then shows that file with the keyboard; why_new=Cycle 0046 row 612 (C56 run c56-1f2: row 609's proof focusFirstEditorGroup, retainForeignTabFocus giving nothing back beside an active text editor, then showTextDocument(actions.ts, preserveFocus false)); seam=applicationGroupMarkers, leaveEmptyGroup, focusMutableDraft, the editor's focusFirstEditorGroup (the learner's last click into the empty group), focusView (the chat view's input), presentation.createViewport (the MCP-first preparation), keyboardInView, textDocumentShows and the information messages
test('an agent’s first run after a reload retires the earlier window’s empty Application group the editor restored as active, leaves the keyboard in the chat view and says once where the keyboard may be', async () => {
  // Arrange: the earlier window recorded its Application group at column 1; after the reload it stands empty and active beside the learner's actions.ts in column 2 and auth.ts in column 3, and the learner typed the request into the chat view.
  const harness = await workspaceHarness(false)
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
    harness.leaveEmptyGroup(3)
    const auth = harness.focusMutableDraft('auth.ts', 3)
    harness.leaveEmptyGroup(2)
    const actions = harness.focusMutableDraft('actions.ts', 2)
    harness.leaveEmptyGroup(1)
    const applicationLeftover = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: no document was shown with the keyboard and the chat view still has it; the leftover is gone, the new Application group stands locked at column 1 before the learner's two groups, and the sentence names both places the keyboard may be.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      assert.equal(harness.keyboardInView(), true)
      assert.equal(harness.groups.includes(applicationLeftover), false)
      assert.deepEqual(
        harness.groups.map((group) => ({
          column: group.viewColumn,
          locked: Boolean(group.locked),
          holdsActions: group.tabs.includes(actions.tab),
          holdsAuth: group.tabs.includes(auth.tab),
        })),
        [
          { column: 1, locked: true, holdsActions: false, holdsAuth: false },
          { column: 2, locked: false, holdsActions: true, holdsAuth: false },
          { column: 3, locked: false, holdsActions: false, holdsAuth: true },
        ],
      )
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        [
          'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
        ],
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner in VS Code when an agent's run can place its Application only after focusing the first editor group (another group is the active one): without a fresh sign of the learner's hand in the active file the editor cannot tell whether the chat view had the keyboard, so no file is given the keyboard afterwards, and the learner is told once that the Application's group has it; fails_when=the preparation's focus return shows the learner's active file with the keyboard, taking it from a chat input the learner was typing in, or the keyboard stays in the new group without a word; why_new=Cycle 0046 row 612 (the borrow that cannot be avoided: workbench.action.newGroupAbove adds above the active group only, and no command makes a group active without focusing it); seam=useNativeLayout, focusMutableDraft, focusView (the chat view's input), presentation.createViewport (the MCP-first preparation), textDocumentShows and the information messages
test('an agent’s run that must focus the first editor group to place the Application gives no file the keyboard and says once that the Application’s group has it', async () => {
  // Arrange: the learner's actions.ts is the active editor of the second group, and the learner typed the request into the chat view.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    const actions = harness.focusMutableDraft('actions.ts', 2)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: no document was shown with the keyboard after the placement; the Application stands in its locked group at column 1, actions.ts in column 3, and the sentence says where the keyboard is.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        [
          'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
        ],
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(
        harness.groups.find((group) => group.tabs.includes(actions.tab))
          ?.viewColumn,
        3,
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of VS Code's chat opened as an editor tab of a main editor group (Chat: Open Chat in Editor), where the learner typed the request: an agent's run places its Application in a new group above the first one, and the chat tab, still in front of its group, gets its keyboard back through that group's focus command, which gives the chat editor's input the keyboard (1.140.0 workbench.desktop.main.js 1106:74902, 3129:7546); nothing is told; fails_when=the preparation gives back only another editor part's chat and leaves the keyboard in the new Application group with row 612's sentence; why_new=Cycle 0046 row 625 (the row-612 fixer's report: the preparation never gave the keyboard back to a foreign tab in the main editor); seam=useNativeLayout, focusMutableDraft, focusChatEditorTab (VS Code's TabInputChat without an active text editor), presentation.createViewport (the MCP-first preparation), the command log, the active tab group and the information messages
test('an agent’s run that prepares the Application while VS Code’s chat editor tab has the keyboard gives that chat tab its keyboard back and tells nothing', async () => {
  // Arrange: actions.ts is in the first group, and the learner typed the request into the chat, opened as an editor tab of the second group in front of auth.ts.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('auth.ts', 2)
    const chat = harness.focusChatEditorTab(2)
    const commandsBefore = harness.commands.length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: the Application stands in its own group at column 1; the chat's group, now column 3, got the keyboard back through its focus command with the chat tab in front, no text editor is active, and nothing was told.
      const active = harness.editor.window.tabGroups.activeTabGroup
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.deepEqual(
        harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusThirdEditorGroup',
        ],
      )
      assert.equal(active.viewColumn, 3)
      assert.equal(active.activeTab, chat)
      assert.equal(harness.focusedSource(), undefined)
      assert.deepEqual(harness.informationMessages, [])
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's run whose Application preparation is placed while the editor refuses the focus command that gives VS Code's chat editor tab its keyboard back: the run still gets its Application pane in its own group; fails_when=the preparation's return of the keyboard to the chat rejects inside its focus return, so the preparation takes a refused keyboard courtesy for a refused placement, disposes the new Application pane, closes its group and fails the agent's run; why_new=Cycle 0046 second /ship OCR review OCR1-9 (returnPreparationFocus awaited the give-back without a catch, unlike every other give-back of the flow); seam=useNativeLayout, focusMutableDraft, focusChatEditorTab (VS Code's TabInputChat without an active text editor), failNextCommand on the chat group's focus command, presentation.createViewport (the MCP-first preparation), the command log; no_claim=what the learner is told about the keyboard after the refused command
test('an agent’s run whose return of the keyboard to VS Code’s chat editor tab the editor refuses still gets its Application pane in its own group', async () => {
  // Arrange: actions.ts is in the first group, and the learner typed the request into the chat, opened as an editor tab of the second group in front of auth.ts. The editor will refuse the focus command of the chat's group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('auth.ts', 2)
    harness.focusChatEditorTab(2)
    const commandsBefore = harness.commands.length
    harness.failNextCommand('workbench.action.focusThirdEditorGroup')

    // Act: what the preparation answers, its viewport or its refusal.
    let failure: string | undefined
    const viewport = await Promise.resolve()
      .then(() =>
        harness.reader.presentation.createViewport(
          'mcp-first-run',
          () => {},
          () => {},
          'normal',
        ),
      )
      .catch((error: unknown) => {
        failure = String(error)
        return undefined
      })

    try {
      // Assert: the chat's group, now column 3, was asked for its focus and refused it; the Application stands in its own group at column 1 all the same.
      assert.deepEqual(
        {
          failure,
          applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
          focusCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) => /^workbench\.action\.focus/.test(command)),
        },
        {
          failure: undefined,
          applicationColumn: 1,
          focusCommands: [
            'workbench.action.focusFirstEditorGroup',
            'workbench.action.focusThirdEditorGroup',
          ],
        },
      )
    } finally {
      viewport?.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of VS Code's chat editor tab that the learner moved into a floating window (Chat: Move Chat into New Window), where the learner typed the request: an agent's run places its Application in a new group above the first one, and the chat gets its keyboard back through the numbered focus command of its group's column, which in VS Code counts the groups of every editor part, raises the floating window and gives the chat editor's input the keyboard (1.140.0 workbench.desktop.main.js 987:4284, 1106:181056, 1106:133818, 3129:7546); the measurement's focus of the first group gave the learner's file the keyboard for a moment, so the return says so once (rows 647 and 655); fails_when=the floating window's group counts as another editor part, whose only give-back is Cursor's Focus Agent, so VS Code runs nothing and tells nothing while the Application's group keeps the keyboard, or the return after the measurement's borrow is made without a word; why_new=Cycle 0046 row 636, and rows 647 and 655 (the sentence); seam=useNativeLayout, focusMutableDraft, addSeparateEditorPart('vscode-floating-chat') and its focusTab, presentation.createViewport (the MCP-first preparation), the command log, the chat's keyboard and the information messages
test('an agent’s run that prepares the Application while VS Code’s chat editor tab in a floating window has the keyboard gives that chat its keyboard back and says once that a file of the main editor had it for a moment', async () => {
  // Arrange: actions.ts is in the first group and auth.ts in the second; the learner typed the request into the chat editor tab moved into a floating window, whose group the editor counts at column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart('vscode-floating-chat')
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('auth.ts', 2)
    chat.focusTab()
    const commandsBefore = harness.commands.length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: the Application stands in its own group at column 1; the floating window's group, now column 4, got the keyboard back through its numbered focus command, and the arrangement's sentence was told once.
      assert.deepEqual(
        {
          applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
          chatColumn: harness.groups.find((group) =>
            group.tabs.includes(chat.tab),
          )?.viewColumn,
          focusCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) => /^workbench\.action\.focus/.test(command)),
          chatHasKeyboard: chat.focused(),
          messages: harness.informationMessages.map(
            (message) => message.message,
          ),
        },
        {
          applicationColumn: 1,
          chatColumn: 4,
          focusCommands: [
            'workbench.action.focusFirstEditorGroup',
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
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=row 612's bound beside row 625: a page of the main editor that is no chat (the editor's Settings, Cursor's composer tab, whose input the extension API gives no kind) reads the same whether the keyboard was in it or in a view beside it, so an agent's run gives it nothing back after placing its Application and says once that the new group has the keyboard; fails_when=row 625's return to VS Code's chat editor tab also focuses a group for a tab that cannot be proven a chat; why_new=Cycle 0046 row 625 guard; seam=useNativeLayout, focusMutableDraft, addOpaqueTab and focusOpaqueTab, presentation.createViewport, the command log and the information messages
test('an agent’s run that prepares the Application while a Settings tab is the active tab gives that tab nothing back and says once that the Application’s group has the keyboard', async () => {
  // Arrange: actions.ts is in the first group, and the editor's Settings is the active tab of the second group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('auth.ts', 2)
    harness.focusOpaqueTab(harness.addOpaqueTab('Settings', 2))
    const commandsBefore = harness.commands.length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert
      assert.deepEqual(
        harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        ['workbench.action.focusFirstEditorGroup'],
      )
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        [
          'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
        ],
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner in VS Code when an agent's first run after Developer: Reload Window must focus the earlier window's leftover group for its proof (another group is the active one): the removal of that focused group gives the editor's next group the keyboard, so the editor cannot tell whether the chat view had it; no file gets the keyboard after the Application is placed, and the learner is told once that the Application's group has it; fails_when=the preparation's focus return shows the learner's active file with the keyboard after row 609's proof took it from the chat view, or the keyboard stays in the new group without a word; why_new=Cycle 0046 row 612 (the proof's focus that cannot be avoided: the editor unlocks only the active group); seam=applicationGroupMarkers, leaveEmptyGroup, focusMutableDraft, focusView (the chat view's input), presentation.createViewport (the MCP-first preparation), textDocumentShows and the information messages
test('an agent’s first run after a reload that must focus the earlier window’s leftover group for its proof gives no file the keyboard and says once that the Application’s group has it', async () => {
  // Arrange: the earlier window recorded its Application group at column 3; after the reload it stands empty beside the learner's actions.ts, the active editor of column 1, and auth.ts in column 2, and the learner typed the request into the chat view.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 3,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyGroup(3)
    const applicationLeftover = harness.groups.find(
      (group) => group.viewColumn === 3,
    )!
    harness.leaveEmptyGroup(2)
    const auth = harness.focusMutableDraft('auth.ts', 2)
    harness.leaveEmptyGroup(1)
    const actions = harness.focusMutableDraft('actions.ts', 1)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: no document was shown with the keyboard after the placement and the sentence says where the keyboard is; the leftover is gone and the Application stands locked at column 1 before the learner's two groups.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        [
          'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
        ],
      )
      assert.equal(harness.groups.includes(applicationLeftover), false)
      assert.deepEqual(
        harness.groups.map((group) => ({
          column: group.viewColumn,
          locked: Boolean(group.locked),
          holdsActions: group.tabs.includes(actions.tab),
          holdsAuth: group.tabs.includes(auth.tab),
        })),
        [
          { column: 1, locked: true, holdsActions: false, holdsAuth: false },
          { column: 2, locked: false, holdsActions: true, holdsAuth: false },
          { column: 3, locked: false, holdsActions: false, holdsAuth: true },
        ],
      )
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who types in the first group's file while an agent's run prepares the Application in VS Code: the new group takes the keyboard from that file by the editor's own rule, and the preparation gives it back to the file, since a fresh sign of the learner's hand (a key press within LEARNER_SIGN_FRESH_MS) says the keyboard was there; fails_when=row 612's rule for the chat view also withholds the keyboard from a file the learner typed in a moment ago, which then stays in the empty Application group; why_new=Cycle 0046 row 612 (the bound of its fix: the learner's own sign still decides); seam=useNativeLayout, focusMutableDraft, workInActiveTextEditor('keyboard'), presentation.createViewport (the MCP-first preparation), textDocumentShows, focusedSource, keyboardOnBody and the information messages
test('an agent’s run that prepares the Application while the learner types in the first group’s file gives that file the keyboard back', async () => {
  // Arrange: actions.ts is the active editor of the first group, and the learner has just typed in it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.workInActiveTextEditor('keyboard')
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: actions.ts, in column 2 behind the new Application group, was shown with the keyboard and has it; nothing is told.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
        { name: 'actions.ts', viewColumn: 2, preserveFocus: false },
      ])
      assert.equal(
        harness.focusedSource()?.document.uri.path.endsWith('/actions.ts'),
        true,
      )
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.deepEqual(harness.informationMessages, [])
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who reads a file of the first group, without a key press, while an agent's run prepares the Application in VS Code: the new group takes the keyboard from that file by the editor's own rule, nothing proves that the keyboard was there and not in a chat view, so the file does not get it and the learner is told once where it may be; fails_when=the keyboard is left in the Application's group without a word (Cycle 0046 row 614, introduced by row 612's preparation without a focus); why_new=Cycle 0046 row 614; seam=useNativeLayout, focusMutableDraft (the learner's file, with no fresh sign), presentation.createViewport (the MCP-first preparation), textDocumentShows, keyboardOnBody and the information messages
test('an agent’s run that prepares the Application while the learner reads a first-group file without a key press gives that file nothing it cannot prove and says once where the keyboard may be', async () => {
  // Arrange: actions.ts is the active editor of the first group and has the keyboard; the learner has not pressed a key in it for a while, so no sign says so.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    const showsBefore = harness.textDocumentShows().length

    // Act
    const viewport = await harness.reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )

    try {
      // Assert: the new group took the keyboard from actions.ts, no document was shown with it afterwards, and the sentence says where the keyboard may be.
      assert.deepEqual(harness.informationMessages, [
        {
          message:
            'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
          items: [],
        },
      ])
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      assert.equal(harness.keyboardOnBody(), true)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    } finally {
      viewport.close()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard when an agent reveals the current pause's source through codebook_reveal while the Study workspace is closed and the learner closed the run's Application pane: the reader's entry prepares a new Application group as an agent's, so no file the learner is not known to work in gets the keyboard; the sentence the run's own preparation told stays the only one in the editor session; fails_when=the entry prepares the Application as the learner's and its focus return shows the learner's active file with the keyboard; why_new=Cycle 0046 finding on codebook_reveal (row 612's rule on the reveal's reader entry); seam=useNativeLayout, focusMutableDraft, a live run's viewport, closeTabByHand (the learner closes the Application pane), focusView (the chat view's input), presentation.revealSource (what the codebook_reveal handler's configured run calls), textDocumentShows, keyboardInView and the information messages
test('an agent’s source reveal that opens the closed Study workspace gives no learner’s file the keyboard', async () => {
  // Arrange: a live run's Application pane stands in column 1 beside the learner's actions.ts; the reader is closed, the learner closed the Application pane, and then typed the request into the chat view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  let live: { close(): void } | undefined
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')!
    harness.closeTabByHand(application.nativeTab)
    harness.focusView()
    const snapshot = harness.service.snapshot(
      record,
      harness.service.state(record).participants.browser.snapshotUri!,
    )
    const showsBefore = harness.textDocumentShows().length

    // Act
    await harness.reader.presentation.revealSource(snapshot, 'server.mts')

    // Assert: no document was shown with the keyboard and the chat view still has it; the run's own preparation told the editor session's one sentence about the new group.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
      ],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard when an agent selects the Study workspace through codebook_presentation during a live run whose Application pane the learner closed: the selection's entry is an agent's (open with forAgent), so the new Application group's preparation, which has to focus the first editor group, gives no file the keyboard and says once that the new group has it; fails_when=the entry prepares as the learner's and its focus return shows the learner's actions.ts with the keyboard, or the new group keeps the keyboard without a word; why_new=Cycle 0046 coverage of an agent's select during a live run (no test reached open's forAgent through a selection into a new Application preparation); seam=workInActiveTextEditor (the learner's sign before the run, so the run's own preparation tells nothing), presentation.createViewport (the agent's run), closeTabByHand (the learner closes the Application pane), focusView (the chat view's input), the faked clock (the sign is old by the selection), the service's selectPresentation (the codebook_presentation handler), textDocumentShows and the information messages
test('an agent’s Study selection during a live run whose Application pane the learner closed gives no file the keyboard and says once that the new Application group has it', async (context) => {
  // Arrange: the learner typed in actions.ts (second group) when the agent's run placed its Application, then closed the Application pane and typed the next request into the chat view; more than three seconds pass.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  let live: { close(): void } | undefined
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 2)
    harness.workInActiveTextEditor('keyboard')
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')!
    harness.closeTabByHand(application.nativeTab)
    harness.focusView()
    const state = harness.reader.presentationState(),
      showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length
    enableFakeClock(context)
    await advanceClock(context, 3_001)

    // Act
    const selecting = harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await advanceClockUntilSettled(context, selecting, 40_000)
    resetFakeClock(context)
    await selecting

    // Assert: no document was shown with the keyboard, the Application stands in column 1 again, and the one sentence says that its new group has the keyboard.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    resetFakeClock(context)
    live?.close()
    await harness.close()
  }
})

// Value: protects=the captured source at the Study's own column when an agent's run reacquires the Application while the learner's file covers that source: the next entry from the repository brings the source to the front again; fails_when=the Application group is remembered as an ordinary Study layout because the source already stands at column 2, so no reentry fronts it and the learner's file stays over the captured source; why_new=Cycle 0046 control 'source-reentry' (the guard `|| !this.sourceReady()` of rememberApplicationGroup lost its only test when the fake editor began to give a text shown beyond the grid a group of its own, commit 7cc9499a); seam=closeTabByHand (the learner closes the Application pane), focusMutableDraft (the learner's file over the source), presentation.createViewport (the agent's run) and open with the repository origin, as the Repository Wiki's evidence link enters
test('an entry from the repository fronts the captured source again after an agent’s run reacquired the Application while the learner’s file covered that source', async () => {
  // Arrange: a Return claimed the Application group; the learner closed the Application pane and opened a file over the captured source in column 2, and an agent's run then prepared the Application again.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let viewport: Awaited<
    ReturnType<typeof harness.reader.presentation.createViewport>
  >
  try {
    await harness.reader.open()
    await harness.reader.select('repository/workspace/overview')
    await harness.reader.action('return-current')
    harness.closeTabByHand(
      harness.groups.find((group) => group.viewColumn === 1)!.tabs[0]!,
    )
    const learnersFile = harness.focusMutableDraft('learner-work.ts', 2)
    viewport = await harness.reader.presentation.createViewport(
      'agent-run',
      () => {},
      () => {},
      'normal',
    )
    const sourceGroup = harness.groups.find((group) => group.viewColumn === 2)!
    assert.equal(sourceGroup.activeTab, learnersFile.tab)

    // Act
    await harness.reader.open(undefined, 'repository')

    // Assert: column 2 shows the captured source again (the reader finds its source in front), and the learner's file stays in that group.
    const shown = harness.groups.find((group) => group.viewColumn === 2)!
    assert.deepEqual(
      {
        learnersFileInFront: shown.activeTab === learnersFile.tab,
        sourceInFront: harness.reader['sourceReady'](),
        learnersFileKept: shown.tabs.includes(learnersFile.tab),
      },
      {
        learnersFileInFront: false,
        sourceInFront: true,
        learnersFileKept: true,
      },
    )
  } finally {
    viewport!?.close()
    await harness.close()
  }
})

// Value: protects=the learner's groups at a Restore after a Return that was refused once the Application stood in its new group; fails_when=the arrangement applies a layout no confirmed receipt describes (the live pair, or no layout at all) over the window's groups instead of refusing it; why_new=Cycle 0046 finding 591 (C54 in Cursor 3.23.12: the Restore after the refused Return merged a learner group into the source group); seam=reactivatePreviousGroupAtNextLayoutRead
test('a Restore with no confirmed layout for the window’s groups refuses the arrangement and leaves every group’s tabs', async () => {
  // Arrange: one learner group; the Return is refused after the Application moved into its new group, so the window holds two groups and no confirmed Application layout.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.focusMutableDraft('learner-notes.ts', 1)
    chat.focusTab()
    const state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.reactivatePreviousGroupAtNextLayoutRead(4)
    await harness.reader.action('return-current').catch(() => undefined)
    const tabsBefore = harness.groups.map((group) => [...group.tabs])
    const restoreState = harness.reader.presentationState()

    // Act
    const restore = await harness.reader
      .changePresentation({
        presentationId: restoreState.presentationId,
        expectedRevision: restoreState.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      .catch((error: unknown) => error)

    // Assert: the arrangement was refused with the groups-preserved message, the Restore says the live layout could not be confirmed, and every group keeps its tabs.
    assert.deepEqual(
      [...harness.reader.inspect().view!.errors],
      [
        'Error: Existing editor groups were preserved. Use the focus commands or arrange the Codebook panes manually.',
      ],
    )
    assert.equal(
      String(restore),
      'Error: The live Study layout could not be confirmed after Restore.',
    )
    assert.deepEqual(
      harness.groups.map((group) => [...group.tabs]),
      tabsBefore,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Open replay opening the recording at the first click while the learner's file is the tab in front of the live Application pane; fails_when=the entry reveals the Application pane and starts its arrangement before the editor has reported that reveal, so its own reveal reads as a change the learner made and the click ends with "Native pane, group or focus changed while presentation waited; the learner arrangement was preserved."; why_new=Cycle 0045 NF-20 (Cursor: the first click failed whenever a preview or kept tab was in front of the pane, the second opened it); seam=the recorded reader harness, focusMutableDraft, the fake editor reporting a pane's reveal later, and the fake clock, which alone lets the fake editor's own timer pass (local review tests-1 #3: no real delay decides whether the report arrives during the arrangement)
test("Open replay with the learner's file in front of the live Application pane opens the recording at the first click", async (context) => {
  // Arrange: the reader is open, and the file the learner (or the debugger) opened in the Application's group is in front of the pane with the keyboard focus.
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const learnerFile = harness.focusMutableDraft('login-form.tsx', 1)
    harness.revealPanelsLater()
    enableFakeClock(context)

    // Act: one click on Open replay. The fake editor reports the reveal while a layout read is pending, or by itself once the faked clock has passed its delay; the clock moves only while the entry waits.
    const opening = harness.reader
      .openRecording(harness.studyId)
      .then(() => harness.controller.settle())
    await advanceClockUntilSettled(context, opening, 6_000)
    resetFakeClock(context)

    // Assert
    assert.equal(harness.controller.state().reason, undefined)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(learnerFile.document.getText(), 'Original learner draft.\n')
    assert.equal(learnerFile.tab.isDirty, true)
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 2)
        ?.tabs.includes(learnerFile.tab),
      true,
    )
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

// Value: protects=the next native take of an unreported main editor focus naming what the first group held; fails_when=the refusal is told only to the caller and Output › Codebook gets no entry with the groups and tabs at the refusal; why_new=Cycle 0050 F389 (the Cursor main editor's contents when the keyboard report never came were not recorded)
test('Open Study Workspace refused for an unreported main editor focus writes one Output entry naming the first group and its tab', async (context) => {
  // Arrange
  const harness = await recordedReaderHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusOpaqueTab(harness.addOpaqueTab('Cursor Settings', 1))
    chat.focusTab()
    // The editor reports a group change while the focus command runs, as Cursor does when it rebuilds its tab model; the report's event log gets that change at that moment.
    const commands = harness.editor.commands as {
      executeCommand: (name: string, ...rest: unknown[]) => Thenable<unknown>
    }
    const runCommand = commands.executeCommand.bind(commands)
    commands.executeCommand = async (name, ...rest) => {
      if (name === 'workbench.action.focusFirstEditorGroup')
        harness.reader['placementEvents'].record(
          performance.now(),
          'groups opened [] closed [] changed [1]',
        )
      // Time passes before the command returns, so the report's window must start at its snapshot to list the change.
      await advanceClock(context, 100)
      return runCommand(name, ...rest)
    }

    // Act
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    enableFakeClock(context)
    await advanceClockUntilSettled(context, opening, 6_000)
    await opening
    resetFakeClock(context)

    // Assert
    const entries = logged.filter(
      (entry) => entry.surface === 'presentation:focus-unreported',
    )
    assert.equal(entries.length, 1)
    assert.match(entries[0]!.cause, /Guard: main editor focus report/)
    // The window opens with the snapshot, so the focus command's own group change is listed (F404).
    assert.match(entries[0]!.cause, /Events while armed:\n  \+\d+ ms groups /)
    assert.match(entries[0]!.cause, /1\*? \[Cursor Settings \(/)
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

// Value: protects=the Output › Codebook entry of an unreported main editor focus never carrying the home directory or a control character that a tab label or an event note held; fails_when=the entry lists the editor's events unsanitized, as refusePlacement's sanitized ones are not (local CodeRabbit, Cycle 0056 pt3 CR3); why_new=the F389 entry's test read the group and tab lines, with no private path in any note; seam=the reader's placementEvents note recorded with a home path and a bell character, the entry's cause; no_claim=the native editor's own labels
test('the Output entry of an unreported main editor focus hides the home directory and control characters in the editor events', async (context) => {
  // Arrange
  const harness = await recordedReaderHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  const home = homedir()
  try {
    harness.focusOpaqueTab(harness.addOpaqueTab('Cursor Settings', 1))
    chat.focusTab()
    const commands = harness.editor.commands as {
      executeCommand: (name: string, ...rest: unknown[]) => Thenable<unknown>
    }
    const runCommand = commands.executeCommand.bind(commands)
    commands.executeCommand = async (name, ...rest) => {
      if (name === 'workbench.action.focusFirstEditorGroup')
        harness.reader['placementEvents'].record(
          performance.now(),
          `tab opened ${home}/private/notes.ts\u0007`,
        )
      await advanceClock(context, 100)
      return runCommand(name, ...rest)
    }

    // Act
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    enableFakeClock(context)
    await advanceClockUntilSettled(context, opening, 6_000)
    await opening
    resetFakeClock(context)

    // Assert
    const entries = logged.filter(
      (entry) => entry.surface === 'presentation:focus-unreported',
    )
    assert.equal(entries.length, 1)
    assert.match(entries[0]!.cause, /tab opened ~\/private\/notes\.ts/)
    assert.equal(entries[0]!.cause.includes(home), false)
    assert.equal(entries[0]!.cause.includes('\u0007'), false)
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

// Value: protects=a cancelled Application group preparation ending its wait for the editor's late activation report at once; fails_when=the wait runs its full bound when its signal is already aborted, so a Close or a newer entry holds the next arrangement for 150 ms (local open-code-review OCR-L2, Cycle 0056 pt3); why_new=the wait registered its abort listener after the signal had aborted, which never fires; seam=the reader's waitForLateGroupActivation with an aborted signal; no_claim=the native timing of the editor's report
test('the wait for an Application group’s late activation ends at once when its preparation is already cancelled', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    // Act
    const wait = harness.reader['waitForLateGroupActivation'](
      Symbol('group'),
      AbortSignal.abort(),
    ).then(() => 'ended' as const)
    // The next macrotask: a wait that ended at once has settled before it; one that waits for a timer or a report has not.
    const nextTask = new Promise<'still waiting'>((resolve) =>
      setImmediate(() => resolve('still waiting')),
    )

    // Assert
    assert.equal(await Promise.race([wait, nextTask]), 'ended')
    await wait
  } finally {
    await harness.close()
  }
})

/**
 * Starts the reader's wait for an Application group's late activation report on the harness, with its tab-group subscriptions counted.
 * @param harness - The workspace harness.
 * @param signal - The preparation's cancellation, when the wait has one.
 * @returns `wait` (settles when the wait ends), `isEnded()`, `reportActivation()` (the editor reports the group changed) and `subscriptions()` (how many listeners the wait registered and how many it disposed).
 * @example const late = startLateActivationWait(harness); late.reportActivation(); await late.wait
 */
function startLateActivationWait(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  signal?: AbortSignal,
) {
  const identity = Symbol('allocated group')
  const group = harness.groups[0]!
  harness.reader['editorGroupIdentities'].set(group as never, identity)
  const tabGroups = harness.editor.window.tabGroups
  const subscribe = tabGroups.onDidChangeTabGroups.bind(tabGroups)
  const counts = { registered: 0, disposed: 0 }
  const listeners = new Set<Parameters<typeof subscribe>[0]>()
  tabGroups.onDidChangeTabGroups = (callback) => {
    counts.registered++
    listeners.add(callback)
    const subscription = subscribe(callback)
    return {
      dispose(): void {
        counts.disposed++
        listeners.delete(callback)
        subscription.dispose()
      },
    }
  }
  let isEnded = false
  const wait = harness.reader['waitForLateGroupActivation'](
    identity,
    signal,
  ).then(() => {
    isEnded = true
  })
  return {
    wait,
    isEnded: (): boolean => isEnded,
    /** The editor reports the allocated group as changed, as Cursor does after the command answered. */
    reportActivation: (): void => {
      for (const listener of [...listeners])
        listener({ opened: [], closed: [], changed: [group] })
    },
    subscriptions: () => ({ ...counts }),
  }
}

// Value: protects=the wait for an Application group's late activation ending at the first report, at its 150 ms bound when the editor reports nothing, and at once when its preparation is cancelled in any of those states, with its listener disposed each time; fails_when=a cancelled wait goes on to the bound or leaves its listener registered, a report does not end the wait, or the bound is not what ends a silent editor's wait; why_new=the coverage review found the wait's state cells (report, silence, cancellation) untested apart from an already aborted signal; seam=the reader's waitForLateGroupActivation on the workspace harness with the faked clock and counted tab-group listeners; no_claim=the native editor's report
for (const cell of [
  { name: 'a report of the group’s activation', ends: 'report' },
  { name: 'the 150 ms bound when the editor reports nothing', ends: 'bound' },
  {
    name: 'a cancellation while the activation would still have come',
    ends: 'abort',
    reportsAfterwards: true,
  },
  {
    name: 'a cancellation while the editor reports nothing',
    ends: 'abort',
    reportsAfterwards: false,
  },
] as const)
  test(`the wait for an Application group’s late activation ends at ${cell.name} and disposes its listener`, async (context) => {
    // Arrange
    const harness = await workspaceHarness()
    try {
      const abort = new AbortController()
      enableFakeClock(context)
      const late = startLateActivationWait(harness, abort.signal)
      const settledAfterEvents = async (): Promise<boolean> => {
        await Promise.resolve()
        return late.isEnded()
      }
      assert.equal(await settledAfterEvents(), false)

      // Act
      if (cell.ends === 'report') late.reportActivation()
      if (cell.ends === 'bound') {
        await advanceClock(context, 149)
        assert.equal(await settledAfterEvents(), false)
        await advanceClock(context, 1)
      }
      if (cell.ends === 'abort') abort.abort()
      await late.wait
      // A report after the wait ended changes nothing.
      if ('reportsAfterwards' in cell && cell.reportsAfterwards)
        late.reportActivation()

      // Assert
      assert.deepEqual(late.subscriptions(), { registered: 1, disposed: 1 })
    } finally {
      resetFakeClock(context)
      await harness.close()
    }
  })

for (const entry of [
  "an agent's Study workspace request",
  'Open Study Workspace',
] as const) {
  // Value: protects=a Study workspace request made while Cursor's Agent works and the main editor holds no editor at all (only its empty-editor watermark): the panes are arranged without the learner's click and the Agent keeps the keyboard; fails_when=the entry waits five seconds for a keyboard focus report that Cursor never gives an empty group or a Codebook pane beside the chat, and refuses with "The Codebook panes were not arranged: the main editor did not report the keyboard focus within 5 s …"; why_new=Cycle 0050 F389 (Cursor 3.26.16, frames of the X3 take: no tab in any group, the Agent working, two refused codebook_presentation study-workspace requests); seam=the workspace harness with one empty main group, Cursor's chat part and unreported pane focus
  test(`${entry} made beside Cursor's Agent while the main editor holds no editor arranges the three panes and leaves the keyboard in the chat`, async (context) => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 1, groups: [{}] })
    harness.leaveEmptyGroup(1)
    const chat = harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    harness.leavePaneFocusUnreportedBesideChat()
    try {
      chat.focusTab()
      const state = harness.reader.presentationState()

      // Act
      const request =
        entry === 'Open Study Workspace'
          ? harness.reader.open()
          : harness.reader.changePresentation(
              {
                presentationId: state.presentationId,
                expectedRevision: state.presentationControlRevision,
                mode: 'study-workspace',
                action: 'select',
              },
              'agent',
            )
      const outcome = request.then(
        () => 'arranged',
        (error: unknown) => String(error),
      )
      enableFakeClock(context)
      await advanceClockUntilSettled(context, outcome, 6_000)
      const result = await outcome
      resetFakeClock(context)

      // Assert
      assert.equal(result, 'arranged')
      assert.equal(harness.groups.length, 4)
      assert.equal(harness.groups.at(-1)?.tabs[0]?.label, 'New Agent')
      assert.notEqual(harness.panelColumn('codebook.studyContext'), undefined)
      assert.equal(chat.focused(), true)
    } finally {
      resetFakeClock(context)
      await harness.close()
    }
  })
}

// Value: protects=an agent's first run beside Cursor's Agent while the main editor is one empty group (the editor's empty-editor view): the run is prepared instead of the empty-group refusal; fails_when=the empty first group is refused at once before the lone-main-group check, so the F389 shape is still refused on this entry; why_new=F401 (CodeRabbit major: emptyFirstGroupObstacle threw before isSoleMainGroupBesideChat); seam=the workspace harness with one empty main group and Cursor's chat part
test("an agent's first run beside the chat with the main editor as one empty group is prepared instead of refused", async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}] })
  harness.leaveEmptyGroup(1)
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    chat.focusTab()

    // Act
    const outcome = await Promise.resolve(
      harness.reader.presentation.createViewport(
        'mcp-first-run',
        () => {},
        () => {},
        'normal',
      ),
    ).catch((error: unknown) => error)

    // Assert
    assert.equal(
      outcome instanceof Error ? outcome.message : 'arranged',
      'arranged',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the unreported-focus refusal for a main editor that holds a learner's page (the editor's Settings) beside Cursor's chat: only the lone empty or Codebook-only first group goes on without the focus report; fails_when=a first group with a learner's tab is arranged without a focus proof; why_new=F403 (OCR L1: no test covered a first group holding a learner's tab with two groups)
test("an agent's Study workspace request beside the chat with a learner's page in the only main group is refused and opens no group", async (context) => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusOpaqueTab(harness.addOpaqueTab('Cursor Settings', 1))
    chat.focusTab()
    const state = harness.reader.presentationState()

    // Act
    const outcome = harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        },
        'agent',
      )
      .then(
        () => 'arranged',
        (error: unknown) => String(error),
      )
    enableFakeClock(context)
    await advanceClockUntilSettled(context, outcome, 6_000)
    const result = await outcome
    resetFakeClock(context)

    // Assert
    assert.match(result, /did not report the keyboard focus within 5 s/)
    assert.equal(harness.groups.length, 2)
    assert.equal(chat.focused(), true)
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

for (const entry of ['Open replay', 'Open Study Workspace'] as const) {
  // Value: protects=an entry that is refused because the main editor never reports the keyboard focus the measurement gave it leaving the window as it found it; fails_when=the entry creates the Application pane first, the refusal leaves that pane open with the keyboard, and the chat does not get the keyboard back because the editor still names its group; why_new=Cycle 0045 finding S1-F3 (the rule a select and a restore follow since cause 12 (b) did not hold for Open replay and Open Study Workspace; natively item 2's first try of the owed checks left the Application pane open with the keyboard after `codebook_playback open`); seam=the recorded reader harness with a separate editor part whose group the editor names as active, the fake editor's unreported pane focus beside the chat, and the fake clock for the five seconds of the wait
  test(`${entry} refused while Cursor's chat holds the keyboard opens no pane and leaves the keyboard focus where it was`, async (context) => {
    // Arrange: Cursor names the chat's group as the active one and its input has the keyboard; the first group shows a settings page, so the measurement can only focus the Application pane the entry places there, and Cursor reports no focus of that pane.
    const harness = await recordedReaderHarness()
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    harness.leavePaneFocusUnreportedBesideChat()
    try {
      harness.focusOpaqueTab(harness.addOpaqueTab('Cursor Settings', 1))
      chat.focusTab()
      const tabsBefore = harness.groups.map((group) => [...group.tabs]),
        layoutBefore = structuredClone(harness.editorLayout())

      // Act: the five seconds of the wait for the focus report pass on a faked clock.
      let refusal: string | undefined
      if (entry === 'Open replay') {
        await harness.reader.openRecording(harness.studyId)
        enableFakeClock(context)
        await advanceClockUntil(
          context,
          () => harness.controller.state().readiness === 'failed',
          6_000,
        )
        refusal = harness.controller.state().reason
      } else {
        const opening = harness.reader.open().then(
          () => 'opened',
          (error: unknown) => String(error),
        )
        enableFakeClock(context)
        await advanceClockUntilSettled(context, opening, 6_000)
        refusal = await opening
      }
      resetFakeClock(context)

      // Assert
      assert.equal(
        refusal,
        'Error: The Codebook panes were not arranged: the main editor did not report the keyboard focus within 5 s after Codebook focused its first editor group. Click into a file in the main editor, then try again.',
      )
      assert.equal(harness.counts().panels, 0)
      assert.deepEqual(
        harness.groups.map((group) => [...group.tabs]),
        tabsBefore,
      )
      assert.equal(chat.focused(), true)
      assert.equal(harness.reader.presentationState().state, 'closed')
      // The grid is as the entry found it: no editor group was opened for the focus return.
      assert.equal(harness.groups.length, 3)
      assert.deepEqual(harness.editorLayout(), layoutBefore)
    } finally {
      resetFakeClock(context)
      await harness.close()
    }
  })

  for (const [named, replacesGroupObjects] of [
    ["the chat's group", true],
    ['a text tab without an active text editor', false],
    ['a text tab without an active text editor', true],
  ] as const)
    // Value: protects=an entry made while Cursor's chat holds the keyboard being arranged, with the chat having the keyboard again afterwards; fails_when=the Application pane is created before the main editor is measured, where Cursor reports no focus while it names the chat's group, so the entry ends with a refusal after five seconds, or the keyboard stays in the main editor after the measurement borrowed it; why_new=Cycle 0045 finding S1-F3 (the early measurement and the focus return of cause 12 held for a select and a restore only); seam=the recorded reader harness with a separate editor part, focusMutableDraft, the fake editor's group object replacement and its unreported pane focus beside the chat
    test(`${entry} made while Cursor's chat holds the keyboard and the editor names ${named} arranges the panes and gives the chat its focus back, ${replacesGroupObjects ? 'also when the editor replaces every tab group object with each tab change' : 'in an editor that keeps its tab group objects'}`, async () => {
      // Arrange: the first group shows the learner's file beside a settings page and the group below is empty; the chat's own editor part holds the keyboard.
      const harness = await recordedReaderHarness()
      harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
      harness.groups.at(-1)!.tabs = []
      harness.groups.at(-1)!.activeTab = undefined
      const chat = harness.addSeparateEditorPart()
      if (replacesGroupObjects) harness.replaceGroupObjectsOnTabChanges()
      // Cursor keeps naming the chat's group after the measurement focused the first group.
      if (named === "the chat's group")
        harness.leavePaneFocusUnreportedBesideChat()
      try {
        const settings = harness.addOpaqueTab('Cursor Settings', 1),
          learnerFile = harness.focusMutableDraft('login-form.tsx', 1)
        if (named === "the chat's group") chat.focusTab()
        else chat.focus()
        const before = {
          chatHasKeyboard: chat.focused(),
          hasActiveTextEditor:
            harness.editor.window.activeTextEditor !== undefined,
          chatGroupNamed:
            harness.editor.window.tabGroups.activeTabGroup.tabs.includes(
              chat.tab,
            ),
        }

        // Act
        if (entry === 'Open replay') {
          await harness.reader.openRecording(harness.studyId)
          await harness.controller.settle()
        } else await harness.reader.open()

        // Assert
        const state = harness.reader.presentationState(),
          firstGroup = harness.groups.find(
            (group) => group.viewColumn === (entry === 'Open replay' ? 2 : 1),
          )!,
          chatGroup = harness.groups.find((group) =>
            group.tabs.includes(chat.tab),
          )
        assert.deepEqual(before, {
          chatHasKeyboard: true,
          hasActiveTextEditor: false,
          chatGroupNamed: named === "the chat's group",
        })
        assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
        if (entry === 'Open replay') {
          assert.equal(harness.controller.state().reason, undefined)
          assert.equal(harness.controller.state().readiness, 'ready')
        }
        assert.equal(state.state, 'open')
        assert.equal(state.layoutConfirmed, true)
        assert.equal(state.panes.appColumn, 1)
        assert.equal(state.panes.sourceColumn, 2)
        assert.equal(
          state.panes.contextColumn,
          entry === 'Open replay' ? undefined : 3,
        )
        // Replay's App allocation shifts the original group; its dirty file and settings remain together in that original group.
        assert.equal(firstGroup.tabs.includes(learnerFile.tab), true)
        assert.equal(firstGroup.tabs.includes(settings), true)
        assert.equal(
          learnerFile.document.getText(),
          'Original learner draft.\n',
        )
        assert.equal(learnerFile.tab.isDirty, true)
        assert.deepEqual(harness.tabCloseRequests(), [])
        // The measurement borrowed the keyboard for the main editor; the chat has it again through Cursor's own command, and no editor group was opened for that.
        assert.equal(chatGroup?.viewColumn, 4)
        assert.equal(harness.groups.length, 4)
        assert.equal(
          harness.commands.filter(
            (command) => command === 'workbench.action.newGroupAbove',
          ).length,
          entry === 'Open replay' ? 1 : 0,
        )
        assert.equal(
          harness.commands
            .filter((command) =>
              /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
                command,
              ),
            )
            .at(-1),
          'composer.focusComposer',
        )
        // The entry owns the final return to the chat, so the preparation of its Application shows no file of the learner's with the keyboard on the way (since row 712 its capture finds that file's group, and its own return would show it).
        assert.deepEqual(
          harness
            .textDocumentShows()
            .filter((shown) => !shown.preserveFocus)
            .map((shown) => shown.name),
          [],
        )
        assert.equal(chat.focused(), true)
      } finally {
        await harness.close()
      }
    })
}

for (const phase of [
  'native response',
  'caller admission',
  'same-source key',
  'window round trip',
  'Close',
] as const)
  test(`recorded App preparation preserves newer source input at ${phase} before allocating its native group`, async () => {
    // Arrange: both source tabs exist before entry, so an away-and-back choice changes no group or document identity.
    const harness = await recordedReaderHarness()
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    harness.leavePaneFocusUnreportedBesideChat()
    const original = harness.focusMutableDraft('original-primary.ts', 1),
      other = harness.focusMutableDraft('other-primary.ts', 1)
    harness.focusExistingSource(original.editor)
    chat.focusTab()
    const focus = harness.reader['focusApplicationSourceGroup'],
      focusPrimary = focus.bind(harness.reader),
      commandsBefore = harness.commands.length
    let held:
        ReturnType<typeof harness.holdNextPrimaryFocusResponse> | undefined,
      opening: Promise<void> | undefined,
      closing: Promise<void> | undefined
    harness.reader['focusApplicationSourceGroup'] = async (...arguments_) => {
      if (phase !== 'caller admission')
        held = harness.holdNextPrimaryFocusResponse()
      const receipt = await focusPrimary(...arguments_)
      if (phase === 'caller admission') {
        harness.focusExistingSource(other.editor)
        harness.focusExistingSource(original.editor)
      }
      return receipt
    }
    try {
      // Act: hold the native response or change input in the caller's await gap; Close must also drain that response without allocation.
      opening = harness.reader
        .openRecording(harness.studyId)
        .then(() => harness.controller.settle())
      if (phase !== 'caller admission') {
        await waitUntil(() => Boolean(held), 'App preparation primary focus')
        assert.ok(held)
        await held.started
        if (phase === 'Close') closing = harness.reader.close()
        else if (phase === 'same-source key')
          harness.workInActiveTextEditor('keyboard')
        else if (phase === 'window round trip') {
          harness.changeWindowFocus(false)
          harness.changeWindowFocus(true)
        } else {
          harness.focusExistingSource(other.editor)
          harness.focusExistingSource(original.editor)
        }
        held.release()
      }
      await opening
      await closing

      // Assert
      assert.equal(
        harness.commands
          .slice(commandsBefore)
          .includes('workbench.action.newGroupAbove'),
        false,
      )
      assert.equal(harness.nativePanels().length, 0)
      assert.equal(original.document.getText(), 'Original learner draft.\n')
      assert.equal(other.document.getText(), 'Original learner draft.\n')
      if (phase === 'Close')
        assert.equal(harness.reader.inspect().opened, false)
      else {
        assert.equal(harness.controller.state().readiness, 'failed')
        assert.match(
          harness.controller.state().reason ?? '',
          /primary source changed/,
        )
        assert.equal(
          harness.focusedSource()?.document.uri.toString(),
          original.document.uri.toString(),
        )
      }
    } finally {
      held?.release()
      await opening
      await closing
      harness.reader['focusApplicationSourceGroup'] = focus
      await harness.close()
    }
  })

// Value: protects=cold Study entry when VS Code retains an unchanged background text-editor receipt; fails_when=Application registration waits for that receipt to disappear although its native tab is active and visible; why_new=Cycle0046 native283 held auth.ts/column2 while Application was active in column1; seam=the confirmed independent native tab and text-editor receipts, retained until Open completes.
for (const receiptLocation of [
  'background group',
  'covered source group',
] as const)
  test(`Open Study Workspace completes while VS Code retains the original text-editor receipt in the ${receiptLocation}`, async (context) => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 659 }, { size: 440 }],
    })
    harness.focusMutableDraft('auth.ts', 2)
    const backgroundEditor = harness.editor.window.activeTextEditor
    harness.focusMutableDraft('login-form.tsx', 1)
    const originalEditor =
      receiptLocation === 'background group'
        ? backgroundEditor
        : harness.editor.window.activeTextEditor
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      harness.editor.window,
      'activeTextEditor',
    )!
    const originalTabs = harness.groups.flatMap((group) => [...group.tabs])
    Object.defineProperty(harness.editor.window, 'activeTextEditor', {
      configurable: true,
      get: () => originalEditor,
    })
    try {
      // Act: leave the original receipt populated through the entire Open.
      const opening = harness.reader.open().then(
        () => 'opened',
        (error: unknown) => String(error),
      )
      enableFakeClock(context)
      await advanceClockUntilSettled(context, opening, 6_000)
      resetFakeClock(context)

      // Assert
      assert.equal(await opening, 'opened')
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.editor.window.activeTextEditor, originalEditor)
      assert.equal(harness.groups.length, 3)
      assert.equal(
        originalTabs.every((tab) =>
          harness.groups.some((group) => group.tabs.includes(tab)),
        ),
        true,
      )
      assert.equal(harness.runtimes.length, 0)
    } finally {
      resetFakeClock(context)
      Object.defineProperty(
        harness.editor.window,
        'activeTextEditor',
        originalDescriptor,
      )
      await harness.close()
    }
  })

for (const changedIdentity of ['source URI', 'source column'] as const)
  test(`Open Study Workspace refuses a text-editor receipt whose ${changedIdentity} changes during Application registration`, async (context) => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 659 }, { size: 440 }],
    })
    const background = harness.focusMutableDraft('auth.ts', 2)
    const otherFile = harness.focusMutableDraft('different-source.ts', 2)
    background.focus()
    harness.focusMutableDraft('login-form.tsx', 1)
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      harness.editor.window,
      'activeTextEditor',
    )!
    let reportedEditor = background.editor
    Object.defineProperty(harness.editor.window, 'activeTextEditor', {
      configurable: true,
      get: () => reportedEditor,
    })
    harness.onNextPanel('codebook.scopedBrowser', () => {
      // Only the independent text-editor receipt changes; no tab change masks this guard.
      reportedEditor =
        changedIdentity === 'source URI'
          ? otherFile.editor
          : { ...background.editor, viewColumn: 1 }
    })
    const originalTabs = harness.groups.flatMap((group) => [...group.tabs])
    try {
      // Act
      const opening = harness.reader.open().then(
        () => 'opened',
        (error: unknown) => String(error),
      )
      enableFakeClock(context)
      await advanceClockUntilSettled(context, opening, 6_000)
      resetFakeClock(context)

      // Assert
      assert.equal(
        await opening,
        changedIdentity === 'source URI'
          ? 'Error: Native panes or learner focus changed while the new application registered; the arrangement was preserved.'
          : 'Error: Timed out waiting for new application native registration',
      )
      assert.equal(harness.reader.presentationState().state, 'closed')
      assert.equal(harness.counts().panels, 0)
      assert.equal(
        originalTabs.every((tab) =>
          harness.groups.some((group) => group.tabs.includes(tab)),
        ),
        true,
      )
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
    } finally {
      resetFakeClock(context)
      Object.defineProperty(
        harness.editor.window,
        'activeTextEditor',
        originalDescriptor,
      )
      await harness.close()
    }
  })

test('Open Study Workspace refuses an unchanged text-editor receipt without an original column identity', async (context) => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 659 }, { size: 440 }],
  })
  const background = harness.focusMutableDraft('auth.ts', 2)
  harness.focusMutableDraft('login-form.tsx', 1)
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    harness.editor.window,
    'activeTextEditor',
  )!
  Object.defineProperty(harness.editor.window, 'activeTextEditor', {
    configurable: true,
    get: () => ({ ...background.editor, viewColumn: undefined }),
  })
  try {
    // Act
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    enableFakeClock(context)
    await advanceClockUntilSettled(context, opening, 6_000)
    resetFakeClock(context)

    // Assert
    assert.equal(
      await opening,
      'Error: Timed out waiting for new application native registration',
    )
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
  } finally {
    resetFakeClock(context)
    Object.defineProperty(
      harness.editor.window,
      'activeTextEditor',
      originalDescriptor,
    )
    await harness.close()
  }
})
