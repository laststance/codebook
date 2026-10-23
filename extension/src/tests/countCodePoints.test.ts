import assert from 'node:assert/strict'
import { test } from 'node:test'

import { countCodePoints } from '../utils/countCodePoints'

// Value: protects=the output index sizes each part of a line in code points as the learner's characters: a surrogate pair inside the part counts once, and a lone half of a pair (a part that starts or ends inside a pair) counts as one, as Array.from counts it; fails_when=a pair counts as two (the kept tail and the "earlier characters not shown" count drift by one per emoji) or a lone half is dropped; why_new=F333 (PR-2 /ship Step 7 re-entry): the count had no direct test, only the output tail's tests through it; seam=none; no_claim=how the index joins parts across entries (F291's tests)
test('a part counts a surrogate pair inside it once and a lone half of a pair as one', () => {
  // Arrange: 'a', a pair (1-2), 'b', a lone high surrogate (4).
  const text = `a😀b\uD83D`

  // Act
  const counts = [
    countCodePoints(text, 0, 5),
    countCodePoints(text, 1, 3),
    countCodePoints(text, 0, 2),
    countCodePoints(text, 2, 4),
    countCodePoints(text, 4, 5),
    countCodePoints(text, 3, 3),
  ]

  // Assert
  assert.deepEqual(counts, [4, 1, 2, 2, 1, 0])
})
