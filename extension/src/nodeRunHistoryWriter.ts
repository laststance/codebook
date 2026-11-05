import { HistoryJournalWriter } from './nodeHistoryJournalWriter'
import {
  appendStopEvidence,
  NodeRunEntryAccounting,
  type NodeRunWriterStop,
} from './nodeRunHistoryEvidence'
import type { NodeRunTypes, NodeRunWriterRules } from './nodeRunWriterRules'
import type { NodeRunEvidenceEntryInput } from './nodeServerHistorySchemas'

/**
 * The part of a node run's history writer every profile shares: the evidence entries (output with its budget, executed sources and stops), the capture-budget mark, and the seal that closes the writer to new appends, queues the one `end` and seals the journal.
 * The node-server and node-script writers extend it with their own entries and their own end; the verified order every reader checks comes from the profile's {@link NodeRunWriterRules}.
 * @example class MyWriter extends NodeRunHistoryWriter<MyTypes> { … }
 */
export abstract class NodeRunHistoryWriter<
  Types extends NodeRunTypes,
> extends HistoryJournalWriter<Types> {
  /** The `(path, hash)` keys of sources this writer already queued. */
  private readonly queuedSources = new Set<string>()
  /** The declared stops handed to this writer with a hit, for an end a seal without the run's own end writes. */
  protected readonly offeredStops = new Set<number>()
  protected readonly accounting = new NodeRunEntryAccounting()
  private sealOperation?: Promise<string | undefined>
  /** The one write of `end`, kept so a retried seal never writes it twice. */
  private endOperation?: Promise<void>

  protected constructor(
    directory: string,
    header: Types['Header'],
    onClosed: () => void,
    protected readonly runRules: NodeRunWriterRules<Types>,
  ) {
    super(directory, header, onClosed, runRules)
  }

  /**
   * Counts an entry and sends it behind the accepted ones, unless the writer is closed to new appends; each profile's `appendEntry` calls it with its own entry type.
   * @param input - The entry without its sequence.
   * @param send - Queues the entry through the journal writer's append.
   * @returns Settles when the entry is durable; rejects when the rules or the disk refuse it; settles at once when the writer is closed.
   * @example return this.appendCounted(input, () => this.append(input))
   */
  protected appendCounted(
    input: { elapsedMs: number },
    send: () => Promise<void>,
  ): Promise<void> {
    // Closed to new appends from the moment the seal began: the entry is not written and is no failure, so a run that ended cleanly still seals complete.
    if (this.accounting.closedToAppends) return Promise.resolve()
    const release = this.accounting.admit(input)
    const operation = send()
    operation.then(release, release)
    return operation
  }

  /** Queues an evidence entry (output, source, stop, output cut) through the profile's `appendEntry`; each profile's entry union holds them all, which a generic base cannot show. */
  protected abstract queueEvidence(
    input: NodeRunEvidenceEntryInput,
  ): Promise<void>

  /**
   * Queues one stdout or stderr chunk, redacted by the caller, unless a bound says it must be dropped: the output budget, the structural headroom or the writer queue. The first drop appends one `output-truncated` entry; later output is dropped silently.
   * @param event - The chunk with its time since launch.
   * @returns Settles when the chunk is durable, or at once when it was dropped.
   * @example await writer.appendOutput({ elapsedMs: 12, channel: 'stdout', text: 'listening\n' })
   */
  appendOutput(event: {
    elapsedMs: number
    channel: 'stdout' | 'stderr'
    text: string
  }): Promise<void> {
    return this.accounting.appendOutput(event, (input) =>
      this.queueEvidence(input),
    )
  }

  /**
   * Says whether output is dropped for good: its budget was cut, an append failed, or the writer is closed to appends; the sink stops sanitizing and queueing output from then on.
   * @example if (writer.outputCut) return
   */
  // Read by the shared sink through its writer port, which static analysis cannot trace to this class.
  // fallow-ignore-next-line unused-class-member
  get outputCut(): boolean {
    return this.accounting.isOutputCut(this.appendFailure !== undefined)
  }

  /**
   * Records one hit of a declared stop. The executed source text is written once per `(path, hash)` in a `source` entry just before the first stop that needs it (hash only with `sourceUnavailable` for a text above 512 KiB or one that does not hash to its name), and the stop keeps its top frame's source by hash.
   * @param capture - The run's capture of the hit.
   * @returns Settles when the stop (and its source entry, if new) is durable.
   * @example await writer.appendStop({ elapsedMs: 60, declaredStopIndex: 0, hit: 1, generation: 1, source, frameName: 'handler', facts: {}, unavailable: [], snapshot })
   */
  appendStop(capture: NodeRunWriterStop): Promise<void> {
    this.offeredStops.add(capture.declaredStopIndex)
    return appendStopEvidence(capture, this.queuedSources, (input) =>
      this.queueEvidence(input),
    )
  }

  /**
   * Notes that the run refused a hit beyond its capture budget, so the seal says later hits were not recorded.
   * @example writer.markCaptureBudgetExhausted()
   */
  // Called by the shared sink through its writer port, which static analysis cannot trace to this class.
  // fallow-ignore-next-line unused-class-member
  markCaptureBudgetExhausted(): void {
    this.runRules.captureBudgetExhausted = true
  }

  /**
   * The time an `end` carries: the largest accepted time, queued entries included, so a run that ended cleanly never seals partial for time moving backward.
   * @param elapsedMs - The time the end asks for.
   * @returns The asked time, or the largest accepted time when that is later.
   * @example writer.endTime(900) // => 900
   */
  protected endTime(elapsedMs: number): number {
    return Math.max(elapsedMs, this.accounting.latestAcceptedMs)
  }

  /**
   * Closes the writer to new appends (an entry offered later is not written and is no failure) and queues the one `end` behind every entry accepted before it, through the base door that the closed flag does not shut. A retried seal never writes `end` twice; an `end` that cannot be written (the history already failed) does not stop the seal, which then reads partial.
   * @param send - Queues the `end` entry through the journal writer's append, its time from {@link endTime}.
   * @returns Settles when the `end` is durable or could not be written.
   * @example await this.queueEnd(() => this.append({ type: 'end', elapsedMs: this.endTime(900), … }))
   */
  protected queueEnd(send: () => Promise<void>): Promise<void> {
    this.accounting.closedToAppends = true
    this.endOperation ??= send().catch(() => undefined)
    return this.endOperation
  }

  /**
   * Seals the journal once: from the first call the rest join its operation; Stop, Save, dispose, self-exit and failure all share one seal. A failed seal may be tried again.
   * @param queueEnd - Queues the profile's `end` (see {@link queueEnd}) before the journal is sealed.
   * @returns The sealed journal's hash; `undefined` for a writer abandoned before the call.
   * @throws When the seal cannot be written or the writer is abandoned while the seal is in flight.
   * @example return this.sealOnce(() => this.queueEnd(end))
   */
  protected sealOnce(
    queueEnd: () => Promise<void>,
  ): Promise<string | undefined> {
    if (this.sealOperation) return this.sealOperation
    // The flag is set in this turn, before any later append is offered.
    const operation = queueEnd().then(() => super.finish('partial'))
    this.sealOperation = operation
    operation.catch(() => {
      this.sealOperation = undefined
    })
    return operation
  }
}
