import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  takeUnreportedListenerErrors,
  workspaceHarness,
} from './studyWorkspaceHarness'

// Value: protects=the fake extension context keeping profile state like the editor's Memento, so a reader that writes a Date, a Map or reads with a default is tested against what the editor does; fails_when=the fake answers undefined for a missing key whose default was given, or keeps a Date or Map that the editor would turn into text or an empty object; why_new=F376 (the fake ignored the default and used structuredClone); seam=the harness's fake globalState and workspaceState; no_claim=the persistence of the real Memento across restarts
test('the fake profile state answers a default for a missing key and keeps JSON only', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    const { globalState } = harness

    // Act
    await globalState.update('written-date', new Date(0))
    await globalState.update('written-map', new Map([['a', 1]]))
    await globalState.update('removed', 1)
    await globalState.update('removed', undefined)

    // Assert
    assert.equal(globalState.get('missing', 'fallback'), 'fallback')
    assert.equal(globalState.get('written-date'), '1970-01-01T00:00:00.000Z')
    assert.deepEqual(globalState.get('written-map'), {})
    assert.equal(globalState.get('removed', 'fallback'), 'fallback')
  } finally {
    await harness.close()
  }
})

// Value: protects=the visible text editors event of the fake editor following every close of a tab, the learner's Close Editor included, and one throwing listener not ending the editor operation or silencing the listeners after it; fails_when=Close Editor changes the visible editors without telling the listeners, or a listener's throw stops the close or the later listeners; why_new=F376 (only a show and a close request told them, and a throw reached the caller); seam=the harness's fake window.onDidChangeVisibleTextEditors and the Close Editor command; no_claim=the extension host's delivery delay
test('the fake editor tells every visible-editors listener of a Close Editor and isolates one that throws', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    harness.expectVisibleEditorListenerErrors()
    harness.focusMutableDraft('closing.txt', 1)
    let laterListenerCalls = 0
    const throwing = harness.editor.window.onDidChangeVisibleTextEditors(() => {
      throw new Error('Listener failed.')
    })
    const later = harness.editor.window.onDidChangeVisibleTextEditors(() => {
      laterListenerCalls++
    })

    // Act
    await harness.editor.commands.executeCommand(
      'workbench.action.closeActiveEditor',
    )
    throwing.dispose()
    later.dispose()

    // Assert
    assert.equal(laterListenerCalls, 1)
    assert.deepEqual(
      harness.visibleEditorListenerErrors.map((error) => String(error)),
      ['Error: Listener failed.'],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a click into another editor group being announced as a change of the tab groups naming the group left and the group entered, as the editor does; fails_when=activateEditorGroup changes the active group without the event, so code that follows the group changes never sees a learner's click in a test; why_new=F376 (activateEditorGroup fired no tab-group change); seam=the harness's activateEditorGroup and fake window.tabGroups.onDidChangeTabGroups; no_claim=the order of this event against the active text editor event
test('activating another editor group is announced as a tab group change', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.focusMutableDraft('first.txt', 1)
    harness.focusMutableDraft('second.txt', 2)
    harness.activateEditorGroup(1)
    const changedColumns: number[][] = []
    const subscription = harness.editor.window.tabGroups.onDidChangeTabGroups(
      (event) => changedColumns.push(event.changed.map((g) => g.viewColumn)),
    )

    // Act
    harness.activateEditorGroup(2)
    subscription.dispose()

    // Assert
    assert.deepEqual(changedColumns, [[1, 2]])
  } finally {
    await harness.close()
  }
})

// Value: protects=the hand-driven slot clock firing a timer that another timer sets while the clock moves, when it falls due inside the same span, so a deadline armed by a firing callback is not skipped by a test; fails_when=the clock fires only the timers set before the move; why_new=F376 (elapseSlotClock walked a snapshot of the timers); seam=the harness's manual slot clock and the reader's slot timers; no_claim=the real timer's drift
test('the hand-driven slot clock fires a timer that a firing timer sets inside the same span', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    harness.useManualSlotClock()
    const fired: string[] = []
    const slotTimers = harness.reader['slotTimers']
    slotTimers.set(() => {
      fired.push('first')
      slotTimers.set(() => fired.push('second'), 50)
    }, 100)

    // Act
    harness.elapseSlotClock(200)

    // Assert
    assert.deepEqual(fired, ['first', 'second'])
  } finally {
    await harness.close()
  }
})

