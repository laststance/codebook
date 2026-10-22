import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import { nodeStopSourceMatches } from './nodeStopSourceMatches'
import { projectHistoricalTimeline } from './projectHistoricalTimeline'

/** What the test replay's time slider draws: the recorded range, its unrecorded spans and a tick for each recorded stop. */
export type NodeHistoryTimeline = {
  startMs: number
  endMs: number
  /** The spans in which source and debugger were not recorded. */
  gaps: Array<{ startMs: number; endMs: number }>
  /** The time of each stop whose captured source verifies. */
  recordedPoints: number[]
}

/**
 * Maps a test replay's journal onto the shared coverage timeline: the whole range from the first to the last event is one unrecorded span, and each stop whose captured source verifies is a tick.
 *
 * A test journal records when a stop paused but not when the run resumed, so no interval is known to be recorded; the adapter hands {@link projectHistoricalTimeline} an empty list of paused intervals (an undefined list would answer `unknown`).
 * Called by {@link StudyWorkspace} while it projects the Study pane's test replay section; the slider itself stays an event navigator.
 *
 * @param history - The test replay's events in journal order.
 * @returns The range, its one gap and the ticks; `undefined` for a history of fewer than two events or of events all at one time, which have nothing to mark.
 * @example
 * projectNodeHistoryTimeline({ entries: [output0s, verifiedStop1s, result2s] }) // => { startMs: 0, endMs: 2000, gaps: [{ startMs: 0, endMs: 2000 }], recordedPoints: [1000] }
 */
export function projectNodeHistoryTimeline(
  history: Pick<NodeTestHistoryIndex, 'entries'>,
): NodeHistoryTimeline | undefined {
  const first = history.entries[0],
    last = history.entries.at(-1)
  // One event, or events at one time, have no span to mark (the browser transport draws none either).
  if (!first || !last || last.elapsedMs <= first.elapsedMs) return undefined
  const range = { startMs: first.elapsedMs, endMs: last.elapsedMs }
  const timeline = projectHistoricalTimeline(
    {
      pausedIntervals: [],
      study: {
        observations: history.entries.flatMap((entry) =>
          // An unverified stop has no recorded source to tick; only a verified one carries a debugger snapshot into the mapping.
          entry.type === 'stop' && nodeStopSourceMatches(entry)
            ? [
                {
                  id: String(entry.sequence),
                  elapsedMs: entry.elapsedMs,
                  debugger: entry.debuggerSnapshot,
                },
              ]
            : [],
        ),
      },
    },
    range,
  )
  if (timeline.status !== 'mapped') return undefined
  return {
    ...range,
    gaps: timeline.gaps,
    recordedPoints: timeline.recordedPoints,
  }
}
