import type { NodeServerHistoryEntry } from '../nodeServerHistorySchemas'

/** One citation a server history's learning material still owes: the entry a step should cite, with its declared stop and hit for a stop. */
export type NodeServerLearningPart =
  | { type: 'request' | 'response' | 'request-failed'; sequence: number }
  | { type: 'stop'; sequence: number; declaredStopIndex: number; hit: number }

/** How much of a server history the chat's material explains: `none` before any needed entry is cited, `complete` when every need is, else `partial`. */
export type NodeServerLearningCoverage = 'none' | 'partial' | 'complete'

/**
 * Decides the learning-complete verdict of a server history: the material cites the request, at least one recorded hit of every reached declared stop and the recorded terminal entry; further hits and output are optional, and `source` and `end` are never required.
 * Called by the store when it summarizes a server history, by Save and by the MCP resources; the answers cap `missing` with {@link capMissingList}.
 * @param entries - The journal's entries.
 * @param citedSequences - The sequences the saved material cites; `undefined` before any material was saved.
 * @returns The coverage and every citation still owed, in journal order.
 * @example evaluateNodeServerLearning(entries, new Set([1, 3, 6])) // => { coverage: 'complete', missing: [] }
 */
export function evaluateNodeServerLearning(
  entries: readonly NodeServerHistoryEntry[],
  citedSequences: ReadonlySet<number> | undefined,
): { coverage: NodeServerLearningCoverage; missing: NodeServerLearningPart[] } {
  const needs: Array<{ part: NodeServerLearningPart; satisfiedBy: number[] }> =
    []
  const request = entries.findLast((entry) => entry.type === 'request')
  if (request)
    needs.push({
      part: { type: 'request', sequence: request.sequence },
      satisfiedBy: [request.sequence],
    })
  const hitsByStop = new Map<number, Array<{ sequence: number; hit: number }>>()
  for (const entry of entries)
    if (entry.type === 'stop')
      hitsByStop.set(entry.declaredStopIndex, [
        ...(hitsByStop.get(entry.declaredStopIndex) ?? []),
        { sequence: entry.sequence, hit: entry.hit },
      ])
  for (const [declaredStopIndex, hits] of hitsByStop)
    needs.push({
      part: {
        type: 'stop',
        sequence: hits[0]!.sequence,
        declaredStopIndex,
        hit: hits[0]!.hit,
      },
      satisfiedBy: hits.map((hit) => hit.sequence),
    })
  const terminal = entries.find(
    (entry) => entry.type === 'response' || entry.type === 'request-failed',
  )
  if (
    terminal &&
    (terminal.type === 'response' || terminal.type === 'request-failed')
  )
    needs.push({
      part: { type: terminal.type, sequence: terminal.sequence },
      satisfiedBy: [terminal.sequence],
    })
  const unmet = needs.filter(
    ({ satisfiedBy }) =>
      !satisfiedBy.some((sequence) => citedSequences?.has(sequence)),
  )
  const missing = unmet
    .map(({ part }) => part)
    .sort((left, right) => left.sequence - right.sequence)
  if (needs.length > 0 && unmet.length === needs.length)
    return { coverage: 'none', missing }
  return { coverage: missing.length === 0 ? 'complete' : 'partial', missing }
}
