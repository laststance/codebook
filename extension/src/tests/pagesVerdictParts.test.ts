import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createVerdictBudget } from '../utils/createVerdictBudget'
import { isNextPagesRendererUrl } from '../utils/isNextPagesRendererUrl'
import { pagesCompiledPathOfModuleUrl } from '../utils/pagesCompiledPathOfModuleUrl'
import { pagesRequestPathOf } from '../utils/pagesRequestPathOf'
import { parsePagesPausedEvent } from '../utils/parsePagesPausedEvent'
import {
  readPagesAsyncChain,
  type PagesChainStep,
} from '../utils/readPagesAsyncChain'
import { readPagesRenderedPage } from '../utils/readPagesRenderedPage'
import { readWithinVerdictBudget } from '../utils/readWithinVerdictBudget'
import { valueShapeSummaryOf } from '../utils/valueShapeSummaryOf'

import { manualVerdictBudget } from './utils/manualVerdictBudget'
import { scriptedPagesReader } from './utils/scriptedPagesReader'

// Value: protects=renderer recognition by address: the renderer is the one `pages.runtime.dev.js` of the `next` package wherever it sits (file URL, pnpm store, Windows path); fails_when=a file of the project named like the renderer, the App Router runtime or a lookalike package path is taken for a renderer frame; no_claim=a renderer that Next moves to another path (the pattern text check would then find no renderer frame)
test('only the pages.runtime.dev.js of the next package is a renderer script', () => {
  // Arrange, Act, Assert
  assert.equal(
    isNextPagesRendererUrl(
      'file:///workspace/app/node_modules/.pnpm/next@16.1.4/node_modules/next/dist/compiled/next-server/pages.runtime.dev.js',
    ),
    true,
  )
  assert.equal(
    isNextPagesRendererUrl(
      'C:\\workspace\\app\\node_modules\\next\\dist\\compiled\\next-server\\pages.runtime.dev.js',
    ),
    true,
  )
  assert.equal(
    isNextPagesRendererUrl(
      'file:///workspace/app/node_modules/next/dist/compiled/next-server/app-page.runtime.dev.js',
    ),
    false,
  )
  assert.equal(
    isNextPagesRendererUrl('file:///workspace/app/pages.runtime.dev.js'),
    false,
  )
  assert.equal(
    isNextPagesRendererUrl(
      'file:///workspace/xnext/dist/compiled/next-server/pages.runtime.dev.js',
    ),
    false,
  )
  assert.equal(isNextPagesRendererUrl(''), false)
})

// Value: protects=page module to compiled page: a module of the pages folder (also under src/, any source extension, with or without the webpack-internal scheme) names the compiled page the manifest lists; fails_when=a library of the project, a module of node_modules or another layer is read as a page, or src/pages keeps its prefix; no_claim=a custom pageExtensions (the extensions are Next's defaults)
test('a Pages server module address names its compiled page and nothing else does', () => {
  // Arrange, Act, Assert
  assert.equal(
    pagesCompiledPathOfModuleUrl('(pages-dir-node)/./pages/index.js'),
    'pages/index.js',
  )
  assert.equal(
    pagesCompiledPathOfModuleUrl(
      'webpack-internal:///(pages-dir-node)/./src/pages/products/[id].tsx',
    ),
    'pages/products/[id].js',
  )
  assert.equal(
    pagesCompiledPathOfModuleUrl('(pages-dir-node)/./lib/stats.js'),
    undefined,
  )
  assert.equal(
    pagesCompiledPathOfModuleUrl(
      'webpack-internal:///(pages-dir-node)/./node_modules/next/dist/pages/x.js',
    ),
    undefined,
  )
  assert.equal(
    pagesCompiledPathOfModuleUrl('webpack-internal:///(rsc)/./pages/index.js'),
    undefined,
  )
  assert.equal(
    pagesCompiledPathOfModuleUrl('(pages-dir-node)/./pages/styles.css'),
    undefined,
  )
  assert.equal(pagesCompiledPathOfModuleUrl(''), undefined)
})

