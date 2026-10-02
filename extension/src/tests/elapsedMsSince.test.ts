import assert from 'node:assert/strict'
import { test } from 'node:test'

import { elapsedMsSince } from '../utils/elapsedMsSince'

// Value: protects=the journal's pause duration being whole, non-negative milliseconds; fails_when=a fraction is kept or a clock that went back gives a negative duration; why_new=the utility is new; seam=none
test('the time since an observed start is whole milliseconds and never negative', () => {
  // Arrange
  const startMs = 1000.2
  // Act
  const elapsed = elapsedMsSince(startMs, 1003.9),
    backwards = elapsedMsSince(startMs, 999)
  // Assert
  assert.equal(elapsed, 4)
  assert.equal(backwards, 0)
})

// Value: protects=a resume whose pause was never observed carrying no invented duration; fails_when=a missing start is answered with a number; why_new=the utility is new; seam=none
test('a start that was never observed has no elapsed time', () => {
  // Arrange
  const startMs = undefined
  // Act
  const elapsed = elapsedMsSince(startMs, 5)
  // Assert
  assert.equal(elapsed, undefined)
})
