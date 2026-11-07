/**
 * Replays the marked windows of the two Cursor 3.29.9 takes recorded on nextjs-dashboard with the part 2 recorder (Cycle 0094 task 12, decisions D11 to D13).
 *
 * - `cursor-standard-chat-closed` (Agent chat closed: its editor part is an empty second group). Marks: `open-study`, `arrange`, `restore`, `recording`, `reload-window`.
 * - `cursor-reload-chat-open` (the Study open beside the Agent chat). Mark: `reload-window`.
 *
 * Observations of the takes these tests carry:
 * - The first Codebook: Arrange Study Workspace of the chat-closed take (about 12 s after Open Study Workspace, before the `arrange` mark was written) sits inside the `open-study` window; it and then the marked `arrange` and `restore` all showed "A presentation change or reader close is pending. Read its state before another control."; `recording` then worked.
 * - After Reload Window the Study panes do not come back (by design since 0.2.73.1) and the Study's editor groups stay empty; the recorder writes a `reload` event with the unrecorded interval.
 *
 * A window whose replay diverges is a `todo` test with its full intended body and its first divergence named; none is weakened.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { openRetainedStudy, workspaceHarness } from './studyWorkspaceHarness'
import {
  hostTraceWindow,
  parseHostTrace,
  roleNormalize,
  startSnapshot,
} from './utils/hostTraceReplay'
import type { HostTraceWindow } from './utils/hostTraceReplay'

/** The sanitized native take of Cursor 3.29.9 with the Agent chat closed, read from the source tree because the compiled test runs from `dist`. */
const CHAT_CLOSED_TAKE = 'cursor-standard-chat-closed-cursor-3.29.9.jsonl'
/** The sanitized native take of Cursor 3.29.9 with the Agent chat open at the Reload Window. */
const CHAT_OPEN_TAKE = 'cursor-reload-chat-open-cursor-3.29.9.jsonl'

/** What the harness's fixture adds that the native takes did not have: the article source tab and the Repository Wiki tab of the first groups. Dropped from both sides. */
const FIXTURE_ONLY_TABS = ['article-source.ts', 'codebook · Repository Wiki']

/** The refusal every Arrange and Restore of the chat-closed take answered with. */
const PENDING_REFUSAL =
  'A presentation change or reader close is pending. Read its state before another control.'

/**
 * Cuts one window out of a sanitized take.
 * @param fileName - The fixture's file name.
 * @param startLabel - The mark the window starts at.
 * @param endLabel - The mark that ends it, or `undefined` for the take's end.
 * @returns The window.
 * @example takeWindow(CHAT_CLOSED_TAKE, 'arrange', 'restore')
 */
function takeWindow(
  fileName: string,
  startLabel: string,
  endLabel?: string,
): HostTraceWindow {
  const text = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'src',
      'tests',
      'fixtures',
      'host-traces',
      fileName,
    ),
    'utf8',
  )
  return hostTraceWindow(parseHostTrace(text), startLabel, endLabel)
}

/**
 * Builds a harness whose fake Cursor replays `window`, with the Agent chat's editor part closed (an empty second group) the way the chat-closed take starts.
 * @param window - The window to replay.
 * @returns The harness, with the replay still bypassed.
 */
async function chatClosedHarness(window: HostTraceWindow) {
  const harness = await workspaceHarness(false, false, undefined, {
    hostOrder: window.trace,
    hostOrderDelivery: 'with-operation',
  })
  harness.hostOrder!.bypass(true)
  harness.useNativeLayout({ orientation: 1, groups: [{ size: 678 }] })
  harness.addSeparateEditorPart()
  // Chat closed: the editor part stays as an empty group.
  harness.leaveEmptyGroup(2)
  return harness
}

/**
 * Builds the Study workspace the `arrange`, `restore` and `recording` marks start from: Application and captured source stacked in a narrow first column, the Study wide beside them, the Study group active, the chat part empty.
 * @param window - The window to replay.
 * @returns The harness with the replay switched on again.
 */
async function arrangedStudyHarness(window: HostTraceWindow) {
  const harness = await chatClosedHarness(window)
  await openRetainedStudy(harness)
  await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
    orientation: 0,
    groups: [
      { size: 220, groups: [{ size: 608 }, { size: 70 }] },
      { size: 1486 },
    ],
  })
  harness.hostOrder!.bypass(false)
  return harness
}

