import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ACTIVE_TIMEOUT_MS, PAGES_STOP_RESUMED_HIT_LIMIT } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import type { ConfiguredRuntimeSnapshot, RuntimeControl } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { captureStudy } from '../utils/captureStudy'
import { describeServerRenderFailureDetails } from '../utils/describeServerRenderFailureDetails'
import type { PagesPausedEvent } from '../utils/parsePagesPausedEvent'

import { armedEntry } from './utils/entryRenderHarness'
import {
  hitOnLine,
  PAGES_SERVER_PAGE_SOURCE,
  PAGES_SERVER_RETURN_LINE,
  pagesControl,
  pagesServerRun,
  pagesServerService,
} from './utils/pagesServerRunHarness'
import type { PagesHitScript } from './utils/serverRenderParticipant'

/** How often a test looks for the run's answer to a scripted hit. */
const HIT_POLL_MS = 2

/** The harness of a Pages server run. */
type PagesHarness = Awaited<ReturnType<typeof pagesServerRun>>

/** The script id of Next's Pages renderer in the recorded E0b payloads. */
const RENDERER_SCRIPT_ID = '1477'

/** The entry page with a `getStaticProps` at the place `getServerSideProps` has in {@link PAGES_SERVER_PAGE_SOURCE}. */
const PAGES_STATIC_PAGE_SOURCE = PAGES_SERVER_PAGE_SOURCE.replace(
  'export async function getServerSideProps({ query })',
  'export async function getStaticProps()',
)

/** The entry page whose `getServerSideProps` reads `query.page` (the link `/?page=2` re-runs it). */
const PAGES_QUERY_PAGE_SOURCE = [
  'export default function Home({ page }) {',
  '  return page',
  '}',
  'export async function getServerSideProps({ query }) {',
  "  const page = query.page ?? '1'",
  '  return { props: { page } }',
  '}',
  '',
].join('\n')

/** The entry page whose `getServerSideProps` is a wrapper's handler: the wrapper's own code runs before the handler (lines 8-13). */
const PAGES_WRAPPED_PAGE_SOURCE = [
  'export default function Home({ count }) {',
  '  return count',
  '}',
  'const handler = async () => {',
  '  return { props: { count: 3 } }',
  '}',
  'export const getServerSideProps = withSession(handler)',
  'function withSession(next) {',
  '  return async (context) => {',
  "    const session = 'abc'",
  '    return next(context)',
  '  }',
  '}',
  '',
].join('\n')

/** The inspection of the local the query page reads. */
const PAGE_QUERY_INSPECTION = [
  { path: 'page', mode: 'value', required: true },
] as const

const clickNextPage: RepositoryOperation = {
  kind: 'click',
  title: 'Next page',
  selector: 'a[href="/?page=2"]',
}

/** The operations option of a run with one click and one server stop declared after it. */
function oneClickThenStop(operation: RepositoryOperation) {
  return {
    operations: [operation],
    stopOperations: [1],
    stopParticipants: ['server' as const],
  }
}

/** Reads the details of every journal entry of a type, as plain data. @example journaled(harness, 'breakpoint.other-route') */
function journaled(
  harness: Pick<PagesHarness, 'run'>,
  type: string,
): unknown[] {
  return harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))
}

/** Waits until the run published a server pause, and fails fast when the run failed first. @example const pause = await publishedPause(harness) */
function publishedPause(harness: Pick<PagesHarness, 'run'>) {
  return waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.server?.snapshot
  }, 'the published server pause')
}

/** Waits for a server pause other than the one the learner just continued. @example const second = await nextPause(harness, first) */
function nextPause(
  harness: Pick<PagesHarness, 'run'>,
  previous: ConfiguredRuntimeSnapshot,
) {
  return waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    const snapshot = view.participants.server?.snapshot
    return snapshot && snapshot.id !== previous.id ? snapshot : undefined
  }, 'the next server pause')
}

/** Waits until the server participant received this many resumes. @example await resumesReceived(harness, 1) */
function resumesReceived(harness: PagesHarness, count: number) {
  return waitUntil(
    () => harness.server!.continues.length >= count,
    `${count} resume(s) of the server`,
    ACTIVE_TIMEOUT_MS,
    undefined,
    HIT_POLL_MS,
  )
}

/** Reads a part of the run resource as plain data of this realm. @example plain(view.dataFunctions) */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

/** Cuts the async level that holds the data-function call arrow, so the chain still holds Next's renderer (`render`) but no call: the stack of the page component's server render. */
function withoutDataFunctionCall(event: PagesPausedEvent): void {
  event.asyncStackTrace = event.asyncStackTrace?.parent
}

/** Adds the frame of `getServerSideProps` (in the page module the fixture names) to the first async level, so the data function is seen only among the async frames. */
function withDataFunctionAmongAsyncFrames(event: PagesPausedEvent): void {
  event.asyncStackTrace?.callFrames.unshift({
    functionName: 'getServerSideProps',
    scriptId: '1498',
    url: '',
    lineNumber: 4,
    columnNumber: 8,
  })
}

/** Completes the entry load of a harness run after its last pause: the page finishes loading and the run completes. @example await continueAndComplete(harness, prepared, pause) */
async function continueAndComplete(
  harness: PagesHarness,
  prepared: Promise<void>,
  pause: ConfiguredRuntimeSnapshot,
): Promise<void> {
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await prepared
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed after the entry load',
  )
}