// Value: protects=Next's own page naming for a folder's index file and for a page named `index`: `pages/products/index.tsx` is the page `/products` and compiles to `pages/products.js`, the root `pages/index.tsx` stays `pages/index.js`, the page `/index` (`pages/index/index.tsx`) is `pages/index/index.js`, a static page under `index/` gets one more `index/` (`pages/index/index/foo.js`), a dynamic one does not; fails_when=a folder's index page keeps its `/index` tail so the manifest never lists it, or `pages/index/index.tsx` is read as the root page; no_claim=a custom pageExtensions, Next versions other than 16.1.4 and 16.4.4 (`next dev --webpack` of 16.1.4 measured `pages/products/index.js` listed as `"/products": "pages/products.js"`; the `index` names are read from `removePagePathTail`, `normalizePagePath` and the pages-manifest plugin in the 16.1.4 and 16.4.4 source)
test('a folder index page and a page named index compile to the path Next lists in pages-manifest.json', () => {
  // Arrange
  const moduleUrlOf = (path: string): string =>
    `webpack-internal:///(pages-dir-node)/./${path}`

  // Act, Assert
  assert.equal(
    pagesCompiledPathOfModuleUrl(moduleUrlOf('pages/products/index.tsx')),
    'pages/products.js',
  )
  assert.equal(
    pagesCompiledPathOfModuleUrl(moduleUrlOf('src/pages/blog/2024/index.js')),
    'pages/blog/2024.js',
  )
  assert.equal(
    pagesCompiledPathOfModuleUrl(moduleUrlOf('pages/index.tsx')),
    'pages/index.js',
  )
  assert.equal(
    pagesCompiledPathOfModuleUrl(moduleUrlOf('pages/index/index.tsx')),
    'pages/index/index.js',
  )
  assert.equal(
    pagesCompiledPathOfModuleUrl(moduleUrlOf('pages/index/foo.tsx')),
    'pages/index/index/foo.js',
  )
  assert.equal(
    pagesCompiledPathOfModuleUrl(moduleUrlOf('pages/index/[id].tsx')),
    'pages/index/[id].js',
  )
  assert.equal(
    pagesCompiledPathOfModuleUrl(moduleUrlOf('pages/products/index/index.ts')),
    'pages/products/index.js',
  )
})

// Value: protects=the page of a hit inside a folder index page's data function: the page-module frame `pages/products/index.tsx` is found in `pages-manifest.json` under `/products`, and the browser's one outstanding page request for `/products` backs it, so the hit reads as that page (not the entry page's) and the Pages verdict resumes it; fails_when=the compiled path keeps `/index`, the manifest has no such value, and the hit reads as unreadable instead of the page it renders; no_claim=the verdict built on it (the verdict tests)
test('a page-module frame of a folder index page reads as that page through the manifest', async () => {
  // Arrange
  const { reader } = scriptedPagesReader({
    manifest: { '/': 'pages/index.js', '/products': 'pages/products.js' },
    requests: [
      { url: 'http://localhost:3000/products', resourceType: 'Document' },
    ],
  })

  // Act
  const page = await readPagesRenderedPage(
    {
      pathnameCallFrameId: undefined,
      insideFrameUrls: [
        'webpack-internal:///(pages-dir-node)/./pages/products/index.tsx',
      ],
      entryRoute: '/',
    },
    reader,
    manualVerdictBudget().budget,
  )

  // Assert
  assert.deepEqual(page, {
    state: 'read',
    route: '/products',
    evidence: 'frame',
  })
})

// Value: protects=the browser's request never reads a page by itself: with no pathname frame and no page-module frame, the one outstanding page request for the entry route makes the page `named-by-request`, which is a hint the verdict labels unconfirmed, and never `read` with request evidence; fails_when=the request alone reads the entry page (state read), so a hit of another page that the entry page's server code fetched is published as the entry page's confirmed values; no_claim=how the verdict words the hint (the verdict tests)
test("the browser's one outstanding request for the entry route alone names the page only as named-by-request", async () => {
  // Arrange
  const { reader } = scriptedPagesReader({
    manifest: { '/': 'pages/index.js', '/other': 'pages/other.js' },
    requests: [{ url: 'http://localhost:3000/', resourceType: 'Document' }],
  })

  // Act
  const page = await readPagesRenderedPage(
    {
      pathnameCallFrameId: undefined,
      insideFrameUrls: ['webpack-internal:///(pages-dir-node)/./lib/shared.js'],
      entryRoute: '/',
    },
    reader,
    manualVerdictBudget().budget,
  )

  // Assert
  assert.deepEqual(page, { state: 'named-by-request' })
})

