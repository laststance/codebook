import type { NodeScriptHistoryEntry } from '../nodeScriptHistorySchemas'

import {
  settleLearningNeeds,
  stopLearningNeeds,
  type LearningNeed,
  type NodeServerLearningCoverage,
  type StopLearningPart,
} from './evaluateNodeServerLearning'

/** One citation a script history's learning material still owes: a recorded hit of a reached declared stop, or the end. */
export type NodeScriptLearningPart =
  StopLearningPart | { type: 'end'; sequence: number }

/**
 * Decides the learning-complete verdict of a script history: the material cites at least one recorded hit of every reached declared stop and the recorded end; output is optional, and `source` entries are never required.
 * Called by the store when it summarizes a script history, by Save and by the MCP resources; the answers cap `missing` with {@link capMissingList}.
 * @param entries - The journal's entries.
 * @param citedSequences - The sequences the saved material cites; `undefined` before any material was saved.
 * @returns The coverage and every citation still owed, in journal order.
 * @example evaluateNodeScriptLearning(entries, new Set([2, 5])) // => { coverage: 'complete', missing: [] }
 */
export function evaluateNodeScriptLearning(
  entries: readonly NodeScriptHistoryEntry[],
  citedSequences: ReadonlySet<number> | undefined,
): { coverage: NodeServerLearningCoverage; missing: NodeScriptLearningPart[] } {
  const needs: Array<LearningNeed<NodeScriptLearningPart>> =
    stopLearningNeeds(entries)
  const end = entries.find((entry) => entry.type === 'end')
  if (end)
    needs.push({
      part: { type: 'end', sequence: end.sequence },
      satisfiedBy: [end.sequence],
    })
  return settleLearningNeeds(needs, citedSequences)
}
