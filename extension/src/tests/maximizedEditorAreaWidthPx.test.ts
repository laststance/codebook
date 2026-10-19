import assert from 'node:assert/strict'
import { test } from 'node:test'

import { maximizedEditorAreaWidthPx } from '../utils/maximizedEditorAreaWidthPx'

// Value: protects=the width of the editor area read while a Read's maximization is on: it is the width of the one visible column, whatever the hidden groups answer; fails_when=the columns are added up, which counts every hidden group with the width it had while visible, so the area seems to have grown by a side bar; why_new=Cycle 0046 row 167 (delegated review, finding 3, read in both editors' grid code); seam=none
test('the editor area read while the Application or the captured source group is maximized is as wide as their column, not as that column and the hidden Explanation column together', () => {
  // Arrange: the Study layout in a window of 1335 px with both side bars hidden; a group of the first column is maximized, and the hidden Explanation column answers the 601 px it had.
  const layout = {
    orientation: 0,
    groups: [
      { size: 1335, groups: [{ size: 420 }, { size: 420 }] },
      { size: 601 },
    ],
  }

  // Act
  const widthPx = maximizedEditorAreaWidthPx(layout)

  // Assert
  assert.equal(widthPx, 1335)
})

// Value: protects=the reading for Read Explanation, where the hidden column is itself split and answers no width; fails_when=a hidden column's size of 0 fails the check of the whole layout, so the secondary side bar is not measured at the Read and a window resized during the reading decides instead (the defect of row 30); why_new=Cycle 0046 row 167; seam=none
test('the editor area read while the Explanation group is maximized is as wide as its column although the hidden split column answers no width', () => {
  // Arrange
  const layout = {
    orientation: 0,
    groups: [
      { size: 0, groups: [{ size: 420 }, { size: 420 }] },
      { size: 1335 },
    ],
  }

  // Act
  const widthPx = maximizedEditorAreaWidthPx(layout)

  // Assert
  assert.equal(widthPx, 1335)
})

// Value: protects=a Read that cannot measure the secondary side bar leaving that to the end of the reading instead of taking a number that is no width; fails_when=a grid of rows (the live and the replay arrangement), an answer that is no layout or columns without a width are answered with a number; why_new=Cycle 0046 row 167 (the bounds of the new reading); seam=none
test('a layout read while a group is maximized gives no width for rows at its top level, an answer that is no layout and columns without a width', () => {
  // Arrange
  const rows = { orientation: 1, groups: [{ size: 420 }, { size: 420 }] }
  const columnsWithoutWidth = { orientation: 0, groups: [{ size: 0 }, {}] }

  // Act
  const widths = [
    maximizedEditorAreaWidthPx(rows),
    maximizedEditorAreaWidthPx(undefined),
    maximizedEditorAreaWidthPx(columnsWithoutWidth),
  ]

  // Assert
  assert.deepEqual(widths, [undefined, undefined, undefined])
})
