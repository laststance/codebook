import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  projectNodeTestOutcome,
  type NodeTestHistoryState,
  type NodeTestOutcome,
  type NodeTestOutcomeInput,
} from '../utils/projectNodeTestOutcome'

/** The four results a combination can carry: none yet, a pass, a failing exit and a signal. */
const RESULTS: NodeTestOutcomeInput['result'][] = [
  undefined,
  { exitCode: 0, signal: null },
  { exitCode: 1, signal: null },
  { exitCode: null, signal: 'SIGTERM' },
]
const HISTORIES: NodeTestHistoryState[] = [
  'none',
  'recording',
  'complete',
  'partial',
  'failed',
]

/** Whether a combination's run failed: an error of its own, a non-zero exit or a signal (plan version 7, Design 1). */
function ranAndFailed(input: NodeTestOutcomeInput): boolean {
  return (
    input.hasError ||
    (input.result !== undefined &&
      (input.result.signal !== null || input.result.exitCode !== 0))
  )
}

/** Whether a combination's test completed and passed. */
function ranAndPassed(input: NodeTestOutcomeInput): boolean {
  return (
    !ranAndFailed(input) &&
    input.completed &&
    input.result?.exitCode === 0 &&
    input.result.signal === null
  )
}

const sealed = (input: NodeTestOutcomeInput): boolean =>
  input.history === 'complete' || input.history === 'partial'

/** Builds an expected outcome row. */
function expected(
  finalOutcome: NodeTestOutcome['finalOutcome'],
  recordingStatus: NodeTestOutcome['recordingStatus'],
  studyOutcome: NodeTestOutcome['studyOutcome'],
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

/** Design 1's table, written as predicates over the facts, with the passing run sealed partial added so the table is total. */
const ROWS: {
  name: string
  holds: (input: NodeTestOutcomeInput) => boolean
  outcome: NodeTestOutcome
}[] = [
  {
    name: 'preparing; no history yet',
    holds: (input) =>
      input.history === 'none' && !ranAndFailed(input) && !input.stopped,
    outcome: expected('pending', 'unavailable', 'pending', false),
  },
  {
    name: 'refused at preparation, or failed or stopped before its history existed',
    holds: (input) =>
      input.history === 'none' && (ranAndFailed(input) || input.stopped),
    outcome: expected(
      'not-demonstrated',
      'unavailable',
      'not-demonstrated',
      false,
    ),
  },
  {
    name: 'not completed, no error, not stopped',
    holds: (input) =>
      input.history === 'recording' &&
      !ranAndFailed(input) &&
      !ranAndPassed(input),
    outcome: expected('pending', 'recording', 'pending', false),
  },
  {
    name: 'completed with exit 0, no signal, no error; not yet stopped',
    holds: (input) => input.history === 'recording' && ranAndPassed(input),
    outcome: expected('demonstrated', 'recording', 'pending', false),
  },
  {
    name: 'the same, stopped and sealed',
    holds: (input) =>
      input.history === 'complete' &&
      input.entryCount > 0 &&
      ranAndPassed(input),
    outcome: expected('demonstrated', 'finalized', 'demonstrated', true),
  },
  {
    name: 'stopped before the result, no error',
    holds: (input) =>
      sealed(input) &&
      input.entryCount > 0 &&
      !ranAndFailed(input) &&
      !ranAndPassed(input),
    outcome: expected('partial', 'partial', 'partial', true),
  },
  {
    name: 'a passing run whose history sealed partial',
    holds: (input) =>
      input.history === 'partial' &&
      input.entryCount > 0 &&
      ranAndPassed(input),
    outcome: expected('demonstrated', 'partial', 'partial', true),
  },
  {
    name: 'an error, a non-zero exit or a signal; not yet stopped',
    holds: (input) => input.history === 'recording' && ranAndFailed(input),
    outcome: expected(
      'not-demonstrated',
      'recording',
      'not-demonstrated',
      false,
    ),
  },
  {
    name: 'the same, stopped and sealed with at least one entry',
    holds: (input) =>
      sealed(input) && input.entryCount > 0 && ranAndFailed(input),
    outcome: expected('not-demonstrated', 'partial', 'not-demonstrated', true),
  },
  {
    name: 'sealed with no entry (the launch failed after the history began)',
    holds: (input) => sealed(input) && input.entryCount === 0,
    outcome: expected('not-demonstrated', 'partial', 'not-demonstrated', false),
  },
  {
    name: 'the seal failed after a passed test',
    holds: (input) => input.history === 'failed' && ranAndPassed(input),
    outcome: expected('demonstrated', 'failed', 'partial', false),
  },
  {
    name: 'the seal failed after a stop before the result',
    holds: (input) =>
      input.history === 'failed' &&
      !ranAndFailed(input) &&
      !ranAndPassed(input),
    outcome: expected('partial', 'failed', 'partial', false),
  },
  {
    name: 'the seal failed after an error, a non-zero exit or a signal',
    holds: (input) => input.history === 'failed' && ranAndFailed(input),
    outcome: expected('not-demonstrated', 'failed', 'not-demonstrated', false),
  },
]

/** Every combination of the outcome function's inputs: 5 history states × 2 entry counts × 2 completion facts × 4 results × 2 error facts × 2 stop facts. */
function everyCombination(): NodeTestOutcomeInput[] {
  const combinations: NodeTestOutcomeInput[] = []
  for (const history of HISTORIES)
    for (const entryCount of [0, 3])
      for (const completed of [false, true])
        for (const result of RESULTS)
          for (const hasError of [false, true])
            for (const stopped of [false, true])
              combinations.push({
                history,
                entryCount,
                completed,
                result,
                hasError,
                stopped,
              })
  return combinations
}

// Value: protects=every row of Design 1's outcome table for a test run, and that each input combination lands on exactly one row; fails_when=a row reads other outcomes than the table, two rows overlap, or a combination falls between rows; why_new=the run's outcomes were a three-way branch that stopped at partial (service.ts:2043-2053); seam=none; no_claim=how the service derives the facts from its record (service tests)
test('every combination of a test run’s facts lands on exactly one row of the outcome table, with that row’s outcomes', () => {
  // Arrange
  const combinations = everyCombination()

  for (const input of combinations) {
    // Act
    const outcome = projectNodeTestOutcome(input)

    // Assert
    const matching = ROWS.filter((candidate) => candidate.holds(input))
    assert.equal(
      matching.length,
      1,
      `${JSON.stringify(input)} matches ${matching.map((candidate) => candidate.name).join(', ') || 'no row'}`,
    )
    assert.deepEqual(outcome, matching[0]!.outcome, matching[0]!.name)
  }
  assert.equal(combinations.length, 320)
})

// Value: protects=that saved learning of a test run is claimed only for a passing test whose history sealed complete; fails_when=any other combination reads demonstrated in studyOutcome or recordedStudyOutcome; why_new=AC2's guard over the whole input space; seam=none; no_claim=the run resource's other fields
test('only a passing test whose history sealed complete reads demonstrated as a study', () => {
  // Arrange
  const combinations = everyCombination()

  // Act
  const demonstratedStudies = combinations.filter((input) => {
    const outcome = projectNodeTestOutcome(input)
    return (
      outcome.studyOutcome === 'demonstrated' ||
      outcome.recordedStudyOutcome === 'demonstrated'
    )
  })

  // Assert
  assert.ok(demonstratedStudies.length > 0)
  for (const input of demonstratedStudies) {
    assert.equal(input.history, 'complete')
    assert.ok(input.entryCount > 0)
    assert.ok(ranAndPassed(input), JSON.stringify(input))
  }
})
