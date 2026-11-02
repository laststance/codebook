import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { captureStudy } from '../utils/captureStudy'

import { entryRenderHarness, heldEntryPause } from './utils/entryRenderHarness'
import { serviceHostedEntryRun } from './utils/entryRenderService'

/** A workspace key in the shape a saved study carries. */
const WORKSPACE_KEY = 'a'.repeat(64)

/** Pauses the entry render of a service-hosted run and continues it, then lets the page finish loading. @example await completeEntryOnly(run) */
async function completeEntryOnly(
  run: Awaited<ReturnType<typeof serviceHostedEntryRun>>,
): Promise<void> {
  const { harness, service, state } = run
  await waitUntil(
    () => harness.server!.breakpointsAcknowledged() > 0,
    'the entry-render stop was armed',
  )
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
  harness.server!.hit({ route: '/dashboard' })
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  harness.setDocumentReadyState('complete')
  await service.continue(state().participants.server!.continueArguments!)
  await waitUntil(() => state().state === 'completed', 'the completed run')
}

// Value: protects=H3 a completed run of no operation (entry render only) saves and reopens; fails_when=the validator refuses the synthetic entry-load operation that completion creates, so Save fails with "Configured operations are missing from a started run."; no_claim=a real Next dev server (a stand-in server hits the armed stop)
test('a completed run with no operation is saved and reopened with its entry pause', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(context)
  const { service, receipt } = run
  await completeEntryOnly(run)
  const directory = await mkdtemp(join(tmpdir(), 'codebook-entry-only-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  // Act
  const saved = await captureStudy(
    service,
    service.record(receipt),
    WORKSPACE_KEY,
  )
  const library = new LearningLibrary(directory, WORKSPACE_KEY)
  await library.saveStudy(saved!)
  const reopened = await library.readStudy(saved!.id)
  // Assert
  assert.equal(reopened.version, 8)
  assert.equal(reopened.operation?.key, 'entry-load')
  assert.deepEqual(
    reopened.observations.map((observation) => [
      observation.execution,
      observation.attribution,
    ]),
    [['server-render', 'entry-load']],
  )
})

// Value: protects=CodeRabbit minor: a run of no operation whose run-level after conditions stop holding after the result was captured fails with a run-level OPERATION_AFTER_NOT_MET reason; fails_when=the failure is a TypeError ("Cannot read properties of undefined") from naming operation 0; no_claim=the wording of a real page's failed condition
test('a run of no operation whose after conditions fail after the capture fails with a run-level reason, not a TypeError', async (context) => {
  // Arrange
  // The page stops showing the result while the after image is captured, once the first read of it held.
  const harness = await entryRenderHarness(context, {
    onScreenshot: () => {
      if (harness.afterReads() >= 1)
        harness.failAfterWith({ conditionIndex: 0, reason: 'not-visible' })
    },
  })
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  const pause = await heldEntryPause(harness)
  // Act
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await prepared
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  const [failure] = harness.run.view().failures
  assert.doesNotMatch(failure!, /Cannot read properties of undefined/)
  assert.match(failure!, /^OPERATION_AFTER_NOT_MET: The entry page loaded/)
})

// Value: protects=CodeRabbit minor: once the entry page loaded, the rest of the preparation is not bounded by ENTRY_LOAD_TIMEOUT; fails_when=a preparation step after the load that lasts 20 s fails the run as ENTRY_LOAD_TIMEOUT; no_claim=the length of the setup bound the preparation then runs under
test('a preparation step after the entry page loaded that outlasts 20 s does not fail as ENTRY_LOAD_TIMEOUT', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context)
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  const pause = await heldEntryPause(harness)
  // The before conditions never hold, so the preparation keeps waiting after the page loaded.
  harness.failBeforeWith({ conditionIndex: 0, reason: 'not-visible' })
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await waitUntil(
    () => harness.evaluatedExpressions.length > 3,
    'the preparation read the page after the load',
  )
  // Act
  harness.advance(20_000)
  await Promise.race([
    prepared,
    waitUntil(
      () => harness.run.view().failures.length > 0,
      'a failure or the end of the wait',
    ).catch(() => undefined),
  ])
  // Assert
  assert.doesNotMatch(
    harness.run.view().failures[0] ?? '',
    /^ENTRY_LOAD_TIMEOUT/,
  )
})
