import {
  OPEN_LEARNING_REPLAY_COMMAND,
  SAVE_LEARNING_REPLAY_COMMAND,
} from './constants'
import type { NodeLearningSaveHost } from './nodeLearningSave'
import type { StudyRecord, StudyService } from './service'
import { NODE_LEARNING_SAVE_ACTION } from './utils/describeNodeLearningSave'
import {
  describeReplayOutcome,
  type ProfileSaveOutcome,
  type ReplayLabel,
} from './utils/describeReplayOutcome'
import { offerOpenReplay } from './utils/offerOpenReplay'
import { sanitizeCause } from './utils/sanitizeCause'
import { sanitizedStack } from './utils/sanitizedStack'
import { SaveSerializer } from './utils/SaveSerializer'

/** What the Save of any stopped-then-sealed profile run needs from the service: its identity, its stop and the roots its causes are cleaned with. */
export type ProfileSaveService = Pick<
  StudyService,
  'instanceId' | 'stop' | 'causeRoots'
>

/** The editor-bound parts of a profile Save's host, shared by the server and the extension Save. */
export type ProfileLearningSaveHost<Service extends ProfileSaveService> = Pick<
  NodeLearningSaveHost,
  'ask' | 'notify' | 'open' | 'log' | 'changed'
> & {
  /** The service whose runs are saved; `undefined` before it is attached. */
  service: () => Service | undefined
}

/** Where one run's Save stands, keyed by its study id. */
export type ProfileSaveState =
  | { stage: 'saving' }
  | { stage: 'saved'; materialRevision: number }
  | { stage: 'partial'; materialRevision: number }

/** What the status item shows for a run, and what a click does. */
export type ProfileLearningSaveItem = {
  text: string
  tooltip: string
  command?: { title: string; command: string; arguments: [string] }
}

/** The words of one message and the actions it offers. */
type MessageText = { text: string; actions?: readonly string[] }

/**
 * The part of a run's learning Save that does not depend on its profile: the serialized Save, the one question that precedes the stop, the saving/saved/partial state with the material revision it read, the single notice, Open replay and the Output entry of a failure.
 * Extended by {@link NodeServerLearningSave} and {@link ChromeExtensionLearningSave}, which add the profile's refusals, its summary read and its words.
 * @example
 * class ExampleSave extends ProfileLearningSave<ProfileSaveService, { kind: 'saved' }> { … }
 */
export abstract class ProfileLearningSave<
  Service extends ProfileSaveService,
  Message,
