import assert from 'node:assert/strict'
import { test } from 'node:test'

import { layoutKeepsEveryGroup } from '../utils/layoutKeepsEveryGroup'

test('a Study layout with as many groups as the window keeps every learner group', () => {
  // Arrange
  const layout = { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] }

  // Act
  const keepsEveryGroup = layoutKeepsEveryGroup(layout, 2)

  // Assert
  assert.equal(keepsEveryGroup, true)
})

test('a Study layout with more groups than the window keeps every learner group', () => {
  // Arrange
  const layout = {
    orientation: 0,
    groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
  }

  // Act
  const keepsEveryGroup = layoutKeepsEveryGroup(layout, 2)

  // Assert
  assert.equal(keepsEveryGroup, true)
})

test('a Study layout with fewer groups than the window would merge a learner group and is refused', () => {
  // Arrange
  const layout = { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] }

  // Act
  const keepsEveryGroup = layoutKeepsEveryGroup(layout, 3)

  // Assert
  assert.equal(keepsEveryGroup, false)
})

test('no Study layout at all is refused, whatever the window holds', () => {
  // Arrange
  const layout = undefined

  // Act
  const keepsEveryGroup = layoutKeepsEveryGroup(layout, 1)

  // Assert
  assert.equal(keepsEveryGroup, false)
})
