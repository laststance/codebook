import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editorLayoutGroupCount } from '../utils/editorLayoutGroupCount'

test('main-grid admission counts nested Study panes without counting their split container', () => {
  // Arrange
  const layout = {
    orientation: 0,
    groups: [
      { size: 539, groups: [{ size: 239 }, { size: 238 }] },
      { size: 441 },
    ],
  }
  // Act
  const count = editorLayoutGroupCount(layout)
  // Assert
  assert.equal(count, 3)
})

test('a real four-pane grid is not admitted as a three-pane Study layout', () => {
  // Arrange
  const layout = {
    orientation: 0,
    groups: [
      { size: 220, groups: [{ size: 70 }, { size: 407 }] },
      { size: 440, groups: [{ size: 70 }, { size: 407 }] },
    ],
  }
  // Act
  const count = editorLayoutGroupCount(layout)
  // Assert
  assert.equal(count, 4)
})

test('a cold single-pane grid does not imply that global column Two belongs to the same editor part', () => {
  // Arrange
  const layout = { orientation: 1, groups: [{ size: 477 }] }
  // Act
  const count = editorLayoutGroupCount(layout)
  // Assert
  assert.equal(count, 1)
})

test('missing or malformed native geometry cannot authorize pane reservation', () => {
  // Arrange
  const layouts = [
    undefined,
    null,
    {},
    { orientation: 0, groups: [] },
    { orientation: 0, groups: [{}] },
    { orientation: 0, groups: [{ size: 0 }] },
    { orientation: 0, groups: [{ size: Number.NaN }] },
    { orientation: 2, groups: [{ size: 1 }] },
  ]
  // Act / Assert
  for (const layout of layouts)
    assert.equal(editorLayoutGroupCount(layout), undefined)
})
