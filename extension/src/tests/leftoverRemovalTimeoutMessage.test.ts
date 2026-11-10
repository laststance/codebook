import assert from 'node:assert/strict'
import { test } from 'node:test'

import { leftoverRemovalTimeoutMessage } from '../utils/leftoverRemovalTimeoutMessage'

// Value: protects=the refusal after a leftover Application group was not removed in time names the group count before the close, the count when the bound passed and the bound, each in its place, and tells the learner to open again; fails_when=a count is missing, the two counts are swapped, the bound is missing or the advice is gone; no_claim=that the extension throws it at the bound (the workspace harness covers the call).
test('the leftover removal refusal names the groups before the close, the groups at the bound, the bound and the way on', () => {
  // Arrange
  const groupsBefore = 3
  const groupsNow = 4

  // Act
  const message = leftoverRemovalTimeoutMessage(groupsBefore, groupsNow, 5000)

  // Assert
  assert.equal(
    message,
    'Timed out waiting for leftover Application group removal (groups before the close: 3, now: 4, after 5000 ms). Run "Codebook: Open Study Workspace" again.',
  )
})
