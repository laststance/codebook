import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  journalTypes,
  publishedPause,
  routeHandlerHit,
  routeHandlerRunHarness,
  sendOperation,
  sendRequest,
} from './utils/routeHandlerRunHarness'

// Value: protects=AC 1 on Codebook's own start path: a run that declares a route-handler stop (unsealed before the browser opens) reaches its operation and pauses in the POST the page sent after it, reported as a route handler with method, route and path; fails_when=the stop is sealed before the browser opens and the run ends RUNTIME_FAILED, the hit is resumed as another route, or the pause is labelled a server render; no_claim=real Next timing (the harness answers E1's recorded stack)
test('a route-handler stop declared after operation 1 pauses in the POST the page sent after that operation', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'POST', '/api/todos')
  // Act
  routeHandlerHit(harness)
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      execution: snapshot.execution,
      attribution: snapshot.attribution,
      operationIndex: snapshot.operationIndex,
      routeHandler: { ...snapshot.routeHandler },
      status: harness.run.view().status,
      failures: [...harness.run.view().failures],
    },
    {
      execution: 'route-handler',
      attribution: 'after-operation',
      operationIndex: 1,
      routeHandler: {
        method: 'POST',
        route: '/api/todos',
        path: '/api/todos',
      },
      status: 'paused-server',
      failures: [],
    },
  )
  assert.equal(
    harness.run.view().renderMessage,
    "Paused in the route handler POST /api/todos (request /api/todos), observed after operation 1. The page's request waits for the handler; continue to let it answer, or stop it with codebook_stop.",
  )
  assert.equal(journalTypes(harness).includes('route-handler.armed'), true)
})
