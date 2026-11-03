import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  pagesDataFunctionHitVerdictOf,
  type PagesDataFunctionHit,
} from '../utils/pagesDataFunctionHitVerdictOf'
import type { PagesAsyncCallFrame } from '../utils/parsePagesPausedEvent'

import { manualVerdictBudget } from './utils/manualVerdictBudget'
import {
  pagesPausedFixtureOf,
  type PagesPausedFixture,
} from './utils/pagesPausedFixture'
import { pagesRuntimeTextOf } from './utils/pagesRuntimeText'
import {
  scriptedPagesReader,
  type ScriptedPagesReaderOptions,
} from './utils/scriptedPagesReader'

/** The recorded runs all parsed the renderer as this script. */
const RENDERER_SCRIPT_ID = '1477'

/** The manifest of the scratch app the payloads were recorded in, plus two pages the scripted cases use. */
const PAGES_MANIFEST = {
  '/_app': 'pages/_app.js',
  '/': 'pages/index.js',
  '/static-helper': 'pages/static-helper.js',
  '/other': 'pages/other.js',
  '/wrapped': 'pages/wrapped.js',
}

/** A reader that serves the recorded fixture's script addresses, the Next 16.1.4 renderer text and the scratch app's manifest; a test overrides what it is about. @example readerFor(fixture, { pathname: { callFrameId: 'frame-11', value: '/' } }) */
function readerFor(
  fixture: PagesPausedFixture,
  options: ScriptedPagesReaderOptions = {},
) {
  return scriptedPagesReader({
    scriptUrls: fixture.scriptUrls,
    scriptSources: { [RENDERER_SCRIPT_ID]: pagesRuntimeTextOf('16.1.4') },
    manifest: PAGES_MANIFEST,
    ...options,
  })
}

/** A hit of the entry route's first render, with the browser on the entry route; each test changes what it is about. @example hitOf(event, { group: 1 }) */
function hitOf(
  event: unknown,
  change: Partial<PagesDataFunctionHit> = {},
): PagesDataFunctionHit {
  return {
    event,
    entryRoute: '/',
    browserOnEntryRoute: true,
    group: 0,
    ...change,
  }
}

/** A budget no test spends, for the verdicts that are not about time. */
const openBudget = () => manualVerdictBudget().budget

/** A frame of an async level in the renderer's script, at a location of the recorded runtime. @example rendererFrame(fixture, 20, 438) */
function rendererFrame(
  fixture: PagesPausedFixture,
  lineNumber: number,
  columnNumber: number,
): PagesAsyncCallFrame {
  return {
    functionName: '',
    scriptId: RENDERER_SCRIPT_ID,
    url: fixture.scriptUrls[RENDERER_SCRIPT_ID]!,
    lineNumber,
    columnNumber,
  }
}

/** A synchronous frame of a project module whose address a test registers in the reader. @example syncFrameIn('frame-0', '7001', 'withSession') */
function syncFrameIn(
  callFrameId: string,
  scriptId: string,
  functionName: string,
) {
  return {
    callFrameId,
    functionName,
    location: { scriptId, lineNumber: 4, columnNumber: 2 },
    url: '',
  }
}

/** An async level of the recorded renderer: the frames `render`, `get` and `handleResponse`, none of which calls a data function. @example componentRenderLevel(fixture) */
function componentRenderLevel(fixture: PagesPausedFixture) {
  return {
    description: 'await',
    callFrames: [
      rendererFrame(fixture, 23, 1110),
      rendererFrame(fixture, 0, 94576),
      rendererFrame(fixture, 0, 157639),
    ],
  }
}

// Value: protects=AC 1/2 entry data function in the synchronous frames, E0b payload `getServerSideProps` before its await: `pathname` is evaluated on the synchronous `renderToHTMLImpl` frame (frame-11, never on the call arrow), with the side-effect-free flags, and the runtime text is read once; the hit pauses with the data function and `frame` evidence; fails_when=the evaluation runs on the call arrow (a ReferenceError in the real runtime), runs without throwOnSideEffect, or the text is read per frame; no_claim=a real Next server and a real proxy (the reader is scripted from the recorded payload and the 16.1.4 runtime fragments)
test('a hit in getServerSideProps before an await pauses after reading pathname on the renderToHTMLImpl frame', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-before-await')
  const { reader, calls } = readerFor(fixture, {
    pathname: { callFrameId: 'frame-11', value: '/' },
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getServerSideProps',
    evidence: 'frame',
  })
  assert.deepEqual(calls.evaluateOnCallFrame, [
    {
      callFrameId: 'frame-11',
      expression: 'pathname',
      silent: true,
      throwOnSideEffect: true,
      returnByValue: true,
    },
  ])
  assert.deepEqual(calls.scriptSourceIds, [RENDERER_SCRIPT_ID])
})