// Value: protects=AC 1 entry load, getServerSideProps: a server stop on the return line of a Pages page's getServerSideProps pauses the server during the entry load, labelled server-render and entry-load with no operationIndex, count reads 3 from the paused frame, the data function is named in the run resource, and after the continue the page finishes loading and the run completes; fails_when=the stop is refused as server-only, the hit is resumed or never published, the pause carries an operationIndex or another execution, Codebook sends a state-changing Debugger command through the proxy, or the run does not complete after the continue; no_claim=real HTTP or a real Next server (the scripted inspector sends the recorded E0b stack of Next 16.1.4), and the run-level after (the harness page answers it)
test('a server stop in getServerSideProps pauses the entry load and reads count 3', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context)
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
    }),
  )
  const pause = await publishedPause(harness)
  // Assert
  const view = harness.run.view()
  assert.equal(view.status, 'paused-server')
  assert.equal(pause.execution, 'server-render')
  assert.equal(pause.attribution, 'entry-load')
  assert.equal('operationIndex' in pause, false)
  assert.equal(pause.declaredIndex, 0)
  assert.equal(pause.executionIndex, 0)
  assert.equal(pause.values['value:count'], 3)
  assert.deepEqual(journaled(harness, 'breakpoint.unconfirmed'), [])
  assert.deepEqual(plain(view.dataFunctions), {
    [pause.id]: 'getServerSideProps',
  })
  // Only read-only Debugger commands went through the proxy.
  assert.deepEqual(
    harness.server!.inspectorMethods.filter(
      (method) =>
        method === 'Debugger.enable' ||
        method === 'Debugger.setAsyncCallStackDepth',
    ),
    [],
  )
  // Act: the learner continues and the page finishes loading
  await continueAndComplete(harness, prepared, pause)
})

// Value: protects=AC 1 after an await: a getServerSideProps that awaits before its return line is reached only through the async chain (the call arrow is in the first async level, the synchronous frames hold the page module alone); the stop still pauses, labelled entry-load, with the page read from the page-module frame and the evidence counted as frame; fails_when=the hit is resumed as outside the data function, pauses unconfirmed, or the page needs the synchronous renderer frame; no_claim=Next versions other than the recorded 16.1.4 chain, and a chain longer than the recorded levels
test('a getServerSideProps stop after an await pauses through the async chain with frame evidence', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context)
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-after-await',
    }),
  )
  const pause = await publishedPause(harness)
  // Assert
  const view = harness.run.view()
  assert.equal(pause.attribution, 'entry-load')
  assert.deepEqual(journaled(harness, 'breakpoint.unconfirmed'), [])
  assert.deepEqual(plain(view.attributionSummary), {
    taken: { frame: 1, request: 0 },
    unconfirmed: 0,
    resumed: {},
  })
  assert.deepEqual(plain(view.dataFunctions), {
    [pause.id]: 'getServerSideProps',
  })
  await continueAndComplete(harness, prepared, pause)
})

// Value: protects=AC 2 called code: in one run a stop on a getServerSideProps line and a stop in the code it calls (declaredIndex 0 and 1) pause in that order with executionIndex 0 and 1, both inside the entry page's data function; fails_when=the second stop is resumed, pauses first, or the indexes follow another order; no_claim=a helper in a module of its own (one sealed module stands for the page and its helper here; the reader tests seal a shared chunk)
test('a getServerSideProps stop and a stop in the helper it calls pause in order with declaredIndex 0 and 1', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    additionalStops: [
      {
        line: PAGES_SERVER_RETURN_LINE,
        column: 1,
        inspections: [{ path: 'count', mode: 'value', required: true }],
      },
    ],
    operations: {
      operations: [],
      stopOperations: [0, 0],
      stopParticipants: ['server', 'server'],
    },
    fixture: {
      source: PAGES_SERVER_PAGE_SOURCE,
      citationEndLine: 7,
      declaredLine: 5,
    },
    // The first stop's own line declares count, so a required count would move its request to the next line: it reads the query parameter instead.
    inspections: [{ path: 'query', mode: 'value', required: true }],
    inspectionScope: { count: 3, query: 'page=1' },
  })
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act
  harness.server!.hit(
    hitOnLine(5, { fixture: 'get-server-side-props-before-await' }),
  )
  const first = await publishedPause(harness)
  await harness.run.continue('server', first.pause)
  await resumesReceived(harness, 1)
  // The helper is called from getServerSideProps: its frame is above the data function's.
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
      prepend: true,
    }),
  )
  const second = await nextPause(harness, first)
  // Assert
  assert.deepEqual(
    [first, second].map((pause) => [
      pause.declaredIndex,
      pause.executionIndex,
      pause.attribution,
    ]),
    [
      [0, 0, 'entry-load'],
      [1, 1, 'entry-load'],
    ],
  )
  assert.deepEqual(journaled(harness, 'breakpoint.unconfirmed'), [])
  await continueAndComplete(harness, prepared, second)
})

// Value: protects=AC 2 helper after an await: a stop in a helper (a module of its own) that runs after an await inside the helper pauses when the data function is seen only among the async frames, with the page read from that async frame's page module; fails_when=the hit is judged outside the data function because the synchronous frames hold the helper alone, or its page is unreadable; no_claim=the helper's own module being sealed from a shared chunk (the reader tests) and the recorded chain of a helper (the getStaticProps helper payload has its own test of the verdict)
test('a stop in a helper after an await inside the helper pauses with getServerSideProps only among the async frames', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    sourcePath: 'src/lib/helper.ts',
  })
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-after-await',
      edit: withDataFunctionAmongAsyncFrames,
    }),
  )
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'entry-load')
  assert.deepEqual(journaled(harness, 'breakpoint.unconfirmed'), [])
  assert.deepEqual(plain(harness.run.view().attributionSummary?.taken), {
    frame: 1,
    request: 0,
  })
  await continueAndComplete(harness, prepared, pause)
})

// Value: protects=AC 2 wrapped data function: a getServerSideProps returned by a wrapper (withSession(handler)) pauses on a line of the wrapper's own code that runs before the handler and on a line of the handler, both inside the call Next makes to the export; fails_when=either line is resumed as outside the data function or pauses unconfirmed; no_claim=a wrapper's code after the handler (the same call frame), and a wrapper in another module
test('a wrapped getServerSideProps pauses on the wrapper line before the handler and on the handler line', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    fixture: {
      source: PAGES_WRAPPED_PAGE_SOURCE,
      citationEndLine: 13,
      declaredLine: 10,
    },
    additionalStops: [
      {
        line: 5,
        column: 1,
        inspections: [{ path: 'context', mode: 'value', required: true }],
      },
    ],
    operations: {
      operations: [],
      stopOperations: [0, 0],
      stopParticipants: ['server', 'server'],
    },
    inspections: [{ path: 'context', mode: 'value', required: true }],
    inspectionScope: { context: 'ctx' },
  })
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act: the wrapper's line runs first, Next calls the wrapper
  harness.server!.hit(
    hitOnLine(10, { fixture: 'get-server-side-props-before-await' }),
  )
  const wrapperPause = await publishedPause(harness)
  await harness.run.continue('server', wrapperPause.pause)
  await resumesReceived(harness, 1)
  // The handler is called by the wrapper: its frame is above the wrapper's.
  harness.server!.hit(
    hitOnLine(5, {
      fixture: 'get-server-side-props-before-await',
      prepend: true,
    }),
  )
  const handlerPause = await nextPause(harness, wrapperPause)
  // Assert
  assert.deepEqual(
    [wrapperPause, handlerPause].map((pause) => [
      pause.declaredIndex,
      pause.attribution,
    ]),
    [
      [0, 'entry-load'],
      [1, 'entry-load'],
    ],
  )
  assert.deepEqual(journaled(harness, 'breakpoint.unconfirmed'), [])
  await continueAndComplete(harness, prepared, handlerPause)
})