// Value: protects=a throwing visible-editors listener of the product failing the workspace test whose editor operation made it throw, without replacing the failure that test already has and without failing twice when the harness closes twice; fails_when=close throws the listener errors (a test that closes in finally loses its own assertion error, and a second close throws again), or keeps the error without ever handing it to the afterEach hook; why_new=Cycle 0050 F405 (F391's close threw an AggregateError after teardown); seam=the harness's close, takeUnreportedListenerErrors and the afterEach hook that reports what it hands over; no_claim=the extension host's log of the error
test('a visible-editors listener that throws is handed to the failure hook once and close neither throws nor throws again', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.focusMutableDraft('closing.txt', 1)
  const throwing = harness.editor.window.onDidChangeVisibleTextEditors(() => {
    throw new Error('Listener failed.')
  })
  await harness.editor.commands.executeCommand(
    'workbench.action.closeActiveEditor',
  )
  throwing.dispose()

  // Act
  await harness.close()
  await harness.close()
  const handedOver = takeUnreportedListenerErrors().map(String)

  // Assert
  assert.deepEqual(handedOver, ['Error: Listener failed.'])
  assert.deepEqual(takeUnreportedListenerErrors(), [])
})

// Value: protects=the fake workspace state answering a stored null as the editor's Memento does, so a reader that stores null is tested against the real answer and not the default; fails_when=the fake treats a stored null like a missing key and answers the default; why_new=Cycle 0050 F399 (workspaceState.get used ?? defaultValue); seam=the harness's fake workspaceState; no_claim=the persistence of the real Memento across restarts
test('the fake workspace state answers a stored null and the default only for a missing key', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    const { workspaceState } = harness

    // Act
    await workspaceState.update('stored-null', null)
    await workspaceState.update('stored-zero', 0)

    // Assert
    assert.equal(workspaceState.get('stored-null', 'fallback'), null)
    assert.equal(workspaceState.get('stored-zero', 'fallback'), 0)
    assert.equal(workspaceState.get('missing', 'fallback'), 'fallback')
  } finally {
    await harness.close()
  }
})

// Value: protects=the fake editor's numbered tab command reporting what the editor reports: a tab that was not in front comes to the front with the active text editor and the visible editors following, and a reselect of the tab in front reports nothing; fails_when=the command changes the front tab with no active-editor or visible-editors report, or reports a reselect, so a test of the reader's reaction to Cursor's own tab switch sees a state the editor never produces; why_new=Cycle 0072 task 5 review round (CodeRabbit r12 and r13c); seam=the harness's fake window.onDidChangeActiveTextEditor, window.onDidChangeVisibleTextEditors and the openEditorAtIndex command; no_claim=the extension host's delivery delay
test('the fake editor reports the active and visible editors when a numbered tab command changes the front tab and nothing for a reselect', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    harness.focusMutableDraft('first.ts', 1)
    harness.focusMutableDraft('second.ts', 1)
    const reports: string[] = []
    const active = harness.editor.window.onDidChangeActiveTextEditor(
      (editor) => {
        reports.push(`active ${editor?.document.uri.path.split('/').at(-1)}`)
      },
    )
    const visible = harness.editor.window.onDidChangeVisibleTextEditors(() => {
      reports.push('visible')
    })

    // Act
    await harness.editor.commands.executeCommand(
      'workbench.action.openEditorAtIndex1',
    )
    const afterSwitch = [...reports]
    await harness.editor.commands.executeCommand(
      'workbench.action.openEditorAtIndex1',
    )
    active.dispose()
    visible.dispose()

    // Assert
    assert.deepEqual(afterSwitch, ['active first.ts', 'visible'])
    assert.deepEqual(reports, afterSwitch)
  } finally {
    await harness.close()
  }
})

