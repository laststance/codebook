import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isWikiUpdateTimeout } from '../utils/isWikiUpdateTimeout'

test('the error a Cursor Wiki update rejects with at its bound is a timeout', () => {
  // Arrange
  const atTheBound = Object.assign(
    new Error('Cursor Agent timed out updating the Wiki.'),
    { name: 'WikiUpdateTimedOut' },
  )

  // Act
  const isTimeout = isWikiUpdateTimeout(atTheBound)

  // Assert
  assert.equal(isTimeout, true)
})

test('a cancel, a failed agent, a thrown text and no error at all are no timeout', () => {
  // Arrange
  const thrown: unknown[] = [
    new Error('The Wiki update was cancelled.'),
    new Error('Cursor Agent stopped with exit code 1 before finishing.'),
    'WikiUpdateTimedOut',
    null,
    undefined,
  ]

  // Act
  const answers = thrown.map((agentError) => isWikiUpdateTimeout(agentError))

  // Assert
  assert.deepEqual(answers, [false, false, false, false, false])
})
