import { NODE_SERVER_HISTORY_START_BOUND_MS } from './constants'
import {
  describeNodeServerSealFailure,
  describeNodeServerSealTimeout,
} from './utils/describeNodeServerSealFailure'
import { sealWithTransientRetry } from './utils/sealWithTransientRetry'
import {
  SEAL_DEADLINE_PASSED,
  startSealDeadline,
} from './utils/startSealDeadline'
import { startWithinBound } from './utils/startWithinBound'

/** Where a node run's history stands: its writer takes entries, it was sealed, or it was abandoned because it could not be written or sealed. */
export type NodeRunHistoryStatus = 'recording' | 'sealed' | 'failed'

/** What a recorder needs of its profile's writer. */
export type NodeRunRecorderWriter<End> = {
  readonly header: { studyId: string }
  readonly appendFailure: Error | undefined
  readonly publishedSealHash: string | undefined
  seal(end: End): Promise<string | undefined>
  abandon(): void
}

/** What {@link NodeRunHistoryRecorder.beginWith} needs from the service, whatever the profile. */
export type NodeRunHistoryBeginInput<
  Writer extends NodeRunRecorderWriter<never>,
  SinkInput,
  Summary,
> = {
  /** Reserves the history and returns its writer; rejects when storage is unavailable, full or refuses the start. */
  start: () => Promise<Writer>
  /** Words a failure for the learner without private paths. */
  describeCause: (error: unknown) => string
  sink: SinkInput
  /** The start's bound; {@link NODE_SERVER_HISTORY_START_BOUND_MS} unless a test names its own. */
  startBoundMs?: number
  /** Reads the sealed history's summary for the verdicts; `undefined` when it cannot be read. */
  summarize: (studyId: string) => Promise<Summary | undefined>
  /** Waits before the one retry of a transient seal failure. */
  retryDelay?: (milliseconds: number) => Promise<void>
}

/** The sealed history's summary and journal hash. */
export type NodeRunSealedHistory<Summary> = {
  summary: Summary | undefined
  hash: string | undefined
  /** The number of the latest verdict read, so only that read writes the summary ({@link StudyService.refreshNodeServerSummary}). */
  summaryReads?: number
}

/**
 * Owns one live node run's history (server or script) from its start to its seal: the writer, the sink the run feeds, the one seal every ending joins, and the verdicts read once it sealed.
 * Why: Stop, `codebook_stop`, Save, dispose, self-exit and failure must give one seal, and a history that cannot start, be written or be sealed must never fail the run; this holds that state apart from {@link StudyService}.
 * Subclassed by {@link NodeServerHistoryRecorder} and {@link NodeScriptHistoryRecorder}, which fix the writer, the sink and the end.
 * @example
 * const begun = await NodeServerHistoryRecorder.begin(input)
 * if ('recorder' in begun) await begun.recorder.seal({ elapsedMs: 900, reason: 'stopped' }, 10_000)
 */
export class NodeRunHistoryRecorder<
  Writer extends NodeRunRecorderWriter<End>,
  Sink extends { flush(): void },
  Summary,
  End,
  SinkInput,
