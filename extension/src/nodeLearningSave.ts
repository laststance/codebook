import {
  NODE_TEST_PROFILE,
  OPEN_LEARNING_REPLAY_COMMAND,
  SAVE_LEARNING_REPLAY_COMMAND,
} from './constants'
import type { NodeTestHistoryStore } from './nodeTestHistoryStore'
import type { StudyRecord, StudyService } from './service'
import {
  describeNodeLearningSave,
  NODE_LEARNING_SAVE_ACTION,
  type NodeLearningSaveMessage,
} from './utils/describeNodeLearningSave'
import type { NodeTestVerdict } from './utils/describeNodeTestResult'
import type { CodebookDiagnostic } from './utils/formatCodebookDiagnostic'
import type { NodeLearningPart } from './utils/listMissingNodeLearning'
import { offerOpenReplay } from './utils/offerOpenReplay'
import { sanitizeCause } from './utils/sanitizeCause'
import { sanitizedStack } from './utils/sanitizedStack'
import { SaveSerializer } from './utils/SaveSerializer'

/** What the Save of a test run needs from the editor and the extension, so it is tested without the Study workspace. */
export type NodeLearningSaveHost = {
  /** The service whose test runs are saved; `undefined` before it is attached. */
  service: () =>
    Pick<StudyService, 'instanceId' | 'stop' | 'causeRoots'> | undefined
  /** The history store whose summary Save reads after the seal. */
  store: () => Pick<NodeTestHistoryStore, 'summarize'> | undefined
  /** Asks a modal question; resolves to the action chosen, or `undefined` when the learner cancels. */
  ask: (text: string, actions: readonly string[]) => Promise<string | undefined>
  /** Shows a notification; resolves to the action chosen, or `undefined`. */
  notify: (
    severity: 'information' | 'warning' | 'error',
    text: string,
    actions: readonly string[],
  ) => Promise<string | undefined>
  /** The material revision the store holds for a test history, from the summary projection the library lists (not this window's cache, which only this window's saves move); `undefined` while the history is not listed. */
  materialRevision: (studyId: string) => number | undefined
  /** Opens a test replay (Open replay, Open retained history). */
  open: (studyId: string) => Promise<void>
  /** Reports one unexpected failure to the Output › Codebook channel. */
  log: (entry: CodebookDiagnostic) => void
  /** Called after every change of a Save's state, so the status item is drawn again. */
  changed: () => void
}

/** What the status item shows for a test run, and what a click does. */
export type NodeLearningSaveItem = {
  text: string
  tooltip: string
  command?: { title: string; command: string; arguments: [string] }
}

/** Where one test run's Save stands, keyed by its study id. */
type SaveState =
  | { stage: 'saving' }
  | {
      stage: 'saved'
      verdict: NodeTestVerdict
      stops: number
      materialRevision: number
    }
  | {
      stage: 'partial'
      verdict: NodeTestVerdict
      missing: NodeLearningPart[]
      materialRevision: number
    }
  | { stage: 'stop-rejected' | 'read-failed' | 'seal-failed'; cause: string }

/** The refusal of a Save for a test run that recorded nothing, worded as the browser run's ({@link StudyWorkspace.saveLearningReplay}). */
const NOTHING_RECORDED =
  'No recorded Codebook session is available. Explain a real code path first.'

/**
 * Owns the Save of a test run's learning replay from the status item: its stages, the question before the result, the receipts with the material revision each read, the retry of each failed stage and the notifications, so the Study workspace only wires its status item and commands to it (EN14).
 * Save stops the run, which settles its continuation and seals its history, then reads the store's one summary of the history: saved only with nothing missing and a passing verdict, else partially saved with every missing part named and one notification that offers an explanation only for an explanation gap. A stop that was rejected retries the stop; a read after the seal that failed retries the read without a second seal; a seal that failed opens the retained history.
 * @example
 * const save = new NodeLearningSave(host)
 * statusItem.text = save.item(record)?.text
 * await save.save(record)
 */
