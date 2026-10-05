import assert from 'node:assert/strict'
import { test } from 'node:test'

import { completeBindingPlace } from '../utils/completeBindingPlace'

// Cycle 0046 (row 76): red while a binding had to name its own column: both editors drop it from the adapter's news about a breakpoint requested at column 1, and the run ended with "Pending server breakpoint did not bind to the captured source".
test('a binding the editor answered without a column takes the column the adapter reported for that breakpoint on its line', () => {
  // Arrange: the editor answers line 32; the adapter reported the breakpoint verified at 32:11, and the program is paused at 32:17.
  const binding = { line: 32 }
  // Act
  const place = completeBindingPlace(
    binding,
    { line: 32, column: 11 },
    { line: 32, column: 17 },
  )
  // Assert
  assert.deepEqual(place, { line: 32, column: 11, columnFrom: 'adapter' })
})

// Cycle 0046 (row 76): the second source of the column, for an adapter that named none.
test('a binding without a column whose adapter reported none takes the column of the paused frame on its line', () => {
  // Arrange
  const binding = { line: 32 }
  // Act
  const place = completeBindingPlace(binding, undefined, {
    line: 32,
    column: 11,
  })
  // Assert
  assert.deepEqual(place, { line: 32, column: 11, columnFrom: 'paused-frame' })
})

// Cycle 0046 (row 76): the line of a column-less binding is never taken from anything but the binding; red if a report or a pause on another line lent it a column.
test('a binding without a column gets none from a report or a pause on another line, and none when no pause is given', () => {
  // Arrange: the editor answers line 32.
  const binding = { line: 32 }
  // Act
  const places = [
    completeBindingPlace(
      binding,
      { line: 27, column: 1 },
      { line: 35, column: 5 },
    ),
    completeBindingPlace(binding, undefined),
  ]
  // Assert
  assert.deepEqual(places, [undefined, undefined])
})

// Value: protects=a binding that names its column being used as answered; fails_when=the adapter's earlier report or the paused frame replaces a column the editor kept; why_new=the utility is new (Cycle 0046, row 76); seam=none
test('a binding that names its column keeps it, whatever the adapter reported or the frame says', () => {
  // Arrange
  const binding = { line: 32, column: 5 }
  // Act
  const place = completeBindingPlace(
    binding,
    { line: 32, column: 11 },
    { line: 32, column: 17 },
  )
  // Assert
  assert.deepEqual(place, { line: 32, column: 5, columnFrom: 'binding' })
})
