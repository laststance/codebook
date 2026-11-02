import type {
  ConfiguredOperationRecord,
  ConfiguredStudy,
} from '../configuredStudySchemas'
import {
  OPERATIONS_CONFIG_VERSION,
  SERVER_RENDER_STUDY_VERSION,
} from '../constants'

import { afterOperationOf } from './afterOperationOf'
import { configuredStops } from './configuredStops'
import { stopOfObservation } from './stopOfObservation'

type StudyWithoutImages = Omit<ConfiguredStudy, 'captures'>

/**
 * Checks that the records are the declared operations, in order, with their declared kind and title.
 * @param records - The study's operation records.
 * @param declared - The sealed version 3 configuration's operations.
 * @throws When the count, an index, a kind or a title differs.
 * @example assertRecordsMatchDeclaration(records, configuration.operations)
 */
function assertRecordsMatchDeclaration(
  records: readonly ConfiguredOperationRecord[],
  declared: readonly { kind: string; title: string }[],
): void {
  if (records.length !== declared.length)
    throw new Error('Configured operations differ from the declared ones.')
  for (const [position, record] of records.entries()) {
    const operation = declared[position]!
    if (
      record.index !== position + 1 ||
      record.kind !== operation.kind ||
      record.title !== operation.title
    )
      throw new Error('Configured operation records changed their declaration.')
  }
}

/**
 * Checks that operations ran one after the other: done ones first, at most one in flight or failed, then the ones not run.
 * @param records - The study's operation records.
 * @throws When an operation progressed although an earlier one did not finish.
 * @example assertRanSequentially(records)
 */
function assertRanSequentially(
  records: readonly ConfiguredOperationRecord[],
): void {
  let hasUnfinished = false
  for (const record of records) {
    if (hasUnfinished && record.state !== 'not-run')
      throw new Error(
        `Operation ${record.index} progressed although an earlier operation did not finish.`,
      )
    if (record.state !== 'done') hasUnfinished = true
  }
}

/**
 * Checks the sent times: a not-run operation has none, a paused or done one has one, and the times never decrease.
 * @param records - The study's operation records.
 * @throws When a time is missing, present without a send, or out of order.
 * @example assertSentTimes(records)
 */
function assertSentTimes(records: readonly ConfiguredOperationRecord[]): void {
  let previousAtMs = -1
  for (const record of records) {
    const needsTime = record.state === 'paused' || record.state === 'done'
    if (record.state === 'not-run' && record.atMs !== undefined)
      throw new Error(`Operation ${record.index} has a time but was not run.`)
    if (needsTime && record.atMs === undefined)
      throw new Error(`Operation ${record.index} progressed without a time.`)
    if (record.state === 'done' && record.effect === 'pending')
      throw new Error(`Operation ${record.index} is done without an effect.`)
    if (record.atMs === undefined) continue
    if (record.atMs < previousAtMs)
      throw new Error('Configured operation times are out of order.')
    previousAtMs = record.atMs
  }
}

/**
 * Says whether every stop declared up to an operation was reached and its pause continued.
 * Format 7 reads it by position (the stops pause in declared order); format 8 by `declaredIndex`, because a set of server renders pauses in the order the page runs.
 * @param study - The saved study.
 * @param stops - The declared stops.
 * @param operationIndex - The 1-based operation reported done.
 * @returns `true` when no stop is declared up to the operation or each one was observed at or before the continued pause.
 * @example areStopsContinuedUpTo(study, stops, 2) // => true
 */
function areStopsContinuedUpTo(
  study: StudyWithoutImages,
  stops: ReturnType<typeof configuredStops>,
  operationIndex: number,
): boolean {
  const continuedPosition = study.observations.findIndex(
    (observation) =>
      JSON.stringify(observation.pause) ===
      JSON.stringify(study.operation?.continuedPause),
  )
  const required = stops.flatMap((stop, declared) =>
    (afterOperationOf(stop) ?? 1) <= operationIndex ? [declared] : [],
  )
  return required.every((declared) => {
    const position = study.observations.findIndex(
      (observation, index) => (observation.declaredIndex ?? index) === declared,
    )
    return position >= 0 && continuedPosition >= position
  })
}

