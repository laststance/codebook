/** The shortest time of a measured run and of the baseline run it is compared with, timed in turns by {@link shortestTimesInTurns}, in milliseconds. */
export type ShortestTimesInTurns = { measured: number; baseline: number }

/** Elapsed time used for acceptance and the calling thread's CPU time used to diagnose a slow sample. */
type TimedCall = { wallMs: number; cpuMs: number | null }

/**
 * Reads thread CPU for the serving worker's watchdog and diagnostics when the runtime can provide it.
 * @example
 * const start = threadCpuSnapshot()
 */
export function threadCpuSnapshot(
  start?: NodeJS.CpuUsage,
): NodeJS.CpuUsage | undefined {
  try {
    return process.threadCpuUsage(start)
  } catch {
    return undefined
  }
}

/**
 * Times a measured run and its baseline in turns (measured, baseline, measured, baseline, …) and answers each one's shortest time, so a ratio of the two compares runs taken in the same moments of the machine.
 * Why: timing-ratio tests that timed every run of one side first and the other side's runs after let one busy moment of the parallel suite fall on all runs of one side: the reader took 34.8 ms against the parser's 10.4 ms, a ratio of 3.3 against a bound of 2, while the test alone gave 1.46 to 1.67 (Discussion 354). A load that covers every run of one side still lengthens it alone.
 * Runs in the worker threads of the reader's timing-ratio tests in `withServedAddresses.test.ts` (`servingTimes` and the select-pairs parser test), which require its compiled file by path.
 * @param measured - The run whose time the test bounds.
 * @param baseline - The run whose time the bound is a multiple of.
 * @param runs - How many times each run is timed, at least once.
 * @param now - The clock in milliseconds: `performance.now` unless a test of this helper scripts it.
 * @param onTurn - Called outside the timed work before the first run of each pair, then with that run's duration before the second. The serving worker times the ordinary page first so the parent can bound its paired page.
 * @param onPair - Receives both wall and thread CPU measurements of a finished pair for diagnostics.
 * @returns The shortest time of each run in milliseconds.
 * @example
 * shortestTimesInTurns(() => serve(craftedPage), () => serve(ordinaryPage), 2) // => { measured: 41.2, baseline: 58.7 }
 */
export function shortestTimesInTurns(
  measured: () => void,
  baseline: () => void,
  runs: number,
  now: () => number = () => performance.now(),
  onTurn?: (firstMs?: number) => void,
  onPair?: (first: TimedCall, second: TimedCall) => void,
): ShortestTimesInTurns {
  const timeOf = (run: () => void): TimedCall => {
    const cpuStart = onPair && threadCpuSnapshot()
    const startedMs = now()
    run()
    const wallMs = now() - startedMs
    const cpu = cpuStart && threadCpuSnapshot(cpuStart)
    return { wallMs, cpuMs: cpu ? (cpu.user + cpu.system) / 1_000 : null }
  }
  let shortest: ShortestTimesInTurns = {
    measured: Number.POSITIVE_INFINITY,
    baseline: Number.POSITIVE_INFINITY,
  }
  // Each turn times the measured run and then the baseline right after it, so a moment of load falls on runs of both sides.
  for (let turn = 0; turn < runs; turn += 1) {
    onTurn?.()
    const first = timeOf(measured)
    onTurn?.(first.wallMs)
    const second = timeOf(baseline)
    onPair?.(first, second)
    shortest = {
      measured: Math.min(shortest.measured, first.wallMs),
      baseline: Math.min(shortest.baseline, second.wallMs),
    }
  }
  return shortest
}

/**
 * Measures ordinary/page pairs for the Wiki serving worker. An over-limit first two pairs get exactly three more.
 * Every call remains subject to its normal watchdog. Only elapsed time decides the ratio; CPU evidence explains the samples.
 * @example
 * measureServingTurns(serveOrdinary, servePage, 4, reportTurn)
 */
export function measureServingTurns(
  serveOrdinary: () => void,
  servePage: () => void,
  ratio: number,
  onTurn?: (ordinaryMs?: number) => void,
  now?: () => number,
) {
  const turns: { ordinary: TimedCall; page: TimedCall }[] = []
  const measure = (runs: number) =>
    shortestTimesInTurns(
      serveOrdinary,
      servePage,
      runs,
      now,
      onTurn,
      (ordinary, page) => turns.push({ ordinary, page }),
    )
  const first = measure(2)
  if (first.baseline <= ratio * first.measured)
    return { ordinary: first.measured, page: first.baseline, turns }
  // Keep both original minima, including a fast original baseline when the machine slows during confirmation.
  const confirmation = measure(3)
  return {
    ordinary: Math.min(first.measured, confirmation.measured),
    page: Math.min(first.baseline, confirmation.baseline),
    turns,
  }
}
