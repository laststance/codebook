import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { REPLAY_DEBUG_MAX_VARIABLES } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  API_ROUTE_FILE,
  apiRouteHit,
  apiRouteRunHarness,
} from './utils/apiRouteRunHarness'
import { armedEntry } from './utils/entryRenderHarness'
import {
  hitOnLine,
  PAGES_SERVER_RETURN_LINE,
  pagesServerRun,
} from './utils/pagesServerRunHarness'
import {
  ADD,
  journalTypes,
  publishedPause,
  sendOperation,
  sendRequest,
} from './utils/routeHandlerRunHarness'

// Value: protects=AC 1 and AC 2 on Codebook's own start path: an API-route stop declared after operation 1 pauses in the GET the page sent after the click, reported as an API route whose method and path come from the request object the handler holds; fails_when=the stop is refused, sealed before the browser opens, published as a route handler or a server render, or named by the browser request instead of `req`; no_claim=real Next timing and js-debug numbering (the harness answers E1's recorded frames and E1b's scope)
test('an API-route stop declared after operation 1 pauses in the request the page sent after that operation and names the request from req', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'GET', '/api/data?clear=1')
  // Act
  apiRouteHit(harness, {
    apiRequest: { method: 'GET', url: '/api/data?clear=1' },
  })
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      execution: snapshot.execution,
      attribution: snapshot.attribution,
      operationIndex: snapshot.operationIndex,
      apiRoute: { ...snapshot.apiRoute },
      routeHandler: snapshot.routeHandler,
      status: harness.run.view().status,
      failures: [...harness.run.view().failures],
    },
    {
      execution: 'api-route',
      attribution: 'after-operation',
      operationIndex: 1,
      apiRoute: { method: 'GET', route: '/api/data', path: '/api/data' },
      routeHandler: undefined,
      status: 'paused-server',
      failures: [],
    },
  )
  assert.equal(
    harness.run.view().renderMessage,
    "Paused in the API route GET /api/data (request /api/data), observed after operation 1. The page's request waits for the handler; continue to let it answer, or stop it with codebook_stop.",
  )
  assert.equal(journalTypes(harness).includes('route-handler.armed'), true)
})

// Value: protects=review round: the two request reads of an API-route hit go quietly, like the stack and text reads, so polling hits that are resumed never spend the journal's capped entries; fails_when=`Runtime.getProperties` goes through the journaled request path, two `cdp.sent`/`cdp.response` pairs per hit; no_claim=the journal's cap itself (the stand-in channel only lists which path a read took)
test('an API-route hit reads the request without journaling the reads', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'GET', '/api/data?clear=1')
  // Act
  apiRouteHit(harness, {
    apiRequest: { method: 'GET', url: '/api/data?clear=1' },
  })
  await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      reads: harness.server!.inspectorMethods.filter(
        (method) => method === 'Runtime.getProperties',
      ).length,
      journaledReads: harness.server!.journaledInspectorMethods.filter(
        (method) => method === 'Runtime.getProperties',
      ).length,
    },
    { reads: 2, journaledReads: 0 },
  )
})

// Value: protects=AC 1 for a stop on a line after the handler awaited: Next's apiResolver is then only on the async stack, and the run still pauses; fails_when=the classifier reads only the synchronous frames, so the hit is resumed as unclassified and the run ends SERVER_STOP_NOT_REACHED; no_claim=real Next timing (the harness answers the raw CDP stack E1 recorded after the await)
test('an API-route stop on a line after the handler awaited pauses in the request', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'GET', '/api/data?clear=1')
  // Act
  apiRouteHit(harness, {
    stack: 'api-route-after-await',
    apiRequest: { method: 'GET', url: '/api/data?clear=1' },
  })
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      execution: snapshot.execution,
      method: snapshot.apiRoute?.method,
      continues: harness.server!.continues.length,
      failures: [...harness.run.view().failures],
    },
    { execution: 'api-route', method: 'GET', continues: 0, failures: [] },
  )
})

// Value: protects=the publish row: the journal says when the request started, when the pause was observed and when it was published, so the 2 s gate of the native checks can be measured; fails_when=the row is missing or lacks a field or the published time precedes the pause; no_claim=the real latency (the harness answers at once)
test('an API-route pause journals the request start, the pause and the publish times', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'GET', '/api/data?clear=1')
  // Act
  apiRouteHit(harness, {
    apiRequest: { method: 'GET', url: '/api/data?clear=1' },
  })
  await publishedPause(harness)
  // Assert
  const row = harness.run
    .view()
    .events.find((event) => event.type === 'route-handler.published')
  const detail = row?.detail as Record<string, unknown>
  assert.deepEqual(
    {
      keys: Object.keys(detail).sort(),
      execution: detail.execution,
      heldMs: detail.heldMs,
      isOrdered:
        Date.parse(String(detail.pausedAt)) <=
        Date.parse(String(detail.publishedAt)),
    },
    {
      keys: [
        'declaredIndex',
        'execution',
        'heldMs',
        'operationIndex',
        'pausedAt',
        'publishedAt',
        'requestStartedAt',
        'route',
      ],
      execution: 'api-route',
      heldMs: 0,
      isOrdered: true,
    },
  )
})

