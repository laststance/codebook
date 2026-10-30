import assert from 'node:assert/strict'
import { test } from 'node:test'

import { recordedReaderHarness } from './studyWorkspaceHarness'
import {
  advanceClockUntil,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'

// Value: protects=a replay opened from Cursor 3.27.22's Agent chat arranges the panes with no manual click; fails_when=the borrow runs the first-group focus command that does nothing there and the wait ends in the unreported-focus refusal, or the give-back waits for a group the editor never names; why_new=Cycle 0063 N63-F5 measured natively (focusFirstEditorGroup is a no-op from the chat, reveal(One, false) moves the keyboard but activeTabGroup keeps naming the chat); seam=ignoresFirstGroupFocusCommandBesideChat; no_claim=the real Cursor's answer (native Cursor trial)
test("a recording opened from Cursor 3.27.22's Agent chat, where the first-group focus command does nothing, is arranged by revealing the pane in the first group", async (context) => {
  // Arrange
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.ignoresFirstGroupFocusCommandBesideChat()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    harness.focusMutableDraft('auth.ts', 2)
    chat.focusTab()
    await harness.reader.readPresentationState()

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
    assert.equal(opened.layoutConfirmed, true)
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

// Value: protects=a recording opened from Cursor 3.27.22's Agent chat, where the first-group focus command does work and the main editor reports its focus at once, is not revealed in the first group a second time with the keyboard; fails_when=the probe reveals the pane although the main editor's focus was proven within the probe window, which takes the keyboard from the editor the command just focused; why_new=Cycle 0064 pt2 /ship coverage audit; seam=the default fake editor, where the first-group focus command works, with a spy on the reader's pane reveals; no_claim=the real Cursor's answer (native Cursor trial)
test("a recording opened from Cursor's Agent chat, where the first-group focus command works, does not reveal the pane in the first group with the keyboard again", async (context) => {
  // Arrange
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  const keyboardReveals: unknown[][] = []
  const revealPane = harness.reader['revealPane'].bind(harness.reader)
  harness.reader['revealPane'] = (panel, column, preserveFocus): void => {
    if (column === 1 && !preserveFocus)
      keyboardReveals.push([column, preserveFocus])
    revealPane(panel, column, preserveFocus)
  }
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    harness.focusMutableDraft('auth.ts', 2)
    chat.focusTab()
    await harness.reader.readPresentationState()
    keyboardReveals.length = 0

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
    assert.equal(harness.controller.state().reason, undefined)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.deepEqual(keyboardReveals, [])
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

// Value: protects=a learner's tab brought to the front of the first group while the borrow waits for the first-group focus command's effect is not covered again by the Codebook pane with the keyboard; fails_when=the expired probe reveals the earlier pane with the keyboard over the learner's tab, so the learner's choice is replaced and the later input check sees the Codebook tab as unchanged; why_new=Cycle 0064 pt2 /ship Step 11 Codex structured review; seam=ignoresFirstGroupFocusCommandBesideChat (the command does nothing), addForeignWebviewTab 100 ms into the probe, a spy on the reader's pane reveals; no_claim=the real Cursor's answer (native Cursor trial)
test("a recording opened from Cursor 3.27.22's Agent chat does not reveal the pane in the first group when the learner brought another tab to its front during the probe", async (context) => {
  // Arrange
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.ignoresFirstGroupFocusCommandBesideChat()
  const keyboardReveals: unknown[][] = []
  const revealPane = harness.reader['revealPane'].bind(harness.reader)
  harness.reader['revealPane'] = (panel, column, preserveFocus): void => {
    if (column === 1 && !preserveFocus)
      keyboardReveals.push([column, preserveFocus])
    revealPane(panel, column, preserveFocus)
  }
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    harness.focusMutableDraft('auth.ts', 2)
    chat.focusTab()
    await harness.reader.readPresentationState()
    keyboardReveals.length = 0
    enableFakeClock(context)
    const executeEditorCommand = harness.reader['executeEditorCommand'].bind(
      harness.reader,
    )
    // The learner opens a Markdown preview in the first group 100 ms after the focus command was sent, inside the probe.
    harness.reader['executeEditorCommand'] = (async (
      name: string,
      ...args: unknown[]
    ) => {
      const answer = await executeEditorCommand(name, ...args)
      if (name === 'workbench.action.focusFirstEditorGroup')
        setTimeout(
          () =>
            harness.addForeignWebviewTab(
              'markdown.preview',
              'Preview README.md',
              1,
            ),
          100,
        )
      return answer
    }) as (typeof harness.reader)['executeEditorCommand']

    // Act
    harness.controller.command({
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await advanceClockUntil(
      context,
      () => harness.controller.state().readiness !== 'loading',
      6_000,
    )
    resetFakeClock(context)
    await harness.controller.settle()

    // Assert
    const firstGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.deepEqual(keyboardReveals, [])
    assert.equal(firstGroup.activeTab?.label, 'Preview README.md')
    assert.equal(
      harness.controller.state().reason,
      'Error: The primary editor selection changed during scope measurement; the newer learner focus was preserved.',
    )
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

// Value: protects=a slow first-group focus command does not use up the wait for the main editor's focus report: only the probe after the command counts against the five-second bound; fails_when=the time the command itself took is subtracted from the wait, so a command answering after 4.7 s leaves no time for the report that follows the reveal and the open ends in the unreported-focus refusal; why_new=Cycle 0064 pt2 /ship local CodeRabbit round 2; seam=ignoresFirstGroupFocusCommandBesideChat with focusRevealedPanesLater (the keyboard reaches the revealed pane a moment after the reveal), a focus command answered 4.7 s late on the fake clock; no_claim=the real Cursor's answer (native Cursor trial)
test("a recording opened from Cursor 3.27.22's Agent chat opens although the first-group focus command answers 4.7 seconds late", async (context) => {
  // Arrange
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.ignoresFirstGroupFocusCommandBesideChat()
  harness.focusRevealedPanesLater()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    harness.focusMutableDraft('auth.ts', 2)
    chat.focusTab()
    await harness.reader.readPresentationState()
    enableFakeClock(context)
    const executeEditorCommand = harness.reader['executeEditorCommand'].bind(
      harness.reader,
    )
    harness.reader['executeEditorCommand'] = (async (
      name: string,
      ...args: unknown[]
    ) => {
      const answer = await executeEditorCommand(name, ...args)
      // gstack-timing-ok: the command's own 4.7 s answer time is the contract, advanced on the fake clock.
      if (name === 'workbench.action.focusFirstEditorGroup')
        await new Promise<void>((resolve) => setTimeout(resolve, 4_700))
      return answer
    }) as (typeof harness.reader)['executeEditorCommand']

    // Act
    harness.controller.command({
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await advanceClockUntil(
      context,
      () => harness.controller.state().readiness !== 'loading',
      20_000,
    )
    resetFakeClock(context)
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().reason, undefined)
    assert.equal(harness.controller.state().readiness, 'ready')
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

// Value: protects=a measurement that borrows the main editor's focus while the Application pane of the first group still reports itself active beside Cursor 3.27.22's Agent chat hands the keyboard back to that pane on the pane's own report; fails_when=the give-back wait demands the editor to name the pane's group, which Cursor never does there, and the open ends in the unreported-focus refusal; why_new=Cycle 0064 pt2 task 4 give-back red proof; seam=holdPaneDeactivation + ignoresFirstGroupFocusCommandBesideChat; no_claim=the real Cursor's answer (native Cursor trial)
test("a recording opened from Cursor 3.27.22's Agent chat while the Application pane still reports itself active gets the keyboard back to the pane on its own report", async (context) => {
  // Arrange
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.ignoresFirstGroupFocusCommandBesideChat()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    harness.focusMutableDraft('auth.ts', 2)
    harness.holdPaneDeactivation('codebook.scopedBrowser')
    chat.focusTab()
    await harness.reader.readPresentationState()

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
    assert.equal(opened.layoutConfirmed, true)
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})