// Value: protects=AC 2 re-export: a page that re-exports its getServerSideProps from another module pauses on a line of that function, with the page read from pathname evaluated on the renderer's synchronous frame; fails_when=the hit is judged outside the data function because no frame of the page module is inside the call, or pathname is not read; no_claim=the re-exporting module's seal (the reader tests) and a re-export read after an await (the request evidence has its own verdict tests)
test('a page that re-exports its getServerSideProps pauses on a line of the exported function', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    sourcePath: 'src/lib/data.ts',
  })
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
      pathname: '/',
    }),
  )
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'entry-load')
  assert.deepEqual(plain(harness.run.view().attributionSummary?.taken), {
    frame: 1,
    request: 0,
  })
  assert.ok(
    harness.server!.inspectorMethods.includes('Debugger.evaluateOnCallFrame'),
    'pathname was read from the renderer frame',
  )
  await continueAndComplete(harness, prepared, pause)
})

// Value: protects=AC 2 getStaticProps: a stop in a getStaticProps pauses at the entry load (next dev runs it on every request) and the run resource names getStaticProps, not getServerSideProps; fails_when=the call arrow of getStaticProps is not recognised, so the hit is resumed or unconfirmed, or the data function is named wrongly; no_claim=a production build, where getStaticProps runs at build time
test('a stop in getStaticProps pauses at the entry load and names getStaticProps', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    fixture: {
      source: PAGES_STATIC_PAGE_SOURCE,
      citationEndLine: 7,
      declaredLine: PAGES_SERVER_RETURN_LINE,
    },
  })
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-static-props-after-await',
    }),
  )
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'entry-load')
  assert.deepEqual(plain(harness.run.view().dataFunctions), {
    [pause.id]: 'getStaticProps',
  })
  await continueAndComplete(harness, prepared, pause)
})

// Value: protects=AC 3 after an operation: a stop declared afterOperation 1 in a getServerSideProps that reads query.page pauses when the click on a next/link to /?page=2 makes Next fetch /_next/data and run the function again, labelled after-operation with operationIndex 1, with page reading "2", and the entry load's own run of the function is not taken for it (nothing paused before the click); fails_when=the stop pauses before operation 1, the pause lacks operationIndex 1 or reads another page value, or the execution is not server-render; no_claim=E0's real Next behaviour (Issue 188 records it), a real next/link click, and the entry load's hit (the stop is armed only inside operation 1)
test('a getServerSideProps stop after a next/link click pauses the data request with operationIndex 1 and page 2', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    fixture: {
      source: PAGES_QUERY_PAGE_SOURCE,
      citationEndLine: 7,
      declaredLine: PAGES_SERVER_RETURN_LINE,
    },
    documentReadyState: 'complete',
    operations: oneClickThenStop(clickNextPage),
    inspections: [...PAGE_QUERY_INSPECTION],
    inspectionScope: { page: '2' },
  })
  await harness.run.prepare()
  // The entry load ran the function once, before the stop was armed: no hit, no pause.
  assert.equal(harness.run.view().snapshots.length, 0)
  assert.equal(harness.server!.continues.length, 0)
  // Act
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(
    () => harness.inputsSeen() === 1,
    'the click reached the page',
  )
  harness.pageRequest.start(
    'data-1',
    'http://localhost:4321/_next/data/build/index.json?page=2',
    'Fetch',
  )
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
    }),
  )
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.execution, 'server-render')
  assert.equal(pause.attribution, 'after-operation')
  assert.equal(pause.operationIndex, 1)
  assert.equal(pause.values['value:page'], '2')
  await harness.run.continue('server', pause.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed after the continue',
  )
})

// Value: protects=AC 12 after-operation not reached: an afterOperation 1 server stop whose operation makes no request of the entry route ends SERVER_STOP_NOT_REACHED with phase after-operation, the Pages wording (the line did not run inside the entry page's data function for that request, what to change), and the structured details router pages, resumedHits [], attributionMode async-chain and the Next version, with sideEffects unknown; fails_when=the App Router render advice (module scope, a cache) is given, a detail is missing, or sideEffects says none; no_claim=the service's read of the failure (the next two tests read it through the service) and a real 20 s wait (the run's manual clock moves)
test('an after-operation stop whose operation makes no request ends not reached with the Pages wording and details', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    fixture: {
      source: PAGES_QUERY_PAGE_SOURCE,
      citationEndLine: 7,
      declaredLine: PAGES_SERVER_RETURN_LINE,
    },
    documentReadyState: 'complete',
    operations: oneClickThenStop(clickNextPage),
    inspections: [...PAGE_QUERY_INSPECTION],
    inspectionScope: { page: '2' },
  })
  await harness.run.prepare()
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === 1, 'the click was sent')
  // Act: the click makes no request of the entry route
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  const view = harness.run.view()
  assert.equal(
    view.failures[0],
    "SERVER_STOP_NOT_REACHED: Declared stop src/pages/index.tsx:6 was not reached inside the entry page's data function (getServerSideProps or getStaticProps) for the request operation 1 made within 20 s after it. The line did not run there for this request. Declare the stop on a line the data function runs for that request or in code it calls, or declare a browser stop for code the page component runs, then start a new run.",
  )
  assert.deepEqual(
    plain(describeServerRenderFailureDetails(view.operationFailure!)),
    {
      phase: 'after-operation',
      stop: 'src/pages/index.tsx:6',
      operationIndex: 1,
      pausedStops: [],
      notReachedStops: ['src/pages/index.tsx:6'],
      firstExecutionObserved: false,
      router: 'pages',
      resumedHits: [],
      attributionMode: 'async-chain',
      nextVersion: '16.4.3',
      sent: 'sent',
      sideEffects: 'unknown',
      retry: 'Never retry automatically; ask the learner.',
      logId: 'service-run-73#1',
    },
  )
})

