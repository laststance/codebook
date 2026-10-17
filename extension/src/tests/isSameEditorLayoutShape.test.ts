import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isSameEditorLayoutShape } from '../utils/isSameEditorLayoutShape'

// Value: protects=the learner's editor groups getting their sizes back after a Read although the Read's Expand changed every size: the layout of before and the layout of now count as the same groups; fails_when=two layouts of the same groups with other sizes count as different, so nothing is given back and the groups stay expanded; why_new=Cycle 0046 row 328; seam=none
test('two layouts of the same editor groups count as the same groups whatever their sizes, also with a split column', () => {
  // Arrange: two rows before a Read and after its Expand, and the three-pane columns with other widths.
  const rowsBefore = { orientation: 1, groups: [{ size: 344 }, { size: 343 }] }
  const rowsExpanded = { orientation: 1, groups: [{ size: 617 }, { size: 70 }] }
  const columnsBefore = {
    orientation: 0,
    groups: [
      { size: 604, groups: [{ size: 344 }, { size: 343 }] },
      { size: 495 },
    ],
  }
  const columnsExpanded = {
    orientation: 0,
    groups: [
      { size: 1029, groups: [{ size: 617 }, { size: 70 }] },
      { size: 70 },
    ],
  }

  // Act
  const same = [
    isSameEditorLayoutShape(rowsBefore, rowsExpanded),
    isSameEditorLayoutShape(columnsBefore, columnsExpanded),
  ]

  // Assert
  assert.deepEqual(same, [true, true])
})

// Value: protects=the learner's editor groups when they changed during a Read: a layout noted for other groups is never applied to them; fails_when=a layout with another number of groups, another split or another orientation counts as the same, so a group the learner opened is merged away or a split is turned; why_new=Cycle 0046 row 328 (the bound of the give-back); seam=none
test('a layout with another group, another split, another orientation or no layout at all does not count as the same groups', () => {
  // Arrange
  const rows = { orientation: 1, groups: [{ size: 344 }, { size: 343 }] }

  // Act
  const same = [
    isSameEditorLayoutShape(rows, {
      orientation: 1,
      groups: [{ size: 300 }, { size: 200 }, { size: 187 }],
    }),
    isSameEditorLayoutShape(rows, {
      orientation: 1,
      groups: [
        { size: 344, groups: [{ size: 300 }, { size: 304 }] },
        { size: 343 },
      ],
    }),
    isSameEditorLayoutShape(rows, {
      orientation: 0,
      groups: [{ size: 344 }, { size: 343 }],
    }),
    isSameEditorLayoutShape(rows, undefined),
    isSameEditorLayoutShape(undefined, rows),
  ]

  // Assert
  assert.deepEqual(same, [false, false, false, false, false])
})
