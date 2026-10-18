import assert from 'node:assert/strict'
import { test } from 'node:test'

import { servedWikiPageHtml } from '../utils/servedWikiPageHtml'

// Value: protects=the reader's own script tag at the end of every served Wiki page; fails_when=the publication or the script's address is printed into the tag unescaped, so a quote ends its attribute early, or the text is read as a replacement pattern, so `$&` prints the page's `</body>` inside the tag; why_new=CR3-3; seam=none; no_claim=the reader today serves a publication of hex digits, `@` and decimal digits and an address under `/w/<hex token>/`, which hold neither character
test('the reader’s script tag carries the publication and its address as written, with a quote and $& among them', () => {
  // Arrange: a page and the two values, each with a quote and a replacement pattern.
  const page = '<body><p>Text</p></body>'
  const clientAddress = '/w/t"x$&/codebook-qa.js'
  const publication = 'a"b$&c'

  // Act
  const served = servedWikiPageHtml(page, {
    editorScheme: 'vscode',
    clientAddress,
    publication,
  })

  // Assert
  assert.equal(
    served,
    '<body><p>Text</p><script src="/w/t&quot;x$&amp;/codebook-qa.js" data-codebook-publication="a&quot;b$&amp;c"></script></body>',
  )
})
