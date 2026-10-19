import assert from 'node:assert/strict'
import { test } from 'node:test'

import { servedWikiPageHtml } from '../utils/servedWikiPageHtml'
import { withServedAddresses } from '../utils/withServedAddresses'

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

// Value: protects=the rule that the page a learner receives is the address filter's output, also after the reader puts its own script tag in; fails_when=the reader puts its tag at the page's first `</body>` after the filter read the page, so where that `</body>` stands inside a quoted value or a script's text, the tag's own quote or `</script>` ends the value or the script early and the text after it becomes a live link no check has seen (Chrome 151 keeps a live vscode://file/etc/hosts link there); why_new=P2SEC1; seam=none; no_claim=whether the reader's own script loads on such a page (it is read as text there)
test('a page whose quoted value or script text holds </body> before its own end serves no editor link from the text after it, and filtering the served page again changes nothing', () => {
  // Arrange: a `</body>` inside a quoted title, and one inside a script's text, each followed by a link to another extension's address.
  const inAQuotedValue =
    '<body><p title="</body><a href=vscode://file/etc/hosts>here</a>">t</p></body>'
  const inScriptText =
    '<body><script>//</body><a href=vscode://file/etc/hosts>here</a></script></body>'
  const options = {
    editorScheme: 'vscode',
    clientAddress: '/w/t/codebook-qa.js',
    publication: undefined,
  } as const

  // Act
  const served = [inAQuotedValue, inScriptText].map((page) =>
    servedWikiPageHtml(page, options),
  )
  const filteredAgain = served.map((page) =>
    withServedAddresses(page, 'vscode'),
  )

  // Assert: the tag stands at the first `</body>` as before, and the link its quote or its `</script>` exposes is one the filter read and took away.
  const expected = [
    '<body><p title="<script src="/w/t/codebook-qa.js"></script></body><a data-codebook-unlinked=vscode://file/etc/hosts>here</a>">t</p></body>',
    '<body><script>//<script src="/w/t/codebook-qa.js"></script></body><a data-codebook-unlinked=vscode://file/etc/hosts>here</a></script></body>',
  ]
  assert.deepEqual(served, expected)
  assert.deepEqual(filteredAgain, expected)
})
