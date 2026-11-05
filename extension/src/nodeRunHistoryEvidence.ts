import type { z } from 'zod'

import {
  NODE_SERVER_HISTORY_LIMIT_BYTES,
  NODE_SERVER_HISTORY_MAX_ENTRIES,
  NODE_SERVER_OUTPUT_BUDGET_BYTES,
  NODE_SERVER_OUTPUT_BUDGET_ENTRIES,
  NODE_SERVER_SOURCE_TEXT_LIMIT_BYTES,
  NODE_SERVER_STRUCTURAL_HEADROOM_BYTES,
  NODE_SERVER_STRUCTURAL_HEADROOM_ENTRIES,
  NODE_SERVER_WRITER_QUEUE_LIMIT_BYTES,
  NODE_SERVER_WRITER_QUEUE_LIMIT_ENTRIES,
} from './constants'
import type {
  NodeRunEvidenceEntryInput,
  nodeRunStopEntrySchema,
} from './nodeServerHistorySchemas'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import { sha256 } from './runtimeSupport/utils/sha256'
import { dehydrateServerStopSnapshot } from './utils/dehydrateServerStopSnapshot'

/** What the history sink hands a writer for one stop hit: the run's capture, shaped for the journal ({@link NodeServerStopCapture} is what the debugger reads). */
export type NodeRunWriterStop = {
  elapsedMs: number
  declaredStopIndex: number
  hit: number
  generation: number
  source: { path: string; hash: string; line: number; column: number }
  frameName: string
  facts: z.infer<typeof nodeRunStopEntrySchema>['facts']
  unavailable: Array<{ path: string; reason: string }>
  /** The redacted snapshot, its top frame still carrying the executed source text. */
  snapshot: ReplayDebugSnapshot
}

/** Queues one evidence entry (output, source, stop, output cut) behind the accepted ones; a node run's writer offers it, whatever its profile. */
export type QueueEvidenceEntry = (
  input: NodeRunEvidenceEntryInput,
) => Promise<void>

/** Estimates the bytes of an entry's journal line before it is numbered; close enough to keep the bounds honest. */
function estimateLineBytes(input: unknown): number {
  return Buffer.byteLength(JSON.stringify(input)) + 24
}

/**
 * Keeps the counters a node run's writer needs to bound its output and to know what it has accepted: entries and bytes accepted or still queued, the output budget, the largest accepted time and whether the writer is closed to appends.
 * Shared by the node-server and node-script writers so one implementation serves both profiles.
 * @example const accounting = new NodeRunEntryAccounting(); const release = accounting.admit(input)
 */
export class NodeRunEntryAccounting {
  /** Set in the turn the seal began: from then on the writer is closed to new appends while the accepted ones drain. */
  closedToAppends = false
  /** The largest time of any entry accepted so far, durable or still queued: `end` may never carry less. */
  latestAcceptedMs = 0
  private acceptedEntries = 0
  private acceptedBytes = 0
  private outputEntries = 0
  private outputBytes = 0
  private outputWasCut = false
  private pendingEntries = 0
  private pendingBytes = 0

  /**
   * Counts an entry as accepted and queued.
   * @param input - The entry about to be queued.
   * @returns The function to call when the entry is durable or refused, which stops counting it as pending.
   * @example const release = accounting.admit(input); operation.then(release, release)
   */
  admit(input: { elapsedMs: number }): () => void {
    const bytes = estimateLineBytes(input)
    this.latestAcceptedMs = Math.max(this.latestAcceptedMs, input.elapsedMs)
    this.acceptedEntries++
    this.acceptedBytes += bytes
    this.pendingEntries++
    this.pendingBytes += bytes
    return (): void => {
      this.pendingEntries--
      this.pendingBytes -= bytes
    }
  }

  /**
   * Says whether output is dropped for good: its budget was cut, an append failed, or the writer is closed to appends.
   * @param appendFailed - Whether an append has failed.
   * @returns `true` when the sink should stop sanitizing and queueing output.
   * @example if (accounting.isOutputCut(writer.appendFailure !== undefined)) return
   */
  isOutputCut(appendFailed: boolean): boolean {
    return this.outputWasCut || appendFailed || this.closedToAppends
  }

  /**
   * Queues one stdout or stderr chunk unless a bound says it must be dropped; the first drop queues one `output-truncated` entry and later output is dropped silently.
   * @param event - The chunk with its time since launch.
   * @param queue - The writer's entry door.
   * @returns Settles when the chunk is durable, or at once when it was dropped.
   * @example await accounting.appendOutput({ elapsedMs: 12, channel: 'stdout', text: 'ready\n' }, queue)
   */
  appendOutput(
    event: {
      elapsedMs: number
      channel: 'stdout' | 'stderr'
      text: string
    },
    queue: QueueEvidenceEntry,
  ): Promise<void> {
    if (this.outputWasCut) return Promise.resolve()
    const input = { type: 'output' as const, ...event }
    const bytes = estimateLineBytes(input)
    const limit = this.outputBoundReached(bytes)
    if (limit) {
      this.outputWasCut = true
      return queue({
        type: 'output-truncated',
        elapsedMs: event.elapsedMs,
        limit,
      })
    }
    this.outputEntries++
    this.outputBytes += bytes
    return queue(input)
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
}

/** Builds the `source` entry of a stop's executed file: its text when verified and small enough, else its hash with the reason. */
function sourceEntryFor(capture: NodeRunWriterStop): NodeRunEvidenceEntryInput {
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

/**
 * Queues one hit of a declared stop: the executed source text is written once per `(path, hash)` in a `source` entry just before the first stop that needs it (hash only with `sourceUnavailable` for a text above 512 KiB or one that does not hash to its name), and the stop keeps its top frame's source by hash.
 * @param capture - The run's capture of the hit.
 * @param queuedSources - The `(path, hash)` keys already queued by this writer; updated in the caller's turn so two stops of one turn queue one source entry.
 * @param queue - The writer's entry door.
 * @returns Settles when the stop (and its source entry, if new) is durable.
 * @example await appendStopEvidence(capture, new Set(), queue)
 */
export async function appendStopEvidence(
  capture: NodeRunWriterStop,
  queuedSources: Set<string>,
  queue: QueueEvidenceEntry,
): Promise<void> {
  const { source } = capture
  const key = `${source.path}\u0000${source.hash}`
  const queued: Array<Promise<void>> = []
  if (!queuedSources.has(key)) {
    queuedSources.add(key)
    queued.push(queue(sourceEntryFor(capture)))
  }
  queued.push(
    queue({
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
