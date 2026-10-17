import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stackRowsAtOneHeight } from '../utils/stackRowsAtOneHeight'

// Value: protects=the layout the Study sets over a learner's grid before the Wiki's group is activated: the stack of rows with a row at the minimum height stands at one height, at the root as for row 691's 262/355/70 and nested in a column, while a row split into columns keeps its columns and the other splits keep their sizes; fails_when=the layout flattens the learner's nested splits into rows of single groups (row 691's layout of count rows), or changes a stack or a split without a row at the minimum, so the Return's noted grid and the arrangement no longer match the learner's; why_new=Cycle 0046 row 704; seam=none
test('the stack of rows with a row at the minimum height stands at one height, and every other split keeps its sizes', () => {
  // Arrange: row 691's stack, a stack whose last row is split into columns, and two columns whose first is split into rows.
  const rows = {
    orientation: 1,
    groups: [{ size: 262 }, { size: 355 }, { size: 70 }],
  }
  const rowSplitIntoColumns = {
    orientation: 1,
    groups: [
      { size: 262 },
      { size: 355 },
      { size: 70, groups: [{ size: 400 }, { size: 700 }] },
    ],
  }
  const columnSplitIntoRows = {
    orientation: 0,
    groups: [
      { size: 550, groups: [{ size: 262 }, { size: 355 }, { size: 70 }] },
      { size: 550, groups: [{ size: 500 }, { size: 187 }] },
    ],
  }

  // Act
  const stacked = [
    stackRowsAtOneHeight(rows),
    stackRowsAtOneHeight(rowSplitIntoColumns),
    stackRowsAtOneHeight(columnSplitIntoRows),
  ]

  // Assert
  assert.deepEqual(stacked, [
    {
      orientation: 1,
      groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
    },
    {
      orientation: 1,
      groups: [
        { size: 229 },
        { size: 229 },
        { size: 229, groups: [{ size: 400 }, { size: 700 }] },
      ],
    },
    {
      orientation: 0,
      groups: [
        { size: 550, groups: [{ size: 229 }, { size: 229 }, { size: 229 }] },
        { size: 550, groups: [{ size: 500 }, { size: 187 }] },
      ],
    },
  ])
})

// Value: protects=the caller's guard: anything that is no editor layout gives no layout to set; fails_when=a malformed answer of the editor is sent back to vscode.setEditorLayout; why_new=Cycle 0046 row 704; seam=none
test('anything that is no editor layout gives no layout to set', () => {
  // Arrange
  const notALayout = { orientation: 2, groups: [] }

  // Act
  const stacked = [
    stackRowsAtOneHeight(notALayout),
    stackRowsAtOneHeight(undefined),
  ]

  // Assert
  assert.deepEqual(stacked, [undefined, undefined])
})
