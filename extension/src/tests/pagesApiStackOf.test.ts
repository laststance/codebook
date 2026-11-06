import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  handlerFrameIndexOf,
  PAGES_API_CALLER,
  routeHandlerStackOf,
} from '../utils/routeHandlerStackOf'

const RESOLVER_URL =
  'file:///repo/node_modules/next/dist/compiled/next-server/pages-api.runtime.dev.js'
const urls: Record<string, string> = { '40': RESOLVER_URL }
const urlOf = (scriptId: string): string | undefined => urls[scriptId]
const handler = {
  functionName: '__WEBPACK_DEFAULT_EXPORT__',
  location: { scriptId: '12' },
}

// Value: protects=E1 before the handler's first await the synchronous frames are the handler, apiResolver and processTicksAndRejections, and the stack is an API-route call; fails_when=apiResolver directly below the handler is not accepted (every real hit before an await is unclassified); no_claim=Next versions other than E1's 16.2.2
test('an API-route stack with apiResolver directly below the handler is recognised before an await', () => {
  // Arrange
  const frames = [
    handler,
    { functionName: 'apiResolver', location: { scriptId: '40' } },
    {
      functionName: 'processTicksAndRejections',
      location: { scriptId: '32' },
    },
  ]
  // Act
  const result = routeHandlerStackOf(
    frames,
    '12',
    undefined,
    urlOf,
    PAGES_API_CALLER,
  )
  // Assert
  assert.deepEqual(result, { handlerName: '__WEBPACK_DEFAULT_EXPORT__' })
})

// Value: protects=E1 after an await the synchronous frames are the handler alone and apiResolver heads the first async segment; fails_when=the classifier reads only synchronous frames, or accepts an async segment whose head is another caller; no_claim=chains deeper than E1's two segments
test('an API-route stack with apiResolver at the head of the async stack is recognised after an await', () => {
  // Arrange
  const asyncStack = {
    callFrames: [
      { functionName: 'apiResolver', url: RESOLVER_URL },
      {
        functionName: 'processTicksAndRejections',
        url: 'node:internal/process/task_queues',
      },
    ],
    parent: {
      callFrames: [
        {
          functionName: 'runApi',
          url: 'file:///repo/node_modules/next/dist/server/next-server.js',
        },
      ],
    },
  }
  const otherStack = {
    callFrames: [{ functionName: 'somethingElse', url: RESOLVER_URL }],
  }
  // Act
  const results = [
    routeHandlerStackOf([handler], '12', asyncStack, urlOf, PAGES_API_CALLER),
    routeHandlerStackOf([handler], '12', otherStack, urlOf, PAGES_API_CALLER),
  ]
  // Assert
  assert.deepEqual(results, [
    { handlerName: '__WEBPACK_DEFAULT_EXPORT__' },
    undefined,
  ])
})

// Value: protects=Cycle 0087's route-handler stack is unchanged and the two callers are not mixed up: run and do still classify as an App Router handler and not as an API route, and apiResolver is no App Router caller; fails_when=the caller spec leaks between kinds; no_claim=the App Router stacks of E2 and E3 (the 0087 tests)
test('the App Router stack keeps its caller and is no API-route stack', () => {
  // Arrange
  const appFrames = [
    { functionName: 'POST', location: { scriptId: '12' } },
    { functionName: 'run', location: { scriptId: '238' } },
    { functionName: 'do', location: { scriptId: '3464' } },
  ]
  const apiFrames = [
    handler,
    { functionName: 'apiResolver', location: { scriptId: '40' } },
  ]
  const appUrls = (scriptId: string): string | undefined =>
    scriptId === '3464'
      ? 'file:///repo/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js'
      : urlOf(scriptId)
  // Act
  const results = [
    routeHandlerStackOf(appFrames, '12', undefined, appUrls),
    routeHandlerStackOf(appFrames, '12', undefined, appUrls, PAGES_API_CALLER),
    routeHandlerStackOf(apiFrames, '12', undefined, appUrls),
    // An async-context frame between the handler and apiResolver is the App Router's shape, not E1's.
    routeHandlerStackOf(
      [
        handler,
        { functionName: 'run', location: { scriptId: '238' } },
        apiFrames[1]!,
      ],
      '12',
      undefined,
      appUrls,
      PAGES_API_CALLER,
    ),
  ]
  // Assert
  assert.deepEqual(results, [
    { handlerName: 'POST' },
    undefined,
    undefined,
    undefined,
  ])
  assert.equal(handlerFrameIndexOf(apiFrames, '12'), 0)
})

