import assert from 'node:assert/strict'
import { test } from 'node:test'

import { toApplicationGroupMarker } from '../utils/toApplicationGroupMarker'

test('a record that names the Application group alone keeps the version-1 shape that 0.2.30 candidates read', () => {
  // Arrange
  const layout = { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] }

  // Act
  const marker = toApplicationGroupMarker('this window', [1], 2, layout)

  // Assert
  assert.deepEqual(marker, {
    version: 1,
    writer: 'this window',
    column: 1,
    groupCount: 2,
    layout: { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
  })
})

test('a record that names the Application group and the Study Context’s created group is version 2, with the columns in order', () => {
  // Arrange
  const layout = {
    orientation: 0,
    groups: [
      { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
      { size: 0.45 },
    ],
  }

  // Act
  const marker = toApplicationGroupMarker('this window', [3, 1], 3, layout)

  // Assert
  assert.deepEqual(marker, {
    version: 2,
    writer: 'this window',
    columns: [1, 3],
    groupCount: 3,
    layout: {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    },
  })
})
