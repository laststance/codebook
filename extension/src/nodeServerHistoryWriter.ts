import {
  NODE_SERVER_HISTORY_LIMIT_BYTES,
  NODE_SERVER_HISTORY_MAX_ENTRIES,
  NODE_SERVER_HISTORY_SEAL_LIMIT_BYTES,
  NODE_SERVER_OUTPUT_BUDGET_BYTES,
  NODE_SERVER_OUTPUT_BUDGET_ENTRIES,
  NODE_SERVER_SOURCE_TEXT_LIMIT_BYTES,
  NODE_SERVER_STRUCTURAL_HEADROOM_BYTES,
  NODE_SERVER_STRUCTURAL_HEADROOM_ENTRIES,
  NODE_SERVER_WRITER_QUEUE_LIMIT_BYTES,
  NODE_SERVER_WRITER_QUEUE_LIMIT_ENTRIES,
} from './constants'
import type { HistoryWriterRules } from './historyStorageDescriptor'
import { HistoryJournalWriter } from './nodeHistoryJournalWriter'
import {
  nodeServerHistoryEntrySchema,
  nodeServerHistorySealSchema,
  type NodeServerHistoryEntry,
  type NodeServerHistoryEntryInput,
  type NodeServerHistoryHeader,
  type NodeServerHistorySeal,
  type NodeServerStopEntry,
} from './nodeServerHistorySchemas'
import type { NodeServerHistoryTypes } from './nodeServerHistoryTypes'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import { sha256 } from './runtimeSupport/utils/sha256'
import { cutHistoryReason } from './utils/cutHistoryReason'
import { dehydrateServerStopSnapshot } from './utils/dehydrateServerStopSnapshot'
import {
  describeLastNodeServerEntry,
  evaluateNodeServerCapture,
} from './utils/evaluateNodeServerCapture'
import { maskSecretQueryValues } from './utils/maskSecretQueryValues'
import {
  acceptNodeServerEntry,
  newNodeServerJournalProgress,
} from './utils/nodeServerJournalRules'

/** The node-server profile's writer rules: the journal rules every reader shares, plus the evaluator that builds the seal; holds the state of one writer. */
class NodeServerWriterRules implements HistoryWriterRules<NodeServerHistoryTypes> {
  readonly journalLimitBytes = NODE_SERVER_HISTORY_LIMIT_BYTES
  readonly maxEntries = NODE_SERVER_HISTORY_MAX_ENTRIES
  readonly sealLimitBytes = NODE_SERVER_HISTORY_SEAL_LIMIT_BYTES
  private readonly progress = newNodeServerJournalProgress()
  private lastEntry?: NodeServerHistoryEntry
  captureBudgetExhausted = false

  constructor(
    private readonly header: NodeServerHistoryHeader,
    private readonly describeCause: (error: unknown) => string,
  ) {}

  parseEntry(value: unknown): NodeServerHistoryEntry {
    return nodeServerHistoryEntrySchema.parse(value)
  }

  check(entry: NodeServerHistoryEntry): void {
    // The same function the incremental scan and the full read call.
    acceptNodeServerEntry(this.progress, entry, this.header)
  }

  commit(entry: NodeServerHistoryEntry): void {
    this.lastEntry = entry
  }

  /** A server history with no request holds nothing to replay. */
  holdsNothingToReplay(): boolean {
    return this.progress.lastAttempt === 0
  }

  /** The seal's status comes from the evaluator, so any requested status is accepted and then decided by the evidence. */
  assertSealable(): void {}

