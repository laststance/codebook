import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  routeHandlerHitVerdictOf,
  type RouteHandlerBrowserRequest,
} from '../utils/routeHandlerHitVerdictOf'
import { RouteHandlerRequests } from '../utils/routeHandlerRequests'

/** The click's request: GET with the clear query, sent after operation 1. */
const CLICK_REQUEST: RouteHandlerBrowserRequest = {
  id: '9',
  method: 'GET',
  pathname: '/api/data',
  target: '/api/data?clear=1',
  window: 1,
  claimed: false,
}

/** The verdict input of an API-route stop after operation 1 whose handler holds a GET with the clear query. */
const BASE = {
  stopRoute: '/api/data',
  hitRoute: undefined,
  handlerName: '__WEBPACK_DEFAULT_EXPORT__',
  operationIndex: 1,
  kind: 'pages-api' as const,
  hitRequest: { method: 'GET', target: '/api/data?clear=1' },
  requests: [CLICK_REQUEST],
}

// Value: protects=E-2 a hit whose request has the click's method and target is published with that request; fails_when=a matching hit is resumed, or the verdict names another request; no_claim=a request body or headers (never read)
test('an API-route hit with the click request method and target is published with that request', () => {
  // Arrange
  const input = BASE
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'publish', request: CLICK_REQUEST })
})

// Value: protects=E-2 polling (same route and method, another query) is not the click's pause; fails_when=a hit of another target is published because the route and method match; no_claim=which polling request it was
test('an API-route hit of another query is resumed as other-path', () => {
  // Arrange
  const input = { ...BASE, hitRequest: { method: 'GET', target: '/api/data' } }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'other-path' })
})

// Value: protects=E-2 a same-target request of another method in the window is named other-method, not published or labelled other-path; fails_when=a hit GET is published against a window POST of the same target, or the reason reads other-path; why_new=no pages-api verdict test asserted other-method; seam=none; no_claim=which method the handler really served
test('an API-route hit of another method for the same target is resumed as other-method', () => {
  // Arrange
  const input = {
    ...BASE,
    hitRequest: { method: 'GET', target: '/api/data' },
    requests: [
      {
        ...CLICK_REQUEST,
        method: 'POST',
        target: '/api/data',
      },
    ],
  }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'other-method' })
})

// Value: protects=E-2 a request that started before the operation and reaches the line late is not attributed to it; fails_when=a before-click request is published as the click's pause; no_claim=the wait for a later event
test('an API-route hit whose only matching request started before the operation is resumed as before-operation', () => {
  // Arrange
  const input = {
    ...BASE,
    requests: [{ ...CLICK_REQUEST, id: '3', window: 0 }],
  }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'before-operation' })
})

// Value: protects=DX-2 the stated limit: with two same-URL requests in the window the earliest unclaimed one is attributed, and once it is claimed the next hit takes the later one; fails_when=the later request is taken first or a claimed request is attributed again; no_claim=which request the handler really answered
test('an API-route hit with two same-URL requests takes the earliest unclaimed, then the later', () => {
  // Arrange
  const later = { ...CLICK_REQUEST, id: '10' }
  const first = routeHandlerHitVerdictOf({
    ...BASE,
    requests: [CLICK_REQUEST, later],
  })
  // Act
  const second = routeHandlerHitVerdictOf({
    ...BASE,
    requests: [{ ...CLICK_REQUEST, claimed: true }, later],
  })
  const retired = routeHandlerHitVerdictOf({
    ...BASE,
    requests: [{ ...CLICK_REQUEST, claimed: true }],
  })
  // Assert
  assert.deepEqual(
    [first, second, retired],
    [
      { action: 'publish', request: CLICK_REQUEST },
      { action: 'publish', request: later },
      { action: 'resume', reason: 'after-retired' },
    ],
  )
})

// Value: protects=E-3 a request the page sent before the click whose event is delivered after the click was dispatched stays in the window before the operation, while an event without wallTime keeps receipt order; fails_when=a late-delivered before-click request counts as sent after the operation, or receipt order is lost without wallTime; no_claim=clock skew between the browser and Codebook (one machine)
test('a request event delivered after the click keeps the window its own wallTime says, and one without wallTime keeps receipt order', () => {
  // Arrange
  const tracker = new RouteHandlerRequests(['/api/data'])
  const clickSentAtMs = 1_700_000_000_000
  tracker.noteDispatch(1, clickSentAtMs)
  // Act: both events are received after operation 1 was dispatched (receipt window 1)
  tracker.start(
    {
      requestId: 'a',
      method: 'GET',
      url: 'http://localhost:3000/api/data',
      wallTime: (clickSentAtMs - 40) / 1000,
    },
    1,
    10,
  )
  tracker.start(
    {
      requestId: 'b',
      method: 'GET',
      url: 'http://localhost:3000/api/data?clear=1',
      wallTime: (clickSentAtMs + 40) / 1000,
    },
    1,
    11,
  )
  tracker.start(
    {
      requestId: 'c',
      method: 'GET',
      url: 'http://localhost:3000/api/data?x=1',
    },
    1,
    12,
  )
  // Assert
  assert.deepEqual(
    tracker.list().map((request) => [request.id, request.window]),
    [
      ['a', 0],
      ['b', 1],
      ['c', 1],
    ],
  )
})

