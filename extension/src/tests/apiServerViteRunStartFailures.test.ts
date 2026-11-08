import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { viteRefusal } from '../viteRefusals'

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

/**
 * Reads what an agent decides by from a refusal raised after the API launched.
 * @param error - The refusal.
 * @returns Code, side effects, the truthful sentences and whether the stale claim survived.
 * @example summaryOf(error).sideEffects // => 'partial'
 */
function summaryOf(error: StudyError | undefined) {
  const recovery = error?.describe().recovery ?? ''
  return {
    code: error?.code,
    sideEffects: error?.details?.sideEffects,
    messageSaysStartedAndStopped: error?.message.includes(
      'The API was started and stopped and no input was sent.',
    ),
    recoverySaysStartedAndStopped: recovery.includes(
      'The API was started and stopped and no input was sent.',
    ),
    recoveryKeepsNothingStarted: recovery.includes('Nothing was started'),
  }
}

// Value: protects=B5 (unsupported config): a Vite config the launcher refuses (such as base) after the API launched keeps VITE_UNSUPPORTED but says the API was started and stopped, with sideEffects partial and the API group ended; fails_when=the recovery still says Nothing was started, sideEffects is missing, or the API is left alive; no_claim=the launcher's own config reading (viteDevAdapter tests)
test('an unsupported Vite config after the API launched keeps its code, says the API was started and stopped and ends the API group', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    vite: {
      startFailure: viteRefusal(
        'VITE_UNSUPPORTED',
        'The Vite config sets base, which Codebook does not support.',
      ),
    },
  })
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      ...summaryOf(error),
      eventsAfterListen: harness.fake.events.slice(
        harness.fake.events.indexOf('listen'),
      ),
    },
    {
      code: 'VITE_UNSUPPORTED',
      sideEffects: 'partial',
      messageSaysStartedAndStopped: true,
      recoverySaysStartedAndStopped: true,
      recoveryKeepsNothingStarted: false,
      eventsAfterListen: ['listen', 'kill-first'],
    },
  )
})

// Value: protects=B5 (config-load failure): a launcher failure that carries its own recovery (no Nothing was started sentence to replace) still gets the truthful sentence and sideEffects partial; fails_when=the sentence is added only by replacing text that may be absent, or the API is left alive; no_claim=the launcher's error text
test('a Vite config-load failure with its own recovery after the API launched still states the API was started and stopped', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    vite: {
      startFailure: new StudyError(
        'VITE_LAUNCHER_FAILED',
        'Vite could not load vite.config.ts.',
        'config load failed',
        'Tell the learner the config failed to load; never edit the project.',
        undefined,
        { reason: 'config-load' },
      ),
    },
  })
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      ...summaryOf(error),
      reason: error?.details?.reason,
      recoveryText: error?.describe().recovery,
      eventsAfterListen: harness.fake.events.slice(
        harness.fake.events.indexOf('listen'),
      ),
    },
    {
      code: 'VITE_LAUNCHER_FAILED',
      sideEffects: 'partial',
      messageSaysStartedAndStopped: true,
      recoverySaysStartedAndStopped: true,
      recoveryKeepsNothingStarted: false,
      reason: 'config-load',
      recoveryText:
        'The API was started and stopped and no input was sent. Tell the learner the config failed to load; never edit the project.',
      eventsAfterListen: ['listen', 'kill-first'],
    },
  )
})

// Value: protects=B5 (listen race): the launcher's listen-time VITE_PORT_UNAVAILABLE, raised inside start after the facts check passed, says the API was started and stopped with sideEffects partial and ends the API group; fails_when=the plain Nothing was started recovery is kept or the API is left alive; no_claim=the real listen race
test("the launcher's listen-time port race after the API launched is partial and ends the API group", async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    vite: {
      startFailure: viteRefusal(
        'VITE_PORT_UNAVAILABLE',
        'Port 4902 was taken while Vite started.',
      ),
    },
  })
  // Act
  const error = await prepareError(harness)
  // Assert
  assert.deepEqual(
    {
      ...summaryOf(error),
      eventsAfterListen: harness.fake.events.slice(
        harness.fake.events.indexOf('listen'),
      ),
    },
    {
      code: 'VITE_PORT_UNAVAILABLE',
      sideEffects: 'partial',
      messageSaysStartedAndStopped: true,
      recoverySaysStartedAndStopped: true,
      recoveryKeepsNothingStarted: false,
      eventsAfterListen: ['listen', 'kill-first'],
    },
  )
})

// Value: protects=L1 (api-port-conflict): when the kill of the API group fails in the config-port refusal, the refusal keeps its code and port facts but says Codebook could not confirm the API stopped; fails_when=it claims The API was started and stopped; no_claim=the real kill
test('an api-port conflict whose API kill fails says the stop could not be confirmed', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    apiPort: 4903,
    vite: {
      port: 4903,
      declared: { port: 4903, source: 'the Vite config (vite.config.ts)' },
    },
  })
  harness.fake.killFails = true
  // Act
  const error = await prepareError(harness)
  const cleanupAfterFailure = harness.run.view().apiServer?.cleanup
  // A retried Stop ends the group the stand-in refused to kill, so the harness teardown can finish.
  harness.fake.killFails = false
  await harness.run.stop().catch(() => undefined)
  // Assert
  assert.deepEqual(
    {
      cleanupAfterFailure,
      code: error?.code,
      reason: error?.details?.reason,
      vitePort: error?.details?.vitePort,
      sideEffects: error?.details?.sideEffects,
      saysUnconfirmed: error?.message.includes(
        'Codebook could not confirm the API stopped',
      ),
      claimsStopped: error?.message.includes('started and stopped'),
    },
    {
      cleanupAfterFailure: 'failed',
      code: 'VITE_UNSUPPORTED',
      reason: 'api-port-conflict',
      vitePort: 4903,
      sideEffects: 'partial',
      saysUnconfirmed: true,
      claimsStopped: false,
    },
  )
})

// Value: protects=L1 (taken port): when the kill of the API group fails in the taken-port refusal, VITE_PORT_UNAVAILABLE keeps its port but says the stop could not be confirmed in message and recovery; fails_when=it claims the API stopped; no_claim=the real port probe
test('a taken Vite port whose API kill fails says the stop could not be confirmed', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    vite: {
      port: 4904,
      declared: { port: 4904, source: 'the Vite config (vite.config.ts)' },
      occupant: { reason: 'in-use' },
    },
  })
  harness.fake.killFails = true
  // Act
  const error = await prepareError(harness)
  const recovery = error?.describe().recovery ?? ''
  const cleanupAfterFailure = harness.run.view().apiServer?.cleanup
  // A retried Stop ends the group the stand-in refused to kill, so the harness teardown can finish.
  harness.fake.killFails = false
  await harness.run.stop().catch(() => undefined)
  // Assert
  assert.deepEqual(
    {
      cleanupAfterFailure,
      code: error?.code,
      port: error?.details?.port,
      sideEffects: error?.details?.sideEffects,
      messageUnconfirmed: error?.message.includes(
        'Codebook could not confirm the API stopped',
      ),
      recoveryUnconfirmed: recovery.includes(
        'Codebook could not confirm the API stopped',
      ),
      claimsStopped:
        error?.message.includes('started and stopped') ||
        recovery.includes('started and stopped'),
    },
    {
      cleanupAfterFailure: 'failed',
      code: 'VITE_PORT_UNAVAILABLE',
      port: 4904,
      sideEffects: 'partial',
      messageUnconfirmed: true,
      recoveryUnconfirmed: true,
      claimsStopped: false,
    },
  )
})
