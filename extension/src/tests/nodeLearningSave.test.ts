import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import {
  NodeLearningSave,
  type NodeLearningSaveHost,
} from '../nodeLearningSave'
import type { NodeTestHistorySummary } from '../nodeTestHistoryStore'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { StudyRecord } from '../service'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111'
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const STUDY_ID = `${INSTANCE_ID}_${RUN_ID}`
/** How long a test waits for work the Save leaves running after it returns; a break of the product fails within it. */
const AWAITED_EFFECT_BOUND_MS = 3_000

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
    /** What the notification's action prompt answers (the action the learner clicks). */
    notifyAnswer?: string
    /** Makes the host's open reject with this error. */
    openFails?: Error
    /** The material revision the store's summary projection lists; `undefined` while the history is not listed. */
    storeRevision?: () => number | undefined
  } = {},
) {
  const asked: string[] = [],
    askedActions: (readonly string[])[] = [],
    notified: { severity: string; text: string; actions: readonly string[] }[] =
      [],
    opened: string[] = [],
    logged: CodebookDiagnostic[] = []
  /** Waits, within a bound, until the host's open was called; the work a notification's action starts after the Save returned. Rejects naming the missing open when the bound passes, so a broken product fails instead of hanging. */
  const whenOpened = (): Promise<boolean> =>
    waitUntil(
      () => opened.length > 0,
      'the host’s open of the test replay',
      AWAITED_EFFECT_BOUND_MS,
    )
  /** Waits, within a bound, until the host logged `count` entries; the work a Save leaves running after it returns. Rejects naming the missing entry when the bound passes. */
  const whenLogged = (count: number): Promise<boolean> =>
    waitUntil(
      () => logged.length >= count,
      `${count} Output entries from the Save`,
      AWAITED_EFFECT_BOUND_MS,
    )
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
    ask: async (text, actions) => {
      asked.push(text)
      askedActions.push(actions)
      return options.answer
    },
    notify: async (severity, text, actions) => {
      notified.push({ severity, text, actions })
      return options.notifyAnswer
    },
    materialRevision: () => options.storeRevision?.(),
    open: async (studyId) => {
      opened.push(studyId)
      if (options.openFails) throw options.openFails
    },
    log: (entry) => {
      logged.push(entry)
    },
    changed: () => undefined,
  }
  let currentRecord: StudyRecord | undefined
  return {
    host,
    asked,
    askedActions,
    whenLogged,
    whenOpened,
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

// Value: protects=a Save now answered at a stop whose stop seals its history with no entry (the entry was lost before the seal): the Save ends as for a run that recorded nothing (the refusal, no receipt, no partial notice with Open replay, no item); fails_when=the Save reads the empty sealed history and keeps a partial receipt or raises the partial notice whose Open replay opens nothing; why_new=the recorded-nothing test refuses a run already sealed empty before any stop, and every question test saves a run whose stop seals entries (Step 9 pass 2 state-machines, wrong row; a Save before the first stop is refused now, D9); seam=none; no_claim=the real seal (the stop is a stand-in that seals no entry)
test('Save now at a stop whose stop seals no entry ends as for a run that recorded nothing', async () => {
  // Arrange
  const recorder = recordingHost({
    answer: 'Save now',
    stops: [
      async (record): Promise<void> => {
        record.stopped = true
        record.nodeHistoryStatus = 'partial'
        record.nodeHistoryEntryCount = 0
      },
    ],
    summaries: [
      async () =>
        summary({
          status: 'partial',
          verdict: 'No result recorded',
          testResult: 'none',
          stopCount: 0,
          explainedStopCount: 0,
          learningCoverage: 'none',
          learningMissing: [{ kind: 'summary' }],
          captureMissing: [{ kind: 'execution' }],
        }),
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun()
  recorder.use(record)

  // Act
  const outcome = await save.save(record).then(
    () => 'saved',
    (error: unknown) => (error instanceof Error ? error.message : 'refused'),
  )

  // Assert
  assert.deepEqual(recorder.asked, [
    'Saving ends the test run before its result (1 of 2 stops reached). Save now?',
  ])
  assert.equal(recorder.stopCalls(), 1)
  assert.equal(
    outcome,
    'No recorded Codebook session is available. Explain a real code path first.',
  )
  assert.equal(recorder.summaryCalls(), 0)
  assert.deepEqual(recorder.notified, [])
  assert.equal(save.item(record), undefined)
})

// Value: protects=the Retry of a Save whose stop was rejected before the result: it stops the run again without asking again, as its tooltip says ("click to stop it again"), since the rejected stop began the run's release and the run can no longer reach its result; fails_when=the Retry asks "Save now?" again, so a Cancel leaves a run that can neither continue nor be saved; why_new=the only Retry of a rejected stop uses a run past its result, which takes no question (Step 9 pass 3 state-machines, wrong row; Issue #107 F54); seam=none; no_claim=the real release (the stop is a stand-in that keeps the release's failure on the run as the service does)
test('the Retry of a stop rejected before the result stops the run again without asking again', async () => {
  // Arrange
  const recorder = recordingHost({
    answer: 'Save now',
    stops: [
      async (record): Promise<void> => {
        // The service keeps the release's failure on the run before it rejects the stop.
        record.cleanupError = new StudyError(
          'RUNTIME_FAILED',
          'process group still running',
        )
        throw new Error('process group still running')
      },
      async (record): Promise<void> => {
        record.stopped = true
        record.cleanupError = undefined
        record.nodeHistoryStatus = 'partial'
        record.nodeHistoryEntryCount = 2
      },
    ],
    summaries: [
      async () =>
        summary({
          status: 'partial',
          verdict: 'No result recorded',
          testResult: 'none',
          stopCount: 1,
          explainedStopCount: 0,
          learningCoverage: 'none',
          learningMissing: [{ kind: 'summary' }, { kind: 'stop', stop: 1 }],
          captureMissing: [{ kind: 'execution' }],
        }),
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun()
  recorder.use(record)
  await save.save(record)
  const afterRejectedStop = save.item(record)?.text

  // Act
  await save.save(record)

  // Assert
  assert.equal(afterRejectedStop, '$(error) Learning save failed · Retry')
  assert.equal(recorder.asked.length, 1)
  assert.equal(recorder.stopCalls(), 2)
  assert.equal(
    save.item(record)?.text,
    '$(warning) Learning partially saved · Open replay',
  )
})

/** A partial summary that lacks the explanation of stop 2, as a chat that explained only stop 1 leaves it. */
function summaryMissingStopTwo(
  facts: Partial<NodeTestHistorySummary> = {},
): NodeTestHistorySummary {
  return summary({
    learningCoverage: 'partial',
    learningMissing: [{ kind: 'stop', stop: 2 }],
    explainedStopCount: 1,
    ...facts,
  })
}

// Value: protects=a Save before the first stop (the palette command, or a click while the journal holds only preparation output): it does nothing, says there is nothing to save yet, asks no question and leaves the preparing run running; fails_when=the Save asks "Save now?", stops the preparing run, or seals a partial history of boilerplate output; why_new=a Save during preparation ended the agent's run and left an error the skill read as a refusal (F89, D9; matrix cells preparing x save-now, preparing x cancel and preparing-empty x cancel are this refusal); seam=the service's stop is counted; no_claim=the real preparation
test('Save before the first stop does nothing, says there is nothing to save yet and leaves the run preparing', async () => {
  // Arrange
  const recorder = recordingHost({ answer: 'Save now' })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodeStops: [], nodePhase: 'preparing' })
  recorder.use(record)

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(recorder.asked, [])
  assert.equal(recorder.stopCalls(), 0)
  assert.equal(record.stopped, false)
  assert.deepEqual(recorder.notified, [
    {
      severity: 'information',
      text: 'Nothing to save yet: the test run has not reached its first stop.',
      actions: [],
    },
  ])
  assert.equal(save.item(record)?.text, '$(sync~spin) Preparing the test run…')
})

// Value: protects=the Retry row of a rejected stop following the run: once a later codebook_stop released and sealed the run, the item reads Recording finished with Save instead of Retry; fails_when=the item keeps "Learning save failed · Retry" for a run that is stopped and sealed; why_new=the status item kept a Save state that a change outside Save made stale (F90); seam=the service's first stop rejects, then the run is sealed as codebook_stop does; no_claim=codebook_stop itself (service tests)
test('the Retry row of a rejected stop reads Recording finished once codebook_stop sealed the run', async () => {
  // Arrange
  const recorder = recordingHost({
    stops: [
      async (record): Promise<void> => {
        record.cleanupError = new StudyError(
          'RUNTIME_FAILED',
          'process group still running',
        )
        throw new Error('process group still running')
      },
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodePhase: 'completed' })
  recorder.use(record)
  await save.save(record)
  const rejected = save.item(record)?.text

  // Act
  record.cleanupError = undefined
  record.stopped = true
  record.nodeHistoryStatus = 'complete'
  const afterStop = save.item(record)

  // Assert
  assert.equal(rejected, '$(error) Learning save failed · Retry')
  assert.equal(
    afterStop?.text,
    '$(save) Recording finished · Save learning replay',
  )
  assert.equal(afterStop?.command?.title, 'Save learning replay')
})

/**
 * Saves a run that ended before its first stop and reports what the learner is told.
 * @param facts - The run's facts that make it end before its first stop.
 * @returns The outcome of the Save, the notifications and the stop calls.
 * @example const { outcome } = await saveEndedRun({ nodePhase: 'failed' })
 */
async function saveEndedRun(facts: Partial<StudyRecord>) {
  const recorder = recordingHost({
    stops: [
      async (record): Promise<void> => {
        // The stop seals a history that holds no entry, as a release of a run that never stopped does.
        record.stopped = true
        record.nodeHistoryStatus = 'partial'
        record.nodeHistoryEntryCount = 0
      },
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodeStops: [], ...facts })
  recorder.use(record)
  const outcome = await Promise.resolve()
    .then(() => save.save(record))
    .then(
      () => 'saved',
      (error: unknown) => (error instanceof Error ? error.message : 'refused'),
    )
  return { outcome, recorder }
}

const NOTHING_RECORDED_SENTENCE =
  'No recorded Codebook session is available. Explain a real code path first.'

// Value: protects=Save on a run whose continuation failed before its first stop: it is answered as a run that recorded nothing, not as "Nothing to save yet" (which names no way forward); fails_when=the Save says the run has not reached its first stop although it never will; why_new=Save tested the preparing state before the ended states (F221); seam=the service's stop seals no entry; no_claim=the real release
test('Save on a run whose continuation failed before its first stop is answered as a run that recorded nothing', async () => {
  // Arrange / Act
  const { outcome, recorder } = await saveEndedRun({ nodePhase: 'failed' })

  // Assert
  assert.equal(outcome, NOTHING_RECORDED_SENTENCE)
  assert.deepEqual(recorder.notified, [])
  assert.deepEqual(recorder.asked, [])
})

// Value: protects=Save on a run whose stop failed before its first stop (a release error stands): it is answered as a run that recorded nothing; fails_when=the Save says the run has not reached its first stop; why_new=F221; seam=the service's stop seals no entry; no_claim=the real release
test('Save on a run whose stop failed before its first stop is answered as a run that recorded nothing', async () => {
  // Arrange / Act
  const { outcome, recorder } = await saveEndedRun({
    cleanupError: new StudyError('RUNTIME_FAILED', 'process group running'),
  })

  // Assert
  assert.equal(outcome, NOTHING_RECORDED_SENTENCE)
  assert.deepEqual(recorder.notified, [])
  assert.deepEqual(recorder.asked, [])
})

// Value: protects=Save on a run refused at preparation that is not marked stopped: it is answered as a run that recorded nothing, with no stop; fails_when=the Save says the run has not reached its first stop; why_new=F221; seam=none; no_claim=the refusal itself (service tests)
test('Save on a run refused at preparation is answered as a run that recorded nothing', async () => {
  // Arrange / Act
  const { outcome, recorder } = await saveEndedRun({
    historyExcluded: 'refused-at-preparation',
  })

  // Assert
  assert.equal(outcome, NOTHING_RECORDED_SENTENCE)
  assert.deepEqual(recorder.notified, [])
  assert.equal(recorder.stopCalls(), 0)
})

// Value: protects=a run that ended before its first stop (its continuation failed, or its stop failed and left a release error) showing no Preparing item; fails_when=the item keeps "Preparing the test run…" for a run that is dead; why_new=Preparing stayed for a dead run whose stop failed (F90); seam=none; no_claim=how the run reports its failure (service tests)
test('a run that ended before its first stop shows no Preparing item', () => {
  // Arrange
  const save = new NodeLearningSave(recordingHost().host)
  const failedContinuation = testRun({ nodeStops: [], nodePhase: 'failed' })
  const failedStop = testRun({
    nodeStops: [],
    nodePhase: 'preparing',
    cleanupError: new StudyError('RUNTIME_FAILED', 'process group running'),
  })

  // Act
  const items = [save.item(failedContinuation), save.item(failedStop)]

  // Assert
  assert.deepEqual(items, [undefined, undefined])
})

// Value: protects=a Save receipt that compares with the store's material revision (the summary projection the library lists), so material another window saved, which this window's cache never sees, does not return the saved item to Save, while a later store revision still does; fails_when=the item returns to Save right after a Save because this window's cache says revision 0 while the store says 2, or it keeps "Learning saved" after the store moved on; why_new=the receipt held only while its revision equalled this window's cache (F52, D10); seam=the store's revision is a fake that this test moves; no_claim=how the library lists the revision (store tests)
test('a Save receipt holds against the store revision that another window moved, and a later store revision returns the item to Save', async () => {
  // Arrange
  let storeRevision: number | undefined = 2
  const recorder = recordingHost({
    summaries: [async () => summary({ materialRevision: 2 })],
    storeRevision: () => storeRevision,
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({
    nodePhase: 'completed',
    nodeLearning: {
      needs: { stopSequences: [2, 3], resultSequence: 4 },
      materialRevision: 0,
      missing: [],
      coverage: 'none',
    },
  })
  recorder.use(record)

  // Act
  await save.save(record)
  const afterSave = save.item(record)?.text
  storeRevision = 3
  const afterLaterRevision = save.item(record)?.text

  // Assert
  assert.equal(afterSave, '$(check) Learning saved · Open replay')
  assert.equal(
    afterLaterRevision,
    '$(save) Recording finished · Save learning replay',
  )
})

// Value: protects=partial x Save: a later material revision returns a partially saved item to Save, and Save then reads the new revision and ends saved; fails_when=the partial receipt keeps vouching after the chat saved the missing explanation, or the next Save stays partial; why_new=partial x Save was untested (F53, F70); seam=the store's revision and summaries are fakes; no_claim=the notification's look
test('a later material revision returns a partially saved item to Save, and Save then ends saved', async () => {
  // Arrange
  let storeRevision: number | undefined = 1
  const recorder = recordingHost({
    summaries: [
      async () => summaryMissingStopTwo({ materialRevision: 1 }),
      async () => summary({ materialRevision: 2 }),
    ],
    storeRevision: () => storeRevision,
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ stopped: true, nodePhase: 'completed' })
  recorder.use(record)
  await save.save(record)
  const partial = save.item(record)?.text

  // Act
  storeRevision = 2
  const returned = save.item(record)?.text
  await save.save(record)

  // Assert
  assert.equal(partial, '$(warning) Learning partially saved · Open replay')
  assert.equal(returned, '$(save) Recording finished · Save learning replay')
  assert.equal(save.item(record)?.text, '$(check) Learning saved · Open replay')
})

// Value: protects=saved-revised x Save: after the store's revision moved, Save reads the new revision without asking and without a second seal, and ends saved for it; fails_when=the Save asks again, seals again, or the item stays at Save; why_new=saved-revised x Save was untested (F70); seam=the store's revision and summaries are fakes; no_claim=none beyond protects
test('Save after the revision moved reads the new revision without a second seal', async () => {
  // Arrange
  let storeRevision: number | undefined = 1
  const recorder = recordingHost({
    summaries: [
      async () => summary({ materialRevision: 1 }),
      async () => summary({ materialRevision: 2 }),
    ],
    storeRevision: () => storeRevision,
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodePhase: 'completed' })
  recorder.use(record)
  await save.save(record)
  storeRevision = 2

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(recorder.asked, [])
  assert.equal(recorder.seals(), 1)
  assert.equal(recorder.summaryCalls(), 2)
  assert.equal(save.item(record)?.text, '$(check) Learning saved · Open replay')
})

// Value: protects=saved x Save: a Save of an item already saved asks nothing, seals nothing again, reads the history once more and stays saved with no notification; fails_when=the second Save asks, seals again or raises a notification; why_new=saved x Save was untested (F70); seam=the service's stop is a fake that seals once; no_claim=none beyond protects
test('Save of an already saved test run asks nothing, seals nothing again and stays saved', async () => {
  // Arrange
  const recorder = recordingHost()
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodePhase: 'completed' })
  recorder.use(record)
  await save.save(record)

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(recorder.asked, [])
  assert.equal(recorder.seals(), 1)
  assert.equal(recorder.summaryCalls(), 2)
  assert.deepEqual(recorder.notified, [])
  assert.equal(save.item(record)?.text, '$(check) Learning saved · Open replay')
})

// Value: protects=partial x Save: saving a partially saved run again raises the partial notice again, so the learner is told what is still missing; fails_when=the second Save is silent; why_new=partial x Save raised its notice once in the only test (F70); seam=the store's summaries are fakes; no_claim=the notification's look
test('Save of a partially saved test run raises the partial notice again', async () => {
  // Arrange
  const recorder = recordingHost({
    summaries: [
      async () => summaryMissingStopTwo(),
      async () => summaryMissingStopTwo(),
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ stopped: true, nodePhase: 'completed' })
  recorder.use(record)
  await save.save(record)

  // Act
  await save.save(record)

  // Assert
  assert.equal(recorder.notified.length, 2)
  assert.equal(recorder.notified[1]?.text, recorder.notified[0]?.text)
  assert.equal(recorder.seals(), 0)
})

// Value: protects=seal-failed x Save: a Save of a run whose history could not be sealed seals nothing again, reads nothing, writes no second Output entry and keeps Open retained history; fails_when=the Save reads the unsealed history, seals again or turns the item into Retry; why_new=seal-failed x Save was untested (F70); seam=the first stop leaves the history failed as the service does; no_claim=the open itself (workspace tests)
test('Save of a run whose seal failed seals nothing again and keeps Open retained history', async () => {
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
  await save.save(record)

  // Act
  await save.save(record)

  // Assert
  assert.equal(recorder.seals(), 0)
  assert.equal(recorder.summaryCalls(), 0)
  assert.deepEqual(recorder.logged, [])
  assert.equal(
    save.item(record)?.text,
    '$(error) Learning save failed · Open retained history',
  )
})

// Value: protects=sealed-without-entry x Save: a Save of a run whose history sealed with no entry is refused as for a run that recorded nothing, with no stop, no read and no Output entry; fails_when=the Save reads an empty history or stops again; why_new=only a run stopped before its history was saved through the command (F70); seam=none; no_claim=none beyond protects
test('Save of a run whose history sealed with no entry is refused and reads nothing', async () => {
  // Arrange
  const recorder = recordingHost()
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({
    stopped: true,
    nodePhase: 'failed',
    nodeStops: [],
    nodeHistoryStatus: 'partial',
    nodeHistoryEntryCount: 0,
  })
  recorder.use(record)

  // Act
  const outcome = await Promise.resolve()
    .then(() => save.save(record))
    .then(
      () => 'saved',
      (error: unknown) => (error instanceof Error ? error.message : 'refused'),
    )

  // Assert
  assert.equal(
    outcome,
    'No recorded Codebook session is available. Explain a real code path first.',
  )
  assert.equal(recorder.stopCalls(), 0)
  assert.equal(recorder.summaryCalls(), 0)
  assert.deepEqual(recorder.logged, [])
})

// Value: protects=advancing x Cancel: a Save answered with Cancel while the run advances between stops leaves it advancing, with no stop; fails_when=a Cancel stops the advancing run; why_new=advancing x Save was untested (F70); seam=the modal answer is the test's; no_claim=the host's dialog
test('Cancel on the Save question while the run advances leaves it running', async () => {
  // Arrange
  const recorder = recordingHost({ answer: undefined })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodePhase: 'advancing' })
  recorder.use(record)

  // Act
  await save.save(record)

  // Assert
  assert.equal(recorder.asked.length, 1)
  assert.equal(recorder.stopCalls(), 0)
  assert.equal(record.stopped, false)
})

// Value: protects=advancing x Save now: a Save now while the run advances between stops stops it, seals the stops reached and ends saved; fails_when=the stop is skipped or the receipt is missing; why_new=advancing x Save was untested (F70); seam=the service's stop is a fake that seals; no_claim=the real continuation (service tests)
test('Save now while the run advances stops it and saves the stops reached', async () => {
  // Arrange
  const recorder = recordingHost({ answer: 'Save now' })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodePhase: 'advancing' })
  recorder.use(record)

  // Act
  await save.save(record)

  // Assert
  assert.equal(recorder.stopCalls(), 1)
  assert.equal(record.stopped, true)
  assert.equal(save.item(record)?.text, '$(check) Learning saved · Open replay')
})

// Value: protects=another run's Save in flight: a Save for a different test run is refused at once, synchronously, with the wait-for-the-result sentence, and the first Save is unharmed; fails_when=a second run's Save starts, stops its run, or waits silently; why_new=the guard had no test (F19, gap E2); seam=the first run's stop is held; no_claim=none beyond protects
test('a Save for another test run while one Save runs is refused at once', async () => {
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
  const first = testRun({ nodePhase: 'completed' })
  const other = testRun({
    id: '33333333-3333-4333-8333-333333333333',
    nodePhase: 'completed',
  })
  recorder.use(first)
  const firstSave = save.save(first)

  // Act
  const refusal = (() => {
    try {
      void save.save(other)
      return 'accepted'
    } catch (error) {
      return error instanceof Error ? error.message : 'refused'
    }
  })()
  releaseStop()
  await firstSave

  // Assert
  assert.equal(
    refusal,
    'Another learning session is being saved. Wait for its result.',
  )
  assert.equal(recorder.stopCalls(), 1)
  assert.equal(save.item(first)?.text, '$(check) Learning saved · Open replay')
})

// Value: protects=a failed seal shown before any click: when the service already failed to seal the history, the item reads Open retained history with the cause and no Save has run; fails_when=the item offers Save for a history that cannot be sealed; why_new=the failed seal was only reached through a Save click (F19, gap E2); seam=none; no_claim=the open itself (workspace tests)
test('a failed seal is shown as Open retained history before any Save click', () => {
  // Arrange
  const recorder = recordingHost()
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({
    stopped: true,
    nodePhase: 'completed',
    nodeHistoryStatus: 'failed',
    nodeHistoryFailure: 'ENOSPC: no space left on device, write',
  })

  // Act
  const item = save.item(record)

  // Assert
  assert.equal(
    item?.text,
    '$(error) Learning save failed · Open retained history',
  )
  assert.equal(item?.command?.command, 'codebook.openLearningReplay')
  assert.equal(recorder.stopCalls(), 0)
})

// Value: protects=an unverified summary after the seal: the item ends at Retry with the store's reason, and Retry reads again; fails_when=an unverified history reads saved, or Retry seals again; why_new=the verification branch had no test (F19, gap E2); seam=the store's first summary is unavailable; no_claim=how the store verifies
test('an unverified summary ends at Retry with the store reason, and Retry reads again', async () => {
  // Arrange
  const recorder = recordingHost({
    summaries: [
      async () =>
        summary({
          verification: 'unavailable',
          reason: 'The sealed journal does not verify.',
        }),
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
  assert.match(failed?.tooltip ?? '', /The sealed journal does not verify\./)
  assert.equal(failed?.command?.title, 'Retry')
  assert.equal(recorder.seals(), 1)
  assert.equal(save.item(record)?.text, '$(check) Learning saved · Open replay')
})

// Value: protects=the Output entry of a read after the seal that failed: one entry named save:read-failed with the study and a cause free of storage paths; fails_when=the failure is silent or the entry shows the storage path; why_new=the read-back failure's Output entry was untested (F19, gap E2); seam=the store's read rejects; no_claim=the channel's look
test('a read after the seal that failed writes one Output entry without storage paths', async () => {
  // Arrange
  const recorder = recordingHost({
    summaries: [
      async () => {
        throw new Error(
          "EACCES: permission denied, open '/Users/ada/Library/codebook/agent/sealed.json'",
        )
      },
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodePhase: 'completed' })
  recorder.use(record)

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(
    recorder.logged.map((entry) => [entry.surface, entry.studyId, entry.cause]),
    [
      [
        'save:read-failed',
        STUDY_ID,
        "EACCES: permission denied, open '<storage>/agent/sealed.json'",
      ],
    ],
  )
})

// Value: protects=the question offering exactly the catalog's actions, so the modal's own Cancel is the only other choice; fails_when=the question is asked with a literal label of its own, or the catalog and the question disagree; why_new=the question's labels were retyped by their consumers (F39); seam=the modal is the test's; no_claim=the host's dialog
test('the Save question offers the catalog action Save now and nothing else', async () => {
  // Arrange
  const recorder = recordingHost({ answer: undefined })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun()
  recorder.use(record)

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(recorder.askedActions, [['Save now']])
})

// Value: protects=the partial notice's Open replay: choosing it opens the saved test replay of this run; fails_when=the action is dropped and nothing opens; why_new=the Save tests' host recorded opened but no test read it (F88); seam=the notification answer and the host's open are fakes; no_claim=the Study pane's open (workspace tests)
test('choosing Open replay on the partial notice opens this run’s test replay', async () => {
  // Arrange
  const recorder = recordingHost({
    notifyAnswer: 'Open replay',
    summaries: [async () => summaryMissingStopTwo()],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ stopped: true, nodePhase: 'completed' })
  recorder.use(record)

  // Act
  await save.save(record)
  await recorder.whenOpened()

  // Assert
  assert.deepEqual(recorder.opened, [STUDY_ID])
})

// Value: protects=a rejected Open replay of the partial notice: it is written to the Output channel with a cause free of storage paths instead of being dropped; fails_when=the rejection vanishes; why_new=the rejection was swallowed (F40); seam=the host's open rejects; no_claim=the learner-facing failure notification of the workspace's open (workspace tests)
test('a rejected Open replay of the partial notice is written to the Output channel', async () => {
  // Arrange
  const recorder = recordingHost({
    notifyAnswer: 'Open replay',
    openFails: new Error("cannot read '/Users/ada/Library/codebook/agent/h'"),
    summaries: [async () => summaryMissingStopTwo()],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ stopped: true, nodePhase: 'completed' })
  recorder.use(record)

  // Act
  await save.save(record)
  await recorder.whenLogged(1)

  // Assert
  assert.deepEqual(
    recorder.logged.map((entry) => [entry.surface, entry.studyId, entry.cause]),
    [['save:open-replay', STUDY_ID, "cannot read '<storage>/agent/h'"]],
  )
})

// Value: protects=the Save of a test run whose continuation failed or passed its deadline before its release ended: no question (it can no longer reach its result), its release and seal, and a partial receipt; fails_when=the Save asks "Saving ends the test run before its result" of a run that will never reach it, and a Cancel leaves the failed run unreleased; why_new=no test saves a run whose phase is failed (Step 9 pass 3 state-machines, wrong row); seam=none; no_claim=the real release and seal (the stop is a stand-in)
test('the Save of a test run that failed before its release asks nothing and saves its partial history', async () => {
  // Arrange
  const recorder = recordingHost({
    answer: undefined,
    stops: [
      async (record): Promise<void> => {
        record.stopped = true
        record.nodeHistoryStatus = 'partial'
        record.nodeHistoryEntryCount = 2
      },
    ],
    summaries: [
      async () =>
        summary({
          status: 'partial',
          verdict: 'No result recorded',
          testResult: 'none',
          stopCount: 1,
          explainedStopCount: 0,
          learningCoverage: 'none',
          learningMissing: [{ kind: 'summary' }, { kind: 'stop', stop: 1 }],
          captureMissing: [{ kind: 'execution' }],
        }),
    ],
  })
  const save = new NodeLearningSave(recorder.host)
  const record = testRun({ nodePhase: 'failed' })
  recorder.use(record)

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(recorder.asked, [])
  assert.equal(recorder.stopCalls(), 1)
  assert.equal(
    save.item(record)?.text,
    '$(warning) Learning partially saved · Open replay',
  )
})