export class NodeLearningSave {
  private readonly states = new Map<string, SaveState>()
  private readonly saves = new SaveSerializer()

  constructor(private readonly host: NodeLearningSaveHost) {}

  /**
   * Gives what the status item shows for a test run: preparing before its first stop, the stops reached while it runs, finished after Stop, then the state of its Save; called by the Study workspace each time it publishes.
   * A saved or partially saved state counts for the material revision it read: a later revision returns the item to Save (a Save receipt never vouches for a later revision).
   * @param record - A node-test run of the service.
   * @returns The item's text, tooltip and command; `undefined` for a run that recorded nothing ({@link recordedNothing}: refused or stopped before its history, or sealed with no entry).
   * @example save.item(record)?.text // => '$(record) Recording explanation · stop 1 of 2 · Save learning replay'
   */
  item(record: StudyRecord): NodeLearningSaveItem | undefined {
    const service = this.host.service()
    if (!service || record.profile !== NODE_TEST_PROFILE) return undefined
    if (recordedNothing(record)) return undefined
    const studyId = `${service.instanceId}_${record.id}`
    const state = this.currentState(studyId, record)
    if (state) return this.itemOfState(studyId, state)
    if (record.nodeHistoryStatus === 'failed')
      return this.itemOfState(studyId, {
        stage: 'seal-failed',
        cause: record.nodeHistoryFailure ?? 'unknown cause',
      })
    const reached = record.nodeStops?.length ?? 0
    // Before the first stop the journal has nothing to save; a run that ended there (its continuation failed or its stop was rejected) is no longer preparing and shows nothing.
    if (endedBeforeFirstStop(record)) return undefined
    if (beforeFirstStop(record))
      return this.itemOf(describeNodeLearningSave({ kind: 'preparing' }))
    const message: NodeLearningSaveMessage = record.stopped
      ? { kind: 'finished' }
      : { kind: 'live', reached, declared: declaredStops(record) }
    return this.itemOf(describeNodeLearningSave(message), {
      title: 'Save learning replay',
      command: SAVE_LEARNING_REPLAY_COMMAND,
      arguments: [studyId],
    })
  }

  /**
   * Saves a test run's learning replay for the status item's Save and the Retry of a failed stage; the command `codebook.saveLearningReplay` calls it through the Study workspace for a node-test run.
   * @param record - The node-test run the item shows.
   * @returns Once the Save ended in a state the item shows; a click while a Save runs returns that Save.
   * @throws When another run's learning is being saved, or when the run recorded nothing ({@link recordedNothing}), which the Codebook: Save Learning Replay command can still name.
   * @example await save.save(record)
   */
  save(record: StudyRecord): Promise<void> {
    const service = this.host.service()
    if (!service) return Promise.resolve()
    // Before the first stop there is nothing to save, and a Save would end the preparing run; it does nothing and says so (D9).
    if (beforeFirstStop(record)) {
      const words = describeNodeLearningSave({ kind: 'nothing-yet' })
      void this.host
        .notify('information', words.text, [])
        .catch((error: unknown) => {
          this.logFailure(
            `${service.instanceId}_${record.id}`,
            'save:nothing-yet',
            error,
          )
        })
      return Promise.resolve()
    }
    // The item is not shown for such a run; the command is refused as for a browser run without a recording.
    if (recordedNothing(record)) throw new Error(NOTHING_RECORDED)
    return this.saves.runFor(
      service,
      record,
      (studyId) => this.saveOnce(service, record, studyId),
      () => this.host.changed(),
    )
  }

