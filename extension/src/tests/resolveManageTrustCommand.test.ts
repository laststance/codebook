import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveManageTrustCommand } from '../utils/resolveManageTrustCommand'

// Value: protects=the manage-trust id decision (assumed ids workbench.trust.manage and workbench.action.manageTrust); fails_when=the first known id is not preferred, an id the editor does not list is returned, or an editor with none gets one; no_claim=that either id exists in Cursor (native trial); seam=the pure function
test('the manage-trust command is the first known id the editor lists, and none when it lists none', () => {
  // Arrange
  const both = ['x', 'workbench.action.manageTrust', 'workbench.trust.manage']
  const onlySecond = ['workbench.action.manageTrust']

  // Act
  const picks = [
    resolveManageTrustCommand(both),
    resolveManageTrustCommand(onlySecond),
    resolveManageTrustCommand(['other']),
  ]

  // Assert
  assert.deepEqual(picks, [
    'workbench.trust.manage',
    'workbench.action.manageTrust',
    undefined,
  ])
})