// Value: protects=AC 1 after-await variant, E0b payload: after an await the call arrow is only in the async chain (level 0) and no sync renderer frame exists, so nothing is evaluated and the page comes from the page-module frame through the manifest; fails_when=the verdict needs the call frame among the synchronous frames, evaluates on a frame that does not exist, or ignores the page-module frame; no_claim=the real forwarding (payload recorded through js-debug's proxy, replayed here)
test('a hit in getServerSideProps after an await is found in the async chain and its page read from the page module', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  const { reader, calls } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getServerSideProps',
    evidence: 'frame',
  })
  assert.deepEqual(calls.evaluateOnCallFrame, [])
  assert.equal(calls.manifestReads, 1)
})

// Value: protects=AC 2 helper after an await in getStaticProps, E0b payload with a project helper (lib/stats.js) on top of getStaticProps (static-helper page): the hit is inside the data function and names getStaticProps; fails_when=a helper outside the pages folder hides the page frame beneath it, or getStaticProps is reported as getServerSideProps; no_claim=none beyond protects
test('a hit in a helper called by getStaticProps pauses and names getStaticProps', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-static-props-helper-after-await')
  const { reader } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent, { entryRoute: '/static-helper' }),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getStaticProps',
    evidence: 'frame',
  })
})

// Value: protects=AC 3 attribution after an operation, E0b payload `getStaticProps` after an await: a stop of operation group 1 pauses labelled after-operation; fails_when=group k >= 1 is published as entry-load; no_claim=the operation itself (the run harness drives it)
test('a hit of a stop in operation group 1 pauses as after-operation', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-static-props-after-await')
  const { reader } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent, { entryRoute: '/static-helper', group: 1 }),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'after-operation',
    dataFunction: 'getStaticProps',
    evidence: 'frame',
  })
})

// Value: protects=AC 2 wrapper: a wrapper's own code that runs before the handler (a module outside the pages folder, `export const getServerSideProps = withSession(handler)`) is inside the data function; the page is read from `pathname`; fails_when=only the page module's own frames count as the data function, so the wrapper's line is resumed as outside; no_claim=a real wrapper module (the frame is scripted onto the recorded before-await stack)
test('a hit in the wrapper code of a wrapped getServerSideProps pauses', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-before-await')
  fixture.event.callFrames[0] = syncFrameIn('frame-0', '7001', 'withSession')
  fixture.scriptUrls['7001'] =
    'webpack-internal:///(pages-dir-node)/./lib/withSession.js'
  const { reader } = readerFor(fixture, {
    pathname: { callFrameId: 'frame-11', value: '/wrapped' },
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event, { entryRoute: '/wrapped' }),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getServerSideProps',
    evidence: 'frame',
  })
})

// Value: protects=the page of a data function that calls another page's module: the page-module frame nearest the data-function call frame names the page, so the index page's getServerSideProps that delegates to a function of `pages/other.js` is the index page's hit; fails_when=the deepest page-module frame decides and the entry page's own hit is resumed as other-route; no_claim=a real cross-page import (the frame is scripted onto the recorded after-await stack)
test('the page module nearest the call frame names the page when its data function calls another page module', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  fixture.event.callFrames.unshift(
    syncFrameIn('frame-9', '7004', 'getServerSideProps'),
  )
  fixture.scriptUrls['7004'] = '(pages-dir-node)/./pages/other.js'
  const { reader } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getServerSideProps',
    evidence: 'frame',
  })
})

