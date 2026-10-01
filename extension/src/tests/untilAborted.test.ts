import assert from 'node:assert/strict'
import { test } from 'node:test'

import { untilAborted } from '../utils/untilAborted'

// Value: protects=a presentation cancelled before any shared startup or retirement exists failing through its promise chain; fails_when=untilAborted throws synchronously for a missing operation and an aborted signal; why_new=Cycle 0033 M1 (h); seam=none
test('a cancelled waiter with no shared operation receives a rejection it can catch instead of a synchronous throw', async () => {
  // Arrange
  const cancelled = new AbortController()
  cancelled.abort(new Error('Playback presentation superseded'))
  let thrownSynchronously = false
  let waiting: Promise<unknown> = Promise.resolve()

  // Act
  try {
    waiting = untilAborted(undefined, cancelled.signal)
  } catch {
    thrownSynchronously = true
  }

  // Assert
  assert.equal(thrownSynchronously, false)
  await assert.rejects(waiting, /Playback presentation superseded/)
})

// Value: protects=a waiter that is still current passing through when nothing shared is pending; fails_when=the missing-operation branch rejects or waits for an unaborted signal; why_new=Cycle 0033 M1 (h) companion; seam=none
test('a current waiter with no shared operation continues at once', async () => {
  // Arrange
  const current = new AbortController()

  // Act
  const outcome = await untilAborted(undefined, current.signal)

  // Assert
  assert.equal(outcome, undefined)
})
