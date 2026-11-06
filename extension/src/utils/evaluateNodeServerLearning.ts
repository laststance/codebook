import type { NodeServerHistoryEntry } from '../nodeServerHistorySchemas'

/** One citation a node run's learning material still owes, and the journal sequences that would satisfy it. */
export type LearningNeed<Part> = { part: Part; satisfiedBy: number[] }

/** A stop citation a learning material owes: the first recorded hit of a reached declared stop. */
export type StopLearningPart = {
  type: 'stop'
  sequence: number
  declaredStopIndex: number
  hit: number
}

/**
 * Lists one need per reached declared stop: the material must cite at least one recorded hit of it.
 * @param entries - The journal's entries.
 * @returns The stop needs in declared-stop order of first hit.
 * @example stopLearningNeeds(entries)[0]?.part.declaredStopIndex // => 0
 */
export function stopLearningNeeds(
  entries: ReadonlyArray<{
    type: string
    sequence: number
    declaredStopIndex?: number
    hit?: number
  }>,
): Array<LearningNeed<StopLearningPart>> {
  const hitsByStop = new Map<number, Array<{ sequence: number; hit: number }>>()
  for (const { type, sequence, declaredStopIndex, hit } of entries)
    if (type === 'stop' && declaredStopIndex !== undefined && hit !== undefined)
      hitsByStop.set(declaredStopIndex, [
        ...(hitsByStop.get(declaredStopIndex) ?? []),
        { sequence, hit },
      ])
  return [...hitsByStop].map(([declaredStopIndex, hits]) => ({
    part: {
      type: 'stop',
      sequence: hits[0]!.sequence,
      declaredStopIndex,
      hit: hits[0]!.hit,
    },
    satisfiedBy: hits.map((hit) => hit.sequence),
  }))
}

/**
 * Decides the verdict of a set of needs against the sequences the saved material cites: `none` when needs exist and none is cited, `complete` when all are, else `partial`.
 * @param needs - Every citation the material owes.
 * @param citedSequences - The sequences the saved material cites; `undefined` before any material was saved.
 * @returns The coverage and every citation still owed, in journal order.
 * @example settleLearningNeeds([], undefined) // => { coverage: 'complete', missing: [] }
 */
export function settleLearningNeeds<Part extends { sequence: number }>(
  needs: ReadonlyArray<LearningNeed<Part>>,
  citedSequences: ReadonlySet<number> | undefined,
): { coverage: NodeServerLearningCoverage; missing: Part[] } {
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

/** One citation a server history's learning material still owes: the entry a step should cite, with its declared stop and hit for a stop. */
export type NodeServerLearningPart =
  | {
      type: 'sign-in' | 'request' | 'response' | 'request-failed'
      sequence: number
    }
  | { type: 'stop'; sequence: number; declaredStopIndex: number; hit: number }

/** How much of a server history the chat's material explains: `none` before any needed entry is cited, `complete` when every need is, else `partial`. */
export type NodeServerLearningCoverage = 'none' | 'partial' | 'complete'

/**
 * Decides the learning-complete verdict of a server history: the material cites the request (or, when no request was made, the sign-in), at least one recorded hit of every reached declared stop and the recorded terminal entry; further hits and output are optional, and `source` and `end` are never required.
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
  const needs: Array<LearningNeed<NodeServerLearningPart>> = []
  const request = entries.findLast((entry) => entry.type === 'request')
  if (request)
    needs.push({
      part: { type: 'request', sequence: request.sequence },
      satisfiedBy: [request.sequence],
    })
  else {
    // A history with no request (a failed sign-in, or a run that ended after signing in) still owes one explanation, citing the sign-in.
    const signIn = entries.find((entry) => entry.type === 'sign-in')
    if (signIn)
      needs.push({
        part: { type: 'sign-in', sequence: signIn.sequence },
        satisfiedBy: [signIn.sequence],
      })
  }
  needs.push(...stopLearningNeeds(entries))
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
  return settleLearningNeeds(needs, citedSequences)
}