// Value: protects=AC 12 entry-render not reached: a page that loads without the entry-render server stop being hit ends SERVER_STOP_NOT_REACHED with phase entry-render, the Pages wording, details router pages, resumedHits, attributionMode and nextVersion, and sideEffects unknown (Codebook's readiness request already ran the data function), with the entry request offered to the learner, not started again; fails_when=the App Router advice is given, sideEffects says none, or a detail is missing from the error the service gives the agent; no_claim=why a real Next skipped the function
test('an entry page that loads without the data-function stop ends not reached with sideEffects unknown', async (context) => {
  // Arrange
  const run = await pagesServerService(context, {
    documentReadyState: 'complete',
  })
  // Act
  await waitUntil(() => run.state().error, 'the failed run')
  // Assert
  const error = run.state().error!
  assert.equal(error.code, 'SERVER_STOP_NOT_REACHED')
  assert.equal(
    error.message,
    "The page finished without reaching declared stop src/pages/index.tsx:6 inside the entry page's data function (getServerSideProps or getStaticProps) for the observed request. The line did not run there for this request. Declare the stop on a line the data function runs for that request or in code it calls, or declare a browser stop for code the page component runs, then start a new run.",
  )
  assert.deepEqual(plain(error.details), {
    phase: 'entry-render',
    stop: 'src/pages/index.tsx:6',
    pausedStops: [],
    notReachedStops: ['src/pages/index.tsx:6'],
    firstExecutionObserved: false,
    router: 'pages',
    resumedHits: [],
    attributionMode: 'async-chain',
    nextVersion: '16.4.3',
    sent: 'not-sent',
    sideEffects: 'unknown',
    runUri: error.details?.runUri,
    retry: 'Never retry automatically; ask the learner.',
    logId: 'service-run-73#start',
  })
  assert.match(error.recovery, /In a Pages run: the line did not run inside/)
})

// Value: protects=AC 12 ENTRY_LOAD_TIMEOUT: a Pages entry-render stop that paused and was continued, after which the page does not finish loading within 20 s, ends ENTRY_LOAD_TIMEOUT keeping its meaning, with details.sideEffects unknown, router pages, and the readiness sentence in its recovery; fails_when=sideEffects says none or the recovery omits that the data function ran during the readiness request; no_claim=a real page that hangs after its data function
test('an entry page that does not load after the continue ends ENTRY_LOAD_TIMEOUT with sideEffects unknown and the readiness sentence', async (context) => {
  // Arrange
  const run = await pagesServerService(context)
  const { harness, state, service } = run
  await armedEntry(harness)
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
    }),
  )
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  await service.continue(state().participants.server!.continueArguments!)
  // Act: the page does not load for 20 s
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(() => state().error, 'the failed run')
  // Assert
  const error = state().error!
  assert.equal(error.code, 'ENTRY_LOAD_TIMEOUT')
  assert.deepEqual(
    {
      router: error.details?.router,
      lastPausedStop: error.details?.lastPausedStop,
      sent: error.details?.sent,
      sideEffects: error.details?.sideEffects,
    },
    {
      router: 'pages',
      lastPausedStop: 'src/pages/index.tsx:6',
      sent: 'not-sent',
      sideEffects: 'unknown',
    },
  )
  assert.match(error.recovery, /readiness request/)
  assert.match(error.recovery, /ask the learner before another start/)
})

// Value: protects=AC 13 getStaticProps after an operation (E0 observed that next dev runs getStaticProps again on a same-route navigation): the stop pauses with operationIndex 1 and names getStaticProps; fails_when=the stop ends not reached, or the pause is labelled entry-load; no_claim=E0's real Next behaviour, which Issue 188 records
test('a getStaticProps stop after a next/link click pauses with operationIndex 1', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    fixture: {
      source: PAGES_STATIC_PAGE_SOURCE,
      citationEndLine: 7,
      declaredLine: PAGES_SERVER_RETURN_LINE,
    },
    documentReadyState: 'complete',
    operations: oneClickThenStop({
      kind: 'click',
      title: 'Same page',
      selector: 'a[href="/?x=2"]',
    }),
  })
  await harness.run.prepare()
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === 1, 'the click was sent')
  harness.pageRequest.start(
    'data-1',
    'http://localhost:4321/_next/data/build/index.json?x=2',
    'Fetch',
  )
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-static-props-after-await',
    }),
  )
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'after-operation')
  assert.equal(pause.operationIndex, 1)
  assert.deepEqual(plain(harness.run.view().dataFunctions), {
    [pause.id]: 'getStaticProps',
  })
})

// Value: protects=AC 14 other route: a helper that the entry page's getServerSideProps and another page's getServerSideProps both call holds an afterOperation 1 stop; the operation navigates to the other page, the helper's hit (pathname /other) is journaled breakpoint.other-route with its route and not taken, and the run ends SERVER_STOP_NOT_REACHED whose message and resumedHits say the line may have run outside the entry page's data function; fails_when=the other page's hit pauses the learner, is not journaled with its route, or the not-reached message omits the may-have-run-outside sentence; no_claim=the browser's page after the navigation (a stand-in) and a real second page's compile
test("another page's data-function hit of a shared helper is resumed as other-route and the stop ends not reached", async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    sourcePath: 'src/lib/helper.ts',
    nextPages: {
      mappedLines: 3,
      serverCompile: true,
      pagesManifest: { '/other': 'pages/other.js' },
    },
    documentReadyState: 'complete',
    operations: oneClickThenStop({
      kind: 'click',
      title: 'Other page',
      selector: 'a[href="/other"]',
    }),
  })
  await harness.run.prepare()
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === 1, 'the click was sent')
  harness.pageRequest.start(
    'data-1',
    'http://localhost:4321/_next/data/build/other.json',
    'Fetch',
  )
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
      prepend: true,
      pathname: '/other',
    }),
  )
  await resumesReceived(harness, 1)
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  const view = harness.run.view()
  assert.deepEqual(journaled(harness, 'breakpoint.other-route'), [
    { route: '/other' },
  ])
  assert.equal(view.snapshots.length, 0)
  assert.match(
    view.failures[0]!,
    /^SERVER_STOP_NOT_REACHED: Declared stop src\/lib\/helper\.ts:6 was not reached .*Codebook resumed 1 hit\(s\) of this line \(1 in another page's data function \(\/other\)\): the line may have run outside the entry page's data function\./,
  )
  assert.deepEqual(
    plain(
      describeServerRenderFailureDetails(view.operationFailure!).resumedHits,
    ),
    [{ reason: 'other-route', route: '/other', count: 1 }],
  )
})

