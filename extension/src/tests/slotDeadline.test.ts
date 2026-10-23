import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { type DeadlineTimers, startSlotDeadline } from '../utils/slotDeadline'

/** A clock the test fires by hand: `fire()` runs every timer that is still set. */
function handClock(): DeadlineTimers & { fire(): void } {
  const pending = new Set<() => void>()
  return {
    set: (callback) => {
      pending.add(callback)
      return (): void => {
        pending.delete(callback)
      }
    },
    fire: (): void => {
      for (const callback of [...pending]) {
        pending.delete(callback)
        callback()
      }
    },
  }
}

// Value: protects=a slot show's later steps (the close of the earlier tab, the text wait) that start after the shared bound passed; fails_when=a step whose work is already settled wins the race against the deadline's rejection and the show goes on past its bound; why_new=F378, no test covered slotDeadline's within after the deadline; seam=none
test('refuses a step that starts after the deadline passed, even when its work is already done', async () => {
  // Arrange
  const clock = handClock()
  const deadline = startSlotDeadline(5_000, 'the recorded source', clock)
  clock.fire()

  // Act
  const outcome = deadline.within(Promise.resolve('already shown'))

  // Assert
  await assert.rejects(
    outcome,
    (error: unknown) =>
      error instanceof WaitTimeoutError &&
      error.message.includes('the recorded source'),
  )
  assert.equal(deadline.expired(), true)
})

// Value: protects=the bound over work that is still running when the deadline passes; fails_when=within waits for work past the deadline; why_new=F378 keeps the in-flight case beside the new already-passed case; seam=none
test('refuses in-flight work when the deadline passes first, naming what was waited for', async () => {
  // Arrange
  const clock = handClock()
  const deadline = startSlotDeadline(5_000, 'the recorded source', clock)
  const neverEnds = new Promise<string>(() => undefined)

  // Act
  const outcome = deadline.within(neverEnds, 'the text wait')
  clock.fire()

  // Assert
  await assert.rejects(
    outcome,
    (error: unknown) =>
      error instanceof WaitTimeoutError &&
      error.message.includes('the text wait'),
  )
})

// Value: protects=a slot show that finished in time and cancelled its timer, then closes its earlier tab with the same deadline; fails_when=within hangs on work that ends late because the cancelled deadline never settles; why_new=F378, after cancel the lapse never fires so within(work) raced against a promise that never settles; seam=none
test('returns the work unbounded after the deadline was cancelled', async () => {
  // Arrange
  const clock = handClock()
  const deadline = startSlotDeadline(5_000, 'the recorded source', clock)
  deadline.cancel()
  const lateWork = new Promise<string>((resolve) =>
    setImmediate(() => resolve('closed the earlier tab')),
  )

  // Act
  const result = await deadline.within(lateWork)

  // Assert
  assert.equal(result, 'closed the earlier tab')
  assert.equal(deadline.expired(), false)
})

// Value: protects=the work's own failure reaching the caller while the deadline is running; fails_when=within replaces the work's failure with a timeout or swallows it; why_new=F378 pins the third outcome of within; seam=none
test('rethrows the work failure when it ends before the deadline', async () => {
  // Arrange
  const clock = handClock()
  const deadline = startSlotDeadline(5_000, 'the recorded source', clock)

  // Act
  const outcome = deadline.within(Promise.reject(new Error('tab closed')))

  // Assert
  await assert.rejects(outcome, /tab closed/)
})