// Value: protects=Open Study Workspace and the first Arrange after it on the order Cursor 3.29.9 reported them with the Agent chat closed (the open-study window, which holds the take's first Arrange); fails_when=the harness start state differs from the take at the open-study mark, Open or Arrange is refused or times out where the take opened, the final role-normalized groups, active group or layout differ from the take's at the arrange mark, or a burst or trace event is left unaligned; why_new=Cycle 0094 task 12 (D11 windowed replay of the part 2 takes); seam=workspaceHarness hostOrder with-operation delivery, useNativeLayout, addSeparateEditorPart, the reader's open and arrange; no_claim=Cursor's timing beyond the 2 s gap cap, the layout between two events (the fake's layout follows the layout recorded after each delivered event, so a layout read inside a window holds by construction), the pending refusal the take shows after its first Arrange (the harness leaves nothing pending)
test(
  'Open Study Workspace and the first Arrange replay in the order Cursor 3.29.9 reported them with the Agent chat closed',
  {
    todo: 'first divergence: seq 14 (groupsChanged opened groups 2 and 3, 7823 ms) carries the layout recorded before the host reported its own (seq 18: 938/339/339 beside 768), the single group of 678 px of seq 12; it is applied after the setEditorLayout the reader issued, so the fake reverts to one group, the reader never reads its layout back, and open throws "The editor could not reserve separate Codebook panes" after 5 s with no later burst',
  },
  async () => {
    // Arrange: the take's state at its open-study mark, built with harness helpers while the replay is bypassed.
    const window = takeWindow(CHAT_CLOSED_TAKE, 'open-study', 'arrange')
    const harness = await chatClosedHarness(window)
    const replay = harness.hostOrder!
    try {
      replay.bypass(false)
      const options = { dropTabLabels: FIXTURE_ONLY_TABS }
      assert.deepEqual(
        replay.roleNormalizedState(options),
        roleNormalize(startSnapshot(window), options),
        'the harness state at the window start must equal the take at its open-study mark (fixture drift, not a product failure)',
      )

      // Act
      await harness.reader.open()
      await harness.reader.action('arrange')
      await replay.settled()
      await replay.deliverTrailing()
      const result = replay.windowResult(options)

      // Assert
      assert.deepEqual(result.fakeState, result.traceState)
      assert.equal(result.unmatchedModelBursts, 0)
      assert.equal(result.unreachedTraceBursts, 0)
      assert.equal(harness.reader.presentationState().reason, PENDING_REFUSAL)
    } finally {
      await harness.close()
    }
  },
)

// Value: protects=Codebook: Arrange Study Workspace answering the pending refusal the chat-closed take showed while Cursor 3.29.9 still reported its group focus and layout flips; fails_when=the harness start state differs from the take at the arrange mark, the fake's final role-normalized state differs from the take's, a burst or event is left unaligned, or Arrange confirms the layout where the take was refused; why_new=Cycle 0094 task 12 (D11 windowed replay of the part 2 takes); seam=workspaceHarness hostOrder with-operation delivery, openRetainedStudy, the reader's arrange action; no_claim=Cursor's timing beyond the 2 s gap cap, the layout between two events, what left the presentation change pending (it began in the open-study window's Arrange, which does not replay)
test(
  'the marked Arrange of the chat-closed take is refused as pending and ends in the recorded window',
  {
    todo: 'first divergence: the start state equals the take at the arrange mark, but the take answered "A presentation change or reader close is pending" (left by the open-study window\'s Arrange, which does not replay) while the fake confirms the layout (layoutConfirmed true, reason undefined). The final role-normalized state equals the take\'s; the counts reached are 4 unmatched model bursts and 2 unreached trace events',
  },
  async () => {
    // Arrange
    const window = takeWindow(CHAT_CLOSED_TAKE, 'arrange', 'restore')
    const harness = await arrangedStudyHarness(window)
    const replay = harness.hostOrder!
    try {
      const options = { dropTabLabels: FIXTURE_ONLY_TABS }
      assert.deepEqual(
        replay.roleNormalizedState(options),
        roleNormalize(startSnapshot(window), options),
        'the harness state at the window start must equal the take at its arrange mark (fixture drift, not a product failure)',
      )

      // Act
      await harness.reader.action('arrange')
      await replay.settled()
      await replay.deliverTrailing()
      const result = replay.windowResult(options)

      // Assert
      assert.deepEqual(result.fakeState, result.traceState)
      assert.equal(result.unmatchedModelBursts, 4)
      assert.equal(result.unreachedTraceBursts, 2)
      assert.equal(harness.reader.presentationState().reason, PENDING_REFUSAL)
    } finally {
      await harness.close()
    }
  },
)

