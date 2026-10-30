import assert from 'node:assert/strict'
import { test } from 'node:test'

import { z } from 'zod'

import { readResource } from '../resources'
import { viteReloadText } from '../viteRefusals'

import { configuredServiceHarness } from './utils/configuredServiceHarness'

// protects=a reload after the click reaches the agent as a coded error object (VITE_PAGE_RELOADED with its recovery), not only as a text prefix in the terminal reason; fails_when=the run resource shows RUNTIME_FAILED with the prefixed text as its cause; no_claim=the browser detecting the reload (viteRun tests)
test('a reload after the click shows VITE_PAGE_RELOADED as the run resource error with its recovery and help anchor', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'vite-reload',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, key: 'click', action: 'repository-click' })
  // Act
  runtimes[0]!.failures.push(viteReloadText(true))
  runtimes[0]!.status = 'failed'
  const resource = await readResource(service, receipt.runUri)
  // Assert
  assert.ok('text' in resource)
  const state = z
    .object({
      error: z.object({
        code: z.string(),
        message: z.string(),
        recovery: z.string(),
      }),
    })
    .parse(JSON.parse(resource.text))
  assert.equal(state.error.code, 'VITE_PAGE_RELOADED')
  assert.equal(
    state.error.message,
    "The page reloaded after the click was sent, so the click's result is unknown. Do not send it again; read the run's captured history.",
  )
  assert.match(
    state.error.recovery,
    /See codebook:\/\/help\/repository-browser#VITE_PAGE_RELOADED\.$/,
  )
})
