import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { apiServerRunHarness } from './utils/apiServerRunHarness'

/**
 * Prepares a run and returns what it threw.
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

// Value: protects=AC 3 and the order of the Outcome: the API is checked, launched, attached, released and awaited before Metro starts, and each preparation step is named in the run resource with its time; fails_when=Metro starts before the API listens, a step is missing or the API's entry pause is never continued; no_claim=a real Node process, a real inspector or tsx (the stand-in API and the scripted participant answer; ownedApiServer.test.ts runs real Node)
test('the API is checked, launched, attached, released and listening before Metro starts', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
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
      failures: [],
    },
  )
})

// Value: protects=AC 2: an API port equal to the app's web script port is refused before anything starts; fails_when=the API is checked or launched, or Metro starts, or the refusal lacks its reason or side effects; no_claim=the Expo script's port parsing (expoWebWorkspace.test.ts)
test('an apiServer.port equal to the web script port is refused as api-port-conflict before anything starts', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { apiPort: 8081 })
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      code: error?.code,
      reason: error?.details?.reason,
      sideEffects: error?.details?.sideEffects,
      appPort: error?.details?.appPort,
      events: harness.fake.events,
    },
    {
      code: 'EXPO_WEB_UNSUPPORTED',
      reason: 'api-port-conflict',
      sideEffects: 'none',
      appPort: 8081,
      events: [],
    },
  )
})

// Value: protects=AC 2 and D6: a taken API port is refused PORT_UNAVAILABLE with the apiServer participant before the API or Metro starts; fails_when=the API is launched, Metro starts, or the refusal speaks of the node-server profile; no_claim=the port probe itself (ownedApiServer.test.ts)
test('a taken API port is refused as PORT_UNAVAILABLE for apiServer before anything starts', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
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

// Value: protects=DX-10 and E-4: an inspector that is not the launched API's ends the run with RUNTIME_FAILED at api-server-attach, after the API's group was killed and before Metro started; fails_when=the group is not killed first, Metro starts, or the step is unnamed; no_claim=a real foreign inspector (ownedApiServer.test.ts proves the identity check)
test('an attach failure kills the API group first and ends the run at api-server-attach', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  harness.fake.endpointFailure = new Error('The API announced no inspector')
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      code: error?.code,
      step: error?.details?.step,
      sideEffects: error?.details?.sideEffects,
      events: harness.fake.events,
    },
    {
      code: 'RUNTIME_FAILED',
      step: 'api-server-attach',
      sideEffects: 'partial',
      events: ['check', 'launch', 'inspector-endpoint', 'kill-first'],
    },
  )
})

// Value: protects=AC 3: an API that never listens on its declared port ends the run with SERVER_NOT_LISTENING at api-server-listen, with the group killed and Metro never started; fails_when=Metro starts, the group is left running, or the step is unnamed; no_claim=the 60 s bound (the stand-in answers the refusal at once)
test('an API that never listens ends the run at api-server-listen with its group killed', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    fake: { listen: new StudyError('SERVER_NOT_LISTENING', 'No listener.') },
  })
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      code: error?.code,
      step: error?.details?.step,
      participant: error?.details?.participant,
      events: harness.fake.events.slice(-2),
    },
    {
      code: 'SERVER_NOT_LISTENING',
      step: 'api-server-listen',
      participant: 'apiServer',
      events: ['listen', 'kill-first'],
    },
  )
})

// Value: protects=AC 5 lifecycle: Metro failing to start after the API started ends the API's group with the run; fails_when=the API is left running after the run's cleanup; no_claim=Metro's own failure wording (expoWebLaunch.test.ts)
test('a Metro start failure after the API started ends the API group with the run', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    extra: { applicationStartFails: 'Metro could not start' },
  })
  // Act
  await harness.run.prepare().catch(() => undefined)
  await harness.run.stop().catch(() => undefined)
  // Assert
  assert.deepEqual(harness.fake.events.slice(-2), ['metro-start', 'close'])
})

// Value: protects=AC 5 lifecycle: cancelling the run while it waits for the API's port ends the API's group and sends nothing else; fails_when=the cancelled run leaves the API running or surfaces a refusal instead of the cancellation; no_claim=the 60 s bound
test('cancelling while the API port is awaited ends the API group', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    fake: { listen: 'never' },
  })
  const preparation = harness.run.prepare().then(
    () => 'prepared',
    () => 'cancelled',
  )
  await waitUntil(
    () => harness.fake.events.includes('listen'),
    'the API listener wait',
  )
  // Act
  await harness.run.stop()
  const outcome = await preparation
  // Assert
  assert.deepEqual(
    { outcome, events: harness.fake.events.slice(-3) },
    { outcome: 'cancelled', events: ['listen', 'kill-first', 'close'] },
  )
})
