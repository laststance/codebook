/**
 * Bounds a list of time intervals without losing any time they cover: sorted by start, the oldest are merged into one interval that spans them until at most `maxCount` remain.
 * Why it exists: {@link SecretFrameGate} keeps the times a frame from another origin was drawn in a replaced document; dropping the oldest to stay bounded would let a late image of such a time pass, while a merged span only withholds more (the gaps between the merged intervals too).
 * Called by {@link SecretFrameGate} when it retires the observers of a replaced document.
 * @param intervals - `[from, to]` pairs (ms), in any order; not modified.
 * @param maxCount - The most intervals to return (at least 1).
 * @returns
 * - At most `maxCount` intervals: the input sorted by start, unchanged.
 * - More: the oldest merged into one `[earliest start, latest end]`, followed by the newest `maxCount - 1`, sorted by start.
 * @example
 * coalesceOldestIntervals([[30, 40], [0, 10], [15, 20]], 2) // => [[0, 20], [30, 40]]
 * coalesceOldestIntervals([[0, 10]], 2) // => [[0, 10]]
 */
export function coalesceOldestIntervals(
  intervals: readonly (readonly [number, number])[],
  maxCount: number,
): [number, number][] {
  const sorted = intervals
    .map(([from, to]): [number, number] => [from, to])
    .sort(([leftFrom], [rightFrom]) => leftFrom - rightFrom)
  if (sorted.length <= maxCount) return sorted
  const mergedCount = sorted.length - Math.max(1, maxCount) + 1
  const merged = sorted.slice(0, mergedCount)
  return [
    [
      Math.min(...merged.map(([from]) => from)),
      Math.max(...merged.map(([, to]) => to)),
    ],
    ...sorted.slice(mergedCount),
  ]
}
