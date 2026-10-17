import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stacksOfRows } from '../utils/stacksOfRows'

// Value: protects=which splits of a learner's grid the Study reads as stacks of rows: the root of a vertical layout, the rows of a column, and not the columns of a row, since a nested split lies across the one it is in; fails_when=a row of columns is read as a stack of rows, so its columns would be stacked at one height, or a column's rows are missed (row 704); why_new=Cycle 0046 row 704; seam=none
test('the stacks of rows of a grid are the root’s rows and the rows of every column, never the columns of a row', () => {
  // Arrange: rows whose second row is split into columns, the first of them split into rows again.
  const layout = {
    orientation: 1 as const,
    groups: [
      { size: 524 },
      {
        size: 163,
        groups: [
          { size: 550, groups: [{ size: 80 }, { size: 83 }] },
          { size: 550 },
        ],
      },
    ],
  }

  // Act
  const stacks = stacksOfRows(layout).map((rows) => rows.map((row) => row.size))

  // Assert
  assert.deepEqual(stacks, [
    [524, 163],
    [80, 83],
  ])
})

// Value: protects=a learner's columns: a grid of columns has no stack of rows to change; fails_when=the columns are read as rows; why_new=Cycle 0046 row 704; seam=none
test('a grid of columns alone has no stack of rows', () => {
  // Arrange
  const layout = {
    orientation: 0 as const,
    groups: [{ size: 550 }, { size: 550 }],
  }

  // Act
  const stacks = stacksOfRows(layout)

  // Assert
  assert.deepEqual(stacks, [])
})
