import type { CapturedExtensionStop } from './chromeExtensionContracts'
import {
  type ExtensionFrameBudget,
  ExtensionHistoryFrameWriter,
} from './chromeExtensionHistoryFrames'
import type { ExtensionPauseCloseReason } from './chromeExtensionHistorySchemas'
import type {
  ChromeExtensionHistorySink,
  ExtensionHistoryPause,
} from './chromeExtensionHistorySink'
import type { ExtensionHistorySummary } from './chromeExtensionHistoryTypes'
import type { ChromeExtensionHistoryWriter } from './chromeExtensionHistoryWriter'
import { extensionObservationResult } from './chromeExtensionObservation'
import {
  EXTENSION_HISTORY_DRAIN_TIMEOUT_MS,
  EXTENSION_HISTORY_REASON_CODES,
  EXTENSION_HISTORY_RESULT_UNREAD_CAUSE,
  EXTENSION_HISTORY_START_BOUND_MS,
} from './constants'
import { HistoryLimitReachedError } from './nodeHistoryJournalWriter'
import type { ChromeExtensionObserved } from './runtime'
import type { ViewportRecordingObserver } from './runtimeSupport/browserViewport'
import { sealWithTransientRetry } from './utils/sealWithTransientRetry'
import {
  SEAL_DEADLINE_PASSED,
  startSealDeadline,
} from './utils/startSealDeadline'
import { startWithinBound } from './utils/startWithinBound'

/** Where a chrome-extension run's history stands: its writer takes entries, it was sealed, or it was abandoned because it could not be written or sealed. */
export type ExtensionHistoryStatus = 'recording' | 'sealed' | 'failed'

/** What {@link ChromeExtensionHistoryRecorder.begin} needs from the service. */
export type ExtensionHistoryBeginInput = {
  /** Reserves the history and returns its writer; rejects when storage is unavailable, full or refuses the start. */
  start: () => Promise<ChromeExtensionHistoryWriter>
  /** Words a failure for the learner without private paths. */
  describeCause: (error: unknown) => string
  /** The start's bound; {@link EXTENSION_HISTORY_START_BOUND_MS} unless a test names its own. */
  startBoundMs?: number
  /** Reads the sealed history's summary for the verdicts; `undefined` when it cannot be read. */
  summarize: (studyId: string) => Promise<ExtensionHistorySummary | undefined>
  /** Told once with the first fault of an append or a frame (the service writes it to Output › Codebook); the history is already marked failed. */
  onFault?: (error: unknown) => void
  /** The frame budget; the production budget unless a test names a smaller one to reach it. */
  frameBudget?: ExtensionFrameBudget
  /** Waits before the one retry of a transient seal failure. */
  retryDelay?: (milliseconds: number) => Promise<void>
}

/** The outcome of a start: the recorder, or why this run has no history (the live run goes on either way). */
export type ExtensionHistoryBegun =
  { recorder: ChromeExtensionHistoryRecorder } | { unavailable: string }

/** How the run ended, as far as the history needs it. */
export type ExtensionHistoryEnd = {
  /** The run's failure code, when it failed. */
  failureCode?: string
  /** The final observation the run kept; `null` or absent when it never read one. */
  observed?: ChromeExtensionObserved | null
}

/** Converts a masked, JSON-shaped observation value into the JSON type the journal stores. */
function toJson(value: unknown): ReturnType<typeof JSON.parse> {
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}

/**
 * Owns one live chrome-extension run's history from its start to its seal: the writer, the frame writer, the pauses still open and the one seal every ending joins.
 * Why: Stop, `codebook_stop`, a failure, a lost surface and dispose must give one seal, and a history that cannot start, be written or be sealed must never fail or slow the run; this holds that state apart from {@link StudyService} and {@link OwnedChromeExtensionRun}.
 * Created by {@link StudyService} before the run launches; the run feeds it as a {@link ChromeExtensionHistorySink}; {@link ChromeExtensionHistoryRecorder.seal} is called by the service's stop path.
 * @example
 * const begun = await ChromeExtensionHistoryRecorder.begin(input)
 * if ('recorder' in begun) await begun.recorder.seal({}, 10_000)
 */