// Value: protects=AC 15 module re-announcement (contract 6): the entry page's server compile announced again during the run (a recompile) keeps the Pages server stop's seal and the stop pauses in the new script, with the re-announced module journaled as coexisting and the run not failed with SOURCE_CHANGED; fails_when=a re-announced server module ends the run as a changed source, or the hit in the new script id is not taken; no_claim=a Pages browser stop on a re-announced module, which keeps failing (the Fast Refresh test of nextPagesRun)
test('a Pages server stop keeps its seal and pauses when its server compile is announced again', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context)
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  harness.server!.announceScript('server')
  // Act: Next recompiles the page and announces its module under a new script id
  harness.server!.announceScript('recompiled')
  await waitUntil(
    () => journaled(harness, 'stop.instance-coexisting').length > 0,
    'the re-announced module was accepted',
  )
  harness.server!.hit({
    scriptId: 'recompiled',
    ...hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
    }),
  })
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(pause.source.scriptId, 'recompiled')
  assert.equal(pause.attribution, 'entry-load')
  await continueAndComplete(harness, prepared, pause)
})

// Value: protects=AC 16 outside the data function: a helper that only the page component's server render calls holds an entry-render server stop; its hit (a complete chain with Next's renderer and no data-function call) is journaled breakpoint.outside-data-function and resumed, and the page then loads without a pause so the run ends SERVER_STOP_NOT_REACHED (phase entry-render) whose message says the line may have run outside the entry page's data function; fails_when=the render's hit pauses the learner as data, is resumed without its journal entry or counts, or the message omits the sentence; no_claim=a real render's stack (the recorded chain with its data-function level cut stands in)
test("a hit that only the page component's render makes is resumed as outside-data-function and the stop ends not reached", async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    sourcePath: 'src/lib/helper.ts',
  })
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedEntry(harness)
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-after-await',
      edit: withoutDataFunctionCall,
    }),
  )
  await resumesReceived(harness, 1)
  harness.setDocumentReadyState('complete')
  await prepared
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  const view = harness.run.view()
  assert.deepEqual(journaled(harness, 'breakpoint.outside-data-function'), [{}])
  assert.equal(view.snapshots.length, 0)
  assert.match(
    view.failures[0]!,
    /^SERVER_STOP_NOT_REACHED: The page finished without reaching declared stop src\/lib\/helper\.ts:6 inside the entry page's data function .*Codebook resumed 1 hit\(s\) of this line \(1 outside every data function\): the line may have run outside the entry page's data function\./,
  )
  assert.deepEqual(plain(view.attributionSummary), {
    taken: { frame: 0, request: 0 },
    unconfirmed: 0,
    resumed: { 'outside-data-function': 1 },
  })
})

// Value: protects=AC 16 shared helper: a helper that getServerSideProps and the page component's server render both call pauses once, in the getServerSideProps call: the render's hit is resumed as outside the data function, the data function's hit pauses, and the render's later hit of the paused stop is resumed as a repeat; fails_when=the stop pauses for the render's hit, pauses twice, or the repeat hit fails the run as an extra stop; no_claim=the order of a real request's two hits (a data function runs before the render; the order here also proves the render's earlier hit is not taken)
test('a helper shared by the data function and the render pauses once, in the data-function call', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    sourcePath: 'src/lib/helper.ts',
  })
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  const renderHit = hitOnLine(PAGES_SERVER_RETURN_LINE, {
    fixture: 'get-server-side-props-after-await',
    edit: withoutDataFunctionCall,
  })
  // Act: the render's hit, the data function's hit, then the render's second hit
  harness.server!.hit(renderHit)
  await resumesReceived(harness, 1)
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
      prepend: true,
    }),
  )
  const pause = await publishedPause(harness)
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await resumesReceived(harness, 2)
  harness.server!.hit(renderHit)
  await resumesReceived(harness, 3)
  await prepared
  // Assert
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.equal(harness.run.view().failures.length, 0)
  assert.deepEqual(journaled(harness, 'breakpoint.outside-data-function'), [{}])
  assert.deepEqual(journaled(harness, 'breakpoint.repeat-hit'), [{}])
  assert.deepEqual(plain(harness.run.view().dataFunctions), {
    [pause.id]: 'getServerSideProps',
  })
})

// Value: protects=AC 16 unknown client mapping: a page component line whose client mapping the scan could not read to its end is accepted (seal.evidence client-mapping-unverified), and its server-render hit, a complete chain with no data-function call, is resumed as outside-data-function, so the run ends not reached and never pauses the component line as data; fails_when=the line is refused, the render's hit pauses as data, or the journal omits the unverified evidence; no_claim=a real scan stopping at its size limit (the scripted map stops at the limit)
test('a component line with an unreadable client mapping is accepted, its render hit is resumed and the run ends not reached', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    fixture: {
      source: PAGES_SERVER_PAGE_SOURCE,
      citationEndLine: 7,
      declaredLine: 2,
    },
    nextPages: {
      mappedLines: 3,
      browserMapScanStopsAtLimit: true,
      serverCompile: true,
    },
  })
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedEntry(harness)
  // Act
  harness.server!.hit(
    hitOnLine(2, {
      fixture: 'get-server-side-props-after-await',
      edit: withoutDataFunctionCall,
    }),
  )
  await resumesReceived(harness, 1)
  harness.setDocumentReadyState('complete')
  await prepared
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  assert.deepEqual(journaled(harness, 'seal.evidence'), [
    { stop: 'src/pages/index.tsx:2', evidence: 'client-mapping-unverified' },
  ])
  assert.deepEqual(journaled(harness, 'breakpoint.outside-data-function'), [{}])
  assert.equal(harness.run.view().snapshots.length, 0)
  assert.match(
    harness.run.view().failures[0]!,
    /^SERVER_STOP_NOT_REACHED: The page finished without reaching declared stop src\/pages\/index\.tsx:2/,
  )
})

