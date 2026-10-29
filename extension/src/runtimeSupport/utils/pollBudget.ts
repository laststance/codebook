/**
 * A time budget for a poll loop that counts both the pauses and the time its requests take, so a slow answer cannot stretch a bound that only counted sleeps (B6).
 * Used by the owned launch's waits (endpoint, workers, popup, control page); the clock is monotonic ({@link performance.now}) unless a test names its own.
 * @example
 * const budget = new PollBudget(5_000)
 * while (!budget.isSpent()) {
 *   const found = await budget.measure(() => look())
 *   if (found) break
 *   await budget.pause(sleep, 100)
 * }
 */
export class PollBudget {
  private spentMs = 0

  constructor(
    private readonly boundMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Time left, never below zero. */
  remainingMs(): number {
    return Math.max(0, this.boundMs - this.spentMs)
  }

  /** Says whether the whole bound has been used. */
  isSpent(): boolean {
    return this.spentMs >= this.boundMs
  }

  /**
   * Runs one step and charges the time it took.
   * @param run - The step, for example one CDP request.
   * @returns What the step returns.
   */
  async measure<T>(run: () => Promise<T>): Promise<T> {
    const started = this.now()
    try {
      return await run()
    } finally {
      this.spentMs += this.now() - started
    }
  }

  /**
   * Sleeps and charges the nominal pause, so an injected instant sleep still spends the bound.
   * @param sleep - The sleep in use.
   * @param pauseMs - How long to pause.
   */
  async pause(
    sleep: (ms: number) => Promise<void>,
    pauseMs: number,
  ): Promise<void> {
    await sleep(pauseMs)
    this.spentMs += pauseMs
  }
}
