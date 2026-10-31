import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { workspaceHarness } from './studyWorkspaceHarness'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { lastView, saveTwoStopNodeHistory } from './utils/twoStopNodeHistory'

type Harness = Awaited<ReturnType<typeof workspaceHarness>>

/**
 * Opens a saved two-stop test replay and presents its second stop through the reader's debugger presentation, while `afterSlotAnswered` runs in the window between the slot's answer and the reader's commit.
 * @param harness - The workspace harness with a saved two-stop test replay.
 * @param afterSlotAnswered - Runs synchronously once the slot answered; it plays the newer selection, the close or the caller's withdrawal.
 * @param isCurrent - The caller's answer handed to the presentation.
 * @returns What the presentation answered.
 * @example const presented = await presentSecondStop(harness, () => {}, () => true)
 */
async function presentSecondStop(
  harness: Harness,
  afterSlotAnswered: () => void,
  isCurrent: () => boolean,
): Promise<boolean> {
  const reader = harness.reader
  const history = await saveTwoStopNodeHistory(
    harness.service.nodeHistoryStore!,
  )
  await reader.action('retry')
  await reader.openLearningReplay(history.studyId)
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
      !lastView(harness)?.loading,
    'the test replay lands on its first stop',
    READER_RESULT_BOUND_MS,
  )
  const stops = reader['selectedNodeHistory']!.entries.flatMap((entry) =>
    entry.type === 'stop' ? [entry] : [],
  )
  const slotUri = reader['nodeSourceSlot']!.uri
  const slot = reader['replayDebuggers']
  const answer = slot.presentFor.bind(slot)
  // The slot answers for real, then the window before the reader's commit opens.
  slot.presentFor = async (isSuperseded, present) => {
    const result = await answer(isSuperseded, present)
    afterSlotAnswered()
    return result
  }
  return reader['presentNodeHistoryDebuggerOrKeepOpen'](
    stops[1],
    slotUri,
    reader['selectedNodeHistoryRequest'],
    false,
    isCurrent,
  )
}

// Value: protects=a stop presented for a selection that a newer selection overtook after the slot answered writes no debug flag: the newer selection's two flags stay; fails_when=the reader commits the older answer (debug available, values inspected) over the newer selection's flags (not available, values uninspected); seam=the live ReplayDebuggerSlot.presentFor wrapped to run the takeover right after its answer; no_claim=the newer selection's own presentation
test('a stop whose selection a newer selection overtook after the slot answered leaves the newer selection flags', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const reader = harness.reader

    // Act
    const presented = await presentSecondStop(
      harness,
      () => {
        reader['selectedNodeHistoryRequest']++
        reader['selectedNodeHistoryDebugAvailable'] = false
        reader['selectedNodeHistoryValuesUninspected'] = true
      },
      () => true,
    )

    // Assert
    assert.equal(presented, false)
    assert.equal(reader['selectedNodeHistoryDebugAvailable'], false)
    assert.equal(reader['selectedNodeHistoryValuesUninspected'], true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a stop presented for a reader that closed after the slot answered writes no debug flag: the closed reader keeps no Run and Debug hint or availability; fails_when=the older answer sets debug available after the close cleared it; seam=the live ReplayDebuggerSlot.presentFor wrapped to start the reader's close right after its answer; no_claim=the rest of the close
test('a stop whose reader closed after the slot answered leaves the flags the close cleared', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const reader = harness.reader
    let closing: Promise<void> | undefined

    // Act
    const presented = await presentSecondStop(
      harness,
      () => {
        closing = reader.close()
      },
      () => true,
    )
    await closing

    // Assert
    assert.equal(presented, false)
    assert.equal(reader['selectedNodeHistoryDebugAvailable'], false)
    assert.equal(reader['selectedNodeHistoryValuesUninspected'], false)
  } finally {
    await harness.close()
  }
})

// Value: protects=a stop whose caller withdrew after the slot answered (a newer seek abandoned the step) writes no debug flag; fails_when=the reader commits the answer although the caller no longer wants it; seam=the live ReplayDebuggerSlot.presentFor wrapped to withdraw the caller right after its answer; no_claim=Play's own pacing
test('a stop whose caller withdrew after the slot answered leaves the flags as they were', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const reader = harness.reader
    let wanted = true

    // Act
    const presented = await presentSecondStop(
      harness,
      () => {
        wanted = false
        reader['selectedNodeHistoryDebugAvailable'] = false
        reader['selectedNodeHistoryValuesUninspected'] = true
      },
      () => wanted,
    )

    // Assert
    assert.equal(presented, false)
    assert.equal(reader['selectedNodeHistoryDebugAvailable'], false)
    assert.equal(reader['selectedNodeHistoryValuesUninspected'], true)
  } finally {
    await harness.close()
  }
})
