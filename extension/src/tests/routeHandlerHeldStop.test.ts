import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  ADD,
  publishedPause,
  routeHandlerHit,
  routeHandlerRunHarness,
  sendOperation,
  sendRequest,
  type RouteHandlerRunHarness,
} from './utils/routeHandlerRunHarness'

const SECRET = 'typed-by-learner'

/**
 * Announces the route file as a script of its own, carrying its own source map, and sends the route handler's hit, as the mixed-run tests of the route-handler stops do.
 * @param harness - The run's harness.
 * @param routeFile - The route file the stop is declared in.
 * @example await hitRouteFile(harness, 'app/api/todos/route.ts')
 */
async function hitRouteFile(
  harness: RouteHandlerRunHarness,
  routeFile: string,
): Promise<void> {
  const server = harness.server!
  const routeUrl = `webpack-internal:///(rsc)/./${routeFile}`
  const routePath = join(await realpath(harness.directory), routeFile)
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
}

// Value: protects=a route-handler hit that arrives while a browser stop of the same operation is still paused (the page's fetch was dispatched before the stop's line) holds the server paused and is published after the browser stop is continued; fails_when=the hit fails the run with "Unexpected or additional server stop", takes the browser stop's place in the order, or is resumed; no_claim=a real fetch (the harness page answers the click once the stops were continued)
test('a route-handler hit that arrives while a browser stop is paused is published after that stop is continued', async (context) => {
  // Arrange
  const routeFile = 'app/api/todos/route.ts'
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
      additionalStopFile: routeFile,
    },
  })
  await harness.run.prepare()
  await sendOperation(harness, 1)
  await waitUntil(
    () => harness.run.view().status === 'ready',
    'operation 1 done',
  )
  await sendOperation(harness, 2)
  const browserPause = await waitUntil(
    () => harness.run.view().participants.browser?.snapshot,
    'the browser stop paused',
  )
  // Act
  sendRequest(harness, '9', 'POST', '/api/todos')
  await hitRouteFile(harness, routeFile)
  // The hit waits for the held stop: neither a server pause nor a failure appears meanwhile.
  await setTimeout(400)
  const whileHeld = {
    serverPaused: Boolean(harness.run.view().participants.server?.snapshot),
    failures: [...harness.run.view().failures],
  }
  await harness.run.continue('browser', browserPause.pause)
  const serverPause = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      whileHeld,
      order: [...harness.run.view().snapshots].map((snapshot) => [
        snapshot.participant,
        snapshot.execution,
      ]),
      server: { ...serverPause.routeHandler },
    },
    {
      whileHeld: { serverPaused: false, failures: [] },
      order: [
        ['browser', 'browser'],
        ['server', 'route-handler'],
      ],
      server: { method: 'POST', route: '/api/todos', path: '/api/todos' },
    },
  )
})

// Value: protects=ENG-4 a request path that holds a value the learner typed is masked in the published route-handler pause like in the journal; fails_when=the snapshot's routeHandler.path keeps the typed value; no_claim=masking of the route pattern or of the method
test('a route-handler pause masks a typed secret in the request path it publishes', async (context) => {
  // Arrange
  const routeFile = 'app/api/todos/[id]/route.ts'
  const operations = [
    {
      kind: 'text' as const,
      title: 'Password',
      selector: '#password',
      secret: 'ask-learner' as const,
    },
    { ...ADD, title: 'Add' },
  ]
  const harness = await routeHandlerRunHarness(context, {
    extra: {
      sourcePath: routeFile,
      serverRuntime: { route: '/api/todos/[id]' },
      operations: {
        operations,
        stopOperations: [2],
        stopParticipants: ['server'],
        controls: { '#password': { tagName: 'input', type: 'password' } },
      },
    },
  })
  await harness.run.prepare()
  harness.run.action('op-1', 'repository-operation', { learnerSecret: SECRET })
  await waitUntil(
    () => harness.run.view().status === 'ready',
    'operation 1 done',
  )
  await sendOperation(harness, 2)
  // Act
  sendRequest(harness, '9', 'POST', `/api/todos/${SECRET}`)
  routeHandlerHit(harness)
  const serverPause = await publishedPause(harness)
  // Assert
  assert.equal(serverPause.routeHandler?.path, '/api/todos/[masked]')
})
