/** The facts of a declared stop that decide its set. */
export type SetStop = { participant: 'browser' | 'server'; group: number }

/**
 * Finds the set of consecutive server stops of one operation group that are armed together (D15): a render runs them concurrently (`Promise.all`, sibling `Suspense` boundaries), and the chat cannot see which layer Codebook sealed.
 * Called by {@link ConfiguredBrowserRun} when it arms a group's stops and by the pause matcher to know which stops may pause next.
 * @param stops - The declared stops in declared order.
 * @param startIndex - The index of the first stop of the set.
 * @returns The indexes of the set: from `startIndex` while the stops are server stops of the same group; only `startIndex` for a browser stop; empty when `startIndex` is past the end.
 * @example
 * serverStopSetOf([{ participant: 'server', group: 1 }, { participant: 'server', group: 1 }, { participant: 'server', group: 2 }], 0) // => [0, 1]
 * serverStopSetOf([{ participant: 'browser', group: 1 }, { participant: 'server', group: 1 }], 0) // => [0]
 */
export function serverStopSetOf(
  stops: readonly SetStop[],
  startIndex: number,
): number[] {
  const first = stops[startIndex]
  if (!first) return []
  if (first.participant !== 'server') return [startIndex]
  const indexes = [startIndex]
  for (let index = startIndex + 1; index < stops.length; index++) {
    const stop = stops[index]!
    if (stop.participant !== 'server' || stop.group !== first.group) break
    indexes.push(index)
  }
  return indexes
}