const ROUTE_URL = 'webpack-internal:///(api-node)/./src/pages/api/x.ts'
const routeUrls = (scriptId: string): string | undefined =>
  scriptId === '12' ? ROUTE_URL : urlOf(scriptId)
const helperFrame = { functionName: 'helper', location: { scriptId: '12' } }
const continuationFrame = {
  functionName: 'processTicksAndRejections',
  location: { scriptId: '32' },
}
const resolverFrame = { functionName: 'apiResolver', url: RESOLVER_URL }

// Value: protects=a stop in an async helper after the helper's own await, whose awaiting handler and Next's apiResolver are on the async chain, is a handler hit; fails_when=the async chain must start with the caller, so the pause is resumed as unclassified and the run ends SERVER_STOP_NOT_REACHED; why_new=E1 shapes had the caller first; seam=none; no_claim=reading the request from the helper's scope
test('an API-route stop after a helper await is recognised when the handler segment leads the async chain', () => {
  // Arrange
  const separateSegments = {
    callFrames: [
      { functionName: '__WEBPACK_DEFAULT_EXPORT__', url: ROUTE_URL },
    ],
    parent: { callFrames: [resolverFrame] },
  }
  const sharedSegment = {
    callFrames: [
      { functionName: '__WEBPACK_DEFAULT_EXPORT__', url: ROUTE_URL },
      resolverFrame,
    ],
  }
  // Act
  const results = [separateSegments, sharedSegment].map((asyncStack) =>
    routeHandlerStackOf(
      [helperFrame, continuationFrame],
      '12',
      asyncStack,
      routeUrls,
      PAGES_API_CALLER,
    ),
  )
  // Assert
  assert.deepEqual(results, [
    { handlerName: '__WEBPACK_DEFAULT_EXPORT__' },
    { handlerName: '__WEBPACK_DEFAULT_EXPORT__' },
  ])
})

// Value: protects=a helper chain that never reaches apiResolver is no handler hit; fails_when=skipping the route file's awaiting frames accepts any chain; why_new=the walk skips route-file frames and must still need the caller; seam=none; no_claim=chains deeper than two segments
test('an API-route stop after a helper await stays unclassified when the async chain never reaches apiResolver', () => {
  // Arrange
  const asyncStack = {
    callFrames: [{ functionName: 'handler', url: ROUTE_URL }],
    parent: {
      callFrames: [{ functionName: 'somethingElse', url: RESOLVER_URL }],
    },
  }
  // Act
  const result = routeHandlerStackOf(
    [helperFrame, continuationFrame],
    '12',
    asyncStack,
    routeUrls,
    PAGES_API_CALLER,
  )
  // Assert
  assert.equal(result, undefined)
})

// Value: protects=an App Router method handler that awaited a helper keeps its method name when the stop is in the helper; fails_when=the handler name is taken from the synchronous helper frame (verdict then finds no HTTP method) or the chain is dropped; why_new=same shape as the API route; seam=none; no_claim=route resolution
test('an App Router stop after a helper await names the exported method frame as the handler', () => {
  // Arrange
  const appRouteUrl = 'webpack-internal:///(rsc)/./app/api/x/route.ts'
  const appUrls = (scriptId: string): string | undefined =>
    scriptId === '12' ? appRouteUrl : undefined
  const asyncStack = {
    callFrames: [{ functionName: 'POST', url: appRouteUrl }],
    parent: {
      callFrames: [
        { functionName: 'run', url: 'node:internal/async_local_storage' },
        {
          functionName: 'do',
          url: 'file:///repo/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js',
        },
      ],
    },
  }
  // Act
  const result = routeHandlerStackOf(
    [helperFrame, continuationFrame],
    '12',
    asyncStack,
    appUrls,
  )
  // Assert
  assert.deepEqual(result, { handlerName: 'POST' })
})
