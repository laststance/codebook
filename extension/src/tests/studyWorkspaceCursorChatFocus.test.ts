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
