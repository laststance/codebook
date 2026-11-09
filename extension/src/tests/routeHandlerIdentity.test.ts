import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ACTIVE_TIMEOUT_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  ADD,
  publishedPause,
  routeHandlerHit,
  routeHandlerRunHarness,
  sendOperation,
  sendRequest,
} from './utils/routeHandlerRunHarness'

// Value: protects=R2/AC 1 the stop is armed by source just before its own operation, so the entry load's and an earlier operation's requests never pause it; fails_when=the breakpoint is registered before operation 2 (at the start or before operation 1); no_claim=js-debug's binding of a pending breakpoint
test('a route-handler stop is armed only just before its own operation', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context, {
    stopOperations: [2],
    operations: [ADD, { ...ADD, title: 'Add again' }],
  })
  await harness.run.prepare()
  const armedAfterStart = harness.server!.breakpointsAcknowledged()
  await sendOperation(harness, 1)
  await waitUntil(
    () => harness.run.view().status === 'ready',
    'operation 1 done',
  )
  const armedAfterOperation1 = harness.server!.breakpointsAcknowledged()
  // Act
  await sendOperation(harness, 2)
  // Assert
  assert.deepEqual(
    {
      afterStart: armedAfterStart,
      afterOperation1: armedAfterOperation1,
      afterOperation2: harness.server!.breakpointsAcknowledged() > 0,
      armed: harness.run
        .view()
        .events.filter((event) => event.type === 'route-handler.armed')
        .map((event) => ({ ...(event.detail as object) })),
    },
    {
      afterStart: 0,
      afterOperation1: 0,
      afterOperation2: true,
      armed: [
        {
          declaredIndex: 0,
          operationIndex: 2,
          route: '/api/todos',
          requestedLine: 1,
        },
      ],
    },
  )
})

// Value: protects=R2/native C86-1 a run that declares a route-handler stop attaches the server with pauseForSourceMap so the route's breakpoint binds before its first compile runs; fails_when=the route run attaches without it; no_claim=js-debug's own pause timing, and that the route-handler clause alone decides it (a route-handler stop is always afterOperation 1 or more, so the after-operation rule also holds)
test('a route-handler run attaches the server debugger with pauseForSourceMap', async (context) => {
  // Arrange
  const route = await routeHandlerRunHarness(context)
  // Act
  await route.run.prepare()
  // Assert
  assert.deepEqual(
    route.serverLaunches.map((config) => config.pauseForSourceMap),
    [true],
  )
})

// Value: protects=identity contract a hit of another method (the page's polling GET) is resumed and journaled, never published, and the stop stays armed for its own request; fails_when=the GET is published as the POST stop's pause or the stop is retired by it; no_claim=timing of the real polling
test('a GET handler hit while only a POST was sent is resumed and the POST then pauses', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'POST', '/api/todos')
  // Act
  routeHandlerHit(harness, { handlerName: 'GET' })
  await waitUntil(
    () => harness.server!.continues.length === 1,
    'the GET hit resumed',
  )
  routeHandlerHit(harness, { handlerName: 'POST' })
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      method: snapshot.routeHandler?.method,
      resumed: harness.run
        .view()
        .events.filter(
          (event) => event.type === 'breakpoint.route-handler-resumed',
        )
        .map((event) => (event.detail as { reason: string }).reason),
      snapshots: harness.run.view().snapshots.length,
    },
    { method: 'POST', resumed: ['other-method'], snapshots: 1 },
  )
})

// Value: protects=native C87-2 a hit the run resumes (here the polling GET) that names the stop's own breakpoint id, as js-debug's stopped event always does, is resumed and the POST then pauses; fails_when=the stop's own id counts as a learner's breakpoint, the hit is left to the ordinary handling and the run fails "Unexpected or additional server stop"; no_claim=real js-debug numbering (the harness adapter numbers the stop's breakpoint)
test("a GET handler hit naming the stop's own breakpoint id is resumed and the POST then pauses", async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'POST', '/api/todos')
  // Act
  routeHandlerHit(harness, {
    handlerName: 'GET',
    hitBreakpoints: ['owned-breakpoint'],
  })
  await waitUntil(
    () =>
      harness.server!.continues.length === 1 ||
      harness.run.view().failures.length > 0,
    'the GET hit resumed or the run failed',
  )
  routeHandlerHit(harness, {
    handlerName: 'POST',
    hitBreakpoints: ['owned-breakpoint'],
  })
  const snapshot = await waitUntil(
    () =>
      harness.run.view().participants.server?.snapshot ??
      (harness.run.view().failures.length > 0 ? 'failed' : undefined),
    'the POST pause or a failure',
  )
  // Assert
  assert.deepEqual(
    {
      method:
        typeof snapshot === 'string' ? snapshot : snapshot.routeHandler?.method,
      resumed: harness.run
        .view()
        .events.filter(
          (event) => event.type === 'breakpoint.route-handler-resumed',
        )
        .map((event) => (event.detail as { reason: string }).reason),
      failures: [...harness.run.view().failures],
    },
    { method: 'POST', resumed: ['other-method'], failures: [] },
  )
})

