import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readHtmlStartTags } from '../utils/readHtmlStartTags'
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

// Value: protects=the rule that the page a learner receives is the address filter's output, also after the reader puts its own script tag in; fails_when=the reader puts its tag at the page's first `</body>` after the filter read the page, so where that `</body>` stands inside a quoted value or a script's text, the tag's own quote or `</script>` ends the value or the script early and the text after it becomes a live link no check has seen (Chrome 151 keeps a live vscode://file/etc/hosts link there); why_new=P2SEC1; Cycle 0047 row 7 (S11-F5) puts the tag at the body's end the parser found, so the inner `</body>` and the link after it stay text, and the test now also holds that no start tag of the served page carries the link; seam=none; no_claim=native editor
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

  // Assert: the tag stands at the body's own end, the text with the inner `</body>` stays a value or a script's text, and no start tag carries the link.
  const expected = [
    '<body><p title="</body><a href=vscode://file/etc/hosts>here</a>">t</p><script src="/w/t/codebook-qa.js"></script></body>',
    '<body><script>//</body><a href=vscode://file/etc/hosts>here</a></script><script src="/w/t/codebook-qa.js"></script></body>',
  ]
  assert.deepEqual(served, expected)
  assert.deepEqual(filteredAgain, expected)
  assert.deepEqual(
    served.map((page) =>
      readHtmlStartTags(page)
        .flatMap(({ attributes }) => attributes)
        .filter((attribute) => attribute.name === 'href'),
    ),
    [[], []],
  )
})

// Value: protects=the reader's update state, its notice of newer pages and its stale-answer notice on every served Wiki page, which the reader's own script shows; fails_when=the reader puts its script tag at the page's first literal `</body>`, so the tag lands inside a comment that holds `</body>`, or is missing on a page that writes `</BODY>` or has no body end at all, and none of the three shows; why_new=Cycle 0047 row 7 (S11-F5); seam=none; no_claim=a page that leaves svg or MathML open at its body end (the tag is then a foreign script there, as before)
test('the reader’s script tag goes in at the body end the parser found, past a commented </body> and before </BODY>, or at the page’s end when it has none, and is read as a script tag', () => {
  // Arrange
  const options = {
    editorScheme: 'vscode',
    clientAddress: '/w/t/codebook-qa.js',
    publication: undefined,
  } as const
  const pages = [
    '<body><!-- </body> --><p>Text</p></body>',
    '<body><p>Text</p></BODY>',
    '<body><p>Text</p>',
  ]

  // Act
  const served = pages.map((page) => servedWikiPageHtml(page, options))

  // Assert: each tag stands where the body ends, and a browser reads it as the reader's script.
  assert.deepEqual(served, [
    '<body><!-- </body> --><p>Text</p><script src="/w/t/codebook-qa.js"></script></body>',
    '<body><p>Text</p><script src="/w/t/codebook-qa.js"></script></BODY>',
    '<body><p>Text</p><script src="/w/t/codebook-qa.js"></script>',
  ])
  assert.deepEqual(
    served.map((page) =>
      readHtmlStartTags(page)
        .filter((tag) => tag.name === 'script')
        .map((tag) => tag.attributes.map((attribute) => attribute.written)),
    ),
    [
      [['/w/t/codebook-qa.js']],
      [['/w/t/codebook-qa.js']],
      [['/w/t/codebook-qa.js']],
    ],
  )
})

// Value: protects=the rule that the page a learner receives is the address filter's output, also where the reader's tag goes at the end of a page without a body end; fails_when=the tag is put after the filter read the page, so a tag the page leaves open at its end is closed by the reader's tag and its link to another extension's address is served live; why_new=Cycle 0047 row 7 (S11-F5), the tag's new place at a page's end; seam=none; no_claim=whether the reader's script loads on such a page (the page's open tag takes it as an attribute)
test('a page that ends inside an open link tag gets the reader’s tag at its end, and the link the tag closes loses its link', () => {
  // Arrange: a page whose last tag has no end, its value a bare address of another extension.
  const openLink = ['<body><p>Text</p>', '<a href=', 'vscode://file/x'].join('')
  const options = {
    editorScheme: 'vscode',
    clientAddress: '/w/t/codebook-qa.js',
    publication: undefined,
  } as const

  // Act
  const served = servedWikiPageHtml(openLink, options)

  // Assert: the tag's own `>` ends the link tag, and the filter took that link's address away; filtering again changes nothing.
  assert.equal(
    served,
    '<body><p>Text</p><a data-codebook-unlinked=vscode://file/x<script src="/w/t/codebook-qa.js"></script>',
  )
  assert.equal(withServedAddresses(served, 'vscode'), served)
})