export class ChromeExtensionHistoryRecorder implements ChromeExtensionHistorySink {
  status: ExtensionHistoryStatus = 'recording'
  /** Why the history was abandoned or its seal failed, without private paths. */
  failure?: string
  /** The sealed history's summary and journal hash, once sealed. */
  sealed?: {
    summary: ExtensionHistorySummary | undefined
    hash: string | undefined
  }
  /** Whether the seal removed the history because no declared stop was reached, so nothing is left to open or save. */
  isRemovedAsEmpty = false
  readonly frameObserver: ViewportRecordingObserver
  private readonly frames: ExtensionHistoryFrameWriter
  private readonly openPauses = new Map<string, ExtensionHistoryPause>()
  /** Every pause the history was told of, open or closed: a pin names one of them. */
  private readonly knownPauseIds = new Set<string>()
  private didWriteResult = false
  private didSurfaceEnd = false
  private didReportFault = false
  private sealOperation?: Promise<void>

  private constructor(
    readonly writer: ChromeExtensionHistoryWriter,
    private readonly input: ExtensionHistoryBeginInput,
  ) {
    this.frames = new ExtensionHistoryFrameWriter(writer, input.frameBudget)
    this.frameObserver = {
      elapsedMs: () => writer.nowMs(),
      frame: (frame): void => {
        // The viewport acked Chrome before this call; only sampling and a bounded enqueue happen here.
        if (frame.kind !== 'stream') return
        this.frames.offer({
          data: frame.data,
          kind: 'stream',
          capturedAtMs: frame.elapsedMs,
        })
      },
      // A withheld image leaves a hole in the frames the history keeps.
      gap: (): void => {
        this.frames.isIncomplete = true
      },
      closed: ({ expected }): void => {
        // A pane closed before the run's own cleanup ends the frames early.
        if (!expected) this.frames.isIncomplete = true
      },
    }
  }

  /**
   * Starts the history within its bound.
   * @param input - How to start, word and read the history.
   * @returns The recorder, or the cause for a run that goes on without a history: storage unavailable, a full store, a refused start or a start slower than its bound (a late writer is sealed empty, which removes its folder).
   * @example const begun = await ChromeExtensionHistoryRecorder.begin(input) // => { recorder } | { unavailable: 'storage is full' }
   */
  static async begin(
    input: ExtensionHistoryBeginInput,
  ): Promise<ExtensionHistoryBegun> {
    const bound = input.startBoundMs ?? EXTENSION_HISTORY_START_BOUND_MS
    const started = await startWithinBound(
      input.start(),
      bound,
      // A start that finishes later is sealed with nothing in it, which removes its folder.
      (late) => late.seal(),
    ).catch((error: unknown) => ({ failure: input.describeCause(error) }))
    if ('failure' in started) return { unavailable: started.failure }
    if ('timedOut' in started)
      return {
        unavailable: `the history did not start within ${bound / 1_000} s.`,
      }
    return {
      recorder: new ChromeExtensionHistoryRecorder(started.writer, input),
    }
  }

  get livePartialCode(): string | undefined {
    const { appendFailure } = this.writer
    if (appendFailure instanceof HistoryLimitReachedError)
      return EXTENSION_HISTORY_REASON_CODES.sizeLimit
    if (appendFailure !== undefined)
      return EXTENSION_HISTORY_REASON_CODES.appendFailed
    if (this.frames.isIncomplete)
      return EXTENSION_HISTORY_REASON_CODES.filmstripMissing
    return this.didSurfaceEnd
      ? EXTENSION_HISTORY_REASON_CODES.surfaceEnded
      : undefined
  }

  /** Why the history stopped taking evidence while the run lives, without private paths; `undefined` while it writes. */
  get appendFailure(): string | undefined {
    const { appendFailure } = this.writer
    return appendFailure === undefined
      ? undefined
      : this.input.describeCause(appendFailure)
  }

  pauseOpened(pause: ExtensionHistoryPause): void {
    this.safely(() => this.pauseOpenedNow(pause))
  }

  pinned(pauseId: string, pngBase64: string): void {
    this.safely(() => this.pinnedNow(pauseId, pngBase64))
  }

