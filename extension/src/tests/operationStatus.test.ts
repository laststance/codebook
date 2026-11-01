import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { OperationRecord } from '../runtime'
import { describeOperationStatus } from '../utils/describeOperationStatus'

/**
 * Builds the four operation records of a create-invoice flow with the given states.
 * @param states - One state per operation.
 * @returns The records, acknowledged and checked as the states imply.
 * @example recordsIn(['done', 'sending', 'not-run', 'not-run'])[1]?.title // => 'Amount'
 */
function recordsIn(states: OperationRecord['state'][]): OperationRecord[] {
  const titles = ['Customer', 'Amount', 'Pending', 'Create Invoice']
  const kinds = ['choose', 'text', 'click', 'click'] as const
  return states.map((state, position) => ({
    index: position + 1,
    kind: kinds[position]!,
    title: titles[position]!,
    state,
    ack: state === 'done' ? 'yes' : 'pending',
    valueCheck: state === 'done' ? 'passed' : 'pending',
    effect: state === 'done' ? 'dispatched' : 'pending',
  }))
}

// protects=the status item names the operation in flight, its title and that it is sending; fails_when=the text is a bare 2/4 or omits the title; no_claim=the status bar item that shows it (workspace tests)
test('an operation being sent reads Operation 2/4 with its title and sending', () => {
  // Arrange
  const records = recordsIn(['done', 'sending', 'not-run', 'not-run'])
  // Act
  const status = describeOperationStatus(records, 'acting', undefined)
  // Assert
  assert.equal(status, 'Operation 2/4 · Amount · sending')
})

// protects=a pause inside an operation's code reads paused in code; fails_when=a paused operation reads sending; no_claim=the debugger
test('an operation whose stop is paused reads paused in code', () => {
  // Arrange
  const records = recordsIn(['done', 'done', 'paused', 'not-run'])
  // Act
  const status = describeOperationStatus(records, 'paused-browser', undefined)
  // Assert
  assert.equal(status, 'Operation 3/4 · Pending · paused in code')
})

// protects=all four inputs sent is not success: it reads sent and checking the result; fails_when=a run with the last operation acknowledged reads Done or a bare 4/4; no_claim=the page's result
test('once the last operation was acknowledged and checked the status reads 4/4 sent and checking result, never Done', () => {
  // Arrange
  const records = recordsIn(['done', 'done', 'done', 'sending'])
  records[3]!.ack = 'yes'
  records[3]!.valueCheck = 'n/a'
  // Act
  const status = describeOperationStatus(records, 'resuming', undefined)
  // Assert
  assert.equal(status, '4/4 sent · checking result')
})

// protects=only a run whose every operation is done reads Done with the operation count; fails_when=a completed run reads anything else, or a single operation reads "1 operations"; no_claim=the result's verification (run tests)
test('a finished run reads Done with its operation count', () => {
  // Arrange
  const four = recordsIn(['done', 'done', 'done', 'done'])
  const one = recordsIn(['done']).slice(0, 1)
  // Act
  const fourStatus = describeOperationStatus(four, 'completed', undefined)
  const oneStatus = describeOperationStatus(one, 'completed', undefined)
  // Assert
  assert.equal(fourStatus, 'Done · 4 operations')
  assert.equal(oneStatus, 'Done · 1 operation')
})

// protects=a failed run names the operation it stopped at and a short reason, and a stopped run without a failure says stopped; fails_when=the failing operation or the reason is missing, or an unknown code leaks its raw name; no_claim=the failure itself (run tests)
test('a failed run reads Stopped at the failing operation with a short reason, and an unknown code reads run failed', () => {
  // Arrange
  const records = recordsIn(['done', 'done', 'failed', 'not-run'])
  // Act
  const afterNotMet = describeOperationStatus(records, 'failed', {
    code: 'OPERATION_AFTER_NOT_MET',
    operationIndex: 3,
  })
  const unknownCode = describeOperationStatus(records, 'failed', {
    code: 'SOMETHING_NEW',
    operationIndex: 3,
  })
  const stoppedByLearner = describeOperationStatus(
    recordsIn(['done', 'done', 'not-run', 'not-run']),
    'stopped',
    undefined,
  )
  // Assert
  assert.equal(afterNotMet, 'Stopped at operation 3 · result not confirmed')
  assert.equal(unknownCode, 'Stopped at operation 3 · run failed')
  assert.equal(stoppedByLearner, 'Stopped at operation 3 · stopped')
})

// protects=a run of versions 1 and 2, and a version 3 run between two operations, show no operation text; fails_when=a stale or empty text appears; no_claim=nothing else
test('a run without operations and a run between two operations show no operation text', () => {
  // Arrange
  const between = recordsIn(['done', 'not-run', 'not-run', 'not-run'])
  // Act
  const noOperations = describeOperationStatus(undefined, 'ready', undefined)
  const betweenStatus = describeOperationStatus(between, 'ready', undefined)
  // Assert
  assert.equal(noOperations, undefined)
  assert.equal(betweenStatus, undefined)
})

// protects=a run whose final save failed after every operation was done reads Stopped at the last operation, never Done; fails_when=the all-done check runs before the failed-run check; no_claim=the save itself (service tests)
test('a failed run whose operations are all done reads Stopped at the last operation, not Done', () => {
  // Arrange
  const records = recordsIn(['done', 'done', 'done', 'done'])
  // Act
  const status = describeOperationStatus(records, 'failed', {
    code: 'RUN_FAILED_UNEXPECTEDLY',
    operationIndex: 4,
  })
  const withoutFailureRecord = describeOperationStatus(
    records,
    'failed',
    undefined,
  )
  // Assert
  assert.equal(status, 'Stopped at operation 4 · failed unexpectedly')
  assert.equal(withoutFailureRecord, 'Stopped at operation 4 · stopped')
})
