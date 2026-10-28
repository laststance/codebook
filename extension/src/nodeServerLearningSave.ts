import {
  NODE_SERVER_PROFILE,
  OPEN_LEARNING_REPLAY_COMMAND,
  SAVE_LEARNING_REPLAY_COMMAND,
} from './constants'
import type { NodeLearningSaveHost } from './nodeLearningSave'
import type { NodeServerHistoryTypes } from './nodeServerHistoryTypes'
import type { NodeHistoryStore } from './nodeTestHistoryStore'
import type { StudyRecord, StudyService } from './service'
import { NODE_LEARNING_SAVE_ACTION } from './utils/describeNodeLearningSave'
import {
  describeNodeServerLearningSave,
  type NodeServerSaveMessage,
} from './utils/describeNodeServerLearningSave'
import {
  describeNodeServerStatus,
  type NodeServerLearningStatus,
} from './utils/describeNodeServerStatus'
import { offerOpenReplay } from './utils/offerOpenReplay'
import { sanitizeCause } from './utils/sanitizeCause'
import { sanitizedStack } from './utils/sanitizedStack'
import { SaveSerializer } from './utils/SaveSerializer'

/** What the Save of a server run needs from the editor and the extension, so it is tested without the Study workspace. */
export type NodeServerLearningSaveHost = Omit<
  NodeLearningSaveHost,
  'service' | 'store'
> & {
  /** The service whose server runs are saved; `undefined` before it is attached. */
  service: () =>
    | Pick<StudyService, 'instanceId' | 'stop' | 'causeRoots' | 'state'>
    | undefined
  /** The server history store whose summary Save reads when the seal's own was unreadable. */
  store: () =>
    Pick<NodeHistoryStore<NodeServerHistoryTypes>, 'summarize'> | undefined
}

/** What the status item shows for a server run, and what a click does. */
export type NodeServerLearningSaveItem = {
  text: string
  tooltip: string
  command?: { title: string; command: string; arguments: [string] }
}

/** Where one server run's Save stands, keyed by its study id. */
type SaveState =
  | { stage: 'saving' }
  | { stage: 'saved'; materialRevision: number }
  | { stage: 'partial'; materialRevision: number }

/**
 * Owns the Save of a server run's learning replay from the status item: the question before the run is stopped, the one seal Save joins, the single notice after it, and the status item's words.
 * Save stops the run through the service (which seals the history once, however many callers join), then reads the sealed history's verdicts: Saved only when the capture is complete and the chat's explanation covers it, else Partial with the first reason; a history that could not start, be written or be sealed answers its cause and never fails the live run.
 * Created by {@link StudyWorkspace}; the item and the Save command call it for a node-server run.
 * @example
 * const save = new NodeServerLearningSave(host)
 * statusItem.text = save.item(record)?.text
 * await save.save(record)
 */
export class NodeServerLearningSave {
  private readonly states = new Map<string, SaveState>()
  private readonly saves = new SaveSerializer()
  /** The question being asked, so a second Save while it is open joins it: one modal, one save. */
  private question?: Promise<string | undefined>

