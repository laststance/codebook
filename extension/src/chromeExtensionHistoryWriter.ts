import type {
  ExtensionHistoryEntry,
  ExtensionHistoryEntryInput,
  ExtensionHistoryEntryOf,
  ExtensionHistoryHeader,
  ExtensionHistorySeal,
} from './chromeExtensionHistorySchemas'
import {
  extensionHistorySealSchema,
  parseExtensionHistoryEntry,
} from './chromeExtensionHistorySchemas'
import type { ExtensionHistoryTypes } from './chromeExtensionHistoryTypes'
import {
  CHROME_EXTENSION_HISTORY_FORMAT_VERSION,
  EXTENSION_HISTORY_JOURNAL_LIMIT_BYTES,
  EXTENSION_HISTORY_MAX_ENTRIES,
  EXTENSION_HISTORY_SEAL_LIMIT_BYTES,
  EXTENSION_HISTORY_TERMINAL_RESERVE_ENTRIES,
  RECORDING_TERMINAL_RESERVE_BYTES,
} from './constants'
import type { HistoryWriterRules } from './historyStorageDescriptor'
import { HistoryJournalWriter } from './nodeHistoryJournalWriter'
import { cutHistoryReason } from './utils/cutHistoryReason'
import {
  describeLastExtensionEntry,
  evaluateExtensionHistoryCapture,
  type ExtensionCaptureFacts,
} from './utils/evaluateExtensionHistoryCapture'
import {
  acceptExtensionHistoryEntry,
  cloneExtensionJournalProgress,
  newExtensionJournalProgress,
} from './utils/extensionHistoryJournalRules'
import {
  parseJournalEntries,
  structuredSealFields,
} from './utils/structuredSealFields'

/** The run clock a writer stamps entries with: milliseconds since the history started, monotonic. A test names its own. */
export type ExtensionHistoryClock = () => number

/**
 * Starts a run clock at this moment.
 * @returns A clock that reads the milliseconds elapsed since this call on the host's monotonic clock.
 * @example const nowMs = startExtensionHistoryClock(); nowMs() // => 0.4
 */
function startExtensionHistoryClock(): ExtensionHistoryClock {
  const startedAt = performance.now()
  return () => performance.now() - startedAt
}

/** The bounds of one writer's journal; a test names smaller ones to reach them. */
export type ExtensionHistoryJournalLimits = {
  journalLimitBytes: number
  maxEntries: number
}

/** The chrome-extension profile's writer rules: the journal rules every reader shares plus the evaluator that builds the seal; holds the state of one writer. */
class ExtensionWriterRules implements HistoryWriterRules<ExtensionHistoryTypes> {
  readonly journalLimitBytes: number
  readonly maxEntries: number
  readonly sealLimitBytes = EXTENSION_HISTORY_SEAL_LIMIT_BYTES
  private readonly progress = newExtensionJournalProgress()
  private lastEntry?: ExtensionHistoryEntry
  /** What only the recorder knows; set before the seal. */
  facts: Pick<
    ExtensionCaptureFacts,
    'filmstripIncomplete' | 'surfaceEnded' | 'lostPinnedPauses'
  > = {}

  constructor(
    private readonly header: ExtensionHistoryHeader,
    private readonly describeCause: (error: unknown) => string,
    limits: ExtensionHistoryJournalLimits,
  ) {
    this.journalLimitBytes = limits.journalLimitBytes
    this.maxEntries = limits.maxEntries
  }

  /** Stream frames never use the room kept for the closes and the result; pins and the other entries may. */
  reserveFor(entry: ExtensionHistoryEntry): { bytes: number; entries: number } {
    return entry.type === 'frame' && entry.kind === 'stream'
      ? {
          bytes: RECORDING_TERMINAL_RESERVE_BYTES,
          entries: EXTENSION_HISTORY_TERMINAL_RESERVE_ENTRIES,
        }
      : { bytes: 0, entries: 0 }
  }

  parseEntry(value: unknown): ExtensionHistoryEntry {
    return parseExtensionHistoryEntry(value)
  }