> {
  protected readonly states = new Map<string, ProfileSaveState>()
  private readonly saves = new SaveSerializer()
  /** The question being asked, so a second Save while it is open joins it: one modal, one save. */
  private question?: Promise<string | undefined>

  /**
   * @param host - The editor-bound parts and the service.
   * @param profile - The profile an Output entry names.
   * @param noticeStudy - What an Output entry names for a notice that belongs to no study.
   * @param replayLabel - The kind of replay the notices call the saved study.
   */
  constructor(
    protected readonly host: ProfileLearningSaveHost<Service>,
    private readonly profile: string,
    private readonly noticeStudy: string,
    private readonly replayLabel: ReplayLabel,
  ) {}

  /** Words a message of the profile. */
  protected abstract describeMessage(message: Message): MessageText

  /** The profile's message for a Save that failed with `cause`. */
  protected abstract failedMessage(cause: string): Message

  /**
   * Saves a run's learning replay for the status item and the Save command.
   * @param record - The run.
   * @returns Once the Save ended in a state the item shows; a Save while one runs joins it.
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

  /**
   * Gives what a click on the status item does: Save, or Open replay once saved; nothing while a Save runs.
   * @param studyId - The run's study id.
   * @param state - The run's current Save state.
   * @returns The item's command, or `{}` while saving, to spread into the item.
   * @example { ...view, ...this.commandOf(studyId, this.currentState(studyId, revisionOf)) }
   */
  protected commandOf(
    studyId: string,
    state: ProfileSaveState | undefined,
  ): Pick<ProfileLearningSaveItem, 'command'> {
    if (state?.stage === 'saving') return {}
    const opens = state?.stage === 'saved' || state?.stage === 'partial'
    return {
      command: {
        title: opens
          ? NODE_LEARNING_SAVE_ACTION.openReplay
          : 'Save learning replay',
        command: opens
          ? OPEN_LEARNING_REPLAY_COMMAND
          : SAVE_LEARNING_REPLAY_COMMAND,
        arguments: [studyId],
      },
    }
  }

  /** Asks the question that precedes ending the run; one question however many Saves meet it. @returns `true` when the learner chose Save and stop. */
  protected async confirmStop(
    studyId: string,
    ask: () => Promise<string | undefined>,
  ): Promise<boolean> {
    this.question ??= ask().finally(() => {
      this.question = undefined
    })
    const answer = await this.question
    if (answer === NODE_LEARNING_SAVE_ACTION.saveAndStop) return true
    this.states.delete(studyId)
    return false
  }

  /** Refuses a Save before anything is asked or stopped: the history that was never started, or a run with nothing to keep yet. @returns The notice to show, or `undefined` to go on. */
  protected abstract refusalOf(record: StudyRecord): Message | undefined

  /** Whether the run already ended or is ending, so a Save joins the stop without a question. */
  protected abstract hasEnded(record: StudyRecord): boolean

  /** Words and asks the question that precedes ending a live run. */
  protected abstract askQuestion(
    record: StudyRecord,
  ): Promise<string | undefined>

  /** Reads the sealed history's verdicts and tells the learner the one outcome. */
  protected abstract readSaved(
    record: StudyRecord,
    studyId: string,
  ): Promise<void>

  /**
   * Runs one Save: the profile's refusals, the question unless the run ended, the stop with its seal, the reading of the verdicts.
   * @param context - The service, the run and its study id.
   * @throws What the stop threw.
   * @example await this.saveOnce({ service, record, studyId })
   */
  private async saveOnce(context: {
    service: Service
    record: StudyRecord
    studyId: string
  }): Promise<void> {
    const { record, studyId } = context
    const refusal = this.refusalOf(record)
    if (refusal) {
      this.tell(refusal)
      return
    }
    if (
      !this.hasEnded(record) &&
      !(await this.confirmStop(studyId, () => this.askQuestion(record)))
    )
      return
    await this.stopAndSeal(context)
    await this.readSaved(record, studyId)
  }

  /**
   * Stops the run through the service (which seals its history once, however many callers join) while the item reads saving.
   * @param context - The service, the run and its study id.
   * @throws What the stop threw, after the failure was logged and the saving state cleared.
   * @example await this.stopAndSeal({ service, record, studyId })
   */
  protected async stopAndSeal(context: {
    service: Service
    record: StudyRecord
    studyId: string
  }): Promise<void> {
    const { service, record, studyId } = context
    this.setState(studyId, { stage: 'saving' })
    try {
      await service.stop({ instanceId: service.instanceId, runId: record.id })
    } catch (error) {
      this.states.delete(studyId)
      this.logFailure(studyId, 'save:stop-rejected', error)
      throw error
    }
  }

  /**
   * Ends a Save whose sealed history was read: the item reads saved (capture complete and the chat's explanation covers it) or partial, and the learner gets the one notice with Open replay.
   * @param studyId - The run's study id.
   * @param summary - The sealed history's verdicts.
   * @example this.finishSaved(studyId, { captureComplete: true, learningCoverage: 'complete', materialRevision: 1, captureMissing: [] })
   */
  protected finishSaved(
    studyId: string,
    summary: {
      captureComplete: boolean
      learningCoverage: string
      materialRevision: number
      captureMissing: readonly { text: string }[]
      /** How many reasons the history has when `captureMissing` is capped. */
      captureMissingCount?: number
    },
  ): void {
    const complete =
      summary.captureComplete && summary.learningCoverage === 'complete'
    this.setState(studyId, {
      stage: complete ? 'saved' : 'partial',
      materialRevision: summary.materialRevision,
    })
    const [first] = summary.captureMissing
    const outcome: ProfileSaveOutcome = complete
      ? { kind: 'saved' }
      : first
        ? {
            kind: 'partial',
            firstReason: first.text,
            moreCount:
              (summary.captureMissingCount ?? summary.captureMissing.length) -
              1,
          }
        : { kind: 'explanation-missing' }
    offerOpenReplay(
      this.host,
      complete ? 'information' : 'warning',
      describeReplayOutcome(this.replayLabel, outcome),
      studyId,
      (error) => {
        this.logFailure(studyId, 'save:open-replay', error)
      },
    )
  }

  /** Ends a Save whose history could not be sealed: the item returns to Save and the learner reads the cause. */
  protected failSeal(studyId: string, cause: string): void {
    this.states.delete(studyId)
    this.host.changed()
    this.tell(this.failedMessage(cause), 'warning')
  }

  /** Ends a Save whose sealed history could not be read or verified: the cause goes to Output › Codebook and to the learner. */
  protected failRead(studyId: string, cause: string): void {
    this.states.delete(studyId)
    this.logFailure(studyId, 'save:read-failed', new Error(cause))
    this.tell(this.failedMessage(cause), 'warning')
  }

  /**
   * Gives where a run's learning replay stands once it is not simply recording: a Save in flight or done, a write that failed while the run lives, or an ended run.
   * @param input - The run's study id, the material revision its Save state is checked against, its history and its flags.
   * @returns The status kind, or `undefined` while the run still records.
   * @example this.progressOf({ studyId, revision: 0, history, record }) // => { kind: 'finished' }
   */
  protected progressOf(input: {
    studyId: string
    revision: number
    history: { appendFailure?: string; status: string }
    record: Pick<StudyRecord, 'stopped' | 'stopping'>
  }):
    | { kind: 'saving' | 'saved' | 'partial' | 'finished' }
    | { kind: 'append-failed'; cause: string }
    | undefined {
    const { studyId, revision, history, record } = input
    const state = this.currentState(studyId, revision)
    if (state) return { kind: state.stage }
    // A write that failed while the run lives: no Save is under way (a state would have returned) and the run has not stopped.
    if (history.appendFailure && !record.stopped && !record.stopping)
      return { kind: 'append-failed', cause: history.appendFailure }
    if (record.stopped || history.status === 'sealed')
      return { kind: 'finished' }
    return undefined
  }

  /** A saved or partially saved state counts only for the material revision it read: a later revision returns the item to Save. */
  protected currentState(
    studyId: string,
    revision: number,
  ): ProfileSaveState | undefined {
    const state = this.states.get(studyId)
    if (state?.stage !== 'saved' && state?.stage !== 'partial') return state
    return revision > state.materialRevision ? undefined : state
  }

  protected setState(studyId: string, state: ProfileSaveState): void {
    this.states.set(studyId, state)
    this.host.changed()
  }

  /** Shows one refusal or notice that offers nothing to do. */
  protected tell(
    message: Message,
    severity: 'information' | 'warning' = 'information',
  ): void {
    const words = this.describeMessage(message)
    void this.host.notify(severity, words.text, []).catch((error: unknown) => {
      this.logFailure(this.noticeStudy, 'save:notice', error)
    })
  }

  /** The sanitized words of a thrown failure, without private paths. */
  protected causeOf(error: unknown): string {
    return sanitizeCause(
      error,
      this.host.service()?.causeRoots ?? { storage: [] },
    )
  }

  /** Writes one Output entry for a failure with the study id, the profile, its sanitized cause and stack. */
  protected logFailure(studyId: string, surface: string, error: unknown): void {
    const roots = this.host.service()?.causeRoots ?? { storage: [] }
    const stack = sanitizedStack(error, roots)
    this.host.log({
      surface,
      studyId,
      profile: this.profile,
      cause: sanitizeCause(error, roots),
      ...(stack ? { stack } : {}),
    })
  }
}
