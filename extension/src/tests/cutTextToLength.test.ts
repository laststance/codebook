import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cutTextToLength } from '../utils/cutTextToLength'

// protects=a text over the bound is cut to exactly the bound and a shorter one is untouched; fails_when=the cut is off by one or alters a fitting text; no_claim=a cut marker (none is added)
test('a long text is cut to exactly the bound and a fitting text is unchanged', () => {
  // Arrange
  const long = 'x'.repeat(5_000)

  // Act
  const cut = cutTextToLength(long, 2_048)
  const kept = cutTextToLength('short', 2_048)

  // Assert
  assert.equal(cut.length, 2_048)
  assert.equal(kept, 'short')
})

// protects=a surrogate pair straddling the bound is dropped whole; fails_when=a lone high surrogate is left at the end; no_claim=none
test('an astral character at the bound is dropped whole instead of split', () => {
  // Arrange
  const text = `ab\u{1F600}cd`

  // Act
  const cut = cutTextToLength(text, 3)
  const exact = cutTextToLength(text, 4)

  // Assert
  assert.equal(cut, 'ab')
  assert.equal(exact, 'ab\u{1F600}')
})
