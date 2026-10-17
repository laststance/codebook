import type { PresentationState } from '../presentationSchemas'

/**
 * Says whether a Return Current that met a closed Study workspace did all a closed reader does: it remembers the current run in Live as its selection, which the Study shows once it opens (Cycle 0046 row 616), and there is no native source to display while it stays closed. Asked by {@link StudyWorkspace.returnToCurrent} after the Return, which then answers this state, closed and following the current run, instead of refusing for a source that cannot be displayed (row 697).
 * @param state - The reader's presentation state right after the Return.
 * @returns
 * - `true` for a closed reader whose selection follows the current run in its Live tab
 * - `false` for an open or applying reader, and for a selection that does not follow the current run in Live
 * @example
 * isCurrentRunRememberedWhileClosed({ ...state, state: 'closed', reader: { contentRevision: 17, contentTab: 'live', followingCurrentRun: true } }) // => true
 * isCurrentRunRememberedWhileClosed({ ...state, state: 'open', reader: { contentRevision: 17, contentTab: 'live', followingCurrentRun: true } }) // => false
 */
export function isCurrentRunRememberedWhileClosed(
  state: Pick<PresentationState, 'state' | 'reader'>,
): boolean {
  return (
    state.state === 'closed' &&
    state.reader.followingCurrentRun &&
    state.reader.contentTab === 'live'
  )
}
