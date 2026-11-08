import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { withApiOutputTail } from '../utils/withApiOutputTail'

// Value: protects=a failed API operation shows what the API printed; fails_when=the tail is dropped or the other details are lost; no_claim=where the service calls it
test('an error with an API output tail keeps its details and gains apiOutputTail', () => {
  // Arrange
  const error = new StudyError(
    'RUNTIME_FAILED',
    'The request failed.',
    'cause words',
    'Retry once.',
    undefined,
    { operationIndex: 2 },
  )
  // Act
  const result = withApiOutputTail(error, 'listen EADDRINUSE\n')
  // Assert
  assert.deepEqual(
    {
      code: result.code,
      message: result.message,
      causeDetail: result.causeDetail,
      recoveryOverride: result.recoveryOverride,
      details: result.details,
    },
    {
      code: 'RUNTIME_FAILED',
      message: 'The request failed.',
      causeDetail: 'cause words',
      recoveryOverride: 'Retry once.',
      details: { operationIndex: 2, apiOutputTail: 'listen EADDRINUSE\n' },
    },
  )
})

// Value: protects=an error without details still carries the tail and keeps its cause; fails_when=the cause is lost or details stay undefined; no_claim=message sanitizing
test('an error without details gains apiOutputTail and keeps its cause', () => {
  // Arrange
  const cause = new Error('socket hang up')
  const error = new StudyError(
    'RUNTIME_FAILED',
    'The request failed.',
    undefined,
    undefined,
    cause,
  )
  // Act
  const result = withApiOutputTail(error, 'boom')
  // Assert
  assert.deepEqual(
    { details: result.details, sameCause: result.cause === cause },
    { details: { apiOutputTail: 'boom' }, sameCause: true },
  )
})

// Value: protects=a silent API adds no apiOutputTail field; fails_when=an empty or missing tail adds an empty field; no_claim=none
test('an empty or missing tail leaves the error unchanged', () => {
  // Arrange
  const error = new StudyError('RUNTIME_FAILED', 'The request failed.')
  // Act
  const results = [
    withApiOutputTail(error, ''),
    withApiOutputTail(error, undefined),
  ]
  // Assert
  assert.deepEqual(
    results.map((result) => ({
      same: result === error,
      details: result.details,
    })),
    [
      { same: true, details: undefined },
      { same: true, details: undefined },
    ],
  )
})
