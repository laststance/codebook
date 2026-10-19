import assert from 'node:assert/strict'
import { test } from 'node:test'

import { groupCreatedAtColumn } from '../utils/groupCreatedAtColumn'

test('the group the editor added at the column the captured source was shown in is named as Codebook’s', () => {
  // Arrange
  const claimed = Symbol('claimed Application group'),
    learner = Symbol('learner group'),
    sourceGroup = Symbol('group the editor added')
  const groupsBefore = [
    { viewColumn: 1, identity: claimed },
    { viewColumn: 2, identity: learner },
  ]
  const groupsAfter = [
    { viewColumn: 1, identity: claimed },
    { viewColumn: 2, identity: learner },
    { viewColumn: 3, identity: sourceGroup },
  ]

  // Act
  const created = groupCreatedAtColumn(groupsBefore, groupsAfter, 3)

  // Assert
  assert.equal(created, sourceGroup)
})

test('a learner’s group that stood at the column before the source was shown is never named as Codebook’s', () => {
  // Arrange
  const claimed = Symbol('claimed Application group'),
    learner = Symbol('learner group')
  const groups = [
    { viewColumn: 1, identity: claimed },
    { viewColumn: 2, identity: learner },
  ]

  // Act
  const created = groupCreatedAtColumn(groups, groups, 2)

  // Assert
  assert.equal(created, undefined)
})

test('a learner’s group the editor answered with a new identity at its own column is never named as Codebook’s', () => {
  // Arrange: Cursor gives every group a new object with a tab change; a group named anew still stood at that column before.
  const learner = Symbol('learner group'),
    renamed = Symbol('the same group named anew')
  const groupsBefore = [{ viewColumn: 1, identity: learner }]
  const groupsAfter = [{ viewColumn: 1, identity: renamed }]

  // Act
  const created = groupCreatedAtColumn(groupsBefore, groupsAfter, 1)

  // Assert
  assert.equal(created, undefined)
})

test('a new group at the column that has no identity yet is not named', () => {
  // Arrange
  const learner = Symbol('learner group')
  const groupsBefore = [{ viewColumn: 1, identity: learner }]
  const groupsAfter = [
    { viewColumn: 1, identity: learner },
    { viewColumn: 2, identity: undefined },
  ]

  // Act
  const created = groupCreatedAtColumn(groupsBefore, groupsAfter, 2)

  // Assert
  assert.equal(created, undefined)
})
