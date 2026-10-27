import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RunningTimeLimit } from '../utils/runningTimeLimit'
import type { RunClock } from '../utils/runningTimeLimit'

/**
 * Builds a hand-moved {@link RunClock} for the limit's tests: `advance` fires the armed timer once its delay passed.
 * Why: the limit's timers must be driven without real time. Called by the tests in this file.
 * @returns The clock and `advance(ms)`, which moves `now()` forward and runs the armed callback when due.
 * @example
 * const { clock, advance } = createClock()
 * clock.set(() => fired.push(true), 100)
 * advance(100) // fired is [true]; clock.now() is 100
 */
function createClock() {
  let nowMs = 0
  let timer: { at: number; callback: () => void } | undefined
  const clock: RunClock = {
    now: () => nowMs,
    set: (callback, delayMs) => {
      const armed = { at: nowMs + delayMs, callback }
      timer = armed
      return (): void => {
        if (timer === armed) timer = undefined
      }
    },
  }
  return {
    clock,
    advance(ms: number): void {
      nowMs += ms
      const due = timer
      if (due && due.at <= nowMs) {
        timer = undefined
        due.callback()
      }
    },
  }
}

// protects=a pause held before the work began keeps the request's clock off until released; fails_when=start arms the timer under a standing hold; no_claim=real timers
test('a hold taken before start keeps the limit from counting until it is released', () => {
  // Arrange
  const { clock, advance } = createClock()
  let expired = 0
  const limit = new RunningTimeLimit(1000, clock, () => (expired += 1))
  // Act
  limit.hold()
  limit.start()
  advance(5000)
  const expiredWhileHeld = expired
  limit.release()
  advance(999)
  const expiredBeforeLimit = expired
  advance(1)
  // Assert
  assert.equal(expiredWhileHeld, 0)
  assert.equal(expiredBeforeLimit, 0)
  assert.equal(expired, 1)
})

// protects=a second start never restarts or doubles the count; fails_when=the second start re-arms the full limit or fires the expiry twice; no_claim=real timers
test('a second start does not restart the count and the limit expires once', () => {
  // Arrange
  const { clock, advance } = createClock()
  let expired = 0
  const limit = new RunningTimeLimit(1000, clock, () => (expired += 1))
  limit.start()
  advance(400)
  // Act
  limit.start()
  advance(599)
  const expiredBeforeLimit = expired
  advance(1)
  advance(5000)
  // Assert
  assert.equal(expiredBeforeLimit, 0)
  assert.equal(expired, 1)
})

// protects=an unmatched release never lets a later hold be released for free; fails_when=release without a hold leaves a negative hold count so the next hold does not stop the count; no_claim=real timers
test('a release without a hold changes nothing and the next hold still stops the count', () => {
  // Arrange
  const { clock, advance } = createClock()
  let expired = 0
  const limit = new RunningTimeLimit(1000, clock, () => (expired += 1))
  limit.release()
  limit.start()
  advance(400)
  // Act
  limit.hold()
  advance(5000)
  const expiredWhileHeld = expired
  limit.release()
  advance(599)
  const expiredBeforeLimit = expired
  advance(1)
  // Assert
  assert.equal(expiredWhileHeld, 0)
  assert.equal(expiredBeforeLimit, 0)
  assert.equal(expired, 1)
})

// protects=a restart counts from zero and the old timer is gone; fails_when=the stopped time is carried over or the old timer still fires; no_claim=real timers
test('a start after stop counts running time from zero', () => {
  // Arrange
  const { clock, advance } = createClock()
  let expired = 0
  const limit = new RunningTimeLimit(1000, clock, () => (expired += 1))
  limit.start()
  advance(600)
  limit.stop()
  advance(10_000)
  const expiredWhileStopped = expired
  // Act
  limit.start()
  advance(999)
  const expiredBeforeLimit = expired
  const hasTimeLeft = limit.hasTimeLeft()
  advance(1)
  // Assert
  assert.equal(expiredWhileStopped, 0)
  assert.equal(expiredBeforeLimit, 0)
  assert.equal(hasTimeLeft, true)
  assert.equal(expired, 1)
})

// protects=a pause held after the limit stopped still keeps a later start from arming; fails_when=start arms the timer under a standing hold; no_claim=real timers
test('a hold after stop keeps a later start from arming until it is released', () => {
  // Arrange
  const { clock, advance } = createClock()
  let expired = 0
  const limit = new RunningTimeLimit(1000, clock, () => (expired += 1))
  limit.start()
  limit.stop()
  // Act
  limit.hold()
  limit.start()
  advance(5000)
  const expiredWhileHeld = expired
  limit.release()
  advance(999)
  const expiredBeforeLimit = expired
  advance(1)
  // Assert
  assert.equal(expiredWhileHeld, 0)
  assert.equal(expiredBeforeLimit, 0)
  assert.equal(expired, 1)
})
