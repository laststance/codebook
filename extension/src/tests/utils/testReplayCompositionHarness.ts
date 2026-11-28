// Fixtures of the test-replay composition tests (studyWorkspaceTestReplayComposition*.test.ts partitions).
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import type { workspaceHarness } from '../studyWorkspaceHarness'

import { READER_RESULT_BOUND_MS } from './readerResultBound'
import { lastView, saveTwoStopNodeHistory } from './twoStopNodeHistory'

export type Harness = Awaited<ReturnType<typeof workspaceHarness>>

/**
 * Waits until the selected test replay shows one committed moment.
 * @param harness - The workspace harness.
 * @param sequence - The event the replay should show.
 * @param description - What the wait is for, named in its timeout.
 * @example await landsOn(harness, 2, 'the test replay lands on its first stop')
 */
export async function landsOn(
  harness: Harness,
  sequence: number,
  description: string,
): Promise<void> {
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence === sequence &&
      !lastView(harness)?.nodeHistoryPosition?.pending &&
      !lastView(harness)?.loading,
    description,
    READER_RESULT_BOUND_MS,
  )
}

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

/**
 * Reads the parts of the composition a test replay's open decides.
 * @param harness - The workspace harness.
 * @returns Whether the Study pane, the Application pane and the Learning summary show, and the family the panes are told.
 * @example compositionOf(harness) // => { studyPane: false, application: true, summary: true, family: 'test' }
 */
export function compositionOf(harness: Harness) {
  return {
    studyPane: harness.panelColumn('codebook.studyContext') !== undefined,
    application: harness.panelColumn('codebook.scopedBrowser') !== undefined,
    summary: harness.summary.visible,
    family: lastView(harness)?.replayFamily,
  }
}
