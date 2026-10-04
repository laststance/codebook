import assert from 'node:assert/strict'
import { test } from 'node:test'

import { libraryHasRoom } from '../utils/libraryHasRoom'

// Value: protects=after a removal the learner is told to start a refused run again only when the library really admits one; fails_when=room is reported at or above the limit; why_new=the room read after a removal; seam=none
test('a study library below its limit admits another study', () => {
  // Arrange
  const usage = { count: 63, limit: 64 }
  // Act
  const hasRoom = libraryHasRoom(usage)
  // Assert
  assert.equal(hasRoom, true)
})

// Value: protects=a full library or an invalid limit setting never reads as room; fails_when=the next step is named although the run would be refused again; why_new=the room read after a removal; seam=none
test('a study library at its limit, or one whose limit setting is invalid, admits no study', () => {
  // Arrange
  const full = { count: 64, limit: 64 },
    invalidLimit = { count: 3 }
  // Act
  const answers = [libraryHasRoom(full), libraryHasRoom(invalidLimit)]
  // Assert
  assert.deepEqual(answers, [false, false])
})
