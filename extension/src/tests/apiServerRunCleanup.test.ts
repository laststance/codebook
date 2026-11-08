import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  apiServerRunHarness,
  type ApiServerRunHarness,
} from './utils/apiServerRunHarness'
import { journalTypes } from './utils/routeHandlerRunHarness'

/**
 * Starts a run whose API entry pause never arrives (the attach is held), waits until its server session is selected, and mirrors every resource the run releases into the stand-in API's ordered log as `released:<name>`.
 * @param harness - The run's harness, built with `entry: 'manual'`.
 * @returns The preparation's outcome, boxed, settled when the preparation ends.
 * @example const { preparation } = await holdAttach(harness)
 */
async function holdAttach(
  harness: ApiServerRunHarness,
): Promise<{ preparation: Promise<string> }> {
  const push = harness.releases.push.bind(harness.releases)
  harness.releases.push = (...items: string[]): number => {
    harness.fake.events.push(...items.map((item) => `released:${item}`))
    return push(...items)
  }
  const preparation = harness.run.prepare().then(
    () => 'prepared',
    () => 'cancelled',
  )
  await waitUntil(
    () => journalTypes(harness).includes('server.selected'),
    'the selection',
  )
  // Boxed: a bare promise would be flattened by the async return and awaited here.
  return { preparation }
}

// Value: protects=E-4 cancel during attach: a Stop while the API waits at its entry pause kills the API's group before any debugger detaches, and the entry is never continued; fails_when=the debugger session stops before the kill (Node would run its first statement) or a continue is sent; no_claim=the real order of js-debug's termination events
test('a cancel while the API attach is held kills the API group before any debugger detaches', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { entry: 'manual' })
  const { preparation } = await holdAttach(harness)

  // Act
  await harness.run.stop()
  await preparation

  // Assert
  const events = harness.fake.events
  assert.deepEqual(
    {
      killBeforeDetach:
        events.indexOf('kill-first') !== -1 &&
        events.indexOf('kill-first') < events.indexOf('released:debugger'),
      continues: harness.server!.continues.length,
    },
    { killBeforeDetach: true, continues: 0 },
  )
})

// Value: protects=E-4 failed kill-first: a kill that cannot be confirmed leaves the API's debugger session attached and its normal close unsent, and the run resource shows cleanup failed with the pid; the retried Stop kills and clears it; fails_when=the cleanup detaches or closes the surviving API, or the failure record is lost; no_claim=a real process that outlives SIGKILL
test('a failed kill-first keeps the API attached and reports the failed cleanup until a Stop kills it', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { entry: 'manual' })
  harness.fake.killFails = true
  const { preparation } = await holdAttach(harness)

  // Act
  const firstStop = await harness.run.stop().then(
    () => 'stopped',
    () => 'refused',
  )
  await preparation
  const releasedAfterFailure = harness.fake.events.filter((event) =>
    ['released:debugger', 'close'].includes(event),
  )
  const cleanupAfterFailure = harness.run.view().apiServer
  harness.fake.killFails = false
  const secondStop = await harness.run.stop().then(
    () => 'stopped',
    () => 'refused',
  )

  // Assert
  assert.deepEqual(
    {
      firstStop,
      releasedAfterFailure,
      cleanupAfterFailure: {
        pid: cleanupAfterFailure?.pid,
        cleanup: cleanupAfterFailure?.cleanup,
      },
      secondStop,
      cleanupAfterRetry: harness.run.view().apiServer?.cleanup,
    },
    {
      firstStop: 'refused',
      releasedAfterFailure: [],
      cleanupAfterFailure: { pid: 4242, cleanup: 'failed' },
      secondStop: 'stopped',
      cleanupAfterRetry: undefined,
    },
  )
})
