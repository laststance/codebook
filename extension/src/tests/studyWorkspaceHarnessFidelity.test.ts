import assert from 'node:assert/strict'
import { test } from 'node:test'

import { workspaceHarness } from './studyWorkspaceHarness'

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

// Value: protects=a throwing visible-editors listener of the product failing the workspace test whose editor operation made it throw, as the extension host would log it and leave a stale slot decoration; fails_when=the harness keeps a listener error without ever failing the test (the error is only readable by a test that asks), or fails a test that declared the error with expectVisibleEditorListenerErrors; why_new=Cycle 0050 F391 (every tab close now fires the event while the catch hid a throwing listener from all but one test); seam=the harness's close and its visible-editors listener isolation; no_claim=the extension host's log of the error
test('a visible-editors listener that throws fails the test whose close caused it unless the test declared it', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.focusMutableDraft('closing.txt', 1)
  const throwing = harness.editor.window.onDidChangeVisibleTextEditors(() => {
    throw new Error('Listener failed.')
  })

  // Act
  await harness.editor.commands.executeCommand(
    'workbench.action.closeActiveEditor',
  )
  throwing.dispose()

  // Assert
  await assert.rejects(
    harness.close(),
    /onDidChangeVisibleTextEditors threw 1 time\(s\) during the test: Error: Listener failed\./,
  )
})
