import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { STUDY_UI_OPTIONS } from '../ui/constants'

import {
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import {
  explainFirstStop,
  saveTwoStopNodeHistory,
} from './utils/twoStopNodeHistory'

type Harness = Awaited<ReturnType<typeof workspaceHarness>>
type FreshReader = ReturnType<Harness['createReader']>

/** The per-step view of the last Study message the window posted. */
function stepView(harness: Harness) {
  return harness.postedMessages().slice(-1)[0]?.stepUnderstanding
}

/**
 * Waits until a Study message posted after `since` messages carries the replay's step decisions as read, then returns them; messages before `since` (an earlier reader's) never count.
 * @param since - How many messages the window had posted when the replay was opened.
 */
async function readSteps(harness: Harness, since = 0) {
  await waitUntil(
    () =>
      harness
        .postedMessages()
        .slice(since)
        .some((message) => message.stepUnderstanding?.status === 'ready'),
    'the replay’s step decisions are read',
    READER_RESULT_BOUND_MS,
  )
  return stepView(harness)!
}

/** Presses one step's check through the webview's own message and waits until it reads saved. */
async function markStep(
  harness: Harness,
  studyId: string,
  stepId: string,
): Promise<void> {
  harness.receiveContext({
    type: 'step-understanding',
    revision: harness.postedMessages().slice(-1)[0]!.revision,
    studyId,
    stepId,
    understood: true,
  })
  await waitUntil(
    () =>
      stepView(harness)?.steps.find((step) => step.stepId === stepId)
        ?.understood === true &&
      stepView(harness)?.steps.find((step) => step.stepId === stepId)
        ?.saving === false,
    `${stepId} reads saved`,
    READER_RESULT_BOUND_MS,
  )
}

/**
 * Simulates a window reload for the Study workspace: disposes the reader and builds a new one over the same storage folder, which makes its own learning library, Node history store and step sessions.
 * @returns The new reader, attached to the same fake editor and service.
 */
async function reloadWindow(
  harness: Harness,
  context: TestContext,
): Promise<FreshReader> {
  await harness.reader.dispose()
  const fresh = harness.createReader()
  context.after(() => fresh.dispose())
  await fresh.attach(harness.service)
  return fresh
}

/** The progress line the webview draws from the Study message's counts. */
function progressLine(view: NonNullable<ReturnType<typeof stepView>>) {
  return STUDY_UI_OPTIONS.stepUnderstanding.progress
    .replace('{n}', String(view.understoodCount))
    .replace('{m}', String(view.selectableCount))
}

// Value: protects=a browser replay's saved step check, its time and the progress line returning after a window reload; fails_when=the reopened replay reads no step file, shows the step unchecked, loses or changes its time, or counts it wrongly; no_claim=a real editor reload and the webview's drawing (native, Reader DOM); the fake editor and the service stand in for the host, the workspace, its learning library and its step sessions are new
test('browser recording: after a window reload the reopened replay shows the saved step’s check, its time and the progress line', async (context) => {
  // Arrange
  const harness = await recordedReaderHarness(
    true,
    false,
    1,
    async (stopped) => {
      const { service } = stopped
      const record = [...service.records.values()][0]!
      const snapshotUri = service.state(record).observations[0]!.snapshotUri
      const sourceHash = stopped.runtimes[0]!.snapshots[0]!.source.hash
      stopped.clock(150)
      const step = (id: string) => ({
        id,
        from: 'control',
        to: 'interface',
        label: `Step ${id}`,
        explanation: `The stop explains ${id}.`,
        evidence: 'observed' as const,
        reference: { snapshotUri, sourceHash },
      })
      await service.explain({
        instanceId: service.instanceId,
        runId: record.id,
        snapshotUri,
        sourceHash,
        valuePaths: ['value:nextTheme'],
        key: 'explanation',
        interpretation: 'The theme is read before the click applies it.',
        learningSummary: {
          question: 'How does the chosen theme reach the interface?',
          title: 'Theme choice',
          summary: 'The recorded stop holds the chosen theme.',
          participants: [
            { id: 'control', label: 'Theme control' },
            { id: 'interface', label: 'Interface' },
          ],
          steps: [step('first'), step('second')],
        },
      })
    },
  )
  context.after(() => harness.close())
  await waitUntil(
    () =>
      harness.service.state(harness.record).historyOutcome.status === 'saved',
    'the recording is saved with its explanation',
    READER_RESULT_BOUND_MS,
  )
  await harness.reader.openRecording(harness.studyId)
  await harness.controller.settle()
  await readSteps(harness)
  await markStep(harness, harness.studyId, 'first')
  const savedAt = stepView(harness)!.steps.find(
    (step) => step.stepId === 'first',
  )!.at

  // Act: the window reloads and the learner opens the saved replay again.
  const fresh = await reloadWindow(harness, context)
  const posted = harness.postedMessages().length
  await fresh.openRecording(harness.studyId)
  const view = await readSteps(harness, posted)

  // Assert
  assert.match(savedAt ?? '', /^\d{4}-\d\d-\d\dT/)
  assert.deepEqual(
    view.steps.map(({ stepId, understood, at }) => ({
      stepId,
      understood,
      at,
    })),
    [
      { stepId: 'first', understood: true, at: savedAt },
      { stepId: 'second', understood: false, at: undefined },
    ],
  )
  assert.equal(progressLine(view), 'Steps understood: 1 of 2')
})

// Value: protects=a Node replay's saved step check, its time and the progress line returning after a window reload; fails_when=the reopened replay reads no step file from its history folder, shows the step unchecked, loses or changes its time, or counts it wrongly; no_claim=a real editor reload and the webview's drawing (native, Reader DOM); the fake editor and the service stand in for the host, the workspace, its Node history store and its step sessions are new
test('test replay: after a window reload the reopened replay shows the saved step’s check, its time and the progress line', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  context.after(() => harness.close())
  const history = await saveTwoStopNodeHistory(
    harness.service.nodeHistoryStore!,
  )
  await explainFirstStop(harness, history)
  await harness.reader.action('retry')
  await harness.reader.open()
  await harness.reader.openLearningReplay(history.studyId)
  await readSteps(harness)
  await markStep(harness, history.studyId, 'read')
  const savedAt = stepView(harness)!.steps.find(
    (step) => step.stepId === 'read',
  )!.at

  // Act: the window reloads and the learner opens the saved replay again.
  const staleStore = harness.service.nodeHistoryStore
  const fresh = await reloadWindow(harness, context)
  const posted = harness.postedMessages().length
  await fresh.open()
  await fresh.openLearningReplay(history.studyId)
  const view = await readSteps(harness, posted)

  // Assert
  assert.notEqual(harness.service.nodeHistoryStore, staleStore)
  assert.match(savedAt ?? '', /^\d{4}-\d\d-\d\dT/)
  assert.deepEqual(
    view.steps.map(({ stepId, understood, at }) => ({
      stepId,
      understood,
      at,
    })),
    [
      { stepId: 'read', understood: true, at: savedAt },
      { stepId: 'keep', understood: false, at: undefined },
    ],
  )
  assert.equal(progressLine(view), 'Steps understood: 1 of 2')
})
