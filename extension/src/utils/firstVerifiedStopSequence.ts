import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import { nodeStopSourceMatches } from './nodeStopSourceMatches'

/**
 * Finds where a test replay opened without a saved reader position lands: its first stop whose captured source verifies, so the learner meets recorded source and debugger state instead of an output banner (DS1); called by {@link StudyWorkspace.openNodeHistory} for the replay's first selection and its playback controller.
 * @param history - The verified history.
 * @returns The journal sequence of the first verified stop; `undefined` when no stop verifies, where the replay opens on its first event.
 * @example firstVerifiedStopSequence(history) // => 2 for an output, then a verified stop
 */
export function firstVerifiedStopSequence(
  history: Pick<NodeTestHistoryIndex, 'entries'>,
): number | undefined {
  return history.entries.find(
    (entry) => entry.type === 'stop' && nodeStopSourceMatches(entry),
  )?.sequence
}
