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

// Value: protects=the capture-reason line shows no terminal tail, C1 or bidirectional control; fails_when=the `[31m` tail of a color sequence, a U+0085 or a U+202E reaches the line; why_new=F288 (only C0 and DEL were replaced); seam=none; no_claim=the sentence's wording
test('a capture reason loses color sequences, C1 controls and bidirectional controls', () => {
  // Arrange
  const reason = 'Interrupted \u001b[31mby\u001b[0m disk\u0085 error\u202E EIO'

  // Act
  const words = wordNodeCaptureReason(reason)

  // Assert
  assert.equal(words, 'Interrupted by disk error EIO')
})

// Value: protects=the 240-character cut never leaves half of an emoji (a lone surrogate) in the line; fails_when=the cut falls between the two UTF-16 units of a pair; why_new=F288; seam=none; no_claim=the length of an ordinary cut
test('a capture reason cut inside an emoji drops the whole emoji before the ellipsis', () => {
  // Arrange
  const reason = `${'x'.repeat(238)}😀${'y'.repeat(20)}`

  // Act
  const words = wordNodeCaptureReason(reason)

  // Assert
  assert.equal(words, `X${'x'.repeat(237)}…`)
})

// Value: protects=each of the four stored spellings of a history reaches the learner as test replay words, in its number: "Node test history", "Node test histories", "Node history" and "Node histories"; fails_when=one spelling keeps "Node" (the expression loses its optional "test " or its plural), or a plural reads as one test replay; why_new=F319 (PR-2 /ship Step 7 re-entry): F316 joined the two expressions, and only "node history" and "Node test histories" were asserted; seam=none; no_claim=the rest of the sentence
test('a capture reason reads each spelling of Node history as test replay words in its number', () => {
  // Arrange
  const reason =
    'Node test history ended; Node test histories, Node history and Node histories kept'

  // Act
  const words = wordNodeCaptureReason(reason)

  // Assert
  assert.equal(
    words,
    'Test replay ended; test replays, test replay and test replays kept',
  )
})
