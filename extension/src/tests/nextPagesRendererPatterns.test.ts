import assert from 'node:assert/strict'
import { test } from 'node:test'

import { holdsNextPagesRendererPatterns } from '../utils/holdsNextPagesRendererPatterns'
import { nextPagesDataFunctionCallAt } from '../utils/nextPagesDataFunctionCallAt'

import { pagesRuntimeTextOf } from './utils/pagesRuntimeText'

// Value: protects=AC 20 recognition: the data-function call frame of Next 16's Pages renderer is found by its call text (`getServerSideProps(`, `getStaticProps(`) and by the text of the traced await that wraps it, at the line and column V8 reported in the recorded payloads (16.1.4: 20:438, 20:298, 12:7088, 12:6961) and at the same texts in 16.4.4; other renderer locations (`render`) are no call; fails_when=a pattern drifts from the runtime text, so a call frame is missed and every hit reads as outside the data function, or the `render` frame is taken for a call; no_claim=the whole runtime file (only the vendored fragments of each version are loaded, at their real line and column), Next versions other than 16.1.4 and 16.4.4
test('finds the data-function call by its call text and its traced-await text in the renderer lines of Next 16.1.4 and 16.4.4', () => {
  // Arrange
  const runtime1614 = pagesRuntimeTextOf('16.1.4')
  const runtime1644 = pagesRuntimeTextOf('16.4.4')

  // Act, Assert
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1614, 20, 438), {
    dataFunction: 'getServerSideProps',
    form: 'call',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1614, 20, 298), {
    dataFunction: 'getServerSideProps',
    form: 'traced-await',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1614, 12, 7088), {
    dataFunction: 'getStaticProps',
    form: 'call',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1614, 12, 6961), {
    dataFunction: 'getStaticProps',
    form: 'traced-await',
  })
  assert.equal(nextPagesDataFunctionCallAt(runtime1614, 23, 1110), undefined)
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1644, 20, 350), {
    dataFunction: 'getServerSideProps',
    form: 'call',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1644, 20, 210), {
    dataFunction: 'getServerSideProps',
    form: 'traced-await',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1644, 12, 6112), {
    dataFunction: 'getStaticProps',
    form: 'call',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1644, 12, 5985), {
    dataFunction: 'getStaticProps',
    form: 'traced-await',
  })
  assert.equal(holdsNextPagesRendererPatterns(runtime1614), true)
  assert.equal(holdsNextPagesRendererPatterns(runtime1644), true)
})

// Value: protects=AC 20 unrecognised runtime: a runtime text that holds neither pattern is reported as unrecognised and finds no call at any location, which makes every hit `no-renderer-frame`; fails_when=a text without the patterns reads as recognised, or a location of it is taken for a call; no_claim=the verdict built on it (the verdict tests pin `no-renderer-frame`), the once-per-run journal line and the Next version in it (the run's)
test('a renderer text that holds neither pattern is unrecognised and finds no call', () => {
  // Arrange
  const changedRuntime =
    'async function renderToHTMLImpl(){const data=await loadData({req});return data}\nfunction render(){return renderToHTMLImpl()}'

  // Act, Assert
  assert.equal(holdsNextPagesRendererPatterns(changedRuntime), false)
  assert.equal(nextPagesDataFunctionCallAt(changedRuntime, 0, 0), undefined)
  assert.equal(nextPagesDataFunctionCallAt(changedRuntime, 0, 26), undefined)
})

/** The tracer-constants enum as every compiled runtime of Next 16.1.4 bundles it (`pages-api.runtime.dev.js` 0:41631, `app-page.runtime.dev.js` 24:17439, `pages.runtime.dev.js` 0:47083), MIT, (c) Vercel, Inc. */
const TRACER_CONSTANTS_ENUM_1614 =
  'RenderSpan1=((RenderSpan=RenderSpan1||{}).getServerSideProps="Render.getServerSideProps",RenderSpan.getStaticProps="Render.getStaticProps",RenderSpan.renderToString="Render.renderToString"'

// Value: protects=finding OCR verdict lens (renderer recognition): the tracer-constants enum that pages-api, app-page and app-route runtimes bundle, and a Pages renderer that kept it but lost its call sites, are not a recognised renderer and find no traced-await call at the enum's location; fails_when=`RenderSpan.getStaticProps` of the enum counts as the renderer's text, so a renderer whose call sites changed reads as recognised and every real hit is resumed outside-data-function; no_claim=the run's journal entry (the run test pins it)
test('the tracer-constants enum every Next runtime bundles does not make a text the Pages renderer', () => {
  // Arrange
  const pagesApiRuntime = `var tracer;${TRACER_CONSTANTS_ENUM_1614};module.exports=apiResolver`
  const rendererWithoutCallSites = `${TRACER_CONSTANTS_ENUM_1614}\nasync function renderToHTMLImpl(req,res,pathname){data=await loadPageData({req:req,res:res})}`

  // Act, Assert
  assert.equal(holdsNextPagesRendererPatterns(pagesApiRuntime), false)
  assert.equal(holdsNextPagesRendererPatterns(rendererWithoutCallSites), false)
  assert.equal(
    nextPagesDataFunctionCallAt(rendererWithoutCallSites, 0, 89),
    undefined,
  )
})

