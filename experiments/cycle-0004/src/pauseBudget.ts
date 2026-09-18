/** Counts the union of real participant pauses for {@link PairedRun}'s event-driven progress watchdog. @example budget.stop('server', 100); budget.activeMs(200) // 100 */
export class PauseBudget {
  private readonly paused = new Set<string>();
  private pausedAt?: number;
  private pausedTotalMs = 0;
  constructor(private readonly startedMs: number) {}

  /** Starts exclusion only for the first overlapping stop, called by owned DAP events. @example budget.stop('server', 100) */
  stop(participant: string, nowMs: number): void {
    if (!this.paused.size) this.pausedAt = nowMs;
    this.paused.add(participant);
  }

  /** Ends exclusion only when the last participant resumes, called by owned continuation events. @example budget.resume('server', 200) */
  resume(participant: string, nowMs: number): void {
    this.paused.delete(participant);
    if (!this.paused.size && this.pausedAt !== undefined) { this.pausedTotalMs += nowMs - this.pausedAt; this.pausedAt = undefined; }
  }

  /** Reports active elapsed time without extending individual protocol deadlines. @example new PauseBudget(0).activeMs(50) // 50 */
  activeMs(nowMs: number): number { return nowMs - this.startedMs - this.pausedTotalMs - (this.pausedAt === undefined ? 0 : nowMs - this.pausedAt); }
}
