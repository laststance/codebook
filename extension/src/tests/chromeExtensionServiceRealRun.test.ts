import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CHROME_EXTENSION_PROFILE } from '../constants'
import { readResource } from '../resources'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { createHarness } from './helpers'
import {
  createRunHarness,
  resolvedHarnessRun,
} from './utils/chromeExtensionRunHarness'
import { chromeExtensionConfigurationOf } from './utils/startFakeChromeExtensionRun'

/**
 * Starts a chrome-extension run through the service with the real run lifecycle ({@link createOwnedChromeExtensionRun}) over the run harness's fake browser, debugger and executor.
 * Why: the MCP wiring and the run lifecycle were built against one contract by separate lanes; these tests drive both together, so a field the service reads or a phase the run ends in cannot drift apart unnoticed.
 * @param harness - The service harness.
 * @param readTexts - What the text observation reads, one answer per read; the last one repeats.
 * @returns The service record, the run harness and a helper that reads the run resource as the chat does.
 * @example
 * const started = await startRealRun(harness, ['before', 'after'])
 */
async function startRealRun(
  harness: Awaited<ReturnType<typeof createHarness>>,
  readTexts: readonly string[],
) {
  let reads = 0
  const runHarness = createRunHarness({
    resolved: resolvedHarnessRun(),
    readText: () => ({
      text: readTexts[Math.min(reads++, readTexts.length - 1)] ?? '',
    }),
  })
  runHarness.debuggerState.notReached = []
  harness.service.environment.createChromeExtensionRun = async () =>
    runHarness.run
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: CHROME_EXTENSION_PROFILE,
    key: 'real-run',
    configuration: chromeExtensionConfigurationOf(harness),
  })
  const record = harness.service.record(receipt)
  await record.preparation
  const readState = async () => {
    const resource = await readResource(
      harness.service,
      harness.service.uri(record.id),
    )
    if (!('text' in resource)) throw new Error('The resource is text.')
    return JSON.parse(resource.text)
  }
  const click = (key: string) =>
    harness.service.performAction({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key,
      action: 'extension-click',
    })
  return { record, runHarness, readState, click }
}

// protects=the fit of the MCP service and the real chrome-extension run lifecycle (Cycle 0061 pt2 integration): start reaches ready through every preparation phase, two clicks answer their indexes, the observation completes by itself, the run cleans up in order and the service releases it, the resource reports a claimable changed result; fails_when=a field the service reads of the run's view is missing or renamed, the run's final phase never frees the run, or the cleanup order breaks; no_claim=real Chrome, js-debug or the editor's views (N61)
test('a chrome-extension run started through the service reaches a claimable result through the real run lifecycle and is released', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startRealRun(harness, ['before', 'after'])
  // Act
  const first = await started.click('click-1')
  const second = await started.click('click-2')
  await waitUntil(
    () => started.record.stopped,
    'the completed run is released by the service',
  )
  const state = await started.readState()
  // Assert
  assert.equal('clickIndex' in first && first.clickIndex, 1)
  assert.equal('clickIndex' in second && second.clickIndex, 2)
  assert.equal(state.chromeExtension.phase, 'completed')
  assert.equal(state.chromeExtension.result, 'complete')
  assert.equal(state.claimable, true)
  assert.deepEqual(
    {
      kind: state.chromeExtension.observed.kind,
      before: state.chromeExtension.observed.before,
      after: state.chromeExtension.observed.after,
      changed: state.chromeExtension.observed.changed,
    },
    {
      kind: 'text',
      before: { value: 'before' },
      after: { value: 'after' },
      changed: true,
    },
  )
  assert.deepEqual(state.chromeExtension.procedure, {
    clicksDeclared: 2,
    clicksPerformed: 2,
  })
  assert.deepEqual(
    started.runHarness.log.filter((entry) =>
      [
        'debugger.browserClosing',
        'debugger.release',
        'executor.dispose',
        'browser.close',
      ].includes(entry),
    ),
    [
      'debugger.browserClosing',
      'debugger.release',
      'executor.dispose',
      'browser.close',
    ],
  )
})

// protects=DXR3 and SR30 across the real run: after the run completed and cleaned up, a repeated key replays its click's receipt instead of a state refusal, and a new start is not refused as BUSY; fails_when=the released run's receipts are lost or its slot stays held; no_claim=the receipts of another run
test('a completed real run replays a repeated click key and frees the slot for the next start', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startRealRun(harness, ['same'])
  const first = await started.click('click-1')
  await started.click('click-2')
  await waitUntil(
    () => started.record.stopped,
    'the completed run is released by the service',
  )
  // Act
  const replay = await started.click('click-1')
  const next = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: CHROME_EXTENSION_PROFILE,
    key: 'next-run',
    configuration: chromeExtensionConfigurationOf(harness),
  })
  // Assert
  assert.deepEqual(replay, first)
  assert.notEqual(next.runUri, harness.service.uri(started.record.id))
  const state = await started.readState()
  assert.equal(state.chromeExtension.observed.changed, false)
  assert.equal(state.claimable, true)
})
