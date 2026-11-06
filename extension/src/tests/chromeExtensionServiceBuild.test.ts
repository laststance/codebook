import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readResource } from '../resources'

import { createHarness } from './helpers'
import { defer } from './utils/defer'
import { FakeChromeExtensionRuntime } from './utils/fakeChromeExtensionRuntime'
import { chromeExtensionConfigurationOf } from './utils/startFakeChromeExtensionRun'

const BUILD_FACTS = {
  tool: 'wxt',
  version: '0.21.4',
  durationMs: 95_000,
} as const

// protects=a start still building at its answer bound answers phase building (no extension yet), and the run resource then carries the build facts once ready; fails_when=the answer reports the preparation phase of a later step, hides the build, or the resource lacks the facts; no_claim=the real 40 s bound or a real build (a fake run reads the phases)
test('codebook_start answers the building phase when the build outlasts its bound, and the run resource carries the build facts', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const run = new FakeChromeExtensionRuntime()
  run.prepareGate = defer<void>()
  run.prepareGatePhase = 'building'
  run.builtFacts = BUILD_FACTS
  harness.service.environment.createChromeExtensionRun = async () => run
  harness.service.chromeExtensionStartAnswerMs = 30
  // Act
  const answer = await harness.service.startOnStoredBook({
    instanceId: harness.service.instanceId,
    profile: 'chrome-extension',
    key: 'b1',
    configuration: chromeExtensionConfigurationOf(harness),
  })
  run.prepareGate.resolve()
  await harness.service.record(answer).preparation
  const resource = await readResource(
    harness.service,
    harness.service.uri(answer.runId),
  )
  if (!('text' in resource)) throw new Error('The resource is text.')
  const state = JSON.parse(resource.text)
  // Assert
  assert.equal(answer.phase, 'building')
  assert.equal(answer.build, undefined)
  assert.equal(answer.extension, undefined)
  assert.deepEqual(state.chromeExtension.build, BUILD_FACTS)
  assert.equal(state.chromeExtension.phase, 'ready')
})

// protects=a start that is ready after a build answers the build facts beside the manifest; fails_when=the facts are missing from the answer; no_claim=the build itself
test('codebook_start answers the build facts of a built extension', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const run = new FakeChromeExtensionRuntime()
  run.builtFacts = BUILD_FACTS
  harness.service.environment.createChromeExtensionRun = async () => run
  // Act
  const answer = await harness.service.startOnStoredBook({
    instanceId: harness.service.instanceId,
    profile: 'chrome-extension',
    key: 'b2',
    configuration: chromeExtensionConfigurationOf(harness),
  })
  // Assert
  assert.equal(answer.phase, 'ready')
  assert.deepEqual(answer.build, BUILD_FACTS)
})