  constructor(private readonly host: NodeServerLearningSaveHost) {}

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
    const state = this.currentState(studyId, record)
    const opens = state?.stage === 'saved' || state?.stage === 'partial'
    return {
      ...view,
      ...(state?.stage === 'saving'
        ? {}
        : {
            command: {
              title: opens
                ? NODE_LEARNING_SAVE_ACTION.openReplay
                : 'Save learning replay',
              command: opens
                ? OPEN_LEARNING_REPLAY_COMMAND
                : SAVE_LEARNING_REPLAY_COMMAND,
              arguments: [studyId] as [string],
            },
          }),
    }
  }

  /**
   * Saves a server run's learning replay for the status item and the Save command.
   * @param record - The node-server run.
   * @returns Once the Save ended in a state the item shows; a Save while one runs joins it, and a Save while the question is open focuses the same question.
   * @throws When another run's learning is being saved.
   * @example await save.save(record)
   */
  save(record: StudyRecord): Promise<void> {
    const service = this.host.service()
    if (!service) return Promise.resolve()
    // The serializer refuses another study's Save by throwing synchronously; a caller that awaits or chains `.catch` gets it as a rejection.
    try {
      return this.saves.runFor(
        service,
        record,
        (studyId) => this.saveOnce({ service, record, studyId }),
        () => this.host.changed(),
      )
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Runs one Save: the refusals, the question, the stop with its seal, the reading of the verdicts. */
  private async saveOnce(context: {
    service: NonNullable<ReturnType<NodeServerLearningSaveHost['service']>>
    record: StudyRecord
    studyId: string
  }): Promise<void> {
    const { service, record, studyId } = context
    const history = record.nodeServer?.history
    if (!history) {
      this.tell({
        kind: 'unavailable',
        cause:
          record.nodeServer?.historyUnavailable ?? 'no history was started.',
      })
      return
    }
    const view = record.nodeServer?.run?.view()
    // A stop already under way is joined without a question.
    const ended = record.stopped || record.stopping || !history.isRecording
    // Before the request went out there is nothing to keep, and a Save would only end the run.
    if (!ended && !view?.request) {
      this.tell({ kind: 'nothing-yet' })
      return
    }
    if (!ended && !(await this.confirmStop(record, studyId))) return
    this.setState(studyId, { stage: 'saving' })
    try {
      await service.stop({ instanceId: service.instanceId, runId: record.id })
    } catch (error) {
      this.states.delete(studyId)
      this.logFailure(studyId, 'save:stop-rejected', error)
      throw error
    }
    await this.readSaved(record, studyId)
  }

  /** Asks the question that precedes ending the run; one question however many Saves meet it. @returns `true` when the learner chose Save and stop. */
  private async confirmStop(
    record: StudyRecord,
    studyId: string,
  ): Promise<boolean> {
    this.question ??= this.askQuestion(record).finally(() => {
      this.question = undefined
    })
    const answer = await this.question
    if (answer === NODE_LEARNING_SAVE_ACTION.saveAndStop) return true
    this.states.delete(studyId)
    return false
  }

  /** Words and asks the response-aware question. */
  private askQuestion(record: StudyRecord): Promise<string | undefined> {
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
  private async readSaved(record: StudyRecord, studyId: string): Promise<void> {
    const history = record.nodeServer?.history
    if (history?.status === 'failed') {
      this.states.delete(studyId)
      this.host.changed()
      // Save answers with the cause, as the item shows it; a second click answers it again.
      this.tell(
        { kind: 'failed', cause: history.failure ?? 'The history failed.' },
        'warning',
      )
      return
    }
    const summary =
      history?.sealed?.summary ??
      (await this.host
        .store()
        ?.summarize(studyId)
        .catch(() => undefined))
    if (!summary || summary.verification !== 'verified') {
      this.states.delete(studyId)
      this.logFailure(
        studyId,
        'save:read-failed',
        new Error(
          summary?.reason ?? 'The sealed server history is not in the store.',
        ),
      )
      this.tell(
        {
          kind: 'failed',
          cause:
            summary?.reason ?? 'The sealed server history is not in the store.',
        },
        'warning',
      )
      return
    }
    const complete =
      summary.captureComplete && summary.learningCoverage === 'complete'
    this.setState(studyId, {
      stage: complete ? 'saved' : 'partial',
      materialRevision: summary.materialRevision,
    })
    const [first] = summary.captureMissing
    const message: NodeServerSaveMessage = complete
      ? { kind: 'saved' }
      : first
        ? {
            kind: 'partial',
            firstReason: first.text,
            moreCount: summary.captureMissingCount - 1,
          }
        : { kind: 'explanation-missing' }
    const notice = describeNodeServerLearningSave(message)
    offerOpenReplay(
      this.host,
      complete ? 'information' : 'warning',
      notice,
      studyId,
      (error) => {
        this.logFailure(studyId, 'save:open-replay', error)
      },
    )
  }

  /** Shows one refusal or notice that offers nothing to do. */
  private tell(
    message: NodeServerSaveMessage,
    severity: 'information' | 'warning' = 'information',
  ): void {
    const words = describeNodeServerLearningSave(message)
    void this.host.notify(severity, words.text, []).catch((error: unknown) => {
      this.logFailure('server-run', 'save:notice', error)
    })
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
    const state = this.currentState(studyId, record)
    if (state) return { kind: state.stage }
    if (record.stopped || history.status === 'sealed')
      return { kind: 'finished' }
    return this.recordingOf(record)
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

  /** A saved or partially saved state counts only for the material revision it read: a later revision returns the item to Save. */
  private currentState(
    studyId: string,
    record: StudyRecord,
  ): SaveState | undefined {
    const state = this.states.get(studyId)
    if (state?.stage !== 'saved' && state?.stage !== 'partial') return state
    const revision =
      this.host.materialRevision(studyId) ??
      record.nodeServer?.history?.sealed?.summary?.materialRevision ??
      0
    return revision > state.materialRevision ? undefined : state
  }

  private setState(studyId: string, state: SaveState): void {
    this.states.set(studyId, state)
    this.host.changed()
  }

  /** Writes one Output entry for a failure with its sanitized cause and stack. */
  private logFailure(studyId: string, surface: string, error: unknown): void {
    const roots = this.host.service()?.causeRoots ?? { storage: [] }
    const stack = sanitizedStack(error, roots)
    this.host.log({
      surface,
      studyId,
      profile: NODE_SERVER_PROFILE,
      cause: sanitizeCause(error, roots),
      ...(stack ? { stack } : {}),
    })
  }
}
