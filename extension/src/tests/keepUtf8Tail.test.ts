import assert from 'node:assert/strict'
import { test } from 'node:test'

import { keepUtf8Tail } from '../utils/keepUtf8Tail'

// Value: protects=a bounded output tail starts at a whole character (pt1 pass 2 red-team appendix: a byte cut inside a character put U+FFFD at the tail's start); fails_when=a cut inside a multibyte character yields U+FFFD or more bytes than the limit; why_new=the tails of captureProcessOutput and the dev server's published log now cut through this; seam=none; no_claim=grapheme clusters (cut by code points)
test('an output tail cut inside a multibyte character starts at the next whole character within the byte limit', () => {
  // Arrange
  const text = 'log: café ok'
  // Act
  const fitting = keepUtf8Tail(text, 64)
  const cutInsideE = keepUtf8Tail(text, 4)
  const cutBeforeE = keepUtf8Tail(text, 5)
  // Assert
  assert.equal(fitting, 'log: café ok')
  assert.equal(cutInsideE, ' ok')
  assert.equal(cutBeforeE, 'é ok')
})
