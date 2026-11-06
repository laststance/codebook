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

// Value: protects=E-10 the publish row names the time the route-handler pause waited behind a paused browser stop of the run, so the native check's 2 s gate can subtract it; fails_when=heldMs reads 0 (or less than the wait) although the pause waited behind the browser stop; no_claim=the exact milliseconds (the test only holds the browser stop for at least 400 ms)
test('a route-handler pause that waited behind a paused browser stop journals that wait as held time', async (context) => {
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
  // Act: the route handler's hit arrives while the browser stop is paused, which is then held 400 ms before its continue
  sendRequest(harness, '9', 'POST', '/api/todos')
  await hitRouteFile(harness, routeFile)
  await setTimeout(400)
  await harness.run.continue('browser', browserPause.pause)
  await publishedPause(harness)
  // Assert
  const row = harness.run
    .view()
    .events.find((event) => event.type === 'route-handler.published')
  const detail = row?.detail as Record<string, unknown>
  assert.deepEqual(
    {
      execution: detail.execution,
      isHeldAtLeastTheWait: Number(detail.heldMs) >= 400,
    },
    { execution: 'route-handler', isHeldAtLeastTheWait: true },
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

// Value: protects=a browser stop of the same operation that pauses while a route-handler hit is being sealed waits behind that hit, so the pause observed first is published first and the run does not fail; fails_when=the run fails with "Unexpected or additional server stop invalidated the declared operation" because the browser stop was accepted while the route handler's seal was still reading the script, or a route-handler.published row follows run.failed; why_new=Cycle 0088 native check (Cursor, two browser stops and one API-route stop of one operation); seam=holdScriptRead (the seal's script read) and emitPause (the second browser stop); no_claim=a real Next request or the browser stop's own snapshot content
test('a browser stop that pauses while a route-handler hit is being sealed is shown after that hit is continued', async (context) => {
  // Arrange
  const routeFile = 'app/api/todos/route.ts'
  const harness = await routeHandlerRunHarness(context, {
    stopOperations: [2, 2, 2],
    stopParticipants: ['browser', 'server', 'browser'],
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
      {
        line: 1,
        column: 1,
        inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
      },
    ],
    extra: {
      participant: 'browser',
      sourcePath: 'components/TodoListCache.tsx',
      additionalStopFile: routeFile,
      additionalStopFileStops: [0],
    },
  })
  await harness.run.prepare()
  await sendOperation(harness, 1)
  await waitUntil(
    () => harness.run.view().status === 'ready',
    'operation 1 done',
  )
  await sendOperation(harness, 2)
  const firstBrowserPause = await waitUntil(
    () => harness.run.view().participants.browser?.snapshot,
    'the first browser stop paused',
  )
  await harness.run.continue('browser', firstBrowserPause.pause)
  const releaseRead = harness.server!.holdScriptRead('route-script')
  context.after(releaseRead)
  // Act: the route handler's hit is judged and its seal waits on the script read while the second browser stop pauses
  sendRequest(harness, '9', 'POST', '/api/todos')
  await hitRouteFile(harness, routeFile)
  await waitUntil(
    () => harness.server!.scriptReads.includes('route-script'),
    'the seal reads the route script',
  )
  harness.emitPause(1, 1)
  await setTimeout(200)
  releaseRead()
  const serverPause = await publishedPause(harness)
  const whileServerHeld = {
    status: harness.run.view().status,
    failures: [...harness.run.view().failures],
    order: [...harness.run.view().snapshots].map((snapshot) => [
      snapshot.participant,
      snapshot.execution,
    ]),
  }
  await harness.run.continue('server', serverPause.pause)
  const secondBrowserPause = await waitUntil(
    () =>
      harness.run.view().snapshots.length === 3
        ? harness.run.view().participants.browser?.snapshot
        : undefined,
    'the second browser stop paused after the route handler was continued',
  )
  // Assert
  assert.deepEqual(
    {
      whileServerHeld,
      failures: [...harness.run.view().failures],
      secondBrowserIsNext: secondBrowserPause !== firstBrowserPause,
      order: [...harness.run.view().snapshots].map((snapshot) => [
        snapshot.participant,
        snapshot.execution,
      ]),
    },
    {
      whileServerHeld: {
        status: 'paused-server',
        failures: [],
        order: [
          ['browser', 'browser'],
          ['server', 'route-handler'],
        ],
      },
      failures: [],
      secondBrowserIsNext: true,
      order: [
        ['browser', 'browser'],
        ['server', 'route-handler'],
        ['browser', 'browser'],
      ],
    },
  )
})

// Value: protects=a browser stop whose CDP pause came during the route handler's seal and whose DAP `stopped` came after the publish still waits for the route-handler stop's continue; fails_when=the late `stopped` is judged against the published server stop and the run fails with "Unexpected or additional browser stop"; why_new=Cycle 0088 fix-check (the two notifications straddle the seal's end); seam=emitPause without announcement, then emitStopped after the publish; no_claim=a real adapter's notification order
test('a browser stop that pauses while a route-handler hit is being sealed is shown after that hit is continued when its DAP stop arrives after the publish', async (context) => {
  // Arrange
  const routeFile = 'app/api/todos/route.ts'
  const harness = await routeHandlerRunHarness(context, {
    stopOperations: [2, 2, 2],
    stopParticipants: ['browser', 'server', 'browser'],
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
      {
        line: 1,
        column: 1,
        inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
      },
    ],
    extra: {
      participant: 'browser',
      sourcePath: 'components/TodoListCache.tsx',
      additionalStopFile: routeFile,
      additionalStopFileStops: [0],
    },
  })
  await harness.run.prepare()
  await sendOperation(harness, 1)
  await waitUntil(
    () => harness.run.view().status === 'ready',
    'operation 1 done',
  )
  await sendOperation(harness, 2)
  const firstBrowserPause = await waitUntil(
    () => harness.run.view().participants.browser?.snapshot,
    'the first browser stop paused',
  )
  await harness.run.continue('browser', firstBrowserPause.pause)
  const releaseRead = harness.server!.holdScriptRead('route-script')
  context.after(releaseRead)
  // Act: the route handler's hit is judged and its seal waits on the script read while the second browser stop pauses
  sendRequest(harness, '9', 'POST', '/api/todos')
  await hitRouteFile(harness, routeFile)
  await waitUntil(
    () => harness.server!.scriptReads.includes('route-script'),
    'the seal reads the route script',
  )
  harness.emitPause(1, 1, false)
  await setTimeout(200)
  releaseRead()
  const serverPause = await publishedPause(harness)
  harness.emitStopped()
  await setTimeout(200)
  const whileServerHeld = {
    status: harness.run.view().status,
    failures: [...harness.run.view().failures],
    order: [...harness.run.view().snapshots].map((snapshot) => [
      snapshot.participant,
      snapshot.execution,
    ]),
  }
  await harness.run.continue('server', serverPause.pause)
  const secondBrowserPause = await waitUntil(
    () =>
      harness.run.view().snapshots.length === 3
        ? harness.run.view().participants.browser?.snapshot
        : undefined,
    'the second browser stop paused after the route handler was continued',
  )
  // Assert
  assert.deepEqual(
    {
      whileServerHeld,
      failures: [...harness.run.view().failures],
      secondBrowserIsNext: secondBrowserPause !== firstBrowserPause,
      order: [...harness.run.view().snapshots].map((snapshot) => [
        snapshot.participant,
        snapshot.execution,
      ]),
    },
    {
      whileServerHeld: {
        status: 'paused-server',
        failures: [],
        order: [
          ['browser', 'browser'],
          ['server', 'route-handler'],
        ],
      },
      failures: [],
      secondBrowserIsNext: true,
      order: [
        ['browser', 'browser'],
        ['server', 'route-handler'],
        ['browser', 'browser'],
      ],
    },
  )
})
