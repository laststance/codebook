import { waitUntil } from '../../runtimeSupport/utils/waitUntil'

import { READER_RESULT_BOUND_MS } from './readerResultBound'
import type { Harness } from './testReplayCompositionHarness'
import { lastView } from './twoStopNodeHistory'

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
