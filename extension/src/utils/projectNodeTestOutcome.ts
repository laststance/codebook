import {
  nodeTestResultKind,
  type NodeTestResultFacts,
} from './nodeTestResultKind'

/** Where a test run's history stands: none before it exists, recording, sealed complete or partial, or a seal that failed. */
export type NodeTestHistoryState =
  'none' | 'recording' | 'complete' | 'partial' | 'failed'

/** The facts of a test run that decide its outcomes, read from the run record by {@link StudyService.state}. */
export type NodeTestOutcomeInput = {
  history: NodeTestHistoryState
  /** How many entries the history's journal holds; a sealed history without one has nothing to replay. */
  entryCount: number
  /** Whether the run's last continuation finished the test (`nodePhase` `completed`). */
  completed: boolean
  /** The result's process facts; `undefined` without a result. */
  result: NodeTestResultFacts | undefined
  /** Whether the run has an error of its own. */
  hasError: boolean
  /** Whether the run was stopped. */
  stopped: boolean
}

/** One of the run's four outcomes. */
type Outcome = 'pending' | 'demonstrated' | 'partial' | 'not-demonstrated'

/** What a test run's outcomes read in the run resource. */
export type NodeTestOutcome = {
  finalOutcome: Outcome
  recordingStatus:
    'unavailable' | 'recording' | 'finalized' | 'partial' | 'failed'
  studyOutcome: Outcome
  recordedStudyOutcome: Outcome
  /** `recordingAvailable` and `replayAvailable`: the learner can open the history as a test replay. */
  replayAvailable: boolean
}

/**
 * Builds the outcome of one row, with the same study and recorded study outcome, as most rows have.
 * @param finalOutcome - The run's runtime outcome.
 * @param recordingStatus - The history's recording status.
 * @param studyOutcome - The study outcome, also the recorded study outcome.
 * @param replayAvailable - Whether the history opens as a test replay.
 * @returns The row's outcome.
 * @example row('partial', 'partial', 'partial', true)
 */
function row(
  finalOutcome: Outcome,
  recordingStatus: NodeTestOutcome['recordingStatus'],
  studyOutcome: Outcome,
  replayAvailable: boolean,
): NodeTestOutcome {
  return {
    finalOutcome,
    recordingStatus,
    studyOutcome,
    recordedStudyOutcome: studyOutcome,
    replayAvailable,
  }
}

/**
 * Projects a test run's outcomes from its run and history facts, as the browser run reads them (D2): the runtime evidence decides `finalOutcome`, and a durable sealed history is what lets the study outcomes reach `demonstrated`; called by {@link StudyService.state} for every `node-test` record, each time the run resource is read.
 * The rows are Design 1's table of plan version 7 and every input combination lands on exactly one of them. A failing run (an error of its own, a non-zero exit or a signal) is `not-demonstrated`; a passing run is `demonstrated` once its test completed; a sealed history needs at least one entry to be opened as a test replay; only a passing run whose history sealed `complete` reads `demonstrated` as a study.
 * @param input - The run's facts ({@link NodeTestOutcomeInput}).
 * @returns The four outcomes and whether the replay is available.
 * @example
 * projectNodeTestOutcome({ history: 'complete', entryCount: 4, completed: true, result: { exitCode: 0, signal: null }, hasError: false, stopped: true })
 * // => { finalOutcome: 'demonstrated', recordingStatus: 'finalized', studyOutcome: 'demonstrated', recordedStudyOutcome: 'demonstrated', replayAvailable: true }
 * projectNodeTestOutcome({ history: 'none', entryCount: 0, completed: false, result: undefined, hasError: true, stopped: true })
 * // => { finalOutcome: 'not-demonstrated', recordingStatus: 'unavailable', studyOutcome: 'not-demonstrated', recordedStudyOutcome: 'not-demonstrated', replayAvailable: false }
 */
export function projectNodeTestOutcome(
  input: NodeTestOutcomeInput,
): NodeTestOutcome {
  const resultKind = nodeTestResultKind(input.result)
  const failed =
    input.hasError || resultKind === 'failed' || resultKind === 'signal'
  const passed = !failed && input.completed && resultKind === 'passed'
  const runtime: Outcome = failed
    ? 'not-demonstrated'
    : passed
      ? 'demonstrated'
      : 'pending'
  switch (input.history) {
    case 'none':
      // Refused at preparation, failed or stopped before its history existed: nothing was recorded.
      return failed || input.stopped
        ? row('not-demonstrated', 'unavailable', 'not-demonstrated', false)
        : row('pending', 'unavailable', 'pending', false)
    case 'recording':
      // The study outcomes wait for the seal unless the run already failed.
      return row(
        runtime,
        'recording',
        failed ? 'not-demonstrated' : 'pending',
        false,
      )
    case 'failed':
      // The seal threw: the run's evidence stands, but nothing durable vouches for a replay.
      return failed
        ? row('not-demonstrated', 'failed', 'not-demonstrated', false)
        : row(passed ? 'demonstrated' : 'partial', 'failed', 'partial', false)
    case 'complete':
    case 'partial':
      return sealedRow(input, failed, passed)
  }
}

/**
 * Projects the outcomes of a run whose history sealed, the last rows of {@link projectNodeTestOutcome}.
 * @param input - The run's facts; its history sealed `complete` or `partial`.
 * @param failed - Whether the run failed (an error, a non-zero exit or a signal).
 * @param passed - Whether the test completed and passed.
 * @returns The outcome of the sealed history's row.
 * @example sealedRow({ ...input, history: 'partial', entryCount: 3 }, false, false) // => the stopped-before-the-result row
 */
function sealedRow(
  input: NodeTestOutcomeInput,
  failed: boolean,
  passed: boolean,
): NodeTestOutcome {
  // A history that sealed with no entry began after the launch failed: there is nothing to open.
  if (!input.entryCount)
    return row('not-demonstrated', 'partial', 'not-demonstrated', false)
  if (failed)
    return row('not-demonstrated', 'partial', 'not-demonstrated', true)
  if (passed && input.history === 'complete')
    return row('demonstrated', 'finalized', 'demonstrated', true)
  // A passing run whose history sealed partial keeps its runtime evidence; the study lacks what the seal left out.
  return row(passed ? 'demonstrated' : 'partial', 'partial', 'partial', true)
}