// Value: protects=AC 2 re-export + request evidence: an entry page that re-exports its getServerSideProps has no page-module frame, so after an await the page comes from the browser's one outstanding page request (a Next data request here, assets ignored) and the manifest is not read; fails_when=the verdict gives up without the request source, counts the script and image requests as page requests, or reads the manifest with no page-module frame; no_claim=the browser participant's real request tracking (requests are scripted)
test('a hit in a re-exported getServerSideProps after an await takes its page from the one outstanding data request', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  fixture.event.callFrames[0] = syncFrameIn(
    'frame-0',
    '7002',
    'getServerSideProps',
  )
  fixture.scriptUrls['7002'] =
    'webpack-internal:///(pages-dir-node)/./lib/ssr.js'
  const { reader, calls } = readerFor(fixture, {
    requests: [
      {
        url: 'http://localhost:3000/_next/data/b1/index.json?page=2',
        resourceType: 'Fetch',
      },
      {
        url: 'http://localhost:3000/_next/static/chunks/main.js',
        resourceType: 'Script',
      },
      { url: 'http://localhost:3000/logo.png', resourceType: 'Image' },
    ],
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event, { group: 1 }),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'after-operation',
    dataFunction: 'getServerSideProps',
    evidence: 'request',
  })
  assert.equal(calls.manifestReads, 0)
})

// Value: protects=AC 16 page by request evidence for a dynamic route: the one outstanding document request `/products/1` is the entry route `/products/[id]`; fails_when=the request path is compared as text with the route pattern, so a dynamic entry route never matches; no_claim=the router's precedence for competing patterns (isBrowserOnEntryRoute's own tests)
test('the one outstanding document request of a dynamic route names the entry page', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  fixture.event.callFrames[0] = syncFrameIn(
    'frame-0',
    '7002',
    'getServerSideProps',
  )
  fixture.scriptUrls['7002'] =
    'webpack-internal:///(pages-dir-node)/./lib/ssr.js'
  const { reader } = readerFor(fixture, {
    requests: [
      { url: 'http://localhost:3000/products/1', resourceType: 'Document' },
    ],
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event, { entryRoute: '/products/[id]' }),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getServerSideProps',
    evidence: 'request',
  })
})

// Value: protects=AC 16 requests for two routes: with outstanding page requests for more than one route the page is unreadable, so the hit pauses unconfirmed while the browser shows the entry route and is not proof; fails_when=one of two requests is taken for the hit's page, or the request source reports proof; no_claim=none beyond protects
test('outstanding page requests for two routes leave the page unreadable and the hit unconfirmed', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  fixture.event.callFrames[0] = syncFrameIn(
    'frame-0',
    '7002',
    'getServerSideProps',
  )
  fixture.scriptUrls['7002'] =
    'webpack-internal:///(pages-dir-node)/./lib/ssr.js'
  const { reader } = readerFor(fixture, {
    requests: [
      { url: 'http://localhost:3000/', resourceType: 'Document' },
      {
        url: 'http://localhost:3000/_next/data/b1/other.json',
        resourceType: 'Fetch',
      },
    ],
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'unconfirmed',
    reason: 'route-unreadable',
  })
})

// Value: protects=AC 16 request for another route: the browser's one outstanding page request is for a different route, which names no entry page, so the page stays unreadable (not other-route); fails_when=a request for another route is taken as the entry page, or is reported as a resumed other-route hit on weak evidence; no_claim=none beyond protects
test('the one outstanding request for another route does not name the entry page', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  fixture.event.callFrames[0] = syncFrameIn(
    'frame-0',
    '7002',
    'getServerSideProps',
  )
  fixture.scriptUrls['7002'] =
    'webpack-internal:///(pages-dir-node)/./lib/ssr.js'
  const { reader } = readerFor(fixture, {
    requests: [
      { url: 'http://localhost:3000/other', resourceType: 'Document' },
    ],
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'unconfirmed',
    reason: 'route-unreadable',
  })
})

// Value: protects=AC 16 unreadable page, browser elsewhere: a hit whose page cannot be read (no pathname frame, no page module, no request) is resumed as unattributed while the browser does not show the entry route; fails_when=an unreadable page pauses the learner on a request for another page; no_claim=the run's journaling of the resumed hit
test('an unreadable page is resumed as unattributed when the browser is not on the entry route', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  fixture.event.callFrames[0] = syncFrameIn(
    'frame-0',
    '7002',
    'getServerSideProps',
  )
  fixture.scriptUrls['7002'] =
    'webpack-internal:///(pages-dir-node)/./lib/ssr.js'
  const { reader } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event, { browserOnEntryRoute: false }),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'resume',
    event: 'breakpoint.unattributed-resumed',
  })
})

