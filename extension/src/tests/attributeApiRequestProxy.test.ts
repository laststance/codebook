import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiRequestTracker } from '../utils/attributeApiRequest'

const PORT = 4100
const DEV_PORT = 5173
const WINDOW_START_MS = 1_000_000
const CUTOFF_MS = 1_010_000
const judge = (tracker: ApiRequestTracker, maskText = (text: string) => text) =>
  tracker.attribute({
    windowStartWallMs: WINDOW_START_MS,
    cutoffWallMs: CUTOFF_MS,
    operation: 2,
    title: 'Press',
    maskText,
  })
const start = (
  tracker: ApiRequestTracker,
  requestId: string,
  wallSeconds: number,
  url: string,
  method = 'POST',
  redirectResponse?: unknown,
): void =>
  tracker.requestWillBeSent({
    requestId,
    timestamp: wallSeconds - 900,
    wallTime: wallSeconds,
    request: { method, url },
    redirectResponse,
  })
const apiUrl = (path: string) => `http://localhost:${PORT}${path}`
const devUrl = (path: string) => `http://localhost:${DEV_PORT}${path}`
const proxyTracker = (proxyPaths: string[] = ['/api']) => {
  const tracker = new ApiRequestTracker(PORT, { proxyPaths })
  tracker.bindDevServerPort(DEV_PORT)
  return tracker
}

// Value: protects=proxied attribution; fails_when=a request to the dev server under a declared prefix is unattributed or loses its prefix; no_claim=Vite's real proxy
test('a request to the dev-server origin under a declared prefix is attributed with route dev-server-proxy and the page path', () => {
  // Arrange
  const tracker = proxyTracker()
  start(tracker, 'a', 1005, devUrl('/api/stocks?page=1#x'), 'GET')
  // Act
  const fact = judge(tracker)
  // Assert
  assert.deepEqual(fact, {
    state: 'attributed',
    method: 'GET',
    path: '/api/stocks',
    operation: 2,
    basis: 'time-window',
    sentence:
      'While the API paused here, the page\'s GET /api/stocks, sent to the dev server after operation 2 "Press" under /api, which apiServer.proxyPaths declares as forwarded to the API, was the only request waiting for it; Codebook matched it by time and did not observe the forward or read the request inside the API.',
    route: 'dev-server-proxy',
    proxyPath: '/api',
  })
})

// Value: protects=slash boundary rule; fails_when=a prefix matches by plain string prefix; no_claim=none
test('/api/x continues the prefix at a slash boundary and /apiculture does not', () => {
  // Arrange
  const continues = proxyTracker()
  start(continues, 'a', 1005, devUrl('/api/x'))
  const equals = proxyTracker()
  start(equals, 'a', 1005, devUrl('/api'))
  const lookalike = proxyTracker()
  start(lookalike, 'a', 1005, devUrl('/apiculture'))
  // Act
  const states = [continues, equals, lookalike].map(
    (tracker) => judge(tracker).state,
  )
  // Assert
  assert.deepEqual(states, ['attributed', 'attributed', 'unattributed'])
})

// Value: protects=candidate set in proxy mode; fails_when=another port, origin, scheme, a preflight or an out-of-window request counts; no_claim=none
test('another port, another origin, an OPTIONS preflight and a request outside the window are not candidates in proxy mode', () => {
  // Arrange
  const tracker = proxyTracker()
  start(tracker, 'port', 1005, 'http://localhost:5999/api/x')
  start(tracker, 'origin', 1005, 'http://example.test:5173/api/x')
  start(tracker, 'https', 1005, 'https://localhost:5173/api/x')
  start(tracker, 'options', 1005, devUrl('/api/x'), 'OPTIONS')
  start(tracker, 'early', 999, devUrl('/api/x'))
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state === 'unattributed' && fact.reason, 'none')
})

// Value: protects=several counts both routes; fails_when=a proxied request is not counted beside an API-origin one; no_claim=none
test('a proxied and an API-origin request open together make the pause several', () => {
  // Arrange
  const tracker = proxyTracker()
  start(tracker, 'proxied', 1005, devUrl('/api/a'))
  start(tracker, 'direct', 1006, apiUrl('/rpc'))
  // Act
  const fact = judge(tracker)
  // Assert
  assert.deepEqual(fact.state === 'unattributed' && [fact.reason, fact.count], [
    'several',
    2,
  ])
})

// Value: protects=binding order; fails_when=a dev-server request before binding is a candidate or one after it is not; no_claim=run wiring
test('a dev-server request before bindDevServerPort is never a candidate; after binding it is', () => {
  // Arrange
  const tracker = new ApiRequestTracker(PORT, { proxyPaths: ['/api'] })
  start(tracker, 'before', 1005, devUrl('/api/x'))
  const beforeBinding = judge(tracker).state
  tracker.bindDevServerPort(DEV_PORT)
  start(tracker, 'after', 1006, devUrl('/api/y'))
  // Act
  const afterBinding = judge(tracker)
  // Assert
  assert.equal(beforeBinding, 'unattributed')
  assert.equal(
    afterBinding.state === 'attributed' && afterBinding.path,
    '/api/y',
  )
})

