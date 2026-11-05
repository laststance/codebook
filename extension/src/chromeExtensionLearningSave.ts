import type { ChromeExtensionHistoryRecorder } from './chromeExtensionHistoryRecorder'
import type {
  ExtensionHistorySummary,
  ExtensionHistoryTypes,
} from './chromeExtensionHistoryTypes'
import {
  CHROME_EXTENSION_PROFILE,
  NODE_SERVER_HISTORY_SEAL_BOUND_MS,
} from './constants'
import type { NodeScriptHistoryRecorder } from './nodeScriptHistoryRecorder'
import type {
  NodeScriptHistorySummary,
  NodeScriptHistoryTypes,
} from './nodeScriptHistoryTypes'
import type { NodeHistoryStore } from './nodeTestHistoryStore'
import {
  ProfileLearningSave,
  type ProfileLearningSaveHost,
  type ProfileLearningSaveItem,
  type ProfileSaveService,
} from './profileLearningSave'
import type { StudyRecord } from './service'
import {
  describeExtensionLearningSave,
  describeExtensionStatus,
  EXTENSION_SAVE_WORDS,
  type ExtensionLearningStatus,
  type ExtensionSaveMessage,
  type StructuredSaveWords,
} from './utils/describeExtensionLearningSave'
import { sleepUntilAborted } from './utils/sleepUntilAborted'
import { waitWithin } from './utils/waitWithin'

/** What the Save reads of a run whose history is a structured journal (an extension run's or a script run's). */
export type StructuredRunSaveState = {
  history?: ChromeExtensionHistoryRecorder | NodeScriptHistoryRecorder
  historyUnavailable?: string
}

/** What differs between the Save of an extension run and of a script run: the profile, the record's state, the words and the counts of the stops and the outcome. */
export type StructuredSaveKind = {
  profile: string
  noticeStudy: string
  words: StructuredSaveWords
  /** The history state the run keeps on its record. */
  stateOf(record: StudyRecord): StructuredRunSaveState | undefined
  /** The distinct declared stops reached and the declared ones, from the run's view. */
  stopCounts(record: StudyRecord): { reached: number; declared: number }
  /** Whether the run recorded its result (an extension's observation) or end (a script's). */
  outcomeRecorded(record: StudyRecord): boolean
}

/** The Save of a chrome-extension run. */
const EXTENSION_SAVE_KIND: StructuredSaveKind = {
  profile: CHROME_EXTENSION_PROFILE,
  noticeStudy: 'extension-run',
  words: EXTENSION_SAVE_WORDS,
  stateOf: (record) => record.chromeExtension,
  stopCounts(record) {
    const view = record.chromeExtension?.run?.view()
    const declared = view?.stopsDeclared ?? 0
    return {
      reached: declared - (view?.stopsNotReached.length ?? declared),
      declared,
    }
  },
  outcomeRecorded: (record) =>
    Boolean(record.chromeExtension?.run?.view().observed),
}

/** What the Save of an extension run needs from the editor and the extension, so it is tested without the Study workspace. */
export type ChromeExtensionLearningSaveHost =
  ProfileLearningSaveHost<ProfileSaveService> & {
    /** The extension history store whose summary Save reads when the seal's own was unreadable. */
    store: () =>
      | Pick<NodeHistoryStore<ExtensionHistoryTypes>, 'summarize'>
      | Pick<NodeHistoryStore<NodeScriptHistoryTypes>, 'summarize'>
      | undefined
    /** How long Save waits for that summary read; {@link NODE_SERVER_HISTORY_SEAL_BOUND_MS} unless a test names its own. */
    summaryReadBoundMs?: number
  }

/**
 * Owns the Save of an extension run's learning replay from the status item: the question before the run is stopped, the one seal Save joins, the single notice after it, and the status item's words.
 * Save stops the run through the service (which seals the history once, however many callers join), then reads the sealed history's verdicts: Saved only when the capture is complete and the chat's explanation covers it, else Partial with the first reason; a history that could not start, be written or be sealed answers its cause and never fails the live run.
 * Created by {@link StudyWorkspace}; the item and the Save command call it for a chrome-extension run.
 * @example
 * const save = new ChromeExtensionLearningSave(host)
 * statusItem.text = save.item(record, 'Waiting for chat')?.text
 * await save.save(record)
 */
export class ChromeExtensionLearningSave extends ProfileLearningSave<
  ProfileSaveService,
  ExtensionSaveMessage