// Value: protects=page requests only: the document and Next's data request name the page path, `index.json` is the root, and an image, script or API call names none; fails_when=an asset request counts as the outstanding page request, or a data request keeps its prefix and suffix; no_claim=i18n locale prefixes in data requests
test('only a document or a Next data request names a page path', () => {
  // Arrange, Act, Assert
  assert.equal(
    pagesRequestPathOf({
      url: 'http://localhost:3000/products/1?x=1',
      resourceType: 'Document',
    }),
    '/products/1',
  )
  assert.equal(
    pagesRequestPathOf({
      url: 'http://localhost:3000/_next/data/b1/index.json?page=2',
      resourceType: 'Fetch',
    }),
    '/',
  )
  assert.equal(
    pagesRequestPathOf({
      url: 'http://localhost:3000/_next/data/b1/blog/post.json',
      resourceType: 'Fetch',
    }),
    '/blog/post',
  )
  assert.equal(
    pagesRequestPathOf({
      url: 'http://localhost:3000/logo.png',
      resourceType: 'Image',
    }),
    undefined,
  )
  assert.equal(
    pagesRequestPathOf({
      url: 'http://localhost:3000/api/posts',
      resourceType: 'Fetch',
    }),
    undefined,
  )
  assert.equal(
    pagesRequestPathOf({ url: 'http://[', resourceType: 'Document' }),
    undefined,
  )
})

// Value: protects=Next's data request naming for pages called `index`: Next adds one `index` segment to the data path of the root, of a page named `index` and of everything below it, so the page path is read back by removing that one segment; fails_when=the data request of `/index` or `/index/foo` names `/index/index` or `/index/index/foo`, so the page read from the request never matches the entry; no_claim=i18n locale prefixes in data requests
test('a data request of a page called index names that page and not the doubled path', () => {
  // Arrange
  const dataRequest = (dataPath: string) => ({
    url: `http://localhost:3000/_next/data/b1/${dataPath}`,
    resourceType: 'Fetch' as const,
  })

  // Act
  const root = pagesRequestPathOf(dataRequest('index.json'))
  const indexPage = pagesRequestPathOf(dataRequest('index/index.json'))
  const belowIndexPage = pagesRequestPathOf(
    dataRequest('index/index/foo.json?x=1'),
  )
  const ordinaryPage = pagesRequestPathOf(dataRequest('products/1.json'))

  // Assert
  assert.equal(root, '/')
  assert.equal(indexPage, '/index')
  assert.equal(belowIndexPage, '/index/foo')
  assert.equal(ordinaryPage, '/products/1')
})

// Value: protects=value-free shape summary: a summary names fields, types and list lengths and no value, cuts depth, and hides a property name that is not identifier-like; fails_when=a string value, a number or a data-carrying key reaches the Output line of a verdict error; no_claim=the wording of the Output line (the run's)
test('a shape summary holds no value', () => {
  // Arrange
  const event = {
    callFrames: 'SECRET-TEXT',
    reason: 7,
    nested: { deeper: { deepest: { tooDeep: 'SECRET-DEEP' } } },
    list: [{ token: 'SECRET-ITEM' }, 1],
    'user=alice@example.test': true,
  }

  // Act
  const summary = valueShapeSummaryOf(event)

  // Assert
  assert.equal(
    summary,
    '{callFrames:string,reason:number,nested:{deeper:{deepest:object}},list:array(2)[{token:string}],?:boolean}',
  )
  assert.equal(valueShapeSummaryOf(null), 'null')
  assert.equal(valueShapeSummaryOf('SECRET'), 'string')
  assert.equal(valueShapeSummaryOf([]), 'array(0)')
})

