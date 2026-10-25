import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decideNodeTestRootClaim } from '../utils/decideNodeTestRootClaim'

// Value: protects=the root claim's choice from a finished root listing: exactly one selection keeps root mode, zero or several move the test to its package; fails_when=a test the root selects once moves to its package, or one it selects zero times or twice stays at the root; why_new=CEO review root claim (decideNodeTestRootClaim, task 2); seam=none; no_claim=how the selections are counted (partitionListedTestFiles)
test('a root listing that selects the cited test once keeps root mode, and zero or two selections choose the package', () => {
  // Arrange
  const counts = [1, 0, 2]

  // Act
  const decisions = counts.map((citedCount) =>
    decideNodeTestRootClaim({ outcome: 'listed', citedCount }),
  )

  // Assert
  assert.deepEqual(decisions, [
    { mode: 'root', rootClaim: 'selected-once' },
    { mode: 'package', rootClaim: 'not-selected' },
    { mode: 'package', rootClaim: 'several-projects' },
  ])
})

// Value: protects=only a clean listing failure falling back to package mode; fails_when=a failure Vitest itself reported refuses the start, so a root config that cannot list the package test blocks it; why_new=Eng review (only a clean failure falls back); seam=none; no_claim=what counts as clean (listVitestForRootClaim)
test('a root listing that Vitest itself failed leaves the test in its package', () => {
  // Arrange
  const error = new Error(
    'Vitest could not list the cited test file (exit code 1)',
  )

  // Act
  const decision = decideNodeTestRootClaim({ outcome: 'failed', error })

  // Assert
  assert.deepEqual(decision, { mode: 'package', rootClaim: 'listing-failed' })
})

// Value: protects=a cancelled, timed-out or unconfirmed root listing refusing the start with its own error; fails_when=one of them falls back to package mode while a listing process may still run or the learner stopped the start; why_new=Eng review (H5 refusals); seam=none; no_claim=the run's journal of the refusal
test('a root listing that was cancelled, timed out or left its process group unconfirmed is a refusal, not a fallback', () => {
  // Arrange
  const outcomes = ['cancelled', 'deadline', 'unconfirmed'] as const

  // Act
  const decisions = outcomes.map((outcome) => {
    const error = new Error(outcome)
    const decision = decideNodeTestRootClaim({ outcome, error })
    return decision.mode === 'refused' && decision.refusal === error
  })

  // Assert
  assert.deepEqual(decisions, [true, true, true])
})

// Value: protects=a root listing Codebook could not run (its folder, the spawn or a file read failed) refusing the start with its own error instead of falling back; fails_when=such a host failure leaves the test in its package as if Vitest had failed cleanly; why_new=Cycle 0053 Step 11 round 2 (Claude adversarial, finding 1); seam=none; no_claim=which errors are host failures (listVitestForRootClaim tests)
test('a root listing Codebook could not run is a refusal, not a fallback', () => {
  // Arrange
  const error = new Error(
    'Vitest could not list packages/a/src/a.test.ts from the repository root (Error: spawn ENOENT). The test was not started; start it again.',
  )

  // Act
  const decision = decideNodeTestRootClaim({ outcome: 'error', error })

  // Assert
  assert.deepEqual(decision, { mode: 'refused', refusal: error })
})