> {
  constructor(
    protected override readonly host: ChromeExtensionLearningSaveHost,
    private readonly kind: StructuredSaveKind = EXTENSION_SAVE_KIND,
  ) {
    super(host, kind.profile, kind.noticeStudy, kind.words.label)
  }

  protected describeMessage(message: ExtensionSaveMessage) {
    return describeExtensionLearningSave(message, this.kind.words)
  }

  protected failedMessage(cause: string): ExtensionSaveMessage {
    return { kind: 'failed', cause }
  }

  /**
   * Gives what the status item shows for an extension run: where the run stands beside where its learning replay stands.
   * @param record - A chrome-extension run of the service.
   * @param runText - The run's own status text, from its phase.
   * @returns The item's text, tooltip and command; `undefined` for a record that is no extension run.
   * @example save.item(record, 'Waiting for chat')?.text // => '$(record) Recording explanation · Waiting for chat · Save learning replay'
   */
  item(
    record: StudyRecord,
    runText: string,
  ): ProfileLearningSaveItem | undefined {
    const service = this.host.service()
    if (!service || record.profile !== this.kind.profile) return undefined
    const studyId = `${service.instanceId}_${record.id}`
    return {
      ...describeExtensionStatus(
        runText,
        this.statusOf(record, studyId),
        this.kind.words,
      ),
      ...this.commandOf(
        studyId,
        this.currentState(studyId, this.revisionOf(record)),
      ),
    }
  }

  protected refusalOf(record: StudyRecord): ExtensionSaveMessage | undefined {
    const state = this.kind.stateOf(record)
    return state?.history
      ? undefined
      : {
          kind: 'unavailable',
          cause: state?.historyUnavailable ?? 'no history was started.',
        }
  }

  protected hasEnded(record: StudyRecord): boolean {
    return (
      record.stopped ||
      record.stopping ||
      this.kind.stateOf(record)?.history?.status !== 'recording'
    )
  }

  /** Words and asks the result-aware question. */
  protected askQuestion(record: StudyRecord): Promise<string | undefined> {
    const asked = describeExtensionLearningSave(
      {
        kind: 'question',
        ...this.kind.stopCounts(record),
        resultRecorded: this.kind.outcomeRecorded(record),
      },
      this.kind.words,
    )
    return this.host.ask(asked.text, asked.actions ?? [])
  }

  /**
   * Reads the sealed history's verdicts and tells the learner the one outcome; a history that could not be sealed reads its cause instead.
   * @param record - The extension run, whose history was sealed or abandoned.
   * @param studyId - Its study id.
   */
  protected async readSaved(
    record: StudyRecord,
    studyId: string,
  ): Promise<void> {
    const history = this.kind.stateOf(record)?.history
    if (history?.status === 'failed') {
      this.failSeal(studyId, history.failure ?? 'The history failed.')
      return
    }
    const verified = await this.verifiedSummary(
      studyId,
      history?.sealed?.summary,
    )
    if ('nothing' in verified) {
      this.states.delete(studyId)
      this.tell({ kind: 'nothing-recorded' })
      return
    }
    if ('cause' in verified) {
      this.failRead(studyId, verified.cause)
      return
    }
    this.finishSaved(studyId, verified.summary)
  }

  /**
   * Reads the history's current summary from the store, within a bound, and checks it is verified; the seal-time summary answers only when that read timed out or no store is attached.
   * @param studyId - The history's study id.
   * @param sealTimeSummary - The summary the seal read, if it could.
   * @returns The verified summary, `{ nothing }` when the history holds no entry, or the cause Save shows.
   */
  private async verifiedSummary(
    studyId: string,
    sealTimeSummary:
      ExtensionHistorySummary | NodeScriptHistorySummary | undefined,
  ): Promise<
    | { summary: ExtensionHistorySummary | NodeScriptHistorySummary }
    | { cause: string }
    | { nothing: true }
  > {
    const boundMs =
      this.host.summaryReadBoundMs ?? NODE_SERVER_HISTORY_SEAL_BOUND_MS
    const started = this.host.store()?.summarize(studyId)
    if (!started && !sealTimeSummary)
      return {
        cause: `No learning storage is attached, so the sealed ${this.kind.words.noun} history cannot be checked.`,
      }
    const read = started
      ? await waitWithin(
          started.then(
            (summary) => ({ summary }),
            (rejected: unknown) => ({ rejected }),
          ),
          {
            timeoutMs: boundMs,
            signal: new AbortController().signal,
            sleep: sleepUntilAborted,
          },
        )
      : undefined
    if (read && 'rejected' in read)
      return { cause: this.causeOf(read.rejected) }
    // A history sealed with no entry removed its folder: nothing was recorded to save.
    if (
      read &&
      'summary' in read &&
      read.summary === undefined &&
      !sealTimeSummary
    )
      return { nothing: true }
    const summary = read && 'summary' in read ? read.summary : sealTimeSummary
    if (summary?.verification === 'verified') return { summary }
    if (read || sealTimeSummary)
      return {
        cause:
          summary?.reason ??
          `The sealed ${this.kind.words.noun} history is not in the store.`,
      }
    return {
      cause: `The sealed ${this.kind.words.noun} history could not be read within ${boundMs / 1_000} s.`,
    }
  }

  /** Where the run's learning replay stands, for the item's words. */
  private statusOf(
    record: StudyRecord,
    studyId: string,
  ): ExtensionLearningStatus {
    const state = this.kind.stateOf(record)
    const history = state?.history
    if (!history)
      return {
        kind: 'unavailable',
        cause: state?.historyUnavailable ?? 'no history was started.',
      }
    if (history.status === 'failed')
      return { kind: 'failed', cause: history.failure ?? 'The history failed.' }
    const progress = this.progressOf({
      studyId,
      revision: this.revisionOf(record),
      history,
      record,
    })
    if (progress) return progress
    return { kind: 'recording', ...this.kind.stopCounts(record) }
  }

  /** The material revision of the run's sealed summary (refreshed by a save and a run resource read). */
  private revisionOf(record: StudyRecord): number {
    return (
      this.kind.stateOf(record)?.history?.sealed?.summary?.materialRevision ?? 0
    )
  }
}
