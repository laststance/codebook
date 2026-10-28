import { readFile, rm, open } from 'node:fs/promises'
import { join } from 'node:path'

import { NODE_TEST_HISTORY_WRITER_FILE, PRIVATE_FILE_MODE } from './constants'
import type {
  HistoryTypes,
  HistoryWriterRules,
} from './historyStorageDescriptor'
import { sha256 } from './runtimeSupport/utils/sha256'
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import { cutHistoryReason } from './utils/cutHistoryReason'
import { holdsLearnerFiles } from './utils/holdsLearnerFiles'

/** The file names of a history's folder that the store and its writer share. */
export const HISTORY_HEADER_FILE = 'header.json'
export const HISTORY_JOURNAL_FILE = 'events.jsonl'
export const HISTORY_SEAL_FILE = 'sealed.json'

/**
 * Serializes fsynced journal appends so every kind of evidence keeps one verified timeline, for any history profile: the profile's rules decide what an entry may follow, the writer decides durability. The first failed entry ends that timeline; the verified prefix can still be sealed as partial.
 * Built by a profile's storage descriptor ({@link HistoryStorageDescriptor.createWriter}) and returned by {@link NodeTestHistoryStore.start}; its subclasses add the entry methods of their profile.
 * It separates closed to new appends from draining accepted appends: an entry accepted before the seal began is written, then the seal follows; one offered after is refused at the call.
 * @example await writer.finish('partial', 'Cancelled by the learner.')
 */
export class HistoryJournalWriter<Types extends HistoryTypes> {
  private sequence = 0
  private entries = 0
  /** Journal bytes written by confirmed entries; anything beyond them is a torn write. */
  private confirmedBytes = 0
  /** The first refused or failed entry; later evidence would follow a gap. */
  private failure?: Error
  /** Whether an entry or byte bound refused an entry. */
  private limitReached = false
  private pending: Promise<void> = Promise.resolve()
  private closed = false
  /** Set when the seal began: new appends are refused, the accepted ones still drain. */
  private closing = false
  /** Set by {@link abandon}: a seal still in flight checks it before it publishes `sealed.json`. */
  private abandoned = false
  private finishOperation?: Promise<string | undefined>
  /** The SHA-256 of the journal this writer sealed; `undefined` before the seal and after an abandoned one. */
  private sealedHash?: string

  constructor(
    private readonly directory: string,
    readonly header: Types['Header'],
    private readonly onClosed: () => void,
    protected readonly rules: HistoryWriterRules<Types>,
  ) {}

  /**
   * Counts the entries this writer confirmed, the journal's entry count once sealed; read by {@link StudyService.sealNodeHistory}, which keeps it for the run's outcome: a replay needs at least one entry.
   * @example writer.entryCount // => 4
   */
  get entryCount(): number {
    return this.entries
  }

  /**
   * Fsyncs and seals the journal; after a failed entry only the verified prefix can be sealed, as partial; called by {@link StudyService.stopRecord}.
   * The profile's rules decide whether `complete` is honest; a repeated or concurrent call joins the first one, so Save, Stop and a self-exit at once give one seal.
   * @param status - `complete` for evidence the caller verified as whole, else `partial`.
   * @param reason - Why a partial history ended.
   * @returns The SHA-256 of the sealed journal, the run's `recording.contextHash`; `undefined` when the writer was abandoned before the call (nothing is sealed, nothing throws).
   * @throws When the profile refuses `complete`, the journal holds bytes no entry confirmed, the seal cannot be written, or the writer is abandoned while this seal is in flight (a `sealed.json` it already published is removed again).
   * @example await writer.finish('partial', 'Cancelled by the learner.') // => 'a3f…'
   */
  finish(
    status: 'complete' | 'partial',
    reason?: string,
  ): Promise<string | undefined> {
    if (this.closed) return Promise.resolve(this.sealedHash)
    if (this.finishOperation) return this.finishOperation
    const operation = (async () => {
      this.closing = true
      // Every entry accepted before this call is ahead of the seal in the queue.
      await this.pending
      this.rules.assertSealable(status, Boolean(this.failure))
      const path = join(this.directory, HISTORY_JOURNAL_FILE),
        journal = await readFile(path)
      // A write torn by an I/O failure leaves bytes no entry confirmed; sealing them would certify a journal readers must refuse.
      if (journal.byteLength !== this.confirmedBytes) {
        this.failure ??= new Error(
          'Node history journal has bytes its writer never confirmed.',
        )
        throw new Error(
          'Node history journal has bytes its writer never confirmed; it remains an interrupted prefix.',
        )
      }
      // A history that holds nothing to replay: its folder is removed when it seals, so it is listed nowhere and takes no place of the saved study limit (D6, F85). A folder that cannot be removed is sealed as any other.
      if (
        this.rules.holdsNothingToReplay(this.entries) &&
        // Learning material or understanding marks saved before the first entry keep the folder, sealed as any other (F274).
        !(await holdsLearnerFiles(this.directory)) &&
        (await rm(this.directory, { recursive: true, force: true }).then(
          () => true,
          () => false,
        ))
      ) {
        this.sealedHash = sha256(journal)
        this.closed = true
        this.onClosed()
        return this.sealedHash
      }
      const seal = this.rules.buildSeal({
        studyId: this.header.studyId,
        status,
        reason: reason === undefined ? undefined : cutHistoryReason(reason),
        journal,
        entryCount: this.entries,
        endedAt: new Date().toISOString(),
        ...(this.failure ? { appendFailure: this.failure } : {}),
        limitReached: this.limitReached,
      })
      await atomicPrivateWrite(
        join(this.directory, HISTORY_SEAL_FILE),
        seal,
        this.rules.sealLimitBytes,
        // A seal that finishes after the writer was abandoned (a timeout) never publishes: the folder was reported interrupted.
        () => {
          if (this.abandoned)
            throw new Error(
              'Node history seal was abandoned before it was published.',
            )
        },
      )
      // An abandon that landed during the publish itself: the folder was reported interrupted, so the file just published goes again.
      if (this.abandoned) {
        await rm(join(this.directory, HISTORY_SEAL_FILE), { force: true })
        throw new Error(
          'Node history seal was abandoned before it was published.',
        )
      }
      this.sealedHash = seal.journalHash
      this.closed = true
      // The seal is published first: another window never finds neither the seal nor the record. The removal is awaited by nobody, so a stalled file system cannot hold back a seal that already stands; a record that stays is ignored once the seal exists.
      void this.removeWriterRecord()
      this.onClosed()
      return seal.journalHash
    })().catch((error: unknown) => {
      // An abandoned writer stays closed; any other failed seal may be tried again.
      if (!this.abandoned) {
        this.closing = false
        this.finishOperation = undefined
      }
      throw error
    })
    this.finishOperation = operation
    return operation
  }

