import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type {
  StepUnderstandingDecision,
  StepUnderstandingFile,
} from '../stepUnderstandingSchemas'
import {
  StepUnderstandingSessions,
  type ShownReplaySteps,
  type StepDecisionStore,
} from '../studyWorkspace/stepUnderstandingSessions'

import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'

const STUDY_A = '11111111-1111-4111-8111-111111111111'
const STUDY_B = '22222222-2222-4222-8222-222222222222'
const STEP_HASH = 'a'.repeat(64)
const NOW = new Date('2026-01-01T00:00:00.000Z')

/** A store in memory whose saves wait for `release()` and which logs the order of its reads and writes. */
function gatedStore() {
  const log: string[] = []
  const files = new Map<string, StepUnderstandingDecision[]>()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const fileOf = (studyId: string): StepUnderstandingFile => ({
    version: 1,
    studyId,
    decisions: [...(files.get(studyId) ?? [])],
  })
  const store: StepDecisionStore = {
    readStepUnderstanding: async (studyId) => {
      log.push('read')
      return fileOf(studyId)
    },
    saveStepUnderstanding: async (studyId, change) => {
      log.push('save-start')
      await gate
      files.set(studyId, [...(files.get(studyId) ?? []), change])
      log.push('save-end')
      return fileOf(studyId)
    },
  }
  return { store, log, release, files }
}

function shownOf(studyId: string, store: StepDecisionStore): ShownReplaySteps {
  return {
    studyId,
    store,
    steps: [{ stepId: 'step-one', stepHash: STEP_HASH }],
    selectable: ['step-one'],
  }
}

const press = { stepId: 'step-one', understood: true }

// Value: protects=a read never returning older decisions than a write that completed before it, and reads that wait not stacking; fails_when=a refresh runs beside the save, or two refreshes queue two reads; no_claim=the Study message wording
test('a refresh while a save is held reads once, after the save, and shows the decision', async () => {
  // Arrange
  const { store, log, release } = gatedStore()
  const sessions = new StepUnderstandingSessions(() => undefined, String)
  const shown = shownOf(STUDY_A, store)
  sessions.view(shown)
  await waitUntil(
    () => sessions.view(shown)?.status === 'ready',
    'the first read ended',
    READER_RESULT_BOUND_MS,
  )

  // Act
  const saved = sessions.save({ studyId: STUDY_A, ...press }, shown, NOW)
  await waitUntil(
    () => log.includes('save-start'),
    'the save started',
    READER_RESULT_BOUND_MS,
  )
  sessions.refresh()
  sessions.refresh()
  release()
  await saved
  await sessions.settle()
  await waitUntil(
    () => log.filter((entry) => entry === 'read').length === 2,
    'the refresh read ended',
    READER_RESULT_BOUND_MS,
  )

  // Assert
  assert.deepEqual(log, ['read', 'save-start', 'save-end', 'read'])
  assert.equal(sessions.view(shown)?.steps[0]?.understood, true)
})

// Value: protects=a replay switch not reordering one replay's reads behind its in-flight save; fails_when=the re-attached session reads before the dropped session's save lands and shows the step unchecked; no_claim=the Study message wording
test('a replay shown again while its save is held shows the decision once the save lands, with no other trigger', async () => {
  // Arrange
  const { store, log, release } = gatedStore()
  const sessions = new StepUnderstandingSessions(() => undefined, String)
  const shown = shownOf(STUDY_A, store)
  sessions.view(shown)
  await waitUntil(
    () => sessions.view(shown)?.status === 'ready',
    'the first read ended',
    READER_RESULT_BOUND_MS,
  )
  const saved = sessions.save({ studyId: STUDY_A, ...press }, shown, NOW)
  await waitUntil(
    () => log.includes('save-start'),
    'the save started',
    READER_RESULT_BOUND_MS,
  )

  // Act: nothing is shown for a moment, then the same replay again, then the save lands.
  sessions.view(undefined)
  sessions.view(shown)
  release()
  await saved

  // Assert
  await waitUntil(
    () => sessions.view(shown)?.steps[0]?.understood === true,
    'the decision shows',
    READER_RESULT_BOUND_MS,
  )
  assert.deepEqual(log, ['read', 'save-start', 'save-end', 'read'])
})

