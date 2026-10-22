import assert from 'node:assert/strict'
import { test } from 'node:test'

import { wordNodeCaptureReason } from '../utils/wordNodeCaptureReason'

// Value: protects=a stored capture reason reaches the learner as one short sentence in test replay words; fails_when=a line break or control character survives, "Node history" or "Node test history" stays in the sentence, or a long reason is shown whole; why_new=F130 shows the reason again under the Study status; seam=none; no_claim=where the reason comes from
test('a capture reason becomes one capitalized sentence without Node words, line breaks or length beyond 240 characters', () => {
  // Arrange
  const long = 'x'.repeat(300)

  // Act
  const words = wordNodeCaptureReason(
    'node history ended\r\nafter the Node test histories closed',
  )
  const cut = wordNodeCaptureReason(long)

  // Assert
  assert.equal(words, 'Test replay ended after the test replays closed')
  assert.equal(cut?.length, 240)
  assert.equal(cut?.endsWith('…'), true)
  assert.equal(wordNodeCaptureReason(undefined), undefined)
  assert.equal(wordNodeCaptureReason('  \n '), undefined)
})
