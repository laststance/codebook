import assert from 'node:assert/strict'
import { test } from 'node:test'

import { placeAfterDeclaringLine } from '../utils/placeAfterDeclaringLine'

// Each case hands the stop's one scan of its sealed map, from its declared line to the end of its citation, as the run does. Value: protects=a stop whose own line declares a binding it requires being requested where that binding has a value; fails_when=the place is the declaring line itself, skips the next mapped line, lies past the citation, or trusts a partial scan across a line it may have missed; why_new=Cycle 0045 N14d-15 (DX-1 a); seam=none

test('a stop on a declaring line followed by a mapped line is requested at that line’s first mapped position', () => {
  // Arrange: line 21 declares the binding; line 22 is mapped at column 3.
  const scan = {
    positions: [
      { line: 21, column: 3 },
      { line: 22, column: 3 },
      { line: 23, column: 5 },
    ],
    complete: true,
  }
  // Act
  const armed = placeAfterDeclaringLine(21, scan)
  // Assert
  assert.deepEqual(armed, { line: 22, column: 3 })
})

test('a stop on a declaring line followed by a blank line is requested at the first mapped position after the blank line', () => {
  // Arrange: line 41 declares the binding, line 42 is blank and line 43 is mapped at column 5.
  const scan = {
    positions: [
      { line: 41, column: 7 },
      { line: 43, column: 5 },
    ],
    complete: true,
  }
  // Act
  const armed = placeAfterDeclaringLine(41, scan)
  // Assert
  assert.deepEqual(armed, { line: 43, column: 5 })
})

test('a stop on the last mapped line of its citation stays where it was declared', () => {
  // Arrange: the citation ends on the declaring line 21, so the scan holds that line only.
  const scan = { positions: [{ line: 21, column: 3 }], complete: true }
  // Act
  const armed = placeAfterDeclaringLine(21, scan)
  // Assert
  assert.equal(armed, undefined)
})

test('a scan that stopped at its size limit moves the stop only to the very next line it found', () => {
  // Arrange: one partial scan found line 22 right after the declaring line 21, another found line 24 only, so lines 22 and 23 may have been missed.
  const foundNextLine = {
      positions: [
        { line: 21, column: 3 },
        { line: 22, column: 9 },
      ],
      complete: false,
    },
    foundLaterLineOnly = {
      positions: [
        { line: 21, column: 3 },
        { line: 24, column: 5 },
      ],
      complete: false,
    }
  // Act
  const armedAfterNextLine = placeAfterDeclaringLine(21, foundNextLine),
    armedAfterGap = placeAfterDeclaringLine(21, foundLaterLineOnly)
  // Assert
  assert.deepEqual(armedAfterNextLine, { line: 22, column: 9 })
  assert.equal(armedAfterGap, undefined)
})
