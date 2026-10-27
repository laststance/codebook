/** The clock a node-server run reads: its time and a one-shot timer whose cancel function it keeps; the real one in the product, a hand-moved one in tests. */
export interface RunClock {
  now(): number
  set(callback: () => void, delayMs: number): () => void
}

/**
 * A time limit that counts only the time the server could run: pauses (the debugger holding the server) stop the count and resume it, so the limit never expires while a learner holds a pause.
 * Used twice by the node-server run, for the readiness budget and for the declared request's timeout; the run calls {@link start} when the work begins, {@link hold} and {@link release} around each pause and {@link stop} when the work ends.
 *
 * @example
 * const limit = new RunningTimeLimit(30_000, clock, () => abort('timeout'))
 * limit.start(); limit.hold(); limit.release() // 30 s of running time, none of the held time counted
 */
export class RunningTimeLimit {
  private elapsedMs = 0
  private countingSince?: number
  private holds = 0
  private began = false
  private cancelTimer?: () => void

  constructor(
    private readonly limitMs: number,
    private readonly clock: RunClock,
    private readonly onExpire: () => void,
  ) {}

  /** Begins counting running time; a call after the first does nothing. @example limit.start() */
  start(): void {
    if (this.began) return
    this.began = true
    this.resumeCounting()
  }

  /** A pause begins: the count stops until every hold is released. @example limit.hold() */
  hold(): void {
    this.holds += 1
    if (this.began) this.pauseCounting()
  }

  /** A pause ends: the count resumes once no hold is left. @example limit.release() */
  release(): void {
    this.holds = Math.max(0, this.holds - 1)
    if (this.began && this.holds === 0) this.resumeCounting()
  }

  /** Ends the limit for good: no timer remains and it never expires. @example limit.stop() */
  stop(): void {
    this.pauseCounting()
    this.began = false
    this.holds = 0
    this.elapsedMs = 0
  }

  /**
   * Says whether running time is left, for the readiness poll.
   * @returns `true` while the counted running time is under the limit; `false` once it reached it.
   * @example limit.hasTimeLeft() // => true after 10 s of 30 s
   */
  hasTimeLeft(): boolean {
    return this.countedMs() < this.limitMs
  }

  /** The running time counted so far, held time excluded. */
  private countedMs(): number {
    return this.countingSince === undefined
      ? this.elapsedMs
      : this.elapsedMs + (this.clock.now() - this.countingSince)
  }

  /** Starts counting from now unless a hold stands, and arms the timer for the time left. */
  private resumeCounting(): void {
    if (this.holds > 0 || this.countingSince !== undefined) return
    this.countingSince = this.clock.now()
    this.cancelTimer = this.clock.set(
      this.onExpire,
      Math.max(0, this.limitMs - this.elapsedMs),
    )
  }

  /** Banks the time counted so far and cancels the timer. */
  private pauseCounting(): void {
    if (this.countingSince === undefined) return
    this.elapsedMs = this.countedMs()
    this.countingSince = undefined
    this.cancelTimer?.()
    this.cancelTimer = undefined
  }
}
