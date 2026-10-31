import type { ExtensionReplayModel } from './buildExtensionReplayModel'
import type { NodeHistoryTimeline } from './projectNodeHistoryTimeline'

/**
 * Maps an Extension replay's journal onto the shared coverage timeline: a span is recorded while a pause whose executed source is recorded is open, every other span of the range is unrecorded, and each such stop is a tick at its pause-open.
 *
 * Why: unlike a test journal, an extension journal knows when each pause opened and closed, so the slider's unrecorded marking (4A) must agree with the moments that show source and values; {@link projectNodeHistoryTimeline} would mark the whole range as one gap. A pause opened inside another decides its own span (the most recently opened pause still open, as the replay model selects), so an unrecorded inner stop stays a gap inside a recorded one; a pause the history never saw close stays open to the end of the range.
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
  const pauses = [...model.pauses.values()]
  // Every moment a pause opens or closes can change which pause the replay selects.
  const cutsMs = [
    ...new Set(
      [
        startMs,
        endMs,
        ...pauses.flatMap((pause) => [pause.openMs, pause.closeMs ?? endMs]),
      ].filter((ms) => ms >= startMs && ms <= endMs),
    ),
  ].sort((left, right) => left - right)
  const gaps: NodeHistoryTimeline['gaps'] = []
  for (const [at, fromMs] of cutsMs.entries()) {
    const toMs = cutsMs[at + 1]
    if (toMs === undefined) break
    // The replay model's own rule: the most recently opened pause still open decides whether the span shows source.
    const selected = pauses
      .filter(
        (pause) =>
          pause.openMs <= fromMs &&
          (pause.closeMs === undefined || pause.closeMs > fromMs),
      )
      .sort(
        (left, right) =>
          left.openMs - right.openMs || left.openSequence - right.openSequence,
      )
      .at(-1)
    if (selected?.hasSource) continue
    const previous = gaps.at(-1)
    // Neighboring unrecorded spans read as one gap.
    if (previous && previous.endMs === fromMs) previous.endMs = toMs
    else gaps.push({ startMs: fromMs, endMs: toMs })
  }
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
