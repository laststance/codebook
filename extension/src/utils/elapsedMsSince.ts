/**
 * Measures how long something lasted on a monotonic clock, for journal entries about an interval whose start may never have been seen.
 * Called by {@link ConfiguredBrowserRun} to say how long an observed pause lasted when its resume arrives.
 * @param startMs - The clock reading at the start, or none when the start was not observed.
 * @param nowMs - The current reading of the same clock.
 * @returns
 * - With a start: the whole milliseconds since then, never negative
 * - Without one: `undefined`
 * @example
 * elapsedMsSince(1000.2, 1003.9) // => 4
 * elapsedMsSince(undefined, 5)   // => undefined
 */
export function elapsedMsSince(
  startMs: number | undefined,
  nowMs: number,
): number | undefined {
  return startMs === undefined
    ? undefined
    : Math.max(0, Math.round(nowMs - startMs))
}
