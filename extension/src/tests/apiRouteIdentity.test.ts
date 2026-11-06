import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ACTIVE_TIMEOUT_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { apiRouteHit, apiRouteRunHarness } from './utils/apiRouteRunHarness'
import {
  publishedPause,
  sendOperation,
  sendRequest,
} from './utils/routeHandlerRunHarness'

// Value: protects=AC 1 identity: a poll sent before the click whose hit reaches the line late, and a poll of another query after the click, are resumed with their reasons and the click's own request then pauses; fails_when=a polling hit is published as the click's pause or retires the stop; no_claim=timing of the real polling
test('a late poll of the click URL and a poll of another query are resumed and the click request then pauses', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context)
  await harness.run.prepare()
  sendRequest(harness, '7', 'GET', '/api/data')
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'GET', '/api/data?clear=1')
  // Act
  apiRouteHit(harness, { apiRequest: { method: 'GET', url: '/api/data' } })
  await waitUntil(
    () => harness.server!.continues.length === 1,
    'the late poll resumed',
  )
  apiRouteHit(harness, {
    apiRequest: { method: 'GET', url: '/api/data?poll=2' },
  })
  await waitUntil(
    () => harness.server!.continues.length === 2,
    'the other-query poll resumed',
  )
  apiRouteHit(harness, {
    apiRequest: { method: 'GET', url: '/api/data?clear=1' },
  })
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      path: snapshot.apiRoute?.path,
      resumedReasons: harness.run
        .view()
        .events.filter(
          (event) => event.type === 'breakpoint.route-handler-resumed',
        )
        .map((event) => (event.detail as { reason: string }).reason),
      snapshots: harness.run.view().snapshots.length,
    },
    {
      path: '/api/data',
      resumedReasons: ['before-operation', 'other-path'],
      snapshots: 1,
    },
  )
})

// Value: protects=the stated identity limit (DX-2): when two requests of the window carry the same method and URL, the pause is attributed to the earliest one, whichever of them reached the line; fails_when=the later request is claimed, or the journal names no request start; no_claim=which of the two requests the handler really answered (Codebook cannot tell them apart by URL)
test('two requests of the window with the same method and URL are attributed to the earliest', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  const startedAtSeconds = Date.now() / 1000 + 0.05
  sendRequest(harness, '9', 'GET', '/api/data?clear=1', startedAtSeconds)
  sendRequest(harness, '10', 'GET', '/api/data?clear=1', startedAtSeconds + 0.2)
  // Act
  apiRouteHit(harness, {
    apiRequest: { method: 'GET', url: '/api/data?clear=1' },
  })
  await publishedPause(harness)
  // Assert
  const row = harness.run
    .view()
    .events.find((event) => event.type === 'route-handler.published')
  assert.equal(
    (row?.detail as { requestStartedAt: string }).requestStartedAt,
    new Date(startedAtSeconds * 1000).toISOString(),
  )
})

// Value: protects=DX-5 an API-route hit with no browser request is resumed after the bounded wait, and the run then ends SERVER_STOP_NOT_REACHED with details.apiRoute, the resumed hits and the module-scope and unclassified possibilities; fails_when=the hit is published, the failure names a route handler, or the DX-5 sentence is missing; no_claim=the 20 s bound in real time (the harness clock stands for it; the 1000 ms wait for the browser request runs in real time)
test('an API-route hit with no browser request is resumed and the run ends SERVER_STOP_NOT_REACHED naming the API route', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  // Act
  apiRouteHit(harness, {
    apiRequest: { method: 'GET', url: '/api/data?clear=1' },
  })
  await waitUntil(
    () => harness.server!.continues.length === 1,
    'the hit resumed after the wait for a browser request',
  )
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  const failure = JSON.parse(
    JSON.stringify(harness.run.view().operationFailure),
  )
  assert.deepEqual(
    {
      code: failure.code,
      phase: failure.serverRender.phase,
      stop: failure.serverRender.stop,
      apiRoute: failure.serverRender.apiRoute,
      routeHandler: failure.serverRender.routeHandler,
    },
    {
      code: 'SERVER_STOP_NOT_REACHED',
      phase: 'after-operation',
      stop: 'src/pages/api/data.ts:1',
      apiRoute: {
        route: '/api/data',
        resumedHits: [{ reason: 'no-browser-request', count: 1 }],
      },
      routeHandler: undefined,
    },
  )
  assert.match(
    harness.run.view().failures[0]!,
    /A line outside the handler \(module scope\) never pauses for a request, and unclassified hits mean Codebook did not recognise Next's apiResolver as the caller\./,
  )
})

// Value: protects=a stack Next changed (no apiResolver below the handler) is resumed as unclassified and counted, never published; fails_when=the hit is published or the run fails instead of resuming; no_claim=Next's current stack (E1 recorded it)
test("a hit in the API route file without Next's apiResolver frame is resumed as unclassified", async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'GET', '/api/data?clear=1')
  // Act
  apiRouteHit(harness, { stack: 'call' })
  await waitUntil(
    () => harness.server!.continues.length === 1,
    'the unclassified hit resumed',
  )
  // Assert
  assert.deepEqual(
    {
      reasons: harness.run
        .view()
        .events.filter(
          (event) => event.type === 'breakpoint.route-handler-resumed',
        )
        .map((event) => (event.detail as { reason: string }).reason),
      snapshots: harness.run.view().snapshots.length,
      failures: [...harness.run.view().failures],
    },
    { reasons: ['unclassified'], snapshots: 0, failures: [] },
  )
})
