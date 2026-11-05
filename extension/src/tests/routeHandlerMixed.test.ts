import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  ADD,
  ROUTE_FILE,
  publishedPause,
  routeHandlerHit,
  routeHandlerRunHarness,
  sendOperation,
  sendRequest,
} from './utils/routeHandlerRunHarness'

// Value: protects=AC 3 a run with a browser stop (the mutation's onMutate) and a route-handler stop, both after operation 2, pauses first in the browser, then in the route handler; fails_when=the route-handler stop pauses before the browser stop, the browser continue ends the operation before the route-handler pause, or the order of the snapshots differs; no_claim=a real optimistic mutation (the harness's page answers the click once the stops were continued)
test('a browser stop and a route-handler stop of one operation pause in the browser first, then in the route handler', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context, {
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
      additionalStopFile: ROUTE_FILE,
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
  sendRequest(harness, '9', 'POST', '/api/todos')
  // The stand-in server announces its sealed module under the first stop's file; the route file is a script of its own, carrying its own map.
  const server = harness.server!
  const routeUrl = `webpack-internal:///(rsc)/./${ROUTE_FILE}`
  const routePath = join(await realpath(harness.directory), ROUTE_FILE)
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
  routeHandlerHit(harness, {
    scriptId: 'route-script',
    generated: { line: 1, column: 6 },
    source: { line: 1, column: 7 },
  })
  const serverPause = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      order: [...harness.run.view().snapshots].map((snapshot) => [
        snapshot.participant,
        snapshot.execution,
      ]),
      server: { ...serverPause.routeHandler },
    },
    {
      order: [
        ['browser', 'browser'],
        ['server', 'route-handler'],
      ],
      server: { method: 'POST', route: '/api/todos', path: '/api/todos' },
    },
  )
})

// Value: protects=a run with a browser stop sealed before input keeps today's manifest: the browser stop's JavaScript and map hashes and no sealedAtPause; fails_when=a mixed run is frozen as a route-handler-only manifest; no_claim=the hash values (they follow the stand-in bundle)
test('a run with a browser stop and a route-handler stop has the browser stop JavaScript and map hashes in its manifest', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context, {
    stopOperations: [2, 2],
    stopParticipants: ['browser', 'server'],
    operations: [
      { kind: 'click', title: 'Focus', selector: 'button[type=submit]' },
      { ...ADD, title: 'Add' },
    ],
    additionalStops: [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
      },
    ],
    extra: {
      participant: 'browser',
      sourcePath: 'components/TodoListCache.tsx',
      additionalStopFile: ROUTE_FILE,
    },
  })
  // Act
  await harness.run.prepare()
  const manifest = harness.run.view().manifest
  // Assert
  assert.deepEqual(
    {
      sealedAtPause: manifest?.sealedAtPause,
      javascriptHashIsSet: typeof manifest?.javascriptHash === 'string',
      mapHashIsSet: typeof manifest?.mapHash === 'string',
    },
    { sealedAtPause: undefined, javascriptHashIsSet: true, mapHashIsSet: true },
  )
})
