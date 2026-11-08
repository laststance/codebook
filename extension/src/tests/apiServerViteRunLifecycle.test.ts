import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { apiServerRunHarness } from './utils/apiServerRunHarness'

// Value: protects=AC 5 completion on vite-dev: a run that was prepared and is then stopped ends the API's group with its normal close, after Vite started; fails_when=the API is left running after the run's stop; no_claim=a real process group (ownedApiServer.test.ts)
test('on completion of a vite-dev apiServer run the API group ends', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { adapter: 'vite-dev' })
  await harness.run.prepare()
  // Act
  await harness.run.stop()
  // Assert
  assert.deepEqual(harness.fake.events.slice(-2), ['metro-start', 'close'])
})

// Value: protects=AC 5 failure on vite-dev: Vite failing to start after the API started ends the API's group with the run; fails_when=the API is left running after the failed run's cleanup; no_claim=Vite's own failure wording
test('on failure of a vite-dev apiServer run the API group ends', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    extra: { applicationStartFails: 'Vite could not start' },
  })
  // Act
  await harness.run.prepare().catch(() => undefined)
  await harness.run.stop().catch(() => undefined)
  // Assert
  assert.deepEqual(harness.fake.events.slice(-2), ['metro-start', 'close'])
})

// Value: protects=AC 5 cancellation on vite-dev: a Stop while the run waits for the API's port kills the API's group first and then closes it, and the preparation ends cancelled; fails_when=the cancelled run leaves the API running; no_claim=the 60 s listen bound
test('on cancellation of a vite-dev apiServer run the API group ends', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
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

// Value: protects=AC 5 failed kill-first on vite-dev: a kill that cannot be confirmed makes Stop fail with cleanup failed and keeps the pid in the run resource; a retried Stop ends the group and clears it; fails_when=the failure or pid is lost, or the retry does not clear it; no_claim=a real process that outlives SIGKILL
test('a kill that cannot be confirmed fails Stop with cleanup failed and the pid until a retried Stop ends the group', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    adapter: 'vite-dev',
    entry: 'manual',
  })
  harness.fake.killFails = true
  const preparation = harness.run.prepare().then(
    () => 'prepared',
    () => 'cancelled',
  )
  await waitUntil(
    () =>
      harness.run
        .view()
        .events.some((event) => event.type === 'server.selected'),
    'the selection',
  )
  // Act
  const firstStop = await harness.run.stop().then(
    () => 'stopped',
    () => 'refused',
  )
  await preparation
  const afterFailure = harness.run.view().apiServer
  harness.fake.killFails = false
  const retried = await harness.run.stop().then(
    () => 'stopped',
    () => 'refused',
  )
  // Assert
  assert.deepEqual(
    {
      firstStop,
      pid: afterFailure?.pid,
      cleanup: afterFailure?.cleanup,
      retried,
      cleanupAfterRetry: harness.run.view().apiServer?.cleanup,
    },
    {
      firstStop: 'refused',
      pid: 4242,
      cleanup: 'failed',
      retried: 'stopped',
      cleanupAfterRetry: undefined,
    },
  )
})
