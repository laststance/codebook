import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withoutEditorLayoutLeaves } from '../utils/withoutEditorLayoutLeaves'

// Value: protects=the learner's stacked groups after a Close on row 639's path: the layout of before the Open, without the leaf of the earlier window's leftover the editor removed, keeps the learner's two rows with their sizes; fails_when=the removed leaf stays in the layout, so applying it makes an empty group again behind the learner's groups, or the rows lose their sizes; why_new=Cycle 0046 row 639; seam=none
test('a stacked layout without its first row keeps the other rows with their sizes', () => {
  // Arrange: the leftover row the editor removed, then the learner's two rows.
  const stacked = {
    orientation: 1,
    groups: [{ size: 229 }, { size: 349 }, { size: 109 }],
  }

  // Act
  const learners = withoutEditorLayoutLeaves(stacked, new Set([0]))

  // Assert
  assert.deepEqual(learners, {
    orientation: 1,
    groups: [{ size: 349 }, { size: 109 }],
  })
})

// Value: protects=the shape of the learner's groups when the removed group stood beside a split: the split that keeps one group becomes that group, and a root that keeps one split takes that split's direction; fails_when=a split of one child is left in the layout or a lifted split keeps the wrong direction, so the editor turns the learner's columns into rows; why_new=Cycle 0046 row 639 (the general shape of the layout of before); seam=none
test('a layout without a leaf lifts the one child a split keeps, and a root that keeps one split takes its direction', () => {
  // Arrange: a row above two columns, and a column that holds a removed row beside a kept one.
  const rowAboveColumns = {
    orientation: 1,
    groups: [
      { size: 300 },
      { size: 400, groups: [{ size: 500 }, { size: 600 }] },
    ],
  }
  const columnWithRows = {
    orientation: 0,
    groups: [
      { size: 514, groups: [{ size: 343 }, { size: 344 }] },
      { size: 420 },
    ],
  }

  // Act
  const results = [
    withoutEditorLayoutLeaves(rowAboveColumns, new Set([0])),
    withoutEditorLayoutLeaves(columnWithRows, new Set([0])),
  ]

  // Assert
  assert.deepEqual(results, [
    { orientation: 0, groups: [{ size: 500 }, { size: 600 }] },
    { orientation: 0, groups: [{ size: 514 }, { size: 420 }] },
  ])
})

// Value: protects=the layout of before as it was where nothing is to be removed or nothing can be read, and no layout at all where every group is gone; fails_when=a layout without removals is rewritten, an unreadable answer is turned into a layout, or an empty layout is given to the editor; why_new=Cycle 0046 row 639 (the bounds); seam=none
test('a layout without removals or one that is no layout stays as it is, and one without any leaf left is none', () => {
  // Arrange
  const rows = { orientation: 1, groups: [{ size: 344 }, { size: 343 }] }

  // Act
  const results = [
    withoutEditorLayoutLeaves(rows, new Set()),
    withoutEditorLayoutLeaves('no layout', new Set([0])),
    withoutEditorLayoutLeaves(rows, new Set([0, 1])),
  ]

  // Assert
  assert.deepEqual(results, [
    { orientation: 1, groups: [{ size: 344 }, { size: 343 }] },
    'no layout',
    undefined,
  ])
})
