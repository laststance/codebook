import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import { browserAttributeText } from '../utils/browserAttributeText'
import { readHtmlStartTags } from '../utils/readHtmlStartTags'
import { withServedAddresses } from '../utils/withServedAddresses'

/** The longest the reader may take to filter one page of the timing test, in milliseconds. Its slowest page took 75 ms on the development host (16 CPUs, Node 22); the bound leaves about five times that for a two-core CI runner under load, while a reading from every `<` took 20 to 28 s for a page of 48 to 74 KB. */
const FILTER_BOUND_MS = 400
/** How long the timing test waits for its worker before it takes the filtering for unfinished, in milliseconds. */
const FILTER_DEADLINE_MS = 10_000

/**
 * Serves pages in a worker thread with a compiled function of the reader, called as `serve(page, 'cursor')`, and answers how long each took, or `unfinished` for the pages left when the deadline passed; the reader's functions run synchronously, so only a worker can be stopped while one runs. Called by the timing tests.
 * @param moduleName - The compiled module under `dist/utils`, without `.js`.
 * @param exportName - The function it exports.
 * @param pages - The pages, by name.
 * @returns Each page's time in milliseconds, or `unfinished`.
 * @example
 * await servingTimes('withServedAddresses', 'withServedAddresses', { small: '<a href="x">x</a>' }) // => { small: 0.1 }
 */
async function servingTimes(
  moduleName: string,
  exportName: string,
  pages: Record<string, string>,
): Promise<Record<string, number | 'unfinished'>> {
  const times: Record<string, number | 'unfinished'> = Object.fromEntries(
    Object.keys(pages).map((name) => [name, 'unfinished']),
  )
  const worker = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads')
const serve = require(workerData.module)[workerData.exportName]
for (const [name, page] of Object.entries(workerData.pages)) {
  const started = performance.now()
  serve(page, 'cursor')
  parentPort.postMessage([name, performance.now() - started])
}`,
    {
      eval: true,
      workerData: {
        module: join(__dirname, '..', 'utils', `${moduleName}.js`),
        exportName,
        pages,
      },
    },
  )
  await new Promise<void>((resolve) => {
    const deadline = setTimeout(() => {
      void worker.terminate().then(() => resolve())
    }, FILTER_DEADLINE_MS)
    worker.on('message', ([name, milliseconds]: [string, number]) => {
      times[name] = milliseconds
    })
    worker.on('exit', () => {
      clearTimeout(deadline)
      resolve()
    })
  })
  return times
}

// Value: protects=the extension host from seconds of synchronous Wiki filtering; fails_when=tags rescan the page or unmatched end tags rescan the open foreign elements; why_new=W1 plus row 1044's absent and already closed foreign names; seam=none; no_claim=native editor responsiveness (reader runs in an isolated test worker)
test('the reader filters a page of more than 1 MB built to make a reading from every < slow in under 400 ms', async () => {
  // Arrange: large values and links, SVG markup, and absent or already closed names after deep foreign nesting.
  const pages = {
    nestedTagStarts: `<p title="${'<b '.repeat(350_000)}">x</p>`,
    openingQuotes: `<a b="'${'<a b=\'"'.repeat(150_000)}`,
    refusedLinks: '<a href="vscode://file/x">x</a>'.repeat(35_000),
    svgStyles: '<svg><style><a href="javascript:x">'.repeat(30_000),
    unmatchedForeignEnds: (
      '<svg>' +
      '<g>'.repeat(20_000) +
      '</x>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    closedForeignName: (
      '<svg><x></x>' +
      '<g>'.repeat(20_000) +
      '</x>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    closedRepeatedForeignName: (
      '<svg>' +
      '<g>'.repeat(20_000) +
      '</g>'.repeat(20_000) +
      '<x>'.repeat(20_000) +
      '</g>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
  }

  // Act
  const times = await servingTimes(
    'withServedAddresses',
    'withServedAddresses',
    pages,
  )

  // Assert: every page is over 1 MB, and each was filtered within the bound.
  assert.deepEqual(
    Object.values(pages).map((page) => page.length > 1_000_000),
    [true, true, true, true, true, true, true],
  )
  assert.deepEqual(
    Object.entries(times).filter(
      ([, milliseconds]) =>
        milliseconds === 'unfinished' || milliseconds >= FILTER_BOUND_MS,
    ),
    [],
  )
})

