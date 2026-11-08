import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiRequestTracker } from '../utils/attributeApiRequest'

const PORT = 4100
// Wall time (s) and monotonic base: window 1000 s .. 1010 s.
const WINDOW_START_MS = 1_000_000
const CUTOFF_MS = 1_010_000
const identity = (text: string) => text
const judge = (tracker: ApiRequestTracker, maskText = identity) =>
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
  url = `http://localhost:${PORT}/api/rpc/switch?page=1#x`,
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

test('exactly one open request in the window is attributed by time with its sentence', () => {
  // protects=AC4 attributed row; fails_when=a lone candidate is not attributed or the path keeps its query; no_claim=request body
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'a', 1005)
  // Act
  const fact = judge(tracker)
  // Assert
  assert.deepEqual(fact, {
    state: 'attributed',
    method: 'POST',
    path: '/api/rpc/switch',
    operation: 2,
    basis: 'time-window',
    sentence:
      'While the API paused here, the page\'s POST /api/rpc/switch, sent after operation 2 "Press", was the only request waiting for it; Codebook matched it by time and did not read it inside the API.',
  })
})

test('no candidate gives the none fact without claiming a cause', () => {
  // protects=OV-2 none row; fails_when=none names a cause; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  // Act
  const fact = judge(tracker)
  // Assert
  assert.deepEqual(fact, {
    state: 'unattributed',
    reason: 'none',
    count: 0,
    sentence:
      "Codebook observed no request from the page that started in this operation's window and was still open when the API paused, so it cannot say what made the API reach this line.",
  })
})

test('two candidates give the several fact with their count', () => {
  // protects=several row; fails_when=one of two is named; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'a', 1005)
  start(tracker, 'b', 1006)
  // Act
  const fact = judge(tracker)
  // Assert
  assert.deepEqual(fact, {
    state: 'unattributed',
    reason: 'several',
    count: 2,
    sentence:
      '2 requests from the page were waiting when the API paused here, so Codebook does not say which one reached this line.',
  })
})

test('an OPTIONS preflight is never a candidate', () => {
  // protects=preflight exclusion; fails_when=OPTIONS makes several; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'p', 1005, undefined, 'OPTIONS')
  start(tracker, 'a', 1005.1)
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state, 'attributed')
})

test('requests to another origin or port are ignored', () => {
  // protects=origin filter; fails_when=a foreign request counts; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'a', 1005, 'http://example.test:4100/x')
  start(tracker, 'b', 1005, 'http://localhost:4101/x')
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state === 'unattributed' && fact.reason, 'none')
})

test('a request that started before the window or after the cutoff never counts, and the window start is inclusive', () => {
  // protects=window bounds; fails_when=an in-flight session read or a post-pause request counts, or the start is exclusive; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'before', 999.999)
  start(tracker, 'after', 1010.001)
  start(tracker, 'edge', 1000)
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state, 'attributed')
})

test('a request that ended before the cutoff is excluded, and a failed one ends too', () => {
  // protects=lifetimes by own timestamps; fails_when=a finished or failed request still waits; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'done', 1002)
  tracker.requestEnded({ requestId: 'done', timestamp: 1003 - 900 })
  start(tracker, 'failed', 1002)
  tracker.requestEnded({ requestId: 'failed', timestamp: 1004 - 900 })
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state === 'unattributed' && fact.reason, 'none')
})

test('a request with no end or an end after the cutoff is counted', () => {
  // protects=open requests wait; fails_when=a later end drops the candidate; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'open', 1002)
  start(tracker, 'late', 1003)
  tracker.requestEnded({ requestId: 'late', timestamp: 1011 - 900 })
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state === 'unattributed' && fact.count, 2)
})

test('an end delivered before its start still excludes a request that ended before the cutoff', () => {
  // protects=OV-1 order independence; fails_when=early end is lost; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  tracker.requestEnded({ requestId: 'a', timestamp: 1003 - 900 })
  start(tracker, 'a', 1002)
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state === 'unattributed' && fact.reason, 'none')
})

test('an end delivered after the cutoff but stamped earlier still excludes the request', () => {
  // protects=OV-1 late delivery; fails_when=receipt order keeps a finished request a candidate; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'a', 1002)
  judge(tracker) // the pause is judged once before the late end arrives
  tracker.requestEnded({ requestId: 'a', timestamp: 1005 - 900 })
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state === 'unattributed' && fact.reason, 'none')
})

test('a redirected request counts once with its last URL', () => {
  // protects=redirect rule; fails_when=a redirect counts twice or keeps the first URL; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'a', 1005, `http://localhost:${PORT}/old`)
  start(tracker, 'a', 1005.01, `http://localhost:${PORT}/new?x=1`, 'GET', {})
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state === 'attributed' && fact.path, '/new')
  assert.equal(fact.state === 'attributed' && fact.method, 'GET')
})

test('127.0.0.1 and [::1] origins are tracked', () => {
  // protects=D29 loopback spellings; fails_when=either spelling is ignored; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'a', 1005, `http://127.0.0.1:${PORT}/a`)
  start(tracker, 'b', 1006, `http://[::1]:${PORT}/b`)
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state === 'unattributed' && fact.count, 2)
})

test('the mask is applied to the path in the fact and the sentence', () => {
  // protects=redaction; fails_when=a raw path leaks; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'a', 1005, `http://localhost:${PORT}/users/secret-id`)
  // Act
  const fact = judge(tracker, (text) => text.replace('secret-id', '[masked]'))
  // Assert
  assert.equal(fact.state === 'attributed' && fact.path, '/users/[masked]')
  assert.match(fact.sentence, /POST \/users\/\[masked\],/)
})

test('the tracker keeps at most its limit, dropping the oldest finished request first', () => {
  // protects=bounded memory; fails_when=an open request is dropped before a finished one; no_claim=none
  // Arrange
  const tracker = new ApiRequestTracker(PORT, 2)
  start(tracker, 'finished', 1001)
  tracker.requestEnded({ requestId: 'finished', timestamp: 1011 - 900 })
  start(tracker, 'open1', 1002)
  start(tracker, 'open2', 1003)
  // Act
  const fact = judge(tracker)
  // Assert
  assert.equal(fact.state === 'unattributed' && fact.count, 2)
})

test('a 3000-character path is cut to the 2048-character limit with an ellipsis, in the fact and the sentence', () => {
  // protects=R2 a long API path keeps the saved study valid; fails_when=the path is longer than 2048 or the sentence names another path; no_claim=masking
  // Arrange
  const tracker = new ApiRequestTracker(PORT)
  start(tracker, 'a', 1005, `http://localhost:${PORT}/${'a'.repeat(2999)}`)
  // Act
  const fact = judge(tracker)
  // Assert
  const expectedPath = `/${'a'.repeat(2046)}…`
  assert.equal(fact.state === 'attributed' && fact.path, expectedPath)
  assert.equal(fact.state === 'attributed' && fact.path.length, 2048)
  assert.match(fact.sentence, new RegExp(`POST ${expectedPath},`))
})
