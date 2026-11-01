import {
  NODE_SERVER_HISTORY_SEAL_BOUND_MS,
  NODE_SERVER_PROFILE,
} from './constants'
import type {
  NodeServerHistorySummary,
  NodeServerHistoryTypes,
} from './nodeServerHistoryTypes'
import type { NodeHistoryStore } from './nodeTestHistoryStore'
import {
  ProfileLearningSave,
  type ProfileLearningSaveHost,
  type ProfileLearningSaveItem,
} from './profileLearningSave'
import type { StudyRecord, StudyService } from './service'
import {
  describeNodeServerLearningSave,
  type NodeServerSaveMessage,
} from './utils/describeNodeServerLearningSave'
import {
  describeNodeServerStatus,
  type NodeServerLearningStatus,
} from './utils/describeNodeServerStatus'
import { sleepUntilAborted } from './utils/sleepUntilAborted'
import { waitWithin } from './utils/waitWithin'

/** The service members the Save of a server run uses. */
type ServerSaveService = Pick<
  StudyService,
  'instanceId' | 'stop' | 'causeRoots' | 'state'
>

/** What the Save of a server run needs from the editor and the extension, so it is tested without the Study workspace. */
export type NodeServerLearningSaveHost =
  ProfileLearningSaveHost<ServerSaveService> & {
    /** The server history store whose summary Save reads when the seal's own was unreadable. */
    store: () =>
      Pick<NodeHistoryStore<NodeServerHistoryTypes>, 'summarize'> | undefined
    /** The material revision the store holds for a server history, from the summary projection the library lists; `undefined` while the history is not listed. */
    materialRevision: (studyId: string) => number | undefined
    /** How long Save waits for that summary read; {@link NODE_SERVER_HISTORY_SEAL_BOUND_MS} unless a test names its own. */
    summaryReadBoundMs?: number
  }

/** What the status item shows for a server run, and what a click does. */
export type NodeServerLearningSaveItem = ProfileLearningSaveItem

/** What one read of the sealed summary answered: the summary (`undefined` when the store holds no such history), what the read threw, or that no store is attached to read. */
type SummaryRead =
  | { summary: NodeServerHistorySummary | undefined }
  | { rejected: unknown }
  | { noStore: true }

/**
 * Owns the Save of a server run's learning replay from the status item: the question before the run is stopped, the one seal Save joins, the single notice after it, and the status item's words.
 * Save stops the run through the service (which seals the history once, however many callers join), then reads the sealed history's verdicts: Saved only when the capture is complete and the chat's explanation covers it, else Partial with the first reason; a history that could not start, be written or be sealed answers its cause and never fails the live run.
 * Created by {@link StudyWorkspace}; the item and the Save command call it for a node-server run.
 * @example
 * const save = new NodeServerLearningSave(host)
 * statusItem.text = save.item(record)?.text
 * await save.save(record)
 */
export class NodeServerLearningSave extends ProfileLearningSave<
  ServerSaveService,
  NodeServerSaveMessage