/**
 * Checks that one pause comes after the input of the operation its stop follows; a format 8 entry-render stop (`afterOperation: 0`) pauses the page load instead, so it must come before operation mark 1.
 * @param observation - The pause.
 * @param afterOperation - The operation its stop follows, 0 for an entry-render stop.
 * @param records - The study's operation records.
 * @param isFormat8 - Whether the study is of format 8, the only format that has entry-render stops.
 * @throws When the pause is on the wrong side of its operation's input.
 * @example assertPauseTime(observation, 2, records, true)
 */
function assertPauseTime(
  observation: StudyWithoutImages['observations'][number],
  afterOperation: number,
  records: readonly ConfiguredOperationRecord[],
  isFormat8: boolean,
): void {
  if (isFormat8 && afterOperation === 0) {
    const firstSentMs = records[0]?.atMs
    if (firstSentMs !== undefined && observation.elapsedMs > firstSentMs)
      throw new Error(
        'Configured entry-render observation comes after the first operation.',
      )
    return
  }
  const record = records[afterOperation - 1]
  if (record?.atMs === undefined || observation.elapsedMs < record.atMs)
    throw new Error(
      'Configured observation precedes the input of its operation.',
    )
}

/**
 * Checks that every pause belongs to an operation already sent, and that every operation reported done had each stop declared up to it reached and continued.
 * @param study - The saved study.
 * @param records - Its operation records.
 * @throws When a pause precedes its operation's input or a done operation's stops were not continued.
 * @example assertPausesFollowOperations(study, records)
 */
function assertPausesFollowOperations(
  study: StudyWithoutImages,
  records: readonly ConfiguredOperationRecord[],
): void {
  const stops = configuredStops(study.configuration)
  const isFormat8 = study.version === SERVER_RENDER_STUDY_VERSION
  // A pause belongs to the operation its stop follows, and cannot come before that operation's input.
  for (const [position, observation] of study.observations.entries()) {
    const stop = stopOfObservation(study.observations, stops, position)!
    assertPauseTime(
      observation,
      afterOperationOf(stop) ?? 1,
      records,
      isFormat8,
    )
  }
  for (const record of records) {
    if (record.state !== 'done') continue
    if (!areStopsContinuedUpTo(study, stops, record.index))
      throw new Error(
        `Operation ${record.index} is done without its declared pauses continued.`,
      )
  }
}

/**
 * Checks the study's operation records against its sealed configuration and its captured pauses, so a replay can trust every mark it draws.
 * Called by {@link validateConfiguredStudyEvidence} for every configured study; a study of versions 1 and 2 must carry no records.
 *
 * The rules: the records are the declared operations in order; operations ran one after the other; the input time exists for a sent operation and never decreases; a stop's pause follows its operation's input; an operation reported done had every stop declared up to it continued; a demonstrated run, or a verified result, has every operation done.
 *
 * @param study - The saved study, without its images.
 * @throws When the records disagree with the configuration, the order of the run, the pauses or the outcome.
 * @example validateOperationRecords(study) // throws 'Operation 2 progressed although an earlier operation did not finish.'
 */
export function validateOperationRecords(study: StudyWithoutImages): void {
  const configuration = study.configuration
  const records = study.operations
  if (configuration.version !== OPERATIONS_CONFIG_VERSION) {
    if (records) throw new Error('Only a version 3 study keeps operations.')
    return
  }
  // A run that never prepared its page has no records yet, and then nothing else of the run either.
  if (!records) {
    // Format 8 may hold entry-render pauses (`afterOperation: 0`) before any operation record exists; nothing else may.
    const stops = configuredStops(configuration)
    const onlyEntryRender =
      study.version === SERVER_RENDER_STUDY_VERSION &&
      !study.operation &&
      study.observations.every(
        (_, position) =>
          afterOperationOf(
            stopOfObservation(study.observations, stops, position) ?? {},
          ) === 0,
      )
    if (!onlyEntryRender && (study.operation || study.observations.length))
      throw new Error('Configured operations are missing from a started run.')
    return
  }
  // Read as possibly absent: a saved-session run of entry-render stops only may omit `operations`.
  const declaredOperations:
    readonly { kind: string; title: string }[] | undefined =
    configuration.operations
  assertRecordsMatchDeclaration(records, declaredOperations ?? [])
  assertRanSequentially(records)
  assertSentTimes(records)
  assertPausesFollowOperations(study, records)
  const allDone = records.every((record) => record.state === 'done')
  const claimsResult =
    study.operation?.afterVerified || study.finalOutcome === 'demonstrated'
  if (claimsResult && !(allDone && records.at(-1)!.effect === 'after-verified'))
    throw new Error('Configured result is verified before every operation.')
}
