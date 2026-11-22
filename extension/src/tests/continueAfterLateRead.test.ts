import assert from 'node:assert/strict'
import { test } from 'node:test'

import { continueAfterLateRead } from '../utils/continueAfterLateRead'

import { defer } from './utils/defer'
import { within } from './utils/within'

// Value: protects=a mark read that settled between the start budget's expiry and the attachment of the late mark still marks the window (Cycle 0146 task 1c, Codex finding 6); fails_when=a read that already settled is missed, so the continuation never runs, or it runs twice; no_claim=what the continuation does (a counter stands in for the descriptor sync)
test('a late read that settled before the continuation was attached still runs it exactly once', async () => {
  // Arrange
  const lateRead = Promise.resolve('installation-a')
  await lateRead
  let applied = 0
  // Act
  const answer = await within(
    continueAfterLateRead(lateRead, () => {
      applied += 1
      return 'marked'
    }),
    2_000,
  )
  // Assert
  assert.equal(answer, 'marked')
  assert.equal(applied, 1)
})

// Value: protects=the late mark waits for the read that outlived the start budget, so it decides on storage that answered; fails_when=the continuation runs before the read settled; no_claim=how long a real read takes
test('a late read still in flight runs the continuation only after it settles', async () => {
  // Arrange
  const lateRead = defer<string>()
  let applied = 0
  const continuation = continueAfterLateRead(lateRead.promise, () => {
    applied += 1
    return 'marked'
  })
  // Act
  const beforeSettle = await within(continuation, 50)
  const appliedBeforeSettle = applied
  lateRead.resolve('installation-a')
  const afterSettle = await within(continuation, 2_000)
  // Assert
  assert.equal(beforeSettle, 'still waiting')
  assert.equal(appliedBeforeSettle, 0)
  assert.equal(afterSettle, 'marked')
  assert.equal(applied, 1)
})

// Value: protects=a late read that failed still runs the continuation, which reads afresh, so a transient failure never leaves the window unmarked for the whole run; fails_when=the read's rejection skips the continuation or reaches the caller; no_claim=which errors a real read gives
test('a late read that failed still runs the continuation once and answers its result', async () => {
  // Arrange
  const lateRead = Promise.reject(new Error('EIO'))
  lateRead.catch(() => undefined)
  let applied = 0
  // Act
  const answer = await within(
    continueAfterLateRead(lateRead, async () => {
      applied += 1
      return 'unmarked'
    }),
    2_000,
  )
  // Assert
  assert.equal(answer, 'unmarked')
  assert.equal(applied, 1)
})

// Value: protects=a continuation that fails reaches its caller, which reports it; fails_when=the failure is swallowed; no_claim=how the caller reports it
test('a continuation that fails rejects with its own error', async () => {
  // Arrange
  const lateRead = Promise.resolve('installation-a')
  // Act
  const failure = await continueAfterLateRead(lateRead, async () => {
    throw new Error('Injected descriptor write failure')
  }).then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : 'other'),
  )
  // Assert
  assert.equal(failure, 'Injected descriptor write failure')
})
