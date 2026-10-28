import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizedTailStart } from '../utils/normalizedTailStart'

// protects=the root windows of output and debugger values are measured with separator runs collapsed, so an escaped Windows path cannot start outside them; fails_when=a doubled separator counts twice and the window starts after the root's drive letter; no_claim=which root a window then matches
test('a tail with doubled separators is measured as one separator per run, inclusive of the bound', () => {
  // Arrange
  const escapedPath = 'C:\\\\Users\\\\a'

  // Act
  const atSeven = normalizedTailStart(escapedPath, 7)
  const atEight = normalizedTailStart(escapedPath, 8)

  // Assert
  assert.equal(atSeven, 4)
  assert.equal(atEight, 2)
})

// protects=a zero or negative bound leaves no window, as the stage needs when no root is known; fails_when=a window of one character opens anyway; no_claim=the stage's own raw-length cap
test('a bound below one character leaves an empty window at the end of the text', () => {
  // Arrange
  const text = 'abc/'

  // Act
  const atZero = normalizedTailStart(text, 0)
  const belowZero = normalizedTailStart(text, -1)

  // Assert
  assert.equal(atZero, 4)
  assert.equal(belowZero, 4)
})
