import { landsOn } from './landsOn'
import type { Harness } from './testReplayCompositionHarness'
import { saveTwoStopNodeHistory } from './twoStopNodeHistory'

/**
 * Opens the Study composition, then a saved two-stop test replay by the status item's Open replay, and waits for its first stop.
 * @param harness - The workspace harness.
 * @returns The replay's header.
 * @example const history = await openByOpenReplay(harness)
 */
export async function openByOpenReplay(harness: Harness) {
  const history = await saveTwoStopNodeHistory(
    harness.service.nodeHistoryStore!,
  )
  await harness.reader.action('retry')
  await harness.reader.open()
  await harness.reader.openLearningReplay(history.studyId)
  await landsOn(harness, 2, 'Open replay lands on the first stop')
  return history
}