  check(entry: ExtensionHistoryEntry): void {
    // The same function the incremental scan and the full read call, tried on a copy: an entry that is refused or never becomes durable changes nothing.
    acceptExtensionHistoryEntry(
      cloneExtensionJournalProgress(this.progress),
      entry,
      this.header,
    )
  }

  commit(entry: ExtensionHistoryEntry): void {
    acceptExtensionHistoryEntry(this.progress, entry, this.header)
    this.lastEntry = entry
  }

  /** Whether the pause is already pinned, so a second pin is dropped before it reaches the journal. */
  isPinned(pauseId: string): boolean {
    return this.progress.pauses.get(pauseId)?.isPinned === true
  }

  /** A history in which no stop paused holds nothing to replay. */
  holdsNothingToReplay(): boolean {
    return this.progress.pauses.size === 0
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
  }): ExtensionHistorySeal {
    const entries = parseJournalEntries(input.journal, (value) =>
      this.parseEntry(value),
    )
    const reasons = evaluateExtensionHistoryCapture(this.header, entries, {
      ...this.facts,
      ...(input.appendFailure
        ? {
            appendFailure: {
              lastEntry: this.lastEntry
                ? describeLastExtensionEntry(this.lastEntry)
                : 'the start of the history',
              cause: cutHistoryReason(this.describeCause(input.appendFailure)),
            },
          }
        : {}),
      sizeLimitReached: input.limitReached,
    })
    return extensionHistorySealSchema.parse(
      structuredSealFields({
        version: CHROME_EXTENSION_HISTORY_FORMAT_VERSION,
        studyId: input.studyId,
        entryCount: input.entryCount,
        journal: input.journal,
        endedAt: input.endedAt,
        reasons,
      }),
    )
  }
}

/**
 * Writes a chrome-extension run's evidence as it happens: pauses, their captures, frames, the result, in the one verified order every reader checks. Every typed method accepts synchronously, stamps the entry with the run clock in the caller's turn and returns the promise of its durability, so a caller never has to wait for the disk.
 * Built by {@link createExtensionStorageDescriptor} when the store reserves a history; the run feeds it through {@link ChromeExtensionHistoryRecorder}.
 * @example const writer = await extensions.start(header); void writer.appendPauseOpen({ … }); await writer.seal()
 */
export class ChromeExtensionHistoryWriter extends HistoryJournalWriter<ExtensionHistoryTypes> {
  private readonly extensionRules: ExtensionWriterRules
  private sealOperation?: Promise<string | undefined>
  /** Set in the turn the seal began: from then on the writer is closed to new appends while the accepted ones drain. */
  private closedToAppends = false

  /** The history's folder; the frame blobs live in its `frames/` folder. */
  readonly historyDirectory: string

  constructor(
    directory: string,
    header: ExtensionHistoryHeader,
    onClosed: () => void,
    describeCause: (error: unknown) => string,
    /** The run clock; the writer stamps every entry with it. */
    readonly nowMs: ExtensionHistoryClock = startExtensionHistoryClock(),
    limits: ExtensionHistoryJournalLimits = {
      journalLimitBytes: EXTENSION_HISTORY_JOURNAL_LIMIT_BYTES,
      maxEntries: EXTENSION_HISTORY_MAX_ENTRIES,
    },
  ) {
    const rules = new ExtensionWriterRules(header, describeCause, limits)
    super(directory, header, onClosed, rules)
    this.historyDirectory = directory
    this.extensionRules = rules
  }

  /**
   * Queues one entry with the run clock's time of this call.
   * @param input - The entry without its sequence and time.
   * @returns Settles when the entry is durable, or at once when the writer is closed to appends (not a failure); rejects when the rules or the disk refuse it.
   * @example await writer.appendEntry({ type: 'pause-close', pauseId: 'p', reason: 'continue' })
   */
  appendEntry(input: ExtensionHistoryEntryInput): Promise<void> {
    if (this.closedToAppends) return Promise.resolve()
    return this.append({ ...input, elapsedMs: this.nowMs() })
  }