  /**
   * Runs one Save: the question before the result, the stop with its seal, then the read of the sealed history's summary.
   * @param service - The service that stops the run.
   * @param record - The node-test run.
   * @param studyId - Its study id.
   * @throws When the stop sealed a history with no entry (a Save now while the run still prepared): the Save ends as for a run that recorded nothing ({@link recordedNothing}), with no receipt and no notice.
   * @example await this.saveOnce(service, record, studyId)
   */
  private async saveOnce(
    service: NonNullable<ReturnType<NodeLearningSaveHost['service']>>,
    record: StudyRecord,
    studyId: string,
  ): Promise<void> {
    // Before the result, Save ends a test run that could still reach it: the learner confirms it.
    if (asksBeforeEnding(record)) {
      const question = describeNodeLearningSave({
        kind: 'question',
        reached: record.nodeStops?.length ?? 0,
        declared: declaredStops(record),
      })
      const answer = await this.host.ask(question.text, question.actions ?? [])
      if (answer !== NODE_LEARNING_SAVE_ACTION.saveNow) return
    }
    this.setState(studyId, { stage: 'saving' })
    try {
      await service.stop({ instanceId: service.instanceId, runId: record.id })
    } catch (error) {
      this.fail(studyId, 'save:stop-rejected', 'stop-rejected', error)
      return
    }
    // The service reported a failed seal to the Output channel itself.
    if (record.nodeHistoryStatus === 'failed') {
      this.setState(studyId, {
        stage: 'seal-failed',
        cause: record.nodeHistoryFailure ?? 'unknown cause',
      })
      return
    }
    // A stop before the first entry sealed a history that holds nothing to save or open.
    if (recordedNothing(record)) {
      this.states.delete(studyId)
      throw new Error(NOTHING_RECORDED)
    }
    await this.readSaved(record, studyId)
  }

  /**
   * Reads the sealed history's summary and decides saved or partially saved; the last stage of a Save, and the whole of a Retry after a failed read.
   * @param record - The node-test run, whose result words the notification.
   * @param studyId - Its study id.
   * @example await this.readSaved(record, studyId)
   */
  private async readSaved(record: StudyRecord, studyId: string): Promise<void> {
    let summary: Awaited<ReturnType<NodeTestHistoryStore['summarize']>>
    try {
      summary = await this.host.store()?.summarize(studyId)
      if (!summary || summary.verification !== 'verified')
        throw new Error(
          summary?.reason ?? 'The sealed test history is not in the store.',
        )
    } catch (error) {
      this.fail(studyId, 'save:read-failed', 'read-failed', error)
      return
    }
    const missing: NodeLearningPart[] = [
      ...summary.learningMissing,
      ...summary.captureMissing,
    ]
    // Saved needs nothing missing and a passing test.
    if (!missing.length && summary.testResult === 'passed') {
      this.setState(studyId, {
        stage: 'saved',
        verdict: summary.verdict,
        stops: summary.stopCount,
        materialRevision: summary.materialRevision,
      })
      return
    }
    this.setState(studyId, {
      stage: 'partial',
      verdict: summary.verdict,
      missing,
      materialRevision: summary.materialRevision,
    })
    const notice = describeNodeLearningSave({
      kind: 'partial-notice',
      result: record.nodeResult,
      explanations: summary.learningMissing,
      capture: summary.captureMissing,
    })
    offerOpenReplay(this.host, 'warning', notice, studyId, (error) => {
      // A rejected notification or open is reported to the Output channel, not dropped.
      this.logFailure(studyId, 'save:open-replay', error)
    })
  }

  /**
   * Ends a Save at a failed stage with its sanitized cause and reports it once to the Output channel.
   * @param studyId - The run's study id.
   * @param surface - The failed stage's name in the Output entry.
   * @param stage - The status item's failed stage.
   * @param error - What was thrown.
   * @example this.fail(studyId, 'save:read-failed', 'read-failed', error)
   */
  private fail(
    studyId: string,
    surface: string,
    stage: 'stop-rejected' | 'read-failed',
    error: unknown,
  ): void {
    const cause = this.logFailure(studyId, surface, error)
    this.setState(studyId, { stage, cause })
  }

