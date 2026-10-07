import assert from 'node:assert/strict'
import { test } from 'node:test'

import { escapeHtml } from '../utils/escapeHtml'
import { unescapeHtml } from '../utils/unescapeHtml'

// Value: protects=every text the reader prints into a served Wiki page or the captured application page, and every address it reads back out of a published page; fails_when=one of the five characters that change the meaning of HTML is printed raw, or an entity is read back as another character or twice, so a source path with an ampersand opens another file than the page names; why_new=Cycle 0046 row 139 (the two utilities had no test of their own); seam=none
test('a text with the five characters HTML gives a meaning is escaped to their entities and read back unchanged', () => {
  // Arrange: each of the five characters once, among characters that stay as they are.
  const text = `a&b <c> "d" 'e' f/g:1`

  // Act
  const escaped = escapeHtml(text)
  const readBack = unescapeHtml(escaped)

  // Assert
  assert.equal(escaped, 'a&amp;b &lt;c&gt; &quot;d&quot; &#39;e&#39; f/g:1')
  assert.equal(readBack, `a&b <c> "d" 'e' f/g:1`)
})

// Value: protects=a text that already shows an entity, for example a code example about HTML; fails_when=reading an escaped text back resolves an entity twice, so "&amp;lt;" becomes "<" instead of "&lt;", or leaves an entity the publisher never writes half read; why_new=Cycle 0046 row 139; seam=none
test('an escaped text is read back one entity deep, and an entity the publisher does not write stays as it is', () => {
  // Arrange: the text "&lt;" escaped once, and two entities the publisher never writes.
  const escapedTwice = '&amp;lt;'
  const foreign = '&nbsp;&#x27;'

  // Act
  const readBack = [unescapeHtml(escapedTwice), unescapeHtml(foreign)]

  // Assert
  assert.deepEqual(readBack, ['&lt;', '&nbsp;&#x27;'])
})
