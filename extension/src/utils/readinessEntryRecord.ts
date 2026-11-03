/** How Codebook's readiness request for the entry ended when no HTTP status came back: it timed out, the run stopped it, or the connection broke. */
export type ReadinessRequestOutcome = 'timeout' | 'aborted' | 'connection-lost'

/** The record of Codebook's own readiness request for the entry, as the run resource shows it: open from the send, closed with the HTTP status or a status-free outcome. */
export type ReadinessEntryRequest =
  | { state: 'open'; sentAtMs: number }
  | { state: 'closed'; sentAtMs: number; status: number }
  | { state: 'closed'; sentAtMs: number; outcome: ReadinessRequestOutcome }

/** What the launcher tells the run about its readiness request: the send, and how it ended. */
export type ReadinessObserver = {
  /** Called right before the request is sent. */
  sent(): void
  /** Called once, when the request ended: with the HTTP status, or with the status-free outcome. */
  closed(
    ending: { status: number } | { outcome: ReadinessRequestOutcome },
  ): void
}

/**
 * Names how a failed readiness request ended, when no status came back.
 *
 * Why it exists: the readiness request of a Next run executes the page's server code once, so the record says whether it ended by the clock, by the run's stop or by the connection; a learner who sees `timeout` knows the data function may still have run. Called by the launcher ({@link launchDevelopmentServer}) for the request it sent.
 * @param error - What the request rejected with.
 * @param signal - The run's stop signal that was part of the request.
 * @returns `aborted` when the run's stop was the cause, `timeout` for a timeout error, otherwise `connection-lost`.
 * @example
 * readinessOutcomeOfError(new DOMException('The operation timed out.', 'TimeoutError'), new AbortController().signal) // => 'timeout'
 */
export function readinessOutcomeOfError(
  error: unknown,
  signal: AbortSignal,
): ReadinessRequestOutcome {
  if (signal.aborted) return 'aborted'
  const name = error instanceof Error ? error.name : undefined
  return name === 'TimeoutError' ? 'timeout' : 'connection-lost'
}

/**
 * Keeps the record of Codebook's readiness request for the entry: it opens when the request is sent, whichever router the entry resolves to, and closes with the HTTP status or a status-free outcome, and the run journals it once, when it closes.
 *
 * Why it exists: the readiness request runs the entry page's server code (a data function, server components) before any stop is armed, so the learner and the chat need to know that one unobserved request happened, and a failure after it must say the side effects are unknown (`sideEffects: "unknown"`). Created once per run by {@link ConfiguredBrowserRun}; its {@link ReadinessEntryRecord.observer} is handed to the launcher of a Next server.
 * @example
 * const record = new ReadinessEntryRecord((detail) => journal.record('readiness.entry-request', detail), () => 12.5)
 * record.observer.sent()
 * record.observer.closed({ status: 200 })
 * record.view() // => { state: 'closed', sentAtMs: 12.5, status: 200 }
 */
export class ReadinessEntryRecord {
  private current?: ReadinessEntryRequest

  /**
   * @param journal - Receives the closed record's detail, once.
   * @param now - The run's journal clock in milliseconds.
   */
  constructor(
    private readonly journal: (detail: Record<string, unknown>) => void,
    private readonly now: () => number,
  ) {}

  /** The observer the launcher calls around its request. */
  readonly observer: ReadinessObserver = {
    sent: (): void => {
      // The first request is the record: a redirect chain of the same readiness check is one request.
      this.current ??= { state: 'open', sentAtMs: this.now() }
    },
    closed: (ending): void => this.close(ending),
  }

  /** Whether the request was sent, whatever became of it. @example record.wasSent // => true */
  get wasSent(): boolean {
    return this.current !== undefined
  }

  /**
   * Gives the record as the run resource shows it.
   * @returns The open or closed record; `undefined` before the request was sent.
   * @example record.view() // => { state: 'open', sentAtMs: 12.5 }
   */
  view(): ReadinessEntryRequest | undefined {
    return this.current && { ...this.current }
  }

  /**
   * Closes a record that is still open because the run ended first, so the journal never lacks the entry.
   * @example record.closeIfOpen('aborted')
   */
  closeIfOpen(outcome: ReadinessRequestOutcome): void {
    if (this.current?.state === 'open') this.close({ outcome })
  }

  private close(
    ending: { status: number } | { outcome: ReadinessRequestOutcome },
  ): void {
    const open = this.current
    if (open?.state !== 'open') return
    this.current = { ...open, state: 'closed', ...ending }
    this.journal({ sentAtMs: open.sentAtMs, ...ending })
  }
}