// Value: protects=the fake Cursor sending a show into another group, or into another part, to the main editor's last active group while the Agent chat holds the keyboard, and honoring the same show once the main editor holds the keyboard or the requested group is the last active one, as Cursor 3.30.14 did in Cycle 0134 Step 0; fails_when=the model honors every requested column, so a test of the stop files' destination passes although Cursor opens them in the Application's group, or it redirects a show of the last active group too; why_new=Cycle 0134 D25 (Cursor opened an extension run's stop files in front of its view); seam=the harness's redirectShowsBesideChatToLastActiveGroup, fake showTextDocument and focus commands; no_claim=Cursor's rule for every column it redirects (one native show into column 1 with column 2 last active was honored; the model redirects it), or the timing of its focus reports
test('the fake Cursor opens a show beside the chat in the main editor’s last active group and honors it after a focus command', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.focusMutableDraft('first.ts', 1)
    harness.focusMutableDraft('second.ts', 2)
    harness.redirectShowsBesideChatToLastActiveGroup()
    const chat = harness.addSeparateEditorPart()
    for (const name of [
      'redirected.ts',
      'honored-after-first-focus.ts',
      'honored-after-second-focus.ts',
      'beyond-the-main-groups.ts',
      'into-the-chat-group.ts',
    ])
      await writeFile(join(harness.directory, name), 'export {}\n')
    const show = async (name: string, viewColumn: number): Promise<void> => {
      await harness.editor.window.showTextDocument(
        harness.editor.Uri.file(join(harness.directory, name)),
        { viewColumn, preserveFocus: true, preview: false },
      )
    }
    const columnHolding = (name: string): number | undefined =>
      harness.groups.find((group) =>
        group.tabs.some((tab) => tab.label === name),
      )?.viewColumn
    const { commands } = harness.editor
    const chatColumn = harness.groups.length

    // Act
    // The main editor's first group was the last active one when the chat took the keyboard.
    await commands.executeCommand('workbench.action.focusFirstEditorGroup')
    chat.focus()
    await show('redirected.ts', 2)
    const stopFileColumn = harness.debuggerOpensStopFile('unopened-stop.ts', 2)
    // The main editor holds the keyboard: the same show is honored.
    await commands.executeCommand('workbench.action.focusFirstEditorGroup')
    await show('honored-after-first-focus.ts', 2)
    // The second group is the last active one when the chat takes the keyboard back.
    await commands.executeCommand('workbench.action.focusSecondEditorGroup')
    chat.focus()
    await show('honored-after-second-focus.ts', 2)
    // A column past the main editor's groups, which Cursor opens in its Agent part first, ends in the last active group too.
    await show('beyond-the-main-groups.ts', 9)
    // A show into the chat part's real column (the third group) ends in the last active group too.
    await show('into-the-chat-group.ts', chatColumn)

    // Assert
    assert.equal(columnHolding('redirected.ts'), 1)
    assert.equal(stopFileColumn, 1)
    assert.equal(columnHolding('honored-after-first-focus.ts'), 2)
    assert.equal(columnHolding('honored-after-second-focus.ts'), 2)
    assert.equal(columnHolding('beyond-the-main-groups.ts'), 2)
    assert.equal(columnHolding('into-the-chat-group.ts'), 2)
    assert.equal(harness.lastActiveMainColumn(), 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=the fake Cursor's last active main group following the learner's click into a file of a main group, as the editor's does, so a show the chat redirects lands where the learner worked; fails_when=a learner's selection of a file leaves the earlier group as the last active one, so a test of the stop files' destination passes or fails for a group the learner never left; why_new=Cycle 0134 review round (the learner selecting the Application or a file before the next run); seam=the harness's focusMutableDraft and the chat part's focus; no_claim=Cursor's rule for a selection made through a tab strip or a command
test('the fake Cursor treats the group of the file the learner selected as the main editor’s last active group', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.focusMutableDraft('first.ts', 1)
    harness.redirectShowsBesideChatToLastActiveGroup()
    const chat = harness.addSeparateEditorPart()
    chat.focus()

    // Act
    harness.focusMutableDraft('second.ts', 2)
    chat.focus()

    // Assert
    assert.equal(harness.lastActiveMainColumn(), 2)
  } finally {
    await harness.close()
  }
})
