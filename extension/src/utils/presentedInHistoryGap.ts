/**
 * Decides whether the presented replay position lies in an unrecorded (source/debugger history) gap, so the Study pane can say "Not recorded at this moment".
 *
 * Gaps are half-open (`startMs <= presentedMs < endMs`), except at the recording's last instant: Play stops exactly on `recordingEndMs`, which a gap running to the end must still cover.
 * Called by the Study pane's page at every Study message, and self-contained (no imports, no closure) because the page receives it as source text through `toString()`.
 *
 * @param input.presentedMs - The presented position, if any.
 * @param input.gaps - The unrecorded intervals of the recording's history timeline.
 * @param input.recordedPoints - Positions with recorded source/debugger history; a recorded point is never in a gap.
 * @param input.recordingEndMs - The recording's end position, if known.
 * @returns `true` when the presented position is inside a gap.
 * @example presentedInHistoryGap({ presentedMs: 900, gaps: [{ startMs: 500, endMs: 900 }], recordedPoints: [], recordingEndMs: 900 }) // => true
 */
export function presentedInHistoryGap(input: {
  presentedMs: number | undefined
  gaps: readonly { startMs: number; endMs: number }[]
  recordedPoints: readonly number[]
  recordingEndMs: number | undefined
}): boolean {
  const presentedMs = input.presentedMs
  if (presentedMs === undefined) return false
  // A recorded stop is never a gap, even at a gap's edge.
  if (input.recordedPoints.includes(presentedMs)) return false
  return input.gaps.some(
    (gap) =>
      (presentedMs >= gap.startMs && presentedMs < gap.endMs) ||
      // The recording's last instant belongs to a gap that runs to the end.
      (presentedMs === input.recordingEndMs && presentedMs === gap.endMs),
  )
}