> {
  status: NodeRunHistoryStatus = 'recording'
  /** Why the history was abandoned or its seal failed, without private paths. */
  failure?: string
  /** The sealed history's summary and journal hash, once sealed. */
  sealed?: NodeRunSealedHistory<Summary>
  private sealOperation?: Promise<void>

  protected constructor(
    readonly writer: Writer,
    readonly sink: Sink,
    private readonly input: NodeRunHistoryBeginInput<
      Writer,
      SinkInput,
      Summary
    >,
  ) {}

  /**
   * Starts the history within its bound.
   * @param input - How to start, word and read the history.
   * @param build - Builds the profile's recorder and sink around the started writer.
   * @param sealEmpty - Seals a writer whose start came back late, with nothing in it, which removes its folder.
   * @returns The recorder, or the cause for a run that goes on without a history: storage unavailable, a full store, a refused start or a start slower than its bound.
   * @example const begun = await NodeRunHistoryRecorder.beginWith(input, build, sealEmpty) // => { recorder } | { unavailable: 'storage is full' }
   */
  protected static async beginWith<
    Recorder,
    Writer extends NodeRunRecorderWriter<never>,
    SinkInput,
    Summary,
  >(
    input: NodeRunHistoryBeginInput<Writer, SinkInput, Summary>,
    build: (writer: Writer) => Recorder,
    sealEmpty: (late: Writer) => Promise<unknown>,
  ): Promise<{ recorder: Recorder } | { unavailable: string }> {
    const bound = input.startBoundMs ?? NODE_SERVER_HISTORY_START_BOUND_MS
    try {
      const started = await startWithinBound(
        input.start(),
        bound,
        // A start that finishes later is sealed with nothing in it, which removes its folder.
        sealEmpty,
      )
      if ('timedOut' in started)
        return {
          unavailable: `the history did not start within ${bound / 1_000} s.`,
        }
      return { recorder: build(started.writer) }
    } catch (error) {
      return { unavailable: input.describeCause(error) }
    }
  }

  /** Why the history stopped taking evidence while the run lives (a refused or failed append, a fault of the sink), without private paths; `undefined` while it writes. */
  get appendFailure(): string | undefined {
    const failure = this.writer.appendFailure
    return failure ? this.input.describeCause(failure) : undefined
  }

  /** Whether the history still takes entries. Read by {@link NodeServerLearningSave}. */
  // fallow-ignore-next-line unused-class-member
  get isRecording(): boolean {
    return this.status === 'recording'
  }

  /**
   * Ends and seals the history; the first call decides, every later call joins it.
   * @param end - How the run ended.
   * @param boundMs - How long the seal may take; past it the writer is abandoned (the folder lists as interrupted) and the failure reads `Learning replay could not be saved: timed out after <s> s.`
   * @returns Settles when the seal ended in a sealed or a failed state; never rejects. A seal published at the deadline settles at once sealed with an unknown summary, which the summary read fills when it answers.
   * @example await recorder.seal({ elapsedMs: 900, reason: 'stopped' }, 10_000)
   */
  // fallow-ignore-next-line unused-class-member
  seal(end: End, boundMs: number): Promise<void> {
    this.sealOperation ??= this.runSeal(end, boundMs)
    return this.sealOperation
  }

  /** Does the one seal: the output waiting to be coalesced first, then the writer's seal, bounded. */
  private async runSeal(end: End, boundMs: number): Promise<void> {
    this.sink.flush()
    const deadline = startSealDeadline(boundMs)
    try {
      const raced = await Promise.race([
        this.sealWithRetry(end),
        deadline.passed,
      ])
      // A writer whose seal is already published is never abandoned: the store lists it sealed, so the live run must read it sealed too.
      const hash =
        raced === SEAL_DEADLINE_PASSED ? this.writer.publishedSealHash : raced
      if (raced === SEAL_DEADLINE_PASSED && hash === undefined) {
        this.abandon(describeNodeServerSealTimeout(boundMs / 1_000))
        return
      }
      this.status = 'sealed'
      // The summary read is bounded too: past the bound the seal stands and the summary reads as unknown, so a stalled read never holds Stop, Save or the next run.
      const reading = this.startSummaryRead()
      // After an expiry the shared deadline already settled: the seal settles at once with an unknown summary and the read fills it when it answers; otherwise the read shares the seal's deadline.
      const summary =
        raced === SEAL_DEADLINE_PASSED
          ? undefined
          : await Promise.race([reading, deadline.passed.then(() => undefined)])
      this.sealed = { summary, hash }
      if (raced === SEAL_DEADLINE_PASSED)
        this.fillSummaryWhenRead(reading, this.sealed)
    } catch (error) {
      // A seal that was published before the fault (a cleanup after the rename) is never abandoned: the store lists it sealed, so the run reads it sealed too.
      const publishedHash = this.writer.publishedSealHash
      if (publishedHash !== undefined) {
        this.status = 'sealed'
        // The read shares the seal's own deadline, so the whole seal settles within one bound.
        const summary = await Promise.race([
          this.startSummaryRead(),
          deadline.passed.then(() => undefined),
        ])
        this.sealed = { summary, hash: publishedHash }
        return
      }
      this.abandon(
        describeNodeServerSealFailure(this.input.describeCause(error)),
      )
    } finally {
      deadline.cancel()
    }
  }

  /**
   * Fills an unknown summary of a sealed state when its late read answers, without ever holding the seal.
   * Why: a seal published at the deadline still deserves its verdicts; called by {@link NodeRunHistoryRecorder.runSeal} after an expiry.
   * Nothing is notified: the run resource and Save read the store again, so the next read shows the summary.
   * @param reading - The read from {@link NodeRunHistoryRecorder.startSummaryRead}; it never rejects.
   * @param target - The sealed state the read was started for; a replaced state or a summary another read set is left alone.
   */
  private fillSummaryWhenRead(
    reading: Promise<Summary | undefined>,
    target: NodeRunSealedHistory<Summary>,
  ): void {
    void reading.then((summary) => {
      // Only the same sealed state with a still unknown summary takes the late answer.
      if (summary && this.sealed === target && target.summary === undefined)
        target.summary = summary
    })
  }

  /**
   * Starts the verdict read of the sealed history so that nothing it does can reject {@link NodeServerHistoryRecorder.seal}.
   * Why: a synchronous throw of the reader would otherwise escape the seal; called by {@link NodeRunHistoryRecorder.runSeal} on every path that reads a summary.
   * @returns The summary, or `undefined` when the read threw or rejected.
   */
  private startSummaryRead(): Promise<Summary | undefined> {
    return Promise.resolve()
      .then(() => this.input.summarize(this.writer.header.studyId))
      .catch(() => undefined)
  }

  /** Abandons the writer, so a late seal publishes nothing and the folder lists as interrupted. */
  private abandon(cause: string): void {
    this.writer.abandon()
    this.status = 'failed'
    this.failure = cause
  }

  /** Seals, and once more after a short wait when the first attempt failed with a transient file-system code. */
  private sealWithRetry(end: End): Promise<string | undefined> {
    return sealWithTransientRetry(
      () => this.writer.seal(end),
      this.input.retryDelay,
    )
  }
}