  buildSeal(input: {
    studyId: string
    journal: Buffer
    entryCount: number
    endedAt: string
    appendFailure?: Error
    limitReached: boolean
  }): NodeServerHistorySeal {
    const entries = input.journal
      .toString('utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => this.parseEntry(JSON.parse(line)))
    const reasons = evaluateNodeServerCapture(this.header, entries, {
      ...(input.appendFailure
        ? {
            appendFailure: {
              lastEntry: this.lastEntry
                ? describeLastNodeServerEntry(this.lastEntry)
                : 'the start of the history',
              cause: this.describeCause(input.appendFailure),
            },
          }
        : {}),
      sizeLimitReached: input.limitReached,
      captureBudgetExhausted: this.captureBudgetExhausted,
    })
    const complete = reasons.length === 0
    return nodeServerHistorySealSchema.parse({
      version: 1,
      studyId: input.studyId,
      entryCount: input.entryCount,
      journalBytes: input.journal.byteLength,
      journalHash: sha256(input.journal),
      status: complete ? 'complete' : 'partial',
      endedAt: input.endedAt,
      reasons,
      capture: complete ? 'complete' : 'incomplete',
      ...(reasons[0] ? { reason: cutHistoryReason(reasons[0].text) } : {}),
    })
  }
}

type EntryInputOf<Type extends NodeServerHistoryEntry['type']> = Omit<
  Extract<NodeServerHistoryEntry, { type: Type }>,
  'sequence'
>

/** The entry `end` of a run, without its sequence; what {@link NodeServerHistoryWriter.seal} appends. */
export type NodeServerEndInput = Omit<EntryInputOf<'end'>, 'type'>

/** What the run's capture of one stop hit hands the writer. */
export type NodeServerStopCapture = {
  elapsedMs: number
  declaredStopIndex: number
  hit: number
  generation: number
  source: { path: string; hash: string; line: number; column: number }
  frameName: string
  facts: NodeServerStopEntry['facts']
  unavailable: Array<{ path: string; reason: string }>
  /** The redacted snapshot, its top frame still carrying the executed source text. */
  snapshot: ReplayDebugSnapshot
}

/** Estimates the bytes of an entry's journal line before it is numbered; close enough to keep the bounds honest. */
function estimateLineBytes(input: unknown): number {
  return Buffer.byteLength(JSON.stringify(input)) + 24
}

/**
 * Writes a node-server run's evidence as it happens: output, request attempts, executed sources, stops, the response and the end, in the one verified order every reader checks.
 * Source text is stored once per `(path, hash)` just before the first stop that needs it. Output has its own budget, so a chatty server never crowds out the request, the stops or the answer; past a bound output is dropped with one `output-truncated` entry while structural entries still wait for their turn.
 * Built by {@link nodeServerStorageDescriptor} when the store reserves a history; the run (pt3) feeds it through a history sink.
 * @example const writer = await servers.start(header); await writer.appendRequest({ … }); await writer.seal({ reason: 'stopped', elapsedMs: 900 })
 */
export class NodeServerHistoryWriter extends HistoryJournalWriter<NodeServerHistoryTypes> {
  private readonly serverRules: NodeServerWriterRules
  /** The `(hash)` of sources this writer already queued, by path and hash. */
  private readonly queuedSources = new Set<string>()
  private acceptedEntries = 0
  private acceptedBytes = 0
  private outputEntries = 0
  private outputBytes = 0
  private outputWasCut = false
  private pendingEntries = 0
  private pendingBytes = 0
  private sealOperation?: Promise<string | undefined>

  constructor(
    directory: string,
    header: NodeServerHistoryHeader,
    onClosed: () => void,
    describeCause: (error: unknown) => string,
  ) {
    const rules = new NodeServerWriterRules(header, describeCause)
    super(directory, header, onClosed, rules)
    this.serverRules = rules
  }

  /**
   * Queues one entry exactly as given; the low-level door the typed methods use, public so a test can offer an entry the typed methods would never build.
   * @param input - The entry without its sequence.
   * @returns Settles when the entry is durable; rejects when the rules or the disk refuse it.
   * @example await writer.appendEntry({ type: 'request-sent', elapsedMs: 3, attempt: 1 })
   */
  appendEntry(input: NodeServerHistoryEntryInput): Promise<void> {
    const bytes = estimateLineBytes(input)
    this.acceptedEntries++
    this.acceptedBytes += bytes
    this.pendingEntries++
    this.pendingBytes += bytes
    const operation = this.append(input)
    const release = (): void => {
      this.pendingEntries--
      this.pendingBytes -= bytes
    }
    operation.then(release, release)
    return operation
  }

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
    if (this.outputWasCut) return Promise.resolve()
    const input = { type: 'output' as const, ...event }
    const bytes = estimateLineBytes(input)
    const limit = this.outputBoundReached(bytes)
    if (limit) {
      this.outputWasCut = true
      return this.appendEntry({
        type: 'output-truncated',
        elapsedMs: event.elapsedMs,
        limit,
      })
    }
    this.outputEntries++
    this.outputBytes += bytes
    return this.appendEntry(input)
  }

