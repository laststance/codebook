import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { readResource } from '../resources'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { captureStudy } from '../utils/captureStudy'
import { snapshotSourceHashes } from '../utils/snapshotSourceHashes'

import {
  armedEntry,
  entryRenderHarness,
  heldEntryPause,
} from './utils/entryRenderHarness'
import { serviceHostedEntryRun } from './utils/entryRenderService'

/** The idempotency name of the explanation that carries the learning summary. */
const SUMMARY_EXPLANATION = 'entry-summary'

/** A workspace key in the shape a saved study carries. */
const WORKSPACE_KEY = 'a'.repeat(64)

/** Pauses the entry render of a service-hosted run and continues it, then lets the page finish loading. @returns The snapshot URI of the entry pause. @example const snapshotUri = await completeEntryOnly(run) */
async function completeEntryOnly(
  run: Awaited<ReturnType<typeof serviceHostedEntryRun>>,
): Promise<string> {
  const { harness, service, state } = run
  // The service releases a completed run within 250 ms, so `completed` is a state a loaded machine's poll misses and a capture straddling the release is discarded.
  run.holdMaintenance()
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
  // The snapshot of the entry pause, read before the continue releases it.
  const snapshotUri = state().participants.server!.snapshotUri!
  harness.setDocumentReadyState('complete')
  await service.continue(state().participants.server!.continueArguments!)
  await waitUntil(() => state().state === 'completed', 'the completed run')
  return snapshotUri
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

// Value: protects=API 1.16 the run resource's observation and the inspection resource each say what the entry-render pause is (execution, attribution, declaredIndex, executionIndex) so the chat names the pause as the run labels it; fails_when=either resource drops those fields and only the bare snapshot resource carries them; why_new=no service-level test read the run resource or the inspection for a server-render pause; seam=none; no_claim=a real Next dev server or the wording the chat gives the pause
test('the run resource and the inspection resource label the entry-render pause with execution, attribution and indexes', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(context)
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
  // Act
  const observation = state().observations[0]!
  const inspection = await readResource(service, observation.inspectionUri)
  if (!('text' in inspection)) throw new Error('The inspection is text.')
  // The masked page carries the inspection facts as a JSON string in `content`.
  const inspected = JSON.parse(JSON.parse(inspection.text).content)
  // Assert
  const label = {
    execution: 'server-render',
    attribution: 'entry-load',
    declaredIndex: 0,
    executionIndex: 0,
  }
  assert.deepEqual(
    {
      execution: observation.execution,
      attribution: observation.attribution,
      declaredIndex: observation.declaredIndex,
      executionIndex: observation.executionIndex,
    },
    label,
  )
  assert.equal('operationIndex' in observation, false)
  assert.deepEqual(
    {
      execution: inspected.execution,
      attribution: inspected.attribution,
      declaredIndex: inspected.declaredIndex,
      executionIndex: inspected.executionIndex,
    },
    label,
  )
  assert.equal('operationIndex' in inspected, false)
})

// Value: protects=CodeRabbit minor (pass 4): a run of no operation whose run-level after conditions never hold ends with the coded OPERATION_AFTER_NOT_MET failure (operation 0, nothing sent), as the last operation of a run with operations does; fails_when=the 20 s deadline ends the run with the plain text "Timed out waiting for configured after conditions" and no operationFailure; no_claim=real time (the run's manual clock moves) or a real page's condition
test('a run of no operation whose after conditions never hold fails with a coded run-level reason that names nothing sent', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context)
  harness.failAfterWith({ conditionIndex: 0, reason: 'not-visible' })
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  const pause = await heldEntryPause(harness)
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await prepared
  await waitUntil(
    () => harness.run.view().status === 'resuming',
    'the run observes its after conditions',
  )
  // Act
  harness.advance(20_000)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  const failure = harness.run.view().operationFailure
  assert.match(
    harness.run.view().failures[0]!,
    /^OPERATION_AFTER_NOT_MET: The entry page loaded, but its result could not be confirmed/,
  )
  assert.deepEqual(
    {
      code: failure?.code,
      operationIndex: failure?.operationIndex,
      path: failure?.path,
      sent: failure?.sent,
    },
    {
      code: 'OPERATION_AFTER_NOT_MET',
      operationIndex: 0,
      path: 'after',
      sent: 'not-sent',
    },
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

// Value: protects=P2 of the Codex review: a completed run of no operation, stopped, gets a terminalReference that a chat's learning summary may cite, and the saved study with that summary reopens; fails_when=the entry-load operation (no input acknowledged) leaves terminalReference undefined, explain refuses the reference, or the saved study fails its learning-summary validation; no_claim=a real Next dev server (a stand-in server hits the armed stop)
test('a completed run with no operation gives a terminal reference that a learning summary cites and the saved study reopens with it', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(context)
  const { service, receipt, state } = run
  const snapshotUri = await completeEntryOnly(run)
  const sourceHash = snapshotSourceHashes(
    service.snapshot(service.record(receipt), snapshotUri),
  ).typescript
  // Act
  await service.stop(receipt)
  const terminalReference = state().terminalReference
  const explained = await service.explain({
    ...receipt,
    key: SUMMARY_EXPLANATION,
    snapshotUri,
    sourceHash,
    valuePaths: ['value:nextTheme'],
    interpretation: 'The entry render held the dark theme.',
    learningSummary: {
      question: 'What does the entry page render?',
      title: 'Entry render',
      summary: 'The entry render paused with the dark theme.',
      participants: [{ id: 'page', label: 'Page' }],
      steps: [
        {
          id: 'entry',
          from: 'page',
          to: 'page',
          label: 'Entry render',
          explanation: 'The stop records nextTheme as dark.',
          evidence: 'observed',
          reference: { snapshotUri, sourceHash },
        },
        {
          id: 'result',
          from: 'page',
          to: 'page',
          label: 'Page loaded',
          explanation: 'The verified after frame shows the loaded page.',
          evidence: 'observed',
          reference: terminalReference!,
        },
      ],
    },
  })
  const directory = await mkdtemp(join(tmpdir(), 'codebook-entry-summary-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const saved = await captureStudy(
    service,
    service.record(receipt),
    WORKSPACE_KEY,
  )
  const library = new LearningLibrary(directory, WORKSPACE_KEY)
  await library.saveStudy(saved!)
  const reopened = await library.readStudy(saved!.id)
  // Assert
  assert.equal(terminalReference?.kind, 'terminal')
  assert.match(explained.explanationUri, /explanations\//)
  assert.equal(reopened.learningSummary?.content.steps[1]?.evidence, 'observed')
})

// Value: protects=P2 of the Codex review: an automatically resumed hit of another route gives the stop's 20 s bound back; fails_when=the hit's pause hold replaces the bound by 300 s (the run survives 20 s from the arming) or the hold stays after the resume; no_claim=real time (the run's manual clock moves)
test('an auto-resumed hit of another route leaves the 20 s bound to reach the stop in force', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context)
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedEntry(harness)
  harness.server!.hit({ route: '/dashboard/invoices' })
  await waitUntil(
    () => harness.server!.continues.length >= 1,
    'the other route hit was resumed',
  )
  // Act
  harness.advance(20_000)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed 20 s after the arming',
  )
  await prepared
  // Assert
  assert.match(
    harness.run.view().failures[0] ?? '',
    /^SERVER_STOP_NOT_REACHED|^ENTRY_LOAD_TIMEOUT/,
  )
})
