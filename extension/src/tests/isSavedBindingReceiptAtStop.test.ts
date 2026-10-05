import assert from 'node:assert/strict'
import { test } from 'node:test'

import { configuredObservationSchema } from '../configuredStudySchemas'
import { createBindingLineRule } from '../utils/createBindingLineRule'
import { isSavedBindingReceiptAtStop } from '../utils/isSavedBindingReceiptAtStop'

test('a saved stop that was requested on the first mapped line after its declared line and bound on the line after that is read back as that stop', () => {
  // Act
  const accepted = isSavedBindingReceiptAtStop(
    {
      line: 75,
      binding: {
        declaredLine: 73,
        requestedLine: 74,
        boundLine: 75,
        mappedLinesBetween: 0,
      },
    },
    73,
    true,
  )
  // Assert
  assert.equal(accepted, true)
})

// Cycle 0045 (SEC-5): red while the saved rule refused a bound line before the requested one, which the run's rule accepts, so a checkpoint of such a stop would have thrown.
test('every line the run’s rule accepts for a stop requested after its declared line gives a receipt the saved-study rule accepts', () => {
  // Arrange: the stop is declared on the unmapped line 73 and requested on line 76, the first mapped line after it; line 77 is mapped too.
  const rule = createBindingLineRule(
    73,
    { endLine: 95 },
    {
      positions: [
        { line: 76, column: 1 },
        { line: 77, column: 1 },
      ],
      complete: true,
    },
    76,
  )
  const acceptedLines = [72, 73, 74, 75, 76, 77, 78].filter((line) =>
    rule.accepts(line),
  )
  // Act
  const savedAnswers = acceptedLines.map((line) =>
    isSavedBindingReceiptAtStop(
      {
        line,
        binding: {
          declaredLine: 73,
          requestedLine: 76,
          boundLine: line,
          mappedLinesBetween: 0,
        },
      },
      73,
      true,
    ),
  )
  // Assert
  assert.deepEqual(acceptedLines, [73, 74, 75, 76, 77])
  assert.deepEqual(savedAnswers, [true, true, true, true, true])
})

// Cycle 0045 (ST-18): the common blank-line case (natively 38, 39, 39) had no test; green on 6a7a0b8, its control is a strict comparison of the requested and the bound line.
test('a saved stop declared on a blank line and requested and bound on the next line is read back as that stop', () => {
  // Arrange: the receipt as the study's schema reads it.
  const binding = configuredObservationSchema.shape.source.shape.binding.parse({
    declaredLine: 38,
    requestedLine: 39,
    boundLine: 39,
    mappedLinesBetween: 0,
  })
  // Act
  const accepted = isSavedBindingReceiptAtStop({ line: 39, binding }, 38, true)
  // Assert
  assert.equal(accepted, true)
})

// Cycle 0045 (ST-18): green on 6a7a0b8; its control is the direction of the comparison with the declared line.
test('a saved receipt whose requested line lies before its declared line is refused', () => {
  // Act
  const requestedBeforeDeclaredLine = isSavedBindingReceiptAtStop(
    {
      line: 73,
      binding: {
        declaredLine: 73,
        requestedLine: 72,
        boundLine: 73,
        mappedLinesBetween: 0,
      },
    },
    73,
    true,
  )
  // Assert
  assert.equal(requestedBeforeDeclaredLine, false)
})

test('a saved receipt whose requested line is its declared line is refused', () => {
  // Act: a stop requested on its declared line saves no requested line.
  const requestedOnDeclaredLine = isSavedBindingReceiptAtStop(
    {
      line: 75,
      binding: {
        declaredLine: 73,
        requestedLine: 73,
        boundLine: 75,
        mappedLinesBetween: 0,
      },
    },
    73,
    true,
  )
  // Assert
  assert.equal(requestedOnDeclaredLine, false)
})

test('a saved receipt without a requested line is read as before', () => {
  // Act
  const moved = isSavedBindingReceiptAtStop(
    {
      line: 23,
      binding: { declaredLine: 22, boundLine: 23, mappedLinesBetween: 0 },
    },
    22,
    true,
  )
  const withoutReceipt = isSavedBindingReceiptAtStop({ line: 23 }, 22, true)
  // Assert
  assert.equal(moved, true)
  assert.equal(withoutReceipt, false)
})
