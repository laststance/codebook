import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitForWikiOutputChange } from '../utils/waitForWikiOutputChange'

// Value: protects=the sign Codebook itself sees at the Wiki's output; fails_when=a stamp that stays the same counts as a change, or a changed one is not reported; why_new=Cycle 0046 row 146; seam=the stamp reader and a sleep that returns at once
test('the wait ends as changed at the first look whose stamp differs from the first one, after it looked three times at an unchanged output', async () => {
  // Arrange: the stamp at the start, the same stamp at two looks, then another one.
  const stamps = ['a@1', 'a@1', 'a@1', 'b@2']
  let looks = 0
  const sleptMs: number[] = []

  // Act
  const didChange = await waitForWikiOutputChange({
    readStamp: async () => stamps[looks++] ?? 'b@2',
    pollMs: 2_000,
    signal: new AbortController().signal,
    sleep: async (delayMs) => {
      sleptMs.push(delayMs)
    },
  })

  // Assert
  assert.equal(didChange, true)
  assert.equal(looks, 4)
  assert.deepEqual(sleptMs, [2_000, 2_000, 2_000])
})

// Value: protects=the end of the looks when the start of an update has ended; fails_when=the wait goes on reading the output every two seconds for good, or reports a change that came after the abort; why_new=Cycle 0046 row 146; seam=the stamp reader and a sleep that ends at the abort
test('the wait ends as unchanged when its signal aborts, also when the output changed in the same moment', async () => {
  // Arrange: the abort comes during the first sleep, and the next look finds another stamp.
  const stamps = ['a@1', 'b@2']
  let looks = 0
  const ending = new AbortController()

  // Act
  const didChange = await waitForWikiOutputChange({
    readStamp: async () => stamps[looks++] ?? 'b@2',
    pollMs: 2_000,
    signal: ending.signal,
    sleep: async () => {
      ending.abort()
    },
  })

  // Assert
  assert.equal(didChange, false)
})