> {
  /** The sealed-summary read in flight per study, shared by Saves that overlap it. */
  private readonly summaryReads = new Map<string, Promise<SummaryRead>>()

  constructor(protected override readonly host: NodeServerLearningSaveHost) {
    super(host, NODE_SERVER_PROFILE, 'server-run', 'Server')
  }

  protected describeMessage(message: NodeServerSaveMessage) {
    return describeNodeServerLearningSave(message)
  }

  protected failedMessage(cause: string): NodeServerSaveMessage {
    return { kind: 'failed', cause }
  }

  /**
   * Gives what the status item shows for a server run: where the run stands beside where its learning replay stands.
   * @param record - A node-server run of the service.
   * @returns The item's text, tooltip and command; `undefined` for a record that is no server run.
   * @example save.item(record)?.text // => '$(record) Recording explanation · Listening on :4100 · Save learning replay'
   */
  item(record: StudyRecord): NodeServerLearningSaveItem | undefined {
    const service = this.host.service()
    if (!service || record.profile !== NODE_SERVER_PROFILE) return undefined
    const studyId = `${service.instanceId}_${record.id}`
    const view = describeNodeServerStatus(
      service.state(record),
      this.statusOf(record, studyId),
    )
    return {
      ...view,
      ...this.commandOf(
        studyId,
        this.currentState(studyId, this.host.materialRevision(studyId) ?? 0),
      ),
    }
  }

  protected refusalOf(record: StudyRecord): NodeServerSaveMessage | undefined {
    if (!record.nodeServer?.history)
      return {
        kind: 'unavailable',
        cause:
          record.nodeServer?.historyUnavailable ?? 'no history was started.',
      }
    // Before the request went out there is nothing to keep, and a Save would only end the run.
    return !this.hasEnded(record) && !record.nodeServer.run?.view().request
      ? { kind: 'nothing-yet' }
      : undefined
  }

  protected hasEnded(record: StudyRecord): boolean {
    return (
      record.stopped ||
      record.stopping ||
      record.nodeServer?.history?.isRecording === false
    )
  }

  /** Words and asks the response-aware question. */
  protected askQuestion(record: StudyRecord): Promise<string | undefined> {
    const view = record.nodeServer?.run?.view()
    const asked = describeNodeServerLearningSave({
      kind: 'question',
      reached: new Set(view?.stopsReached ?? []).size,
      declared: view?.stops.length ?? 0,
      responseRecorded: view?.response !== undefined,
    })
    return this.host.ask(asked.text, asked.actions ?? [])
  }

  /**
   * Reads the sealed history's verdicts and tells the learner the one outcome; a history that could not be sealed reads its cause instead.
   * @param record - The node-server run, whose history was sealed or abandoned.
   * @param studyId - Its study id.
   */
  protected async readSaved(
    record: StudyRecord,
    studyId: string,
  ): Promise<void> {
    const history = record.nodeServer?.history
    if (history?.status === 'failed') {
      // Save answers with the cause, as the item shows it; a second click answers it again.
      this.failSeal(studyId, history.failure ?? 'The history failed.')
      return
    }
    const verified = await this.verifiedSummary(
      studyId,
      history?.sealed?.summary,
    )
    if ('cause' in verified) {
      this.failRead(studyId, verified.cause)
      return
    }
    this.finishSaved(studyId, verified.summary)
  }

  /**
   * Reads the history's current summary and checks it is verified, the way {@link NodeLearningSave} does for a test run.
   * The store is read first, so material another window saved during or after the seal counts; the seal-time summary answers only when that read timed out or no store is attached.
   * @param studyId - The history's study id.
   * @param sealTimeSummary - The summary the seal read, if it could.
   * @returns The verified summary, or the cause Save shows: the read's own error, the summary's reason, the missing history, or the bound that passed (Save never waits past it, so another run's Save stays free).
   */
  private async verifiedSummary(
    studyId: string,
    sealTimeSummary: NodeServerHistorySummary | undefined,
  ): Promise<{ summary: NodeServerHistorySummary } | { cause: string }> {
    const boundMs =
      this.host.summaryReadBoundMs ?? NODE_SERVER_HISTORY_SEAL_BOUND_MS
    const read = await this.readSummaryWithin(studyId, boundMs)
    if (read && 'rejected' in read)
      return { cause: this.causeOf(read.rejected) }
    // The seal-time summary stands in only when the store could not answer (timed out, or none attached); an answer that the history is gone is not overridden by it.
    const summary = read && 'summary' in read ? read.summary : sealTimeSummary
    if (summary?.verification === 'verified') return { summary }
    // No store is attached and the seal read no summary: nothing says the history is missing, only that it cannot be checked.
    if (read && 'noStore' in read && !sealTimeSummary)
      return {
        cause:
          'No learning storage is attached, so the sealed server history cannot be checked.',
      }
    if (read || sealTimeSummary)
      return {
        cause:
          summary?.reason ?? 'The sealed server history is not in the store.',
      }
    return {
      cause: `The sealed server history could not be read within ${boundMs / 1_000} s.`,
    }
  }

  /** Where the run's learning replay stands, for the item's words. */
  private statusOf(
    record: StudyRecord,
    studyId: string,
  ): NodeServerLearningStatus {
    const history = record.nodeServer?.history
    if (!history && record.nodeServer?.historyUnavailable)
      return {
        kind: 'unavailable',
        cause: record.nodeServer.historyUnavailable,
      }
    // The history starts before the launch: until then the run is still being prepared and nothing is lost.
    if (!history) return this.recordingOf(record)
    if (history.status === 'failed')
      return { kind: 'failed', cause: history.failure ?? 'The history failed.' }
    return (
      this.progressOf({
        studyId,
        revision: this.host.materialRevision(studyId) ?? 0,
        history,
        record,
      }) ?? this.recordingOf(record)
    )
  }

  /** The live words of a run that records: the distinct stops reached, the declared ones and whether a response is recorded. */
  private recordingOf(record: StudyRecord): NodeServerLearningStatus {
    const view = record.nodeServer?.run?.view()
    return {
      kind: 'recording',
      reached: new Set(view?.stopsReached ?? []).size,
      declared: view?.stops.length ?? 0,
      responseRecorded: view?.response !== undefined,
    }
  }

  /**
   * Reads the sealed history's summary from the store for at most `boundMs`.
   * @param studyId - The history's study id.
   * @param boundMs - How long Save waits.
   * @returns `{ summary }` (the summary, or `undefined` when the store holds no such history), `{ rejected }` with what a failed read threw, `{ noStore }` when no store is attached, or `undefined` when the read outlived its bound.
   */
  private async readSummaryWithin(
    studyId: string,
    boundMs: number,
  ): Promise<SummaryRead | undefined> {
    // Saves of one study share the read in flight, so a stalled store holds one pending read, not one per click.
    let reading = this.summaryReads.get(studyId)
    if (!reading) {
      const started = this.host.store()?.summarize(studyId)
      if (!started) return { noStore: true }
      reading = started.then(
        (summary): SummaryRead => ({ summary }),
        (rejected: unknown): SummaryRead => ({ rejected }),
      )
      this.summaryReads.set(studyId, reading)
      void reading.finally(() => {
        if (this.summaryReads.get(studyId) === reading)
          this.summaryReads.delete(studyId)
      })
    }
    return waitWithin(reading, {
      timeoutMs: boundMs,
      signal: new AbortController().signal,
      sleep: sleepUntilAborted,
    })
  }
}
