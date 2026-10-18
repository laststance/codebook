import assert from 'node:assert/strict'
import { test } from 'node:test'

import { escapeHtml } from '../utils/escapeHtml'

// Value: protects=every text the reader prints into a served Wiki page or the captured application page; fails_when=one of the five characters that change the meaning of HTML is printed raw, so a source path with an ampersand or a quote breaks the markup it is printed into; why_new=Cycle 0046 row 139 (the utility had no test of its own); seam=none
test('a text with the five characters HTML gives a meaning is escaped to their entities', () => {
  // Arrange: each of the five characters once, among characters that stay as they are.
  const text = `a&b <c> "d" 'e' f/g:1`

  // Act
  const escaped = escapeHtml(text)

  // Assert
  assert.equal(escaped, 'a&amp;b &lt;c&gt; &quot;d&quot; &#39;e&#39; f/g:1')
})