// Value: protects=DX-3 an unreadable request object (a destructured handler parameter) still publishes, by the operation window, with the matched browser request's method and path; fails_when=the pause is refused or resumed because req could not be read, or it names no method; no_claim=which of two requests of the window was the one that paused
test('an API-route pause whose request cannot be read publishes by the operation window with the browser request', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'POST', '/api/data?clear=1')
  // Act
  apiRouteHit(harness, {
    apiRequest: {
      method: 'GET',
      url: '/api/data?clear=1',
      shape: 'destructured',
    },
  })
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    { ...snapshot.apiRoute },
    { method: 'POST', route: '/api/data', path: '/api/data' },
  )
})

// Value: protects=AC 3 a browser stop and an API-route stop of one operation pause in the browser first, then in the API route, whose pause waits for the browser stop's continue; fails_when=the API pause comes before the browser stop, the browser continue ends the operation before the API pause, or the order of the snapshots differs; no_claim=a real mutation (the harness's page answers the click once the stops were continued)
test('a browser stop and an API-route stop of one operation pause in the browser first, then in the API route', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context, {
    stopOperations: [2, 2],
    stopParticipants: ['browser', 'server'],
    operations: [
      { kind: 'click', title: 'Focus', selector: 'button[type=submit]' },
      { ...ADD, title: 'Add' },
    ],
    additionalStops: [
      {
        line: 1,
        // A column apart from the browser stop's, since this stand-in editor reports every breakpoint with each file's replacement.
        column: 7,
        inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
      },
    ],
    extra: {
      participant: 'browser',
      sourcePath: 'components/TodoListCache.tsx',
      additionalStopFile: API_ROUTE_FILE,
      moduleJavascript: undefined,
    },
  })
  await harness.run.prepare()
  await sendOperation(harness, 1)
  await waitUntil(
    () => harness.run.view().status === 'ready',
    'operation 1 done',
  )
  // Act
  await sendOperation(harness, 2)
  const browserPause = await waitUntil(
    () => harness.run.view().participants.browser?.snapshot,
    'the browser stop paused',
  )
  await harness.run.continue('browser', browserPause.pause)
  sendRequest(harness, '9', 'GET', '/api/data?clear=1')
  // The stand-in server announces its sealed module under the first stop's file; the route file is a script of its own, carrying its own map.
  const server = harness.server!
  const routeUrl = `webpack-internal:///(api-node)/./${API_ROUTE_FILE}`
  const routePath = join(await realpath(harness.directory), API_ROUTE_FILE)
  const routeText = await readFile(routePath, 'utf8')
  const routeMap = JSON.stringify({
    version: 3,
    sources: [routePath],
    sourcesContent: [routeText],
    names: [],
    mappings: ';AAAA,MAAM',
  })
  server.announceScript('route-script', routeUrl)
  server.setScriptText(
    'route-script',
    `"use strict";\n${routeText}\n//# sourceURL=${routeUrl}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(routeMap).toString('base64')}`,
  )
  server.hit({
    stack: 'api-route',
    scriptId: 'route-script',
    generated: { line: 1, column: 6 },
    source: { line: 1, column: 7 },
    hitBreakpoints: ['owned-breakpoint'],
    apiRequest: { method: 'GET', url: '/api/data?clear=1' },
  })
  const serverPause = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      order: [...harness.run.view().snapshots].map((snapshot) => [
        snapshot.participant,
        snapshot.execution,
      ]),
      server: { ...serverPause.apiRoute },
    },
    {
      order: [
        ['browser', 'browser'],
        ['server', 'api-route'],
      ],
      server: { method: 'GET', route: '/api/data', path: '/api/data' },
    },
  )
})