/** One scenario of {@link unconfirmedScenarios}: the hit and the journal entry it must leave. */
interface UnconfirmedScenario {
  name: string
  sourcePath?: string
  hit: PagesHitScript
  journal: object
}

const unconfirmedScenarios: UnconfirmedScenario[] = [
  {
    name: 'no async chain',
    hit: {
      fixture: 'get-server-side-props-after-await',
      edit: (event): void => {
        event.asyncStackTrace = undefined
      },
    },
    journal: { reason: 'no-async-chain' },
  },
  {
    name: 'no renderer frame in reach',
    hit: {
      fixture: 'get-server-side-props-after-await',
      edit: (event): void => {
        for (let node = event.asyncStackTrace; node; node = node.parent)
          node.callFrames = node.callFrames.filter(
            (frame) => frame.scriptId !== RENDERER_SCRIPT_ID,
          )
      },
    },
    journal: { reason: 'no-renderer-frame' },
  },
  {
    name: 'a renderer frame whose page cannot be read',
    sourcePath: 'src/lib/helper.ts',
    hit: { fixture: 'get-server-side-props-after-await' },
    journal: { reason: 'route-unreadable' },
  },
  {
    name: 'an async chain that cannot be read to its end',
    hit: {
      fixture: 'get-server-side-props-after-await',
      edit: (event): void => {
        event.asyncStackTrace = undefined
        event.asyncStackTraceId = { id: 'chain-1', debuggerId: 'other' }
      },
      stackTraces: { 'chain-1': 'fail' },
    },
    journal: { reason: 'chain-incomplete', cause: 'fetch-failed' },
  },
]

// Value: protects=AC 16 unconfirmed: a hit whose attribution cannot be proven pauses labelled unconfirmed with its journal reason (no-async-chain, no-renderer-frame, route-unreadable while the browser shows the entry route, chain-incomplete with its cause), never resumed as outside-data-function, and the run resource carries a note that the values are unconfirmed; fails_when=an incomplete hit is resumed as outside the data function, the label is entry-load, or the reason is not journaled; no_claim=the verdict's own cases (pagesDataFunctionHitVerdict tests) and a real Next that omits its async chain
test('a hit that cannot be proven pauses unconfirmed with its reason and is never resumed as outside the data function', async (context) => {
  // Arrange, Act, Assert: one run for each reason
  for (const scenario of unconfirmedScenarios) {
    const harness = await pagesServerRun(context, {
      ...(scenario.sourcePath ? { sourcePath: scenario.sourcePath } : {}),
    })
    harness.run.prepare().catch(() => undefined)
    await armedEntry(harness)
    harness.server!.hit(hitOnLine(PAGES_SERVER_RETURN_LINE, scenario.hit))
    const pause = await publishedPause(harness)
    const view = harness.run.view()
    assert.equal(pause.attribution, 'unconfirmed', scenario.name)
    assert.deepEqual(
      journaled(harness, 'breakpoint.unconfirmed'),
      [scenario.journal],
      scenario.name,
    )
    assert.deepEqual(
      journaled(harness, 'breakpoint.outside-data-function'),
      [],
      scenario.name,
    )
    assert.deepEqual(
      plain(view.attributionSummary),
      { taken: { frame: 0, request: 0 }, unconfirmed: 1, resumed: {} },
      scenario.name,
    )
    assert.match(view.renderMessage ?? '', /This pause is unconfirmed \(/)
    assert.deepEqual(plain(view.dataFunctions), {}, scenario.name)
  }
})

// Value: protects=AC 16 verdict-error: an event of an unexpected shape pauses unconfirmed, writes exactly one Output > Codebook line with a log id, a value-free shape summary and the Next version, and puts the log id in the journal entry of the reason; fails_when=the verdict throws into the run, the line is missing or repeats, the line quotes a value of the event, or the journal entry lacks the log id; no_claim=which Next change produces such a shape
test('an event of an unexpected shape pauses unconfirmed and writes one log line with a log id', async (context) => {
  // Arrange
  const lines: { level: string; text: string }[] = []
  const control: RuntimeControl = {
    ...pagesControl(context),
    outputLog: (line) => lines.push(line),
  }
  const harness = await pagesServerRun(context, { control })
  harness.run.prepare().catch(() => undefined)
  await armedEntry(harness)
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
      edit: (event) => {
        Object.assign(event.callFrames[1]!, { location: 'secret-position' })
      },
    }),
  )
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'unconfirmed')
  assert.deepEqual(journaled(harness, 'breakpoint.unconfirmed'), [
    { reason: 'verdict-error', logId: 'service-run-73#hit-1' },
  ])
  assert.equal(lines.length, 1)
  assert.equal(lines[0]!.level, 'error')
  assert.match(
    lines[0]!.text,
    /^Run service-run-73: a server hit could not be judged \(event shape .*; Next 16\.4\.3\) \[log service-run-73#hit-1\]$/,
  )
  assert.equal(lines[0]!.text.includes('secret-position'), false)
})

