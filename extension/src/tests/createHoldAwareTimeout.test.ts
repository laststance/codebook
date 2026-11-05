import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createHoldAwareTimeout } from '../utils/createHoldAwareTimeout'

test('a held timeout stays quiet past its bound and fires after the remaining time once released', (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let nowMs = 0
  const timeout = createHoldAwareTimeout(90_000, () => nowMs)
  // Act: 30 s run, then the pause is held for 100 s
  nowMs = 30_000
  context.mock.timers.tick(30_000)
  timeout.hold()
  nowMs = 130_000
  context.mock.timers.tick(100_000)
  const quietWhileHeld = timeout.signal.aborted
  timeout.release()
  context.mock.timers.tick(59_999)
  const quietBeforeRemainder = timeout.signal.aborted
  context.mock.timers.tick(1)
  // Assert
  assert.deepEqual(
    [quietWhileHeld, quietBeforeRemainder, timeout.signal.aborted],
    [false, false, true],
  )
  assert.equal((timeout.signal.reason as Error).name, 'TimeoutError')
})

test('a disposed timeout never fires', (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const timeout = createHoldAwareTimeout(1_000)
  // Act
  timeout.dispose()
  context.mock.timers.tick(5_000)
  // Assert
  assert.equal(timeout.signal.aborted, false)
})

// Value: protects=cleanup (a held pause continued after the run ended): a timeout disposed while held never starts counting again when the late release arrives; fails_when=release restarts the timer and aborts a signal nobody reads after cleanup; no_claim=the run's own cleanup order
test('a timeout disposed while held stays quiet when a late release arrives', (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let nowMs = 0
  const timeout = createHoldAwareTimeout(1_000, () => nowMs)
  timeout.hold()
  // Act
  timeout.dispose()
  timeout.release()
  nowMs = 5_000
  context.mock.timers.tick(5_000)
  // Assert
  assert.equal(timeout.signal.aborted, false)
})
