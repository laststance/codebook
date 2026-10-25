import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RetryVitestListingRelease } from '../utils/listVitestTestFiles'
import { releaseVitestListings } from '../utils/releaseVitestListings'

// Value: protects=a run's unreleased Vitest listings being released in the order they failed, every one tried even when an earlier one still fails, a failing one staying for the next stop, and the list emptying once all succeeded; fails_when=a failed retry leaves the list, so the next stop frees the start while a listing may still run, or one listing that still runs keeps the others from being released; why_new=Cycle 0053 /ship review pass 4 (one helper for the service and the owned run) and Step 11 round 2 (Claude adversarial, finding 3: a failing head blocked the rest); seam=scripted retries; no_claim=what a retry does (listVitestTestFiles tests)
test('unreleased listings are each tried in order, and a failing one stays until a later call releases it', async () => {
  // Arrange
  const released: string[] = []
  let secondFails = true
  const second: RetryVitestListingRelease = async () => {
    if (secondFails) throw new Error('process group 4242 still runs')
    released.push('second')
  }
  const unreleased: RetryVitestListingRelease[] = [
    async (): Promise<void> => {
      released.push('first')
    },
    second,
    async (): Promise<void> => {
      released.push('third')
    },
  ]

  // Act
  const firstCall = await releaseVitestListings(unreleased).then(
    () => undefined,
    (error: unknown) => error,
  )
  const leftAfterFailure = [...unreleased]
  secondFails = false
  await releaseVitestListings(unreleased)

  // Assert
  assert.ok(firstCall instanceof Error)
  assert.equal(firstCall.message, 'process group 4242 still runs')
  assert.deepEqual(leftAfterFailure, [second])
  assert.deepEqual(released, ['first', 'third', 'second'])
  assert.equal(unreleased.length, 0)
})

// Value: protects=two overlapping releases of the same list never dropping a retry that failed: each removes only a retry it ran and that succeeded; fails_when=after both awaited the same first retry, one call removes the next retry while the other's run of it fails, so the listing that may still run leaves the list and no later stop releases it; why_new=Cycle 0053 Step 11 round 2 (Claude adversarial, finding 3); seam=a first retry both calls await and a second that fails; no_claim=the service's own serialization of its stops
test('overlapping releases of the same listings keep a retry that failed', async () => {
  // Arrange
  let letFirstEnd!: () => void
  const firstMayEnd = new Promise<void>((resolve) => {
    letFirstEnd = resolve
  })
  const stillRunning: RetryVitestListingRelease = async () => {
    throw new Error('process group 4242 still runs')
  }
  const unreleased: RetryVitestListingRelease[] = [
    async (): Promise<void> => {
      await firstMayEnd
    },
    stillRunning,
  ]

  // Act
  const overlapping = Promise.allSettled([
    releaseVitestListings(unreleased),
    releaseVitestListings(unreleased),
  ])
  letFirstEnd()
  const outcomes = await overlapping

  // Assert
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ['rejected', 'rejected'],
  )
  assert.deepEqual(unreleased, [stillRunning])
})
