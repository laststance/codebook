import assert from 'node:assert/strict'
import { test } from 'node:test'

import { libraryHasRoom } from '../utils/libraryHasRoom'

test('a study library below its limit admits another study', () => {
  // Arrange
  const usage = { count: 63, limit: 64 }
  // Act
  const hasRoom = libraryHasRoom(usage)
  // Assert
  assert.equal(hasRoom, true)
})

test('a study library at its limit, or one whose limit setting is invalid, admits no study', () => {
  // Arrange
  const full = { count: 64, limit: 64 },
    invalidLimit = { count: 3 }
  // Act
  const answers = [libraryHasRoom(full), libraryHasRoom(invalidLimit)]
  // Assert
  assert.deepEqual(answers, [false, false])
})
