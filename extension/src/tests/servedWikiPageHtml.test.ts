import assert from 'node:assert/strict'
import { test } from 'node:test'

import type * as Parse5 from 'parse5' with { 'resolution-mode': 'import' }

import {
  type HtmlReading,
  readHtmlPage,
  readHtmlStartTags,
} from '../utils/readHtmlStartTags'
import { servedWikiPageHtml } from '../utils/servedWikiPageHtml'
import { withServedAddresses } from '../utils/withServedAddresses'

// The pinned parser stands for Chrome on pages without a select or a noscript; Node 24 loads this ESM package synchronously.
const parse5: typeof Parse5 = require('parse5')

/**
 * The namespaces of the script elements a browser builds from a page, in tree order, as the pinned parser reads it (by the select rules before 2025): the HTML namespace for a script that loads its file, the svg or MathML one for a script of that content, which loads nothing; called by the tests of the reader's tag in svg and MathML content.
 * @param page - The page as served.
 * @param scriptingEnabled - Whether the parser reads the page with scripting, so that a noscript holds text; without, it holds markup, as in a browser with JavaScript off.
 * @returns Each script element's namespace.
 * @example
 * scriptNamespaces('<svg><script></script></svg>') // => ['http://www.w3.org/2000/svg']
 * scriptNamespaces('<noscript><svg><g></noscript><script></script>', false) // => ['http://www.w3.org/2000/svg']
 */
function scriptNamespaces(page: string, scriptingEnabled = true): string[] {
  const found: string[] = []
  const visit = (node: Parse5.DefaultTreeAdapterMap['node']): void => {
    if ('tagName' in node && node.tagName === 'script')
      found.push(node.namespaceURI)
    if ('childNodes' in node) for (const child of node.childNodes) visit(child)
    if ('content' in node) visit(node.content)
  }
  visit(parse5.parse(page, { scriptingEnabled }))
  return found
}

/** The reader's script tag as {@link servedWikiPageHtml} prints it for the options of the tests of its place. */
const READER_TAG = '<script src="/w/t/codebook-qa.js"></script>'

/** Every reading the address filter may judge a page under: Chrome 151's with scripting, and each combination of the select rules before 2025 and scripting off. */
const EVERY_READING: readonly HtmlReading[] = [
  { selectRules: 'current', scriptingEnabled: true },
  { selectRules: 'before-2025', scriptingEnabled: true },
  { selectRules: 'current', scriptingEnabled: false },
  { selectRules: 'before-2025', scriptingEnabled: false },
]

/**
 * Whether Chrome 151's reading leaves svg or MathML content open where the reader's script tag of a served page stands, so that it would build the tag as an svg or MathML script, which loads nothing: the reader's model of that reading ({@link readHtmlPage}) reads the page up to the tag. The pinned parser reads a select by the rules before 2025 only, so this stands for Chrome's tree of a page with a select; called by the tests of the reader's tag in readings beside Chrome's.
 * @param served - A served page that holds {@link READER_TAG}.
 * @returns Whether a start tag at the tag's place takes the rules of svg or MathML content in Chrome's reading.
 * @example
 * chromeReadingLeavesForeignContentAtReaderTag('<svg><g>' + READER_TAG) // => true
 */
function chromeReadingLeavesForeignContentAtReaderTag(served: string): boolean {
  return readHtmlPage(served.slice(0, served.indexOf(READER_TAG)))
    .pageEndInForeignContent
}

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

// Value: protects=the reader's update state, its notice of newer pages and its stale-answer notice on every served Wiki page, which the reader's own script shows; fails_when=the reader puts its script tag at the page's first literal `</body>`, so the tag lands inside a comment that holds `</body>`, or is missing on a page that writes `</BODY>` or has no body end at all, and none of the three shows; why_new=Cycle 0047 row 7 (S11-F5); seam=none; no_claim=a page that leaves svg or MathML open at its body end, which the test after the next one holds (Cycle 0047 row 72)
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