// Value: protects=AC 16 pathname failure falls through: when `pathname` cannot be evaluated (a ReferenceError on every frame) the page is read from the page-module frame instead; fails_when=a failed evaluation ends the page read as unreadable although the stack names the page; no_claim=none beyond protects
test('a failed pathname read falls back to the page module frame', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-before-await')
  const { reader, calls } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getServerSideProps',
    evidence: 'frame',
  })
  assert.equal(calls.evaluateOnCallFrame.length, 1)
  assert.equal(calls.manifestReads, 1)
})

// Value: protects=AC 14 another page's data function (route from pathname): a hit inside a data function that renders another page is resumed as other-route with that page's route; fails_when=another page's data-function hit pauses the learner or loses its route; no_claim=a real navigation between pages (the run harness)
test("a hit in another page's data function is resumed as other-route with that route", async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-before-await')
  const { reader } = readerFor(fixture, {
    pathname: { callFrameId: 'frame-11', value: '/other' },
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'resume',
    event: 'breakpoint.other-route',
    route: '/other',
  })
})

// Value: protects=AC 14 another page's data function (route from the page module): after an await the other page is named by the page-module frame through the manifest; fails_when=the module-frame source resumes with the wrong route or pauses; no_claim=none beyond protects
test("a hit under another page's module after an await is resumed as other-route with the manifest route", async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-static-props-helper-after-await')
  const { reader } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'resume',
    event: 'breakpoint.other-route',
    route: '/static-helper',
  })
})

// Value: protects=AC 16 outside the data function (negative case, second hit): a helper that the component's server render calls has renderer frames (the `…(AppComp,{...props})` path) and no call frame in a chain read to its end, so it is resumed as outside-data-function and nothing is evaluated; fails_when=the component render's hit pauses as the data function, or the positive evidence is not recognised; no_claim=the recorded payload of this hit (E0b observed it directly from V8, so its frames are scripted from the recorded renderer levels)
test('a helper under the page component render is resumed as outside the data function', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  fixture.event.callFrames = [
    syncFrameIn('frame-0', '7003', 'formatPrice'),
    {
      callFrameId: 'frame-1',
      functionName: 'props',
      location: {
        scriptId: RENDERER_SCRIPT_ID,
        lineNumber: 12,
        columnNumber: 6447,
      },
      url: '',
    },
  ]
  fixture.scriptUrls['7003'] =
    'webpack-internal:///(pages-dir-node)/./lib/format.js'
  fixture.event.asyncStackTrace = componentRenderLevel(fixture)
  const { reader, calls } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'resume',
    event: 'breakpoint.outside-data-function',
  })
  assert.deepEqual(calls.evaluateOnCallFrame, [])
})

// Value: protects=AC 16 negative case, first hit: the same helper reached from getServerSideProps (the call arrow in the async chain, the page frame beneath the helper) pauses once in the data function; fails_when=the shared helper is resumed as outside on its data-function hit; no_claim=the second hit (the previous test)
test('the shared helper reached from getServerSideProps pauses', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  fixture.event.callFrames.unshift(
    syncFrameIn('frame-9', '7003', 'formatPrice'),
  )
  fixture.scriptUrls['7003'] =
    'webpack-internal:///(pages-dir-node)/./lib/format.js'
  const { reader } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getServerSideProps',
    evidence: 'frame',
  })
})

// Value: protects=AC 20 traced-await form, synchronous: with the call arrow gone from the stack, the synchronous frame of the traced call (`trace(trace_constants.RenderSpan.getServerSideProps…`) alone identifies the data function and is the frame `pathname` is read on; fails_when=only the call text is recognised, so a stack without the arrow is lost; no_claim=a Next whose runtime drops the arrow (scripted by removing it from the recorded stack)
test('the traced-await frame alone identifies the data-function call', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-before-await')
  fixture.event.callFrames.splice(1, 1)
  const { reader, calls } = readerFor(fixture, {
    pathname: { callFrameId: 'frame-11', value: '/' },
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getServerSideProps',
    evidence: 'frame',
  })
  assert.equal(calls.evaluateOnCallFrame[0]?.callFrameId, 'frame-11')
})

