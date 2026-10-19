import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EVENT_DETAIL_LIMIT_BYTES } from '../constants'
import { cutTextToFit } from '../utils/cutTextToFit'

import { NANOSECONDS_PER_MILLISECOND } from './constants'

export interface RecordedEvent {
  sequence: number
  elapsedMs: number
  wallTime: string
  type: string
  detail: unknown
}

/** An event stamped by {@link Evidence} before it decides whether to keep it: the event, its journal line and that line's size. */
interface EventReceipt {
  event: RecordedEvent
  serialized: string
  bytes: number
}

/**
 * The failures {@link Evidence.recordFailure} journals, also past a refusal.
 * - `run.failed`: the run's own failure, which ends its journal (row 666).
 * - `explanation.failed`: an explanation whose save failed after its run ended, which leaves the run's outcome as it was (row 699).
 */
type JournaledFailureType = 'run.failed' | 'explanation.failed'

export interface EvidenceLimits {
  maxEvents: number
  retainedBytes: number
  queuedBytes: number
}

/** Preserves receipt ordering and serializes disk writes without blocking debugger control. @example evidence.record('stopped', { generation: 1 }) */
export class Evidence {
  readonly events: RecordedEvent[] = []
  readonly started = process.hrtime.bigint()
  failure?: string
  private pending: Promise<void>
  private retainedBytes = 0
  private queuedBytes = 0
  /** The failure types {@link Evidence.recordFailure} already kept past a refusal, so the journal's bounds are exceeded by one event of each type at most (Cycle 0046 row 706). */
  private readonly failureTypesKeptPastRefusal = new Set<JournaledFailureType>()

  constructor(
    readonly directory: string,
    private readonly limits?: EvidenceLimits,
  ) {
    // Even an immediate DELETE/focus event must append only after the directory exists.
    this.pending = mkdir(directory, { recursive: true })
      .then(() => undefined)
      .catch((error) => {
        this.failure = String(error)
      })
  }

  /** Records a local receipt time immediately when any runtime lane reports evidence. @example evidence.record('input.accepted', { operationId: 'op' }) */
  record(type: string, detail: unknown = {}): RecordedEvent {
    const receipt = this.receiptOf(type, detail)
    if (this.refuses(receipt.bytes)) {
      this.failure ??= 'Evidence buffering limit exceeded'
      return receipt.event
    }
    return this.retain(receipt)
  }

  /**
   * Journals a run's failure as `run.failed`, also once the evidence refused further events or failed to write them, so the journal every reader reads (the run's events resource, the end of its recording, the replay's paused intervals) ends with the run's failure (Cycle 0046 row 666); called by {@link ConfiguredBrowserRun.fail}, which journals a run's failure once, and, as `explanation.failed`, by {@link StudyService.explain} for an explanation whose save failed after its run ended (row 699): a `run.failed` after the end would read as the end of a failed run.
   * Past a refusal the event is kept in {@link Evidence.events} and appended to `events.jsonl` while that file can still be written; the first failure stays the evidence's {@link Evidence.failure}, and one failure of each type is kept past a refusal, so a stopped run whose kept `run.failed` ended its journal still journals why its explanation was not committed (row 706); a later failure of a type already kept is not, as a later explanation's save repeats the failure the evidence refuses with. Its reason is cut so that its detail fits {@link EVENT_DETAIL_LIMIT_BYTES}, ending with {@link CUT_TEXT_MARKER} where it was cut ({@link cutTextToFit}): the journal's bounds are exceeded by one event of each type at most, and each such event by one line of bounded size, as long as a stack or an adapter's message may be (row 698). The same limit is the one the run's events resource shows an event's detail whole within.
   * @param reason - The failure, as its caller was given it.
   * @param type - The event's type: `run.failed` for the run's own failure, `explanation.failed` for an explanation of an ended run.
   * @returns The journaled event; an event that is not kept for a second failure of its type past a refusal.
   * @example
   * evidence.failure // => 'Evidence buffering limit exceeded'
   * evidence.recordFailure('Selected debugger terminated')
   * evidence.events.at(-1) // => { sequence: 10001, type: 'run.failed', detail: { reason: 'Selected debugger terminated' }, … }
   */
  recordFailure(
    reason: string,
    type: JournaledFailureType = 'run.failed',
  ): RecordedEvent {
    const receipt = this.receiptOf(type, { reason })
    if (!this.refuses(receipt.bytes)) return this.retain(receipt)
    this.failure ??= 'Evidence buffering limit exceeded'
    // One failure of each type past the refusal, so the journal's bounds are exceeded by one event of each type at most (row 706).
    if (this.failureTypesKeptPastRefusal.has(type)) return receipt.event
    this.failureTypesKeptPastRefusal.add(type)
    // That one event's reason is cut to the detail limit, so its line has a size bound too (row 698).
    const boundedReason = cutTextToFit(
      reason,
      (candidate) =>
        Buffer.byteLength(JSON.stringify({ reason: candidate })) <=
        EVENT_DETAIL_LIMIT_BYTES,
    )
    return this.retain(this.receiptOf(type, { reason: boundedReason }))
  }