  /** Records that a declared stop paused. @example void writer.appendPauseOpen({ pauseId, generation: 1, context: 'page', stopIndex: 1, targetUrl, workerGeneration: 0 }) */
  appendPauseOpen(
    input: Omit<
      ExtensionHistoryEntryOf<'pause-open'>,
      'type' | 'sequence' | 'elapsedMs'
    >,
  ): Promise<void> {
    return this.appendEntry({ type: 'pause-open', ...input })
  }

  /** Records the captured values and executed source of a pause. @example void writer.appendCapture({ pauseId, path, line, sourceHash, sourceBytes, debuggerSnapshot, facts: {} }) */
  // Called through the recorder's `writer`, which the dead-code scan cannot follow.
  // fallow-ignore-next-line unused-class-member
  appendCapture(
    input: Omit<
      ExtensionHistoryEntryOf<'capture'>,
      'type' | 'sequence' | 'elapsedMs'
    >,
  ): Promise<void> {
    return this.appendEntry({ type: 'capture', ...input })
  }

  /** Records that a pause ended and why. @example void writer.appendPauseClose({ pauseId, reason: 'continue' }) */
  // Called through the recorder's `writer`, which the dead-code scan cannot follow.
  // fallow-ignore-next-line unused-class-member
  appendPauseClose(
    input: Omit<
      ExtensionHistoryEntryOf<'pause-close'>,
      'type' | 'sequence' | 'elapsedMs'
    >,
  ): Promise<void> {
    return this.appendEntry({ type: 'pause-close', ...input })
  }

  /**
   * Records a frame whose blob is already durable. A second pin for one pause is ignored.
   * @param input - The frame's hash, size and capture time on the run clock.
   * @example void writer.appendFrame({ kind: 'stream', hash, byteLength: 1200, width: 720, height: 640, capturedAtMs: 40 })
   */
  appendFrame(
    input: Omit<
      ExtensionHistoryEntryOf<'frame'>,
      'type' | 'sequence' | 'elapsedMs'
    >,
  ): Promise<void> {
    if (
      input.kind === 'pin' &&
      input.pauseId !== undefined &&
      this.extensionRules.isPinned(input.pauseId)
    )
      return Promise.resolve()
    return this.appendEntry({ type: 'frame', ...input })
  }

  /** Records the run's result. @example void writer.appendResult({ outcome: 'changed', before: { value: 'a' }, after: { value: 'b' } }) */
  // Called through the recorder's `writer`, which the dead-code scan cannot follow.
  // fallow-ignore-next-line unused-class-member
  appendResult(
    input: Omit<
      ExtensionHistoryEntryOf<'result'>,
      'type' | 'sequence' | 'elapsedMs'
    >,
  ): Promise<void> {
    return this.appendEntry({ type: 'result', ...input })
  }

  /**
   * Seals the history: from this call the writer is closed to new appends (an entry offered later is not written and is no failure), the entries accepted before it are written, then `sealed.json`. The status and reasons are decided by the evidence.
   * @param facts - What only the recorder knows: the filmstrip lost frames, the surface ended, the pinned frames the history lost.
   * @returns The sealed journal's hash; `undefined` for a writer abandoned before the call or a history that held nothing to replay.
   * @throws When the seal cannot be written (the history then reads as interrupted) or the writer is abandoned while it is in flight.
   * @example await writer.seal({ filmstripIncomplete: false })
   */
  seal(
    facts: Pick<
      ExtensionCaptureFacts,
      'filmstripIncomplete' | 'surfaceEnded' | 'lostPinnedPauses'
    > = {},
  ): Promise<string | undefined> {
    if (this.sealOperation) return this.sealOperation
    this.closedToAppends = true
    this.extensionRules.facts = facts
    this.sealOperation = super.finish('partial')
    // A failed seal may be tried again.
    this.sealOperation.catch(() => {
      this.sealOperation = undefined
    })
    return this.sealOperation
  }

  /**
   * Seals through {@link seal} so no `sealed.json` is written without the recorder's facts; the arguments are ignored because the evidence decides.
   * @example await writer.finish('partial')
   */
  override finish(
    _status?: 'complete' | 'partial',
    _reason?: string,
  ): Promise<string | undefined> {
    return this.seal()
  }
}
