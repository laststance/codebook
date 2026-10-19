import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cutTextToFit } from '../utils/cutTextToFit'

// Value: protects=a text that already fits its bound, such as a short run failure kept past a refusal, which must reach the journal whole; fails_when=cutTextToFit marks or shortens a text that fits; why_new=Cycle 0046 row 698; seam=none
test('a text that fits its bound is kept whole and unmarked', () => {
  // Arrange
  const reason = 'Selected debugger terminated'

  // Act
  const kept = cutTextToFit(reason, (candidate) => candidate.length <= 64)

  // Assert
  assert.equal(kept, 'Selected debugger terminated')
})

// Value: protects=the bound of a cut text and the reader's sight of the cut: the longest beginning that fits with the marker is kept, and a character outside the Basic Multilingual Plane is never split into half a surrogate pair; fails_when=the cut text passes its bound, loses the marker, keeps less than fits, or ends in a lone surrogate; why_new=Cycle 0046 row 698; seam=none
test('a text longer than its bound keeps its longest beginning that fits with the cut marker, and splits no character', () => {
  // Arrange: four emoji of two UTF-16 units each, then plain letters.
  const text = '😀😀😀😀abcdef'

  // Act: the bound counts UTF-16 units, so a cut inside an emoji would look shorter than it is.
  const cut = cutTextToFit(text, (candidate) => candidate.length <= 12)

  // Assert: two emoji (4 units) and the 7-unit marker fit; a third emoji would make 13.
  assert.equal(cut, '😀😀… [cut]')
})
