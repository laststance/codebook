import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StudyClient } from '../client'
import { startServer } from '../server'
import { createHarness } from './helpers'
import { z } from 'zod'
const stateSchema = z.object({
  participants: z.object({ browser: z.object({ resumable: z.boolean() }) }),
})
import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'

test('closing completed external clients releases transport slots while preserving the paused application', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service)
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: 'study',
  })
  try {
    await harness.service.record(receipt).preparation
    harness.service.action({
      ...receipt,
      key: 'click',
      action: 'repository-click',
    })
    // Act: more client lifetimes than the eight simultaneous-session slots.
    for (let index = 0; index < 12; index += 1) {
      const client = await StudyClient.connect(endpoint.descriptor)
      try {
        const state = await client.json(receipt.runUri, stateSchema)
        assert.equal(state.participants.browser.resumable, true)
      } finally {
        await client.close()
      }
    }
    // Assert
    assert.equal(harness.runtimes[0]?.dispatches, 1)
    assert.equal(harness.runtimes[0]?.stopped, false)
  } finally {
    await endpoint.close()
    await harness.close()
  }
})