  /**
   * Writes one Output entry for a failure with its sanitized cause and stack; called by {@link fail} and by the rejected open of the partial notice.
   * @param studyId - The run's study id.
   * @param surface - The failed step's name in the entry.
   * @param error - What was thrown.
   * @returns The sanitized cause.
   * @example this.logFailure(studyId, 'save:open-replay', error)
   */
  private logFailure(studyId: string, surface: string, error: unknown): string {
    const roots = this.host.service()?.causeRoots ?? { storage: [] }
    const cause = sanitizeCause(error, roots)
    const stack = sanitizedStack(error, roots)
    this.host.log({
      surface,
      studyId,
      profile: NODE_TEST_PROFILE,
      cause,
      ...(stack ? { stack } : {}),
    })
    return cause
  }

  /**
   * Gives a run's Save state while it still holds: a saved or partially saved state only for the material revision it read.
   * @param studyId - The run's study id.
   * @param record - The run, whose cache names its material revision.
   * @returns The state, or `undefined` for none and for a receipt of an earlier revision.
   * @example this.currentState(studyId, record)
   */
  private currentState(
    studyId: string,
    record: StudyRecord,
  ): SaveState | undefined {
    const state = this.states.get(studyId)
    // A rejected stop that a later codebook_stop (or any other change) settled no longer describes the run.
    if (state?.stage === 'stop-rejected' && record.stopped) return undefined
    if (state?.stage !== 'saved' && state?.stage !== 'partial') return state
    // The store's revision (the summary projection the library lists) counts, not this window's cache: material another window saved moves the store only.
    const revision =
      this.host.materialRevision(studyId) ??
      record.nodeLearning?.materialRevision ??
      record.nodeLearningMaterial?.revision ??
      0
    // Only a greater revision is a later one: the catalog lags the store by up to a refresh, so an older listed revision does not undo a receipt read from the store.
    return revision > state.materialRevision ? undefined : state
  }

  /**
   * Records a Save's new state and asks for the item to be drawn again.
   * @param studyId - The run's study id.
   * @param state - The new state.
   * @example this.setState(studyId, { stage: 'saving' })
   */
  private setState(studyId: string, state: SaveState): void {
    this.states.set(studyId, state)
    this.host.changed()
  }

  /**
   * Words a Save state for the status item with the command its click runs.
   * @param studyId - The run's study id, the command's argument.
   * @param state - The Save state.
   * @returns The status item.
   * @example this.itemOfState(studyId, { stage: 'saving' }).command // => undefined
   */
  private itemOfState(studyId: string, state: SaveState): NodeLearningSaveItem {
    switch (state.stage) {
      case 'saving':
        return this.itemOf(describeNodeLearningSave({ kind: 'saving' }))
      case 'saved':
        return this.itemOf(
          describeNodeLearningSave({
            kind: 'saved',
            verdict: state.verdict,
            stops: state.stops,
          }),
          {
            title: NODE_LEARNING_SAVE_ACTION.openReplay,
            command: OPEN_LEARNING_REPLAY_COMMAND,
            arguments: [studyId],
          },
        )
      case 'partial':
        return this.itemOf(
          describeNodeLearningSave({
            kind: 'partial',
            verdict: state.verdict,
            missing: state.missing,
          }),
          {
            title: NODE_LEARNING_SAVE_ACTION.openReplay,
            command: OPEN_LEARNING_REPLAY_COMMAND,
            arguments: [studyId],
          },
        )
      case 'seal-failed':
        return this.itemOf(
          describeNodeLearningSave({ kind: 'seal-failed', cause: state.cause }),
          {
            title: 'Open retained history',
            command: OPEN_LEARNING_REPLAY_COMMAND,
            arguments: [studyId],
          },
        )
      case 'stop-rejected':
      case 'read-failed':
        return this.itemOf(
          describeNodeLearningSave({ kind: state.stage, cause: state.cause }),
          {
            title: 'Retry',
            command: SAVE_LEARNING_REPLAY_COMMAND,
            arguments: [studyId],
          },
        )
    }
  }

