import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isBindingLineAccepted } from '../utils/isBindingLineAccepted'

/** A sealed map whose mapped lines are given, with a scan that covered the whole map or stopped at its size limit. @example mapWith([22, 25])(23, 24) // { complete: true, positions: [] } */
const mapWith =
  (mappedLines: number[], complete = true) =>
  (startLine: number, endLine: number) => ({
    complete,
    positions: mappedLines
      .filter((line) => line >= startLine && line <= endLine)
      .map((line) => ({ line, column: 1 })),
  })

/** The citation of every case: lines 17 to 30 of the article's file. */
const citation = { endLine: 30 }

// Value: protects=a stop the debugger verified on its declared line staying accepted, as before this rule existed; fails_when=the rule asks the map about the declared line itself and a partial scan refuses it; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on the declared line is accepted, also when the map could not be scanned completely', () => {
  // Arrange
  const partialMap = mapWith([], false)
  // Act
  const accepted = isBindingLineAccepted(22, 22, citation, partialMap)
  // Assert
  assert.equal(accepted, true)
})

// Value: protects=a live run going on when the debugger moves a stop from a line it cannot pause on to the next line (`return (` onto the `<form>` line); fails_when=the next line is refused, or is refused only because the map scan was partial although no line lies between; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on the next line is accepted, also when the map could not be scanned completely', () => {
  // Arrange
  const completeMap = mapWith([22, 23]),
    partialMap = mapWith([], false)
  // Act
  const answers = [
    isBindingLineAccepted(22, 23, citation, completeMap),
    isBindingLineAccepted(22, 23, citation, partialMap),
  ]
  // Assert
  assert.deepEqual(answers, [true, true])
})

// Value: protects=a stop above a comment or a blank line being accepted where the debugger put it; fails_when=only the very next line is accepted, or the lines between are not asked for exactly; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on a later line is accepted when the lines between hold no mapped position', () => {
  // Arrange: lines 34 and 35 hold a comment and nothing the map knows of.
  const map = mapWith([33, 36])
  // Act
  const accepted = isBindingLineAccepted(33, 36, { endLine: 41 }, map)
  // Assert
  assert.equal(accepted, true)
})

// Value: protects=a run never reporting a pause before the declared line as that stop; fails_when=an earlier line is accepted because nothing mapped lies between; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on an earlier line is refused', () => {
  // Arrange
  const map = mapWith([21, 22])
  // Act
  const accepted = isBindingLineAccepted(22, 21, citation, map)
  // Assert
  assert.equal(accepted, false)
})

// Value: protects=a run never reporting a stop past code that could run between the declared line and the pause; fails_when=a later line is accepted across a line the sealed map has a position on; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on a later line is refused when a line between has a mapped position', () => {
  // Arrange: line 23 holds code.
  const map = mapWith([22, 23, 24])
  // Act
  const accepted = isBindingLineAccepted(22, 24, citation, map)
  // Assert
  assert.equal(accepted, false)
})

// Value: protects=an explanation never being about a line its article does not show; fails_when=a later line after the citation's last line is accepted; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on a line after the stop’s citation is refused, and its last line is still inside', () => {
  // Arrange
  const map = mapWith([30, 31])
  // Act
  const answers = [
    isBindingLineAccepted(29, 30, citation, map),
    isBindingLineAccepted(30, 31, citation, map),
  ]
  // Assert
  assert.deepEqual(answers, [true, false])
})

// Value: protects=a map too large to scan never being read as "no code between"; fails_when=an incomplete scan that found nothing between accepts the later line; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('a binding on a later line is refused when the scan of the lines between stopped at its size limit', () => {
  // Arrange: the scan found nothing between and did not reach the end of the map.
  const partialMap = mapWith([], false)
  // Act
  const accepted = isBindingLineAccepted(22, 24, citation, partialMap)
  // Assert
  assert.equal(accepted, false)
})

// Value: protects=the rule asking the map only about the lines strictly between, so the bound line's own mapping never refuses it; fails_when=the scan range includes the declared or the bound line; why_new=the utility is new (Cycle 0043 ER1); seam=none
test('the lines asked of the map are those strictly between the declared and the bound line', () => {
  // Arrange
  const asked: [number, number][] = []
  const recordingMap = (startLine: number, endLine: number) => {
    asked.push([startLine, endLine])
    return { complete: true, positions: [] }
  }
  // Act
  isBindingLineAccepted(22, 26, citation, recordingMap)
  // Assert
  assert.deepEqual(asked, [[23, 25]])
})
