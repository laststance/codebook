import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createManualClock } from './utils/createManualClock'
import { createSourceBoundWaitHold } from './utils/createSourceBoundWaitHold'

// Value: protects=deadline tests firing a run's timers as real time would; fails_when=a timer cleared by an earlier callback of the same advance still fires, or timers fire in the order they were set instead of the order they fall due; why_new=Cycle 0043 R15 (the clock fired a snapshot in insertion order); seam=none
test('a manual clock fires due timers in the order they fall due and never one an earlier callback cleared', () => {
  // Arrange: the later-due timer is set first; the first to fall due clears a third one.
  const clock = createManualClock(),
    fired: string[] = []
  clock.setTimeout(() => fired.push('due at 20 s'), 20_000)
  const clearedId = clock.setTimeout(() => fired.push('cleared'), 15_000)
  clock.setTimeout(() => {
    fired.push('due at 10 s')
    clock.clearTimeout(clearedId)
  }, 10_000)
  clock.setTimeout(() => fired.push('due at 30 s'), 30_000)
  // Act
  clock.advance(20_000)
  // Assert
  assert.deepEqual(fired, ['due at 10 s', 'due at 20 s'])
})

// Value: protects=a held wait for a stop's own pause never spinning forever when nothing can cancel it; fails_when=a held wait without an abort signal loops on setImmediate until the test runner's timeout; why_new=Cycle 0043 O7 (the loop was written twice and `signal` was optional); seam=none
test('a held wait without an abort signal ends as a timeout at its turn limit instead of hanging, and one whose pause arrives returns it', async () => {
  // Arrange
  const hold = createSourceBoundWaitHold(3)
  hold.hold()
  let looks = 0
  // Act
  const arriving = await hold.wait(
    () => (++looks === 2 ? 'paused' : undefined),
    'source-bound CDP stop',
  )
  // Assert
  assert.equal(arriving, 'paused')
  assert.equal(hold.holds('source-bound CDP stop'), true)
  assert.equal(hold.holds('configured before conditions'), false)
  await assert.rejects(
    hold.wait(() => undefined, 'source-bound CDP stop'),
    /Timed out waiting for source-bound CDP stop/,
  )
})

// Value: protects=a held wait ending at once when its run is cancelled; fails_when=an aborted signal is not read and the wait keeps looking; why_new=Cycle 0043 O7; seam=none
test('a held wait with an abort signal looks until the run is cancelled', async () => {
  // Arrange
  const hold = createSourceBoundWaitHold(1),
    cancellation = new AbortController()
  hold.hold()
  let looks = 0
  // Act: the run is cancelled at the fifth look, past the turn limit of a wait without a signal.
  const waiting = hold.wait(
    () => {
      if (++looks === 5) cancellation.abort(new Error('run stopped'))
      return undefined
    },
    'source-bound CDP stop',
    cancellation.signal,
  )
  // Assert
  await assert.rejects(waiting, /run stopped/)
  assert.equal(looks, 5)
})
