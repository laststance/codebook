import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  routeHandlerHitVerdictOf,
  type RouteHandlerBrowserRequest,
} from '../utils/routeHandlerHitVerdictOf'
import { RouteHandlerRequests } from '../utils/routeHandlerRequests'
import { routeHandlerStackOf } from '../utils/routeHandlerStackOf'

/** One tracked request of the operation window 2 that this stop has not claimed. */
const POST_IN_WINDOW_2: RouteHandlerBrowserRequest = {
  id: '9',
  method: 'POST',
  pathname: '/api/todos',
  window: 2,
  claimed: false,
}

/** The verdict input of a stop `/api/todos` after operation 2, hit by a `POST` handler. */
const BASE = {
  stopRoute: '/api/todos',
  hitRoute: '/api/todos',
  handlerName: 'POST',
  operationIndex: 2,
  requests: [POST_IN_WINDOW_2],
}

// Value: protects=R3/R4 the matching request is published with its own method and path; fails_when=a qualifying hit is resumed; no_claim=which of two qualifying requests entered the handler
test('a hit with a browser request of the stop window, method and route is published with that request', () => {
  // Arrange
  const input = BASE
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'publish', request: POST_IN_WINDOW_2 })
})

// Value: protects=AC 1/identity contract the entry load's GET is never published; fails_when=a request that started before the operation is attributed to it; no_claim=timing of the arming
test('a hit whose only matching request started before the operation is resumed as before-operation', () => {
  // Arrange
  const input = {
    ...BASE,
    requests: [{ ...POST_IN_WINDOW_2, id: '3', window: 0 }],
  }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'before-operation' })
})

// Value: protects=identity contract a polling GET is not the POST stop's pause; fails_when=the frame name POST is overridden by whatever request is in the window; no_claim=aliased handlers (their own test)
test('a GET handler hit while only a POST was sent is resumed as other-method', () => {
  // Arrange
  const input = { ...BASE, handlerName: 'GET' }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'other-method' })
})

// Value: protects=identity contract a hit of another route is nobody's stop; fails_when=a work-store route that differs from the stop's pattern is published; no_claim=route rewrites
test('a hit whose work-store route differs from the stop route is resumed as other-path', () => {
  // Arrange
  const input = { ...BASE, hitRoute: '/api/boards/[id]' }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'other-path' })
})

// Value: protects=identity contract the server's own fetch of its API has no browser request; fails_when=a hit with no browser request in the window is published; no_claim=a server fetch with the same method and path as a browser request (documented limit)
test('a hit with no browser request at all is resumed as no-browser-request', () => {
  // Arrange
  const input = { ...BASE, requests: [] }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'no-browser-request' })
})

// Value: protects=identity contract a request to another declared route is not this stop's; fails_when=a window with only another route's request is called empty or published; no_claim=the other route's own stop
test('a hit while the window holds only a request to another route is resumed as other-path', () => {
  // Arrange
  const input = {
    ...BASE,
    requests: [{ ...POST_IN_WINDOW_2, pathname: '/api/boards/1' }],
  }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'other-path' })
})

// Value: protects=OV-E1 a stop claims at most one request and a request already claimed by this stop is not published again; fails_when=a claimed request is published twice; no_claim=a second stop (its claims are its own)
test('a hit whose only matching request this stop already claimed is resumed as after-retired', () => {
  // Arrange
  const input = {
    ...BASE,
    requests: [{ ...POST_IN_WINDOW_2, claimed: true }],
  }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'after-retired' })
})

// Value: protects=OV-E2 an aliased handler (export { handle as POST }) has no method name and is accepted with the method of the browser request; fails_when=the function name handle is taken for a method and the hit is resumed; no_claim=that the alias is exported as POST
test('a handler frame whose name is no HTTP method is accepted with the request method', () => {
  // Arrange
  const input = { ...BASE, handlerName: 'handle' }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'publish', request: POST_IN_WINDOW_2 })
})

// Value: protects=F1 a stack Next changed is never published; fails_when=an unclassified stack is published; no_claim=Next's current stack (E1 recorded it)
test('a hit with no route-handler stack is resumed as unclassified', () => {
  // Arrange
  const input = { ...BASE, handlerName: undefined }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'unclassified' })
})