// Value: protects=the editor's extension host, which rewrites every page the Wiki reader serves synchronously, Codebook's addresses and the rail's entry included; fails_when=the rebinding of Codebook's addresses reads the page by a pattern that backtracks over quotes and slashes, or the entry's description id is looked for once per number in the whole page, so a page of 1 MB stalls the host for minutes; why_new=Cycle 0046 /ship third review W1 and W5 (the rebinding joins the filter's single pass); seam=a worker thread, so the deadline can stop a rewrite that does not end
test('the reader serves a page of more than 1 MB built to make a pattern of its tags or its ids slow, Codebook’s addresses and the rail’s entry included, in under 400 ms', async () => {
  // Arrange: values that run into slashes, quotes that open values, and a page whose headings carry the numbered ids of the entry's description, with an entry of 0.2.29.0 that needs one.
  const pages = {
    slashValues: '<x/href=<x/href='.repeat(70_000),
    openingQuotes: `<a b="'${'<a b=\'"'.repeat(150_000)}`,
    numberedIds:
      '<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Fr&amp;path=a.ts&amp;line=1">Open in VS Code</a></p>' +
      Array.from(
        { length: 40_000 },
        (_unused, index) => `<h2 id="codebook-open-target-${index + 2}">h</h2>`,
      ).join(''),
  }

  // Act
  const times = await servingTimes(
    'rebindDeepWikiEditorLinks',
    'rebindDeepWikiEditorLinks',
    pages,
  )

  // Assert: every page is over 1 MB, and each was served within the bound.
  assert.deepEqual(
    Object.values(pages).map((page) => page.length > 1_000_000),
    [true, true, true],
  )
  assert.deepEqual(
    Object.entries(times).filter(
      ([, milliseconds]) =>
        milliseconds === 'unfinished' || milliseconds >= FILTER_BOUND_MS,
    ),
    [],
  )
})

// Value: protects=a page that the publisher let through and the reader serves: both tell its comments, start tags and attribute values apart from its text, the publisher to judge and rename ids and the reader to judge and rebind addresses; fails_when=the reader's single reading and the publisher's reading part on a page the publisher accepts, so the reader passes over an attribute the publisher read, or reads one in what the publisher took for text, unseen; why_new=Cycle 0046 row 241 held the two copies of one pattern in step; third review W1 and W5 gave the reader a tokenizer of its own, so the test now holds what both read; seam=none (the shipped publisher's reading and the compiled reader)
test('the reader reads the same attributes and values as the shipped publisher in pages the publisher accepts, with comments, quoted brackets, bare values and escaped code', async () => {
  // Arrange: the publisher's reading of a page's attributes, and pages of the forms the publisher reads exactly.
  const { withAttributeValues, unreadMarkupOf } = (await import(
    pathToFileURL(
      join(
        __dirname,
        '..',
        '..',
        'skills',
        'codebook',
        'render-wiki-diagrams.mjs',
      ),
    ).href
  )) as {
    withAttributeValues: (
      html: string,
      rewrite: (name: string, text: string) => string,
    ) => string
    unreadMarkupOf: (html: string) => string | undefined
  }
  const pages = [
    '<h2 id="flow" class="a b">Flow</h2><p title="a > b" data-x=bare>t</p>',
    '<!-- <a href="javascript:x"> --><p id="after-comment">a</p><!-- x --!><p id="after-bang">b</p><!--><p id="after-short">c</p>',
    '<p title="<b>">quoted bracket</p><p title=\'it said "x"\' lang=en>q</p>',
    '<pre><code>&lt;a href="vscode://file/x"&gt;</code></pre><p class="code-note">e</p>',
    '<a href="pages/a&amp;b.html#start" title="A &amp; B">l</a><img src="flow.png" alt="" width=10>',
  ]

  // Act: the name and the value of every attribute with a value, as each reads them.
  const readings = pages.map((page) => {
    const publisher: string[] = []
    withAttributeValues(page, (name, text) => {
      publisher.push(`${name}=${text}`)
      return text
    })
    const reader = readHtmlStartTags(page).flatMap(({ attributes }) =>
      attributes
        .filter((attribute) => attribute.written !== undefined)
        .map(
          (attribute) =>
            `${attribute.name}=${browserAttributeText(attribute.written ?? '')}`,
        ),
    )
    return { accepted: unreadMarkupOf(page) === undefined, publisher, reader }
  })

  // Assert: the publisher reads each page exactly, and the two readings agree.
  assert.deepEqual(
    readings.map(({ accepted }) => accepted),
    [true, true, true, true, true],
  )
  assert.deepEqual(
    readings.map(({ reader }) => reader),
    readings.map(({ publisher }) => publisher),
  )
  assert.deepEqual(
    readings.map(({ reader }) => reader.length),
    [4, 3, 3, 1, 5],
  )
})

