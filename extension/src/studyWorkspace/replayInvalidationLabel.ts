import { REPLAY_COVERED_LABEL, REPLAY_LOADING_LABEL } from '../constants'

/**
 * Chooses what native Run and Debug's thread and stop description read while a replay moment is retired before the next one shows (Cycle 0137, C1-L, D4).
 * Why it exists: "Not recorded at this moment" belongs to intervals without history (PRODUCT_GOAL.md, 4A); a recorded moment that is only loading, or only covered by another tab, must not read like one.
 * Called by {@link StudyWorkspace} for the playback controller's `invalidate`.
 * @param isApplicationCovered - Whether another tab covers the recorded application.
 * @param loadsHistory - Whether the moment that replaces the shown one has recorded debugger history.
 * @returns
 * - {@link REPLAY_COVERED_LABEL} while the recorded application is covered
 * - {@link REPLAY_LOADING_LABEL} while a moment with recorded history loads
 * - `undefined` otherwise, so the session keeps its own "Not recorded at this moment"
 * @example
 * replayInvalidationLabel(false, true)  // => 'Loading recorded values…'
 * replayInvalidationLabel(false, false) // => undefined
 * replayInvalidationLabel(true, true)   // => 'Recorded application is covered by another tab'
 */
export function replayInvalidationLabel(
  isApplicationCovered: boolean,
  loadsHistory: boolean | undefined,
): typeof REPLAY_COVERED_LABEL | typeof REPLAY_LOADING_LABEL | undefined {
  if (isApplicationCovered) return REPLAY_COVERED_LABEL
  return loadsHistory ? REPLAY_LOADING_LABEL : undefined
}
