import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PAGES_OUTSTANDING_REQUEST_LIMIT } from '../constants'
import { isPagesServerScriptUrl } from '../utils/isPagesServerScriptUrl'
import { OutstandingPageRequests } from '../utils/outstandingPageRequests'
import { PagesHitLedger } from '../utils/pagesHitLedger'
import { pagesNotReachedMessage } from '../utils/pagesNotReachedMessage'
import {
  ReadinessEntryRecord,
  readinessOutcomeOfError,
} from '../utils/readinessEntryRecord'
import { serverExecutionOfScriptUrl } from '../utils/serverExecutionOfScriptUrl'

// Value: protects=the Pages hit ledger: resumed hits are counted per stop, per reason and, for another page's data function, per route, in the order each first happened, and the total is what the 500-hit limit reads; fails_when=two routes share a count, one stop's hits reach another stop's total, or the counts are lost; no_claim=the journal cap (the run tests)
test('the ledger counts resumed hits per stop, reason and route', () => {
  // Arrange
  const ledger = new PagesHitLedger()
  // Act
  ledger.recordResumed('src/lib/a.ts:3', {
    action: 'resume',
    event: 'breakpoint.other-route',
    route: '/one',
  })
  ledger.recordResumed('src/lib/a.ts:3', {
    action: 'resume',
    event: 'breakpoint.other-route',
    route: '/two',
  })
  ledger.recordResumed('src/lib/a.ts:3', {
    action: 'resume',
    event: 'breakpoint.other-route',
    route: '/one',
  })
  const total = ledger.recordResumed('src/lib/a.ts:3', {
    action: 'resume',
    event: 'breakpoint.outside-data-function',
  })
  ledger.recordResumed('src/lib/b.ts:9', {
    action: 'resume',
    event: 'breakpoint.unattributed-resumed',
  })
  // Assert
  assert.equal(total, 4)
  assert.equal(ledger.resumedTotalOf('src/lib/a.ts:3'), 4)
  assert.equal(ledger.resumedTotalOf('src/lib/b.ts:9'), 1)
  assert.equal(ledger.resumedTotalOf('src/lib/none.ts:1'), 0)
  assert.deepEqual(ledger.resumedHitsOf('src/lib/a.ts:3'), [
    { reason: 'other-route', route: '/one', count: 2 },
    { reason: 'other-route', route: '/two', count: 1 },
    { reason: 'outside-data-function', count: 1 },
  ])
  assert.deepEqual(ledger.summary(), {
    taken: { frame: 0, request: 0 },
    unconfirmed: 0,
    resumed: {
      'other-route': 3,
      'outside-data-function': 1,
      'unattributed-resumed': 1,
    },
  })
})

// Value: protects=the attribution summary counts taken pauses by the evidence that proved them and unconfirmed pauses apart; fails_when=a request-proven pause counts as frame evidence or an unconfirmed pause counts as taken; no_claim=none beyond protects
test('the ledger summary keeps frame evidence, request evidence and unconfirmed pauses apart', () => {
  // Arrange
  const ledger = new PagesHitLedger()
  // Act
  ledger.recordTaken('frame')
  ledger.recordTaken('frame')
  ledger.recordTaken('request')
  ledger.recordUnconfirmed()
  // Assert
  assert.deepEqual(ledger.summary(), {
    taken: { frame: 2, request: 1 },
    unconfirmed: 1,
    resumed: {},
  })
})

/** The run's application origin in the tests below. */
const APPLICATION_ORIGIN = 'http://localhost:3000'

/** The request list of a run whose application origin is {@link APPLICATION_ORIGIN}. @example outstandingRequestsOfApplication() */
function outstandingRequestsOfApplication(): OutstandingPageRequests {
  return new OutstandingPageRequests((origin) => origin === APPLICATION_ORIGIN)
}