// Value: protects=the depth cut inside a list: the first element of a list counts one level deeper, so an object nested in a list element is named only as `object` and a list's later elements add only its length; fails_when=a list element's own objects are spelled out past the depth limit, so a deep payload grows the Output line, or the summary stops matching what valueShapeSummaryOf's documented example shows; no_claim=the 300-character cut (the length limit)
test('a shape summary names an object inside a list element only as object', () => {
  // Arrange
  const event = { callFrames: [{ location: {} }, {}] }

  // Act
  const summary = valueShapeSummaryOf(event)

  // Assert
  assert.equal(summary, '{callFrames:array(2)[{location:object}]}')
})

// Value: protects=event parsing: only the fields the verdict reads are kept (a scope chain is dropped), a missing column reads 0, and a frame without its script id or a callFrames that is no list is refused; fails_when=a protocol-required-but-unused field makes a good event a verdict error, or a broken event is accepted and fails inside the verdict; no_claim=every field of the protocol (only the ones read)
test('an event keeps the fields the verdict reads and refuses a broken stack', () => {
  // Arrange
  const withScope = {
    callFrames: [
      {
        callFrameId: '1',
        functionName: 'getServerSideProps',
        location: { scriptId: '7', lineNumber: 21 },
        url: '',
        scopeChain: [{ type: 'local' }],
      },
    ],
    reason: 'other',
  }

  // Act, Assert
  assert.deepEqual(parsePagesPausedEvent(withScope), {
    callFrames: [
      {
        callFrameId: '1',
        functionName: 'getServerSideProps',
        location: { scriptId: '7', lineNumber: 21, columnNumber: 0 },
        url: '',
      },
    ],
  })
  assert.equal(parsePagesPausedEvent({ callFrames: 'x' }), undefined)
  assert.equal(
    parsePagesPausedEvent({ callFrames: [{ location: { lineNumber: 1 } }] }),
    undefined,
  )
  assert.equal(parsePagesPausedEvent(null), undefined)
})

// Value: protects=a script position is a non-negative integer: a negative or fractional line or column in a synchronous frame's location or in an async frame is a broken event (undefined), while column 0 and a missing column still parse; fails_when=a negative column is accepted (the verdict would slice the renderer's line from its end), a fraction is accepted, or a valid position is refused; why_new=Cycle 0073 adversarial review (line and column were any number); seam=none; no_claim=what the verdict does with the refusal (the verdict tests pin verdict-error)
test('an event refuses a negative or fractional line or column in any frame and keeps a column of 0', () => {
  // Arrange
  const syncFrame = (lineNumber: number, columnNumber: number) => ({
    callFrames: [
      {
        functionName: 'f',
        location: { scriptId: '7', lineNumber, columnNumber },
        url: '',
      },
    ],
  })
  const asyncFrame = (lineNumber: number, columnNumber: number) => ({
    callFrames: [],
    asyncStackTrace: {
      callFrames: [
        { functionName: 'g', scriptId: '7', lineNumber, columnNumber },
      ],
    },
  })

  // Act
  const accepted = parsePagesPausedEvent(syncFrame(0, 0))
  const negativeColumn = parsePagesPausedEvent(syncFrame(3, -19))
  const negativeLine = parsePagesPausedEvent(syncFrame(-1, 4))
  const fractionalColumn = parsePagesPausedEvent(syncFrame(3, 1.5))
  const asyncNegativeColumn = parsePagesPausedEvent(asyncFrame(3, -1))
  const asyncFractionalLine = parsePagesPausedEvent(asyncFrame(0.5, 4))

  // Assert
  assert.deepEqual(accepted?.callFrames[0]?.location, {
    scriptId: '7',
    lineNumber: 0,
    columnNumber: 0,
  })
  assert.equal(negativeColumn, undefined)
  assert.equal(negativeLine, undefined)
  assert.equal(fractionalColumn, undefined)
  assert.equal(asyncNegativeColumn, undefined)
  assert.equal(asyncFractionalLine, undefined)
})