  /**
   * Builds a status item from the catalog's words and an optional command.
   * @param words - The catalog's text and tooltip.
   * @param command - What a click runs; none while preparing or saving.
   * @returns The status item.
   * @example this.itemOf(describeNodeLearningSave({ kind: 'preparing' }))
   */
  private itemOf(
    words: ReturnType<typeof describeNodeLearningSave>,
    command?: NodeLearningSaveItem['command'],
  ): NodeLearningSaveItem {
    return {
      text: words.text,
      tooltip: words.tooltip ?? '',
      ...(command ? { command } : {}),
    }
  }
}

/**
 * Says whether a test run recorded nothing a Save could keep or Open replay could show: a run refused before its history began, one stopped before it began (no history writer, as a stop during preparation leaves it), or one whose history sealed with no entry, which opens as no replay; read by {@link NodeLearningSave.item} and {@link NodeLearningSave.save}.
 * @param record - The node-test run.
 * @returns `true` when there is nothing to save or open.
 * @example recordedNothing(record) // => true for a run stopped during its preparation
 */
function recordedNothing(record: StudyRecord): boolean {
  return (
    Boolean(record.historyExcluded) ||
    !record.nodeHistoryWriter ||
    // The seal sets the count; a sealed history without an entry has nothing to replay.
    record.nodeHistoryEntryCount === 0
  )
}

/**
 * Says whether a test run has not reached its first stop and is not stopped: its journal holds only preparation output, so a Save has nothing to keep and would only end the run; read by {@link NodeLearningSave.item} and {@link NodeLearningSave.save}.
 * @param record - The node-test run.
 * @returns `true` before the first stop of a run that is not stopped.
 * @example beforeFirstStop(record) // => true for a run that still launches Vitest
 */
function beforeFirstStop(record: StudyRecord): boolean {
  return (
    !record.stopped &&
    (record.nodeStops?.length ?? 0) === 0 &&
    !endedBeforeFirstStop(record)
  )
}

/**
 * Says whether a test run ended without reaching its first stop and is not stopped yet: its continuation failed, its stop was rejected or it was refused at preparation. It will never reach a stop, so "Nothing to save yet" would name no way forward; its Save is answered as a run that recorded nothing (or stops it without asking, where it can still be released); read by {@link beforeFirstStop} and {@link NodeLearningSave.item}.
 * @param record - The node-test run.
 * @returns `true` for a run that ended before its first stop.
 * @example endedBeforeFirstStop(record) // => true for a run whose continuation failed while it prepared
 */
function endedBeforeFirstStop(record: StudyRecord): boolean {
  return (
    !record.stopped &&
    (record.nodeStops?.length ?? 0) === 0 &&
    (record.nodePhase === 'failed' ||
      Boolean(record.cleanupError) ||
      Boolean(record.historyExcluded))
  )
}

/**
 * Says whether a Save asks before it ends a test run: only while Codebook can still continue the run to its result, as the question's "before its result" says. A run whose earlier stop was rejected (its release began and failed: `cleanupError`) or whose continuation failed or passed its deadline (`nodePhase` failed) can no longer reach its result, so its Save stops it without asking; read by {@link NodeLearningSave.saveOnce}.
 * @param record - The node-test run.
 * @returns `true` when the Save asks first.
 * @example asksBeforeEnding(record) // => false for a run whose earlier stop was rejected
 */
function asksBeforeEnding(record: StudyRecord): boolean {
  return (
    !record.stopped &&
    !record.cleanupError &&
    record.nodePhase !== 'completed' &&
    record.nodePhase !== 'failed'
  )
}

/**
 * Counts the stops a test run declared: the first stop and its additional stops.
 * @param record - The node-test run.
 * @returns The declared stop count; the stops reached when the configuration is not prepared yet.
 * @example declaredStops(record) // => 2
 */
function declaredStops(record: StudyRecord): number {
  return record.nodePrepared
    ? 1 + (record.nodePrepared.configuration.additionalStops?.length ?? 0)
    : (record.nodeStops?.length ?? 0)
}
