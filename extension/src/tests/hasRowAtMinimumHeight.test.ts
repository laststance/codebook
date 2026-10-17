import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hasRowAtMinimumHeight } from '../utils/hasRowAtMinimumHeight'

// Value: protects=the learner's uneven stack through the Application's new group: the rows VS Code 1.140.0 gave a stack of 524 and 163 px after newGroupAbove (262/355/70, c59-vs-691probe4) are told apart from the rows of one height it gives an even stack (229/229/229), so the Study stacks only the former at one height before the Wiki's row is activated and expanded; fails_when=a row at the minimum height goes unnoticed and the focus return expands it, or rows without one are stacked again; why_new=Cycle 0046 row 691; seam=none
test('stacked rows with one row at the editor’s minimum height are told apart from rows that all stand above it', () => {
  // Arrange: the rows after newGroupAbove over an uneven and an even stack, and the rows after a Read's Expand.
  const afterUnevenInsertion = {
    orientation: 1,
    groups: [{ size: 262 }, { size: 355 }, { size: 70 }],
  }
  const afterEvenInsertion = {
    orientation: 1,
    groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
  }
  const expandedByRead = {
    orientation: 1,
    groups: [{ size: 617 }, { size: 70 }],
  }

  // Act
  const found = [
    hasRowAtMinimumHeight(afterUnevenInsertion),
    hasRowAtMinimumHeight(afterEvenInsertion),
    hasRowAtMinimumHeight(expandedByRead),
  ]

  // Assert
  assert.deepEqual(found, [true, false, true])
})

// Value: protects=a learner's nested grid through the Application's new group: a row at the minimum height is found also where it is split into columns, and also in the stack of rows a column is split into, so the Study stacks that stack at one height before the Wiki's group is activated and expanded along its row and its column; fails_when=only a root stack of single groups is read, so the nested row at the minimum goes unnoticed (row 691's bound, which row 704 found); why_new=Cycle 0046 row 704; seam=none
test('a row at the editor’s minimum height is found also where it is split into columns or stands in a column split into rows', () => {
  // Arrange: newGroupAbove over a learner's rows whose second row is split into columns, and over a learner's columns whose first is split into rows.
  const rowSplitIntoColumns = {
    orientation: 1,
    groups: [
      { size: 262 },
      { size: 355 },
      { size: 70, groups: [{ size: 550 }, { size: 550 }] },
    ],
  }
  const columnSplitIntoRows = {
    orientation: 0,
    groups: [
      { size: 550, groups: [{ size: 262 }, { size: 355 }, { size: 70 }] },
      { size: 550 },
    ],
  }
  const evenColumnOfRows = {
    orientation: 0,
    groups: [
      { size: 550, groups: [{ size: 229 }, { size: 229 }, { size: 229 }] },
      { size: 550 },
    ],
  }

  // Act
  const found = [
    hasRowAtMinimumHeight(rowSplitIntoColumns),
    hasRowAtMinimumHeight(columnSplitIntoRows),
    hasRowAtMinimumHeight(evenColumnOfRows),
  ]

  // Assert
  assert.deepEqual(found, [true, true, false])
})

// Value: protects=the learner's arrangement outside the case of rows 691 and 704: a hidden editor area (every stacked row at the minimum, which the collapsed-layout check handles), columns and anything that is no layout are never stacked again; fails_when=the Study replaces columns or a hidden area's rows with rows of one height; why_new=Cycle 0046 row 691 (its bound; row 704 moved nested rows inside it); seam=none
test('a hidden editor area’s rows, columns and no layout at all have no row to stack again', () => {
  // Arrange
  const hiddenArea = { orientation: 1, groups: [{ size: 70 }, { size: 70 }] }
  const columns = { orientation: 0, groups: [{ size: 70 }, { size: 1030 }] }

  // Act
  const found = [
    hasRowAtMinimumHeight(hiddenArea),
    hasRowAtMinimumHeight(columns),
    hasRowAtMinimumHeight(undefined),
  ]

  // Assert
  assert.deepEqual(found, [false, false, false])
})