// Value: protects=AC 20 traced-await form, async chain: with the call arrow removed from the async chain, the async frame of the traced await still identifies the call and the page comes from the page module; fails_when=an async chain without the arrow is read as outside the data function; no_claim=a Next whose chain drops the arrow (scripted by removing it from the recorded level 0)
test('the traced-await frame in the async chain identifies the call when the arrow is missing', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  const level = fixture.event.asyncStackTrace!
  level.callFrames = level.callFrames.filter(
    (frame) => !(frame.lineNumber === 20 && frame.columnNumber === 438),
  )
  const { reader } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getServerSideProps',
    evidence: 'frame',
  })
})

// Value: protects=AC 16 pause on the entry route: a hit whose page cannot be read pauses unconfirmed (reason route-unreadable) while the browser shows the entry route, and the pause is no proof; fails_when=an unreadable page pauses with the entry-load attribution, or is resumed while the learner is on the entry page; no_claim=the browser's route state (an input here)
test('an unreadable page pauses unconfirmed while the browser shows the entry route', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  fixture.event.callFrames[0] = syncFrameIn(
    'frame-0',
    '7002',
    'getServerSideProps',
  )
  fixture.scriptUrls['7002'] =
    'webpack-internal:///(pages-dir-node)/./lib/ssr.js'
  const { reader } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'unconfirmed',
    reason: 'route-unreadable',
  })
})

// Value: protects=AC 16 no async chain (E0b fallback): an event with no async chain and no data-function call among its synchronous frames pauses unconfirmed `no-async-chain`, also when a synchronous renderer frame is there; fails_when=the missing chain reads as outside the data function or as a recognition failure; no_claim=a js-debug launch with showAsyncStacks off (the event is scripted without its chain)
test('an event without an async chain and without a call among its frames is unconfirmed no-async-chain', async () => {
  // Arrange
  const withoutRendererFrame = pagesPausedFixtureOf(
    'get-server-side-props-after-await',
  )
  delete withoutRendererFrame.event.asyncStackTrace
  const withRendererFrame = pagesPausedFixtureOf(
    'get-server-side-props-after-await',
  )
  delete withRendererFrame.event.asyncStackTrace
  withRendererFrame.event.callFrames.push({
    callFrameId: 'frame-5',
    functionName: 'render',
    location: {
      scriptId: RENDERER_SCRIPT_ID,
      lineNumber: 23,
      columnNumber: 1110,
    },
    url: '',
  })

  // Act
  const first = await pagesDataFunctionHitVerdictOf(
    hitOf(withoutRendererFrame.event),
    readerFor(withoutRendererFrame).reader,
    openBudget(),
  )
  const second = await pagesDataFunctionHitVerdictOf(
    hitOf(withRendererFrame.event),
    readerFor(withRendererFrame).reader,
    openBudget(),
  )

  // Assert
  const expected = {
    action: 'pause',
    attribution: 'unconfirmed',
    reason: 'no-async-chain',
  }
  assert.deepEqual(first, expected)
  assert.deepEqual(second, expected)
})

// Value: protects=AC 16 no renderer frame: a stack read to its end that holds no frame of Next's page renderer pauses unconfirmed `no-renderer-frame` and is never resumed as outside the data function; fails_when=the absence of a renderer is read as positive evidence of outside, so a hit from an API route or a Next change is resumed silently; no_claim=an API route's real stack (scripted frames in tracer.js only)
test('a complete chain with no renderer frame is unconfirmed no-renderer-frame', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  fixture.event.callFrames = [syncFrameIn('frame-0', '7003', 'formatPrice')]
  fixture.scriptUrls['7003'] =
    'webpack-internal:///(pages-dir-node)/./lib/format.js'
  fixture.event.asyncStackTrace = {
    description: 'await',
    callFrames: [
      {
        functionName: 'eval',
        scriptId: '223',
        url: fixture.scriptUrls['223']!,
        lineNumber: 184,
        columnNumber: 35,
      },
    ],
  }
  const { reader } = readerFor(fixture)

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'unconfirmed',
    reason: 'no-renderer-frame',
  })
})