  /** Names the bound an output entry of `bytes` would cross, or `undefined` when it fits every one. */
  private outputBoundReached(
    bytes: number,
  ): 'entries' | 'bytes' | 'queue' | undefined {
    if (
      this.pendingEntries >= NODE_SERVER_WRITER_QUEUE_LIMIT_ENTRIES ||
      this.pendingBytes + bytes > NODE_SERVER_WRITER_QUEUE_LIMIT_BYTES
    )
      return 'queue'
    if (
      this.outputEntries >= NODE_SERVER_OUTPUT_BUDGET_ENTRIES ||
      this.acceptedEntries + NODE_SERVER_STRUCTURAL_HEADROOM_ENTRIES >=
        NODE_SERVER_HISTORY_MAX_ENTRIES
    )
      return 'entries'
    if (
      this.outputBytes + bytes > NODE_SERVER_OUTPUT_BUDGET_BYTES ||
      this.acceptedBytes + bytes + NODE_SERVER_STRUCTURAL_HEADROOM_BYTES >
        NODE_SERVER_HISTORY_LIMIT_BYTES
    )
      return 'bytes'
    return undefined
  }

  /**
   * Records that Codebook opens a send attempt; the path is stored with secret-named query values masked.
   * @param attempt - The attempt's number, counted from 1.
   * @example await writer.appendRequest({ elapsedMs: 40, attempt: 1, method: 'POST', path: '/api/x?token=abc', bodyBytes: 12 })
   */
  appendRequest(input: {
    elapsedMs: number
    attempt: number
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    path: string
    bodyBytes: number
  }): Promise<void> {
    return this.appendEntry({
      type: 'request',
      ...input,
      path: maskSecretQueryValues(input.path),
    })
  }

  /** Records that an attempt was refused before its bytes left, so the run may try again. @example await writer.appendRequestWithdrawn({ elapsedMs: 41, attempt: 1, code: 'RUN_BUSY' }) */
  // Consumed by the run's history sink (Cycle 0059 pt3); pt1 has no producer yet.
  // fallow-ignore-next-line unused-class-member
  appendRequestWithdrawn(input: {
    elapsedMs: number
    attempt: number
    code: string
  }): Promise<void> {
    return this.appendEntry({ type: 'request-withdrawn', ...input })
  }

  /** Records that an attempt's bytes were handed to the socket. @example await writer.appendRequestSent({ elapsedMs: 42, attempt: 1 }) */
  appendRequestSent(input: {
    elapsedMs: number
    attempt: number
  }): Promise<void> {
    return this.appendEntry({ type: 'request-sent', ...input })
  }

  /**
   * Records one hit of a declared stop. The executed source text is written once per `(path, hash)` in a `source` entry just before the first stop that needs it (hash only with `sourceUnavailable` for a text above 512 KiB or one that does not hash to its name), and the stop keeps its top frame's source by hash.
   * @param capture - The run's capture of the hit.
   * @returns Settles when the stop (and its source entry, if new) is durable.
   * @example await writer.appendStop({ elapsedMs: 60, declaredStopIndex: 0, hit: 1, generation: 1, source, frameName: 'handler', facts: {}, unavailable: [], snapshot })
   */
  async appendStop(capture: NodeServerStopCapture): Promise<void> {
    const { source } = capture
    const key = `${source.path}\u0000${source.hash}`
    const queued: Array<Promise<void>> = []
    // Decided in the caller's turn: two stops of one turn queue one source entry.
    if (!this.queuedSources.has(key)) {
      this.queuedSources.add(key)
      queued.push(this.appendEntry(this.sourceEntryFor(capture)))
    }
    queued.push(
      this.appendEntry({
        type: 'stop',
        elapsedMs: capture.elapsedMs,
        declaredStopIndex: capture.declaredStopIndex,
        hit: capture.hit,
        generation: capture.generation,
        source,
        frame: { name: capture.frameName },
        facts: capture.facts,
        unavailable: capture.unavailable,
        debuggerSnapshot: dehydrateServerStopSnapshot(capture.snapshot),
      }),
    )
    await Promise.all(queued)
  }

