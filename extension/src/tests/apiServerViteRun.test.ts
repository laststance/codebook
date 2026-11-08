import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { test } from 'node:test'

import {
  apiServerHit,
  apiServerRunHarness,
  sendApiRequest,
  type ApiServerRunHarness,
} from './utils/apiServerRunHarness'
import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  ADD,
  publishedPause,
  sendOperation,
} from './utils/routeHandlerRunHarness'

/** The port the Vite stand-in listens on unless a test names another. */
const VITE_STAND_IN_PORT = 4321

/** The attach configuration of an API stand-in: the repository's real root, then the node_modules exclusion. */
async function expectedSourceMapLocations(
  harness: ApiServerRunHarness,
): Promise<string[]> {
  return [`${await realpath(harness.directory)}/**`, '!**/node_modules/**']
}

// Value: protects=AC 1 and the Cycle 0099 order on Vite: the API is checked, launched, attached, released and listening before Vite starts; fails_when=Vite starts first, the entry pause is never released, or a step is missing; no_claim=real processes (the stand-in API and Vite answer)
test('a vite-dev run starts the API, attaches, releases and sees it listen before Vite starts', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { adapter: 'vite-dev' })
  // Act
  await harness.run.prepare()
  // Assert
  const view = harness.run.view()
  assert.deepEqual(
    {
      events: [...harness.fake.events],
      steps: Array.from(view.apiServer?.steps ?? [], (entry) => entry.step),
      entryContinues: harness.server!.continues.length,
      port: view.apiServer?.port,
      outputTail: view.apiServer?.outputTail,
      failures: [...view.failures],
    },
    {
      events: [
        'check',
        'launch',
        'inspector-endpoint',
        'verify',
        'listen',
        'metro-start',
      ],
      steps: ['api-server-launch', 'api-server-attach', 'api-server-listen'],
      entryContinues: 1,
      port: 4100,
      outputTail: undefined,
      failures: [],
    },
  )
})

// Value: protects=outcome 3 on Vite: a page request to the dev server under a declared proxy prefix is the attributed request of the API pause, and the run resource names its method, path and operation; fails_when=the proxied request is not a candidate (unattributed none), or the route and prefix are missing from the fact; no_claim=a real forward by Vite's proxy or a real browser's Network timing (the stand-in page sends the event)
test('a proxied page request is the attributed request of an API pause and the run resource names its method, path and operation', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    proxyPaths: ['/api'],
  })
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendApiRequest(harness, {
    id: '7',
    method: 'POST',
    path: '/api/rpc/switches/switchTo?activity=3',
    origin: `http://localhost:${VITE_STAND_IN_PORT}`,
  })
  // Act
  await apiServerHit(harness)
  const snapshot = await publishedPause(harness)
  // Assert
  const fact = { ...snapshot.apiRequest } as { sentence: string }
  assert.deepEqual(
    { ...fact, sentence: undefined },
    {
      state: 'attributed',
      method: 'POST',
      path: '/api/rpc/switches/switchTo',
      operation: 1,
      basis: 'time-window',
      route: 'dev-server-proxy',
      proxyPath: '/api',
      sentence: undefined,
    },
  )
  assert.equal(
    harness.run.view().renderMessage?.startsWith(fact.sentence),
    true,
  )
  assert.equal(fact.sentence.includes('POST /api/rpc/switches/switchTo'), true)
})

// Value: protects=D32 on Vite: the API's pwa-node attach resolves source maps in the opened repository and never in node_modules, so a window opened on another folder still binds the stop; fails_when=the key is absent, covers node_modules, or names the unresolved repository path; no_claim=js-debug binding the breakpoint (the native check)
test('the API attach of a vite-dev run carries resolveSourceMapLocations for the repository root', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { adapter: 'vite-dev' })
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(
    {
      type: harness.serverLaunches[0]!.type,
      locations: [...harness.serverLaunches[0]!.resolveSourceMapLocations],
    },
    {
      type: 'pwa-node',
      locations: await expectedSourceMapLocations(harness),
    },
  )
})

// Value: protects=D32 on Expo: the same attach code gives the Expo API attach the same locations; fails_when=Expo loses the key; no_claim=js-debug binding the breakpoint (the native check)
test('the API attach of an expo-web-dev run carries resolveSourceMapLocations for the repository root', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(
    [...harness.serverLaunches[0]!.resolveSourceMapLocations],
    await expectedSourceMapLocations(harness),
  )
})

// Value: protects=D32 scope: the Next server attach keeps js-debug's default source map locations; fails_when=the Next server attach gains resolveSourceMapLocations; no_claim=a real Next compile (the attach is the configuration the run hands the editor)
test('the Next server attach does not carry resolveSourceMapLocations', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    participant: 'server',
    serverRuntime: { route: '/' },
    operations: {
      operations: [ADD],
      stopOperations: [1],
      stopParticipants: ['server'],
    },
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(
    {
      launches: harness.serverLaunches.length,
      hasLocations: 'resolveSourceMapLocations' in harness.serverLaunches[0]!,
    },
    { launches: 1, hasLocations: false },
  )
})

// Value: protects=AC 10 regression: a vite-dev run without apiServer starts Vite with no API, no API step and an untouched view; fails_when=the API path runs, or the view gains an apiServer block; no_claim=the Vite launcher itself
test('a vite-dev run without apiServer starts Vite alone and its view has no apiServer', async (context) => {
  // Arrange
  const events: string[] = []
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    onApplicationStart: () => events.push('vite-start'),
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(
    {
      events,
      apiServer: harness.run.view().apiServer,
      failures: [...harness.run.view().failures],
    },
    { events: ['vite-start'], apiServer: undefined, failures: [] },
  )
})