// Value: protects=Restore answering the pending refusal the chat-closed take showed on Cursor 3.29.9; fails_when=the harness start state differs from the take at the restore mark, the fake's final role-normalized state differs from the take's, a burst or event is left unaligned, or Restore confirms the layout where the take was refused; why_new=Cycle 0094 task 12 (D11 windowed replay of the part 2 takes); seam=workspaceHarness hostOrder with-operation delivery, openRetainedStudy, the reader's arrange action with the restore value; no_claim=Cursor's timing beyond the 2 s gap cap, the layout between two events, what left the presentation change pending
test(
  'the marked Restore of the chat-closed take is refused as pending and ends in the recorded window',
  {
    todo: 'first divergence: as in the arrange window, the take answered "A presentation change or reader close is pending" and the fake answers with no refusal, because the pending change the take carried came from the open-study window\'s Arrange, which does not replay (layoutConfirmed true, reason undefined, 4 unmatched model bursts, 2 unreached trace events)',
  },
  async () => {
    // Arrange
    const window = takeWindow(CHAT_CLOSED_TAKE, 'restore', 'recording')
    const harness = await arrangedStudyHarness(window)
    const replay = harness.hostOrder!
    try {
      const options = { dropTabLabels: FIXTURE_ONLY_TABS }
      assert.deepEqual(
        replay.roleNormalizedState(options),
        roleNormalize(startSnapshot(window), options),
        'the harness state at the window start must equal the take at its restore mark (fixture drift, not a product failure)',
      )

      // Act
      await harness.reader.action('arrange', true)
      await replay.settled()
      await replay.deliverTrailing()
      const result = replay.windowResult(options)

      // Assert
      assert.deepEqual(result.fakeState, result.traceState)
      assert.equal(result.unmatchedModelBursts, 4)
      assert.equal(result.unreachedTraceBursts, 2)
      assert.equal(harness.reader.presentationState().reason, PENDING_REFUSAL)
    } finally {
      await harness.close()
    }
  },
)

// Value: protects=Open Recording replacing the Study panes by the Recorded application beside the captured source on the order Cursor 3.29.9 reported it with the Agent chat closed; fails_when=the recording is refused, or the final role-normalized groups, active group or layout differ from the take's, or a burst or event is left unaligned; why_new=Cycle 0094 task 12 (D11 windowed replay of the part 2 takes); seam=workspaceHarness hostOrder with-operation delivery, openRetainedStudy, the reader's openRecording; no_claim=Cursor's timing beyond the 2 s gap cap, the layout between two events
test(
  'Open Recording closes the Study and shows the Recorded application beside the captured source in the order Cursor 3.29.9 reported it',
  {
    todo: 'first divergence: the start state is not buildable with a recording. recordedReaderHarness, the helper that saves one, takes no hostOrder option, and the retained study of openRetainedStudy has none: openRecording is refused with "No saved recording is available for this study" before any burst (0 unmatched, 24 unreached; the first trace event, seq 84 at 116281 ms, is not reached)',
  },
  async () => {
    // Arrange
    const window = takeWindow(CHAT_CLOSED_TAKE, 'recording', 'reload-window')
    const harness = await arrangedStudyHarness(window)
    const replay = harness.hostOrder!
    try {
      const options = { dropTabLabels: FIXTURE_ONLY_TABS }
      assert.deepEqual(
        replay.roleNormalizedState(options),
        roleNormalize(startSnapshot(window), options),
        'the harness state at the window start must equal the take at its recording mark (fixture drift, not a product failure)',
      )

      // Act
      await harness.reader.openRecording(
        harness.reader.inspect().view!.model.selection.studyId!,
      )
      await replay.settled()
      await replay.deliverTrailing()
      const result = replay.windowResult(options)

      // Assert
      assert.deepEqual(result.fakeState, result.traceState)
      assert.equal(result.unmatchedModelBursts, 0)
      assert.equal(result.unreachedTraceBursts, 0)
    } finally {
      await harness.close()
    }
  },
)