// Value: protects=the text of a served page that shows markup (a comment, a style's or a script's text, an attribute's quoted value) and the reader's own script, whose hash its policy names; fails_when=the filter reads a tag inside what a browser reads as text and renames text there, or loses its place after such text and leaves a tag after it unjudged; why_new=Cycle 0046 /ship third review W1 (the page is read once, as a browser reads it); seam=none, the served page is compared as text
test('markup a browser reads as a comment, as a style’s or a script’s text or inside a quoted value is served as written, and a link after each is still judged', () => {
  // Arrange
  const page =
    '<!-- <a href="javascript:a"> -->' +
    '<style>a::after { content: "<a href=javascript:b>" }</style>' +
    '<script>const link = \'<a href="javascript:c">\'</script>' +
    '<p title="<a href=javascript:d>">t</p>' +
    '<textarea><a href="javascript:e"></textarea>' +
    '<a href="javascript:f">f</a>'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert
  assert.equal(
    served,
    '<!-- <a href="javascript:a"> -->' +
      '<style>a::after { content: "<a href=javascript:b>" }</style>' +
      '<script>const link = \'<a href="javascript:c">\'</script>' +
      '<p title="<a href=javascript:d>">t</p>' +
      '<textarea><a href="javascript:e"></textarea>' +
      '<a data-codebook-unlinked="javascript:f">f</a>',
  )
})

// Value: protects=the learner against a link inside svg or MathML, where a browser reads a style's and a script's content as markup, and after a script whose text a browser ends later than its first end tag; fails_when=the filter takes the content of svg's style or script for text, or ends a script's text at an end tag inside `<!--<script>`, so the link stays; why_new=Cycle 0046 /ship third review W1 (the reading follows svg and MathML content and a script's three states); seam=none, the served page is compared as text
test('a link inside svg’s style or script, inside MathML’s text after it, and after a script whose text holds <!--<script> … </script> is judged where a browser reads it', () => {
  // Arrange
  const page =
    '<svg><style><a href="javascript:a">a</a></style><script><a href="javascript:b">b</a></script></svg>' +
    '<math><mi><style><a href="javascript:c"></style></mi></math>' +
    '<script><!--<script></script><a href="javascript:d"></script>' +
    '<a href="javascript:e">e</a>'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert: inside MathML's mi a style holds text again; the script's text ends at its second end tag.
  assert.equal(
    served,
    '<svg><style><a data-codebook-unlinked="javascript:a">a</a></style><script><a data-codebook-unlinked="javascript:b">b</a></script></svg>' +
      '<math><mi><style><a href="javascript:c"></style></mi></math>' +
      '<script><!--<script></script><a href="javascript:d"></script>' +
      '<a data-codebook-unlinked="javascript:e">e</a>',
  )
})

// Value: protects=the learner against a link a browser reads in a tag the filter could misread; fails_when=the filter needs white space before an attribute after a quoted value, takes an end tag's quoted value for the end of the tag, or reads the end of a comment differently from a browser (`--!>`, `<!-->`); why_new=Cycle 0046 /ship third review W1 (the browser's tokenizer, not a pattern); seam=none, the served page is compared as text
test('a link right after a quoted value, after an end tag whose value holds >, and after the less usual ends of a comment is judged', () => {
  // Arrange
  const page =
    '<a title="t"href="javascript:a">a</a>' +
    '</p title=">"><a href="javascript:b">b</a>' +
    '<!-- x --!><a href="javascript:c">c</a>' +
    '<!--><a href="javascript:d">d</a>' +
    '<!--!> <a href="javascript:e">e</a> -->'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert: `<!--!>` does not end its comment, so the last link is text.
  assert.equal(
    served,
    '<a title="t"data-codebook-unlinked="javascript:a">a</a>' +
      '</p title=">"><a data-codebook-unlinked="javascript:b">b</a>' +
      '<!-- x --!><a data-codebook-unlinked="javascript:c">c</a>' +
      '<!--><a data-codebook-unlinked="javascript:d">d</a>' +
      '<!--!> <a href="javascript:e">e</a> -->',
  )
})

