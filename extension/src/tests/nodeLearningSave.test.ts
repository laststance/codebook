import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  NodeLearningSave,
  type NodeLearningSaveHost,
} from '../nodeLearningSave'
import type { NodeTestHistorySummary } from '../nodeTestHistoryStore'
import type { StudyRecord } from '../service'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111'
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const STUDY_ID = `${INSTANCE_ID}_${RUN_ID}`

/** A node-test run of two declared stops, as the service keeps it, with the given facts. */
function testRun(facts: Partial<StudyRecord> = {}): StudyRecord {
  return {
    id: RUN_ID,
    profile: 'node-test',
    stopped: false,
    nodePhase: 'paused',
    nodeStops: [{}],
    nodeHistoryWriter: {},
    nodeHistoryStatus: 'recording',
    nodePrepared: {
      configuration: { additionalStops: [{}] },
    },
    ...facts,
  } as unknown as StudyRecord
}

/** The store's summary of a sealed passing history whose two stops and result are explained. */
function summary(
  facts: Partial<NodeTestHistorySummary> = {},
): NodeTestHistorySummary {
  return {
    studyId: STUDY_ID,
    createdAt: '2026-10-22T00:00:00.000Z',
    profile: 'node-test',
    status: 'complete',
    verification: 'verified',
    testFile: 'src/scheduler.test.ts',
    testTitles: ['job scheduler', 'runs a delayed job after its timer'],
    verdict: 'Test passed · exit code 0',
    testResult: 'passed',
    stopCount: 2,
    explainedStopCount: 2,
    hasResult: true,
    learningCoverage: 'complete',
    learningMissing: [],
    captureMissing: [],
    materialRevision: 0,
    ...facts,
  }
}

/** A host that records what Save asks, notifies, opens and logs, with a stop that seals the run as the service would. */
function recordingHost(
  options: {
    answer?: string
    summaries?: (() => Promise<NodeTestHistorySummary | undefined>)[]
    stops?: ((record: StudyRecord) => Promise<void>)[]
  } = {},
) {
  const asked: string[] = [],
    notified: { severity: string; text: string; actions: readonly string[] }[] =
      [],
    opened: string[] = [],
    logged: CodebookDiagnostic[] = []
  let stopCalls = 0,
    summaryCalls = 0,
    seals = 0
  const sealPassing = async (record: StudyRecord): Promise<void> => {
    // The service seals a run once; a later stop of a stopped run returns at once.
    if (record.stopped) return
    seals++
    record.stopped = true
    record.nodeHistoryStatus = 'complete'
  }
  const host: NodeLearningSaveHost = {
    service: () => ({
      instanceId: INSTANCE_ID,
      causeRoots: { storage: ['/Users/ada/Library/codebook'] },
      stop: async ({ runId }) => {
        const stop = options.stops?.[stopCalls] ?? sealPassing
        stopCalls++
        await stop(currentRecord!)
        return { runId } as never
      },
    }),
    store: () => ({
      summarize: async () => {
        const read =
          options.summaries?.[summaryCalls] ?? (async () => summary())
        summaryCalls++
        return read()
      },
    }),
    ask: async (text) => {
      asked.push(text)
      return options.answer
    },
    notify: async (severity, text, actions) => {
      notified.push({ severity, text, actions })
      return undefined
    },
    open: async (studyId) => {
      opened.push(studyId)
    },
    log: (entry) => logged.push(entry),
    changed: () => undefined,
  }
  let currentRecord: StudyRecord | undefined
  return {
    host,
    asked,
    notified,
    opened,
    logged,
    use: (record: StudyRecord): void => {
      currentRecord = record
    },
    stopCalls: () => stopCalls,
    summaryCalls: () => summaryCalls,
    seals: () => seals,
  }
}

// Value: protects=the Save item before the first stop and during the run: preparing with no command, then the stops reached with Save; fails_when=preparing offers Save for an empty journal or the live text loses its stop count; why_new=a test run had no Save item (C49-2, DS8, EN1, AC3); seam=none; no_claim=the status bar's drawing
test('the Save item reads preparing before the first stop, then the stops reached with Save', () => {
  // Arrange
  const recorder = recordingHost()
  const save = new NodeLearningSave(recorder.host)

  // Act
  const preparing = save.item(
    testRun({ nodeStops: [], nodePhase: 'preparing' }),
  )
  const live = save.item(testRun())

  // Assert
  assert.deepEqual(preparing, {
    text: '$(sync~spin) Preparing the test run…',
    tooltip:
      'Codebook is preparing the test run; Save learning replay appears once the first stop is recorded.',
  })
  assert.equal(
    live?.text,
    '$(record) Recording explanation · stop 1 of 2 · Save learning replay',
  )
  assert.deepEqual(live?.command, {
    title: 'Save learning replay',
    command: 'codebook.saveLearningReplay',
    arguments: [STUDY_ID],
  })
})

