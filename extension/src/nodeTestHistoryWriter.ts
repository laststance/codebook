import {
  NODE_TEST_HISTORY_LIMIT_BYTES,
  NODE_TEST_HISTORY_MAX_ENTRIES,
  NODE_TEST_HISTORY_SEAL_LIMIT_BYTES,
} from './constants'
import type { HistoryWriterRules } from './historyStorageDescriptor'
import { HistoryJournalWriter } from './nodeHistoryJournalWriter'
import {
  nodeTestHistoryEntrySchema,
  nodeTestHistorySealSchema,
  type NodeTestHistoryEntry,
  type NodeTestHistoryHeader,
  type NodeTestHistorySeal,
} from './nodeTestHistorySchemas'
import type { NodeTestHistoryTypes } from './nodeTestHistoryTypes'
import type { NodeTestSourceStop } from './ownedNodeTestRun'
import { sha256 } from './runtimeSupport/utils/sha256'
import type { NodeTestOutputEvent } from './utils/launchNodeTest'
import type { NodeLearningNeeds } from './utils/listMissingNodeExplanations'

/** The node-test profile's writer rules: declared stops in order, then one result, time never going back; holds the state of one writer. */
class NodeTestWriterRules implements HistoryWriterRules<NodeTestHistoryTypes> {
  readonly journalLimitBytes = NODE_TEST_HISTORY_LIMIT_BYTES
  readonly maxEntries = NODE_TEST_HISTORY_MAX_ENTRIES
  readonly sealLimitBytes = NODE_TEST_HISTORY_SEAL_LIMIT_BYTES
  private lastElapsedMs = 0
  private stopCount = 0
  private resultWritten = false
  private resultPassed = false
  /** The journal sequence of each stop entry confirmed, in stop order, and of the result entry. */
  readonly stopSequences: number[] = []
  resultSequence?: number

  constructor(private readonly header: NodeTestHistoryHeader) {}

  /** The number of stops the declaration asks for: its first plus the additional ones. */
  private get declaredStopCount(): number {
    return 1 + (this.header.configuration.additionalStops?.length ?? 0)
  }

  parseEntry(value: unknown): NodeTestHistoryEntry {
    return nodeTestHistoryEntrySchema.parse(value)
  }

  check(entry: NodeTestHistoryEntry): void {
    if (entry.elapsedMs < this.lastElapsedMs)
      throw new Error('Node history time moved backward.')
    if (
      this.resultWritten ||
      (entry.type === 'stop' && entry.index !== this.stopCount)
    )
      throw new Error(
        'Node history source stops or terminal result are missing or reordered.',
      )
    if (entry.type === 'result' && this.stopCount !== this.declaredStopCount)
      throw new Error('Node history result arrived before every declared stop.')
  }

  commit(entry: NodeTestHistoryEntry): void {
    this.lastElapsedMs = entry.elapsedMs
    if (entry.type === 'stop') {
      this.stopCount++
      this.stopSequences.push(entry.sequence)
    }
    if (entry.type === 'result') {
      this.resultWritten = true
      this.resultPassed = entry.exitCode === 0 && entry.signal === null
      this.resultSequence = entry.sequence
    }
  }

  holdsNothingToReplay(entryCount: number): boolean {
    return entryCount === 0
  }

  assertSealable(status: 'complete' | 'partial', failed: boolean): void {
    if (
      status === 'complete' &&
      (failed ||
        !this.resultPassed ||
        this.stopCount !== this.declaredStopCount)
    )
      throw new Error(
        'Node history cannot be marked complete without every ordered stop and an observed passing result.',
      )
  }

  buildSeal(input: {
    studyId: string
    status: 'complete' | 'partial'
    reason?: string
    journal: Buffer
    entryCount: number
    endedAt: string
  }): NodeTestHistorySeal {
    return nodeTestHistorySealSchema.parse({
      version: 1,
      studyId: input.studyId,
      entryCount: input.entryCount,
      journalBytes: input.journal.byteLength,
      journalHash: sha256(input.journal),
      status: input.status,
      endedAt: input.endedAt,
      reason: input.reason,
    })
  }
}

type NodeTestHistoryEntryInput = NodeTestHistoryEntry extends infer Entry
  ? Entry extends NodeTestHistoryEntry
    ? Omit<Entry, 'sequence'>
    : never
  : never

/** Serializes fsynced journal appends so output and debugger stops keep one verified timeline. The first failed entry ends that timeline; the verified prefix can still be sealed as partial. @example await writer.appendOutput(output) */
export class NodeTestHistoryWriter extends HistoryJournalWriter<NodeTestHistoryTypes> {
  private readonly testRules: NodeTestWriterRules

  constructor(
    directory: string,
    header: NodeTestHistoryHeader,
    onClosed: () => void,
  ) {
    const rules = new NodeTestWriterRules(header)
    super(directory, header, onClosed, rules)
    this.testRules = rules
  }

  /** Queues one stdout/stderr receipt in stamp order; the promise settles when it is durable. @example await writer.appendOutput(event) */
  appendOutput(event: NodeTestOutputEvent): Promise<void> {
    return this.appendTestEntry({
      type: 'output',
      elapsedMs: event.elapsedMs,
      outputSequence: event.sequence,
      channel: event.channel,
      text: event.text,
    })
  }

  /** Persists only the declared source, required facts and bounded historical debugger snapshot. @example await writer.appendStop(stop) */
  appendStop(stop: NodeTestSourceStop): Promise<void> {
    return this.appendTestEntry({
      type: 'stop',
      elapsedMs: stop.elapsedMs,
      index: stop.index,
      source: {
        path: stop.source.path,
        hash: stop.source.hash,
        line: stop.frame.line,
        column: stop.frame.column,
      },
      frame: {
        name: stop.frame.name,
        line: stop.frame.line,
        column: stop.frame.column,
      },
      facts: stop.facts,
      debuggerSnapshot: stop.debuggerSnapshot,
    })
  }

  /** Records the actual process exit and bounded final output tail. @example await writer.appendResult(result, elapsedMs) */
  appendResult(
    result: {
      exitCode: number | null
      signal: NodeJS.Signals | null
      output: string
    },
    elapsedMs: number,
  ): Promise<void> {
    return this.appendTestEntry({
      type: 'result',
      elapsedMs,
      exitCode: result.exitCode,
      signal: result.signal,
      outputTail: result.output,
    })
  }

  /**
   * Gives what the sealed journal asks a learning material to explain, from the sequences this writer assigned, so {@link StudyService} caches the run's learning coverage at the seal without reading the journal again (EN2).
   * @returns The sequence of each stop entry in stop order, and of the result entry when one was written.
   * @example writer.learningNeeds() // => { stopSequences: [2, 5], resultSequence: 7 }
   */
  learningNeeds(): NodeLearningNeeds {
    return {
      stopSequences: [...this.testRules.stopSequences],
      ...(this.testRules.resultSequence === undefined
        ? {}
        : { resultSequence: this.testRules.resultSequence }),
    }
  }

  /** Queues a test entry; the typed door to the generic append. */
  private appendTestEntry(input: NodeTestHistoryEntryInput): Promise<void> {
    return this.append(input)
  }
}