// Value: protects=redirect-hop row for a proxied candidate; fails_when=a hop that left the dev server still counts open; no_claim=none
test('a proxied request redirected away before the cutoff is not a candidate', () => {
  // Arrange
  const tracker = proxyTracker()
  start(tracker, 'r', 1002, devUrl('/api/x'))
  start(tracker, 'r', 1004, 'http://example.test/login', 'GET', {})
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state === 'unattributed' && fact.reason, 'none')
})

// Value: protects=eviction row for a proxied candidate; fails_when=an in-window proxied request dropped at the limit leaves a false attribution; no_claim=none
test('a proxied request dropped at the limit makes a lone remaining candidate several', () => {
  // Arrange
  const tracker = new ApiRequestTracker(PORT, { proxyPaths: ['/api'] }, 1)
  tracker.bindDevServerPort(DEV_PORT)
  start(tracker, 'dropped', 1002, devUrl('/api/a'))
  start(tracker, 'kept', 1003, devUrl('/api/b'))
  // Act
  const fact = judge(tracker)
  // Assert
  assert.deepEqual(fact.state === 'unattributed' && [fact.reason, fact.count], [
    'several',
    2,
  ])
})

// Value: protects=early-end row for a proxied candidate; fails_when=an end that arrived before its start leaves the proxied request open; no_claim=none
test('an end that arrived before the start of a proxied request closes it', () => {
  // Arrange
  const tracker = proxyTracker()
  tracker.requestEnded({ requestId: 'p', timestamp: 1003 - 900 })
  start(tracker, 'p', 1002, devUrl('/api/x'))
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state === 'unattributed' && fact.reason, 'none')
})

// Value: protects=proxy-aware vs Expo facts; fails_when=an Expo fact gains a field or a proxy-aware fact lacks route/watched; no_claim=none
test('a proxy-aware run with no prefix emits route api-origin and watched without devServerPort; an Expo tracker emits neither', () => {
  // Arrange
  const aware = new ApiRequestTracker(PORT, { proxyPaths: [] })
  aware.bindDevServerPort(DEV_PORT)
  const awareNone = judge(aware)
  start(aware, 'a', 1005, apiUrl('/rpc'))
  const awareAttributed = judge(aware)
  const expo = new ApiRequestTracker(PORT)
  const expoNone = judge(expo)
  start(expo, 'a', 1005, apiUrl('/rpc'))
  const expoAttributed = judge(expo)
  // Act
  const keys = [awareNone, awareAttributed, expoNone, expoAttributed].map(
    (fact) => Object.keys(fact),
  )
  // Assert
  assert.deepEqual(keys, [
    ['state', 'reason', 'count', 'sentence', 'watched'],
    ['state', 'method', 'path', 'operation', 'basis', 'sentence', 'route'],
    ['state', 'reason', 'count', 'sentence'],
    ['state', 'method', 'path', 'operation', 'basis', 'sentence'],
  ])
  assert.deepEqual(awareNone.state === 'unattributed' && awareNone.watched, {
    apiPort: 4100,
    proxyPaths: [],
  })
  assert.equal(
    awareAttributed.state === 'attributed' && awareAttributed.route,
    'api-origin',
  )
})

// Value: protects=none sentence; fails_when=the sentence does not name what is watched; no_claim=none
test('the none sentence names what it watches', () => {
  // Arrange
  const tracker = proxyTracker(['/api'])
  // Act
  const fact = judge(tracker)
  // Assert
  assert.deepEqual(fact, {
    state: 'unattributed',
    reason: 'none',
    count: 0,
    sentence:
      "Among the requests it watches (the API on port 4100 and the dev server on port 5173 under /api), Codebook observed none from the page that started in this operation's window and was still open when the API paused, so it cannot say what made the API reach this line.",
    watched: { apiPort: 4100, devServerPort: 5173, proxyPaths: ['/api'] },
  })
})

// Value: protects=declared-relation wording; fails_when=the sentence claims an observed forward; no_claim=none
test('the proxied attributed sentence says declared relation, matched by time, forward not observed', () => {
  // Arrange
  const tracker = proxyTracker(['/api', '/v2'])
  start(tracker, 'a', 1005, devUrl('/v2/items'), 'POST')
  // Act
  const fact = judge(tracker)
  // Assert
  assert.match(
    fact.sentence,
    /under \/v2, which apiServer\.proxyPaths declares as forwarded to the API.*matched it by time and did not observe the forward/,
  )
})

// Value: protects=masked path; fails_when=masking a prefix-equal env value stops the attribution; no_claim=format 20 storage
test('a prefix equal to a masked env value still attributes and stores the masked path', () => {
  // Arrange
  const tracker = proxyTracker(['/secretprefix'])
  start(tracker, 'a', 1005, devUrl('/secretprefix/x'))
  // Act
  const fact = judge(tracker, (text) => text.replace('secretprefix', '***'))
  // Assert
  assert.equal(fact.state === 'attributed' && fact.path, '/***/x')
  assert.equal(fact.state === 'attributed' && fact.proxyPath, '/secretprefix')
})
