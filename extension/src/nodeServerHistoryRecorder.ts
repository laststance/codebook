import {
  NODE_SERVER_HISTORY_START_BOUND_MS,
  SEAL_RETRY_DELAY_MS,
  TRANSIENT_SEAL_ERROR_CODES,
} from './constants'
import {
  NodeServerHistorySinkImpl,
  type NodeServerHistorySinkInput,
} from './nodeServerHistorySink'
import type { NodeServerHistorySummary } from './nodeServerHistoryTypes'
import type {
  NodeServerEndInput,
  NodeServerHistoryWriter,
} from './nodeServerHistoryWriter'
import {
  describeNodeServerSealFailure,
  describeNodeServerSealTimeout,
} from './utils/describeNodeServerSealFailure'
import { systemErrorCode } from './utils/systemErrorCode'

/** Where a server run's history stands: its writer takes entries, it was sealed, or it was abandoned because it could not be written or sealed. */
export type NodeServerHistoryStatus = 'recording' | 'sealed' | 'failed'

/** What {@link NodeServerHistoryRecorder.begin} needs from the service. */
export type NodeServerHistoryBeginInput = {
  /** Reserves the history and returns its writer; rejects when storage is unavailable, full or refuses the start. */
  start: () => Promise<NodeServerHistoryWriter>
  /** Words a failure for the learner without private paths. */
  describeCause: (error: unknown) => string
  sink: Omit<NodeServerHistorySinkInput, 'writer'>
  /** The start's bound; {@link NODE_SERVER_HISTORY_START_BOUND_MS} unless a test names its own. */
  startBoundMs?: number
  /** Reads the sealed history's summary for the verdicts; `undefined` when it cannot be read. */
  summarize: (studyId: string) => Promise<NodeServerHistorySummary | undefined>
  /** Waits before the one retry of a transient seal failure. */
  retryDelay?: (milliseconds: number) => Promise<void>
}

/** The outcome of a start: the recorder, or why this run has no history (the live run goes on either way). */
export type NodeServerHistoryBegun =
  { recorder: NodeServerHistoryRecorder } | { unavailable: string }

/**
 * Owns one live node-server run's history from its start to its seal: the writer, the sink the run feeds, the one seal every ending joins, and the verdicts read once it sealed.
 * Why: Stop, `codebook_stop`, Save, dispose, self-exit and failure must give one seal, and a history that cannot start, be written or be sealed must never fail the run; this holds that state apart from {@link StudyService}.
 * Created by {@link StudyService} before it launches a node-server run; {@link NodeServerHistoryRecorder.seal} is called by its stop path.
 * @example
 * const begun = await NodeServerHistoryRecorder.begin(input)
 * if ('recorder' in begun) await begun.recorder.seal({ elapsedMs: 900, reason: 'stopped' }, 10_000)
 */
export class NodeServerHistoryRecorder {
  status: NodeServerHistoryStatus = 'recording'
  /** Why the history was abandoned or its seal failed, without private paths. */
  failure?: string
  /** The sealed history's summary and journal hash, once sealed. */
  sealed?: {
    summary: NodeServerHistorySummary | undefined
    hash: string | undefined
  }
  private sealOperation?: Promise<void>

  private constructor(
    readonly writer: NodeServerHistoryWriter,
    readonly sink: NodeServerHistorySinkImpl,
    private readonly input: NodeServerHistoryBeginInput,
  ) {}

  /**
   * Starts the history within its bound.
   * @param input - How to start, word and read the history.
   * @returns The recorder, or the cause for a run that goes on without a history: storage unavailable, a full store, a refused start or a start slower than its bound (a late writer is sealed empty, which removes its folder).
   * @example const begun = await NodeServerHistoryRecorder.begin(input) // => { recorder } | { unavailable: 'storage is full' }
   */
  static async begin(
    input: NodeServerHistoryBeginInput,
  ): Promise<NodeServerHistoryBegun> {
    const bound = input.startBoundMs ?? NODE_SERVER_HISTORY_START_BOUND_MS
    const starting = input.start()
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = Symbol('expired')
    try {
      const writer = await Promise.race([
        starting,
        new Promise<typeof expired>((resolve) => {
          timer = setTimeout(() => resolve(expired), bound)
          timer.unref()
        }),
      ])
      if (writer === expired) {
        // A start that finishes later is sealed with nothing in it, which removes its folder.
        void starting
          .then(
            (late) => late.seal({ elapsedMs: 0, reason: 'stopped' }),
            () => undefined,
          )
          .catch(() => undefined)
        return {
          unavailable: `the history did not start within ${bound / 1_000} s.`,
        }
      }
      const sink = new NodeServerHistorySinkImpl({ ...input.sink, writer })
      return { recorder: new NodeServerHistoryRecorder(writer, sink, input) }
    } catch (error) {
      return { unavailable: input.describeCause(error) }
    } finally {
      if (timer) clearTimeout(timer)
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
   * @returns Settles when the seal ended in a sealed or a failed state; never rejects.
   * @example await recorder.seal({ elapsedMs: 900, reason: 'stopped' }, 10_000)
   */
  // fallow-ignore-next-line unused-class-member
  seal(end: NodeServerEndInput, boundMs: number): Promise<void> {
    this.sealOperation ??= this.runSeal(end, boundMs)
    return this.sealOperation
  }

  /** Does the one seal: the output waiting to be coalesced first, then the writer's seal, bounded. */
  private async runSeal(
    end: NodeServerEndInput,
    boundMs: number,
  ): Promise<void> {
    this.sink.flush()
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = Symbol('expired')
    try {
      const hash = await Promise.race([
        this.sealWithRetry(end),
        new Promise<typeof expired>((resolve) => {
          timer = setTimeout(() => resolve(expired), boundMs)
          timer.unref()
        }),
      ])
      if (hash === expired) {
        this.abandon(describeNodeServerSealTimeout(boundMs / 1_000))
        return
      }
      this.status = 'sealed'
      const summary = await this.input
        .summarize(this.writer.header.studyId)
        .catch(() => undefined)
      this.sealed = { summary, hash }
    } catch (error) {
      this.abandon(
        describeNodeServerSealFailure(this.input.describeCause(error)),
      )
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** Abandons the writer, so a late seal publishes nothing and the folder lists as interrupted. */
  private abandon(cause: string): void {
    this.writer.abandon()
    this.status = 'failed'
    this.failure = cause
  }

  /** Seals, and once more after a short wait when the first attempt failed with a transient file-system code. */
  private async sealWithRetry(
    end: NodeServerEndInput,
  ): Promise<string | undefined> {
    try {
      return await this.writer.seal(end)
    } catch (error) {
      if (!TRANSIENT_SEAL_ERROR_CODES.includes(systemErrorCode(error)))
        throw error
      const wait =
        this.input.retryDelay ??
        ((milliseconds: number): Promise<void> =>
          new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
      await wait(SEAL_RETRY_DELAY_MS)
      return this.writer.seal(end)
    }
  }
}
