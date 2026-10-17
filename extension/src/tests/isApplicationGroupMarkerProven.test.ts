import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isApplicationGroupMarkerProven } from '../utils/isApplicationGroupMarkerProven'

const recordedThreeGroupGrid = {
  version: 1 as const,
  writer: 'the window before the reload',
  column: 1,
  groupCount: 3,
  layout: {
    orientation: 0 as const,
    groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
  },
}

test('an empty group at the recorded column of the recorded grid is proven to be the leftover Application group, at the sizes the editor reports', () => {
  // Arrange
  const group = { viewColumn: 1, tabs: [] }
  const layout = {
    orientation: 0,
    groups: [{ size: 320 }, { size: 320 }, { size: 320 }],
  }

  // Act
  const proven = isApplicationGroupMarkerProven(
    recordedThreeGroupGrid,
    group,
    layout,
  )

  // Assert
  assert.equal(proven, true)
})

test('an empty group at another column than the recorded one is never retired as the Application group', () => {
  // Arrange
  const group = { viewColumn: 2, tabs: [] }
  const layout = {
    orientation: 0,
    groups: [{ size: 320 }, { size: 320 }, { size: 320 }],
  }

  // Act
  const proven = isApplicationGroupMarkerProven(
    recordedThreeGroupGrid,
    group,
    layout,
  )

  // Assert
  assert.equal(proven, false)
})

test('a group that holds a learner tab is never retired as the Application group', () => {
  // Arrange
  const group = { viewColumn: 1, tabs: [{ label: 'README.md' }] }
  const layout = {
    orientation: 0,
    groups: [{ size: 320 }, { size: 320 }, { size: 320 }],
  }

  // Act
  const proven = isApplicationGroupMarkerProven(
    recordedThreeGroupGrid,
    group,
    layout,
  )

  // Assert
  assert.equal(proven, false)
})

test('a grid with another number of groups than the recorded one proves no leftover Application group', () => {
  // Arrange
  const group = { viewColumn: 1, tabs: [] }
  const layout = { orientation: 0, groups: [{ size: 480 }, { size: 480 }] }

  // Act
  const proven = isApplicationGroupMarkerProven(
    recordedThreeGroupGrid,
    group,
    layout,
  )

  // Assert
  assert.equal(proven, false)
})

test('a grid split at other proportions than the recorded one proves no leftover Application group', () => {
  // Arrange
  const group = { viewColumn: 1, tabs: [] }
  const layout = {
    orientation: 0,
    groups: [{ size: 160 }, { size: 320 }, { size: 480 }],
  }

  // Act
  const proven = isApplicationGroupMarkerProven(
    recordedThreeGroupGrid,
    group,
    layout,
  )

  // Assert
  assert.equal(proven, false)
})