// Value: protects=the learner whose served page carries a refresh written with references, which moves the page to an editor address without a click (security probed `&#114efresh` to vscode://file/etc/hosts in real Chromium); fails_when=the filter reads a numeric reference only with its semicolon, or compares the keyword in one case, so the refresh survives, or it takes the effect from the shell's own meta elements; why_new=Cycle 0046 /ship third review W2; seam=none, the served page is compared as text
test('a refresh written with references with or without their semicolon, or in capitals, loses its effect, and the shell’s charset, viewport and Content-Security-Policy stay', () => {
  // Arrange
  const page =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'">' +
    '<meta http-equiv="&#114efresh" content="0;url=vscode://file/etc/hosts">' +
    '<meta http-equiv="&#x52;efresh" content="0;url=a.html">' +
    '<meta http-equiv="re&#102;resh" content="0;url=b.html">' +
    '<meta http-equiv=REFRESH content="0;url=c.html">'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert
  assert.equal(
    served,
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
      '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'">' +
      '<meta data-codebook-unlinked="&#114efresh" content="0;url=vscode://file/etc/hosts">' +
      '<meta data-codebook-unlinked="&#x52;efresh" content="0;url=a.html">' +
      '<meta data-codebook-unlinked="re&#102;resh" content="0;url=b.html">' +
      '<meta data-codebook-unlinked=REFRESH content="0;url=c.html">',
  )
})

// Value: protects=the learner whose served page carries a frame with a page of its own, whose links the filter never reads (probed: a clickable editor link from escaped markup in `srcdoc`); fails_when=the filter judges `srcdoc` as text, so the frame's page and its links stand; why_new=Cycle 0046 /ship third review W2; seam=none, the served page is compared as text
test('a frame’s srcdoc loses its effect, whatever it holds and in any case of its name', () => {
  // Arrange
  const page =
    '<iframe srcdoc="&lt;a href=&quot;vscode://file/etc/hosts&quot;&gt;x&lt;/a&gt;"></iframe>' +
    "<iframe SRCDOC='<p>plain</p>'></iframe>"

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert
  assert.equal(
    served,
    '<iframe data-codebook-unlinked="&lt;a href=&quot;vscode://file/etc/hosts&quot;&gt;x&lt;/a&gt;"></iframe>' +
      "<iframe data-codebook-unlinked='<p>plain</p>'></iframe>",
  )
})

// Value: protects=the learner whose served page animates an svg link's address to an editor address after the filter judged it (probed: `<set attributeName="href" to="vscode://…">` gives a clickable link); fails_when=the filter judges only the link's own href, so the animation sets the address; why_new=Cycle 0046 /ship third review W2; seam=none, the served page is compared as text
test('an svg animation of href or xlink:href loses its attributeName, written plainly or with references, and an animation of anything else stays', () => {
  // Arrange
  const page =
    '<svg><a href="#x"><set attributeName="href" to="vscode://file/etc/hosts"/><text>a</text></a>' +
    '<a><animate attributeName="xlink:href" values="vscode://file/a;vscode://file/b"/></a>' +
    '<a><animate attributeName="&#104;ref" by="x"/></a>' +
    '<rect><animate attributeName="opacity" to="0"/></rect></svg>'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert
  assert.equal(
    served,
    '<svg><a href="#x"><set data-codebook-unlinked="href" to="vscode://file/etc/hosts"/><text>a</text></a>' +
      '<a><animate data-codebook-unlinked="xlink:href" values="vscode://file/a;vscode://file/b"/></a>' +
      '<a><animate data-codebook-unlinked="&#104;ref" by="x"/></a>' +
      '<rect><animate attributeName="opacity" to="0"/></rect></svg>',
  )
})