// Value: protects=finding OCR verdict lens (unannounced script identification): a page module that declares its data function (`export async function getServerSideProps(`, `export async function getStaticProps(`) is never taken for Next's renderer; fails_when=a page module parsed before the debugger attached is added to the renderer's scripts, so its frame reads as the renderer and the page module is lost from the page read; no_claim=webpack's real eval wrapping of the module (only its declarations matter here)
test('a page module that declares getServerSideProps or getStaticProps is never the Pages renderer', () => {
  // Arrange
  const serverSidePropsPage =
    'export default function Home({ count }) {\n  return count\n}\nexport async function getServerSideProps({ query }) {\n  return { props: { count: 3 } }\n}\n//# sourceURL=webpack-internal:///(pages-dir-node)/./pages/index.tsx'
  const staticPropsPage =
    'export async function getStaticProps() {\n  return { props: {} }\n}\n//# sourceURL=webpack-internal:///(pages-dir-node)/./pages/about.tsx'

  // Act, Assert
  assert.equal(holdsNextPagesRendererPatterns(serverSidePropsPage), false)
  assert.equal(holdsNextPagesRendererPatterns(staticPropsPage), false)
})

// Value: protects=location lookup bounds: a location past the last line or past the end of its line finds no call and does not throw, and a text with CRLF or Unicode line terminators numbers its lines as V8 does; fails_when=a stale location throws, or a Windows or separator-bearing runtime shifts the lines so a call is missed; no_claim=none beyond protects
test('a location outside the text finds no call and CRLF, CR, LS and PS count as line ends', () => {
  // Arrange
  const call = 'getServerSideProps({req})'
  const separators = [
    '\r\n',
    '\r',
    String.fromCharCode(0x2028),
    String.fromCharCode(0x2029),
  ]

  // Act, Assert
  assert.equal(nextPagesDataFunctionCallAt('', 0, 0), undefined)
  assert.equal(nextPagesDataFunctionCallAt(call, 5, 0), undefined)
  assert.equal(nextPagesDataFunctionCallAt(call, 0, 500), undefined)
  for (const separator of separators)
    assert.deepEqual(
      nextPagesDataFunctionCallAt(`first${separator}${call}`, 1, 0),
      { dataFunction: 'getServerSideProps', form: 'call' },
      JSON.stringify(separator),
    )
})

// Value: protects=the cost of the renderer lookups of a hit: the frames of a hit ask one renderer text of about 1 MiB again and again, and only the first lookup numbers its lines, so 400 further lookups of a 500,000-line text together cost less than ten first lookups; fails_when=each lookup splits the whole text into its lines again (400 further lookups then cost about 400 first lookups); no_claim=a time in milliseconds (the bound compares the lookups with the first one on the same machine and load)
test('looks up many frames of one large renderer text without numbering its lines again for each', () => {
  // Arrange
  const lineCount = 500_000
  const largeText = `${'x\n'.repeat(lineCount)}getServerSideProps({req})`
  const furtherLookupCount = 400

  // Act
  const firstStartedAt = performance.now()
  const firstCall = nextPagesDataFunctionCallAt(largeText, lineCount, 0)
  const firstLookupMs = performance.now() - firstStartedAt
  const furtherStartedAt = performance.now()
  let lastCall
  for (let lookup = 0; lookup < furtherLookupCount; lookup++)
    lastCall = nextPagesDataFunctionCallAt(largeText, lineCount, 0)
  const furtherLookupsMs = performance.now() - furtherStartedAt

  // Assert
  assert.deepEqual(firstCall, {
    dataFunction: 'getServerSideProps',
    form: 'call',
  })
  assert.deepEqual(lastCall, {
    dataFunction: 'getServerSideProps',
    form: 'call',
  })
  assert.ok(
    furtherLookupsMs < firstLookupMs * 10,
    `${furtherLookupCount} further lookups took ${furtherLookupsMs} ms, the first ${firstLookupMs} ms`,
  )
})

// Value: protects=the lookup cache is keyed by the text: two different renderer texts asked in turn at the same line and column each answer for their own text, and a copy of a text answers as the text does; fails_when=the numbering of one text is reused for another (a call is found in a text that has none, or missed in one that has it); no_claim=how many texts are kept
test('answers each renderer text for itself when lookups of different texts alternate', () => {
  // Arrange
  const textWithCall = 'first\nlet a=1;getServerSideProps({req})\nlast'
  const textWithStaticCall = 'first\nlet a=1;getStaticProps({params})\nlast'
  const textWithoutCall = 'first\nlet a=1;render(req,res)\nlast'
  const copyOfTextWithCall = [
    'first',
    'let a=1;getServerSideProps({req})',
    'last',
  ].join('\n')

  // Act
  const answers = [
    nextPagesDataFunctionCallAt(textWithCall, 1, 8),
    nextPagesDataFunctionCallAt(textWithoutCall, 1, 8),
    nextPagesDataFunctionCallAt(textWithStaticCall, 1, 8),
    nextPagesDataFunctionCallAt(textWithCall, 1, 8),
    nextPagesDataFunctionCallAt(copyOfTextWithCall, 1, 8),
    nextPagesDataFunctionCallAt(textWithCall, 2, 0),
  ]

  // Assert
  assert.deepEqual(answers, [
    { dataFunction: 'getServerSideProps', form: 'call' },
    undefined,
    { dataFunction: 'getStaticProps', form: 'call' },
    { dataFunction: 'getServerSideProps', form: 'call' },
    { dataFunction: 'getServerSideProps', form: 'call' },
    undefined,
  ])
})