// Value: protects=the question before the result, and Cancel leaving the run as it was; fails_when=Save ends a live test without asking or a Cancel still stops it; why_new=Save ended a live test silently (DS8, AC3); seam=the modal answer is the test's; no_claim=the host's dialog
test('Save before the result asks first, and Cancel leaves the run running', async () => {
  // Arrange
  const recorder = recordingHost({ answer: undefined })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun()
  recorder.use(record)

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(recorder.asked, [
    'Saving ends the test run before its result (1 of 2 stops reached). Save now?',
  ])
  assert.equal(recorder.stopCalls(), 0)
  assert.equal(record.stopped, false)
})

// Value: protects=Save after the result: no question, the stop seals the run and the item ends saved with Open replay; fails_when=a finished run is asked again, or a complete passing history with every stop explained reads partially saved; why_new=C49-2 (AC3); seam=the service's stop and the store's summary are fakes; no_claim=the seal itself (service tests)
test('Save after the result asks nothing and ends saved with every stop explained and Open replay', async () => {
  // Arrange
  const recorder = recordingHost({
    summaries: [async () => summary({ materialRevision: 1 })],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({
    nodePhase: 'completed',
    nodeLearning: {
      needs: { stopSequences: [2, 3], resultSequence: 4 },
      materialRevision: 1,
      missing: [],
      coverage: 'complete',
    },
  })
  recorder.use(record)

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(recorder.asked, [])
  assert.deepEqual(save.item(record), {
    text: '$(check) Learning saved · Open replay',
    tooltip:
      'Saved: Test passed · exit code 0 · capture complete · 2 of 2 stops explained. Opens the test replay.',
    command: {
      title: 'Open replay',
      command: 'codebook.openLearningReplay',
      arguments: [STUDY_ID],
    },
  })
  assert.deepEqual(recorder.notified, [])
})

// Value: protects=a partial save naming each missing part in order, and one warning that asks the chat only for explanation gaps and offers Open replay; fails_when=a part is dropped, a capture gap is offered to the chat, or the notification is missing; why_new=Save had one sentence for every gap (DS9, X3, AC3); seam=the store's summary is a fake; no_claim=the host's notification look
test('a partially saved test replay names each missing part and raises one notification that asks the chat only for explanations', async () => {
  // Arrange
  const recorder = recordingHost({
    summaries: [
      async () =>
        summary({
          learningCoverage: 'partial',
          learningMissing: [{ kind: 'stop', stop: 2 }],
          captureMissing: [{ kind: 'stop-state', stop: 1 }],
          explainedStopCount: 1,
        }),
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ stopped: true, nodePhase: 'completed' })
  recorder.use(record)

  // Act
  await save.save(record)

  // Assert
  const item = save.item(record)
  assert.equal(item?.text, '$(warning) Learning partially saved · Open replay')
  assert.equal(
    item?.tooltip,
    'Saved available learning · Test passed · exit code 0 · Missing: an explanation step for stop 2, recorded debugger state of stop 1. Open replay to inspect retained evidence.',
  )
  assert.deepEqual(recorder.notified, [
    {
      severity: 'warning',
      text: 'Learning partially saved. Ask the chat for an explanation step for stop 2, then save again. Not recorded: recorded debugger state of stop 1. An explanation cannot add them; only a new test run records them.',
      actions: ['Open replay'],
    },
  ])
})

// Value: protects=a failing test whose replay lacks nothing: partially saved with its verdict only, and a notification that says the test did not pass; fails_when=a failing test reads saved, or reads "Missing" with nothing missing; why_new=a failing test read as missing evidence (DS9, X16); seam=the run's result and the store's summary are fakes; no_claim=none beyond protects
test('a failing test with nothing missing is partially saved with its verdict only', async () => {
  // Arrange
  const recorder = recordingHost({
    summaries: [
      async () =>
        summary({
          verdict: 'Test failed · exit code 1',
          testResult: 'failed',
          status: 'partial',
        }),
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({
    stopped: true,
    nodePhase: 'completed',
    nodeResult: { exitCode: 1, signal: null, output: '', elapsedMs: 40 },
  })
  recorder.use(record)

  // Act
  await save.save(record)

  // Assert
  assert.equal(
    save.item(record)?.tooltip,
    'Saved available learning · Test failed · exit code 1. Open replay to inspect retained evidence.',
  )
  assert.equal(
    recorder.notified[0]?.text,
    'Learning partially saved. The test did not pass (exit code 1); the replay holds the failing run.',
  )
})

// Value: protects=a rejected stop: the item says the stop did not finish with its sanitized cause, one Output entry is written, and Retry stops again; fails_when=the failure reads like another stage, the cause shows the storage path, or Retry does not stop again; why_new=Save had one failed state (X6, AC3, AC17); seam=the service's first stop rejects; no_claim=why a real release fails
test('a rejected stop ends at Retry with its cause, and Retry stops again', async () => {
  // Arrange
  const recorder = recordingHost({
    stops: [
      async () => {
        throw new Error(
          "process group still running in '/Users/ada/Library/codebook/agent'",
        )
      },
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodePhase: 'completed' })
  recorder.use(record)

  // Act
  await save.save(record)
  const rejected = save.item(record)
  await save.save(record)

  // Assert
  assert.deepEqual(rejected, {
    text: '$(error) Learning save failed · Retry',
    tooltip:
      "Learning save failed: stopping the test run did not finish (process group still running in '<storage>/agent'). What was recorded is kept; click to stop it again. Details: Output › Codebook.",
    command: {
      title: 'Retry',
      command: 'codebook.saveLearningReplay',
      arguments: [STUDY_ID],
    },
  })
  assert.deepEqual(
    recorder.logged.map((entry) => [entry.surface, entry.studyId, entry.cause]),
    [
      [
        'save:stop-rejected',
        STUDY_ID,
        "process group still running in '<storage>/agent'",
      ],
    ],
  )
  assert.equal(recorder.stopCalls(), 2)
  assert.equal(save.item(record)?.text, '$(check) Learning saved · Open replay')
})

// Value: protects=a read after the seal that failed: Retry reads again and never seals a second time; fails_when=Retry seals again or does not read again; why_new=X6 (S2-2, AC3); seam=the store's first read rejects; no_claim=the store's own read errors
test('a read after the seal that failed ends at Retry, and Retry reads again without a second seal', async () => {
  // Arrange
  const recorder = recordingHost({
    summaries: [
      async () => {
        throw new Error('EACCES: permission denied, open sealed.json')
      },
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodePhase: 'completed' })
  recorder.use(record)

  // Act
  await save.save(record)
  const failed = save.item(record)
  await save.save(record)

  // Assert
  assert.equal(failed?.text, '$(error) Learning save failed · Retry')
  assert.equal(
    failed?.tooltip,
    'Learning save failed: the test history was sealed but could not be read back (EACCES: permission denied, open sealed.json). Click to read it again; the test does not run again. Details: Output › Codebook.',
  )
  assert.equal(recorder.seals(), 1)
  assert.equal(recorder.summaryCalls(), 2)
  assert.equal(save.item(record)?.text, '$(check) Learning saved · Open replay')
})

// Value: protects=a failed seal: the item opens the retained history instead of saving again, and Save writes no second Output entry for what the service reported; fails_when=a failed seal offers Retry or reads saved; why_new=X6 (AC3); seam=the service's stop leaves the history failed; no_claim=the open itself (workspace tests)
test('a failed seal ends at Open retained history', async () => {
  // Arrange
  const recorder = recordingHost({
    stops: [
      async (record): Promise<void> => {
        record.stopped = true
        record.nodeHistoryStatus = 'failed'
        record.nodeHistoryFailure = 'ENOSPC: no space left on device, write'
      },
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodePhase: 'completed' })
  recorder.use(record)

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(save.item(record), {
    text: '$(error) Learning save failed · Open retained history',
    tooltip:
      'Learning save failed: the test history could not be sealed (ENOSPC: no space left on device, write). The run is stopped; its recorded part opens read-only. Details: Output › Codebook.',
    command: {
      title: 'Open retained history',
      command: 'codebook.openLearningReplay',
      arguments: [STUDY_ID],
    },
  })
  assert.deepEqual(recorder.logged, [])
  assert.equal(recorder.summaryCalls(), 0)
})

// Value: protects=a click while a Save runs, which returns that Save instead of starting another; fails_when=a second click stops the run again; why_new=C49-2 (AC3); seam=the service's stop is held; no_claim=none beyond protects
test('a click while a Save runs returns that Save', async () => {
  // Arrange
  let releaseStop!: () => void
  const recorder = recordingHost({
    stops: [
      (record): Promise<void> =>
        new Promise<void>((resolve) => {
          releaseStop = (): void => {
            record.stopped = true
            record.nodeHistoryStatus = 'complete'
            resolve()
          }
        }),
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodePhase: 'completed' })
  recorder.use(record)

  // Act
  const first = save.save(record)
  const second = save.save(record)
  const saving = save.item(record)
  releaseStop()
  await Promise.all([first, second])

  // Assert
  assert.equal(first, second)
  assert.equal(saving?.text, '$(sync~spin) Saving learning…')
  assert.equal(saving?.command, undefined)
  assert.equal(recorder.stopCalls(), 1)
})

// Value: protects=that a Save receipt never vouches for a later learning material revision: the item returns to Save; fails_when=the item keeps "Learning saved" after the chat saved another revision; why_new=the browser save's signature rule, for the material revision (Design 2, AC3); seam=none; no_claim=how the revision changes (service tests)
test('a later learning material revision returns the item to Save', async () => {
  // Arrange
  const recorder = recordingHost({
    summaries: [async () => summary({ materialRevision: 1 })],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({
    nodePhase: 'completed',
    nodeLearning: {
      needs: { stopSequences: [2, 3], resultSequence: 4 },
      materialRevision: 1,
      missing: [],
      coverage: 'complete',
    },
  })
  recorder.use(record)
  await save.save(record)

  // Act
  record.nodeLearning = { ...record.nodeLearning!, materialRevision: 2 }
  const item = save.item(record)

  // Assert
  assert.equal(item?.text, '$(save) Recording finished · Save learning replay')
  assert.equal(item?.command?.command, 'codebook.saveLearningReplay')
})

// Value: protects=that a run refused before its history began shows no Save item; fails_when=a refused run offers to save nothing; why_new=EN1; seam=none; no_claim=none beyond protects
test('a run refused before its history began shows no Save item', () => {
  // Arrange
  const save = new NodeLearningSave(recordingHost().host)

  // Act
  const item = save.item(
    testRun({
      stopped: true,
      nodeStops: [],
      nodeHistoryWriter: undefined,
      historyExcluded: 'refused-at-preparation',
    }),
  )

  // Assert
  assert.equal(item, undefined)
})

// Value: protects=a test run stopped before its history began (stopped during its preparation, with no history writer and no exclusion) and a history that sealed with no entry: no Save item, and a Save from the palette reads no history and writes no Output entry; fails_when=the item reads Recording finished · Save learning replay for a run that recorded nothing, or its Save ends at Learning save failed · Retry with an Output entry per click; why_new=the only test of a run that recorded nothing sets historyExcluded (Step 9 state-machines, wrong row; Issue #107 F8); seam=none; no_claim=the status bar's drawing (the workspace wires the item)
test('a run that recorded nothing shows no Save item, and its Save reads no history', async () => {
  // Arrange
  const recorder = recordingHost()
  const save = new NodeLearningSave(recorder.host)
  const stoppedBeforeHistory = testRun({
    stopped: true,
    nodePhase: 'preparing',
    nodeStops: [],
    nodeHistoryWriter: undefined,
    nodeHistoryStatus: undefined,
  })
  const sealedWithNoEntry = testRun({
    stopped: true,
    nodePhase: 'failed',
    nodeStops: [],
    nodeHistoryStatus: 'partial',
    nodeHistoryEntryCount: 0,
  })
  recorder.use(stoppedBeforeHistory)

  // Act
  const items = [save.item(stoppedBeforeHistory), save.item(sealedWithNoEntry)]
  const saved = await Promise.resolve()
    .then(() => save.save(stoppedBeforeHistory))
    .then(
      () => 'saved',
      (error: unknown) => (error instanceof Error ? error.message : 'refused'),
    )

  // Assert
  assert.deepEqual(items, [undefined, undefined])
  assert.equal(
    saved,
    'No recorded Codebook session is available. Explain a real code path first.',
  )
  assert.equal(recorder.stopCalls(), 0)
  assert.equal(recorder.summaryCalls(), 0)
  assert.deepEqual(recorder.logged, [])
})