// Value: protects=the learner whose served page holds an address that a browser reads as a network path or another scheme only once it reads the references in it; fails_when=the filter reads only the five names the publisher writes, so `/&sol;host/x`, `/&bsol;host/x` and `/&NewLine;/host/x` (a browser reads `//host/x`, which a page opened from disk on Windows fetches from another computer) keep their effect; why_new=Cycle 0046 /ship third review W2 and OCR review W18; seam=none, the served page is compared as text
test('an address that a browser reads as a network path or another scheme once it reads its references loses its effect, and a path with an escaped ampersand stays', () => {
  // Arrange
  const page =
    '<img src="/&sol;host/x.png" alt="a">' +
    '<img src="/&bsol;host/x.png" alt="b">' +
    '<a href="/&NewLine;/host/x">c</a>' +
    '<a href="&#x6A;avascript:run()">d</a>' +
    '<a href="pages/a&amp;b.html">e</a>'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert
  assert.equal(
    served,
    '<img data-codebook-unlinked="/&sol;host/x.png" alt="a">' +
      '<img data-codebook-unlinked="/&bsol;host/x.png" alt="b">' +
      '<a data-codebook-unlinked="/&NewLine;/host/x">c</a>' +
      '<a data-codebook-unlinked="&#x6A;avascript:run()">d</a>' +
      '<a href="pages/a&amp;b.html">e</a>',
  )
})

// Value: protects=the learner against a link that a comment's end lets out where an earlier attribute's quoted value seems to hold it; fails_when=the filter reads the comment's end differently from a browser, so the live `vscode://file` link after `-->` is served as written, or it renames the text after it; why_new=Cycle 0046 /ship third testing review TT23 (the order of renames across tag starts; the single reading's equivalent is where the comment ends); seam=none, the served page is compared as text
test('a link that a comment’s end lets out of what looks like a quoted value loses its link, and the text after it stays', () => {
  // Arrange: a browser ends the comment at `-->`, inside what looks like the title's value, so the second link is live and the rest is text.
  const page =
    '<!-- <a title="--><a href=\'vscode://file/etc/hosts\'>x</a>" href="javascript:y">'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert
  assert.equal(
    served,
    '<!-- <a title="--><a data-codebook-unlinked=\'vscode://file/etc/hosts\'>x</a>" href="javascript:y">',
  )
})

// Value: protects=the learner whose served page writes a refresh with spaces around its keyword, which a browser may still act on; fails_when=the filter compares the keyword without trimming it, so ` refresh ` keeps its effect; why_new=Cycle 0046 /ship third testing review TT24 (the trim had no test); seam=none, the served page is compared as text
test('a refresh written with spaces around its keyword loses its effect', () => {
  // Arrange
  const page =
    '<meta http-equiv=" refresh " content="0;url=vscode://file/etc/hosts">'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert
  assert.equal(
    served,
    '<meta data-codebook-unlinked=" refresh " content="0;url=vscode://file/etc/hosts">',
  )
})

// Value: protects=the learner against a link whose attribute follows a slash right after the tag's name, which a browser reads as a separator; fails_when=the filter reads `/href` as one name, or stops at the slash, so `<a/href="vscode://file/…">` is served as a live link; why_new=Cycle 0046 /ship third testing review TT25; seam=none, the served page is compared as text
test('an attribute after a slash right after the tag’s name is judged', () => {
  // Arrange
  const page = '<a/href="vscode://file/etc/hosts">hosts</a>'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert
  assert.equal(
    served,
    '<a/data-codebook-unlinked="vscode://file/etc/hosts">hosts</a>',
  )
})

// Value: protects=the served page's text and the reader's answer to a page whose tag holds what looks like another tag's start, or a number past the last code point; fails_when=the filter reads a tag again from a `<` inside it and renames one name twice, which garbles the page, or it reads `&#1114112;` as a character and throws, so the reader answers the page with a 500; why_new=Cycle 0046 /ship third testing review TT26; seam=none, the served page is compared as text
test('a name inside a tag that looks like another tag’s start is renamed once, and a reference past the last code point is read as the replacement character', () => {
  // Arrange
  const pages = [
    '<a <b href=javascript:x>t</a>',
    '<a href="&#1114112;x">u</a><a href="&#x110000;y">v</a>',
  ]

  // Act: each page as served, or the error the filter threw.
  const served = pages.map((page) => {
    try {
      return withServedAddresses(page, 'vscode')
    } catch (error) {
      return String(error)
    }
  })

  // Assert: a relative address that starts with the replacement character stays a link.
  assert.deepEqual(served, [
    '<a <b data-codebook-unlinked=javascript:x>t</a>',
    '<a href="&#1114112;x">u</a><a href="&#x110000;y">v</a>',
  ])
})
