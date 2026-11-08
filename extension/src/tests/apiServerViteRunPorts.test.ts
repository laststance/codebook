import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'

import { apiServerRunHarness } from './utils/apiServerRunHarness'

/**
 * Prepares a run and returns what it threw.
 * @param harness - The run's harness (not prepared).
 * @returns The thrown refusal, or `undefined` when the preparation succeeded or threw something else.
 * @example const error = await prepareError(harness)
 */
async function prepareError(
  harness: Awaited<ReturnType<typeof apiServerRunHarness>>,
): Promise<StudyError | undefined> {
  const thrown = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  return thrown instanceof StudyError ? thrown : undefined
}

// Value: protects=AC 2 and D27a: an apiServer.port equal to the dev script's --port is known before anything starts, so the run refuses api-port-conflict with no side effects; fails_when=the API is checked or launched, Vite starts, the details lose a port or the source, or sideEffects is not none; no_claim=the script's port parsing (assessViteWorkspace tests)
test('a vite-dev api port equal to the dev script --port is refused api-port-conflict with sideEffects none before anything starts', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    apiPort: 5000,
    vite: { scriptPort: 5000 },
  })
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      code: error?.code,
      reason: error?.details?.reason,
      apiPort: error?.details?.apiPort,
      vitePort: error?.details?.vitePort,
      portSource: error?.details?.portSource,
      sideEffects: error?.details?.sideEffects,
      events: harness.fake.events,
    },
    {
      code: 'VITE_UNSUPPORTED',
      reason: 'api-port-conflict',
      apiPort: 5000,
      vitePort: 5000,
      portSource: 'dev-script',
      sideEffects: 'none',
      events: [],
    },
  )
})

// Value: protects=D27b: an apiServer.port equal to the port the Vite config resolves is only known at the launcher's facts, after the API started, so the run ends the API group and refuses api-port-conflict with partial side effects; fails_when=the API is left alive, sideEffects is none, the source is not config, or the message hides that the API was started and stopped; no_claim=the launcher's own fact reading (viteDevAdapter tests)
test("an api port equal to the Vite config port is refused at the launcher's facts with sideEffects partial and the API group ended", async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    apiPort: 4900,
    vite: {
      port: 4900,
      declared: { port: 4900, source: 'the Vite config (vite.config.ts)' },
    },
  })
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      code: error?.code,
      reason: error?.details?.reason,
      apiPort: error?.details?.apiPort,
      vitePort: error?.details?.vitePort,
      portSource: error?.details?.portSource,
      sideEffects: error?.details?.sideEffects,
      saysStartedAndStopped: error?.message.includes(
        'API was started and stopped',
      ),
      saysNoInput: error?.message.includes('no input was sent'),
      eventsAfterListen: harness.fake.events.slice(
        harness.fake.events.indexOf('listen'),
      ),
    },
    {
      code: 'VITE_UNSUPPORTED',
      reason: 'api-port-conflict',
      apiPort: 4900,
      vitePort: 4900,
      portSource: 'config',
      sideEffects: 'partial',
      saysStartedAndStopped: true,
      saysNoInput: true,
      eventsAfterListen: ['listen', 'kill-first'],
    },
  )
})

// Value: protects=D27c: a Vite port that is taken once the API started ends the API group and refuses VITE_PORT_UNAVAILABLE worded as partial (the API was started and stopped), not the plain "nothing started" refusal; fails_when=the API is left alive, the plain refusal is thrown, or sideEffects is not partial; no_claim=the real port probe (assertDevelopmentPortFree tests)
test('a taken Vite port after the API started is VITE_PORT_UNAVAILABLE with partial side effects and the API group ended', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    vite: {
      port: 4901,
      declared: { port: 4901, source: 'the Vite config (vite.config.ts)' },
      occupant: { reason: 'in-use' },
    },
  })
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      code: error?.code,
      port: error?.details?.port,
      sideEffects: error?.details?.sideEffects,
      saysStartedAndStopped: error?.message.includes(
        'API was started and stopped',
      ),
      viteStarted: harness.fake.events.includes('metro-start'),
      eventsAfterListen: harness.fake.events.slice(
        harness.fake.events.indexOf('listen'),
      ),
    },
    {
      code: 'VITE_PORT_UNAVAILABLE',
      port: 4901,
      sideEffects: 'partial',
      saysStartedAndStopped: true,
      viteStarted: false,
      eventsAfterListen: ['listen', 'kill-first'],
    },
  )
})

// Value: protects=AC 2 and D6 on Vite: a taken API port is refused PORT_UNAVAILABLE for apiServer before the API or Vite starts; fails_when=the API is launched, Vite starts, or the refusal speaks as the node-server profile or claims side effects; no_claim=the port probe itself (ownedApiServer.test.ts)
test('a taken API port is PORT_UNAVAILABLE before anything starts', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { adapter: 'vite-dev' })
  harness.fake.checkFailure = new StudyError(
    'PORT_UNAVAILABLE',
    'Port 4100 is in use.',
  )
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      code: error?.code,
      participant: error?.details?.participant,
      sideEffects: error?.details?.sideEffects,
      port: error?.details?.port,
      events: harness.fake.events,
    },
    {
      code: 'PORT_UNAVAILABLE',
      participant: 'apiServer',
      sideEffects: 'none',
      port: 4100,
      events: ['check'],
    },
  )
})