  private pinnedNow(pauseId: string, pngBase64: string): void {
    // A pin for a pause the history never opened would break the journal's order and names no stop. A pin after the seal began finds the frame writer closed: it is dropped, and the writer remembers the captured pin as lost.
    if (!this.knownPauseIds.has(pauseId)) return
    this.frames.offer({
      data: pngBase64,
      kind: 'pin',
      pauseId,
      capturedAtMs: this.writer.nowMs(),
    })
  }

  private pauseOpenedNow(pause: ExtensionHistoryPause): void {
    this.knownPauseIds.add(pause.pauseId)
    this.openPauses.set(pause.pauseId, pause)
    this.write(
      this.writer.appendPauseOpen({
        pauseId: pause.pauseId,
        generation: pause.generation,
        context: pause.context,
        stopIndex: pause.stopIndex,
        targetUrl: pause.targetUrl,
        workerGeneration: pause.workerGeneration,
      }),
    )
  }

  captured(pauseId: string, capture: CapturedExtensionStop): void {
    this.safely(() => this.capturedNow(pauseId, capture))
  }

  private capturedNow(pauseId: string, capture: CapturedExtensionStop): void {
    const top = capture.snapshot.frames[0]
    this.write(
      this.writer.appendCapture({
        pauseId,
        path: capture.path,
        line: capture.line,
        sourceHash: capture.sha256,
        sourceBytes: Buffer.byteLength(top?.source?.text ?? ''),
        debuggerSnapshot: capture.snapshot,
        facts: {
          stopIndex: capture.stopIndex,
          context: capture.context,
          workerGeneration: capture.workerGeneration,
          targetUrl: capture.targetUrl,
        },
      }),
    )
  }

  nowMs(): number {
    return this.writer.nowMs()
  }

  pauseClosed(
    pauseId: string,
    reason: 'continue' | 'worker-lost',
    endedAtMs?: number,
  ): void {
    this.safely(() => this.closePause(pauseId, reason, endedAtMs))
  }

  resultObserved(observed: ChromeExtensionObserved): void {
    this.safely(() => this.resultObservedNow(observed))
  }

  private resultObservedNow(observed: ChromeExtensionObserved): void {
    if (this.didWriteResult) return
    const outcome = extensionObservationResult(observed)
    // Serialized and queued before the flag is set: a throw leaves the slot free for the seal's fallback result.
    const queued = this.writer.appendResult({
      outcome,
      before: toJson(observed.before),
      after: toJson(observed.after),
      ...('unavailable' in observed.after
        ? { cause: observed.after.cause }
        : {}),
    })
    this.didWriteResult = true
    this.write(queued)
  }

  surfaceEnded(): void {
    this.safely(() => this.surfaceEndedNow())
  }

  private surfaceEndedNow(): void {
    this.didSurfaceEnd = true
  }

  /**
   * Ends and seals the history; the first call decides, every later call joins it.
   * @param end - How the run ended.
   * @param boundMs - How long the seal may take; past it the writer is abandoned (the folder lists as interrupted).
   * @returns Settles when the seal ended in a sealed or a failed state; never rejects.
   * @example await recorder.seal({ failureCode: 'SURFACE_LOST' }, 10_000)
   */
  seal(end: ExtensionHistoryEnd, boundMs: number): Promise<void> {
    this.sealOperation ??= this.runSeal(end, boundMs)
    return this.sealOperation
  }

  /** Does the one seal: the open pauses and the result first, then the queued frames within their deadline, then the writer's seal, bounded. */
  private async runSeal(
    end: ExtensionHistoryEnd,
    boundMs: number,
  ): Promise<void> {
    for (const pause of [...this.openPauses.values()])
      this.closePause(pause.pauseId, this.closeReasonOf(pause, end))
    if (!this.didWriteResult && end.observed) this.resultObserved(end.observed)
    if (!this.didWriteResult) {
      this.didWriteResult = true
      this.write(
        this.writer.appendResult({
          outcome: 'unavailable',
          cause: EXTENSION_HISTORY_RESULT_UNREAD_CAUSE,
        }),
      )
    }
    await this.frames.drain(EXTENSION_HISTORY_DRAIN_TIMEOUT_MS)
    // The bound starts before the cleanup, so a hung directory read or removal cannot hold Stop, Save or the next run past it.
    const deadline = startSealDeadline(boundMs)
    try {
      // A blob that never reached its name has no entry; the folder keeps no temporary file. A cleanup that loses the race is left behind.
      await Promise.race([this.frames.removeTemporaryBlobs(), deadline.passed])
      if (this.frames.failure !== undefined)
        this.reportFault(this.frames.failure)
      const raced = await Promise.race([this.sealWithRetry(), deadline.passed])
      // A writer whose seal is already published is never abandoned: the store lists it sealed.
      const hash =
        raced === SEAL_DEADLINE_PASSED ? this.writer.publishedSealHash : raced
      if (hash === undefined && raced === SEAL_DEADLINE_PASSED)
        return this.abandon(
          'Learning replay could not be saved: the seal timed out.',
        )
      await this.markSealed(hash, deadline.passed)
    } catch (error) {
      // A seal published before the fault is never abandoned either.
      const publishedHash = this.writer.publishedSealHash
      if (publishedHash === undefined)
        this.abandon(this.input.describeCause(error))
      else await this.markSealed(publishedHash, deadline.passed)
    } finally {
      deadline.cancel()
    }
  }

