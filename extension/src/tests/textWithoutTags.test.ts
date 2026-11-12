import assert from 'node:assert/strict'
import { test } from 'node:test'

import { textWithoutTags } from '../utils/textWithoutTags'

// Value: protects=the text a Wiki page summary keeps from its markup: each tag becomes a space, the words between tags stay, and character references are left for the caller to decode; fails_when=a tag's name or attributes leak into the text, or words next to a tag run together; why_new=Cycle 0119 review round (linear tag stripping for the page guide); seam=none (the real function); no_claim=how a browser would render the same markup
test('tags become spaces and the words between them stay', () => {
  // Arrange
  const html = 'Fetches <code class="name">data</code> once &amp; caches.'

  // Act
  const text = textWithoutTags(html)

  // Assert
  assert.equal(text, 'Fetches  data  once &amp; caches.')
})

// Value: protects=a summary taken from markup with an unfinished tag: the text ends where the unfinished tag starts, so its attributes and the rest never reach the route request; fails_when=the text after a `<` without a `>` is kept, so the summary holds stray markup; why_new=Cycle 0119 review round (linear tag stripping for the page guide); seam=none (the real function); no_claim=that a browser drops the same text
test('a tag that never closes ends the text where it starts', () => {
  // Arrange
  const html = 'Starts here <b class="never closed and more words'

  // Act
  const text = textWithoutTags(html)

  // Assert
  assert.equal(text, 'Starts here  ')
})