// Value: protects=the outstanding page requests: a document request and a Next data request of the application's main frame are kept until they are answered, failed or finished, and images, scripts and API calls are no page request; fails_when=a script request makes the browser look busy, an answered request stays, or a redirect of the same request is kept twice; no_claim=the Network events js-debug forwards
test('the outstanding page requests keep document and data requests until they end and ignore other requests', () => {
  // Arrange
  const requests = outstandingRequestsOfApplication()
  // Act
  requests.start({
    requestId: '1',
    frameId: 'main',
    request: { url: 'http://localhost:3000/' },
    type: 'Document',
  })
  requests.start({
    requestId: '2',
    frameId: 'main',
    request: { url: 'http://localhost:3000/_next/data/b/index.json?page=2' },
    type: 'Fetch',
  })
  requests.start({
    requestId: '3',
    frameId: 'main',
    request: { url: 'http://localhost:3000/_next/static/chunks/main.js' },
    type: 'Script',
  })
  requests.start({
    requestId: '1',
    frameId: 'main',
    request: { url: 'http://localhost:3000/login' },
    type: 'Document',
  })
  requests.finish('2')
  // Assert
  assert.deepEqual(requests.list(), [
    { url: 'http://localhost:3000/login', resourceType: 'Document' },
  ])
})

// Value: protects=only the application's own page requests count (Codex finding, Blocks: yes): a Document request to another site, a data-shaped request to another site, and a request to another port of the same host are no page request of the run, so a page of another origin never backs or contradicts the page a hit renders; fails_when=requests are judged by their pathname only, so `https://external.example/` is taken for the entry route `/`; no_claim=which names the run treats as its application origin (the run tests)
test('a page request to another origin than the run application is not kept', () => {
  // Arrange
  const requests = outstandingRequestsOfApplication()
  // Act
  requests.start({
    requestId: '1',
    frameId: 'main',
    request: { url: 'https://external.example/' },
    type: 'Document',
  })
  requests.start({
    requestId: '2',
    frameId: 'main',
    request: { url: 'https://external.example/_next/data/b/index.json' },
    type: 'Fetch',
  })
  requests.start({
    requestId: '3',
    frameId: 'main',
    request: { url: 'http://localhost:4000/' },
    type: 'Document',
  })
  // Assert
  assert.deepEqual(requests.list(), [])
})

// Value: protects=a redirect that leaves the application drops the request: the same request id that first asked the application's page and then follows a redirect to another site is no longer an outstanding page request of the application; fails_when=the first address stays after the redirect moved the request to another origin; no_claim=a redirect inside the application (the first test keeps the latest address)
test('a request that is redirected to another origin is no longer kept', () => {
  // Arrange
  const requests = outstandingRequestsOfApplication()
  requests.start({
    requestId: '1',
    frameId: 'main',
    request: { url: 'http://localhost:3000/login' },
    type: 'Document',
  })
  // Act
  requests.start({
    requestId: '1',
    frameId: 'main',
    request: { url: 'https://accounts.example/sign-in' },
    type: 'Document',
  })
  // Assert
  assert.deepEqual(requests.list(), [])
})

// Value: protects=only the page's main frame counts (Codex finding, Blocks: yes): the document of an iframe the page embeds, announced by Page.frameAttached, and a data request that the iframe makes are no page request, even to the application's own origin; fails_when=requests of a child frame are kept, so an embedded page of the application backs or contradicts the page the entry load renders; no_claim=an iframe in another process (its events do not reach this channel)
test('a document or data request of an iframe is not kept', () => {
  // Arrange
  const requests = outstandingRequestsOfApplication()
  requests.noteChildFrame('child-1')
  // Act
  requests.start({
    requestId: '1',
    frameId: 'child-1',
    request: { url: 'http://localhost:3000/embedded' },
    type: 'Document',
  })
  requests.start({
    requestId: '2',
    frameId: 'child-1',
    request: { url: 'http://localhost:3000/_next/data/b/embedded.json' },
    type: 'Fetch',
  })
  requests.start({
    requestId: '3',
    frameId: 'main',
    request: { url: 'http://localhost:3000/products' },
    type: 'Document',
  })
  // Assert
  assert.deepEqual(requests.list(), [
    { url: 'http://localhost:3000/products', resourceType: 'Document' },
  ])
})

// Value: protects=a request with no frame is no page request: a request that a worker or the browser itself makes carries no frame id and cannot be told from the main frame's, so it is not kept; fails_when=a request without a frame id is taken for the main frame's; no_claim=a request of the main frame whose id the browser omits (not seen on the Network events of a page)
test('a request that names no frame is not kept', () => {
  // Arrange
  const requests = outstandingRequestsOfApplication()
  // Act
  requests.start({
    requestId: '1',
    request: { url: 'http://localhost:3000/' },
    type: 'Document',
  })
  // Assert
  assert.deepEqual(requests.list(), [])
})

