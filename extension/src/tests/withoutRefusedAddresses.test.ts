import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'

import { withoutRefusedAddresses } from '../utils/withoutRefusedAddresses'

/** The longest the reader may take to filter one page of the timing test, in milliseconds. Its slowest page took 75 ms on the development host (16 CPUs, Node 22); the bound leaves about five times that for a two-core CI runner under load, while a reading from every `<` took 20 to 28 s for a page of 48 to 74 KB. */
const FILTER_BOUND_MS = 400
/** How long the timing test waits for its worker before it takes the filtering for unfinished, in milliseconds. */
const FILTER_DEADLINE_MS = 10_000

/**
 * Filters pages in a worker thread with the compiled filter and answers how long each took, or `unfinished` for the pages left when the deadline passed; the filter runs synchronously, so only a worker can be stopped while it runs. Called by the timing test.
 * @param pages - The pages, by name.
 * @returns Each page's time in milliseconds, or `unfinished`.
 * @example
 * await filterTimes({ small: '<a href="x">x</a>' }) // => { small: 0.1 }
 */
async function filterTimes(
  pages: Record<string, string>,
): Promise<Record<string, number | 'unfinished'>> {
  const times: Record<string, number | 'unfinished'> = Object.fromEntries(
    Object.keys(pages).map((name) => [name, 'unfinished']),
  )
  const worker = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads')
const { withoutRefusedAddresses } = require(workerData.module)
for (const [name, page] of Object.entries(workerData.pages)) {
  const started = performance.now()
  withoutRefusedAddresses(page)
  parentPort.postMessage([name, performance.now() - started])
}`,
    {
      eval: true,
      workerData: {
        module: join(__dirname, '..', 'utils', 'withoutRefusedAddresses.js'),
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

// Value: protects=the editor's extension host, which filters every page the Wiki reader serves synchronously; fails_when=the filter reads the page again from each `<`, so a page today's publisher accepts (a title of 20,000 `<b `) or one written into the Wiki folder stalls the host for seconds on every load, and the page can have itself loaded again; why_new=Cycle 0046 /ship third review W1 (critical; performance, security, Codex, CodeRabbit and the adversarial step); seam=a worker thread, so the deadline can stop a filter that does not end
test('the reader filters a page of more than 1 MB built to make a reading from every < slow in under 400 ms', async () => {
  // Arrange: the reviewers' page scaled past 1 MB, a page of quotes that open values, a page of refused links, and svg styles that hold markup.
  const pages = {
    nestedTagStarts: `<p title="${'<b '.repeat(350_000)}">x</p>`,
    openingQuotes: `<a b="'${'<a b=\'"'.repeat(150_000)}`,
    refusedLinks: '<a href="vscode://file/x">x</a>'.repeat(35_000),
    svgStyles: '<svg><style><a href="javascript:x">'.repeat(30_000),
  }

  // Act
  const times = await filterTimes(pages)

  // Assert: every page is over 1 MB, and each was filtered within the bound.
  assert.deepEqual(
    Object.values(pages).map((page) => page.length > 1_000_000),
    [true, true, true, true],
  )
  assert.deepEqual(
    Object.entries(times).filter(
      ([, milliseconds]) =>
        milliseconds === 'unfinished' || milliseconds >= FILTER_BOUND_MS,
    ),
    [],
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
  const served = withoutRefusedAddresses(page)

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
  const served = withoutRefusedAddresses(page)

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
  const served = withoutRefusedAddresses(page)

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