// Value: protects=AC 16 unreadable page elsewhere: a hit whose renderer frame is found but whose page cannot be read, while the browser shows another page than the entry route, is resumed as breakpoint.unattributed-resumed and not taken; fails_when=the hit pauses the learner on another page's request; no_claim=the unconfirmed pause while the browser shows the entry route (the table test above)
test('an unreadable page is resumed unattributed while the browser is on another route', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    sourcePath: 'src/lib/helper.ts',
    documentReadyState: 'complete',
    operations: oneClickThenStop({
      kind: 'click',
      title: 'Other page',
      selector: 'a[href="/other"]',
    }),
  })
  await harness.run.prepare()
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === 1, 'the click was sent')
  harness.landOn('/other', 'within-document')
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-after-await',
    }),
  )
  await resumesReceived(harness, 1)
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.unattributed-resumed'), [{}])
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=AC 18 readiness on the record: a Pages run's resource and journal hold one readiness.entry-request entry with its HTTP status before the first pause, a taken pause names its data function in the run resource (not in the saved study), and the run resource names the Next version and the attribution summary; fails_when=the entry is missing, repeats, comes after the first pause or lacks the status, or the data function, version or summary is missing from the resource; no_claim=the status of a real request (the stand-in server answers 200)
test('the run resource and journal record the readiness request before the first stop and name the data function and Next version', async (context) => {
  // Arrange
  const run = await pagesServerService(context)
  const { harness, state } = run
  await armedEntry(harness)
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
    }),
  )
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  // Assert
  const resource = plain(state()) as {
    readinessRequest: { state: string; status: number }
    nextVersion: string
    attributionSummary: unknown
    observations: { dataFunction: string }[]
  }
  assert.equal(resource.readinessRequest.state, 'closed')
  assert.equal(resource.readinessRequest.status, 200)
  assert.equal(resource.nextVersion, '16.4.3')
  assert.deepEqual(resource.attributionSummary, {
    taken: { frame: 1, request: 0 },
    unconfirmed: 0,
    resumed: {},
  })
  assert.equal(resource.observations[0]!.dataFunction, 'getServerSideProps')
  const events = harness.run.view().events
  const readiness = events.filter(
    (event) => event.type === 'readiness.entry-request',
  )
  assert.equal(readiness.length, 1)
  assert.equal((readiness[0]!.detail as { status: number }).status, 200)
  const committed = events.find((event) => event.type === 'snapshot.committed')
  assert.ok(committed && readiness[0]!.sequence < committed.sequence)
})

// Value: protects=AC 18 readiness timeout: a readiness request whose data function writes and then never answers closes with the status-free outcome timeout, the journal holds that one entry, and the run's failure reports details.sideEffects unknown with a recovery that asks the learner before another start; fails_when=the failure says nothing ran, the entry is missing or closed with a status, or the recovery omits the question to the learner; no_claim=a real 120 s wait (the stand-in launcher ends the request as a timeout)
test('a readiness request that never answers closes timeout and the failure reports sideEffects unknown', async (context) => {
  // Arrange
  const run = await pagesServerService(context, {
    nextPages: { serverCompile: true, readinessFailure: 'timeout' },
  })
  // Act
  await waitUntil(() => run.state().error, 'the failed run')
  // Assert
  const error = run.state().error!
  assert.equal(error.details?.sideEffects, 'unknown')
  assert.match(error.recovery, /ask before another start/)
  const resource = plain(run.state()) as {
    readinessRequest: { state: string; outcome: string }
  }
  assert.equal(resource.readinessRequest.state, 'closed')
  assert.equal(resource.readinessRequest.outcome, 'timeout')
  assert.equal('status' in resource.readinessRequest, false)
  assert.deepEqual(
    run.harness.run
      .view()
      .events.filter((event) => event.type === 'readiness.entry-request')
      .map((event) => (event.detail as { outcome?: string }).outcome),
    ['timeout'],
  )
})

// Value: protects=AC 18 readiness 500: a Pages readiness answer of 500 or more ends NEXT_ROUTE_NOT_COMPILED quoting the development server's output, not a misleading NEXT_STOP_NOT_SEALED, with the readiness record closed with status 500 and details sideEffects unknown; fails_when=the run goes on to seal the stop, another code answers, the output is not quoted, or the record has no status; no_claim=Next's real error page and output
test('a readiness answer of 500 ends NEXT_ROUTE_NOT_COMPILED quoting the server output', async (context) => {
  // Arrange
  const run = await pagesServerService(context, {
    nextPages: {
      serverCompile: true,
      entry: { status: 500 },
      outputTail: 'Error: boom in getServerSideProps',
    },
  })
  // Act
  await waitUntil(() => run.state().error, 'the failed run')
  // Assert
  const error = run.state().error!
  assert.equal(error.code, 'NEXT_ROUTE_NOT_COMPILED')
  assert.match(error.message, /Error: boom in getServerSideProps/)
  assert.deepEqual(plain(error.details), {
    router: 'pages',
    sideEffects: 'unknown',
  })
  const resource = plain(run.state()) as {
    readinessRequest: { status: number }
  }
  assert.equal(resource.readinessRequest.status, 500)
})

/** One outcome of a paused data function after the continue: what the page ends as, and how the run ends. */
interface DataFunctionOutcome {
  name: string
  /** What the page does once the learner continued. */
  pageEnds(harness: PagesHarness): void
  /** Whether the run then waits for its after conditions, which the test lets expire. */
  waitsForAfterConditions: boolean
  failure: RegExp
}

const dataFunctionOutcomes: DataFunctionOutcome[] = [
  {
    name: 'a data function that throws (Next serves its error page)',
    pageEnds: (harness): void =>
      harness.failAfterWith({ conditionIndex: 0, reason: 'not-visible' }),
    waitsForAfterConditions: true,
    failure: /^OPERATION_AFTER_NOT_MET: The entry page loaded/,
  },
  {
    name: 'a data function that returns notFound (Next serves its 404 page)',
    pageEnds: (harness): void =>
      harness.failAfterWith({ conditionIndex: 0, reason: 'not-visible' }),
    waitsForAfterConditions: true,
    failure: /^OPERATION_AFTER_NOT_MET: The entry page loaded/,
  },
  {
    name: 'a data function that returns redirect (the browser leaves the entry path)',
    pageEnds: (harness): void => harness.commitMainFrame('/login'),
    waitsForAfterConditions: false,
    failure: /^NEXT_ENTRY_REDIRECTED: /,
  },
]