// Value: protects=the outstanding page requests are bounded: past the limit the oldest are dropped; fails_when=a page that never answers its requests grows the list without end; no_claim=a real page's request count
test('the outstanding page requests drop the oldest past the limit', () => {
  // Arrange
  const requests = outstandingRequestsOfApplication()
  // Act
  for (let index = 0; index < PAGES_OUTSTANDING_REQUEST_LIMIT + 3; index++)
    requests.start({
      requestId: String(index),
      frameId: 'main',
      request: { url: `http://localhost:3000/page-${index}` },
      type: 'Document',
    })
  // Assert
  assert.equal(requests.list().length, PAGES_OUTSTANDING_REQUEST_LIMIT)
  assert.equal(requests.list()[0]?.url, 'http://localhost:3000/page-3')
})

// Value: protects=the readiness record opens at the send, closes once with the HTTP status or a status-free outcome and journals one entry; fails_when=a second close rewrites the first, the entry is journaled at the send, or a run that ends with the request open keeps no entry; no_claim=the launcher that sends the request
test('the readiness record opens at the send and journals one entry when it closes', () => {
  // Arrange
  const journal: Record<string, unknown>[] = []
  let clock = 10
  const record = new ReadinessEntryRecord(
    (detail) => journal.push(detail),
    () => clock++,
  )
  // Act
  const before = record.view()
  record.observer.sent()
  const open = record.view()
  record.observer.sent()
  record.observer.closed({ status: 200 })
  record.observer.closed({ outcome: 'timeout' })
  record.closeIfOpen('aborted')
  // Assert
  assert.equal(before, undefined)
  assert.deepEqual(open, { state: 'open', sentAtMs: 10 })
  assert.deepEqual(record.view(), {
    state: 'closed',
    sentAtMs: 10,
    status: 200,
  })
  assert.deepEqual(journal, [{ sentAtMs: 10, status: 200 }])
  assert.equal(record.wasSent, true)
})

// Value: protects=a readiness record still open when the run ends closes aborted and is journaled; fails_when=the journal lacks the entry of a request that never ended; no_claim=the cleanup that calls it
test('a readiness record still open at the end of the run closes aborted', () => {
  // Arrange
  const journal: Record<string, unknown>[] = []
  const record = new ReadinessEntryRecord(
    (detail) => journal.push(detail),
    () => 5,
  )
  record.observer.sent()
  // Act
  record.closeIfOpen('aborted')
  // Assert
  assert.deepEqual(journal, [{ sentAtMs: 5, outcome: 'aborted' }])
})

// Value: protects=the status-free outcome of a failed readiness request: the run's stop is aborted, a timeout error is timeout, anything else is a lost connection; fails_when=a stopped run reads as a timeout or a refused connection as a timeout; no_claim=the errors a real fetch raises beyond these names
test('a failed readiness request is classified as aborted, timeout or connection-lost', () => {
  // Arrange
  const stopped = new AbortController()
  stopped.abort()
  const running = new AbortController()
  const timeout = new Error('The operation timed out')
  timeout.name = 'TimeoutError'
  // Act, Assert
  assert.equal(readinessOutcomeOfError(timeout, stopped.signal), 'aborted')
  assert.equal(readinessOutcomeOfError(timeout, running.signal), 'timeout')
  assert.equal(
    readinessOutcomeOfError(new TypeError('fetch failed'), running.signal),
    'connection-lost',
  )
  assert.equal(
    readinessOutcomeOfError('refused', running.signal),
    'connection-lost',
  )
})

