import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isSurrogatePairAt } from '../utils/isSurrogatePairAt'

// Value: protects=one character outside the Basic Multilingual Plane (an emoji, a rare kanji) is one code point to every count and cut of recorded text: a pair starts only at a high unit followed by a low one; fails_when=a lone high or low unit, a low unit before a high one, a high unit before a unit above the low range, or an offset outside the text reads as a pair, so a count drops a character or a cut keeps half of one; why_new=F328 (PR-2 /ship Step 9 pass 2 simplification): four copies of the check became this one; seam=none; no_claim=how each caller uses the answer (their own tests)
test('a surrogate pair starts only at a high unit followed by a low one', () => {
  // Arrange
  const text = `a\u{1F600}b\uD83D\uDE00\uDE00\uD83Dc\uD83D\uE000`

  // Act
  const startsOfPairs = Array.from({ length: text.length + 2 }, (_, offset) =>
    isSurrogatePairAt(text, offset - 1),
  )

  // Assert: offsets -1 to 11 of 'a', a pair (1-2), 'b', a pair (4-5), a lone low (6), a lone high (7), 'c' (8), and a high unit (9) before U+E000 (10), a unit above the low range.
  assert.deepEqual(startsOfPairs, [
    false,
    false,
    true,
    false,
    false,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ])
})