// Value: protects=R3 classification by stack: handler above AsyncLocalStorage.run above AppRouteRouteModule.do, the top frame in the route file; fails_when=a frame of another script or a stack without Next's route module is a handler; no_claim=other Next versions
test("the route-handler stack is the handler frame directly above Next's route module", () => {
  // Arrange
  const handler = { functionName: 'POST', location: { scriptId: '12' } }
  const run = {
    functionName: 'AsyncLocalStorage.run',
    location: { scriptId: '4' },
  }
  const routeModule = {
    functionName: 'AppRouteRouteModule.do',
    location: { scriptId: '5' },
  }
  // Act
  const results = [
    routeHandlerStackOf([handler, run, routeModule], '12'),
    routeHandlerStackOf([handler, run], '12'),
    routeHandlerStackOf(
      [{ ...handler, location: { scriptId: '7' } }, run, routeModule],
      '12',
    ),
    routeHandlerStackOf(
      [
        handler,
        { functionName: 'other', location: { scriptId: '4' } },
        routeModule,
      ],
      '12',
    ),
  ]
  // Assert
  assert.deepEqual(results, [
    { handlerName: 'POST' },
    undefined,
    undefined,
    undefined,
  ])
})

// Value: protects=R4 only API requests that match a declared route are kept, bounded to 256, oldest dropped; fails_when=a page asset request is kept or the list grows without bound; no_claim=request headers or bodies (never read)
test('the request tracker keeps matching requests of the application origin and drops the oldest past its bound', () => {
  // Arrange
  const tracker = new RouteHandlerRequests(
    ['/api/todos'],
    (origin) => origin === 'http://localhost:4321',
  )
  // Act
  tracker.start(
    {
      requestId: 'asset',
      method: 'GET',
      url: 'http://localhost:4321/logo.png',
    },
    0,
    1,
  )
  tracker.start(
    {
      requestId: 'foreign',
      method: 'GET',
      url: 'http://example.com/api/todos',
    },
    0,
    2,
  )
  for (let id = 0; id < 260; id++)
    tracker.start(
      {
        requestId: `r${id}`,
        method: 'post',
        url: 'http://localhost:4321/api/todos',
      },
      2,
      id,
    )
  const kept = tracker.list()
  // Assert
  assert.deepEqual(
    [kept.length, kept[0]!.id, kept[0]!.method, kept.at(-1)!.id],
    [256, 'r4', 'POST', 'r259'],
  )
})

// Value: protects=CodeRabbit a redirect that Chrome reports under the same request id keeps its target when that is another declared route or method, and a repeated event adds nothing; fails_when=the tracker keeps only the first hop, so a stop in the redirect target's handler finds no browser request; no_claim=a real redirect (the test feeds the Network events)
test('the request tracker keeps a redirect hop to another declared route under its own id and ignores a repeated event', () => {
  // Arrange
  const tracker = new RouteHandlerRequests(['/api/start', '/api/target'])
  // Act
  tracker.start(
    { requestId: 'r1', method: 'POST', url: 'http://localhost:4321/api/start' },
    2,
    10,
  )
  tracker.start(
    { requestId: 'r1', method: 'POST', url: 'http://localhost:4321/api/start' },
    2,
    11,
  )
  tracker.start(
    { requestId: 'r1', method: 'GET', url: 'http://localhost:4321/api/target' },
    2,
    12,
  )
  const kept = tracker.list()
  // Assert
  assert.deepEqual(
    kept.map((request) => [request.id, request.method, request.pathname]),
    [
      ['r1', 'POST', '/api/start'],
      ['r1 GET /api/target', 'GET', '/api/target'],
    ],
  )
})

// Value: protects=R3 with the stacks CDP really gives (E2): `run` and `do` by their raw names on the synchronous stack, and after an await the handler above processTicksAndRejections with `run` and `do` at the head of the async stack; fails_when=the classifier only knows a debugger's display names or only the synchronous frames, so every real hit, or every hit after an await, is unclassified; no_claim=Next versions other than E2's 16.2
test('the route-handler stack is recognised by the raw CDP frame names, also after the handler awaited', () => {
  // Arrange
  const handler = { functionName: 'POST', location: { scriptId: '12' } }
  const run = { functionName: 'run', location: { scriptId: '238' } }
  const routeModule = { functionName: 'do', location: { scriptId: '3464' } }
  const resumed = {
    functionName: 'processTicksAndRejections',
    location: { scriptId: '32' },
  }
  const urls: Record<string, string> = {
    '3464':
      'file:///repo/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js',
  }
  const asyncCallers = [
    {
      functionName: 'run',
      url: 'node:internal/async_local_storage/async_context_frame',
    },
    {
      functionName: 'do',
      url: 'file:///repo/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js',
    },
  ]
  const urlOf = (scriptId: string): string | undefined => urls[scriptId]
  // Act
  const results = [
    routeHandlerStackOf([handler, run, routeModule], '12', undefined, urlOf),
    routeHandlerStackOf(
      [handler, resumed],
      '12',
      { callFrames: asyncCallers },
      urlOf,
    ),
    routeHandlerStackOf([handler, resumed], '12', undefined, urlOf),
    routeHandlerStackOf(
      [handler, resumed],
      '12',
      {
        callFrames: [{ functionName: 'do', url: 'file:///repo/lib/queue.js' }],
      },
      urlOf,
    ),
  ]
  // Assert
  assert.deepEqual(results, [
    { handlerName: 'POST' },
    { handlerName: 'POST' },
    undefined,
    undefined,
  ])
})

