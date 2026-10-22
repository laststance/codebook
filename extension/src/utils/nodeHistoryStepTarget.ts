import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

/**
 * Finds the event a test replay's Previous or Next moves to, by event or by stop (DS12: Previous stop and Next stop are the transport's primary buttons, Previous event and Next event its secondary ones); called by the Study workspace when the Study pane sends `node-history-step`.
 * Without a selected event, Next moves to the first candidate and Previous to the last.
 * @param entries - The history's events in sequence order.
 * @param current - The selected event's sequence, if any.
 * @param direction - Which way to move.
 * @param unit - `event` moves to any event, `stop` only to stops.
 * @returns The sequence of the event to select, or `undefined` when there is none that way.
 * @example
 * nodeHistoryStepTarget(history.entries, 4, 'next', 'stop') // => 7, the next stop after event 4
 */
export function nodeHistoryStepTarget(
  entries: readonly NodeTestHistoryIndex['entries'][number][],
  current: number | undefined,
  direction: 'previous' | 'next',
  unit: 'event' | 'stop' = 'event',
): number | undefined {
  const candidates =
    unit === 'stop' ? entries.filter((entry) => entry.type === 'stop') : entries
  if (current === undefined)
    return (direction === 'next' ? candidates[0] : candidates.at(-1))?.sequence
  return (
    direction === 'next'
      ? candidates.find((entry) => entry.sequence > current)
      : candidates.findLast((entry) => entry.sequence < current)
  )?.sequence
}