// Value: protects=review round: a request whose event carries wallTime, received after an operation whose send time was never noted, keeps the window of receipt order, while a noted later operation still bounds it; fails_when=a missing send time places the request before every operation, so the click's own request is resumed as before-operation; no_claim=why a send time would be missing (the run notes every dispatch)
test('a request with wallTime keeps receipt order for an operation whose send time was not noted', () => {
  // Arrange
  const tracker = new RouteHandlerRequests(['/api/data'])
  const secondSentAtMs = 1_700_000_000_000
  tracker.noteDispatch(2, secondSentAtMs)
  // Act: operation 1's send time is unknown; one event was sent before operation 2, one after it
  tracker.start(
    {
      requestId: 'a',
      method: 'GET',
      url: 'http://localhost:3000/api/data?clear=1',
      wallTime: (secondSentAtMs - 40) / 1000,
    },
    2,
    10,
  )
  tracker.start(
    {
      requestId: 'b',
      method: 'GET',
      url: 'http://localhost:3000/api/data?clear=1',
      wallTime: (secondSentAtMs + 40) / 1000,
    },
    2,
    11,
  )
  // Assert
  assert.deepEqual(
    tracker.list().map((request) => [request.id, request.window]),
    [
      ['a', 1],
      ['b', 2],
    ],
  )
})

// Value: protects=E-3 the tracker keeps the target (path and query) of each request for the API-route match; fails_when=the query is dropped so every poll looks like the click; no_claim=other origins (the isApplicationOrigin tests)
test('the request tracker keeps the target with its query', () => {
  // Arrange
  const tracker = new RouteHandlerRequests(['/api/data'])
  // Act
  tracker.start(
    {
      requestId: 'a',
      method: 'get',
      url: 'http://localhost:3000/api/data?clear=1',
    },
    1,
    5,
  )
  // Assert
  assert.deepEqual(
    tracker.list().map((request) => [request.pathname, request.target]),
    [['/api/data', '/api/data?clear=1']],
  )
})

// Value: protects=E-2 a redirect hop that changes only the query is its own tracked entry, an exact repeat is not; fails_when=the second hop is dropped because the pathname matches, so a pause in the redirected request is resumed as other-path; why_new=Cycle 0088 pass 1 finding, the hop dedupe compared the pathname only; seam=none; no_claim=App Router route-handler claiming (the routeHandler tests)
test('a redirect hop that differs only in query is kept as its own request and an exact repeat is dropped', () => {
  // Arrange
  const tracker = new RouteHandlerRequests(['/api/data'])
  const hop = (stage: number) => ({
    requestId: 'r',
    method: 'GET',
    url: `http://localhost:3000/api/data?stage=${stage}`,
  })
  // Act
  tracker.start(hop(1), 1, 5)
  tracker.start(hop(2), 1, 6)
  tracker.start(hop(2), 1, 7)
  // Assert
  assert.deepEqual(
    tracker.list().map((request) => [request.id, request.target]),
    [
      ['r', '/api/data?stage=1'],
      ['r GET /api/data?stage=2', '/api/data?stage=2'],
    ],
  )
})

// Value: protects=E-2 an API-route pause in the redirected request (query-only hop) is published with that hop; fails_when=the hop is missing from the list and the hit is resumed as other-path, ending the run SERVER_STOP_NOT_REACHED; why_new=Cycle 0088 pass 1 finding; seam=none; no_claim=redirect hops that change the pathname (existing coverage)
test('an API-route hit in the query-only redirect hop is published with that hop', () => {
  // Arrange
  const tracker = new RouteHandlerRequests(['/api/data'])
  for (const stage of [1, 2]) {
    tracker.start(
      {
        requestId: 'r',
        method: 'GET',
        url: `http://localhost:3000/api/data?stage=${stage}`,
      },
      1,
      5,
    )
  }
  const requests = tracker.list().map((request) => ({
    id: request.id,
    method: request.method,
    pathname: request.pathname,
    target: request.target,
    window: request.window,
    claimed: false,
  }))
  // Act
  const verdict = routeHandlerHitVerdictOf({
    ...BASE,
    hitRequest: { method: 'GET', target: '/api/data?stage=2' },
    requests,
  })
  // Assert
  assert.deepEqual(verdict, { action: 'publish', request: requests[1] })
})
