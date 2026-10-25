import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RetryVitestListingRelease } from '../utils/listVitestTestFiles'
import { releaseVitestListings } from '../utils/releaseVitestListings'

// Value: protects=a run's unreleased Vitest listings being released in the order they failed, a failing one staying with every one after it for the next stop, and the list emptying once all succeeded; fails_when=a failed retry leaves the list, so the next stop frees the start while a listing may still run, or a later retry runs before an earlier one is released; why_new=Cycle 0053 /ship review pass 4 (the service and the owned run each drained the list in their own loop); seam=scripted retries; no_claim=what a retry does (listVitestTestFiles tests)
test('unreleased listings are released in order, and a failing one stays with those after it until a later call releases them', async () => {
  // Arrange
  const released: string[] = []
  let secondFails = true
  const unreleased: RetryVitestListingRelease[] = [
    async (): Promise<void> => {
      released.push('first')
    },
    async (): Promise<void> => {
      if (secondFails) throw new Error('process group 4242 still runs')
      released.push('second')
    },
    async (): Promise<void> => {
      released.push('third')
    },
  ]

  // Act
  const firstCall = await releaseVitestListings(unreleased).then(
    () => undefined,
    (error: unknown) => error,
  )
  const leftAfterFailure = unreleased.length
  secondFails = false
  await releaseVitestListings(unreleased)

  // Assert
  assert.ok(firstCall instanceof Error)
  assert.equal(firstCall.message, 'process group 4242 still runs')
  assert.equal(leftAfterFailure, 2)
  assert.deepEqual(released, ['first', 'second', 'third'])
  assert.equal(unreleased.length, 0)
})
