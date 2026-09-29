interface VerifiedRange { startMs: number; endMs: number }
interface TimelineContext { pausedIntervals?: Array<VerifiedRange & { snapshotId: string }>; study: { observations: Array<{ id: string; elapsedMs: number; debugger?: unknown }> } }

/** Maps sealed native-debug history when replay opens so the transport can disclose gaps without guessing old archive coverage.
 * @param context - Validated saved recording context.
 * @param range - Verified playback bounds.
 * @returns Mapped gaps and exact stops, or unknown when interval ownership was never saved.
 * @example projectHistoricalTimeline(undefined, { startMs: 0, endMs: 100 }) // => { status: 'unknown' }
 */
export function projectHistoricalTimeline(context: TimelineContext | undefined, range: VerifiedRange | undefined) {
  if (!range || !context?.pausedIntervals) return { status: 'unknown' as const };
  const allObservations = [...context.study.observations].sort((left, right) => left.elapsedMs - right.elapsedMs);
  const observations = allObservations.filter(observation => observation.debugger);
  const recordedPoints = observations.map(observation => observation.elapsedMs).filter(positionMs => positionMs >= range.startMs && positionMs <= range.endMs).sort((left, right) => left - right);
  const intervals = context.pausedIntervals.map(interval => {
    const nextObservationMs = allObservations.find(observation => observation.elapsedMs > interval.startMs)?.elapsedMs ?? range.endMs;
    return { startMs: Math.max(range.startMs, interval.startMs), endMs: Math.min(range.endMs, interval.endMs, nextObservationMs) };
  })
    .filter(interval => interval.endMs > interval.startMs).sort((left, right) => left.startMs - right.startMs);
  const gaps: VerifiedRange[] = [];
  let availableUntilMs = range.startMs;
  // Overlapping sealed pauses form one available span; every unsealed span remains visibly missing.
  for (const interval of intervals) {
    if (interval.startMs > availableUntilMs) gaps.push({ startMs: availableUntilMs, endMs: interval.startMs });
    availableUntilMs = Math.max(availableUntilMs, interval.endMs);
  }
  if (availableUntilMs < range.endMs) gaps.push({ startMs: availableUntilMs, endMs: range.endMs });
  return { status: 'mapped' as const, gaps, recordedPoints };
}