// Value: protects=the Study's editor groups staying empty after Reload Window with the Agent chat closed (the Study panes do not come back, by design since 0.2.73.1); fails_when=the harness start state (the Recorded application beside the captured source) differs from the take at the reload-window mark, or the post-reload groups differ from the take's; why_new=Cycle 0094 task 12 (D11 windowed replay of the part 2 takes); seam=hostTraceWindow at the reload event, the fake editor's leaveEmptyGroup; no_claim=the events of the reload itself (the recorder wrote none for the unrecorded interval), a reader that restores panes
test(
  'after Reload Window with the Agent chat closed the Study panes do not come back and the groups stay empty',
  {
    todo: 'first divergence: the start state is not buildable. It holds the Recorded application beside two captured-source tabs (Open Recording), which the harness cannot produce under hostOrder (see the recording window); the window itself holds no event, because the reload event ends the segment',
  },
  async () => {
    // Arrange
    const window = takeWindow(CHAT_CLOSED_TAKE, 'reload-window')
    const harness = await arrangedStudyHarness(window)
    const replay = harness.hostOrder!
    try {
      const options = { dropTabLabels: FIXTURE_ONLY_TABS }
      assert.deepEqual(
        replay.roleNormalizedState(options),
        roleNormalize(startSnapshot(window), options),
        'the harness state at the window start must equal the take at its reload-window mark (fixture drift, not a product failure)',
      )

      // Act: the editor restores the three main groups empty.
      for (const column of [1, 2, 3]) harness.leaveEmptyGroup(column)
      await replay.settled()
      await replay.deliverTrailing()
      const result = replay.windowResult(options)

      // Assert
      assert.deepEqual(result.fakeState, result.traceState)
      assert.equal(result.unmatchedModelBursts, 0)
      assert.equal(result.unreachedTraceBursts, 0)
    } finally {
      await harness.close()
    }
  },
)

// Value: protects=the Study's editor groups staying empty after Reload Window with the Study open beside the Agent chat (the Study panes do not come back, by design since 0.2.73.1, and the chat's group stays the active one); fails_when=the harness start state (Application, captured source, Study, chat) differs from the take at the reload-window mark, or the groups the editor restores after the reload differ from the take's; why_new=Cycle 0094 task 12 (D11 windowed replay of the part 2 takes); seam=hostTraceWindow at the reload event, openRetainedStudy, addSeparateEditorPart, leaveEmptyGroup, focusTab; no_claim=the product's own behavior at the reload (the window holds no event and the groups are emptied by the harness, so only the start state, the final state and the counts carry the evidence), the events of the reload itself (the recorder wrote none for the unrecorded interval), that a fresh reader opens nothing by itself (its own tests), Cursor's timing
test('after Reload Window with the Agent chat open the Study groups stay empty and the chat group stays active', async () => {
  // Arrange
  const window = takeWindow(CHAT_OPEN_TAKE, 'reload-window')
  const harness = await workspaceHarness(false, false, undefined, {
    hostOrder: window.trace,
    hostOrderDelivery: 'with-operation',
  })
  const replay = harness.hostOrder!
  replay.bypass(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  // The editor answers layout reads for the chat's own part while it is the active part, as the take's single 993 px group shows.
  harness.reportSeparatePartLayout({ orientation: 1, groups: [{ size: 993 }] })
  try {
    await openRetainedStudy(harness)
    chat.focus()
    harness.changeEditorLayout({ orientation: 1, groups: [{ size: 993 }] })
    replay.bypass(false)
    const options = { dropTabLabels: FIXTURE_ONLY_TABS }
    assert.deepEqual(
      replay.roleNormalizedState(options),
      roleNormalize(startSnapshot(window), options),
      'the harness state at the window start must equal the take at its reload-window mark (fixture drift, not a product failure)',
    )

    // Act: the editor restores the three main groups empty and names the chat's group active.
    for (const column of [1, 2, 3]) harness.leaveEmptyGroup(column)
    chat.focusTab()
    await replay.settled()
    await replay.deliverTrailing()
    const result = replay.windowResult(options)

    // Assert
    assert.deepEqual(result.fakeState, result.traceState)
    // The window holds no event (the reload ends the segment), so the one burst of the fake's own emptied groups matches nothing.
    assert.equal(result.unmatchedModelBursts, 1)
    assert.equal(result.unreachedTraceBursts, 0)
  } finally {
    await harness.close()
  }
})
