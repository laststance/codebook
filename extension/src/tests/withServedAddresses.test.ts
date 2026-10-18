import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import { addressAsBrowserReads } from '../utils/addressAsBrowserReads'
import { browserAttributeText } from '../utils/browserAttributeText'
import { readHtmlStartTags } from '../utils/readHtmlStartTags'
import { withServedAddresses } from '../utils/withServedAddresses'

/** How many times as long as {@link ORDINARY_PAGE} the reader may take for one crafted page of the timing tests. On the development host (16 CPUs, Node 24) no crafted page took more than 1.2 times as long as the ordinary page, with or without coverage, while a reading that rescans a deep stack took many times as long. A fixed bound in milliseconds measured only the speed of the host: the full HTML parser of row 1058 takes 128 ms for the ordinary page alone, and 446 ms under coverage. */
const CRAFTED_PAGE_BOUND_RATIO = 4
/** How long the timing test waits for its worker before it takes the filtering for unfinished, in milliseconds; a two-core CI runner under coverage takes several times as long as the development host. */
const FILTER_DEADLINE_MS = 30_000
/** An ordinary Wiki page of more than 1 MB, sections of a heading, text, a link and code; each crafted page of the timing tests is compared with it. */
const ORDINARY_PAGE =
  '<section><h2 id="s">Title</h2><p>Some text with <a href="https://example.com/x">a link</a> and <code>code</code>.</p></section>'.repeat(
    9_000,
  )
/** A small page the worker serves first, so that compiling the reader is not counted in the time of the ordinary page. */
const WARM_UP_PAGE = '<p><a href="x">warm</a></p>'.repeat(2_000)

/**
 * Serves pages in a worker thread with a compiled function of the reader, called as `serve(page, 'cursor')`, and answers how long each took, or `unfinished` for the pages left when the deadline passed; the reader's functions run synchronously, so only a worker can be stopped while one runs. Called by the timing tests.
 * The worker first serves {@link WARM_UP_PAGE}, then {@link ORDINARY_PAGE} twice, and answers the shorter time as `ordinary`, so that each crafted page is compared with an ordinary page in the same thread under the same load.
 * @param moduleName - The compiled module under `dist/utils`, without `.js`.
 * @param exportName - The function it exports.
 * @param pages - The crafted pages, by name.
 * @returns The time of the ordinary page and of each crafted page in milliseconds, or `unfinished`.
 * @example
 * await servingTimes('withServedAddresses', 'withServedAddresses', { small: '<a href="x">x</a>' }) // => { ordinary: 128, small: 0.1 }
 */
async function servingTimes(
  moduleName: string,
  exportName: string,
  pages: Record<string, string>,
): Promise<Record<string, number | 'unfinished'>> {
  const times: Record<string, number | 'unfinished'> = Object.fromEntries(
    ['ordinary', ...Object.keys(pages)].map((name) => [name, 'unfinished']),
  )
  const worker = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads')
const serve = require(workerData.module)[workerData.exportName]
const timeOf = (page) => {
  const started = performance.now()
  serve(page, 'cursor')
  return performance.now() - started
}
timeOf(workerData.warmUp)
parentPort.postMessage(['ordinary', Math.min(timeOf(workerData.ordinary), timeOf(workerData.ordinary))])
for (const [name, page] of Object.entries(workerData.pages)) {
  parentPort.postMessage([name, timeOf(page)])
}`,
    {
      eval: true,
      workerData: {
        module: join(__dirname, '..', 'utils', `${moduleName}.js`),
        exportName,
        warmUp: WARM_UP_PAGE,
        ordinary: ORDINARY_PAGE,
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

// Value: protects=the extension host from seconds of synchronous Wiki filtering; fails_when=tags or unmatched ends rescan a deep stack, including after formatting adoption changes it, so a crafted page takes many times as long as an ordinary page of its size; why_new=W1 and row1044 plus row1058's observed non-top insertion callback, and a closed camelCase svg name (clipPath) whose end the open-name index must lower; row1058's full parser exceeds a fixed 400 ms on any page of 1 MB under coverage; seam=none; no_claim=native editor responsiveness (reader runs in an isolated test worker)
test('the reader filters a page of more than 1 MB built to make a reading from every < slow within four times the time of an ordinary page of that size', async () => {
  // Arrange: large values and links, SVG markup, and absent or already closed names after deep foreign nesting.
  const pages = {
    nestedTagStarts: `<p title="${'<b '.repeat(350_000)}">x</p>`,
    openingQuotes: `<a b="'${'<a b=\'"'.repeat(150_000)}`,
    refusedLinks: '<a href="vscode://file/x">x</a>'.repeat(35_000),
    internalAddressSpaces: (
      '<a href="x' +
      ' '.repeat(40_000) +
      'y">x</a>'
    ).padEnd(1_000_001, ' '),
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
    formattingAdoptionForeignEnds: (
      '<b><p><g></b></g></p><svg>' +
      '<x>'.repeat(20_000) +
      '</g>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedKnownForeignEnds: (
      '<svg>' +
      '<g>'.repeat(20_000) +
      '</span>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    closedCamelCaseForeignName: (
      '<svg><clipPath></clipPath>' +
      '<g>'.repeat(20_000) +
      '</clippath>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
  }

  // Act
  const times = await servingTimes(
    'withServedAddresses',
    'withServedAddresses',
    pages,
  )

  // Assert: every page is over 1 MB, and each crafted page was filtered within the bound of the ordinary page's time.
  assert.deepEqual(
    Object.values(pages).map((page) => page.length > 1_000_000),
    [true, true, true, true, true, true, true, true, true, true, true],
  )
  const ordinary = times.ordinary
  if (typeof ordinary !== 'number')
    assert.fail('the ordinary page was not filtered before the deadline')
  assert.deepEqual(
    Object.entries(times).filter(
      ([name, milliseconds]) =>
        name !== 'ordinary' &&
        (milliseconds === 'unfinished' ||
          milliseconds > CRAFTED_PAGE_BOUND_RATIO * ordinary),
    ),
    [],
    `the ordinary page took ${ordinary} ms`,
  )
})

