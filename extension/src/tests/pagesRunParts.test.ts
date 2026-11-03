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

// Value: protects=the outstanding page requests: a document request and a Next data request are kept until they are answered, failed or finished, and images, scripts and API calls are no page request; fails_when=a script request makes the browser look busy, an answered request stays, or a redirect of the same request is kept twice; no_claim=the Network events js-debug forwards
test('the outstanding page requests keep document and data requests until they end and ignore other requests', () => {
  // Arrange
  const requests = new OutstandingPageRequests()
  // Act
  requests.start({
    requestId: '1',
    request: { url: 'http://localhost:3000/' },
    type: 'Document',
  })
  requests.start({
    requestId: '2',
    request: { url: 'http://localhost:3000/_next/data/b/index.json?page=2' },
    type: 'Fetch',
  })
  requests.start({
    requestId: '3',
    request: { url: 'http://localhost:3000/_next/static/chunks/main.js' },
    type: 'Script',
  })
  requests.start({
    requestId: '1',
    request: { url: 'http://localhost:3000/login' },
    type: 'Document',
  })
  requests.finish('2')
  // Assert
  assert.deepEqual(requests.list(), [
    { url: 'http://localhost:3000/login', resourceType: 'Document' },
  ])
})

// Value: protects=the outstanding page requests are bounded: past the limit the oldest are dropped; fails_when=a page that never answers its requests grows the list without end; no_claim=a real page's request count
test('the outstanding page requests drop the oldest past the limit', () => {
  // Arrange
  const requests = new OutstandingPageRequests()
  // Act
  for (let index = 0; index < PAGES_OUTSTANDING_REQUEST_LIMIT + 3; index++)
    requests.start({
      requestId: String(index),
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