  /**
   * Records the sealed state with the summary the store reads of it.
   * Why: a stalled summary read must never hold Stop, Save or the next run; past the seal's deadline the published seal stands and the summary reads as not read yet.
   * @param hash - The published seal's journal hash.
   * @param deadline - Settles when the seal's bound is over; it bounds the summary read too.
   */
  private async markSealed(
    hash: string | undefined,
    deadline: Promise<unknown>,
  ): Promise<void> {
    this.status = 'sealed'
    this.isRemovedAsEmpty = this.writer.wasRemovedAsEmpty
    const summary = await Promise.race([
      this.readSummary(),
      deadline.then(() => undefined),
    ])
    this.sealed = { summary, hash }
  }

  /** Why a still-open pause closed when the run ended: its worker went away, the surface was lost, or the run simply ended. */
  private closeReasonOf(
    pause: ExtensionHistoryPause,
    end: ExtensionHistoryEnd,
  ): ExtensionPauseCloseReason {
    if (
      end.failureCode === 'SERVICE_WORKER_RESTARTED' &&
      pause.context === 'service-worker'
    )
      return 'worker-lost'
    return this.didSurfaceEnd || end.failureCode === 'SURFACE_LOST'
      ? 'surface-lost'
      : 'run-ended'
  }

  /** Journals the end of a pause once. */
  private closePause(
    pauseId: string,
    reason: ExtensionPauseCloseReason,
    endedAtMs?: number,
  ): void {
    if (!this.openPauses.delete(pauseId)) return
    this.write(
      this.writer.appendPauseClose({
        pauseId,
        reason,
        ...(endedAtMs === undefined ? {} : { endedAtMs }),
      }),
    )
  }

  /** Runs one sink call so that nothing it throws reaches the run; the fault is reported once. */
  private safely(step: () => void): void {
    try {
      step()
    } catch (error) {
      this.reportFault(error)
    }
  }

  /** Never lets a rejected append escape; the writer remembers the first failure, and the service hears of it once. */
  private write(operation: Promise<void>): void {
    operation.catch((error: unknown) => this.reportFault(error))
  }

  private reportFault(error: unknown): void {
    if (this.didReportFault) return
    this.didReportFault = true
    try {
      this.input.onFault?.(error)
    } catch {
      // A reporter that throws must not reach the run.
    }
  }

  /** Reads the sealed history's summary; never rejects. */
  private async readSummary(): Promise<ExtensionHistorySummary | undefined> {
    try {
      return await this.input.summarize(this.writer.header.studyId)
    } catch {
      return undefined
    }
  }

  /** Abandons the writer, so a late seal publishes nothing and the folder lists as interrupted. */
  private abandon(cause: string): void {
    this.status = 'failed'
    this.failure = cause
    this.writer.abandon()
  }

  /** Seals with what the recorder knows, retrying once after a transient file-system failure. */
  private sealWithRetry(): Promise<string | undefined> {
    return sealWithTransientRetry(
      () =>
        this.writer.seal({
          filmstripIncomplete: this.frames.isIncomplete,
          surfaceEnded: this.didSurfaceEnd,
          lostPinnedPauses: this.frames.lostPins(),
        }),
      this.input.retryDelay,
    )
  }
}
