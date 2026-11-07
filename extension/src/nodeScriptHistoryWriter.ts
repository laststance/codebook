import { NODE_SCRIPT_HISTORY_SEAL_VERSION } from './constants'
import { NodeRunHistoryWriter } from './nodeRunHistoryWriter'
import {
  NodeRunWriterRules,
  type NodeRunRuleProfile,
} from './nodeRunWriterRules'
import {
  nodeScriptHistoryEntrySchema,
  nodeScriptHistorySealSchema,
  type NodeScriptEndInput,
  type NodeScriptHistoryEntryInput,
  type NodeScriptHistoryHeader,
  type NodeScriptLibraryObservedEntry,
  type NodeScriptLibraryPreparedEntry,
} from './nodeScriptHistorySchemas'
import type { NodeScriptHistoryTypes } from './nodeScriptHistoryTypes'
import type { NodeRunEvidenceEntryInput } from './nodeServerHistorySchemas'
import { evaluateNodeScriptCapture } from './utils/evaluateNodeScriptCapture'
import { describeLastNodeServerEntry } from './utils/evaluateNodeServerCapture'
import { acceptNodeScriptEntry } from './utils/nodeServerJournalRules'

/** What differs between the node-script writer's rules and the node-server writer's. */
const NODE_SCRIPT_RULE_PROFILE: NodeRunRuleProfile<NodeScriptHistoryTypes> = {
  // The seal keeps its own version, separate from the header format, so a format 2 header never rejects a seal.
  sealVersion: NODE_SCRIPT_HISTORY_SEAL_VERSION,
  parseEntry: (value) => nodeScriptHistoryEntrySchema.parse(value),
  parseSeal: (value) => nodeScriptHistorySealSchema.parse(value),
  accept: acceptNodeScriptEntry,
  evaluate: evaluateNodeScriptCapture,
  describeEntry: describeLastNodeServerEntry,
  // A script that ended before its first stop still has an observed result (its output, its exit): kept, with the missing stops named. Only a run that never ran (no stop, no output, no end of its own) holds nothing to replay.
  holdsNothingToReplay: (progress) =>
    progress.stopCount === 0 && !progress.hasObservedResult,
}

/**
 * Writes a node-script run's evidence as it happens: output, executed sources, stops and the one `end`, in the verified order every reader checks.
 * Source text is stored once per `(path, hash)` just before the first stop that needs it. Output has its own budget, so a chatty script never crowds out the stops or the end; past a bound output is dropped with one `output-truncated` entry while structural entries still wait for their turn.
 * Built by {@link nodeScriptStorageDescriptor} when the store reserves a history; the run feeds it through {@link NodeScriptHistorySink}.
 * @example const writer = await scripts.start(header); await writer.appendStop(capture); await writer.seal(end)
 */
export class NodeScriptHistoryWriter extends NodeRunHistoryWriter<NodeScriptHistoryTypes> {
  constructor(
    directory: string,
    private readonly scriptHeader: NodeScriptHistoryHeader,
    onClosed: () => void,
    describeCause: (error: unknown) => string,
  ) {
    super(
      directory,
      scriptHeader,
      onClosed,
      new NodeRunWriterRules(
        scriptHeader,
        describeCause,
        NODE_SCRIPT_RULE_PROFILE,
      ),
    )
  }

  /**
   * Queues one entry exactly as given; the low-level door the typed methods use, public so a test can offer an entry the typed methods would never build.
   * @param input - The entry without its sequence.
   * @returns Settles when the entry is durable; rejects when the rules or the disk refuse it.
   * @example await writer.appendEntry({ type: 'output', elapsedMs: 3, channel: 'stdout', text: 'ready\n' })
   */
  appendEntry(input: NodeScriptHistoryEntryInput): Promise<void> {
    return this.appendCounted(input, () => this.append(input))
  }

  /**
   * Queues the `library.prepared` entry: what the build and pack made. Written once, after the pack and before the script's own entries; only a format 2 history accepts it.
   * @param facts - The prepared facts with their time since launch.
   * @returns Settles when the entry is durable; rejects when the rules or the disk refuse it; settles at once when the writer is already closed by `end`.
   * @example await writer.appendLibraryPrepared({ elapsedMs: 0, package: '@scope/lib', version: '2.14.0', … })
   */
  // Called by the script sink through its writer port, which static analysis cannot trace to this class.
  // fallow-ignore-next-line unused-class-member
  appendLibraryPrepared(
    facts: Omit<NodeScriptLibraryPreparedEntry, 'type' | 'sequence'>,
  ): Promise<void> {
    return this.appendEntry({ type: 'library.prepared', ...facts })
  }