// Value: protects=AC 20 runtime without the patterns: when the renderer's text holds neither the call text nor the traced-await text (a Next change), every hit is `no-renderer-frame`, a text that cannot be read is the same, and neither is ever outside the data function; fails_when=an unrecognised renderer lets a call frame go unfound and the hit be resumed as outside; no_claim=the once-per-run journal entry with the Next version (the run's)
test('a renderer text without the known patterns, or an unreadable one, makes the hit no-renderer-frame', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  const changed = readerFor(fixture, {
    scriptSources: {
      [RENDERER_SCRIPT_ID]: 'async function renderToHTMLImpl(){}',
    },
  })
  const unreadable = readerFor(fixture, { scriptSources: {} })

  // Act
  const withChangedText = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent),
    changed.reader,
    openBudget(),
  )
  const withUnreadableText = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent),
    unreadable.reader,
    openBudget(),
  )

  // Assert
  const expected = {
    action: 'pause',
    attribution: 'unconfirmed',
    reason: 'no-renderer-frame',
  }
  assert.deepEqual(withChangedText, expected)
  assert.deepEqual(withUnreadableText, expected)
})

// Value: protects=AC 16 verdict-error: an event of an unexpected shape pauses unconfirmed `verdict-error` with a shape summary that names fields and types and none of the values, and the verdict does not throw; fails_when=a changed protocol throws into the run, or the summary copies a value the debuggee produced; no_claim=the Output line and its log id (the run writes them from this verdict)
test('an event of an unexpected shape is a verdict-error that holds no value', async () => {
  // Arrange
  const { reader } = scriptedPagesReader()
  const shapes = [
    { callFrames: 'SECRET-TEXT', reason: 'other' },
    { callFrames: [{ location: { scriptId: 7 } }], token: 'SECRET-TOKEN' },
    null,
    42,
    undefined,
  ]

  // Act
  const verdicts = await Promise.all(
    shapes.map((event) =>
      pagesDataFunctionHitVerdictOf(hitOf(event), reader, openBudget()),
    ),
  )

  // Assert
  assert.deepEqual(verdicts, [
    {
      action: 'pause',
      attribution: 'unconfirmed',
      reason: 'verdict-error',
      shape: '{callFrames:string,reason:string}',
    },
    {
      action: 'pause',
      attribution: 'unconfirmed',
      reason: 'verdict-error',
      shape: '{callFrames:array(1)[{location:object}],token:string}',
    },
    {
      action: 'pause',
      attribution: 'unconfirmed',
      reason: 'verdict-error',
      shape: 'null',
    },
    {
      action: 'pause',
      attribution: 'unconfirmed',
      reason: 'verdict-error',
      shape: 'number',
    },
    {
      action: 'pause',
      attribution: 'unconfirmed',
      reason: 'verdict-error',
      shape: 'undefined',
    },
  ])
  assert.doesNotMatch(JSON.stringify(verdicts), /SECRET/)
})

// Value: protects=AC 16 never throws: a reader that throws where the verdict does not expect it (the script address lookup) becomes a verdict-error, not a rejection into the run; fails_when=an unexpected exception escapes the verdict and fails the run; no_claim=every possible bug (only this seam)
test('an unexpected failure inside the verdict becomes a verdict-error', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  const { reader } = readerFor(fixture)
  const throwingReader = {
    ...reader,
    scriptUrlOf: (): string => {
      throw new Error('lookup broke')
    },
  }

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent),
    throwingReader,
    openBudget(),
  )

  // Assert
  assert.equal(verdict.action, 'pause')
  assert.equal(verdict.attribution, 'unconfirmed')
  assert.equal('reason' in verdict && verdict.reason, 'verdict-error')
})

/** A hit whose synchronous frames and first async level are renderer frames of the component render, with the chain continuing in `parentId`; the call arrow is nowhere in what is inline. @example chainContinuingIn(fixture, { id: 'c1', debuggerId: 'dbg-1' }) */
function chainContinuingIn(
  fixture: PagesPausedFixture,
  parentId: { id: string; debuggerId?: string },
) {
  fixture.event.callFrames = [
    {
      callFrameId: 'frame-0',
      functionName: 'props',
      location: {
        scriptId: RENDERER_SCRIPT_ID,
        lineNumber: 12,
        columnNumber: 6447,
      },
      url: '',
    },
  ]
  fixture.event.asyncStackTrace = { ...componentRenderLevel(fixture), parentId }
  return fixture.event
}

