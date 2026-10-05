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
