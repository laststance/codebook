import assert from 'node:assert/strict'
import { test } from 'node:test'

import { breakLocationLinesOnTheWay } from '../utils/breakLocationLinesOnTheWay'

// Cycle 0046 (row 77): red while every source line with a break location counted, wherever its break location lay in the generated module, so a stop declared above a server action and bound at its first statement was refused for the registration call the build appends at the module's end ("line 27 between the declared line 26 and line 32 has a break location").
test('a break location at the end of the generated module that the map puts on a line between is not on the way to the binding', () => {
  // Arrange: the stop is requested where generated 30:1 begins and bound at source 32:11, generated 32:52; the module's last statement, generated 153:66, is mapped to line 27.
  const locations = [
    { line: 32, column: 11, generated: { lineNumber: 32, columnNumber: 52 } },
    { line: 35, column: 5, generated: { lineNumber: 35, columnNumber: 8 } },
    { line: 27, column: 23, generated: { lineNumber: 153, columnNumber: 66 } },
  ]
  // Act
  const onTheWay = breakLocationLinesOnTheWay(
    locations,
    { lineNumber: 30, columnNumber: 1 },
    { line: 32, column: 11 },
  )
  // Assert
  assert.deepEqual(onTheWay, {
    lines: [],
    requestedAt: { lineNumber: 30, columnNumber: 1 },
    boundAt: { lineNumber: 32, columnNumber: 52 },
  })
})

// Cycle 0046 (row 77): the real case stays refused: a place the debugger could have paused at before the binding is named, once, in line order, whatever order the debugger listed it in.
test('the break locations between the requested generated place and the binding are named by their source lines, each once and in line order', () => {
  // Arrange: two break locations of line 30 and one of line 29 lie between the requested place and the binding at 32:11; the list is not in generated order.
  const locations = [
    { line: 32, column: 11, generated: { lineNumber: 40, columnNumber: 8 } },
    { line: 30, column: 9, generated: { lineNumber: 36, columnNumber: 20 } },
    { line: 30, column: 3, generated: { lineNumber: 36, columnNumber: 4 } },
    { line: 29, column: 3, generated: { lineNumber: 38, columnNumber: 4 } },
    { line: 26, column: 2, generated: { lineNumber: 30, columnNumber: 1 } },
  ]
  // Act
  const onTheWay = breakLocationLinesOnTheWay(
    locations,
    { lineNumber: 30, columnNumber: 1 },
    { line: 32, column: 11 },
  )
  // Assert: the requested place's own break location is on the way too; the binding's is not.
  assert.deepEqual(onTheWay, {
    lines: [26, 29, 30],
    requestedAt: { lineNumber: 30, columnNumber: 1 },
    boundAt: { lineNumber: 40, columnNumber: 8 },
  })
})

// Cycle 0046 (row 77): at a pause the program's own place is the binding's, also when the map puts an earlier generated place at the same source position.
test('a pause given for the binding is counted up to, not the first listed place the map puts at the bound position', () => {
  // Arrange: the build emitted the statement of 32:11 twice; a break location of line 29 lies between the two copies, and the program is paused at the second.
  const locations = [
    { line: 32, column: 11, generated: { lineNumber: 32, columnNumber: 52 } },
    { line: 29, column: 3, generated: { lineNumber: 50, columnNumber: 0 } },
    { line: 32, column: 11, generated: { lineNumber: 60, columnNumber: 8 } },
  ]
  // Act
  const fromTheMap = breakLocationLinesOnTheWay(
      locations,
      { lineNumber: 30, columnNumber: 1 },
      { line: 32, column: 11 },
    ),
    atThePause = breakLocationLinesOnTheWay(
      locations,
      { lineNumber: 30, columnNumber: 1 },
      { line: 32, column: 11 },
      { lineNumber: 60, columnNumber: 8 },
    )
  // Assert
  assert.deepEqual(
    [
      fromTheMap?.lines,
      fromTheMap?.boundAt,
      atThePause?.lines,
      atThePause?.boundAt,
    ],
    [
      [],
      { lineNumber: 32, columnNumber: 52 },
      [29, 32],
      { lineNumber: 60, columnNumber: 8 },
    ],
  )
})

// Cycle 0046 (row 77): when a generated place cannot be known the caller must fall back to every line with a break location; red if an unknown place were read as "nothing between".
test('the way to a binding is unknown without a requested generated place, without a listed place at the binding, and for a binding before the requested place', () => {
  // Arrange: the binding 32:11 is listed at generated 32:52.
  const locations = [
    { line: 32, column: 11, generated: { lineNumber: 32, columnNumber: 52 } },
  ]
  // Act
  const answers = [
    // The map names no generated position for the requested line.
    breakLocationLinesOnTheWay(locations, undefined, { line: 32, column: 11 }),
    // The debugger lists no break location at the bound column.
    breakLocationLinesOnTheWay(
      locations,
      { lineNumber: 30, columnNumber: 1 },
      { line: 32, column: 5 },
    ),
    // The only listed place of the binding lies before the requested place.
    breakLocationLinesOnTheWay(
      locations,
      { lineNumber: 40, columnNumber: 0 },
      { line: 32, column: 11 },
    ),
    // The program is paused before the requested place.
    breakLocationLinesOnTheWay(
      locations,
      { lineNumber: 40, columnNumber: 0 },
      { line: 32, column: 11 },
      { lineNumber: 32, columnNumber: 52 },
    ),
  ]
  // Assert
  assert.deepEqual(answers, [undefined, undefined, undefined, undefined])
})