// Value: protects=AC 16 parentId continuation followed: a chain that continues in a stack trace id is read with one `Debugger.getStackTrace`, and a call arrow found in the continuation makes the hit a data-function hit; fails_when=the continuation is not followed, so a data-function hit behind it is lost or called outside; no_claim=a real continuation (none was observed in E0b; the id and its stack are scripted)
test('a parentId continuation is followed and the call found in it makes the hit a data-function hit', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  const parentId = { id: 'cont-1', debuggerId: 'dbg-1' }
  fixture.event.callFrames = fixture.event.callFrames.slice(0, 1)
  fixture.event.asyncStackTrace = {
    description: 'await',
    callFrames: [rendererFrame(fixture, 0, 157639)],
    parentId,
  }
  const { reader, calls } = readerFor(fixture, {
    ownDebuggerId: 'dbg-1',
    stackTraces: {
      'cont-1': {
        callFrames: [
          rendererFrame(fixture, 20, 438),
          rendererFrame(fixture, 20, 298),
        ],
      },
    },
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getServerSideProps',
    evidence: 'frame',
  })
  assert.deepEqual(calls.stackTraceIds, [parentId])
})

// Value: protects=AC 16 asyncStackTraceId-only start: an event that carries only `asyncStackTraceId` starts its chain with a `Debugger.getStackTrace` read of it; fails_when=an id-only event reads as having no async chain, or the id is never fetched; no_claim=a real id (scripted)
test('a chain that starts only in asyncStackTraceId is fetched from the id', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  const startId = { id: 'start-1', debuggerId: 'dbg-1' }
  delete fixture.event.asyncStackTrace
  fixture.event.asyncStackTraceId = startId
  const { reader, calls } = readerFor(fixture, {
    ownDebuggerId: 'dbg-1',
    stackTraces: {
      'start-1': { callFrames: [rendererFrame(fixture, 20, 438)] },
    },
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'entry-load',
    dataFunction: 'getServerSideProps',
    evidence: 'frame',
  })
  assert.deepEqual(calls.stackTraceIds, [startId])
})

// Value: protects=AC 16 unresolvable continuation: a stack trace id that names another debugger is fetched like any other (the run does not know its own debugger id) and, when the debugger cannot resolve it, the chain is incomplete with cause fetch-failed; there is no other-debugger cause; fails_when=a foreign id is skipped without a read or reported as another cause, or the hit is resumed as outside; no_claim=V8's real error text for a foreign id (the read is scripted to reject)
test('a continuation of another debugger is read like any other and ends the chain as chain-incomplete fetch-failed', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  const event = chainContinuingIn(fixture, {
    id: 'foreign-1',
    debuggerId: 'dbg-2',
  })
  const { reader, calls } = readerFor(fixture, { ownDebuggerId: 'dbg-1' })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'unconfirmed',
    reason: 'chain-incomplete',
    cause: 'fetch-failed',
  })
  assert.deepEqual(calls.stackTraceIds, [
    { id: 'foreign-1', debuggerId: 'dbg-2' },
  ])
})

// Value: protects=AC 16 failed fetch, incomplete chain never outside: a chain cut by a continuation that cannot be fetched, with renderer frames in what was read and no call among them, is chain-incomplete `fetch-failed` and is never resumed as outside the data function; fails_when=the cut chain is called outside (a data-function hit behind the cut would then be resumed for good); no_claim=V8's real error text (the read is scripted to reject)
test('a chain cut by an unreadable continuation is chain-incomplete and never outside the data function', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  const event = chainContinuingIn(fixture, {
    id: 'gone-1',
    debuggerId: 'dbg-1',
  })
  const { reader, calls } = readerFor(fixture, {
    ownDebuggerId: 'dbg-1',
    stackTraces: { 'gone-1': new Error('Invalid stack trace id') },
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'unconfirmed',
    reason: 'chain-incomplete',
    cause: 'fetch-failed',
  })
  assert.equal(calls.stackTraceIds.length, 1)
})

