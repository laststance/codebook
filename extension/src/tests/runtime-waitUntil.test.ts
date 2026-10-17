import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

// Cycle 0045 (ST-16, PC-2.8): the run-level tests end a binding wait through a seam and assert the 20 s budget the run hands to it; this test lets a wait's budget pass in real time, so the deadline itself stays tested.
test('a wait whose condition never holds ends when its budget has passed, naming what it waited for', async () => {
  // Arrange: a condition that never holds and a budget of 120 ms.
  const startedMs = performance.now()
  // Act
  const outcome = await waitUntil(() => false, 'a verified binding', 120).then(
    () => 'held',
    (error: unknown) => String(error),
  )
  const elapsedMs = performance.now() - startedMs
  // Assert: the wait did not end before its budget.
  assert.equal(outcome, 'Error: Timed out waiting for a verified binding')
  assert.equal(elapsedMs >= 120, true)
})

// Value: protects=a caller that tells why it gave up a wait (a run stopped, a launch cancelled) and reads that reason from the wait's failure: an abort during the pause between two reads rejects with the signal's own reason, as an abort before or after a read does (AD16, /ship adversarial review Step 11); fails_when=the pause's own AbortError ("The operation was aborted") reaches the caller instead of its reason; why_new=every abort test aborted before a read; seam=a read that never holds and a signal aborted by the test during the pause, on the real clock
test('a wait aborted during its pause between two reads rejects with the signal’s own reason', async () => {
  // Arrange: a condition that never holds, a 500 ms pause, and a signal aborted 100 ms into the first pause.
  const controller = new AbortController()
  const reason = new Error('run stopped')
  setTimeout(() => controller.abort(reason), 100)
  // Act
  const failure = await waitUntil(
    () => false,
    'a verified binding',
    20_000,
    controller.signal,
    500,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(failure, reason)
})
