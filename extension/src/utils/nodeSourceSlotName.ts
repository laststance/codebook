import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import { nodeStopSourceMatches } from './nodeStopSourceMatches'

/**
 * Chooses the file a test replay's recorded-source slot is named after while it holds the placeholder and has no name yet: the file of the replay's first stop whose source verifies, so landing on that stop later does not rename the slot, else the test file; called by {@link StudyWorkspace.showNodeSourceSlot} when a replay opens on an output, the result or an unverified stop.
 * @param history - The test replay.
 * @returns A repository-relative path.
 * @example
 * nodeSourceSlotName(historyWithStopInScheduler) // => 'src/jobs/scheduler.ts'
 * nodeSourceSlotName(historyWithoutVerifiedStop) // => 'src/jobs/scheduler.test.ts'
 */
export function nodeSourceSlotName(history: {
  header: {
    configuration: Pick<
      NodeTestHistoryIndex['header']['configuration'],
      'testFile'
    >
  }
  entries: NodeTestHistoryIndex['entries']
}): string {
  for (const entry of history.entries)
    if (entry.type === 'stop' && nodeStopSourceMatches(entry))
      return entry.source.path
  return history.header.configuration.testFile
}
