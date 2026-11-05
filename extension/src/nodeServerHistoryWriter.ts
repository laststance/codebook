import {
  NODE_SERVER_HISTORY_FORMAT_VERSION,
  NODE_SERVER_HISTORY_LOCATION_LIMIT_CHARS,
} from './constants'
import type { NodeRunWriterStop } from './nodeRunHistoryEvidence'
import { NodeRunHistoryWriter } from './nodeRunHistoryWriter'
import {
  NodeRunWriterRules,
  type NodeRunRuleProfile,
} from './nodeRunWriterRules'
import {
  nodeServerHistoryEntrySchema,
  nodeServerHistorySealSchema,
  type NodeServerHistoryEntry,
  type NodeServerHistoryEntryInput,
  type NodeRunEvidenceEntryInput,
  type NodeServerHistoryHeader,
} from './nodeServerHistorySchemas'
import type { NodeServerHistoryTypes } from './nodeServerHistoryTypes'
import { cutTextToLength } from './utils/cutTextToLength'
import {
  describeLastNodeServerEntry,
  evaluateNodeServerCapture,
} from './utils/evaluateNodeServerCapture'
import { maskSecretQueryValues } from './utils/maskSecretQueryValues'
import { acceptNodeServerEntry } from './utils/nodeServerJournalRules'

/** What differs between the node-server writer's rules and the node-script writer's. */
const NODE_SERVER_RULE_PROFILE: NodeRunRuleProfile<NodeServerHistoryTypes> = {
  sealVersion: NODE_SERVER_HISTORY_FORMAT_VERSION,
  parseEntry: (value) => nodeServerHistoryEntrySchema.parse(value),
  parseSeal: (value) => nodeServerHistorySealSchema.parse(value),
  accept: acceptNodeServerEntry,
  evaluate: evaluateNodeServerCapture,
  describeEntry: describeLastNodeServerEntry,
  // A server history with no request holds nothing to replay.
  holdsNothingToReplay: (progress) => progress.lastAttempt === 0,
}

type EntryInputOf<Type extends NodeServerHistoryEntry['type']> = Omit<
  Extract<NodeServerHistoryEntry, { type: Type }>,
  'sequence'
>

/** The entry `end` of a run, without its sequence; what {@link NodeServerHistoryWriter.seal} appends. */
export type NodeServerEndInput = Omit<EntryInputOf<'end'>, 'type'>

/** What the history sink hands the writer for one stop hit; shared with the node-script writer as {@link NodeRunWriterStop}. */
export type NodeServerWriterStop = NodeRunWriterStop

/**
 * Writes a node-server run's evidence as it happens: output, request attempts, executed sources, stops, the response and the end, in the one verified order every reader checks.
 * Source text is stored once per `(path, hash)` just before the first stop that needs it. Output has its own budget, so a chatty server never crowds out the request, the stops or the answer; past a bound output is dropped with one `output-truncated` entry while structural entries still wait for their turn.
 * Built by {@link nodeServerStorageDescriptor} when the store reserves a history; the run feeds it through {@link NodeServerHistorySink}.
 * @example const writer = await servers.start(header); await writer.appendRequest({ … }); await writer.seal({ reason: 'stopped', elapsedMs: 900 })
 */
export class NodeServerHistoryWriter extends NodeRunHistoryWriter<NodeServerHistoryTypes> {
  constructor(
    directory: string,
    header: NodeServerHistoryHeader,
    onClosed: () => void,
    describeCause: (error: unknown) => string,
  ) {
    super(
      directory,
      header,
      onClosed,
      new NodeRunWriterRules(header, describeCause, NODE_SERVER_RULE_PROFILE),
    )
  }

  /**
   * Queues one entry exactly as given; the low-level door the typed methods use, public so a test can offer an entry the typed methods would never build.
   * @param input - The entry without its sequence.
   * @returns Settles when the entry is durable; rejects when the rules or the disk refuse it.
   * @example await writer.appendEntry({ type: 'request-sent', elapsedMs: 3, attempt: 1 })
   */
  appendEntry(input: NodeServerHistoryEntryInput): Promise<void> {
    return this.appendCounted(input, () => this.append(input))
  }

  protected override queueEvidence(
    input: NodeRunEvidenceEntryInput,
  ): Promise<void> {
    return this.appendEntry(input)
  }

  /**
   * Records that Codebook opens a send attempt; the path is stored with the values of secret-named query parameters and of `code` masked ({@link maskSecretQueryValues}).
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
      // The mask can lengthen a value (`[masked]`), so the bound is applied after it.
      path: cutTextToLength(
        maskSecretQueryValues(input.path),
        NODE_SERVER_HISTORY_LOCATION_LIMIT_CHARS,
      ),
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

  /** Records the response the run shows: its status, content type, the shown body, its size, whether the read was cut, the redirect (with the values of secret query parameters and of `code` masked, {@link maskSecretQueryValues}) and the request's duration. @example await writer.appendResponse({ elapsedMs: 90, status: 200, contentType: 'application/json', body: '{}', bodyBytes: 2, readCut: false, location: null, requestDurationMs: 50 }) */
  appendResponse(
    input: EntryInputOf<'response'> extends infer Entry
      ? Omit<Entry, 'type'>
      : never,
  ): Promise<void> {
    return this.appendEntry({
      type: 'response',
      ...input,
      location:
        input.location === null
          ? null
          : // The mask can lengthen a value (`[masked]`), so the bound is applied after it.
            cutTextToLength(
              maskSecretQueryValues(input.location),
              NODE_SERVER_HISTORY_LOCATION_LIMIT_CHARS,
            ),
    })
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
   * Ends and seals the history: from this call the writer is closed to new appends (an entry offered later is not written and is no failure), the entries accepted before it are written, then `end`, then `sealed.json`; Stop, Save, dispose, self-exit and failure all call it and share one seal.
   * `end` is written once: a retry after a failed `sealed.json` write only retries the finish. An `end` that cannot be written (the history already failed) does not stop the seal: a history without `end` seals as a partial one.
   * @param end - How the run ended.
   * @returns The sealed journal's hash; `undefined` for a writer abandoned before the call.
   * @throws When the seal cannot be written or the writer is abandoned while the seal is in flight.
   * @example await writer.seal({ elapsedMs: 900, reason: 'stopped' })
   */
  seal(end: NodeServerEndInput): Promise<string | undefined> {
    return this.sealOnce(() =>
      this.queueEnd(() =>
        this.append({
          type: 'end',
          ...end,
          elapsedMs: this.endTime(end.elapsedMs),
        }),
      ),
    )
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
      // The largest accepted time, queued entries included, as {@link NodeServerHistoryWriter.seal} takes it.
      elapsedMs: this.endTime(this.runRules.lastElapsedMs),
      reason: 'stopped',
    })
  }
}