// Value: protects=budgeted reads: a read that answers is returned, a read that rejects or throws is `failed`, and a spent budget wins even over a read that answers at once; fails_when=a rejection escapes into the verdict, or a spent budget lets a ready read through so a hit exceeds its one budget; no_claim=wall-clock timing (the budget is a promise the test settles)
test('a budgeted read reports its answer, a failure or the spent budget', async () => {
  // Arrange
  const open = manualVerdictBudget()
  const spent = manualVerdictBudget()
  spent.expire()

  // Act
  const answered = await readWithinVerdictBudget(
    async () => 'text',
    open.budget,
  )
  const rejected = await readWithinVerdictBudget(
    () => Promise.reject(new Error('gone')),
    open.budget,
  )
  const threw = await readWithinVerdictBudget(() => {
    throw new Error('sync')
  }, open.budget)
  const late = await readWithinVerdictBudget(async () => 'ready', spent.budget)
  const lateAndImmediate = await readWithinVerdictBudget(
    () => 'ready',
    spent.budget,
  )

  // Assert
  assert.deepEqual(answered, { status: 'read', value: 'text' })
  assert.deepEqual(rejected, { status: 'failed' })
  assert.deepEqual(threw, { status: 'failed' })
  assert.deepEqual(late, { status: 'timeout' })
  assert.deepEqual(lateAndImmediate, { status: 'timeout' })
})

// Value: protects=the hit's single budget: it ends after the given milliseconds and at once when the run stops, and disposing it clears the timer; fails_when=the budget outlives its time, ignores the run's stop, or leaves a timer behind; no_claim=real clocks (the timer is mocked)
test('a verdict budget ends on time or when the run stops and clears its timer', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const timeBudget = createVerdictBudget(1_000)
  const stopController = new AbortController()
  const stopBudget = createVerdictBudget(60_000, stopController.signal)
  const disposed = createVerdictBudget(1_000)
  let didTimeBudgetEnd = false
  let didStopBudgetEnd = false
  let didDisposedEnd = false
  void timeBudget.expired.then(() => (didTimeBudgetEnd = true))
  void stopBudget.expired.then(() => (didStopBudgetEnd = true))
  void disposed.expired.then(() => (didDisposedEnd = true))
  const flush = () => new Promise((resolve) => setImmediate(resolve))

  // Act
  disposed.dispose()
  context.mock.timers.tick(999)
  await flush()
  const endedBeforeTime = didTimeBudgetEnd
  context.mock.timers.tick(1)
  await flush()
  stopController.abort()
  await flush()

  // Assert
  assert.equal(endedBeforeTime, false)
  assert.equal(didTimeBudgetEnd, true)
  assert.equal(didStopBudgetEnd, true)
  assert.equal(didDisposedEnd, false)
  timeBudget.dispose()
  stopBudget.dispose()
})

// Value: protects=lazy chain reads: a consumer that has what it needs from the inline levels spends no `Debugger.getStackTrace` read on the continuation behind them; fails_when=the chain reader fetches continuations ahead of the consumer, spending the hit's budget and reads on levels nobody needs; no_claim=the verdict's use of the reader (the verdict tests)
test('the async chain is read lazily and a continuation is fetched only when asked for', async () => {
  // Arrange
  const { reader, calls } = scriptedPagesReader({
    stackTraces: {
      next: { callFrames: [] },
    },
  })
  const start = {
    asyncStackTrace: {
      callFrames: [],
      parentId: { id: 'next', debuggerId: 'd1' },
    },
  }
  const steps: PagesChainStep[] = []

  // Act
  const chain = readPagesAsyncChain(start, reader, manualVerdictBudget().budget)
  const first = await chain.next()
  const readsAfterFirstLevel = calls.stackTraceIds.length
  for (const step of [first, await chain.next(), await chain.next()])
    if (!step.done) steps.push(step.value)

  // Assert
  assert.equal(readsAfterFirstLevel, 0)
  assert.deepEqual(
    steps.map((step) => step.kind),
    ['level', 'level'],
  )
  assert.deepEqual(
    calls.stackTraceIds.map((id) => id.id),
    ['next'],
  )
})
