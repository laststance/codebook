import { elapsedMsSince } from '../utils/elapsedMsSince'

/**
 * Times the consecutive steps of one replay presentation on a monotonic clock, for the playback timing journal (Cycle 0137, C1-E).
 * Why it exists: the steps of {@link ReplayOpening.presentPlayback} run one after another, and the journal must say which of them holds the playhead; a lap per step keeps that method free of timing branches.
 * Created by {@link ReplayOpening.presentPlayback} at the start of each presentation; {@link formatPresentationTiming} reads its laps.
 * @example
 * ```ts
 * const watch = new PresentationStopwatch()
 * await retire()
 * watch.lap('retire')
 * watch.laps // => { retire: 12 }
 * ```
 */
export class PresentationStopwatch {
  /** The whole milliseconds each named step took, in the order the steps ended; a step lapped twice keeps its last duration. */
  readonly laps: Record<string, number> = {}
  private readonly startedAtMs: number
  private lastLapAtMs: number

  /**
   * Starts the stopwatch at the presentation's first step.
   * @param now - The monotonic clock; `performance.now()` by default, a test's own clock otherwise.
   */
  constructor(private readonly now: () => number = () => performance.now()) {
    this.startedAtMs = this.lastLapAtMs = now()
  }

  /**
   * Ends the step that started at the previous lap (or at the start) and records its duration under a name.
   * @param step - The step that just ended, such as `retire` or `paint`.
   * @example watch.lap('source') // laps.source is the whole milliseconds since the previous lap
   */
  lap(step: string): void {
    const atMs = this.now()
    this.laps[step] = elapsedMsSince(this.lastLapAtMs, atMs) ?? 0
    this.lastLapAtMs = atMs
  }

  /**
   * Tells how long the presentation has taken so far.
   * @returns The whole milliseconds since the stopwatch started, never negative.
   * @example watch.totalMs() // => 540
   */
  totalMs(): number {
    return elapsedMsSince(this.startedAtMs, this.now()) ?? 0
  }
}
