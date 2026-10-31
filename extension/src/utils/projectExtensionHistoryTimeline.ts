import type { ExtensionReplayModel } from './buildExtensionReplayModel'
import type { NodeHistoryTimeline } from './projectNodeHistoryTimeline'

/**
 * Maps an Extension replay's journal onto the shared coverage timeline: a span is recorded while a pause whose executed source is recorded is open, every other span of the range is unrecorded, and each such stop is a tick at its pause-open.
 *
 * Why: unlike a test journal, an extension journal knows when each pause opened and closed, so the slider's unrecorded marking (4A) must agree with the moments that show source and values; {@link projectNodeHistoryTimeline} would mark the whole range as one gap. Overlapping pauses (a pause opened inside another) merge into one recorded span; a pause the history never saw close stays open to the end of the range.
 * Called by {@link StudyWorkspace} while it projects an Extension replay's Study section.
 *
 * @param model - The replay's model: its events give the range and its pauses give the intervals.
 * @returns The range, its gaps and the ticks; `undefined` for a history of fewer than two moments in time, which have nothing to mark.
 * @example
 * projectExtensionHistoryTimeline(model) // => { startMs: 0, endMs: 400, gaps: [{ startMs: 0, endMs: 100 }, { startMs: 200, endMs: 400 }], recordedPoints: [100] }
 */
export function projectExtensionHistoryTimeline(
  model: Pick<ExtensionReplayModel, 'events' | 'pauses' | 'endedAtMs'>,
): NodeHistoryTimeline | undefined {
  const first = model.events[0]
  const endMs = model.endedAtMs
  if (!first || endMs <= first.timeMs) return undefined
  const startMs = first.timeMs
  // Only a pause whose executed source verifies shows source and values, so only it records its span.
  const recordedPauses = [...model.pauses.values()].filter(
    (pause) => pause.hasSource,
  )
  const spans = recordedPauses
    .map((pause) => ({
      startMs: Math.max(startMs, pause.openMs),
      endMs: Math.min(endMs, pause.closeMs ?? endMs),
    }))
    .filter((span) => span.endMs > span.startMs)
    .sort((left, right) => left.startMs - right.startMs)
  const gaps: NodeHistoryTimeline['gaps'] = []
  let recordedUntilMs = startMs
  // Overlapping spans form one recorded span; whatever lies between two spans stays visibly unrecorded.
  for (const span of spans) {
    if (span.startMs > recordedUntilMs)
      gaps.push({ startMs: recordedUntilMs, endMs: span.startMs })
    recordedUntilMs = Math.max(recordedUntilMs, span.endMs)
  }
  if (recordedUntilMs < endMs) gaps.push({ startMs: recordedUntilMs, endMs })
  return {
    startMs,
    endMs,
    gaps,
    recordedPoints: recordedPauses
      .map((pause) => pause.openMs)
      .filter((openMs) => openMs >= startMs && openMs <= endMs)
      .sort((left, right) => left - right),
  }
}
