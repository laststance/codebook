import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveArmedPlace } from '../utils/resolveArmedPlace'

// Each case hands the stop's one scan of its sealed map, from its declared line to the end of its citation, as the run does.

test('a stop declared on a blank line is requested at the first mapped position after it in its citation', () => {
  // Arrange: line 38 is blank; line 39 starts its statement at column 9.
  const declared = { line: 38, column: 1 }
  // Act
  const armed = resolveArmedPlace(declared, {
    positions: [
      { line: 39, column: 9 },
      { line: 40, column: 9 },
    ],
    complete: true,
  })
  // Assert
  assert.deepEqual(armed, { line: 39, column: 9 })
})

test('a stop declared on a line with a mapped position is requested where it was declared', () => {
  // Arrange
  const declared = { line: 39, column: 31 }
  // Act
  const armed = resolveArmedPlace(declared, {
    positions: [
      { line: 39, column: 9 },
      { line: 40, column: 9 },
    ],
    complete: true,
  })
  // Assert
  assert.equal(armed, declared)
})

test('a stop on an unmapped line whose only mapped lines lie after its citation is requested where it was declared', () => {
  // Arrange: the citation ends on line 39 and the next mapped line is 41, so the scan of lines 38 to 39 found nothing.
  const declared = { line: 38, column: 1 }
  // Act
  const armed = resolveArmedPlace(declared, { positions: [], complete: true })
  // Assert
  assert.equal(armed, declared)
})

test('a map too large to scan completely leaves the stop requested where it was declared, because an earlier mapped line may have been missed', () => {
  // Arrange: the partial scan found line 41 only.
  const declared = { line: 38, column: 1 }
  // Act
  const armed = resolveArmedPlace(declared, {
    positions: [{ line: 41, column: 5 }],
    complete: false,
  })
  // Assert
  assert.equal(armed, declared)
})

// Cycle 0045 (NF-29 a, PC-1.6): a guard; a position a partial scan found is a position.
test('a stop whose declared line a partial scan found is requested where it was declared', () => {
  // Arrange: the scan stopped at its size limit after it had read a mapping of the declared line 38.
  const declared = { line: 38, column: 5 }
  // Act
  const armed = resolveArmedPlace(declared, {
    positions: [
      { line: 38, column: 9 },
      { line: 41, column: 5 },
    ],
    complete: false,
  })
  // Assert
  assert.equal(armed, declared)
})
