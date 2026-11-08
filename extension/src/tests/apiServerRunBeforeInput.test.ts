import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  apiServerHit,
  apiServerRunHarness,
  sendApiRequest,
} from './utils/apiServerRunHarness'
import { journalTypes, publishedPause } from './utils/routeHandlerRunHarness'

// Value: protects=Cycle 99 R-race: an API handler hit that arrives after the stop was armed but before its operation's input is resumed, journaled and never published, and the breakpoint stays armed so the later hit after the input pauses and is attributed to the page's request; fails_when=the early hit fails the run as an unexpected stop, is published as the learner's pause, or consumes the stop meant for the input; no_claim=js-debug's real timing of background traffic
test('an API handler hit before the operation input is resumed and the hit after the input pauses', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  // Holds the operation between arming its stop and sending its input, the interval background traffic can hit.
  let releaseGate!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve
  })
  const checkConditions = harness.run['assertOperationConditions'].bind(
    harness.run,
  )
  harness.run['assertOperationConditions'] = async (
    ...parameters
  ): Promise<void> => {
    await gate
    await checkConditions(...parameters)
  }
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(
    () => journalTypes(harness).includes('route-handler.armed'),
    'the armed API breakpoint',
  )
  // Act
  await apiServerHit(harness)
  await waitUntil(
    () => journalTypes(harness).includes('breakpoint.api-before-input'),
    'the early hit resumed',
  )
  const statusAfterEarlyHit = harness.run.view().status
  const snapshotAfterEarlyHit = harness.run.view().participants.server?.snapshot
  releaseGate()
  await waitUntil(() => harness.inputsSeen() === 1, 'the input was sent')
  sendApiRequest(harness, { id: '7', method: 'POST', path: '/api/rpc/x' })
  await apiServerHit(harness)
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      statusAfterEarlyHit: statusAfterEarlyHit === 'failed',
      publishedEarly: snapshotAfterEarlyHit !== undefined,
      // The API entry pause plus the early hit's resume.
      continues: harness.server!.continues.length,
      attributed: snapshot.apiRequest?.state,
      path: (snapshot.apiRequest as { path?: string } | undefined)?.path,
      status: harness.run.view().status,
    },
    {
      statusAfterEarlyHit: false,
      publishedEarly: false,
      continues: 2,
      attributed: 'attributed',
      path: '/api/rpc/x',
      status: 'paused-server',
    },
  )
})