// Value: protects=native C87-2 after an awaited timer (E3: the handler alone on the synchronous stack, Node's continuation alone in the async stack's first segment, `run` and `do` in the segment before it) the stack is still the route handler's; fails_when=only the first async segment is read, so a stop after any timer is resumed as unclassified; no_claim=Next versions other than E3's 16.2
test('the route-handler stack is recognised after the handler awaited a timer', () => {
  // Arrange
  const handler = { functionName: 'POST', location: { scriptId: '3543' } }
  const routeModuleSegment = {
    callFrames: [
      {
        functionName: 'run',
        url: 'node:internal/async_local_storage/async_context_frame',
      },
      {
        functionName: 'do',
        url: 'file:///repo/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js',
      },
    ],
  }
  const continuationOnly = {
    callFrames: [
      {
        functionName: 'processTicksAndRejections',
        url: 'node:internal/process/task_queues',
      },
    ],
  }
  const timerFrames = [
    { functionName: 'runNextTicks', location: { scriptId: '33' } },
    { functionName: 'listOnTimeout', location: { scriptId: '34' } },
    { functionName: 'processTimers', location: { scriptId: '34' } },
  ]
  const urls: Record<string, string> = {
    '33': 'node:internal/process/task_queues',
    '34': 'node:internal/timers',
  }
  const urlOf = (scriptId: string): string | undefined => urls[scriptId]
  // Act
  const results = [
    routeHandlerStackOf(
      [handler],
      '3543',
      { ...continuationOnly, parent: routeModuleSegment },
      urlOf,
    ),
    routeHandlerStackOf(
      [handler, ...timerFrames],
      '3543',
      routeModuleSegment,
      urlOf,
    ),
    routeHandlerStackOf([handler], '3543', continuationOnly, urlOf),
    routeHandlerStackOf(
      [handler],
      '3543',
      {
        ...continuationOnly,
        parent: {
          callFrames: [
            { functionName: 'do', url: 'file:///repo/lib/queue.js' },
          ],
        },
      },
      urlOf,
    ),
  ]
  // Assert
  assert.deepEqual(results, [
    { handlerName: 'POST' },
    { handlerName: 'POST' },
    undefined,
    undefined,
  ])
})

// Value: protects=FX-G1 an alias exported as GET never publishes a POST of the window; fails_when=an alias accepts every method so the POST is published with the GET's locals; no_claim=that the source text names the alias
test('an alias exported as GET with only a POST in the window is resumed as other-method', () => {
  // Arrange
  const input = { ...BASE, handlerName: 'readTodos', handlerMethods: ['GET'] }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'other-method' })
})

// Value: protects=FX-G1 an alias exported as GET is published with the window's GET, not the earlier POST; fails_when=the first request of the window wins whatever its method; no_claim=timing of the polling
test('an alias exported as GET with a POST then a GET in the window is published with the GET', () => {
  // Arrange
  const get = { ...POST_IN_WINDOW_2, id: '10', method: 'GET' }
  const input = {
    ...BASE,
    handlerName: 'readTodos',
    handlerMethods: ['GET'],
    requests: [POST_IN_WINDOW_2, get],
  }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'publish', request: get })
})

// Value: protects=FX-G1 an alias the source does not tie to a method is published only when the window has one method; fails_when=a POST then GET window publishes the first request for an unknown alias; no_claim=aliases the parser knows
test('an unknown alias with a POST and a GET in the window is resumed as unclassified', () => {
  // Arrange
  const get = { ...POST_IN_WINDOW_2, id: '10', method: 'GET' }
  const input = {
    ...BASE,
    handlerName: 'handle',
    requests: [POST_IN_WINDOW_2, get],
  }
  // Act
  const verdict = routeHandlerHitVerdictOf(input)
  // Assert
  assert.deepEqual(verdict, { action: 'resume', reason: 'unclassified' })
})
