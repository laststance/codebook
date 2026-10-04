import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveArmedPlace } from '../utils/resolveArmedPlace'

/** A sealed map whose mapped positions are given, with a scan that covered the whole map or stopped at its size limit. @example mapWith([{ line: 39, column: 9 }])(38, 52) */
const mapWith =
  (mapped: { line: number; column: number }[], complete = true) =>
  (startLine: number, endLine: number) => ({
    complete,
    positions: mapped.filter(
      (position) => position.line >= startLine && position.line <= endLine,
    ),
  })

test('a stop declared on a blank line is requested at the first mapped position after it in its citation', () => {
  // Arrange: line 38 is blank; line 39 starts its statement at column 9.
  const declared = { line: 38, column: 1 }
  // Act
  const armed = resolveArmedPlace(
    declared,
    52,
    mapWith([
      { line: 37, column: 9 },
      { line: 39, column: 9 },
      { line: 40, column: 9 },
    ]),
  )
  // Assert
  assert.deepEqual(armed, { line: 39, column: 9 })
})

test('a stop declared on a line with a mapped position is requested where it was declared', () => {
  // Arrange
  const declared = { line: 39, column: 31 }
  // Act
  const armed = resolveArmedPlace(
    declared,
    52,
    mapWith([
      { line: 39, column: 9 },
      { line: 40, column: 9 },
    ]),
  )
  // Assert
  assert.equal(armed, declared)
})

test('a stop on an unmapped line whose only mapped lines lie after its citation is requested where it was declared', () => {
  // Arrange: the citation ends on line 39; the next mapped line is 41.
  const declared = { line: 38, column: 1 }
  // Act
  const armed = resolveArmedPlace(
    declared,
    39,
    mapWith([{ line: 41, column: 1 }]),
  )
  // Assert
  assert.equal(armed, declared)
})

test('a map too large to scan completely leaves the stop requested where it was declared, because an earlier mapped line may have been missed', () => {
  // Arrange: the partial scan found line 41 only.
  const declared = { line: 38, column: 1 }
  // Act
  const armed = resolveArmedPlace(
    declared,
    52,
    mapWith([{ line: 41, column: 5 }], false),
  )
  // Assert
  assert.equal(armed, declared)
})
