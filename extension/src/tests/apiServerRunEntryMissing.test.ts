import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NODE_TEST_ATTACH_TIMEOUT_MS } from '../constants'
import type { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { apiServerRunHarness } from './utils/apiServerRunHarness'
import { journalTypes } from './utils/routeHandlerRunHarness'

// Value: protects=E-3 missing entry pause: an API whose entry pause never arrives ends the run at api-server-release as RUNTIME_FAILED, its group killed first and nothing continued; fails_when=the run waits on, continues something, closes the group normally or names another step; no_claim=the real 45 s wait (only the clock the wait reads is moved, in this test)
test('an API whose entry pause never arrives fails at api-server-release with its group killed first', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { entry: 'manual' })
  let skewMs = 0
  const realNow = performance.now.bind(performance)
  // Only this test's reading of the clock jumps past the attach bound; no production seam is added.
  context.mock.method(performance, 'now', () => realNow() + skewMs)
  const preparation = harness.run.prepare().then(
    () => undefined,
    (thrown: unknown) => thrown as StudyError,
  )
  await waitUntil(
    () => journalTypes(harness).includes('server.selected'),
    'the selection',
  )
  // Act
  skewMs = NODE_TEST_ATTACH_TIMEOUT_MS + 1_000
  const error = await preparation
  await harness.run.stop()
  // Assert
  assert.deepEqual(
    {
      code: error?.code,
      step: error?.details?.step,
      continues: harness.server!.continues.length,
      released: journalTypes(harness).includes('api-server.entry-released'),
      events: harness.fake.events.slice(-2),
    },
    {
      code: 'RUNTIME_FAILED',
      step: 'api-server-release',
      continues: 0,
      released: false,
      events: ['kill-first', 'close'],
    },
  )
})