// Value: protects=identity contract a hit with no browser request (the server fetching its own API) is resumed after the bounded wait, counted per reason, and the run then ends SERVER_STOP_NOT_REACHED with details.routeHandler and the resumed hits; fails_when=the hit is published, or the failure lacks the route, the reason or the count; no_claim=the 20 s not-reached bound in real time (the harness clock stands for it; the 1000 ms wait for the browser request runs in real time)
test('a route-handler hit with no browser request is resumed and the run ends SERVER_STOP_NOT_REACHED naming the route and the resumed hit', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  // Act
  routeHandlerHit(harness)
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
      routeHandler: failure.serverRender.routeHandler,
      operationIndex: failure.operationIndex,
      sent: failure.sent,
    },
    {
      code: 'SERVER_STOP_NOT_REACHED',
      phase: 'after-operation',
      stop: 'app/api/todos/route.ts:1',
      routeHandler: {
        route: '/api/todos',
        resumedHits: [{ reason: 'no-browser-request', count: 1 }],
      },
      operationIndex: 1,
      sent: 'sent',
    },
  )
})

// Value: protects=OV-E4 the server's pause and the page's Network event come on different connections: a pause that arrives first waits (bounded) for the request and then publishes; fails_when=the hit is resumed as no-browser-request before the request is seen; no_claim=the real order of the two connections
test('a route-handler pause that arrives before the browser request waits for it and then publishes', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  // Act
  routeHandlerHit(harness)
  // gstack-timing-ok: the order is the contract; 150 ms only lets the pause reach the run before the request, a slower run sees the request first and still publishes, and the run's wait bound is 1000 ms
  await new Promise((resolve) => setTimeout(resolve, 150))
  sendRequest(harness, '9', 'POST', '/api/todos')
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    [snapshot.routeHandler?.method, harness.server!.continues.length],
    ['POST', 0],
  )
})

// Value: protects=OV-E2 an aliased handler (export { handle as POST }) is accepted: the method is the browser request's; fails_when=the frame name handle is taken for the method and the hit is resumed; no_claim=that the alias is exported under the method it serves
test('a route-handler hit in an aliased handler publishes with the method of the browser request', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'POST', '/api/todos')
  // Act
  routeHandlerHit(harness, { handlerName: 'handle' })
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    { ...snapshot.routeHandler },
    { method: 'POST', route: '/api/todos', path: '/api/todos' },
  )
})

// Value: protects=F1 a stack Next changed (no AppRouteRouteModule.do above the handler) is resumed as unclassified and counted, never published; fails_when=the hit is published or the run fails instead of resuming; no_claim=Next's current stack (E1 recorded it)
test("a hit in the route file without Next's route-module frames is resumed as unclassified", async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'POST', '/api/todos')
  // Act
  routeHandlerHit(harness, { stack: 'call' })
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

// Value: protects=F4/R5 a seal mismatch at the pause resumes the runtime, shows nothing and ends the run with the seal's refusal; fails_when=values are shown from bytes that are not the declared source; no_claim=the wording of the refusal (seal suites)
test('a route-handler pause whose module differs from the declared source resumes and fails the run without a snapshot', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'POST', '/api/todos')
  const server = harness.server!
  // Act
  server.setScriptText(
    'server',
    server.instanceText(';AAAA', server.sealedUrl, true),
  )
  server.hit({
    stack: 'route-handler',
    generated: { line: 1, column: 0 },
  })
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  assert.deepEqual(
    [
      harness.run.view().snapshots.length,
      harness.server!.continues.length,
      harness.run.view().failures.length > 0,
    ],
    [0, 1, true],
  )
})

// Value: protects=FX-G3 a hit that names a learner's breakpoint beside the stop's is not resumed by Codebook; fails_when=the hit is resumed as no-browser-request and the learner's breakpoint is skipped; no_claim=how the learner's pause is then shown
test("a route-handler hit that also names a learner's breakpoint is not resumed by the run", async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  // Act
  routeHandlerHit(harness, {
    hitBreakpoints: ['owned-breakpoint', 'learner-owned'],
  })
  // The run waits up to 1000 ms for a browser request before it would resume a hit.
  await new Promise((resolve) => setTimeout(resolve, 1600))
  // Assert
  assert.deepEqual(
    {
      continues: harness.server!.continues.length,
      resumedEvents: harness.run
        .view()
        .events.filter(
          (event) => event.type === 'breakpoint.route-handler-resumed',
        ).length,
    },
    { continues: 0, resumedEvents: 0 },
  )
})
