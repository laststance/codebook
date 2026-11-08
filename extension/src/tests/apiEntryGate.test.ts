import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiEntryGate } from '../utils/apiEntryGate'

// Value: protects=E1 thread 0: js-debug's real Node entry pause has thread id 0 and the gate continues exactly that thread; fails_when=the release waits on the id's truthiness, never sees thread 0 and times out; no_claim=the 45 s attach bound
test('the entry pause of thread 0 is continued once with thread 0', async () => {
  // Arrange
  const gate = new ApiEntryGate()
  const sent: number[] = []
  assert.equal(gate.capture('child', 0), true)
  // Act
  await gate.release(
    'child',
    async (threadId) => {
      sent.push(threadId)
    },
    AbortSignal.timeout(2_000),
  )
  // Assert
  assert.deepEqual(
    { sent, releases: gate.releaseCount, released: gate.isReleased },
    { sent: [0], releases: 1, released: true },
  )
})

// Value: protects=E1 thread 0: an entry pause that arrives after the release started waiting is still continued when its thread is 0; fails_when=the late thread 0 is taken for absent; no_claim=js-debug's real event order
test('an entry pause of thread 0 that arrives during the wait is continued', async () => {
  // Arrange
  const gate = new ApiEntryGate()
  const sent: number[] = []
  const release = gate.release(
    'child',
    async (threadId) => {
      sent.push(threadId)
    },
    AbortSignal.timeout(2_000),
  )
  // Act
  gate.capture('child', 0)
  await release
  // Assert
  assert.deepEqual(sent, [0])
})
