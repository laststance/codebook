import { NODE_TEST_PROFILE } from './constants'
import type { NodeTestHistoryStore } from './nodeTestHistoryStore'
import type { StudyRecord, StudyService } from './service'
import {
  describeNodeLearningSave,
  type NodeLearningSaveMessage,
} from './utils/describeNodeLearningSave'
import type { NodeTestVerdict } from './utils/describeNodeTestResult'
import type { CodebookDiagnostic } from './utils/formatCodebookDiagnostic'
import type { NodeLearningPart } from './utils/listMissingNodeLearning'
import { sanitizeCause } from './utils/sanitizeCause'
import { sanitizedStack } from './utils/sanitizedStack'

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
    severity: 'warning' | 'error',
    text: string,
    actions: readonly string[],
  ) => Promise<string | undefined>
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

/** The command a status item click runs to save a test run's learning replay. */
const SAVE_COMMAND = 'codebook.saveLearningReplay'
/** The command a status item click runs to open a test replay. */
const OPEN_COMMAND = 'codebook.openLearningReplay'

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
  private operation?: { studyId: string; promise: Promise<void> }

  constructor(private readonly host: NodeLearningSaveHost) {}

  /**
   * Gives what the status item shows for a test run: preparing before its first stop, the stops reached while it runs, finished after Stop, then the state of its Save; called by the Study workspace each time it publishes.
   * A saved or partially saved state counts for the material revision it read: a later revision returns the item to Save (a Save receipt never vouches for a later revision).
   * @param record - A node-test run of the service.
   * @returns The item's text, tooltip and command; `undefined` for a run that recorded nothing (refused before its history).
   * @example save.item(record)?.text // => '$(record) Recording explanation · stop 1 of 2 · Save learning replay'
   */
  item(record: StudyRecord): NodeLearningSaveItem | undefined {
    const service = this.host.service()
    if (!service || record.profile !== NODE_TEST_PROFILE) return undefined
    // A run refused before its history began has nothing to save.
    if (record.historyExcluded) return undefined
    const studyId = `${service.instanceId}_${record.id}`
    const state = this.currentState(studyId, record)
    if (state) return this.itemOfState(studyId, state)
    if (record.nodeHistoryStatus === 'failed')
      return this.itemOfState(studyId, {
        stage: 'seal-failed',
        cause: record.nodeHistoryFailure ?? 'unknown cause',
      })
    const reached = record.nodeStops?.length ?? 0
    // Before the first stop the journal has nothing to save.
    if (!record.stopped && reached === 0)
      return this.itemOf(describeNodeLearningSave({ kind: 'preparing' }))
    const message: NodeLearningSaveMessage = record.stopped
      ? { kind: 'finished' }
      : { kind: 'live', reached, declared: declaredStops(record) }
    return this.itemOf(describeNodeLearningSave(message), {
      title: 'Save learning replay',
      command: SAVE_COMMAND,
      arguments: [studyId],
    })
  }

  /**
   * Saves a test run's learning replay for the status item's Save and the Retry of a failed stage; the command `codebook.saveLearningReplay` calls it through the Study workspace for a node-test run.
   * @param record - The node-test run the item shows.
   * @returns Once the Save ended in a state the item shows; a click while a Save runs returns that Save.
   * @throws When another run's learning is being saved.
   * @example await save.save(record)
   */
  save(record: StudyRecord): Promise<void> {
    const service = this.host.service()
    if (!service) return Promise.resolve()
    const studyId = `${service.instanceId}_${record.id}`
    if (this.operation) {
      if (this.operation.studyId !== studyId)
        throw new Error(
          'Another learning session is being saved. Wait for its result.',
        )
      return this.operation.promise
    }
    const promise = this.saveOnce(service, record, studyId).finally(() => {
      if (this.operation?.promise === promise) this.operation = undefined
      this.host.changed()
    })
    this.operation = { studyId, promise }
    return promise
  }

  /**
   * Runs one Save: the question before the result, the stop with its seal, then the read of the sealed history's summary.
   * @param service - The service that stops the run.
   * @param record - The node-test run.
   * @param studyId - Its study id.
   * @example await this.saveOnce(service, record, studyId)
   */
  private async saveOnce(
    service: NonNullable<ReturnType<NodeLearningSaveHost['service']>>,
    record: StudyRecord,
    studyId: string,
  ): Promise<void> {
    // Before the result, Save ends the test run: the learner confirms it.
    if (!record.stopped && record.nodePhase !== 'completed') {
      const question = describeNodeLearningSave({
        kind: 'question',
        reached: record.nodeStops?.length ?? 0,
        declared: declaredStops(record),
      })
      const answer = await this.host.ask(question.text, ['Save now'])
      if (answer !== 'Save now') return
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
    void this.host
      .notify('warning', notice.text, notice.actions ?? [])
      .then((action) => {
        if (action === 'Open replay') return this.host.open(studyId)
      })
      .catch(() => undefined)
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
    this.setState(studyId, { stage, cause })
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
    if (state?.stage !== 'saved' && state?.stage !== 'partial') return state
    const revision =
      record.nodeLearning?.materialRevision ??
      record.nodeLearningMaterial?.revision ??
      0
    return state.materialRevision === revision ? state : undefined
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
          { title: 'Open replay', command: OPEN_COMMAND, arguments: [studyId] },
        )
      case 'partial':
        return this.itemOf(
          describeNodeLearningSave({
            kind: 'partial',
            verdict: state.verdict,
            missing: state.missing,
          }),
          { title: 'Open replay', command: OPEN_COMMAND, arguments: [studyId] },
        )
      case 'seal-failed':
        return this.itemOf(
          describeNodeLearningSave({ kind: 'seal-failed', cause: state.cause }),
          {
            title: 'Open retained history',
            command: OPEN_COMMAND,
            arguments: [studyId],
          },
        )
      case 'stop-rejected':
      case 'read-failed':
        return this.itemOf(
          describeNodeLearningSave({ kind: state.stage, cause: state.cause }),
          { title: 'Retry', command: SAVE_COMMAND, arguments: [studyId] },
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
