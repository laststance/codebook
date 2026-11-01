import type {
  ExtensionHistorySummary,
  ExtensionHistoryTypes,
} from './chromeExtensionHistoryTypes'
import {
  CHROME_EXTENSION_PROFILE,
  NODE_SERVER_HISTORY_SEAL_BOUND_MS,
} from './constants'
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
  type ExtensionLearningStatus,
  type ExtensionSaveMessage,
} from './utils/describeExtensionLearningSave'
import { sleepUntilAborted } from './utils/sleepUntilAborted'
import { waitWithin } from './utils/waitWithin'

/** What the Save of an extension run needs from the editor and the extension, so it is tested without the Study workspace. */
export type ChromeExtensionLearningSaveHost =
  ProfileLearningSaveHost<ProfileSaveService> & {
    /** The extension history store whose summary Save reads when the seal's own was unreadable. */
    store: () =>
      Pick<NodeHistoryStore<ExtensionHistoryTypes>, 'summarize'> | undefined
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
  ) {
    super(host, CHROME_EXTENSION_PROFILE, 'extension-run', 'Extension')
  }

  protected describeMessage(message: ExtensionSaveMessage) {
    return describeExtensionLearningSave(message)
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
    if (!service || record.profile !== CHROME_EXTENSION_PROFILE)
      return undefined
    const studyId = `${service.instanceId}_${record.id}`
    return {
      ...describeExtensionStatus(runText, this.statusOf(record, studyId)),
      ...this.commandOf(
        studyId,
        this.currentState(studyId, this.revisionOf(record)),
      ),
    }
  }

  protected refusalOf(record: StudyRecord): ExtensionSaveMessage | undefined {
    return record.chromeExtension?.history
      ? undefined
      : {
          kind: 'unavailable',
          cause:
            record.chromeExtension?.historyUnavailable ??
            'no history was started.',
        }
  }

  protected hasEnded(record: StudyRecord): boolean {
    return (
      record.stopped ||
      record.stopping ||
      record.chromeExtension?.history?.status !== 'recording'
    )
  }

  /** Words and asks the result-aware question. */
  protected askQuestion(record: StudyRecord): Promise<string | undefined> {
    const view = record.chromeExtension?.run?.view()
    const declared = view?.stopsDeclared ?? 0
    const asked = describeExtensionLearningSave({
      kind: 'question',
      reached: declared - (view?.stopsNotReached.length ?? declared),
      declared,
      resultRecorded: Boolean(view?.observed),
    })
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
    const history = record.chromeExtension?.history
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
    sealTimeSummary: ExtensionHistorySummary | undefined,
  ): Promise<
    { summary: ExtensionHistorySummary } | { cause: string } | { nothing: true }
  > {
    const boundMs =
      this.host.summaryReadBoundMs ?? NODE_SERVER_HISTORY_SEAL_BOUND_MS
    const started = this.host.store()?.summarize(studyId)
    if (!started && !sealTimeSummary)
      return {
        cause:
          'No learning storage is attached, so the sealed extension history cannot be checked.',
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
          'The sealed extension history is not in the store.',
      }
    return {
      cause: `The sealed extension history could not be read within ${boundMs / 1_000} s.`,
    }
  }

  /** Where the run's learning replay stands, for the item's words. */
  private statusOf(
    record: StudyRecord,
    studyId: string,
  ): ExtensionLearningStatus {
    const history = record.chromeExtension?.history
    if (!history)
      return {
        kind: 'unavailable',
        cause:
          record.chromeExtension?.historyUnavailable ??
          'no history was started.',
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
    const view = record.chromeExtension?.run?.view()
    const declared = view?.stopsDeclared ?? 0
    return {
      kind: 'recording',
      reached: declared - (view?.stopsNotReached.length ?? declared),
      declared,
    }
  }

  /** The material revision of the run's sealed summary (refreshed by a save and a run resource read). */
  private revisionOf(record: StudyRecord): number {
    return (
      record.chromeExtension?.history?.sealed?.summary?.materialRevision ?? 0
    )
  }
}
