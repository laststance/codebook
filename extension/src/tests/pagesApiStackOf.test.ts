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