// Value: protects=AC 16 continuation limit: at most four `Debugger.getStackTrace` reads are spent on one hit, and the fifth continuation is chain-incomplete `continuation-limit`; fails_when=the limit is not kept (a hostile or looping chain spends unbounded reads) or reads past it are attempted; no_claim=a real chain this long (scripted: every fetched level points to another id)
test('the fifth continuation of a hit is chain-incomplete continuation-limit after four reads', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  const event = chainContinuingIn(fixture, { id: 'c1', debuggerId: 'dbg-1' })
  const { reader, calls } = readerFor(fixture, {
    ownDebuggerId: 'dbg-1',
    stackTraces: {
      c1: { callFrames: [], parentId: { id: 'c2', debuggerId: 'dbg-1' } },
      c2: { callFrames: [], parentId: { id: 'c3', debuggerId: 'dbg-1' } },
      c3: { callFrames: [], parentId: { id: 'c4', debuggerId: 'dbg-1' } },
      c4: { callFrames: [], parentId: { id: 'c5', debuggerId: 'dbg-1' } },
    },
  })

  // Act
  const verdict = await pagesDataFunctionHitVerdictOf(
    hitOf(event),
    reader,
    openBudget(),
  )

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'unconfirmed',
    reason: 'chain-incomplete',
    cause: 'continuation-limit',
  })
  assert.deepEqual(
    calls.stackTraceIds.map((id) => id.id),
    ['c1', 'c2', 'c3', 'c4'],
  )
})

// Value: protects=AC 16 timeout: a continuation read that does not answer before the hit's budget ends is chain-incomplete `timeout`, not outside the data function and not a hang; fails_when=the verdict waits for a read that never answers, or a read past the budget decides the hit; no_claim=wall-clock time (the budget is settled by hand)
test('a continuation read still open when the budget ends is chain-incomplete timeout', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-after-await')
  const event = chainContinuingIn(fixture, {
    id: 'slow-1',
    debuggerId: 'dbg-1',
  })
  const { reader } = readerFor(fixture, {
    ownDebuggerId: 'dbg-1',
    getStackTrace: () => new Promise(() => {}),
  })
  const { budget, expire } = manualVerdictBudget()

  // Act
  const pending = pagesDataFunctionHitVerdictOf(hitOf(event), reader, budget)
  await new Promise((resolve) => setImmediate(resolve))
  expire()
  const verdict = await pending

  // Assert
  assert.deepEqual(verdict, {
    action: 'pause',
    attribution: 'unconfirmed',
    reason: 'chain-incomplete',
    cause: 'timeout',
  })
})

// Value: protects=AC 16 one budget for every read: a budget that is already spent ends the verdict as chain-incomplete `timeout` even though every read would answer at once, and a budget spent during the page read does the same although the call frame was found; fails_when=each read gets a fresh wait, or a ready read slips past a spent budget; no_claim=wall-clock time (the budget is settled by hand)
test('a spent budget ends the verdict as chain-incomplete timeout even when reads answer at once or the call is found', async () => {
  // Arrange
  const fixture = pagesPausedFixtureOf('get-server-side-props-before-await')
  const spent = manualVerdictBudget()
  spent.expire()
  const heldPageRead = manualVerdictBudget()
  const { reader: holdingReader } = readerFor(fixture, {})
  const pathnameNeverAnswers = {
    ...holdingReader,
    evaluateOnCallFrame: () => new Promise<never>(() => {}),
  }

  // Act
  const withSpentBudget = await pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent),
    readerFor(fixture).reader,
    spent.budget,
  )
  const pending = pagesDataFunctionHitVerdictOf(
    hitOf(fixture.rawEvent),
    pathnameNeverAnswers,
    heldPageRead.budget,
  )
  await new Promise((resolve) => setImmediate(resolve))
  heldPageRead.expire()
  const duringPageRead = await pending

  // Assert
  const expected = {
    action: 'pause',
    attribution: 'unconfirmed',
    reason: 'chain-incomplete',
    cause: 'timeout',
  }
  assert.deepEqual(withSpentBudget, expected)
  assert.deepEqual(duringPageRead, expected)
})