// Value: protects=a late save of a replay that is no longer shown changing nothing shown; fails_when=the other replay shows the late decision or the late save publishes; no_claim=the file content (store tests)
test('a save that lands after another replay is shown changes nothing shown', async () => {
  // Arrange
  const { store, release, log } = gatedStore()
  let changes = 0
  const sessions = new StepUnderstandingSessions(() => changes++, String)
  const shownA = shownOf(STUDY_A, store)
  const shownB = shownOf(STUDY_B, store)
  sessions.view(shownA)
  await waitUntil(
    () => sessions.view(shownA)?.status === 'ready',
    'the first read ended',
    READER_RESULT_BOUND_MS,
  )
  const saved = sessions.save({ studyId: STUDY_A, ...press }, shownA, NOW)
  await waitUntil(
    () => log.includes('save-start'),
    'the save started',
    READER_RESULT_BOUND_MS,
  )
  sessions.view(shownB)
  await waitUntil(
    () => sessions.view(shownB)?.status === 'ready',
    'the other replay was read',
    READER_RESULT_BOUND_MS,
  )
  const changesBefore = changes

  // Act
  release()
  await saved

  // Assert
  assert.equal(changes, changesBefore)
  assert.equal(sessions.view(shownB)?.steps[0]?.understood, false)
})

// Value: protects=a closed workspace staying silent when a save ends late; fails_when=a save that ends after dispose calls changed; no_claim=the save still reaching the file (next test)
test('a save that ends after dispose does not ask for a new message', async () => {
  // Arrange
  const { store, release, log } = gatedStore()
  let changes = 0
  const sessions = new StepUnderstandingSessions(() => changes++, String)
  const shown = shownOf(STUDY_A, store)
  sessions.view(shown)
  await waitUntil(
    () => sessions.view(shown)?.status === 'ready',
    'the first read ended',
    READER_RESULT_BOUND_MS,
  )
  const saved = sessions.save({ studyId: STUDY_A, ...press }, shown, NOW)
  await waitUntil(
    () => log.includes('save-start'),
    'the save started',
    READER_RESULT_BOUND_MS,
  )
  sessions.dispose()
  const changesAtDispose = changes

  // Act
  release()
  await saved
  await sessions.settle()

  // Assert
  assert.equal(changes, changesAtDispose)
  assert.deepEqual(log, ['read', 'save-start', 'save-end'])
})

// Value: protects=a decision pressed just before a close reaching the file; fails_when=settle resolves while a save is held, or a disposed session's save is not waited for; no_claim=the workspace close calling settle (workspace test)
test('settle waits for a held save of a disposed session and the decision is in the file after it', async () => {
  // Arrange
  const { store, release, log, files } = gatedStore()
  const sessions = new StepUnderstandingSessions(() => undefined, String)
  const shown = shownOf(STUDY_A, store)
  sessions.view(shown)
  await waitUntil(
    () => sessions.view(shown)?.status === 'ready',
    'the first read ended',
    READER_RESULT_BOUND_MS,
  )
  void sessions.save({ studyId: STUDY_A, ...press }, shown, NOW)
  await waitUntil(
    () => log.includes('save-start'),
    'the save started',
    READER_RESULT_BOUND_MS,
  )
  sessions.dispose()
  let settled = false
  const settling = sessions.settle().then(() => {
    settled = true
  })

  // Act
  const settledWhileHeld = await Promise.race([
    settling.then(() => true),
    waitUntil(
      () => log.includes('save-start'),
      'the save is held',
      READER_RESULT_BOUND_MS,
    ).then(() => false),
  ])
  release()
  await settling

  // Assert
  assert.equal(settledWhileHeld, false)
  assert.equal(settled, true)
  assert.equal(files.get(STUDY_A)?.length, 1)
})
