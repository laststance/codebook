/** The shortest time of a measured run and of the baseline run it is compared with, timed in turns by {@link shortestTimesInTurns}, in milliseconds. */
export type ShortestTimesInTurns = { measured: number; baseline: number }

/**
 * Times a measured run and its baseline in turns (measured, baseline, measured, baseline, …) and answers each one's shortest time, so a ratio of the two compares runs taken in the same moments of the machine.
 * Why: timing-ratio tests that timed every run of one side first and the other side's runs after let one busy moment of the parallel suite fall on all runs of one side: the reader took 34.8 ms against the parser's 10.4 ms, a ratio of 3.3 against a bound of 2, while the test alone gave 1.46 to 1.67 (Discussion 354). A load that covers every run of one side still lengthens it alone.
 * Runs in the worker threads of the reader's timing-ratio tests in `withServedAddresses.test.ts` (`servingTimes` and the select-pairs parser test), which require its compiled file by path.
 * @param measured - The run whose time the test bounds.
 * @param baseline - The run whose time the bound is a multiple of.
 * @param runs - How many times each run is timed, at least once.
 * @param now - The clock in milliseconds: `performance.now` unless a test of this helper scripts it.
 * @returns The shortest time of each run in milliseconds.
 * @example
 * shortestTimesInTurns(() => serve(craftedPage), () => serve(ordinaryPage), 2) // => { measured: 41.2, baseline: 58.7 }
 */
export function shortestTimesInTurns(
  measured: () => void,
  baseline: () => void,
  runs: number,
  now: () => number = () => performance.now(),
): ShortestTimesInTurns {
  const timeOf = (run: () => void): number => {
    const startedMs = now()
    run()
    return now() - startedMs
  }
  let shortest: ShortestTimesInTurns = {
    measured: Number.POSITIVE_INFINITY,
    baseline: Number.POSITIVE_INFINITY,
  }
  // Each turn times the measured run and then the baseline right after it, so a moment of load falls on runs of both sides.
  for (let turn = 0; turn < runs; turn += 1) {
    const measuredMs = timeOf(measured)
    const baselineMs = timeOf(baseline)
    shortest = {
      measured: Math.min(shortest.measured, measuredMs),
      baseline: Math.min(shortest.baseline, baselineMs),
    }
  }
  return shortest
}
