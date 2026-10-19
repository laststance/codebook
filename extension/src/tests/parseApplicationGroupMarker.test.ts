import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseApplicationGroupMarker } from '../utils/parseApplicationGroupMarker'

test('the record an earlier window kept of its Application group is read back for the reload proof', () => {
  // Arrange
  const stored = {
    version: 1,
    writer: 'the window before the reload',
    column: 1,
    groupCount: 3,
    layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }, { size: 1 }] },
  }

  // Act
  const marker = parseApplicationGroupMarker(stored)

  // Assert
  assert.deepEqual(marker, {
    version: 1,
    writer: 'the window before the reload',
    column: 1,
    groupCount: 3,
    layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }, { size: 1 }] },
  })
})

test('a workspace with no record proves no Application group', () => {
  // Arrange
  const stored = undefined

  // Act
  const marker = parseApplicationGroupMarker(stored)

  // Assert
  assert.equal(marker, undefined)
})

test('a record of another version proves no Application group', () => {
  // Arrange
  const stored = {
    version: 2,
    writer: 'a later Codebook',
    column: 1,
    groupCount: 3,
    layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }, { size: 1 }] },
  }

  // Act
  const marker = parseApplicationGroupMarker(stored)

  // Assert
  assert.equal(marker, undefined)
})

test('a record whose layout is no editor layout proves no Application group', () => {
  // Arrange
  const stored = {
    version: 1,
    writer: 'the window before the reload',
    column: 1,
    groupCount: 3,
    layout: { orientation: 0, groups: [] },
  }

  // Act
  const marker = parseApplicationGroupMarker(stored)

  // Assert
  assert.equal(marker, undefined)
})