  /** The hash of the seal this writer published, `undefined` until `sealed.json` stands; read by the recorder's seal bound so a published seal is never abandoned. */
  // fallow-ignore-next-line unused-class-member
  get publishedSealHash(): string | undefined {
    return this.abandoned ? undefined : this.sealedHash
  }

  /** The first failure that ended the timeline, if any; read by the run's resource to report a history that is failing while the run lives. @example writer.appendFailure?.message */
  get appendFailure(): Error | undefined {
    return this.failure
  }

  /**
   * Marks the writer failed without an append having failed: a producer that met a fault of its own (a sink that threw, an entry it could not place) says so, so no later entry follows the gap and the seal reads partial with this cause. The mark takes its place in the queue: entries accepted before it are still written.
   * @param error - What went wrong; the first failure stands.
   * @example writer.markFailed(new Error('A stop was captured after the response.'))
   */
  markFailed(error: Error): void {
    this.pending = this.pending.then(() => {
      this.failure ??= error
    })
  }

  /** Marks a failed or timed-out finalization as an interrupted prefix so library readers do not show it as live; a seal still in flight publishes nothing afterwards. @example writer.abandon() */
  abandon(): void {
    this.abandoned = true
    this.closed = true
    this.closing = false
    // Other windows read the history as interrupted once the record is gone (F260); the removal is awaited by nobody.
    void this.removeWriterRecord()
    this.onClosed()
  }

  /** Removes the record of the editor process that writes this history ({@link writeNodeTestWriterRecord}); a record that stays is ignored once its process is gone, and by the seal. @example await this.removeWriterRecord() */
  private removeWriterRecord(): Promise<void> {
    return rm(join(this.directory, NODE_TEST_HISTORY_WRITER_FILE), {
      force: true,
    }).catch(() => undefined)
  }

  /**
   * Queues one entry behind the accepted ones; the entry is numbered, checked against the profile's rules and made durable when its turn comes, so callers in one synchronous step get consecutive numbers in call order.
   * @param input - The entry without its sequence.
   * @returns Settles when the entry is durable; rejects when it is refused, and the writer then accepts nothing more.
   * @throws Rejects at the call when the seal began or the writer is closed; later, with the profile's refusal or the I/O failure.
   * @example await this.append({ type: 'output', elapsedMs: 1, channel: 'stdout', text: 'ready' })
   */
  protected append(input: Omit<Types['Entry'], 'sequence'>): Promise<void> {
    // Acceptance is decided here, in the caller's turn: an entry offered after the seal began is refused, one offered before it is written.
    if (this.closed || this.closing)
      return Promise.reject(
        this.failure
          ? this.afterFailure(this.failure)
          : new Error('Node history is already sealing or sealed.'),
      )
    const operation = this.pending.then(async () => {
      // Evidence after a failed entry would follow a gap, so the verified prefix ends at the first failure.
      if (this.failure) throw this.afterFailure(this.failure)
      if (this.closed)
        throw new Error('Node history is already sealing or sealed.')
      if (this.entries >= this.rules.maxEntries) {
        this.limitReached = true
        throw new Error('Node history reached its event limit.')
      }
      const entry = this.rules.parseEntry({
        ...input,
        sequence: this.sequence + 1,
      })
      this.rules.check(entry)
      const line = Buffer.from(`${JSON.stringify(entry)}\n`)
      const path = join(this.directory, HISTORY_JOURNAL_FILE),
        handle = await open(path, 'a', PRIVATE_FILE_MODE)
      try {
        const stat = await handle.stat()
        if (stat.size + line.byteLength > this.rules.journalLimitBytes) {
          this.limitReached = true
          throw new Error(
            'Node history reached its storage limit; existing evidence remains readable.',
          )
        }
        await handle.writeFile(line)
        await handle.sync()
      } finally {
        await handle.close()
      }
      this.sequence = entry.sequence
      this.entries++
      this.confirmedBytes += line.byteLength
      this.rules.commit(entry)
    })
    // Later entries and the seal wait for this one without inheriting its rejection.
    this.pending = operation.catch((error: unknown) => {
      this.failure ??= error instanceof Error ? error : new Error(String(error))
    })
    return operation
  }

  /** Words the refusal of an entry that follows a failed one. */
  private afterFailure(failure: Error): Error {
    return new Error(
      `Node history stopped accepting evidence after an earlier entry failed: ${failure.message}`,
    )
  }
}
