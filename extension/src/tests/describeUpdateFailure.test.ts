import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import { describeUpdateFailure } from '../utils/describeUpdateFailure'

test('an update failure from this realm shows its message without an Error prefix', () => {
  // Arrange
  const failure = new Error('Cursor Agent exited with code 1.')

  // Act
  const text = describeUpdateFailure(failure)

  // Assert
  assert.equal(text, 'Cursor Agent exited with code 1.')
})

test('an update failure raised in another realm still shows its message without an Error prefix', () => {
  // Arrange
  const failure: unknown = runInNewContext("new Error('Chat is unavailable')")

  // Act
  const text = describeUpdateFailure(failure)

  // Assert
  assert.equal(text, 'Chat is unavailable')
})

test('a thrown string is shown as it is', () => {
  // Arrange
  const failure = 'boom'

  // Act
  const text = describeUpdateFailure(failure)

  // Assert
  assert.equal(text, 'boom')
})
