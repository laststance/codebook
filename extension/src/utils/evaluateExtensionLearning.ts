import type { ExtensionHistoryEntry } from '../chromeExtensionHistorySchemas'

import type { NodeServerLearningCoverage } from './evaluateNodeServerLearning'

/** One citation an extension history's learning material still owes: the captured stop (by its capture's sequence, with its declared stop and context) or the result. */
export type ExtensionLearningPart =
  | { type: 'result'; sequence: number }
  | {
      type: 'stop'
      sequence: number
      stopIndex: number
      context: string
    }

/** How much of an extension history the chat's material explains; the same values as a server history's. */
export type ExtensionLearningCoverage = NodeServerLearningCoverage

/**
 * Decides the learning-complete verdict of a chrome-extension history: the material cites every captured pause (its capture or its `pause-open`) and the recorded result.
 * Called by the extension descriptor when it summarizes a history, so the store, Save and the run resource read one verdict.
 * @param entries - The journal's entries.
 * @param citedSequences - The sequences the saved material cites; `undefined` before any material was saved.
 * @returns The coverage and every citation still owed, in journal order.
 * @example evaluateExtensionLearning(entries, new Set([3, 6])) // => { coverage: 'complete', missing: [] }
 */
export function evaluateExtensionLearning(
  entries: readonly ExtensionHistoryEntry[],
  citedSequences: ReadonlySet<number> | undefined,
): { coverage: ExtensionLearningCoverage; missing: ExtensionLearningPart[] } {
  const needs: Array<{ part: ExtensionLearningPart; satisfiedBy: number[] }> =
    []
  const opened = new Map(
    entries
      .filter((entry) => entry.type === 'pause-open')
      .map((entry) => [entry.pauseId, entry]),
  )
  for (const entry of entries) {
    if (entry.type !== 'capture') continue
    const pause = opened.get(entry.pauseId)
    // A capture whose pause the journal never opened cannot be explained; the journal rules refuse such a journal.
    if (!pause) continue
    needs.push({
      part: {
        type: 'stop',
        sequence: entry.sequence,
        stopIndex: pause.stopIndex,
        context: pause.context,
      },
      satisfiedBy: [entry.sequence, pause.sequence],
    })
  }
  const result = entries.find((entry) => entry.type === 'result')
  if (result)
    needs.push({
      part: { type: 'result', sequence: result.sequence },
      satisfiedBy: [result.sequence],
    })
  const missing = needs
    .filter(
      ({ satisfiedBy }) =>
        !satisfiedBy.some((sequence) => citedSequences?.has(sequence)),
    )
    .map(({ part }) => part)
  if (needs.length > 0 && missing.length === needs.length)
    return { coverage: 'none', missing }
  return { coverage: missing.length === 0 ? 'complete' : 'partial', missing }
}
