import {
  NODE_SERVER_HISTORY_FORMAT_VERSION,
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
  cloneNodeServerJournalProgress,
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
    // The same function the incremental scan and the full read call, tried on a copy: an entry that is then refused or never becomes durable changes nothing.
    acceptNodeServerEntry(
      cloneNodeServerJournalProgress(this.progress),
      entry,
      this.header,
    )
  }

  commit(entry: NodeServerHistoryEntry): void {
    // The line is durable: the rules now count the entry.
    acceptNodeServerEntry(this.progress, entry, this.header)
    this.lastEntry = entry
  }

  /** The time of the last durable entry, the earliest an `end` may carry. */
  get lastElapsedMs(): number {
    return this.progress.lastElapsedMs
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
              // Cut to the seal's param bound so a long cause never makes the whole seal unwritable.
              cause: cutHistoryReason(this.describeCause(input.appendFailure)),
            },
          }
        : {}),
      sizeLimitReached: input.limitReached,
      captureBudgetExhausted: this.captureBudgetExhausted,
    })
    const complete = reasons.length === 0
    return nodeServerHistorySealSchema.parse({
      version: NODE_SERVER_HISTORY_FORMAT_VERSION,
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

/** What the history sink hands the writer for one stop hit: the run's capture, shaped for the journal ({@link NodeServerStopCapture} is what the debugger reads). */
export type NodeServerWriterStop = {
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
 * Built by {@link nodeServerStorageDescriptor} when the store reserves a history; the run feeds it through {@link NodeServerHistorySink}.
 * @example const writer = await servers.start(header); await writer.appendRequest({ … }); await writer.seal({ reason: 'stopped', elapsedMs: 900 })
 */
export class NodeServerHistoryWriter extends HistoryJournalWriter<NodeServerHistoryTypes> {
  private readonly serverRules: NodeServerWriterRules
  /** The `(hash)` of sources this writer already queued, by path and hash. */
  private readonly queuedSources = new Set<string>()
  private acceptedEntries = 0
  private acceptedBytes = 0
  /** The largest time of any entry accepted so far, durable or still queued: `end` may never carry less. */
  private latestAcceptedMs = 0
  private outputEntries = 0
  private outputBytes = 0
  private outputWasCut = false
  private pendingEntries = 0
  private pendingBytes = 0
  private sealOperation?: Promise<string | undefined>
  /** The one write of `end`, kept so a retried seal never writes it twice. */
  private endOperation?: Promise<void>
  /** Set in the turn the seal began: from then on the writer is closed to new appends while the accepted ones drain. */
  private closedToAppends = false

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
    // Closed to new appends from the moment the seal began: the entry is not written and is no failure, so a run that ended cleanly still seals complete.
    if (this.closedToAppends) return Promise.resolve()
    const bytes = estimateLineBytes(input)
    this.latestAcceptedMs = Math.max(this.latestAcceptedMs, input.elapsedMs)
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
  async appendStop(capture: NodeServerWriterStop): Promise<void> {
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
    capture: NodeServerWriterStop,
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
  appendResponse(
    input: EntryInputOf<'response'> extends infer Entry
      ? Omit<Entry, 'type'>
      : never,
  ): Promise<void> {
    return this.appendEntry({ type: 'response', ...input })
  }

  /** Records that the request failed, with its code and a message that already passed the run's redaction. @example await writer.appendRequestFailed({ elapsedMs: 95, code: 'REQUEST_TIMEOUT', message: 'No answer.' }) */
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
  markCaptureBudgetExhausted(): void {
    this.serverRules.captureBudgetExhausted = true
  }

  /**
   * Ends and seals the history: from this call the writer is closed to new appends (an entry offered later is not written and is no failure), the entries accepted before it are written, then `end`, then `sealed.json`; Stop, Save, dispose, self-exit and failure all call it and share one seal.
   * `end` is written once: a retry after a failed `sealed.json` write only retries the finish. An `end` that cannot be written (the history already failed) does not stop the seal: a history without `end` seals as a partial one.
   * @param end - How the run ended.
   * @returns The sealed journal's hash; `undefined` for a writer abandoned before the call.
   * @throws When the seal cannot be written or the writer is abandoned while the seal is in flight.
   * @example await writer.seal({ elapsedMs: 900, reason: 'stopped' })
   */
  seal(end: NodeServerEndInput): Promise<string | undefined> {
    if (this.sealOperation) return this.sealOperation
    // Decided in this turn, before any later append is offered.
    this.closedToAppends = true
    // The end is queued in this turn, behind every entry accepted before it, through the base door that the closed flag does not shut.
    // The end carries the largest accepted time, queued entries included, so a run that ended cleanly never seals partial for time moving backward.
    this.endOperation ??= this.append({
      type: 'end',
      ...end,
      elapsedMs: Math.max(end.elapsedMs, this.latestAcceptedMs),
    }).catch(() => undefined)
    this.sealOperation = this.endOperation.then(() => super.finish('partial'))
    // A failed seal may be tried again.
    this.sealOperation.catch(() => {
      this.sealOperation = undefined
    })
    return this.sealOperation
  }

  /**
   * Seals through {@link seal}, so no server `sealed.json` is ever written without its `end`, which the read path would refuse. The status and reason are decided by the evidence, so the `status` and `reason` arguments are ignored; the `end` says the run was stopped, at the time of the last durable entry.
   * @returns The sealed journal's hash; `undefined` for a writer abandoned before the call.
   * @throws When the seal cannot be written or the writer is abandoned while it is in flight.
   * @example await writer.finish('partial')
   */
  override finish(
    _status?: 'complete' | 'partial',
    _reason?: string,
  ): Promise<string | undefined> {
    return this.seal({
      elapsedMs: this.serverRules.lastElapsedMs,
      reason: 'stopped',
    })
  }
}