// Value: protects=AC 3 a Pages run that declares a getServerSideProps stop (entry load) and an API-route stop (after the click) pauses at both in run order, each by its own path: the data function as a server render, the API route as an API route; fails_when=the API-route stop is judged by the data-function verdict (journaled unconfirmed or published as a server render), the entry stop is taken by the API path, or the order or declared indexes differ; no_claim=a real next/link or fetch (the harness answers the click) and real Next frames of the data function (the E0b fixture answers)
test('a Pages run with a getServerSideProps stop and an API-route stop pauses at both in run order', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    additionalStops: [
      {
        line: 1,
        column: 1,
        inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
      },
    ],
    additionalStopFile: API_ROUTE_FILE,
    operations: {
      operations: [ADD],
      stopOperations: [0, 1],
      stopParticipants: ['server', 'server'],
    },
  })
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
    }),
  )
  const dataFunctionPause = await publishedPause(harness)
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', dataFunctionPause.pause)
  await prepared
  // Act
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'GET', '/api/data?clear=1')
  const server = harness.server!
  const routeUrl = `webpack-internal:///(api-node)/./${API_ROUTE_FILE}`
  const routePath = join(await realpath(harness.directory), API_ROUTE_FILE)
  const routeText = await readFile(routePath, 'utf8')
  const routeMap = JSON.stringify({
    version: 3,
    sources: [routePath],
    sourcesContent: [routeText],
    names: [],
    mappings: ';AAAA',
  })
  server.announceScript('route-script', routeUrl)
  server.setScriptText(
    'route-script',
    `"use strict";\n${routeText}\n//# sourceURL=${routeUrl}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(routeMap).toString('base64')}`,
  )
  server.hit({
    stack: 'api-route',
    scriptId: 'route-script',
    generated: { line: 1, column: 0 },
    // The API-route stop is the run's second owned breakpoint.
    hitBreakpoints: ['owned-breakpoint-2'],
    apiRequest: { method: 'GET', url: '/api/data?clear=1' },
  })
  const apiPause = await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.server?.snapshot
  }, 'the API-route pause')
  // Assert
  assert.deepEqual(
    [...harness.run.view().snapshots].map((snapshot) => [
      snapshot.execution,
      snapshot.declaredIndex,
      snapshot.executionIndex,
    ]),
    [
      ['server-render', 0, 0],
      ['api-route', 1, 1],
    ],
  )
  assert.deepEqual(
    { ...apiPause.apiRoute },
    { method: 'GET', route: '/api/data', path: '/api/data' },
  )
})

// Value: protects=ENG-4 an API-route request path that holds a value the learner typed is masked in the published pause like routeHandler.path; fails_when=the snapshot's apiRoute.path keeps the typed value; why_new=only routeHandler.path masking was tested (routeHandlerHeldStop.test.ts); seam=none; no_claim=masking of the route pattern or of the method
test('an API-route pause masks a typed secret in the request path it publishes', async (context) => {
  // Arrange
  const secret = 'typed-by-learner'
  const harness = await apiRouteRunHarness(context, {
    stopOperations: [2],
    extra: {
      sourcePath: 'src/pages/api/todos/[id].ts',
      operations: {
        operations: [
          {
            kind: 'text' as const,
            title: 'Password',
            selector: '#password',
            secret: 'ask-learner' as const,
          },
          { ...ADD, title: 'Add' },
        ],
        stopOperations: [2],
        stopParticipants: ['server'],
        controls: { '#password': { tagName: 'input', type: 'password' } },
      },
    },
  })
  await harness.run.prepare()
  harness.run.action('op-1', 'repository-operation', { learnerSecret: secret })
  await waitUntil(
    () => harness.run.view().status === 'ready',
    'operation 1 done',
  )
  await sendOperation(harness, 2)
  sendRequest(harness, '9', 'POST', `/api/todos/${secret}`)
  // Act
  apiRouteHit(harness, {
    apiRequest: { method: 'POST', url: `/api/todos/${secret}` },
  })
  const snapshot = await publishedPause(harness)
  // Assert
  assert.equal(snapshot.apiRoute?.path, '/api/todos/[masked]')
})

// Value: protects=AC 5 and E-7 (native C88-1): the saved replay of an API-route pause keeps every top-level local of the handler frame even when the request object holds more members than the variable budget; fails_when=the capture expands `req` depth first and drops `res`, `add` or `clear` (Historical variable count limit reached); why_new=no test paired an API-route pause with a request larger than the budget; seam=none; no_claim=js-debug's real member order or the real size of an IncomingMessage
test('an API-route pause saves res, add and clear after a request object larger than the variable budget', async (context) => {
  // Arrange
  const harness = await apiRouteRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'GET', '/api/data?clear=1')
  const members = Object.fromEntries(
    Array.from({ length: REPLAY_DEBUG_MAX_VARIABLES + 100 }, (_, index) => [
      `member${index}`,
      index,
    ]),
  )
  harness.server!.setScope({
    req: { url: '/api/data?clear=1', socket: members },
    res: { statusCode: 200 },
    add: undefined,
    clear: '1',
  })
  // Act
  apiRouteHit(harness, {
    apiRequest: { method: 'GET', url: '/api/data?clear=1' },
  })
  const snapshot = await publishedPause(harness)
  // Assert
  const recorded = snapshot.debugger!
  const local = recorded.frames[0]!.scopes[0]!
  const topLevel = local.variables.map((index) => recorded.variables[index]!)
  assert.deepEqual(
    topLevel.map((variable) => variable.name),
    ['req', 'res', 'add', 'clear'],
  )
  assert.equal(topLevel[3]!.value, "'1'")
})
