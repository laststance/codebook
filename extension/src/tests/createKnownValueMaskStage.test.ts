import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES } from '../constants'
import { createKnownValueMaskStage } from '../utils/createKnownValueMaskStage'

// protects=text held under an infinite holdback is dropped and reported once it passes the pending cap, and nothing is published; fails_when=the held text grows past the cap unreported, or text under the cap is dropped; no_claim=timed release or finite holdbacks (captureProcessOutput tests)
test('held text past the pending cap is dropped and reported under an infinite holdback', () => {
  // Arrange
  const withheld: number[] = []
  const stage = createKnownValueMaskStage({
    mask: (text) => text,
    holdback: () => Number.POSITIVE_INFINITY,
    onWithheld: (bytes) => withheld.push(bytes),
  })
  const chunk = 'x'.repeat(NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES / 2)
  // Act
  const first = stage.write(chunk)
  const second = stage.write(chunk)
  const third = stage.write('y')
  // Assert
  assert.deepEqual([first, second, third], ['', '', ''])
  assert.deepEqual(withheld, [NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES + 1])
  assert.equal(stage.end(), '')
  assert.deepEqual(withheld, [NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES + 1])
})
