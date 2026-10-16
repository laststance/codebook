import assert from 'node:assert/strict'
import { test } from 'node:test'

import { recordedLeftoverGroups } from '../utils/recordedLeftoverGroups'

test('the empty groups at the recorded columns are retired from the last column to the first, so a removal renumbers no column still to retire', () => {
  // Arrange
  const groups = [
    { viewColumn: 1, tabs: [] },
    { viewColumn: 2, tabs: [{ label: 'README.md' }] },
    { viewColumn: 3, tabs: [] },
  ]

  // Act
  const leftovers = recordedLeftoverGroups([1, 3], groups)

  // Assert
  assert.deepEqual(leftovers, [
    { column: 3, focusCommand: 'workbench.action.focusThirdEditorGroup' },
    { column: 1, focusCommand: 'workbench.action.focusFirstEditorGroup' },
  ])
})

test('a recorded group that now holds a learner tab is no leftover, and the other recorded group still is', () => {
  // Arrange
  const groups = [
    { viewColumn: 1, tabs: [] },
    { viewColumn: 2, tabs: [{ label: 'README.md' }] },
    { viewColumn: 3, tabs: [{ label: 'notes.md' }] },
  ]

  // Act
  const leftovers = recordedLeftoverGroups([1, 3], groups)

  // Assert
  assert.deepEqual(leftovers, [
    { column: 1, focusCommand: 'workbench.action.focusFirstEditorGroup' },
  ])
})

test('an empty group at a column the record does not name is never a leftover', () => {
  // Arrange
  const groups = [
    { viewColumn: 1, tabs: [{ label: 'README.md' }] },
    { viewColumn: 2, tabs: [] },
  ]

  // Act
  const leftovers = recordedLeftoverGroups([1], groups)

  // Assert
  assert.deepEqual(leftovers, [])
})

test('a recorded empty group the editor has no focus command for retires no group of the record', () => {
  // Arrange: nine main groups; the record names the first and the ninth, which no focus command reaches.
  const groups = Array.from({ length: 9 }, (_, index) => ({
    viewColumn: index + 1,
    tabs: index === 0 || index === 8 ? [] : [{ label: `file-${index}.ts` }],
  }))

  // Act
  const leftovers = recordedLeftoverGroups([1, 9], groups)

  // Assert
  assert.deepEqual(leftovers, [])
})