// Value: protects=the extension host, which filters every served Wiki page synchronously, from seconds of filtering per crafted page; fails_when=an end tag whose name no open element has walks the open elements again in plain HTML, in a table, caption, table body, row or cell, or for a formatting, heading, form, template, select, table or table-section name, so each end costs as much as the nesting is deep; why_new=Cycle 0046 second /ship performance review PERF1 measured 1.5 to 6 s for these pages against 150 to 220 ms for the ordinary page; seam=a worker thread, so the deadline can stop a filtering that does not end; no_claim=native editor responsiveness (reader runs in an isolated test worker)
test('the reader filters a page of more than 1 MB of deep plain, table-held or foreign nesting with unmatched ends of any name within four times the time of an ordinary page', async () => {
  // Arrange: 20,000 open elements, then 20,000 ends of a name none of them has, in each insertion mode the reader skips such ends in.
  const pages = {
    unmatchedHtmlEnds: ('<x>'.repeat(20_000) + '</y>'.repeat(20_000)).padEnd(
      1_000_001,
      ' ',
    ),
    unmatchedEndsInKnownElements: (
      '<span>'.repeat(20_000) + '</x>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedHtmlEndsInCell: (
      '<table><tr><td>' +
      '<x>'.repeat(20_000) +
      '</y>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignEndsInCell: (
      '<table><tr><td><svg>' +
      '<g>'.repeat(20_000) +
      '</x>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignEndsInCaption: (
      '<table><caption><svg>' +
      '<g>'.repeat(20_000) +
      '</x>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignEndsInFosteredTable: (
      '<table><svg>' +
      '<g>'.repeat(20_000) +
      '</x>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignEndsInTableBody: (
      '<table><tbody><svg>' +
      '<g>'.repeat(20_000) +
      '</x>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignEndsInRow: (
      '<table><tr><svg>' +
      '<g>'.repeat(20_000) +
      '</x>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignSectionEndsInRow: (
      '<table><tr><svg>' +
      '<g>'.repeat(20_000) +
      '</tbody>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignFormattingEnds: (
      '<svg>' +
      '<g>'.repeat(20_000) +
      '</b>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignCodeEnds: (
      '<svg>' +
      '<g>'.repeat(20_000) +
      '</code>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    formattingEndsAfterTheirEntryLeft: (
      '<svg><foreignObject><div><b></div></b><svg>' +
      '<g>'.repeat(20_000) +
      '</b>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    formattingEndsAfterACellClosedItsEntry: (
      '<table><tr><td><b></td><svg>' +
      '<g>'.repeat(20_000) +
      '</b>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignHeadingEnds: (
      '<svg>' +
      '<g>'.repeat(20_000) +
      '</h1>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    formEndsAfterAFormLeftInATable: (
      '<table><form></table><svg>' +
      '<g>'.repeat(20_000) +
      '</form>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    formEndsInATemplateAfterAFormLeftInATable: (
      '<table><form></table><template><svg>' +
      '<g>'.repeat(20_000) +
      '</form>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignTemplateEnds: (
      '<svg>' +
      '<g>'.repeat(20_000) +
      '</template>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignSelectEnds: (
      '<svg>' +
      '<g>'.repeat(20_000) +
      '</select>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
    unmatchedForeignTableEnds: (
      '<svg>' +
      '<g>'.repeat(20_000) +
      '</table>'.repeat(20_000)
    ).padEnd(1_000_001, ' '),
  }

  // Act
  const times = await servingTimes(
    'withServedAddresses',
    'withServedAddresses',
    pages,
  )

  // Assert: every page is over 1 MB, and each crafted page was filtered within the bound of the ordinary page's time.
  assert.deepEqual(
    Object.values(pages).map((page) => page.length > 1_000_000),
    [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ],
  )
  const ordinary = times.ordinary
  if (typeof ordinary !== 'number')
    assert.fail('the ordinary page was not filtered before the deadline')
  assert.deepEqual(
    Object.entries(times).filter(
      ([name, milliseconds]) =>
        name !== 'ordinary' &&
        (milliseconds === 'unfinished' ||
          milliseconds > CRAFTED_PAGE_BOUND_RATIO * ordinary),
    ),
    [],
    `the ordinary page took ${ordinary} ms`,
  )
})

// Value: protects=the learner against an editor link far into a long page with CRLF line ends, which the reader finds at the offsets the parser reports after its input buffer dropped the first 64 KiB it read; fails_when=the start offsets drift from the page after the buffer's waterline or at a CR LF, so a refused link is read at the wrong place and served live, or text beside it is renamed; why_new=Cycle 0046 second /ship testing review TEST5 (every output test page was under 1 KB); seam=none
test('a refused link past the first 64 KiB of a page with CRLF line ends loses its link at its own place', () => {
  // Arrange: 5,000 paragraphs with a CR LF in their text and a refused link after each, about 215 KB.
  const page = '<p>x\r\ny</p><a href="vscode://file/x">x</a>\r\n'.repeat(5_000)

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert
  assert.equal(page.length > 65_536, true)
  assert.equal(
    served,
    '<p>x\r\ny</p><a data-codebook-unlinked="vscode://file/x">x</a>\r\n'.repeat(
      5_000,
    ),
  )
})

// Value: protects=the URL parser's exact edge character set and internal whitespace; fails_when=a generic trim removes Unicode space or keeps a C0 control at an edge; why_new=row 1052 replaces the trim algorithm; seam=none
test('browser addresses trim every C0 control and ASCII space only at their ends and keep other spaces', () => {
  // Arrange
  const controls = String.fromCharCode(
    ...Array.from({ length: 33 }, (_unused, index) => index),
  )
  const addresses = [
    controls + 'vs\tcode://laststance.codebook/source?x=a b' + controls,
    '\u0085\u00a0\u1680\u2000\u2028\u3000\ufeffx\ufeff\u3000\u2028\u2000\u1680\u00a0\u0085',
    ' x\v\fy ',
    controls,
    '',
  ]

  // Act
  const read = addresses.map(addressAsBrowserReads)

  // Assert
  assert.deepEqual(read, [
    'vscode://laststance.codebook/source?x=a b',
    '\u0085\u00a0\u1680\u2000\u2028\u3000\ufeffx\ufeff\u3000\u2028\u2000\u1680\u00a0\u0085',
    'x\v\fy',
    '',
    '',
  ])
})

// Value: protects=the reading of an attribute value the filter judges, as a browser reads it; fails_when=a number of the C1 range is read as the replacement character instead of the Windows-1252 character a browser gives it, or a named reference of a character outside ASCII (with or without its semicolon) is left as written, so the reader's text of the value is not the browser's; why_new=S1 (the hand-written decoder gave way to the HTML standard's, `decodeHTMLAttribute` of entities; each expected text is Chrome 151's DOMParser reading of the value); seam=none; no_claim=the filter's judgment of these values, which a character outside ASCII does not change
test('an attribute value with a C1 number or a reference to a character outside ASCII is read as Chrome reads it', () => {
  // Arrange: two C1 numbers, decimal and hexadecimal, a no-break space with its semicolon and an e acute without it.
  const written = ['&#128;', '&#x96;', 'a&nbsp;b', '&eacute']

  // Act
  const read = written.map(browserAttributeText)

  // Assert
  assert.deepEqual(read, ['\u20ac', '\u2013', 'a\u00a0b', '\u00e9'])
})

// Value: protects=unknown character references in a source link when the reader binds it to the serving editor; fails_when=inherited Object properties replace unknown references with function text; why_new=the named-reference cases cover known names and numbers, not inherited property names; seam=none; no_claim=browser navigation (pure reader output)
test('a source link keeps unknown character references when it is bound to the serving editor', () => {
  // Arrange
  const written = '&constructor &toString &hasOwnProperty &constructor; &amp;'
  const page =
    '<a href="vscode&#58;//laststance.codebook/source?root=%2Fr&path=src/math&constructor">source</a>'

  // Act
  const decoded = browserAttributeText(written)
  const served = withServedAddresses(page, 'cursor')

  // Assert
  assert.equal(
    decoded,
    '&constructor &toString &hasOwnProperty &constructor; &',
  )
  assert.equal(
    served,
    '<a href="cursor://laststance.codebook/source?root=%2Fr&amp;path=src/math&amp;constructor">source</a>',
  )
})

// Value: protects=reading an ordinary unknown HTML element while filtering the addresses inside it; fails_when=a tag named constructor reads an inherited property as a text-content rule and throws; why_new=the parser cases use standard elements and do not cover a table prototype name; seam=none; no_claim=browser navigation (pure reader output)
test('an unknown constructor element stays readable and its refused link loses its effect', () => {
  // Arrange
  const page = '<constructor><a href="vscode://file/x">source</a></constructor>'

  // Act
  const served = withServedAddresses(page, 'cursor')

  // Assert
  assert.equal(
    served,
    '<constructor><a data-codebook-unlinked="vscode://file/x">source</a></constructor>',
  )
})

// Value: protects=the editor's extension host, which rewrites every page the Wiki reader serves synchronously, Codebook's addresses and the rail's entry included; fails_when=the rebinding of Codebook's addresses reads the page by a pattern that backtracks over quotes and slashes, or the entry's description id is looked for once per number in the whole page, so a page of 1 MB stalls the host for minutes; why_new=Cycle 0046 /ship third review W1 and W5 (the rebinding joins the filter's single pass); seam=a worker thread, so the deadline can stop a rewrite that does not end
test('the reader serves a page of more than 1 MB built to make a pattern of its tags or its ids slow, Codebook’s addresses and the rail’s entry included, within four times the time of an ordinary page of that size', async () => {
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

  // Assert: every page is over 1 MB, and each crafted page was served within the bound of the ordinary page's time.
  assert.deepEqual(
    Object.values(pages).map((page) => page.length > 1_000_000),
    [true, true, true],
  )
  const ordinary = times.ordinary
  if (typeof ordinary !== 'number')
    assert.fail('the ordinary page was not served before the deadline')
  assert.deepEqual(
    Object.entries(times).filter(
      ([name, milliseconds]) =>
        name !== 'ordinary' &&
        (milliseconds === 'unfinished' ||
          milliseconds > CRAFTED_PAGE_BOUND_RATIO * ordinary),
    ),
    [],
    `the ordinary page took ${ordinary} ms`,
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

// Value: protects=the reader's handling of links after foreign/HTML tree boundaries; fails_when=an ignored outer end hides a real anchor; why_new=row1058 inert Chromium comparison; seam=none; no_claim=native editor or visual acceptance
test('an ignored outer SVG end does not hide a link after an HTML child closes', () => {
  // Arrange: the div keeps the outer SVG end from closing foreignObject.
  const page =
    '<svg><foreignObject><div></svg></div></foreignObject>' +
    '<style><p><a href="vscode://file/example">marker</a></p></style>'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert: Chromium reads the anchor after p leaves the SVG style element.
  assert.equal(
    served,
    '<svg><foreignObject><div></svg></div></foreignObject>' +
      '<style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style>',
  )
})

// Value: protects=a served page's editor link after an svg element closes while another of its name stays open; fails_when=the reader's count of open names drops a name when one of two elements of that name closes, so a later end of that name is skipped and a live link in svg is served as written, or style text is renamed; why_new=the timing pages repeat names but compare times only, and no reader test closes one of two same-named svg elements; seam=none; no_claim=native editor or visual acceptance (Chrome 151's DOMParser fixed the expected pages)
test('an end tag still closes an svg element after an inner one of the same name closed, so the link after it is judged where a browser reads it', () => {
  // Arrange: the second </g> closes the outer g, so its style is svg markup; the second </svg> closes the outer svg, so its style holds text.
  const outerGroupEnd =
    '<svg><g><g></g><foreignObject></g><style><a href="vscode://file/etc/hosts">hosts</a></style>'
  const outerSvgEnd =
    '<svg><svg></svg><g></svg><style><a href="vscode://file/example">marker</a></style>'

  // Act
  const servedAfterGroup = withServedAddresses(outerGroupEnd, 'vscode')
  const servedAfterSvg = withServedAddresses(outerSvgEnd, 'vscode')

  // Assert
  assert.equal(
    servedAfterGroup,
    '<svg><g><g></g><foreignObject></g><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
  )
  assert.equal(
    servedAfterSvg,
    '<svg><svg></svg><g></svg><style><a href="vscode://file/example">marker</a></style>',
  )
})

// Value: protects=the learner against an editor link after an end tag that names an svg element with a letter outside ASCII, which a browser matches by lowering A to Z only; fails_when=the foreign end rule lowers every letter of the element's name as the pinned parser does, so `</gÀ>` misses an open `gÀ` and the style after it is read as text while a browser serves its live `vscode://file` link, or `</gk>` closes a `gK` written with a Kelvin sign that a browser leaves open; why_new=found by the Chrome comparison of Cycle 0046 second /ship PERF1's differential; seam=none; no_claim=native editor (Chrome 151's DOMParser fixed the expected pages)
test('an end tag closes an svg element whose name holds a letter outside ASCII only when the names match with A to Z lowered, so the link after it is judged where a browser reads it', () => {
  // Arrange: the first two ends close gÀ and gK (Kelvin sign) with the title in them, so the style is svg markup; the last two ends match no element, so the title and the svg stay open.
  const pages = [
    '<svg><g\u00c0><title></g\u00c0><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<svg><g\u212a><title></g\u212a><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<svg><g\u212a><title></gk><style><a href="vscode://file/example">marker</a></style>',
    '<table><tr><td><svg><g\u212a><title><svg><g></gk></svg><style></style></title><style><a href="vscode://file/etc/hosts">hosts</a></style>',
  ]

  // Act
  const served = pages.map((page) => withServedAddresses(page, 'vscode'))

  // Assert
  assert.deepEqual(served, [
    '<svg><g\u00c0><title></g\u00c0><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<svg><g\u212a><title></g\u212a><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<svg><g\u212a><title></gk><style><a href="vscode://file/example">marker</a></style>',
    '<table><tr><td><svg><g\u212a><title><svg><g></gk></svg><style></style></title><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
  ])
})

// Value: protects=served Wiki links after HTML tree recovery; fails_when=full tree construction retains the marker across implicit and non-top closes is lost; why_new=row1058 browser comparisons; seam=none; no_claim=native or visual acceptance
test('HTML form, button, heading, table and formatting rules keep later foreign links visible', () => {
  // Arrange: each expected result is fixed by the inert-browser comparison.
  const cases: readonly [string, string][] = [
    [
      '<svg><foreignObject><form><form></form></foreignObject><style><p><a href="vscode://file/example">marker</a></p></style>',
      '<svg><foreignObject><form><form></form></foreignObject><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style>',
    ],
    [
      '<svg><foreignObject><button><button></button></foreignObject><style><p><a href="vscode://file/example">marker</a></p></style>',
      '<svg><foreignObject><button><button></button></foreignObject><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style>',
    ],
    [
      '<svg><foreignObject><h1><h2></h2></foreignObject><style><p><a href="vscode://file/example">marker</a></p></style>',
      '<svg><foreignObject><h1><h2></h2></foreignObject><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style>',
    ],
    [
      '<svg><foreignObject><table><tr><td></table></foreignObject><style><p><a href="vscode://file/example">marker</a></p></style>',
      '<svg><foreignObject><table><tr><td></table></foreignObject><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style>',
    ],
    [
      '<svg><foreignObject><b><p><i>x</b></i></p></foreignObject><style><p><a href="vscode://file/example">marker</a></p></style></svg>',
      '<svg><foreignObject><b><p><i>x</b></i></p></foreignObject><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style></svg>',
    ],
    [
      '<svg><foreignObject><form><div></form></div></foreignObject><style><p><a href="vscode://file/example">marker</a></p></style></svg>',
      '<svg><foreignObject><form><div></form></div></foreignObject><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style></svg>',
    ],
  ]

  // Act / Assert
  for (const [page, expected] of cases)
    assert.equal(withServedAddresses(page, 'vscode'), expected, page)
})

// Value: protects=served Wiki links after HTML tree recovery; fails_when=select compatibility stays in HTML dispatch and survives insertion-mode resets is lost, or a nested select or a select end no longer closes the open select, or an outer select past the cell counts as open; why_new=row1058 browser comparisons; the last four rows came from the /ship coverage audit, where each kept the reader green while one select adapter was removed; seam=none; no_claim=native or visual acceptance
test('current select rules keep foreign elements, end tags, table resets and templates', () => {
  // Arrange: each expected result is fixed by the inert-browser comparison; the last six by Chrome 151's DOMParser.
  const cases: readonly [string, string][] = [
    [
      '<select><svg><style><p><a href="vscode://file/example">marker</a></p></style></svg></select>',
      '<select><svg><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style></svg></select>',
    ],
    [
      '<select><svg><select><style><p><a href="vscode://file/example">marker</a></p></style></select></svg></select>',
      '<select><svg><select><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style></select></svg></select>',
    ],
    [
      '<select><svg><select></select><style><p><a href="vscode://file/example">marker</a></p></style></svg></select>',
      '<select><svg><select></select><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style></svg></select>',
    ],
    [
      '<select><div></select><svg><style><p><a href="vscode://file/example">marker</a></p></style></svg>',
      '<select><div></select><svg><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style></svg>',
    ],
    [
      '<select><table><tr><td>x</td></tr></table><svg><style><p><a href="vscode://file/example">marker</a></p></style></svg></select>',
      '<select><table><tr><td>x</td></tr></table><svg><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style></svg></select>',
    ],
    [
      '<select><template><svg><style><p><a href="vscode://file/example">marker</a></p></style></svg></template></select>',
      '<select><template><svg><style><p><a data-codebook-unlinked="vscode://file/example">marker</a></p></style></svg></template></select>',
    ],
    // A nested select closes the select of its cell, so the later section end closes the svg and the style holds text.
    [
      '<table><tr><td><select><select><svg><g></tbody><style><a href="vscode://file/example">marker</a></style>',
      '<table><tr><td><select><select><svg><g></tbody><style><a href="vscode://file/example">marker</a></style>',
    ],
    // A closed select gives its cell back the table's rules, so the section end closes the svg.
    [
      '<table><tr><td><select></select><svg><g></tbody><style><a href="vscode://file/example">marker</a></style>',
      '<table><tr><td><select></select><svg><g></tbody><style><a href="vscode://file/example">marker</a></style>',
    ],
    // The outer select is outside the cell's scope, so the inner select closes alone.
    [
      '<select><table><tr><td><select></select><svg><g></tbody><style><a href="vscode://file/example">marker</a></style>',
      '<select><table><tr><td><select></select><svg><g></tbody><style><a href="vscode://file/example">marker</a></style>',
    ],
    // After a select inside foreignObject closes, the outer select's children are read as in body, so a later svg is foreign.
    [
      '<select><svg><foreignObject><select></select><svg><style><a href="vscode://file/example">marker</a></style>',
      '<select><svg><foreignObject><select></select><svg><style><a data-codebook-unlinked="vscode://file/example">marker</a></style>',
    ],
    // A nested select closes the open one and is ignored, so the select end finds no select and the svg keeps a live link.
    [
      '<select><select><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
      '<select><select><svg><g></select><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    ],
    // A select end closes the select with the svg inside it, so the style holds text.
    [
      '<select><div><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
      '<select><div><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    ],
  ]

  // Act / Assert
  for (const [page, expected] of cases)
    assert.equal(withServedAddresses(page, 'vscode'), expected, page)
})

// Value: protects=the learner against an editor link after a select that Chromium closes at a table row, a new cell or an input; fails_when=the reader keeps the select open in body rules, so its end closes the svg and a live `vscode://file` link in svg's style is served as written; why_new=the /ship coverage audit found the three pages; the select table covers a select's own children, not the tokens that close it; seam=none; no_claim=native editor or visual acceptance (Chrome 151's DOMParser fixed the expected pages)
test('an editor link after a select that a table row, a new cell or an input closes loses its link where Chromium reads it', () => {
  // Arrange: in each page Chromium closes the select first, so </select> is ignored and the style stays svg markup with a live link.
  const pages = [
    '<table><select><tr><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tr><td><select><td><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<select><input><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><select><td><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><select></table><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tr><td><select></td><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><colgroup><select><tr><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
  ]

  // Act
  const served = pages.map((page) => withServedAddresses(page, 'vscode'))

  // Assert
  assert.deepEqual(served, [
    '<table><select><tr><svg><g></select><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tr><td><select><td><svg><g></select><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<select><input><svg><g></select><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<table><select><td><svg><g></select><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<table><select></table><svg><g></select><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tr><td><select></td><svg><g></select><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<table><colgroup><select><tr><svg><g></select><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
  ])
})

// Value: protects=the learner against an editor link after a select that a hidden input closes only where Chromium's body rule takes the input; fails_when=every input closes an open select, so a hidden input in a table makes its style svg markup and renames text, or no input does, so a hidden input in a caption leaves a live `vscode://file` link served; why_new=row 1064, Chrome 151 DOMParser on the same pages; seam=none; no_claim=native editor (browser result from headless Chromium's DOMParser)
test('a hidden input closes an open select in a table caption but not in the table itself, as Chromium reads them', () => {
  // Arrange: in a table the table rule takes a hidden input and leaves the select open; in a caption the body rule closes the select.
  const inTable =
    '<table><select><input type=hidden><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>'
  const inCaption =
    '<table><caption><select><input type=hidden><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>'

  // Act
  const servedInTable = withServedAddresses(inTable, 'vscode')
  const servedInCaption = withServedAddresses(inCaption, 'vscode')

  // Assert: the table's select end closes the svg, so its anchor is style text; the caption's svg stays open with a live link.
  assert.equal(
    servedInTable,
    '<table><select><input type=hidden><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
  )
  assert.equal(
    servedInCaption,
    '<table><caption><select><input type=hidden><svg><g></select><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
  )
})

// Value: protects=a served page's text after a select that a hidden input leaves open in a table body or a row, or whose type is written in capitals; fails_when=HTML_PARSER_HIDDEN_INPUT_TABLE_MODES misses the table-body or the row mode, or the type is compared without ASCII case folding, so the input closes the select, the select end leaves the svg open and the style text is renamed; why_new=Cycle 0046 second /ship testing review TEST3 (only the table mode and a lower-case type were pinned); seam=none; no_claim=native editor (Chrome 151's DOMParser fixed the expected pages)
test('a hidden input in a table body or a row, or written HIDDEN, leaves an open select open, so the style text after the select stays as written', () => {
  // Arrange: the table rule takes each input, so </select> closes the select with the svg in it and the style holds text.
  const pages = [
    '<table><tbody><select><input type=hidden><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tr><select><input type=hidden><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><select><input type=HIDDEN><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
  ]

  // Act
  const served = pages.map((page) => withServedAddresses(page, 'vscode'))

  // Assert
  assert.deepEqual(served, [
    '<table><tbody><select><input type=hidden><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tr><select><input type=hidden><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><select><input type=HIDDEN><svg><g></select><style><a href="vscode://file/etc/hosts">hosts</a></style>',
  ])
})

// Value: protects=a live editor link after a noscript that a browser with scripting reads as raw text; fails_when=the parser runs with scripting disabled, so the noscript's style swallows the link and it is served live, or the noscript's own text is renamed; why_new=no reader test wrote noscript (/ship coverage audit); seam=none; no_claim=native editor (Chrome 151 iframe srcdoc with scripting gave the result)
test('a link after a noscript is judged as a browser with scripting reads it, and a link inside the noscript text is served as written', () => {
  // Arrange: with scripting a noscript holds raw text up to its end tag.
  const afterNoscript =
    '<noscript><style></noscript><a href="vscode://file/etc/hosts">x</a>'
  const insideNoscript =
    '<noscript><a href="vscode://file/example">x</a></noscript>'

  // Act
  const servedAfter = withServedAddresses(afterNoscript, 'vscode')
  const servedInside = withServedAddresses(insideNoscript, 'vscode')

  // Assert
  assert.equal(
    servedAfter,
    '<noscript><style></noscript><a data-codebook-unlinked="vscode://file/etc/hosts">x</a>',
  )
  assert.equal(
    servedInside,
    '<noscript><a href="vscode://file/example">x</a></noscript>',
  )
})

// Value: protects=literal text after a heading-family end from foreign content; fails_when=the no-match shortcut discards an h2 end while h1 is open; why_new=row1058 browser capture054; seam=none
test('a heading-family end from a foreign child restores HTML style text', () => {
  // Arrange
  const page =
    '<svg><foreignObject><h1><svg><g></h2><style><a href="vscode://file/example">marker</a></style>'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert: the apparent anchor is raw text after h2 closes the open h1.
  assert.equal(
    served,
    '<svg><foreignObject><h1><svg><g></h2><style><a href="vscode://file/example">marker</a></style>',
  )
})

// Value: protects=the learner against an editor link after a `</p>` or `</br>` that leaves svg, and a served page's text after a heading end that closes an open heading of another level, though no element of the end's name is open; fails_when=the reader skips such an end as one that changes nothing (p or br missing from HTML_PARSER_ABSENT_END_BODY_NAMES, a level missing from HTML_PARSER_HEADING_NAMES), so a CDATA section hides a live `vscode://file` link or style text is renamed; why_new=Cycle 0046 second /ship testing review TEST1, after PERF1 skips absent ends in every mode; seam=none; no_claim=native editor (Chrome 151's DOMParser fixed the expected pages)
test('a </p> or </br> leaves svg and a heading end closes an open heading of any other level, so what follows is judged where a browser reads it', () => {
  // Arrange: after </p> or </br> the CDATA start is a bogus comment that ends at its first >, so the link is a tag; each heading end closes the open heading and the svg in it, so the style holds text.
  const pages = [
    '<svg><g></p><![CDATA[ x ><a href="vscode://file/etc/hosts">hosts</a> ]]>',
    '<svg><g></br><![CDATA[ x ><a href="vscode://file/etc/hosts">hosts</a> ]]>',
    '<svg><foreignObject><h2><svg><g></h1><style><a href="vscode://file/example">marker</a></style>',
    '<svg><foreignObject><h3><svg><g></h2><style><a href="vscode://file/example">marker</a></style>',
    '<svg><foreignObject><h4><svg><g></h3><style><a href="vscode://file/example">marker</a></style>',
    '<svg><foreignObject><h5><svg><g></h4><style><a href="vscode://file/example">marker</a></style>',
    '<svg><foreignObject><h6><svg><g></h5><style><a href="vscode://file/example">marker</a></style>',
    '<svg><foreignObject><h1><svg><g></h6><style><a href="vscode://file/example">marker</a></style>',
  ]

  // Act
  const served = pages.map((page) => withServedAddresses(page, 'vscode'))

  // Assert
  assert.deepEqual(served, [
    '<svg><g></p><![CDATA[ x ><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a> ]]>',
    '<svg><g></br><![CDATA[ x ><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a> ]]>',
    '<svg><foreignObject><h2><svg><g></h1><style><a href="vscode://file/example">marker</a></style>',
    '<svg><foreignObject><h3><svg><g></h2><style><a href="vscode://file/example">marker</a></style>',
    '<svg><foreignObject><h4><svg><g></h3><style><a href="vscode://file/example">marker</a></style>',
    '<svg><foreignObject><h5><svg><g></h4><style><a href="vscode://file/example">marker</a></style>',
    '<svg><foreignObject><h6><svg><g></h5><style><a href="vscode://file/example">marker</a></style>',
    '<svg><foreignObject><h1><svg><g></h6><style><a href="vscode://file/example">marker</a></style>',
  ])
})

// Value: protects=the learner against an editor link after a `</table>` in a template's content, where no table is open but the end still closes the open caption, table section or row; fails_when=the reader skips `</table>` there as an absent end ('table' missing from a mode's set in HTML_PARSER_ABSENT_END_MODE_TABLE_NAMES), so the later section or row end closes the svg and a live `vscode://file` link in svg's style is served as written; why_new=Cycle 0046 second /ship PERF1 skips absent ends in the table modes; seam=none; no_claim=native editor (Chrome 151's DOMParser fixed the expected pages, reading the template's content)
test('a </table> in a template closes the open caption, table section or row though no table is open, so a link in a later svg style loses its link', () => {
  // Arrange: </table> closes the caption, tbody or tr with its svg; the next svg is fostered into the template, and the caption, tbody or tr end is then ignored.
  const pages = [
    '<template><caption><svg><g></table><svg></caption><style><a href="vscode://file/etc/hosts">hosts</a></style></template>',
    '<template><tbody><svg><g></table><svg></tbody><style><a href="vscode://file/etc/hosts">hosts</a></style></template>',
    '<template><tr><svg><g></table><svg></tr><style><a href="vscode://file/etc/hosts">hosts</a></style></template>',
  ]

  // Act
  const served = pages.map((page) => withServedAddresses(page, 'vscode'))

  // Assert
  assert.deepEqual(served, [
    '<template><caption><svg><g></table><svg></caption><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style></template>',
    '<template><tbody><svg><g></table><svg></tbody><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style></template>',
    '<template><tr><svg><g></table><svg></tr><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style></template>',
  ])
})

// Value: protects=the learner against an editor link after a formatting end that removes the entry of a formatting element closed earlier, or a form end that forgets a form left in a table, though no element of the end's name is open; fails_when=the reader's count of the active formatting list's names misses an entry (a pushed one, or one the adoption agency inserts after its bookmark), or the form end is skipped while the form pointer is set, so a later end closes the svg and a live `vscode://file` link in svg's style is served as written; why_new=Cycle 0046 second /ship testing review TEST1 and PERF1's list index; seam=none; no_claim=native editor (Chrome 151's DOMParser fixed the expected pages)
test('a formatting end removes the entry of a formatting element closed earlier and a form end forgets a form left in a table, so a link in a later svg style loses its link', () => {
  // Arrange: in the first two pages the second </b> removes the entry of a b that </div> closed, so the next svg is not put in a b again and the last </b> leaves it open; in the last page </form> clears the pointer, so the later form is inserted and stops </x> before the svg.
  const pages = [
    '<svg><foreignObject><div><b><svg><g></div></b><svg><g></b><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<svg><foreignObject><div><b><address><address><address><address><address><address><address><address><address>x</b><svg><g></div></b><svg><g></b><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><form></table></form><x><form><svg><g></x><style><a href="vscode://file/etc/hosts">hosts</a></style>',
  ]

  // Act
  const served = pages.map((page) => withServedAddresses(page, 'vscode'))

  // Assert
  assert.deepEqual(served, [
    '<svg><foreignObject><div><b><svg><g></div></b><svg><g></b><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<svg><foreignObject><div><b><address><address><address><address><address><address><address><address><address>x</b><svg><g></div></b><svg><g></b><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<table><form></table></form><x><form><svg><g></x><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
  ])
})

// Value: protects=active Wiki links after an unmatched table-section end; fails_when=the parser closes a row because tr alone is in scope, or the row's guard also refuses a matching section that has no row; why_new=row1058 inert Chromium captures055/056; the section without a row came from the /ship coverage audit, where the reader stayed green with the guard in every insertion mode; seam=none; no_claim=native editor or visual acceptance
test('an absent table section cannot hide a foreign link while a matching section restores style text', () => {
  // Arrange: the implicit section is tbody; thead is absent.
  const unmatched =
    '<table><tr><svg><g></thead><style><a href="vscode://file/example">marker</a></style>'
  const matched =
    '<table><tr><svg><g></tbody><style><a href="vscode://file/example">marker</a></style>'
  // A thead written without a row: its end closes it although no tr is open (Chrome 151's DOMParser).
  const matchedWithoutRow =
    '<table><thead><svg><g></thead><style><a href="vscode://file/example">marker</a></style>'

  // Act
  const unmatchedResult = withServedAddresses(unmatched, 'vscode')
  const matchedResult = withServedAddresses(matched, 'vscode')
  const matchedWithoutRowResult = withServedAddresses(
    matchedWithoutRow,
    'vscode',
  )

  // Assert: only the unmatched end leaves an active SVG anchor to filter.
  assert.equal(
    unmatchedResult,
    '<table><tr><svg><g></thead><style><a data-codebook-unlinked="vscode://file/example">marker</a></style>',
  )
  assert.equal(
    matchedResult,
    '<table><tr><svg><g></tbody><style><a href="vscode://file/example">marker</a></style>',
  )
  assert.equal(
    matchedWithoutRowResult,
    '<table><thead><svg><g></thead><style><a href="vscode://file/example">marker</a></style>',
  )
})

// Value: protects=the learner against an editor link after a table-section end in a row that a browser ignores: the section is open nowhere, or only in an outer table, out of table scope; fails_when=a section name is missing from HTML_PARSER_TABLE_SECTION_NAMES, so the pinned parser closes the inner row because a tr is in scope, or an absent section end is no longer skipped as one that changes nothing, and the svg closes with it, so a live `vscode://file` link in svg's style is served as written; why_new=Cycle 0046 second /ship testing review TEST2 (only thead was pinned) and PERF1, after which an absent section end in a row is skipped before the guard; seam=none; no_claim=native editor (Chrome 151's DOMParser fixed the expected pages)
test('a tbody, tfoot or thead end in a row whose section is absent, or open only in an outer table, cannot close the row, so a link in a later svg style loses its link', () => {
  // Arrange: in the first two pages the section is open nowhere; in the last three only the outer table has it, outside the inner table's scope.
  const pages = [
    '<table><thead><tr><svg><g></tbody><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tr><svg><g></tfoot><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tbody><tr><td><table><thead><tr><svg><g></tbody><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tfoot><tr><td><table><tr><svg><g></tfoot><style><a href="vscode://file/etc/hosts">hosts</a></style>',
    '<table><thead><tr><td><table><tr><svg><g></thead><style><a href="vscode://file/etc/hosts">hosts</a></style>',
  ]

  // Act
  const served = pages.map((page) => withServedAddresses(page, 'vscode'))

  // Assert
  assert.deepEqual(served, [
    '<table><thead><tr><svg><g></tbody><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tr><svg><g></tfoot><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tbody><tr><td><table><thead><tr><svg><g></tbody><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<table><tfoot><tr><td><table><tr><svg><g></tfoot><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
    '<table><thead><tr><td><table><tr><svg><g></thead><style><a data-codebook-unlinked="vscode://file/etc/hosts">hosts</a></style>',
  ])
})

// Value: protects=the browser from promoting a duplicate href after the first is renamed; fails_when=only parse5's first normalized attribute is kept; why_new=row1058 original-offset contract; seam=none
test('all original duplicate URL attributes lose their effects', () => {
  // Arrange
  const page =
    '<a href="vscode://file/first" HREF="vscode://file/second">marker</a>'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert: changing the first name cannot activate an unedited second href.
  assert.equal(
    served,
    '<a data-codebook-unlinked="vscode://file/first" data-codebook-unlinked="vscode://file/second">marker</a>',
  )
})

test('a style inside a select keeps its text under current browser parsing rules', () => {
  // Arrange: current Chromium treats style as HTML raw text inside select.
  const page =
    '<select><style></select><a href="vscode://file/example">marker</a>'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert: the apparent anchor is still style text, not a link.
  assert.equal(
    served,
    '<select><style></select><a href="vscode://file/example">marker</a>',
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

// Value: protects=a page published before the publisher held a quote's source to its schemes, which the reader serves beside pages published today; fails_when=the reader leaves `cite` out of its address attributes, so a quote, an inline quote or an edit serves a `javascript:`, editor or network-path source the publisher refuses today; why_new=Cycle 0046 second /ship MAINT2 (W4 added `cite` to the publisher's address attributes alone); seam=none, the served page is compared as text; no_claim=a browser follows `cite` without a script
test('a quote, an inline quote and an edit whose cite names another scheme or a network path lose that address, as the publisher refuses it, and a cite of the web stays', () => {
  // Arrange
  const page =
    '<blockquote cite="javascript:run()"><p>a</p></blockquote>' +
    '<q cite="vscode://file/etc/hosts">b</q>' +
    '<del cite="//host/x">c</del>' +
    '<ins cite="https://example.com/why">d</ins>'

  // Act
  const served = withServedAddresses(page, 'vscode')

  // Assert
  assert.equal(
    served,
    '<blockquote data-codebook-unlinked="javascript:run()"><p>a</p></blockquote>' +
      '<q data-codebook-unlinked="vscode://file/etc/hosts">b</q>' +
      '<del data-codebook-unlinked="//host/x">c</del>' +
      '<ins cite="https://example.com/why">d</ins>',
  )
})

// Value: protects=the parity of the reader's and the publisher's address rules, so a page reads alike published today and served; fails_when=one of the two copies of the address attributes gains or loses an attribute and the other does not, as `cite` drifted unseen; why_new=Cycle 0046 second /ship MAINT2 (no test held the two sets together); seam=none (the shipped publisher and the compiled reader); no_claim=attributes outside the listed address-valued ones of HTML and SVG
test('the reader takes the effect from an address of another scheme in exactly the attributes in which the shipped publisher refuses it', async () => {
  // Arrange: the publisher's refusal of a page's content, and every attribute HTML or SVG reads as an address.
  const { scriptingClauseOf } = (await import(
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
  )) as { scriptingClauseOf: (html: string) => string | undefined }
  const addressValuedNames = [
    'action',
    'archive',
    'attributionsrc',
    'background',
    'cite',
    'classid',
    'codebase',
    'data',
    'dynsrc',
    'formaction',
    'href',
    'icon',
    'imagesrcset',
    'itemid',
    'itemtype',
    'longdesc',
    'lowsrc',
    'manifest',
    'ping',
    'poster',
    'profile',
    'src',
    'srcset',
    'usemap',
    'xlink:href',
  ]

  // Act: the attributes whose `javascript:` address each side judges as an address.
  const publisherRefuses = addressValuedNames.filter(
    (name) =>
      scriptingClauseOf(`<p ${name}="javascript:run()">x</p>`)?.startsWith(
        'must link only to',
      ) === true,
  )
  const readerUnlinks = addressValuedNames.filter((name) =>
    withServedAddresses(
      `<p ${name}="javascript:run()">x</p>`,
      'vscode',
    ).includes('data-codebook-unlinked'),
  )

  // Assert
  assert.deepEqual(readerUnlinks, publisherRefuses)
  assert.deepEqual(publisherRefuses, [
    'action',
    'cite',
    'formaction',
    'href',
    'src',
    'srcset',
    'xlink:href',
  ])
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

// Value: protects=the learner against a link whose href follows an attribute name that starts with `=`, which a browser reads as the name's first character; fails_when=the reader scans a name from its first character, so `=` ends an empty name, `href=…` is read as its value and the live `vscode://file` link is served, or text in a value is renamed; why_new=the /ship coverage audit: no test writes `=` first in a name; seam=none; no_claim=native editor or visual acceptance (Chrome 151's DOMParser fixed the expected pages)
test('an href after an attribute name that starts with = is judged, and an href inside the value of a name = is served as written', () => {
  // Arrange: a browser reads `=` as a name of its own before ` href`, and `==` as the name `=` whose value is `href="…"`.
  const pages = [
    '<a = href="vscode://file/etc/hosts">hosts</a>',
    '<a == href="vscode://file/etc/hosts">hosts</a>',
  ]

  // Act
  const served = pages.map((page) => withServedAddresses(page, 'vscode'))

  // Assert
  assert.deepEqual(served, [
    '<a = data-codebook-unlinked="vscode://file/etc/hosts">hosts</a>',
    '<a == href="vscode://file/etc/hosts">hosts</a>',
  ])
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