  /**
   * Queues the `library.observed` entry: what the script loaded. The run appends it after its process tree ended and before {@link appendEnd}, because `end` closes the writer to new appends and an observation offered later is dropped (no failure, nothing written).
   * @param facts - The observation with its time since launch.
   * @returns Settles when the entry is durable; rejects when the rules or the disk refuse it; settles at once, writing nothing, when `end` already closed the writer.
   * @example await writer.appendLibraryObserved({ elapsedMs: 900, loaded: true, loadCount: 3, otherCopyLoaded: false, observation: 'complete' })
   */
  // Called by the script sink through its writer port, which static analysis cannot trace to this class.
  // fallow-ignore-next-line unused-class-member
  appendLibraryObserved(
    facts: Omit<NodeScriptLibraryObservedEntry, 'type' | 'sequence'>,
  ): Promise<void> {
    return this.appendEntry({ type: 'library.observed', ...facts })
  }

  protected override queueEvidence(
    input: NodeRunEvidenceEntryInput,
  ): Promise<void> {
    return this.appendEntry(input)
  }

  /**
   * Queues the one `end` of the run and closes the writer to new appends: output offered later is dropped and is no failure. `end` is written once, behind every entry accepted before it, carrying the largest accepted time so a run that ended cleanly never seals partial for time moving backward.
   * @param end - How the run ended.
   * @returns Settles when the `end` is durable or could not be written (the seal then reads partial).
   * @example await writer.appendEnd({ elapsedMs: 900, kind: 'exited', exitCode: 0, stopsReached: [0], stopsNeverReached: [] })
   */
  appendEnd(end: NodeScriptEndInput): Promise<void> {
    return this.queueEnd(() =>
      this.append({
        type: 'end',
        ...end,
        elapsedMs: this.endTime(end.elapsedMs),
      }),
    )
  }

  /**
   * Ends and seals the history: the `end` is queued (the given one, or a `stopped` end derived from the stops offered so far when the run gave none), the accepted entries are written, then `sealed.json`; Stop, Save, dispose, self-exit and failure all call it and share one seal. A history whose `end` cannot be written seals as a partial one.
   * @param end - How the run ended; absent when the writer is sealed without the run's own end.
   * @returns The sealed journal's hash; `undefined` for a writer abandoned before the call.
   * @throws When the seal cannot be written or the writer is abandoned while the seal is in flight.
   * @example await writer.seal({ elapsedMs: 900, kind: 'stopped', stopsReached: [0], stopsNeverReached: [1] })
   */
  seal(end?: NodeScriptEndInput): Promise<string | undefined> {
    return this.sealOnce(() => this.appendEnd(end ?? this.derivedEnd()))
  }

  /**
   * Seals through {@link seal}, so no script `sealed.json` is ever written without its `end`. The status and reason are decided by the evidence, so both arguments are ignored.
   * @returns The sealed journal's hash; `undefined` for a writer abandoned before the call.
   * @throws When the seal cannot be written or the writer is abandoned while it is in flight.
   * @example await writer.finish('partial')
   */
  override finish(
    _status?: 'complete' | 'partial',
    _reason?: string,
  ): Promise<string | undefined> {
    return this.seal()
  }

  /** The end of a run sealed without its own: stopped, with the stops offered so far; once the capture budget was spent, the stops not offered are not observed, never never-reached. */
  private derivedEnd(): NodeScriptEndInput {
    const stopsReached = [...this.offeredStops].sort((a, b) => a - b)
    const unreached = this.scriptHeader.declaredStops.flatMap((_stop, index) =>
      this.offeredStops.has(index) ? [] : [index],
    )
    const budgetSpent = this.runRules.captureBudgetExhausted
    return {
      elapsedMs: this.endTime(this.runRules.lastElapsedMs),
      kind: 'stopped',
      stopsReached,
      stopsNeverReached: budgetSpent ? [] : unreached,
      ...(budgetSpent
        ? { captureBudgetExhausted: true as const, stopsNotObserved: unreached }
        : {}),
    }
  }
}