// Value: protects=AC 21 edges of a paused data function: after the continue, a data function that throws, returns notFound or returns redirect ends the run with the page's own outcome observed (the entry page loaded but its result is not the expected one, or the entry path was left for another page), as a coded outcome of the page and not as a failure of the pause (RUN_FAILED_UNEXPECTEDLY, an extra stop, an uncertain continue); fails_when=any of the three ends with a failure about the pause, hangs, or has no code; no_claim=Next's real 500, 404 and redirect responses (the stand-in page shows or leaves the entry page)
test("a data function that throws, returns notFound or redirects after the continue ends with the page's own outcome", async (context) => {
  // Arrange, Act, Assert: one run for each outcome
  for (const outcome of dataFunctionOutcomes) {
    const harness = await pagesServerRun(context)
    const prepared = harness.run.prepare().catch((error: unknown) => error)
    await armedEntry(harness)
    harness.server!.hit(
      hitOnLine(PAGES_SERVER_RETURN_LINE, {
        fixture: 'get-server-side-props-before-await',
      }),
    )
    const pause = await publishedPause(harness)
    // Act: the learner continues and the page ends as the data function made it
    await harness.run.continue('server', pause.pause).catch(() => undefined)
    outcome.pageEnds(harness)
    harness.setDocumentReadyState('complete')
    await prepared
    if (outcome.waitsForAfterConditions) {
      await waitUntil(
        () => harness.run.view().status === 'resuming',
        `the run observes its after conditions (${outcome.name})`,
      )
      harness.advance(20_000)
    }
    await waitUntil(
      () => harness.run.view().failures.length > 0,
      `the run failed (${outcome.name})`,
    )
    // Assert
    assert.match(harness.run.view().failures[0]!, outcome.failure, outcome.name)
    assert.doesNotMatch(
      harness.run.view().failures[0]!,
      /RUN_FAILED_UNEXPECTEDLY|Unexpected or additional|Continue uncertain/,
      outcome.name,
    )
  }
})

// Value: protects=AC 21 second request: a second request that reaches the paused stop's line after the learner continued (it arrived while the first was paused) is resumed as breakpoint.repeat-hit and is not published as the paused stop's pause or as a second pause; fails_when=the second hit pauses the learner again, fails the run as an additional stop, or is left paused; no_claim=the real queueing of a second request behind a paused Node thread (the stand-in sends its hit after the continue)
test('a second request that hits the paused stop is resumed as a repeat, not taken for the stop', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context)
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  const secondRequestHit = hitOnLine(PAGES_SERVER_RETURN_LINE, {
    fixture: 'get-server-side-props-before-await',
  })
  harness.server!.hit(secondRequestHit)
  const pause = await publishedPause(harness)
  // A second page request arrives while the first is paused.
  harness.pageRequest.start(
    'second',
    'http://localhost:4321/?second=1',
    'Document',
  )
  // Act
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await resumesReceived(harness, 1)
  harness.server!.hit(secondRequestHit)
  await resumesReceived(harness, 2)
  await prepared
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed',
  )
  // Assert
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.deepEqual(journaled(harness, 'breakpoint.repeat-hit'), [{}])
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=AC 21 resumed-hit limit: a Pages stop whose resumed hits reach 500 is disarmed and ends SERVER_STOP_NOT_REACHED with its resumedHits counts, the journal keeping only its first 100 entries of the reason; fails_when=the run resumes hits without end, the failure omits the counts or counts only the journaled hits; no_claim=the cost of a real hot helper (the scripted hits are sent one after another)
test('a stop whose resumed hits reach 500 is disarmed and ends not reached with the counts', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    sourcePath: 'src/lib/helper.ts',
  })
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedEntry(harness)
  const outsideHit = hitOnLine(PAGES_SERVER_RETURN_LINE, {
    fixture: 'get-server-side-props-after-await',
    edit: withoutDataFunctionCall,
  })
  // Act
  for (let hit = 1; hit <= PAGES_STOP_RESUMED_HIT_LIMIT; hit++) {
    harness.server!.hit(outsideHit)
    await resumesReceived(harness, hit)
  }
  await prepared
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  const view = harness.run.view()
  assert.match(view.failures[0]!, /^SERVER_STOP_NOT_REACHED: /)
  assert.deepEqual(
    plain(
      describeServerRenderFailureDetails(view.operationFailure!).resumedHits,
    ),
    [{ reason: 'outside-data-function', count: 500 }],
  )
  assert.equal(
    journaled(harness, 'breakpoint.outside-data-function').length,
    100,
  )
})

/** Distinct stand-in credentials, built from parts so no literal in this file reads as a real one. */
const SESSION_VALUE = ['sess', 'ion', '7f3a9c1d'].join('-')
const THEME_VALUE = 'dark'

// Value: protects=task 0 in a Pages server pause: the saved study of a pause whose scripted scope holds req.headers.cookie, req.cookies and req.rawHeaders holds none of the scripted cookie values (the request a getServerSideProps pause holds), while the pause itself is saved; fails_when=a cookie value reaches the study file, in the debugger snapshot or in any other member; no_claim=a real js-debug scope (the participant answers the scripted tree) and values outside the three carriers
test('the saved study of a getServerSideProps pause holds none of the request cookie values', async (context) => {
  // Arrange
  const run = await pagesServerService(context, {})
  const { harness, state, service, receipt } = run
  harness.server!.setFrameName('getServerSideProps')
  harness.server!.setScope({
    count: 3,
    req: {
      url: '/',
      headers: { cookie: `sid=${SESSION_VALUE}; theme=${THEME_VALUE}` },
      cookies: { sid: SESSION_VALUE, theme: THEME_VALUE },
      rawHeaders: [
        'Host',
        'localhost',
        'Cookie',
        `sid=${SESSION_VALUE}; theme=${THEME_VALUE}`,
      ],
    },
  })
  run.holdMaintenance()
  await armedEntry(harness)
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
    }),
  )
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  harness.setDocumentReadyState('complete')
  await service.continue(state().participants.server!.continueArguments!)
  await waitUntil(() => state().state === 'completed', 'the completed run')
  const directory = await mkdtemp(join(tmpdir(), 'codebook-pages-cookie-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  // Act
  const saved = await captureStudy(
    service,
    service.record(receipt),
    '0'.repeat(64),
  )
  const library = new LearningLibrary(directory, '0'.repeat(64))
  await library.saveStudy(saved!)
  // Assert
  const files = (await readdir(directory)).filter((name) =>
    name.endsWith('.study.v8.json'),
  )
  assert.equal(files.length, 1)
  const studyText = await readFile(join(directory, files[0]!), 'utf8')
  assert.equal(studyText.includes(SESSION_VALUE), false)
  assert.equal(studyText.includes('getServerSideProps'), true)
})
