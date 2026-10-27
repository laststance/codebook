import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  failedPlacementChecks,
  type PlacementChecks,
} from '../utils/failedPlacementChecks'

const ALL_SAME: PlacementChecks = {
  groups: true,
  panePositions: true,
  focusGroup: true,
  webviewTab: true,
  closeRevision: true,
  source: true,
  appActive: true,
  contextActive: true,
}

// Value: protects=a refusal's report names every comparison that failed, in report order, with the words the native take reads; fails_when=a failed comparison is left out or renamed; why_new=Cycle 0056 task 17 stage 1; seam=none; no_claim=how the guard computes each comparison
test('names every failed comparison of a guard that retains the focus', () => {
  // Arrange
  const checks: PlacementChecks = {
    groups: false,
    panePositions: false,
    focusGroup: false,
    webviewTab: false,
    closeRevision: false,
    source: false,
    appActive: false,
    contextActive: false,
  }

  // Act
  const failed = failedPlacementChecks(checks, true)

  // Assert
  assert.deepEqual(failed, [
    'groups',
    'pane positions',
    'focus group',
    'webview tab',
    'close revision',
    'source',
    'app active',
    'context active',
  ])
})

// Value: protects=a guard that does not retain the focus is refused only by the groups and the pane positions, as before; fails_when=a changed focus comparison is reported (or refuses) for such a guard; why_new=Cycle 0056 task 17 stage 1; seam=none; no_claim=the guard's own decision
test('ignores the focus comparisons for a guard that retains no focus', () => {
  // Arrange
  const checks: PlacementChecks = {
    ...ALL_SAME,
    panePositions: false,
    focusGroup: false,
    source: false,
  }

  // Act
  const failed = failedPlacementChecks(checks, false)

  // Assert
  assert.deepEqual(failed, ['pane positions'])
})

// Value: protects=a guard whose comparisons all hold passes; fails_when=a passing guard reports a failed comparison; why_new=Cycle 0056 task 17 stage 1; seam=none; no_claim=the refusal itself
test('names nothing when every comparison holds', () => {
  // Arrange
  const checks = ALL_SAME

  // Act
  const failed = failedPlacementChecks(checks, true)

  // Assert
  assert.deepEqual(failed, [])
})