// Value: protects=the place of the reader's script tag on every served Wiki page, which goes in at the start of the body end the reader finds (readHtmlPage's bodyEndTagStart) or, without one, at the page's end; fails_when=the reader takes as the body's end a `</body>` the parser did not take as such (one in a comment, the first of two, one inside a template), or finds a body end on a frameset page or on a page whose body no `<body>` tag opened, where the pinned parser records none; why_new=Cycle 0047 row 147 (P3SIMP-1), the body end is noted at the `</body>` the parser takes instead of read from the finished tree; seam=none; no_claim=where the tag goes on these pages (the test above), and whether Chrome takes the same ends (the pinned parser stands for it)
test('the reader finds a page’s body end at the last </body> the parser takes: past a commented one, at the second of two, none inside a template or for a frameset, and none for a body the parser put in by itself', () => {
  // Arrange: a commented </body> before </BODY>, a second </body> after text past the first, a </body> inside a template, a frameset page, and the first page without its <body> tag.
  const pages = [
    '<body><!-- </body> --><p>x</BODY>',
    '<body>a</body>b</body>',
    '<body><template></body>',
    '<frameset></frameset>',
    '<!-- </body> --><p>x</BODY>',
  ]

  // Act
  const bodyEnds = pages.map((page) => readHtmlPage(page).bodyEndTagStart)

  // Assert: the offset of the `<` of the body end, or none.
  assert.deepEqual(bodyEnds, [26, 15, undefined, undefined, undefined])
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

// Value: protects=the reader's update state, its notice of newer pages and its stale-answer notice on a served Wiki page that leaves svg or MathML content open where the reader's script tag goes, at the body's end or, without one, at the page's end; fails_when=the tag goes in there as it is, so Chrome reads it as an svg or MathML script element, which loads nothing, or a meta goes in where an integration point (foreignObject) already lets the tag be an HTML script; why_new=Cycle 0047 row 72 (ADV-12); seam=the pinned parser stands for Chrome's tree of these pages, which hold no select and no noscript; no_claim=native editor (no browser ran), and a page that ends inside a tag, a comment or a raw-text element, whose open text takes the tag
test('the reader’s script tag loads where svg or MathML content is open at the body’s end or at the page’s end, after a meta that leaves that content, and goes in as before inside a foreignObject', () => {
  // Arrange: svg and MathML content open at the body's end, svg content open at the end of a page without a body end, a MathML annotation-xml at whose body end the body is out of scope, and an svg foreignObject, an HTML integration point.
  const options = {
    editorScheme: 'vscode',
    clientAddress: '/w/t/codebook-qa.js',
    publication: undefined,
  } as const
  const pages = [
    '<body><p>Text</p><svg><g></body>',
    '<body><p>Text</p><math><mrow></body>',
    '<body><p>Text</p><svg><g>',
    '<body><p>Text</p><math><annotation-xml></body>',
    '<body><p>Text</p><svg><foreignObject></body>',
  ]

  // Act
  const served = pages.map((page) => servedWikiPageHtml(page, options))

  // Assert: a meta precedes the tag in svg and MathML content, none in the foreignObject, and a browser builds each tag as an HTML script.
  assert.deepEqual(served, [
    '<body><p>Text</p><svg><g><meta><script src="/w/t/codebook-qa.js"></script></body>',
    '<body><p>Text</p><math><mrow><meta><script src="/w/t/codebook-qa.js"></script></body>',
    '<body><p>Text</p><svg><g><meta><script src="/w/t/codebook-qa.js"></script>',
    '<body><p>Text</p><math><annotation-xml></body><meta><script src="/w/t/codebook-qa.js"></script>',
    '<body><p>Text</p><svg><foreignObject></body><script src="/w/t/codebook-qa.js"></script>',
  ])
  assert.deepEqual(
    served.map((page) => scriptNamespaces(page)),
    [
      ['http://www.w3.org/1999/xhtml'],
      ['http://www.w3.org/1999/xhtml'],
      ['http://www.w3.org/1999/xhtml'],
      ['http://www.w3.org/1999/xhtml'],
      ['http://www.w3.org/1999/xhtml'],
    ],
  )
})

// Value: protects=the rule that the page a learner receives is the address filter's output, also after the reader leaves svg content for its own script tag; fails_when=the meta and the tag are put in after the filter read the page, so a CDATA section that the open svg made text after the body's end becomes a bogus comment that ends at its first `>`, and the link after it is served live to Chrome; why_new=Cycle 0047 row 72 (ADV-12), the meta that leaves svg content changes how Chrome reads the rest of the page; seam=none; no_claim=native editor (no browser ran)
test('a link that leaving svg content for the reader’s tag lets out of a CDATA section after the body’s end loses its link, and filtering again changes nothing', () => {
  // Arrange: svg content open at the body's end, and after it a CDATA section whose text holds a link to another extension's address.
  const svgOpenAtBodyEnd = '<body><p>Text</p><svg></body>'
  const linkInCdata = '<![CDATA[x><a href=vscode://file/x>]]>'
  const options = {
    editorScheme: 'vscode',
    clientAddress: '/w/t/codebook-qa.js',
    publication: undefined,
  } as const

  // Act
  const served = servedWikiPageHtml(svgOpenAtBodyEnd + linkInCdata, options)

  // Assert: the meta and the tag stand at the body's end, Chrome reads the link after the bogus comment as a tag and the filter took its link, and filtering again changes nothing.
  assert.equal(
    served,
    '<body><p>Text</p><svg><meta><script src="/w/t/codebook-qa.js"></script></body><![CDATA[x><a data-codebook-unlinked=vscode://file/x>]]>',
  )
  assert.deepEqual(
    readHtmlStartTags(served)
      .filter((tag) => tag.name === 'a')
      .map((tag) => tag.attributes.map((attribute) => attribute.name)),
    [['data-codebook-unlinked']],
  )
  assert.equal(withServedAddresses(served, 'vscode'), served)
})

// Value: protects=the reader's update state, its notice of newer pages and its stale-answer notice on a served Wiki page that a browser of the select rules before 2025 reads with svg or MathML content open where the reader's script tag goes, though Chrome 151 reads that content closed there; fails_when=only Chrome's reading decides whether a meta that leaves svg or MathML content goes before the tag, or only an svg start tag before the tag's place lets the other readings be asked, so a browser of the older select rules builds the tag as an svg or MathML script, which loads nothing, or the page with the meta is not filtered again, so a link it lets out stays live; why_new=Cycle 0047 row 108 (QA-1); Cycle 0047 row 145 (P3TEST-2) a MathML page beside the svg ones; seam=the pinned parser reads a select by the rules before 2025, and the reader's model of Chrome's reading of the page up to the tag stands for Chrome's tree; no_claim=native editor (no browser of the older select rules ran)
test('the reader’s script tag loads in a browser of the select rules before 2025 that leaves svg or MathML content open at the tag’s place though Chrome closes it, after a meta that leaves that content, and no reading follows a link of the page', () => {
  // Arrange: a hidden input in a table body, or a keygen in the body, closes the select by the older rules alone, so the svg or the math after it stays open past the select's end there, to the end of a page without a body end or to a body end Chrome takes; a style after the select's end holds a link to another extension's address, which the older rules read as an svg or MathML link.
  const options = {
    editorScheme: 'vscode',
    clientAddress: '/w/t/codebook-qa.js',
    publication: undefined,
  } as const
  const pages = [
    '<table><tbody><select><input type=hidden><svg><g></select><style><a href=vscode://file/x>x</a></style>',
    '<body><p>Text</p><select><keygen><svg><g></select><style><a href=vscode://file/x>x</a></style></body>',
    '<body><p>Text</p><select><keygen><math><mrow></select><style><a href=vscode://file/x>x</a></style></body>',
  ]

  // Act
  const served = pages.map((page) => servedWikiPageHtml(page, options))

  // Assert: a meta precedes the tag, each reading builds the tag as an HTML script, no reading reads a start tag with a link, and filtering again changes nothing.
  assert.deepEqual(served, [
    '<table><tbody><select><input type=hidden><svg><g></select><style><a data-codebook-unlinked=vscode://file/x>x</a></style><meta><script src="/w/t/codebook-qa.js"></script>',
    '<body><p>Text</p><select><keygen><svg><g></select><style><a data-codebook-unlinked=vscode://file/x>x</a></style><meta><script src="/w/t/codebook-qa.js"></script></body>',
    '<body><p>Text</p><select><keygen><math><mrow></select><style><a data-codebook-unlinked=vscode://file/x>x</a></style><meta><script src="/w/t/codebook-qa.js"></script></body>',
  ])
  assert.deepEqual(
    served.map((page) => ({
      olderSelectRules: scriptNamespaces(page),
      olderSelectRulesWithoutScripting: scriptNamespaces(page, false),
      chromeLeavesForeignContentOpen:
        chromeReadingLeavesForeignContentAtReaderTag(page),
    })),
    [
      {
        olderSelectRules: ['http://www.w3.org/1999/xhtml'],
        olderSelectRulesWithoutScripting: ['http://www.w3.org/1999/xhtml'],
        chromeLeavesForeignContentOpen: false,
      },
      {
        olderSelectRules: ['http://www.w3.org/1999/xhtml'],
        olderSelectRulesWithoutScripting: ['http://www.w3.org/1999/xhtml'],
        chromeLeavesForeignContentOpen: false,
      },
      {
        olderSelectRules: ['http://www.w3.org/1999/xhtml'],
        olderSelectRulesWithoutScripting: ['http://www.w3.org/1999/xhtml'],
        chromeLeavesForeignContentOpen: false,
      },
    ],
  )
  assert.deepEqual(
    served.map((page) =>
      EVERY_READING.flatMap((reading) =>
        readHtmlStartTags(page, reading)
          .flatMap(({ attributes }) => attributes)
          .filter((attribute) => attribute.name === 'href'),
      ),
    ),
    [[], [], []],
  )
  assert.deepEqual(
    served.map((page) => withServedAddresses(page, 'vscode')),
    served,
  )
})

// Value: protects=the reader's update state, its notice of newer pages and its stale-answer notice on a served Wiki page that a browser without scripting reads with svg or MathML content open where the reader's script tag goes, though Chrome 151 with scripting reads that content as a noscript's text; fails_when=only Chrome's reading decides whether a meta that leaves svg or MathML content goes before the tag, or a reading beside Chrome's is asked only at a body end it takes itself, or only an svg start tag before the tag's place lets the other readings be asked, so a browser with JavaScript off, or a document of DOMParser, builds the tag as an svg or MathML script, which loads nothing; why_new=Cycle 0047 row 108 (QA-1), the scripting-off reading the filter also judges; Cycle 0047 row 145 (P3TEST-2) a MathML page beside the svg ones; seam=the pinned parser reads a page without scripting when asked, and the reader's model of Chrome's reading of the page up to the tag stands for Chrome's tree; no_claim=native editor (no browser ran), and whether the tag's script runs where scripting is off, which only a reading that later turns scripting on (a DOMParser document adopted by a page) needs
test('the reader’s script tag is an HTML script in a reading without scripting that leaves svg or MathML content open at the tag’s place though Chrome reads it as a noscript’s text, after a meta that leaves that content, and no reading follows a link of the page', () => {
  // Arrange: an svg or a math in a noscript, which only a reading without scripting reads as markup; in the head the svg stays open past the noscript's end to the end of a page without a body end, and in the body a desc in the svg, or an mi in the math, ends the body's scope, so that reading takes no body end where Chrome takes one; a style in the svg or the math holds a link to another extension's address.
  const options = {
    editorScheme: 'vscode',
    clientAddress: '/w/t/codebook-qa.js',
    publication: undefined,
  } as const
  const pages = [
    '<noscript><svg><g></noscript><style><a href=vscode://file/x>x</a></style>',
    '<body><p>Text</p><noscript><svg><desc><svg><g><style><a href=vscode://file/x>x</a></style></noscript></body>',
    '<body><p>Text</p><noscript><math><mi><math><mrow><style><a href=vscode://file/x>x</a></style></noscript></body>',
  ]

  // Act
  const served = pages.map((page) => servedWikiPageHtml(page, options))

  // Assert: a meta precedes the tag, each reading builds the tag as an HTML script, no reading reads a start tag with a link, and filtering again changes nothing.
  assert.deepEqual(served, [
    '<noscript><svg><g></noscript><style><a data-codebook-unlinked=vscode://file/x>x</a></style><meta><script src="/w/t/codebook-qa.js"></script>',
    '<body><p>Text</p><noscript><svg><desc><svg><g><style><a data-codebook-unlinked=vscode://file/x>x</a></style></noscript><meta><script src="/w/t/codebook-qa.js"></script></body>',
    '<body><p>Text</p><noscript><math><mi><math><mrow><style><a data-codebook-unlinked=vscode://file/x>x</a></style></noscript><meta><script src="/w/t/codebook-qa.js"></script></body>',
  ])
  assert.deepEqual(
    served.map((page) => ({
      withScripting: scriptNamespaces(page),
      withoutScripting: scriptNamespaces(page, false),
      chromeLeavesForeignContentOpen:
        chromeReadingLeavesForeignContentAtReaderTag(page),
    })),
    [
      {
        withScripting: ['http://www.w3.org/1999/xhtml'],
        withoutScripting: ['http://www.w3.org/1999/xhtml'],
        chromeLeavesForeignContentOpen: false,
      },
      {
        withScripting: ['http://www.w3.org/1999/xhtml'],
        withoutScripting: ['http://www.w3.org/1999/xhtml'],
        chromeLeavesForeignContentOpen: false,
      },
      {
        withScripting: ['http://www.w3.org/1999/xhtml'],
        withoutScripting: ['http://www.w3.org/1999/xhtml'],
        chromeLeavesForeignContentOpen: false,
      },
    ],
  )
  assert.deepEqual(
    served.map((page) =>
      EVERY_READING.flatMap((reading) =>
        readHtmlStartTags(page, reading)
          .flatMap(({ attributes }) => attributes)
          .filter((attribute) => attribute.name === 'href'),
      ),
    ),
    [[], [], []],
  )
  assert.deepEqual(
    served.map((page) => withServedAddresses(page, 'vscode')),
    served,
  )
})