// Value: protects=the Pages not-reached wording: the entry render and the after-operation phase say the line did not run inside the entry page's data function for the request, give what to change, and name resumed hits as possibly outside the data function only when other-route or outside-data-function hits were resumed; fails_when=an unattributed-only count adds the outside sentence, or the App Router advice (module scope, a cache) appears; no_claim=the run's failure fields (the run tests)
test('the Pages not-reached message names the outside sentence only for other-route and outside-data-function hits', () => {
  // Arrange
  const base = {
    place: 'src/lib/stats.ts:3',
    phase: 'entry-render' as const,
    how: 'not-hit' as const,
    seconds: 20,
  }
  // Act
  const plain = pagesNotReachedMessage({ ...base, resumedHits: [] })
  const unattributed = pagesNotReachedMessage({
    ...base,
    resumedHits: [{ reason: 'unattributed-resumed', count: 2 }],
  })
  const outside = pagesNotReachedMessage({
    ...base,
    resumedHits: [
      { reason: 'other-route', route: '/other', count: 2 },
      { reason: 'outside-data-function', count: 1 },
    ],
  })
  // Assert
  assert.equal(
    plain,
    "The page did not reach declared stop src/lib/stats.ts:3 inside the entry page's data function (getServerSideProps or getStaticProps) for the observed request within 20 s of the entry navigation. The line did not run there for this request. Declare the stop on a line the data function runs for that request or in code it calls, or declare a browser stop for code the page component runs, then start a new run.",
  )
  assert.equal(unattributed, plain)
  assert.match(
    outside,
    /Codebook resumed 3 hit\(s\) of this line \(2 in another page's data function \(\/other\); 1 outside every data function\): the line may have run outside the entry page's data function\./,
  )
  assert.doesNotMatch(plain, /module scope|use cache|cached/)
})

// Value: protects=the 500-hit end of a Pages stop has its own wording in both phases: Codebook stopped waiting after it resumed that many hits of the line and took none inside the entry page's data function, with no claim about seconds (the run can end seconds after arming); fails_when=the hit-limit end reuses the "within 20 s of the entry navigation" or "within 20 s after it" wording, or drops the count; no_claim=the run that reaches the limit (nextPagesServerRun tests)
test('the Pages not-reached message of a stop that reached the resumed-hit limit says Codebook stopped waiting, without a seconds claim', () => {
  // Arrange
  const resumedHits = [
    { reason: 'outside-data-function' as const, count: 498 },
    { reason: 'unattributed-resumed' as const, count: 2 },
  ]
  // Act
  const entryRender = pagesNotReachedMessage({
    place: 'src/lib/stats.ts:3',
    phase: 'entry-render',
    how: 'hit-limit',
    seconds: 20,
    resumedHits,
  })
  const afterOperation = pagesNotReachedMessage({
    place: 'src/lib/stats.ts:3',
    phase: 'after-operation',
    how: 'hit-limit',
    operationIndex: 2,
    seconds: 20,
    resumedHits,
  })
  // Assert
  assert.equal(
    entryRender,
    "Codebook stopped waiting for declared stop src/lib/stats.ts:3 after it resumed 500 hits of the line during the entry load, the limit, and took none of them as a hit inside the entry page's data function (getServerSideProps or getStaticProps). Codebook resumed 498 hit(s) of this line (498 outside every data function): the line may have run outside the entry page's data function. Declare the stop on a line the data function runs for that request or in code it calls, or declare a browser stop for code the page component runs, then start a new run.",
  )
  assert.equal(
    afterOperation,
    "Codebook stopped waiting for declared stop src/lib/stats.ts:3 after it resumed 500 hits of the line after operation 2, the limit, and took none of them as a hit inside the entry page's data function (getServerSideProps or getStaticProps). Codebook resumed 498 hit(s) of this line (498 outside every data function): the line may have run outside the entry page's data function. Declare the stop on a line the data function runs for that request or in code it calls, or declare a browser stop for code the page component runs, then start a new run.",
  )
})

// Value: protects=the Pages server script address: only the (pages-dir-node) layer is a Pages server render, and the execution label of a pause reads server-render for it as for (rsc) and server-action for another server layer; fails_when=an App Router or browser layer reads as a Pages server script, or a Pages module is labelled a server action; no_claim=a script without an address
test('only the pages-dir-node layer is a Pages server script and it is labelled a server render', () => {
  // Arrange
  const pages = 'webpack-internal:///(pages-dir-node)/./src/pages/index.tsx'
  const browser =
    'webpack-internal:///(pages-dir-browser)/./src/pages/index.tsx'
  // Act, Assert
  assert.equal(isPagesServerScriptUrl(pages), true)
  assert.equal(isPagesServerScriptUrl(browser), false)
  assert.equal(isPagesServerScriptUrl(undefined), false)
  assert.equal(serverExecutionOfScriptUrl(pages), 'server-render')
  assert.equal(serverExecutionOfScriptUrl(browser), 'server-action')
})