  /**
   * Stamps an event with its sequence and receipt times and serializes it once, for {@link Evidence.record} and {@link Evidence.recordFailure}.
   * @param type - The event's type.
   * @param detail - The event's detail, serialized as it is now.
   * @returns The event, its journal line and that line's size in bytes.
   * @example this.receiptOf('input.accepted', { operationId: 'op' }).bytes // => 142
   */
  private receiptOf(type: string, detail: unknown): EventReceipt {
    const event = {
      sequence: this.events.length + 1,
      elapsedMs: this.elapsedMs(),
      wallTime: new Date().toISOString(),
      type,
      detail,
    }
    const serialized = JSON.stringify(event) + '\n'
    return { event, serialized, bytes: Buffer.byteLength(serialized) }
  }

  /**
   * Says whether a product adapter's evidence refuses another event: after a failure, or when the event would pass a bound; legacy experiments without limits preserve their existing contract and refuse nothing. Asked by {@link Evidence.record} and {@link Evidence.recordFailure}.
   * @param bytes - The size of the event's journal line.
   * @returns `true` when the event must not be buffered; `false` without limits or within them.
   * @example this.refuses(142) // => true once this.failure is set
   */
  private refuses(bytes: number): boolean {
    return Boolean(
      this.limits &&
      (this.failure ||
        this.events.length >= this.limits.maxEvents ||
        this.retainedBytes + bytes > this.limits.retainedBytes ||
        this.queuedBytes + bytes > this.limits.queuedBytes),
    )
  }

  /**
   * Keeps an event in the journal and queues its line for `events.jsonl`, for {@link Evidence.record} and {@link Evidence.recordFailure}.
   * @param receipt - The stamped event.
   * @returns The retained copy of the event.
   * @example this.retain(this.receiptOf('stopped', { generation: 1 })).sequence // => 1
   */
  private retain(receipt: EventReceipt): RecordedEvent {
    const { serialized, bytes } = receipt
    // Retain the serialized observation, never a live object that later input acknowledgements can mutate.
    const captured: RecordedEvent = JSON.parse(serialized)
    this.events.push(captured)
    this.retainedBytes += bytes
    this.queuedBytes += bytes
    this.pending = this.pending
      .then(() => appendFile(join(this.directory, 'events.jsonl'), serialized))
      .catch((error) => {
        // The first failure is the evidence's cause; a later append, such as a run's failure journaled past it, does not replace it.
        this.failure ??= String(error)
      })
      .finally(() => {
        this.queuedBytes -= bytes
      })
    return captured
  }

  /** Shares the run's monotonic receipt clock with optional recording observers; pause time remains included. @example evidence.elapsedMs() // 1250.5 */
  elapsedMs(): number {
    return (
      Number(process.hrtime.bigint() - this.started) /
      NANOSECONDS_PER_MILLISECOND
    )
  }

  /** Confirms queued directory initialization before setup proceeds, called by the run. @example await evidence.initialize() */
  async initialize(): Promise<void> {
    await this.flush()
  }

  /**
   * Saves fixed-name evidence supplied by the implementation, never by an HTTP file parameter.
   * A bounded evidence refuses the save once it has failed, or when the save would pass its queued bound; the refusal names the evidence's failure as {@link Evidence.flush} does ("Evidence write failed: <failure>"), so a caller that quotes the error names that failure once.
   * @throws The refusal, or the file system's error of the write.
   * @example await evidence.save('snapshot.json', snapshot)
   */
  async save(name: string, contents: unknown): Promise<void> {
    const bytes =
      typeof contents === 'string' || Buffer.isBuffer(contents)
        ? contents
        : JSON.stringify(contents, null, 2) + '\n'
    const byteCount = Buffer.byteLength(bytes)
    if (
      this.limits &&
      (this.failure || this.queuedBytes + byteCount > this.limits.queuedBytes)
    ) {
      this.failure ??= 'Evidence queued write limit exceeded'
      throw new Error(`Evidence write failed: ${this.failure}`)
    }
    this.queuedBytes += byteCount
    // Share the event queue so an older manifest cannot finish after a newer one.
    const saving = this.pending
      .then(async () => {
        // The failure is kept as the string form of its error ("Error: ENOENT: …"): it is quoted, never made the message itself, which would repeat its error name.
        if (this.limits && this.failure)
          throw new Error(`Evidence write failed: ${this.failure}`)
        const temporaryPath = join(this.directory, `${name}.tmp`)
        await writeFile(temporaryPath, bytes)
        await rename(temporaryPath, join(this.directory, name))
      })
      .finally(() => {
        this.queuedBytes -= byteCount
      })
    this.pending = saving.catch((error) => {
      // The first failure is the evidence's cause, as for an append: a save that refused on an earlier append's failure would name it a second time.
      this.failure ??= String(error)
    })
    await saving
  }

  /** Flushes the append queue before teardown or manifest finalization. @example await evidence.flush() */
  async flush(): Promise<void> {
    await this.pending
    if (this.failure) throw new Error(`Evidence write failed: ${this.failure}`)
  }
}
