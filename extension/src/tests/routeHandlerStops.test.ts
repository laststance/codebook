import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  ROUTE_FILE,
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

// Value: protects=a chat that follows the documented flow can read the manifest before input in a run whose only stop is a route handler; fails_when=ready is published with no manifest, the manifest names JavaScript or map hashes of a module that does not exist yet, or sealedAtPause is missing; no_claim=the hashes of the pause (the pause seals its own)
test('a run whose only stop is a route handler has a manifest with the route file hash before any operation', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  const routePath = join(await realpath(harness.directory), ROUTE_FILE)
  const routeHash = createHash('sha256')
    .update(await readFile(routePath, 'utf8'))
    .digest('hex')
  // Act
  await harness.run.prepare()
  const manifest = harness.run.view().manifest
  // Assert
  assert.deepEqual(
    {
      sourceHash: manifest?.sourceHash,
      sealedAtPause: manifest?.sealedAtPause,
      hasJavascriptHash: manifest !== undefined && 'javascriptHash' in manifest,
      hasMapHash: manifest !== undefined && 'mapHash' in manifest,
    },
    {
      sourceHash: routeHash,
      sealedAtPause: 'route-handler',
      hasJavascriptHash: false,
      hasMapHash: false,
    },
  )
})

// Value: protects=the route-only manifest is frozen once at prepare and the pause neither changes its hash nor adds the pause's module hashes to it; fails_when=the pause refreezes the manifest; no_claim=the pause's own source hashes (the snapshot carries them)
test('the manifest of a route-handler-only run is not refrozen at the pause', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  const before = harness.run.view().manifest?.hash
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'POST', '/api/todos')
  // Act
  routeHandlerHit(harness)
  const snapshot = await publishedPause(harness)
  const after = harness.run.view().manifest
  // Assert
  assert.deepEqual(
    {
      sameHash: after?.hash === before,
      sealedAtPause: after?.sealedAtPause,
      pauseHasOwnHashes:
        typeof snapshot.source.javascriptHash === 'string' &&
        typeof snapshot.source.mapHash === 'string',
    },
    { sameHash: true, sealedAtPause: 'route-handler', pauseHasOwnHashes: true },
  )
})