  /** Builds the `source` entry of a stop's executed file: its text when verified and small enough, else its hash with the reason. */
  private sourceEntryFor(
    capture: NodeServerStopCapture,
  ): NodeServerHistoryEntryInput {
    const text = capture.snapshot.frames[0]?.source?.text
    const base = {
      type: 'source' as const,
      elapsedMs: capture.elapsedMs,
      path: capture.source.path,
      hash: capture.source.hash,
    }
    if (text === undefined || sha256(text) !== capture.source.hash)
      return { ...base, sourceUnavailable: 'not captured' }
    if (Buffer.byteLength(text) > NODE_SERVER_SOURCE_TEXT_LIMIT_BYTES)
      return { ...base, sourceUnavailable: 'too large' }
    return { ...base, text }
  }

  /** Records the response the run shows: its status, content type, the shown body, its size, whether the read was cut, the redirect and the request's duration. @example await writer.appendResponse({ elapsedMs: 90, status: 200, contentType: 'application/json', body: '{}', bodyBytes: 2, readCut: false, location: null, requestDurationMs: 50 }) */
  // Consumed by the run's history sink (Cycle 0059 pt3); pt1 has no producer yet.
  // fallow-ignore-next-line unused-class-member
  appendResponse(
    input: EntryInputOf<'response'> extends infer Entry
      ? Omit<Entry, 'type'>
      : never,
  ): Promise<void> {
    return this.appendEntry({ type: 'response', ...input })
  }

  /** Records that the request failed, with its code and a message that already passed the run's redaction. @example await writer.appendRequestFailed({ elapsedMs: 95, code: 'REQUEST_TIMEOUT', message: 'No answer.' }) */
  // Consumed by the run's history sink (Cycle 0059 pt3); pt1 has no producer yet.
  // fallow-ignore-next-line unused-class-member
  appendRequestFailed(input: {
    elapsedMs: number
    code: string
    message: string
  }): Promise<void> {
    return this.appendEntry({ type: 'request-failed', ...input })
  }

  /**
   * Notes that the run refused a hit beyond its capture budget, so the seal says later hits were not recorded.
   * @example writer.markCaptureBudgetExhausted()
   */
  // Consumed by the run's history sink (Cycle 0059 pt3); pt1 has no producer yet.
  // fallow-ignore-next-line unused-class-member
  markCaptureBudgetExhausted(): void {
    this.serverRules.captureBudgetExhausted = true
  }

  /**
   * Ends and seals the history: the entries accepted so far are written, then `end`, then `sealed.json`; Stop, Save, dispose, self-exit and failure all call it and share one seal.
   * An `end` that cannot be written (the history already failed) does not stop the seal: a history without `end` seals as a partial one.
   * @param end - How the run ended.
   * @returns The sealed journal's hash; `undefined` for a writer abandoned before.
   * @throws When the seal cannot be written or was abandoned before it was published.
   * @example await writer.seal({ elapsedMs: 900, reason: 'stopped' })
   */
  // Consumed by the run's history sink (Cycle 0059 pt3); pt1 has no producer yet.
  // fallow-ignore-next-line unused-class-member
  seal(end: NodeServerEndInput): Promise<string | undefined> {
    if (this.sealOperation) return this.sealOperation
    // The end is queued in this turn, behind every entry accepted before it.
    const endWritten = this.appendEntry({ type: 'end', ...end }).catch(
      () => undefined,
    )
    this.sealOperation = endWritten.then(() => this.finish('partial'))
    // A failed seal may be tried again.
    this.sealOperation.catch(() => {
      this.sealOperation = undefined
    })
    return this.sealOperation
  }
}
