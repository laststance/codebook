import assert from 'node:assert/strict'
import { test } from 'node:test'

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

test('a saved receipt whose requested line is not after its declared line, or lies after its bound line, is refused', () => {
  // Act
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
  const requestedAfterBoundLine = isSavedBindingReceiptAtStop(
    {
      line: 75,
      binding: {
        declaredLine: 73,
        requestedLine: 76,
        boundLine: 75,
        mappedLinesBetween: 0,
      },
    },
    73,
    true,
  )
  // Assert
  assert.equal(requestedOnDeclaredLine, false)
  assert.equal(requestedAfterBoundLine, false)
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
