import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fsPromises, { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'

import { NODE_TEST_HISTORY_DIRECTORY, NODE_TEST_PROFILE } from '../constants'
import { NodeLearningRevisionChangedError, StudyError } from '../errors'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import type { NodeTestLearningMaterialContent } from '../nodeTestHistorySchemas'
import {
  NodeTestHistoryStore,
  NodeTestHistoryWriter,
} from '../nodeTestHistoryStore'
import type { NodeTestSourceStop } from '../ownedNodeTestRun'
import { readResource } from '../resources'
import type { NodeTestRuntime } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import { createHarness } from './helpers'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

/** The result a passing test's final continuation answers. */
const PASSING_RESULT = {
  exitCode: 0,
  signal: null,
  output: 'Tests 1 passed',
  elapsedMs: 40,
}

/** What a fake owned run does at each step, each held or answered as a case needs. */
type FakeRunSteps = {
  stops?: 1 | 2
  /** The service clock, moved by a test to reach a deadline. */
  now?: () => number
  /** Replaces the wait before the seal's one retry. */
  sealRetryDelay?: (milliseconds: number) => Promise<void>
  /** Records no output before the first stop, so a run stopped there seals a history with no entry. */
  silent?: boolean
  /** Holds the preparation's first stop until it settles, or until a stop cancels it. */
  prepareHeld?: Promise<void>
  /** Holds the advance to the second stop until it settles, or until a stop cancels it. */
  advanceHeld?: Promise<void>
  /** Makes the advance to the next stop fail with this error. */
  advanceFails?: () => Error
  /** Holds the final continuation (the process's result and the report check) until it settles. */
  completeHeld?: Promise<void>
  /** What the final continuation answers or throws. */
  complete?: () => ReturnType<NodeTestRuntime['complete']>
  /** How many releases fail before one succeeds. */
  releaseFailures?: number
  /** Replaces the words of a failed release, which can name a path. */
  releaseFailureText?: () => string
  /** The Saved Study Limit in force and how many saved studies the library holds; the history store counts both. */
  storage?: { limit: number; savedStudies: number }
  /** The last declared stop arrives without its required fact, as one the inspector could not read. */
  lastStopUnread?: boolean
}

/**
 * Starts the harness's node-test service with a fake owned Node run the test steers, recording into a real history store.
 * @param steps - What the fake run does.
 * @returns The harness, its service, a start function and counters of the run's releases.
 */
async function testRunHarness(steps: FakeRunSteps = {}) {
  const harness = await createHarness({
      now: steps.now,
      sealRetryDelay: steps.sealRetryDelay,
    }),
    { service } = harness
  const storage = steps.storage
  service.nodeHistoryStore = new NodeTestHistoryStore(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
    storage ? () => storage.limit : undefined,
    storage ? async () => storage.savedStudies : undefined,
  )
  service.environment.build.sourceHash = 'f'.repeat(64)
  const base = harness.configuration
  const declaredStops = steps.stops ?? 1
  // Each stop declares the required fact its fake stop carries, as the owned run's inspector would have read it (Cycle 0052 task 5: a stop without its required fact refuses the continuation that reached it).
  const inspections: NodeTestConfiguration['inspections'] = [
    { path: 'delayMs', mode: 'value', required: true },
  ]
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: base.book,
    testFile: 'src/scheduler.test.ts',
    testTitles: ['job scheduler', 'runs a delayed job after its timer'],
    testHash: 'a'.repeat(64),
    source: base.source,
    inspections,
    ...(declaredStops === 2
      ? {
          additionalStops: [
            {
              ...base.source,
              anchorIndex: 0,
              inspections,
            },
          ],
        }
      : {}),
  }
  const stops = Array.from({ length: declaredStops }, (_, index) => ({
    index,
    runId: 'node-run',
    sessionId: 'owned-session',
    threadId: 7,
    elapsedMs: 10 + index * 10,
    worker: {},
    source: base.source,
    frame: { id: 10 + index, name: 'schedule', line: 1, column: 1 },
    variables: [{ name: 'delayMs', value: '5000' }],
    facts:
      steps.lastStopUnread && index === declaredStops - 1
        ? []
        : [{ path: 'delayMs', mode: 'value', display: '5000', type: 'number' }],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'schedule',
          line: 1,
          column: 1,
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [{ name: 'delayMs', value: '5000', children: [] }],
      limitations: [],
    },
  })) as unknown as NodeTestSourceStop[]
  let cursor = 0,
    releaseAttempts = 0,
    releases = 0,
    completing: Promise<unknown> | undefined
  let cancel!: (reason: Error) => void
  const cancelled = new Promise<never>((_, reject) => {
    cancel = reject
  })
  cancelled.catch(() => undefined)
  const runtime: NodeTestRuntime = {
    id: 'node-run',
    async prepare() {
      // A stop aborts the owned run: a preparation under way rejects, as the debugger's wait does.
      await Promise.race([steps.prepareHeld, cancelled])
      return stops[cursor]!
    },
    hasNextStop() {
      return cursor < stops.length - 1
    },
    async advance() {
      // A stop aborts the owned run: an advance under way rejects, as the debugger's wait does.
      if (steps.advanceFails) throw steps.advanceFails()
      await Promise.race([steps.advanceHeld, cancelled])
      return stops[++cursor]!
    },
    complete() {
      const result = (async () => {
        await steps.completeHeld
        return steps.complete ? steps.complete() : PASSING_RESULT
      })()
      completing = result.catch(() => undefined)
      return result
    },
    async stop() {
      cancel(
        new Error('Owned Node debugger session terminated or was cancelled.'),
      )
      // The release waits for a report check under way, as the owned run does (EN5).
      await completing
      releaseAttempts++
      if (releaseAttempts <= (steps.releaseFailures ?? 0))
        throw new Error(
          steps.releaseFailureText?.() ??
            `process group still running (release ${releaseAttempts})`,
        )
      releases++
    },
  }
  service.environment.createNodeTestRun = async (_configuration, record) => {
    if (!steps.silent)
      await record('node-test.output', {
        sequence: 1,
        elapsedMs: 3,
        channel: 'stdout',
        text: 'RUN src/scheduler.test.ts',
      })
    return runtime
  }
  return {
    harness,
    service,
    configuration,
    /** Starts the run under a key and waits for its preparation. */
    start: async (key = 'scheduler-run') => {
      const receipt = service.start({
        instanceId: service.instanceId,
        profile: NODE_TEST_PROFILE,
        key,
        configuration,
      })
      const record = service.record(receipt)
      await record.preparation
      return { receipt, record }
    },
    releases: (): number => releases,
  }
}

/** Learning material whose steps cite the given journal events. */
function materialCiting(
  references: NonNullable<
    NodeTestLearningMaterialContent['steps'][number]['reference']
  >[],
): NodeTestLearningMaterialContent {
  return {
    question: 'When does a delayed job run?',
    title: 'Delayed job',
    summary: 'The scheduler arms a timer, then runs the job.',
    participants: [
      { id: 'test', label: 'Test' },
      { id: 'scheduler', label: 'Scheduler' },
    ],
    steps: references.map((reference, index) => ({
      id: `step-${index + 1}`,
      from: 'test',
      to: 'scheduler',
      label: `Step ${index + 1}`,
      explanation: 'Observed at this event.',
      evidence: 'observed' as const,
      reference,
    })),
  }
}

/** Continues the run's current pause with the arguments its run resource gives. */
async function continueCurrentPause(
  service: Awaited<ReturnType<typeof testRunHarness>>['service'],
  record: ReturnType<
    Awaited<ReturnType<typeof testRunHarness>>['service']['record']
  >,
) {
  const args = service.state(record).participants.server?.continueArguments
  assert.ok(args, 'the run is paused at a stop it can continue')
  return service.continue(args)
}

// Value: protects=a node-test start refused during its preparation: its typed error in the run resource, no history folder, and its retained-run slot and start key given up; fails_when=the checks run after the history began, a refused run keeps its slot so the 17th start answers LIMIT_EXCEEDED, or its key still replays the refused receipt; why_new=refusals left a history and held a slot (the refusal path of the node-test start, EN1, AC19); seam=the environment's file check is a fake; no_claim=the agent's behavior after a refusal (pilot)
test('a node-test start refused during its preparation records no history and frees its slot and its start key', async () => {
  // Arrange
  const run = await testRunHarness()
  const refusal = new StudyError(
    'SOURCE_CHANGED',
    'node-test preparation refused: declared stop 1 cites src/theme.ts with SHA-256 aaa, but the file now has bbb. Read it with codebook_source, publish the article with the current source, then start with a new key.',
  )
  run.service.environment.checkNodeTestFiles = async () => {
    throw refusal
  }
  try {
    const refused = []
    for (let index = 1; index <= 17; index++) {
      const started = await run.start(`refused-${index}`)
      await waitUntil(
        () => started.record.stopped,
        `refused run ${index} released`,
      )
      refused.push(started)
    }

    // Act
    run.service.environment.checkNodeTestFiles = async () => undefined
    const admitted = await run.start('refused-1')

    // Assert
    const refusedState = run.service.state(refused.at(-1)!.record)
    assert.deepEqual(
      { code: refusedState.error?.code, message: refusedState.error?.message },
      { code: 'SOURCE_CHANGED', message: refusal.message },
    )
    assert.equal(refusedState.finalOutcome, 'not-demonstrated')
    assert.equal(refusedState.studyOutcome, 'not-demonstrated')
    assert.equal(refusedState.recording.status, 'unavailable')
    assert.equal(refusedState.nodeTest?.historyStatus, 'unavailable')
    assert.equal(refusedState.nodeTest?.replayAvailable, false)
    assert.notEqual(admitted.record.id, refused[0]!.record.id)
    assert.equal(admitted.record.nodePhase, 'paused')
    const folders = await readdir(
      join(run.harness.directory, '.learning', NODE_TEST_HISTORY_DIRECTORY),
    )
    assert.deepEqual(folders, [
      `${run.service.instanceId}_${admitted.record.id}`,
    ])
    assert.ok(run.service.records.size <= 16)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a Stop while the run advances to its next stop: the continuation settles before the seal, the run ends without an error of its own and its history seals partial with the stop it reached; fails_when=the seal starts while the continuation runs, or the cancelled continuation becomes the run's error and reads not-demonstrated; why_new=stopRecord awaited preparation and explanations but not a Node continuation (the stop's wait in stopRecord, EN5); seam=the owned run is a fake whose advance a stop cancels; no_claim=the native debugger's own cancellation
test('a Stop while the run advances to its next stop waits for that continuation and seals the stop it reached', async () => {
  // Arrange
  const run = await testRunHarness({
    stops: 2,
    advanceHeld: new Promise<void>(() => {}),
  })
  try {
    const { record } = await run.start()
    const advancing = continueCurrentPause(run.service, record)
    advancing.catch(() => undefined)
    await waitUntil(() => record.nodePhase === 'advancing', 'the advance')

    // Act
    const state = await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })

    // Assert
    await assert.rejects(advancing, { code: 'STALE_PAUSE' })
    assert.equal(state.error, undefined)
    assert.equal(state.nodeTest?.historyStatus, 'partial')
    assert.equal(state.finalOutcome, 'partial')
    assert.equal(state.studyOutcome, 'partial')
    assert.equal(state.nodeTest?.replayAvailable, true)
    assert.equal(state.nodeTest?.stops.length, 1)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a Stop while the final continuation reads the report: the passing result is recorded and the history seals complete; fails_when=the stop seals or releases before the continuation settled, so the run reads partial or its result is lost; why_new=EN5 (AC19); seam=the owned run is a fake whose release waits for the check; no_claim=real Vitest report timing
test('a Stop while the final continuation reads its report waits for the result and seals the passing run complete', async () => {
  // Arrange
  let releaseCheck!: () => void
  const completeHeld = new Promise<void>((resolve) => {
    releaseCheck = resolve
  })
  const run = await testRunHarness({ completeHeld })
  try {
    const { record } = await run.start()
    const finishing = continueCurrentPause(run.service, record)
    await waitUntil(
      () => record.nodePhase === 'advancing',
      'the final continuation',
    )

    // Act
    const stopping = run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    releaseCheck()
    await finishing
    const state = await stopping

    // Assert
    assert.equal(state.error, undefined)
    assert.equal(state.nodeTest?.testResult, 'passed')
    assert.equal(state.nodeTest?.historyStatus, 'complete')
    assert.equal(state.studyOutcome, 'demonstrated')
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a Stop while the result entry is being written: the seal waits for the write; fails_when=the seal closes the journal first and the result write fails as "already sealing", leaving the passing run partial with an error; why_new=appendResult ran after complete() inside an unowned continuation (EN5, AC19); seam=the writer's appendResult is held by the test; no_claim=disk timing
test('a Stop while the result entry is being written seals the history after the write', async (context) => {
  // Arrange
  const run = await testRunHarness()
  let releaseWrite!: () => void
  const writeHeld = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  const appendResult = NodeTestHistoryWriter.prototype.appendResult
  let writing = false
  context.mock.method(
    NodeTestHistoryWriter.prototype,
    'appendResult',
    async function (
      this: NodeTestHistoryWriter,
      ...input: Parameters<NodeTestHistoryWriter['appendResult']>
    ) {
      writing = true
      await writeHeld
      return appendResult.apply(this, input)
    },
  )
  try {
    const { record } = await run.start()
    const finishing = continueCurrentPause(run.service, record)
    await waitUntil(() => writing, 'the result entry write')

    // Act
    const stopping = run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    releaseWrite()
    await finishing
    const state = await stopping

    // Assert
    assert.equal(state.error, undefined)
    assert.equal(state.nodeTest?.historyStatus, 'complete')
    assert.equal(state.recording.status, 'finalized')
  } finally {
    context.mock.restoreAll()
    await run.harness.close()
  }
})

// Value: protects=the verdict of a test that a signal ended after its last stop although Vitest wrote no report: its result entry, testResult signal, and an error that names the missing report; fails_when=the result is dropped, testResult reads none, or the run reads anything but not-demonstrated; why_new=complete() threw before returning exit facts (EN5, AC19); seam=the owned run's result is a fake; no_claim=real signal delivery
test('a test that a signal ended after its last stop records its result and verdict although Vitest wrote no report', async () => {
  // Arrange
  const run = await testRunHarness({
    complete: async () => ({
      exitCode: null,
      signal: 'SIGTERM',
      output: '',
      elapsedMs: 40,
      reportFailure:
        'Vitest wrote no test report, so Codebook cannot confirm that the cited test ran.',
    }),
  })
  try {
    const { record } = await run.start()

    // Act
    await continueCurrentPause(run.service, record)
    await waitUntil(() => record.stopped, 'the failing run released')

    // Assert
    const state = run.service.state(record)
    assert.equal(state.nodeTest?.testResult, 'signal')
    assert.equal(state.finalOutcome, 'not-demonstrated')
    assert.equal(state.nodeTest?.historyStatus, 'partial')
    assert.equal(state.nodeTest?.replayAvailable, true)
    assert.equal(
      state.error?.message,
      "Ended by signal SIGTERM, and Vitest's test report could not confirm the cited test: Vitest wrote no test report, so Codebook cannot confirm that the cited test ran.",
    )
    const history = await run.service.nodeHistoryStore!.read(
      `${run.service.instanceId}_${record.id}`,
    )
    assert.equal(history.entries.at(-1)?.type, 'result')
    const summary = await run.service.nodeHistoryStore!.summarize(
      `${run.service.instanceId}_${record.id}`,
    )
    assert.equal(summary?.verdict, 'Ended by signal SIGTERM')
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a test that ran and failed (exit 1, report intact): not-demonstrated everywhere, a sealed partial history that stays a replay, its failing verdict and reason; fails_when=a failing exit ends the run in an error, seals complete, reads demonstrated or loses its replay; why_new=only a signal and a missing report ran through the service (X16, AC1, AC2); seam=none; no_claim=how Vitest words a failure (the owned run is a fake that answers exit 1)
test('a test that ran and failed is not-demonstrated and its sealed history stays a replay with its failing verdict', async () => {
  // Arrange
  const run = await testRunHarness({
    complete: async () => ({
      exitCode: 1,
      signal: null,
      output: 'Tests 1 failed',
      elapsedMs: 40,
    }),
  })
  try {
    const { record } = await run.start()
    const studyId = `${run.service.instanceId}_${record.id}`

    // Act
    await continueCurrentPause(run.service, record)
    const state = await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })

    // Assert
    assert.equal(state.error, undefined)
    assert.deepEqual(
      [state.finalOutcome, state.studyOutcome, state.recordedStudyOutcome],
      ['not-demonstrated', 'not-demonstrated', 'not-demonstrated'],
    )
    assert.equal(state.nodeTest?.testResult, 'failed')
    assert.equal(state.nodeTest?.historyStatus, 'partial')
    assert.equal(state.nodeTest?.replayAvailable, true)
    assert.equal(state.recording.status, 'partial')
    assert.equal(
      state.recording.reason,
      'The test did not pass: Test failed · exit code 1.',
    )
    const summary = await run.service.nodeHistoryStore!.summarize(studyId)
    assert.deepEqual(
      [summary?.status, summary?.verdict, summary?.testResult],
      ['partial', 'Test failed · exit code 1', 'failed'],
    )
    const history = await run.service.nodeHistoryStore!.read(studyId)
    const result = history.entries.at(-1)
    assert.ok(result?.type === 'result')
    assert.equal(result.exitCode, 1)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=the recording reason of a test that a signal ended without a report failure, and of a run stopped before its result; fails_when=the signal sentence loses the signal's name, or the interrupted fallback says a test failed; why_new=partialHistoryReason's signal sentence and interrupted fallback were untested (F69); seam=the owned run's result is a fake; no_claim=real signal delivery
test('the recording reason names a signal that ended the test and says a run stopped before its result was interrupted', async () => {
  // Arrange
  const signalled = await testRunHarness({
    complete: async () => ({
      exitCode: null,
      signal: 'SIGTERM',
      output: '',
      elapsedMs: 40,
    }),
  })
  const stopped = await testRunHarness({})
  try {
    const signalledRun = (await signalled.start()).record
    const stoppedRun = (await stopped.start()).record

    // Act
    await continueCurrentPause(signalled.service, signalledRun)
    const signalState = await signalled.service.stop({
      instanceId: signalled.service.instanceId,
      runId: signalledRun.id,
    })
    const stoppedState = await stopped.service.stop({
      instanceId: stopped.service.instanceId,
      runId: stoppedRun.id,
    })

    // Assert
    assert.equal(
      signalState.recording.reason,
      'The test did not pass: Ended by signal SIGTERM.',
    )
    assert.equal(
      stoppedState.recording.reason,
      'Node test was interrupted or did not produce every declared stop and a passing result.',
    )
  } finally {
    await signalled.harness.close()
    await stopped.harness.close()
  }
})

// Value: protects=that an exit 0 whose report is missing records no result; fails_when=a result entry with exit 0 is written, so the history claims a pass nothing confirmed; why_new=the exit-facts branch must not cover a passing exit (EN5); seam=the owned run's result is a fake; no_claim=none beyond protects
test('an exit 0 whose Vitest report is missing records no result', async () => {
  // Arrange
  const run = await testRunHarness({
    complete: async () => {
      throw new Error(
        'Vitest wrote no test report, so Codebook cannot confirm that the cited test ran.',
      )
    },
  })
  try {
    const { record } = await run.start()

    // Act
    await assert.rejects(continueCurrentPause(run.service, record))
    await waitUntil(() => record.stopped, 'the failed run released')

    // Assert
    const state = run.service.state(record)
    assert.equal(state.nodeTest?.testResult, 'none')
    assert.equal(state.finalOutcome, 'not-demonstrated')
    const history = await run.service.nodeHistoryStore!.read(
      `${run.service.instanceId}_${record.id}`,
    )
    assert.ok(history.entries.every((entry) => entry.type !== 'result'))
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a passing run whose first release failed: a retried Stop that releases it clears the release's error and seals the history complete; fails_when=the release error from failByRelease stays and the history seals partial; why_new=the seal read !record.error (the history seal's error check, EN4, AC19); seam=the owned run's first release fails; no_claim=a release that keeps failing
test('a passing run whose first release failed seals complete when a retried Stop releases it', async () => {
  // Arrange
  const run = await testRunHarness({ releaseFailures: 1 })
  try {
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)
    run.service.maintain()
    await waitUntil(
      () => record.cleanupError !== undefined,
      'the first release failed',
    )
    assert.equal(run.service.state(record).finalOutcome, 'not-demonstrated')

    // Act
    const state = await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })

    // Assert
    assert.equal(state.error, undefined)
    assert.equal(state.nodeTest?.historyStatus, 'complete')
    assert.equal(state.finalOutcome, 'demonstrated')
    assert.equal(state.studyOutcome, 'demonstrated')
    assert.equal(run.releases(), 1)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=nodeTest.learningCoverage and learningMissing as the saved material grows, read from the run's cache without a store read, and the history resource agreeing with the run resource; fails_when=coverage stays none after a save, state() reads the store, nextActions keeps save-node-learning after coverage is complete, or the two resources disagree; why_new=state() is synchronous and polled every 250 ms (EN2, AC1, AC20); seam=the store's reads are counted; no_claim=Save's wording (NodeLearningSave tests)
test('the run resource reads its learning coverage from its own cache as the saved material grows', async (context) => {
  // Arrange
  const run = await testRunHarness({ stops: 2 })
  try {
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)
    await continueCurrentPause(run.service, record)
    await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    const studyId = `${run.service.instanceId}_${record.id}`
    const history = await run.service.nodeHistoryStore!.read(studyId)
    const stops = history.entries.flatMap((entry) =>
      entry.type === 'stop' ? [entry] : [],
    )
    const result = history.entries.find((entry) => entry.type === 'result')!
    const reads = context.mock.method(run.service.nodeHistoryStore!, 'read')
    const summaries = context.mock.method(
      run.service.nodeHistoryStore!,
      'summarize',
    )

    // Act
    const before = run.service.state(record).nodeTest
    await run.service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: materialCiting([
        {
          type: 'stop',
          sequence: stops[0]!.sequence,
          sourceHash: stops[0]!.source.hash,
        },
      ]),
    })
    const readsBeforePolls = reads.mock.callCount()
    const summariesBeforePolls = summaries.mock.callCount()
    const partly = run.service.state(record)
    await run.service.explainNodeHistory({
      studyId,
      expectedRevision: 1,
      content: materialCiting([
        ...stops.map((stop) => ({
          type: 'stop' as const,
          sequence: stop.sequence,
          sourceHash: stop.source.hash,
        })),
        { type: 'result' as const, sequence: result.sequence },
      ]),
    })
    const readsAfterSaves = reads.mock.callCount()
    // The 250 ms polls of the run resource: three reads of its state after the last save.
    const fully = run.service.state(record)
    run.service.state(record)
    run.service.state(record)
    const readsAfterPolls = reads.mock.callCount()
    const summariesAfterPolls = summaries.mock.callCount()
    const resource = await readResource(
      run.service,
      fully.nodeTest!.historyUri!,
    )

    // Assert
    assert.equal(before?.learningCoverage, 'none')
    assert.equal(partly.nodeTest?.learningCoverage, 'partial')
    assert.deepEqual(partly.nodeTest?.learningMissing, [
      { kind: 'stop', stop: 2 },
      { kind: 'result' },
    ])
    assert.ok(partly.nextActions.includes('save-node-learning'))
    assert.equal(fully.nodeTest?.learningCoverage, 'complete')
    assert.deepEqual(fully.nodeTest?.learningMissing, [])
    assert.ok(!fully.nextActions.includes('save-node-learning'))
    assert.equal(summariesAfterPolls, summariesBeforePolls)
    // The saves read the history to check their references (the number is theirs to choose); the polls after them read nothing.
    assert.ok(readsAfterSaves > readsBeforePolls)
    assert.equal(readsAfterPolls, readsAfterSaves)
    assert.ok('text' in resource)
    const body = JSON.parse(JSON.parse(resource.text).content)
    assert.deepEqual(
      {
        testResult: body.testResult,
        learningCoverage: body.learningCoverage,
        learningMissing: body.learningMissing,
      },
      {
        testResult: fully.nodeTest?.testResult,
        learningCoverage: fully.nodeTest?.learningCoverage,
        learningMissing: fully.nodeTest?.learningMissing,
      },
    )
  } finally {
    context.mock.restoreAll()
    await run.harness.close()
  }
})

// Value: protects=codebook_stop's answer after the test history could not be sealed: HISTORY_SEAL_FAILED with the run, its verdict and stops, a sanitized cause and the run state (whose recording.reason gives the same cause), the same for a repeated stop without a second seal, and one Output entry; fails_when=the tool answers ok, names the storage path, seals again, reports nothing to the Output channel, or the run state's recording.reason loses the cause; why_new=a failed seal answered ok:true (the stop answer's protocol shape, X1, AC2, AC17); seam=the writer's finish fails; no_claim=a full disk's real error text
test('codebook_stop answers HISTORY_SEAL_FAILED with the run state when the test history cannot be sealed, and the same again for a repeated stop', async (context) => {
  // Arrange
  const run = await testRunHarness()
  const storage = join(run.harness.directory, '.learning')
  const finish = context.mock.method(
    NodeTestHistoryWriter.prototype,
    'finish',
    async () => {
      throw new Error(
        `ENOSPC: no space left on device, write '${storage}/node-tests.v1/x/sealed.json'`,
      )
    },
  )
  const diagnostics: CodebookDiagnostic[] = []
  run.service.diagnostics = (entry) => diagnostics.push(entry)
  try {
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)
    const identity = { instanceId: run.service.instanceId, runId: record.id }

    // Act
    const first = await run.service.stopForTool(identity)
    const repeated = await run.service.stopForTool(identity)

    // Assert
    assert.equal(first.sealFailure?.code, 'HISTORY_SEAL_FAILED')
    assert.equal(
      first.sealFailure?.message,
      `codebook_stop released run ${record.id} (Test passed · exit code 0, 1 of 1 stops reached) but could not seal its history.`,
    )
    assert.equal(
      first.sealFailure?.causeDetail,
      "ENOSPC: no space left on device, write '<storage>/node-tests.v1/x/sealed.json'",
    )
    assert.equal(first.state.recording.status, 'failed')
    assert.equal(
      first.state.recording.reason,
      "ENOSPC: no space left on device, write '<storage>/node-tests.v1/x/sealed.json'",
    )
    assert.equal(first.state.nodeTest?.replayAvailable, false)
    assert.equal(first.state.finalOutcome, 'demonstrated')
    assert.equal(first.state.studyOutcome, 'partial')
    assert.deepEqual(
      repeated.sealFailure?.describe(),
      first.sealFailure?.describe(),
    )
    assert.equal(finish.mock.callCount(), 1)
    assert.equal(diagnostics.length, 1)
    assert.deepEqual(
      {
        surface: diagnostics[0]?.surface,
        profile: diagnostics[0]?.profile,
        cause: diagnostics[0]?.cause,
      },
      {
        surface: 'HISTORY_SEAL_FAILED',
        profile: NODE_TEST_PROFILE,
        cause:
          "ENOSPC: no space left on device, write '<storage>/node-tests.v1/x/sealed.json'",
      },
    )
  } finally {
    context.mock.restoreAll()
    await run.harness.close()
  }
})

// Value: protects=the MCP answer of codebook_stop after a failed seal: isError with the error and the run state side by side; fails_when=the tool's answer is ok:true or carries no state; why_new=toolResult answered every resolved stop as ok (X1); seam=the writer's finish fails; no_claim=a client's rendering of the answer
test('the codebook_stop tool answers isError with the seal failure and the run state', async (context) => {
  // Arrange
  const run = await testRunHarness()
  context.mock.method(NodeTestHistoryWriter.prototype, 'finish', async () => {
    throw new Error('EIO: i/o error, write')
  })
  const endpoint = await startServer(run.service)
  const transport = new StreamableHTTPClientTransport(
    new URL(endpoint.descriptor.url),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
      },
    },
  )
  const client = new Client({ name: 'codebook-stop-test', version: '1.0' })
  try {
    await client.connect(transport)
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)

    // Act
    const answer = await client.callTool({
      name: 'codebook_stop',
      arguments: { instanceId: run.service.instanceId, runId: record.id },
    })

    // Assert
    assert.equal(answer.isError, true)
    const structured = answer.structuredContent as {
      ok: boolean
      error: { code: string; recovery: string }
      state: { runId: string; recording: { status: string } }
    }
    assert.equal(structured.ok, false)
    assert.equal(structured.error.code, 'HISTORY_SEAL_FAILED')
    assert.match(
      structured.error.recovery,
      /^The run is stopped and its resources are released/,
    )
    assert.equal(structured.state.runId, record.id)
    assert.equal(structured.state.recording.status, 'failed')
  } finally {
    context.mock.restoreAll()
    await transport.terminateSession().catch(() => undefined)
    await client.close()
    await endpoint.close()
    await run.harness.close()
  }
})

// Value: protects=that a run without a history never answers HISTORY_SEAL_FAILED; fails_when=a run refused during preparation is reported as a failed seal; why_new=AC2's guard for runs without a history; seam=the environment's file check refuses; no_claim=none beyond protects
test('a stop of a run refused before its history began answers no seal failure', async () => {
  // Arrange
  const run = await testRunHarness()
  run.service.environment.checkNodeTestFiles = async () => {
    throw new StudyError(
      'INVALID_CONFIGURATION',
      'node-test preparation refused.',
    )
  }
  try {
    const { record } = await run.start()
    await waitUntil(() => record.stopped, 'the refused run released')

    // Act
    const answer = await run.service.stopForTool({
      instanceId: run.service.instanceId,
      runId: record.id,
    })

    // Assert
    assert.equal(answer.sealFailure, undefined)
    assert.equal(answer.state.error?.code, 'INVALID_CONFIGURATION')
  } finally {
    await run.harness.close()
  }
})

// Value: protects=codebook_playback refusing a test replay's study before the presentation check and before any load, for this window's run and for a listed history; fails_when=the presentation's busy refusal or a load comes first, or a listed test history is handed to the browser replay's controller; why_new=a test replay's id reached the controller (the playback command's study admission, X2, AC2); seam=the presentation controller refuses everything; no_claim=the learner's own open of a test replay
test('codebook_playback refuses a test replay’s study before the presentation check, for a run and for a listed history', async () => {
  // Arrange
  const run = await testRunHarness()
  try {
    const { record } = await run.start()
    const runStudyId = `${run.service.instanceId}_${record.id}`
    const store = run.service.nodeHistoryStore!
    const earlier = nodeTestHistoryHeader(store.workspaceKey)
    const earlierWriter = await store.start(earlier)
    // One recorded output, so the history has something to replay and is listed (a history sealed with no entry is removed, D6).
    await earlierWriter.appendOutput({
      sequence: 1,
      elapsedMs: 1,
      channel: 'stdout',
      text: 'RUN src/theme.test.ts',
    })
    await earlierWriter.finish('partial', 'An earlier window stopped it.')
    await store.list()
    let presentationChecks = 0
    run.service.presentationController = {
      assertPresentationIdle: () => {
        presentationChecks++
        throw new Error('The Study reader is busy.')
      },
    } as unknown as NonNullable<typeof run.service.presentationController>
    /** Sends an open of a study and returns what it threw. */
    const refusalOf = (studyId: string): unknown => {
      try {
        run.service.playback({
          instanceId: run.service.instanceId,
          studyId,
          action: 'open',
          expectedRevision: 0,
        })
      } catch (error) {
        return error
      }
      return undefined
    }

    // Act
    const runRefusal = refusalOf(runStudyId)
    const listedRefusal = refusalOf(earlier.studyId)

    // Assert
    assert.ok(runRefusal instanceof StudyError)
    assert.equal(runRefusal.code, 'PLAYBACK_PROFILE_UNSUPPORTED')
    assert.equal(
      runRefusal.message,
      `codebook_playback cannot control study ${runStudyId}: it is a node-test replay, which the learner opens from Saved studies or Open replay.`,
    )
    assert.ok(listedRefusal instanceof StudyError)
    assert.equal(listedRefusal.code, 'PLAYBACK_PROFILE_UNSUPPORTED')
    assert.equal(presentationChecks, 0)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=the run resource's recording.reason for a test run without a history: a run still preparing says it is preparing, a run stopped before its history began says nothing was recorded; fails_when=a run stopped during preparation keeps reading Preparing, a preparing run says nothing was recorded, or the stopped run leaves a history; why_new=the refusal test asserts error, outcomes and folders, no reason sentence (F8; E3 keeps a refused run's sentence); seam=none; no_claim=a refused run's reason (E3) and the agent's next move (pilot); the owned run is a fake
test('a test run stopped while it is still preparing records no history, and its run resource says it was preparing and then that nothing was recorded', async () => {
  // Arrange
  const run = await testRunHarness()
  let checkIsHeld = false,
    letCheckFinish!: () => void
  const checkMayFinish = new Promise<void>((resolve) => {
    letCheckFinish = resolve
  })
  // The environment's file check is the last step before the history begins: held, the run is preparing without a history.
  run.service.environment.checkNodeTestFiles = async (): Promise<void> => {
    checkIsHeld = true
    await checkMayFinish
  }
  try {
    // The start's idempotency key, named by what this run is for.
    const runName = 'stopped-while-preparing'
    const receipt = run.service.start({
      instanceId: run.service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: runName,
      configuration: run.configuration,
    })
    const record = run.service.record(receipt)
    await waitUntil(
      () => checkIsHeld,
      'the file check holds the run in its preparation',
      2_000,
    )
    const whilePreparing = run.service.state(record)

    // Act
    const stopping = run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    letCheckFinish()
    const afterStop = await stopping

    // Assert
    assert.deepEqual(
      [
        whilePreparing.finalOutcome,
        whilePreparing.recording.status,
        whilePreparing.recording.reason,
      ],
      [
        'pending',
        'unavailable',
        'Preparing: the test history starts when preparation passes.',
      ],
    )
    assert.deepEqual(
      [
        afterStop.finalOutcome,
        afterStop.recording.status,
        afterStop.recording.reason,
      ],
      [
        'not-demonstrated',
        'unavailable',
        'The test run ended before its history began; nothing was recorded.',
      ],
    )
    assert.equal(afterStop.error, undefined)
    assert.equal(afterStop.nodeTest?.historyStatus, 'unavailable')
    assert.equal(afterStop.nodeTest?.replayAvailable, false)
    assert.deepEqual(await run.service.nodeHistoryStore!.list(), [])
  } finally {
    letCheckFinish()
    await run.harness.close()
  }
})

// Value: protects=a learner's Stop while a test run is still preparing, before its history began: the run reads stopped (no error of its own, not refused-at-preparation), offers no read-history, gives up its retained-run slot, and keeps its start key (a repeat under the key replays the receipt); fails_when=the preparation's cancelled check becomes the run's error, the run reads refused-at-preparation and frees its key, or the stopped run keeps read-history and its slot so the 17th start answers LIMIT_EXCEEDED; why_new=the preparation catch never asked record.stopping (service.ts prepare, F97) and a stop with no history left historyExcluded unset (F56); seam=the environment's file check is a fake that rejects once the stop is under way; no_claim=the real file check's abort wording
test('a learner’s stop while a test run prepares before its history reads as stopped, offers no read-history, frees its slot and keeps its start key', async () => {
  // Arrange
  const run = await testRunHarness()
  let checkIsHeld = false,
    letCheckFail!: () => void
  const checkMayFail = new Promise<void>((resolve) => {
    letCheckFail = resolve
  })
  run.service.environment.checkNodeTestFiles = async (): Promise<void> => {
    checkIsHeld = true
    await checkMayFail
    throw new Error('The operation was aborted.')
  }
  try {
    const startKey = 'stopped-before-history-key'
    const receipt = run.service.start({
      instanceId: run.service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: startKey,
      configuration: run.configuration,
    })
    const record = run.service.record(receipt)
    await waitUntil(() => checkIsHeld, 'the file check holds the preparation')

    // Act
    const stopping = run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    letCheckFail()
    const afterStop = await stopping
    run.service.environment.checkNodeTestFiles = async () => undefined
    const repeated = run.service.start({
      instanceId: run.service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: startKey,
      configuration: run.configuration,
    })

    // Assert
    assert.equal(afterStop.error, undefined)
    assert.equal(record.historyExcluded, 'stopped-before-history')
    assert.equal(afterStop.state, 'stopped')
    assert.deepEqual(afterStop.nextActions, [])
    assert.equal(repeated.runId, receipt.runId)
    // Sixteen such stopped runs leave room for a seventeenth start.
    for (let index = 1; index <= 16; index++) {
      const other = run.service.start({
        instanceId: run.service.instanceId,
        profile: NODE_TEST_PROFILE,
        key: randomUUID(),
        configuration: run.configuration,
      })
      await run.service.stop({
        instanceId: run.service.instanceId,
        runId: other.runId,
      })
    }
    assert.ok(run.service.records.size <= 16)
  } finally {
    letCheckFail()
    await run.harness.close()
  }
})

// Value: protects=a learner's Stop after the test history began and before the first stop: the cancelled preparation is no error of the run, which reads stopped and seals its history partial; fails_when=the cancelled first-stop wait becomes record.error (a failed run with the debugger's cancellation as its cause); why_new=after the history began a stop still left an error on the run (F97); seam=the owned run is a fake whose first stop a stop cancels; no_claim=the native debugger's own cancellation
test('a learner’s stop after the test history began and before the first stop leaves no error on the run', async () => {
  // Arrange
  const run = await testRunHarness({ prepareHeld: new Promise<void>(() => {}) })
  try {
    const receipt = run.service.start({
      instanceId: run.service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: randomUUID(),
      configuration: run.configuration,
    })
    const record = run.service.record(receipt)
    await waitUntil(() => record.nodeRun !== undefined, 'the owned run exists')

    // Act
    const state = await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })

    // Assert
    assert.equal(state.error, undefined)
    assert.equal(state.state, 'stopped')
    assert.equal(record.historyExcluded, undefined)
    assert.equal(state.nodeTest?.historyStatus, 'partial')
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a test run stopped while its file check is held and then passes: no history was begun, so the run reads ended (no read-history in nextActions) and its retained-run slot is free; fails_when=the stopped run leaves historyExcluded unset, keeps read-history, and a seventeenth start answers LIMIT_EXCEEDED; why_new=a stop with no history left the exclusion unset (F56); seam=the environment's file check is held by the test; no_claim=the start key (the rejecting-check test above)
test('a test run stopped before its history began offers no read-history and frees its retained-run slot', async () => {
  // Arrange
  const run = await testRunHarness()
  let checkIsHeld = false,
    letCheckFinish!: () => void
  const checkMayFinish = new Promise<void>((resolve) => {
    letCheckFinish = resolve
  })
  run.service.environment.checkNodeTestFiles = async (): Promise<void> => {
    checkIsHeld = true
    await checkMayFinish
  }
  try {
    const receipt = run.service.start({
      instanceId: run.service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: randomUUID(),
      configuration: run.configuration,
    })
    const record = run.service.record(receipt)
    await waitUntil(() => checkIsHeld, 'the file check holds the preparation')

    // Act
    const stopping = run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    letCheckFinish()
    const afterStop = await stopping

    // Assert
    assert.equal(record.historyExcluded, 'stopped-before-history')
    assert.equal(afterStop.nextActions.includes('read-history'), false)
    run.service.environment.checkNodeTestFiles = async () => undefined
    for (let index = 1; index <= 16; index++) {
      const other = run.service.start({
        instanceId: run.service.instanceId,
        profile: NODE_TEST_PROFILE,
        key: randomUUID(),
        configuration: run.configuration,
      })
      await run.service.stop({
        instanceId: run.service.instanceId,
        runId: other.runId,
      })
    }
    assert.ok(run.service.records.size <= 16)
  } finally {
    letCheckFinish()
    await run.harness.close()
  }
})

/** The sentence the node-test profile and its refusal give while the saved studies fill the limit, with the Trash available. */
const FULL_STORAGE_REMEDY =
  'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Only the learner can do either; an editor agent cannot. Existing learning was kept.'

// Value: protects=codebook_status reading the node-test profile as not ready while the saved studies fill the Saved Study Limit (77 of 64), with a missing sentence naming the count, the limit and the remedy, and the browser profile unaffected; fails_when=the profile reads ready with no missing entry so the agent spends its preparation on a start that is refused, or the sentence names neither the count nor the limit; why_new=status ignored the saved-study capacity for the test profile (F92, D7); seam=the history store's limit and library count are injected; no_claim=the setting's lookup in the editor
test('codebook_status reads the node-test profile as not ready, naming the count and the limit, while the saved studies fill the limit', async () => {
  // Arrange
  const run = await testRunHarness({ storage: { limit: 64, savedStudies: 77 } })
  try {
    // Act
    const status = await run.service.status()

    // Assert
    const nodeTest = status.profiles.find(
      (profile) => profile.id === NODE_TEST_PROFILE,
    )
    assert.deepEqual(
      {
        ready: nodeTest?.prerequisites.ready,
        missing: [...(nodeTest?.prerequisites.missing ?? [])],
      },
      {
        ready: false,
        missing: [
          `node-test cannot start: the saved studies and test histories take 77 places of the 64 that the Saved Study Limit allows. ${FULL_STORAGE_REMEDY}`,
        ],
      },
    )
  } finally {
    await run.harness.close()
  }
})

// Value: protects=the node-test profile staying ready below the limit, and its recording member (available, reason) in codebook_status; fails_when=the capacity check marks a library with room as full, or the recording member changes without notice; why_new=the recording member was asserted nowhere (F33) and the capacity check is new (F92); seam=as above; no_claim=the recording's own capture
test('codebook_status reads the node-test profile as ready with its recording member while the library has room', async () => {
  // Arrange
  const run = await testRunHarness({ storage: { limit: 64, savedStudies: 63 } })
  try {
    // Act
    const status = await run.service.status()

    // Assert
    const nodeTest = status.profiles.find(
      (profile) => profile.id === NODE_TEST_PROFILE,
    )
    assert.equal(nodeTest?.prerequisites.ready, true)
    assert.deepEqual([...(nodeTest?.prerequisites.missing ?? [])], [])
    assert.deepEqual(
      nodeTest && 'recording' in nodeTest && nodeTest.recording,
      {
        available: true,
        reason:
          'Test output, executed source and recorded debugger stops; no application video',
      },
    )
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a node-test start refused while the saved studies fill the limit: a typed PREREQUISITE_MISSING worded as the study library's refusal (Settings of this profile, or delete a saved study; only the learner), no history folder, and the retained-run slot and start key freed; fails_when=the refusal is an untyped RUNTIME_FAILED with the setting named but not where or how, an agent is told to edit a settings file, or a zero-entry history is left; why_new=the refusal said "Saved study storage is full" as RUNTIME_FAILED (F92, F93, D7); seam=the history store's limit and library count are injected; no_claim=the setting's lookup in the editor
test('a node-test start refused for full saved-study storage answers a typed PREREQUISITE_MISSING worded as the study library does and records no history', async () => {
  // Arrange
  const run = await testRunHarness({ storage: { limit: 64, savedStudies: 77 } })
  try {
    // Act
    const { record } = await run.start('full-storage')
    await waitUntil(() => record.stopped, 'the refused run released')

    // Assert
    const state = run.service.state(record)
    assert.deepEqual(
      { code: state.error?.code, message: state.error?.message },
      { code: 'PREREQUISITE_MISSING', message: FULL_STORAGE_REMEDY },
    )
    assert.equal(record.historyExcluded, 'refused-at-preparation')
    assert.deepEqual(await run.service.nodeHistoryStore!.list(), [])
  } finally {
    await run.harness.close()
  }
})

// Value: protects=the run resource's nextActions for a test history sealed with no entry (stopped before the first stop): no save-node-learning, because nothing is left to explain or save; fails_when=the action is offered for an empty history, so the agent asks the learner for a Save item that does not show; why_new=nextActions offered save-node-learning for any history whose coverage was not complete (F71); seam=the owned run is a fake whose first stop a stop cancels; no_claim=the Save item's visibility in the status bar (nodeLearningSave tests)
test('a test history sealed with no entry does not offer save-node-learning', async () => {
  // Arrange
  const run = await testRunHarness({
    prepareHeld: new Promise<void>(() => {}),
    silent: true,
  })
  try {
    const receipt = run.service.start({
      instanceId: run.service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: randomUUID(),
      configuration: run.configuration,
    })
    const record = run.service.record(receipt)
    await waitUntil(() => record.nodeRun !== undefined, 'the owned run exists')

    // Act
    const state = await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })

    // Assert
    assert.equal(record.nodeHistoryEntryCount, 0)
    assert.equal(state.nextActions.includes('save-node-learning'), false)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=the run resource of a test run whose history sealed with no entry, whose folder the store removed at the seal (D6): it offers no read-history and names no historyUri, so the agent is not sent to a history that is gone (F253); fails_when=read-history and a historyUri are still offered and the agent's read fails; why_new=PR-1's /ship state-machine review found the cell untested and the action offered; seam=the owned run is a fake whose preparation a stop cancels; no_claim=the runs of other profiles, whose history the store does not remove
test('a test run whose history sealed with no entry offers no read-history and names no history to read', async () => {
  // Arrange
  const run = await testRunHarness({
    prepareHeld: new Promise<void>(() => {}),
    silent: true,
  })
  try {
    const receipt = run.service.start({
      instanceId: run.service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: randomUUID(),
      configuration: run.configuration,
    })
    const record = run.service.record(receipt)
    await waitUntil(() => record.nodeRun !== undefined, 'the owned run exists')

    // Act
    const state = await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })

    // Assert
    assert.equal(record.nodeHistoryEntryCount, 0)
    assert.equal(record.nodeHistoryStatus, 'partial')
    assert.equal(state.nextActions.includes('read-history'), false)
    assert.equal(state.nodeTest?.historyUri, undefined)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=the run resource's nodeTest.captureMissing after the summary read at the seal failed for a transient reason (EMFILE): it reads unknown at first, and the next learning-material save reads it again once the storage recovers, so the agent's claim rule can be checked (F252); fails_when=the gaps stay unknown for the run's life, so the agent can never claim saved learning for it; why_new=Codex's adversarial review of PR-1: the gaps were read once, at the seal; seam=the store's summary rejects its first call; no_claim=the store's own memo of a transient failure (F63, nodeTestHistorySummary tests)
test('capture gaps the seal could not read for a transient reason are read again at the next learning-material save', async (context) => {
  // Arrange
  const run = await testRunHarness({ stops: 2 })
  try {
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)
    await continueCurrentPause(run.service, record)
    const store = run.service.nodeHistoryStore!
    const summarize = store.summarize.bind(store)
    let failedOnce = false
    context.mock.method(store, 'summarize', (studyId: string) => {
      if (failedOnce) return summarize(studyId)
      failedOnce = true
      return Promise.reject(
        Object.assign(new Error('EMFILE: too many open files'), {
          code: 'EMFILE',
        }),
      )
    })
    const stopped = await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    const studyId = `${run.service.instanceId}_${record.id}`
    const history = await store.read(studyId)
    const stop = history.entries.find((entry) => entry.type === 'stop')!

    // Act
    await run.service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: materialCiting([
        {
          type: 'stop',
          sequence: stop.sequence,
          sourceHash: stop.type === 'stop' ? stop.source.hash : '',
        },
      ]),
    })
    const afterSave = run.service.state(record)

    // Assert
    assert.equal(stopped.nodeTest?.captureMissing, undefined)
    // The store's answer for this harness's history, whose stops hold no captured state.
    assert.deepEqual(afterSave.nodeTest?.captureMissing, [
      { kind: 'stop-state', stop: 1 },
      { kind: 'stop-state', stop: 2 },
    ])
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a test run whose empty history could not be removed at its seal (a busy folder): the run offers no read-history and names no historyUri, and the next capacity check removes the sealed folder (F272); fails_when=the run sends the agent to a history the list never shows, or the sealed empty folder stays and takes a place; why_new=PR-1's /ship state-machine review, cycle 3: the failed-removal cell of the run resource was untested; seam=the removal of the history's folder fails while the run stops; no_claim=a removal that keeps failing (the store tests)
test('a run whose empty history could not be removed at its seal offers no read-history, and the next capacity check removes it', async (context) => {
  // Arrange
  const run = await testRunHarness({
    prepareHeld: new Promise<void>(() => {}),
    silent: true,
  })
  try {
    const receipt = run.service.start({
      instanceId: run.service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: randomUUID(),
      configuration: run.configuration,
    })
    const record = run.service.record(receipt)
    await waitUntil(() => record.nodeRun !== undefined, 'the owned run exists')
    const studyId = `${run.service.instanceId}_${record.id}`
    const historyDirectory = join(
      run.service.nodeHistoryStore!.learningDirectory,
      NODE_TEST_HISTORY_DIRECTORY,
    )
    const rmBefore = fsPromises.rm
    let busy = true
    context.mock.method(
      fsPromises,
      'rm',
      async (...args: Parameters<typeof fsPromises.rm>) => {
        if (busy && String(args[0]).endsWith(studyId))
          throw Object.assign(new Error('EBUSY: resource busy or locked'), {
            code: 'EBUSY',
          })
        return rmBefore(...args)
      },
    )

    // Act
    const state = await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    const namesAfterSeal = await readdir(historyDirectory)
    busy = false
    await run.service.nodeHistoryStore!.admission()
    const namesAfterCheck = await readdir(historyDirectory)

    // Assert
    assert.equal(state.nextActions.includes('read-history'), false)
    assert.equal(state.nodeTest?.historyUri, undefined)
    assert.equal(namesAfterSeal.includes(studyId), true)
    assert.equal(namesAfterCheck.includes(studyId), false)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a test run whose seal failed (its folder kept): it still offers read-history and names its historyUri, so the agent can read what was recorded (F273); fails_when=the removed-empty-history rule also matches a failed seal and hides a readable history; why_new=PR-1's /ship coverage audit, cycle 3: only the removed side of the rule was tested; seam=the writer's seal fails; no_claim=the seal failure's wording (the cut test)
test('a test run whose seal failed still offers read-history and names its history', async (context) => {
  // Arrange
  const run = await testRunHarness()
  context.mock.method(NodeTestHistoryWriter.prototype, 'finish', async () => {
    throw new Error('ENOSPC: no space left on device, write')
  })
  try {
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)

    // Act
    const answer = await run.service.stopForTool({
      instanceId: run.service.instanceId,
      runId: record.id,
    })

    // Assert
    assert.equal(record.nodeHistoryStatus, 'failed')
    assert.equal(answer.state.nextActions.includes('read-history'), true)
    assert.match(
      answer.state.nodeTest?.historyUri ?? '',
      /^codebook:\/\/node-history\//,
    )
  } finally {
    await run.harness.close()
  }
})

// Value: protects=capture gaps that the seal could not read and that a later save cannot read either: they stay unknown, never an empty list that would let the agent claim complete learning (F273); fails_when=a failed re-read is reported as no gap; why_new=PR-1's /ship coverage audit, cycle 3: only the recovered re-read was tested; seam=the store's summary rejects every call; no_claim=the store's memo of a transient failure
test('capture gaps that a later save still cannot read stay unknown', async (context) => {
  // Arrange
  const run = await testRunHarness({ stops: 2 })
  try {
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)
    await continueCurrentPause(run.service, record)
    const store = run.service.nodeHistoryStore!
    context.mock.method(store, 'summarize', () =>
      Promise.reject(
        Object.assign(new Error('EMFILE: too many open files'), {
          code: 'EMFILE',
        }),
      ),
    )
    await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    const studyId = `${run.service.instanceId}_${record.id}`
    const history = await store.read(studyId)
    const stop = history.entries.find((entry) => entry.type === 'stop')!

    // Act
    await run.service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: materialCiting([
        {
          type: 'stop',
          sequence: stop.sequence,
          sourceHash: stop.type === 'stop' ? stop.source.hash : '',
        },
      ]),
    })

    // Assert
    assert.equal(run.service.state(record).nodeTest?.captureMissing, undefined)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a learning material saved while the test run still records: it is kept on the run and counts no coverage before the seal, which counts it then (F273); fails_when=a save before the seal throws or reads capture gaps for a history that is not sealed; why_new=PR-1's /ship coverage audit, cycle 3: the save path before the seal was untested since cacheNodeLearning became asynchronous; seam=none; no_claim=the seal's count of that material (the seal test)
test('a learning material saved while the test run records is kept on the run and counts nothing before the seal', async () => {
  // Arrange
  const run = await testRunHarness({ stops: 2 })
  try {
    const { record } = await run.start()
    const studyId = `${run.service.instanceId}_${record.id}`
    const history = await run.service.nodeHistoryStore!.read(studyId)
    const stop = history.entries.find((entry) => entry.type === 'stop')!

    // Act
    const saved = await run.service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: materialCiting([
        {
          type: 'stop',
          sequence: stop.sequence,
          sourceHash: stop.type === 'stop' ? stop.source.hash : '',
        },
      ]),
    })
    const state = run.service.state(record)

    // Assert
    assert.equal(saved.revision, 1)
    assert.equal(record.nodeLearningMaterial?.revision, 1)
    assert.equal(state.nodeTest?.learningCoverage, undefined)
    assert.equal(state.nodeTest?.captureMissing, undefined)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=codebook_explain_node_history telling a stale material revision (IDEMPOTENCY_CONFLICT) from a citation that merely names a path containing the words "revision changed" (INVALID_REFERENCE stays); fails_when=the conflict is recognized by searching the error text, so a stop in src/revision changed.ts turns INVALID_REFERENCE into IDEMPOTENCY_CONFLICT, or a real stale revision stops being a conflict; why_new=explainNodeHistory mapped the error by its text (F44); seam=the history store's save is replaced by one that throws, and its folder check by one that finds the folder; no_claim=the store's own revision check (nodeTestHistoryStore tests)
test('explain_node_history answers IDEMPOTENCY_CONFLICT for a stale revision and keeps INVALID_REFERENCE for a citation whose path says "revision changed"', async () => {
  // Arrange
  const run = await testRunHarness()
  const store = run.service.nodeHistoryStore!
  const studyId = `${randomUUID()}_${randomUUID()}`
  const content = materialCiting([
    { type: 'stop', sequence: 2, sourceHash: 'a'.repeat(64) },
  ])
  const input = { studyId, expectedRevision: 0, content }
  try {
    // The store holds a folder for the id, so the save is reached (an unknown id is refused before it, Cycle 0052 task 60).
    store.holdsHistoryFolder = () => true
    store.saveLearningMaterial = async () => {
      throw new StudyError(
        'INVALID_REFERENCE',
        'Step 1 cites a stop in src/revision changed.ts that the sealed journal does not hold.',
      )
    }
    const citation = await run.service.explainNodeHistory(input).then(
      () => undefined,
      (error: unknown) => error,
    )
    store.saveLearningMaterial = async () => {
      throw new NodeLearningRevisionChangedError(0, 1)
    }

    // Act
    const stale = await run.service.explainNodeHistory(input).then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.ok(citation instanceof StudyError)
    assert.equal(citation.code, 'INVALID_REFERENCE')
    assert.ok(stale instanceof StudyError)
    assert.equal(stale.code, 'IDEMPOTENCY_CONFLICT')
  } finally {
    await run.harness.close()
  }
})

// Value: protects=nodeTest.captureMissing in the run resource and the node-history resource for a history cut before its result: [{kind: execution}] in both, absent before the seal; fails_when=the run resource exposes no capture gap (an agent claims saved learning for a replay Save reads as partially saved) or the two resources disagree; why_new=captureMissing was not exposed (F72, D8); seam=the owned run is a fake whose advance a stop cancels; no_claim=the skill's claim rule (a document of group C)
test('the run and the node-history resource list the capture gap of a history cut before its result, and the run lists none before the seal', async () => {
  // Arrange
  const run = await testRunHarness({
    stops: 2,
    advanceHeld: new Promise<void>(() => {}),
  })
  try {
    const { record } = await run.start()
    const beforeSeal = run.service.state(record)
    const advancing = continueCurrentPause(run.service, record)
    advancing.catch(() => undefined)
    await waitUntil(() => record.nodePhase === 'advancing', 'the advance')

    // Act
    const afterStop = await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    const history = await readResource(
      run.service,
      afterStop.nodeTest!.historyUri!,
    )

    // Assert
    assert.equal(beforeSeal.nodeTest?.captureMissing, undefined)
    assert.deepEqual(
      afterStop.nodeTest?.captureMissing?.filter(
        (part) => part.kind === 'execution',
      ),
      [{ kind: 'execution' }],
    )
    assert.ok('text' in history)
    const resourceMissing: unknown = JSON.parse(
      JSON.parse(history.text).content,
    ).captureMissing
    assert.deepEqual(resourceMissing, afterStop.nodeTest?.captureMissing)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=the run resource cutting a long seal failure to the 300 characters AC17 shows (nodeTest.historyReason, recording.reason, recording.contextReason) while the run keeps the whole sanitized cause bounded to 8,192 characters for the Output entry; fails_when=a resource shows the whole 10,000-character cause, or the stored cause loses its bound; why_new=the run resource showed whole causes and nodeHistoryFailure lost its bound (F51); seam=the writer's finish fails with a very long message; no_claim=the Output channel's rendering
test('the run resource cuts a long seal failure to 300 characters and the run keeps it bounded to 8,192', async (context) => {
  // Arrange
  const run = await testRunHarness()
  context.mock.method(NodeTestHistoryWriter.prototype, 'finish', async () => {
    throw new Error(`ENOSPC: ${'x'.repeat(10_000)}`)
  })
  const diagnostics: CodebookDiagnostic[] = []
  run.service.diagnostics = (entry) => diagnostics.push(entry)
  try {
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)

    // Act
    const answer = await run.service.stopForTool({
      instanceId: run.service.instanceId,
      runId: record.id,
    })

    // Assert
    const shown = `ENOSPC: ${'x'.repeat(285)}… [cut]`
    assert.deepEqual(
      [
        answer.state.nodeTest?.historyReason,
        answer.state.recording.reason,
        answer.state.recording.contextReason,
      ],
      [shown, shown, shown],
    )
    assert.equal(record.nodeHistoryFailure?.length, 8_192)
    assert.equal(diagnostics[0]?.cause.length, 8_192)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a test run's own error carrying no private path: a failed advance, and the report failure of a failing result, read `<storage>` in the run's error message and cause; fails_when=the error assigned at the continuation keeps the raw storage path in the run resource and the codebook_continue refusal; why_new=a test run's own error was not sanitized at assignment (F49); seam=the owned run's advance fails and its result carries a report failure naming the storage path; no_claim=the real adapter's wording
test('a test run’s own error from a failed advance and from a report failure names no storage path', async () => {
  // Arrange
  let storage = ''
  const failedAdvance = await testRunHarness({
    stops: 2,
    advanceFails: () =>
      new Error(
        `ENOENT: no such file or directory, open '${storage}/x/a.json'`,
      ),
  })
  storage = failedAdvance.service.causeRoots.storage[0]!
  let reportStorage = ''
  const reported = await testRunHarness({
    complete: async () => ({
      exitCode: 1,
      signal: null,
      output: 'Tests 1 failed',
      elapsedMs: 40,
      reportFailure: `report not found at ${reportStorage}/report.json`,
    }),
  })
  reportStorage = reported.service.causeRoots.storage[0]!
  try {
    const advanceStart = await failedAdvance.start()
    const advanceRejection = await continueCurrentPause(
      failedAdvance.service,
      advanceStart.record,
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    const reportStart = await reported.start()
    await continueCurrentPause(reported.service, reportStart.record)

    // Act
    const advanceState = failedAdvance.service.state(advanceStart.record)
    const reportState = reported.service.state(reportStart.record)

    // Assert
    assert.ok(advanceRejection instanceof StudyError)
    assert.deepEqual(
      [
        advanceRejection.describe().message,
        advanceRejection.describe().cause,
        advanceState.error?.message,
        advanceState.error?.cause,
      ],
      [
        "The study operation failed. Cause: ENOENT: no such file or directory, open '<storage>/x/a.json'",
        "ENOENT: no such file or directory, open '<storage>/x/a.json'",
        "The study operation failed. Cause: ENOENT: no such file or directory, open '<storage>/x/a.json'",
        "ENOENT: no such file or directory, open '<storage>/x/a.json'",
      ],
    )
    assert.equal(
      reportState.error?.message,
      "Test failed · exit code 1, and Vitest's test report could not confirm the cited test: report not found at <storage>/report.json",
    )
  } finally {
    await failedAdvance.harness.close()
    await reported.harness.close()
  }
})

// Value: protects=codebook_playback refusing a test replay of an earlier session with PLAYBACK_PROFILE_UNSUPPORTED although this window's store has not listed it yet; fails_when=the refusal depends on the window's last list, so an agent that sends the id before the Study workspace refreshed gets a browser-replay error or a load attempt; why_new=the guard read only the listed histories (F9); seam=an earlier window's store writes the history, this window's store never lists it; no_claim=the learner's open of the replay
test('codebook_playback refuses an earlier session’s test replay before this window has listed it', async () => {
  // Arrange
  const run = await testRunHarness()
  try {
    const earlierWindow = new NodeTestHistoryStore(
      join(run.harness.directory, '.learning'),
      '0'.repeat(64),
    )
    const earlier = nodeTestHistoryHeader(earlierWindow.workspaceKey)
    const earlierWriter = await earlierWindow.start(earlier)
    // One output line: a history sealed with no entry is removed at its seal (D6).
    await earlierWriter.appendOutput({
      sequence: 1,
      elapsedMs: 1,
      channel: 'stdout',
      text: 'RUN src/scheduler.test.ts',
    })
    await earlierWriter.finish('partial', 'An earlier window stopped it.')

    // Act
    const refusal = (() => {
      try {
        run.service.playback({
          instanceId: run.service.instanceId,
          studyId: earlier.studyId,
          action: 'open',
          expectedRevision: 0,
        })
      } catch (error) {
        return error
      }
      return undefined
    })()

    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.equal(refusal.code, 'PLAYBACK_PROFILE_UNSUPPORTED')
    assert.equal(
      run.service.nodeHistoryStore!.isListedHistory(earlier.studyId),
      false,
    )
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a test run whose Stop failed to release it: the run resource offers only stop (no continue-server, no continueArguments), codebook_continue refuses with STALE_PAUSE, and a retried Stop releases it; fails_when=the failed release leaves continue-server and current continueArguments on offer for a run that can no longer continue; why_new=after a stop whose release failed the run resource still offered the agent a continuation (F91, D18); seam=the owned run's first release fails; no_claim=a release that keeps failing
test('after a stop whose release failed, the run offers only stop and refuses a continue with STALE_PAUSE', async () => {
  // Arrange
  const run = await testRunHarness({ stops: 2, releaseFailures: 1 })
  try {
    const { record } = await run.start()
    const staleArguments =
      run.service.state(record).participants.server?.continueArguments
    assert.ok(staleArguments, 'the run is paused at a stop it can continue')
    const identity = { instanceId: run.service.instanceId, runId: record.id }
    await run.service.stop(identity).catch(() => undefined)

    // Act
    const afterFailedRelease = run.service.state(record)
    const refusal = await run.service.continue(staleArguments).then(
      () => undefined,
      (error: unknown) => error,
    )
    const afterRetry = await run.service.stop(identity)

    // Assert
    assert.deepEqual(afterFailedRelease.nextActions, ['stop'])
    assert.equal(
      afterFailedRelease.participants.server?.continueArguments,
      undefined,
    )
    assert.ok(refusal instanceof StudyError)
    assert.equal(refusal.code, 'STALE_PAUSE')
    assert.equal(afterRetry.state, 'stopped')
    assert.equal(run.releases(), 1)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a seal failure reported to a diagnostics sink that throws (the log channel after deactivation): the stop still answers HISTORY_SEAL_FAILED and the run is released; fails_when=the sink's throw escapes stopRecord, so codebook_stop rejects and the run stays unreleased; why_new=the Output sink threw after deactivation and left the run unreleased (F99); seam=the diagnostics sink throws; no_claim=the real log channel (extension.test.ts covers its sink)
test('a diagnostics sink that throws does not leave the run unreleased when the history cannot be sealed', async (context) => {
  // Arrange
  const run = await testRunHarness()
  context.mock.method(NodeTestHistoryWriter.prototype, 'finish', async () => {
    throw new Error('EIO: i/o error')
  })
  run.service.diagnostics = () => {
    throw new Error('Channel has been closed')
  }
  try {
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)

    // Act
    const answer = await run.service.stopForTool({
      instanceId: run.service.instanceId,
      runId: record.id,
    })

    // Assert
    assert.equal(answer.sealFailure?.code, 'HISTORY_SEAL_FAILED')
    assert.equal(record.stopped, true)
    assert.equal(run.releases(), 1)
  } finally {
    await run.harness.close()
  }
})

/**
 * Makes the writer's seal fail with a file-system code for its first `failures` attempts, then run the real seal.
 * @param context - Restores the writer when the test ends.
 * @param code - The error code of each failure.
 * @param failures - How many attempts fail before one runs.
 * @returns The mock, whose call count is the number of seal attempts.
 */
function failSealAttempts(
  context: TestContext,
  code: string,
  failures: number,
) {
  const original = NodeTestHistoryWriter.prototype.finish
  let attempts = 0
  return context.mock.method(
    NodeTestHistoryWriter.prototype,
    'finish',
    function (
      this: NodeTestHistoryWriter,
      ...args: Parameters<typeof original>
    ) {
      attempts++
      if (attempts <= failures)
        throw Object.assign(new Error(`${code}: transient`), { code })
      return original.apply(this, args)
    },
  )
}

// Value: protects=a transient seal failure (EMFILE) of a passing run: the seal is tried once more after 200 ms and the history seals complete; a code that waiting does not change (ENOSPC) fails at once; a transient code twice fails as before; fails_when=a passing run stays partial for an EMFILE that passed, or a non-transient code is retried, or the retry repeats more than once; why_new=a transient seal failure was permanent (F100, D14); seam=the writer's seal fails with a code for its first attempts and the delay is recorded, not waited; no_claim=a repeated codebook_stop (it makes no second attempt: the seal-failure test)
for (const scenario of [
  {
    name: 'EMFILE once seals the passing run complete after one 200 ms retry',
    code: 'EMFILE',
    failures: 1,
    expected: { status: 'complete', attempts: 2, delays: [200] },
  },
  {
    name: 'ENOSPC is not retried and the seal fails',
    code: 'ENOSPC',
    failures: 1,
    expected: { status: 'failed', attempts: 1, delays: [] },
  },
  {
    name: 'EBUSY twice is retried once and then fails as before',
    code: 'EBUSY',
    failures: 2,
    expected: { status: 'failed', attempts: 2, delays: [200] },
  },
] as const)
  test(`a test history seal that fails with ${scenario.name}`, async (context) => {
    // Arrange
    const delays: number[] = []
    const run = await testRunHarness({
      sealRetryDelay: async (milliseconds): Promise<void> => {
        delays.push(milliseconds)
      },
    })
    const finish = failSealAttempts(context, scenario.code, scenario.failures)
    try {
      const { record } = await run.start()
      await continueCurrentPause(run.service, record)

      // Act
      const state = await run.service.stop({
        instanceId: run.service.instanceId,
        runId: record.id,
      })

      // Assert
      assert.deepEqual(
        {
          status: state.nodeTest?.historyStatus,
          attempts: finish.mock.callCount(),
          delays,
        },
        scenario.expected,
      )
    } finally {
      await run.harness.close()
    }
  })

// Value: protects=learning material saved after the result and before Stop: the seal counts it, so the run reads learningCoverage complete with nothing missing and no save-node-learning; fails_when=the seal counts the stops and the result without the material saved before it, so a fully explained run reads none and asks for another save; why_new=the seal's use of the window's earlier material was untested (F21); seam=the material is saved through the service while the run is paused at its result; no_claim=the material saved after the seal (the coverage test above)
test('learning material saved after the result and before Stop is counted when the history seals', async () => {
  // Arrange
  const run = await testRunHarness()
  try {
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)
    const studyId = `${run.service.instanceId}_${record.id}`
    const history = await run.service.nodeHistoryStore!.read(studyId)
    const stop = history.entries.find((entry) => entry.type === 'stop')!
    const result = history.entries.find((entry) => entry.type === 'result')!
    await run.service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: materialCiting([
        {
          type: 'stop',
          sequence: stop.sequence,
          sourceHash: stop.source.hash,
        },
        { type: 'result', sequence: result.sequence },
      ]),
    })

    // Act
    const state = await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })

    // Assert
    assert.equal(state.nodeTest?.historyStatus, 'complete')
    assert.equal(state.nodeTest?.learningCoverage, 'complete')
    assert.deepEqual(state.nodeTest?.learningMissing, [])
    assert.equal(state.nextActions.includes('save-node-learning'), false)
  } finally {
    await run.harness.close()
  }
})

// Value: protects=a test run that completed before its whole-run deadline: when the deadline passes while the run waits for its release, the deadline adds no error and the run seals complete and reads demonstrated; fails_when=hasRunEnded ignores a completed test, so the deadline's "Study wall deadline expired" becomes the run's error and a passing run reads not-demonstrated; why_new=a completed run at the deadline needed an injected clock (F25); seam=the service clock is injected and moved past the deadline after the result; no_claim=a run that is still on its way at the deadline (the deadline tests)
test('a completed test run at the whole-run deadline gets no deadline error and seals complete', async () => {
  // Arrange
  let nowMs = 1_000_000
  const run = await testRunHarness({ now: () => nowMs })
  try {
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)
    nowMs = record.deadlineAt + 1

    // Act
    run.service.maintain()
    await waitUntil(() => record.stopped, 'the completed run released')

    // Assert
    const state = run.service.state(record)
    assert.equal(state.error, undefined)
    assert.equal(state.nodeTest?.historyStatus, 'complete')
    assert.equal(state.finalOutcome, 'demonstrated')
  } finally {
    await run.harness.close()
  }
})

// Value: protects=the run resource of a test run refused during its preparation: its recording.reason names the refusal, the run offers no history action, and a run stopped before its history began says nothing was recorded; fails_when=the refusal's historyExclusionReason, either recording.reason fallback or its nextActions change unnoticed; why_new=a refused run's reason and nextActions were asserted nowhere (F20); seam=the environment's file check refuses or is held; no_claim=the agent's next move after a refusal (pilot)
test('a test run refused during its preparation names its refusal in recording.reason and offers no history action', async () => {
  // Arrange
  const run = await testRunHarness()
  run.service.environment.checkNodeTestFiles = async () => {
    throw new StudyError(
      'INVALID_CONFIGURATION',
      'node-test preparation refused.',
    )
  }
  try {
    const { record } = await run.start('refused-reason')
    await waitUntil(() => record.stopped, 'the refused run released')

    // Act
    const state = run.service.state(record)

    // Assert
    assert.deepEqual(
      {
        reason: state.recording.reason,
        nextActions: state.nextActions,
        historyExcluded: record.historyExcluded,
      },
      {
        reason:
          "The test run was refused during its preparation, before its history began; nothing was recorded. Read the run's error for the fix.",
        nextActions: [],
        historyExcluded: 'refused-at-preparation',
      },
    )
  } finally {
    await run.harness.close()
  }
})

// Value: protects=codebook_stop's failure answer through MCP for a run that does not exist: isError with the NOT_FOUND error and its recovery, and no state; fails_when=the tool throws out of the handler, answers ok, or invents a state for an unknown run; why_new=stopToolResult's failure branch was untested (F36); seam=a real MCP client over HTTP; no_claim=the seal-failure answer (the test above)
test('the codebook_stop tool answers isError with NOT_FOUND for a run that does not exist', async () => {
  // Arrange
  const run = await testRunHarness()
  const endpoint = await startServer(run.service)
  const transport = new StreamableHTTPClientTransport(
    new URL(endpoint.descriptor.url),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
      },
    },
  )
  const client = new Client({
    name: 'codebook-unknown-stop-test',
    version: '1.0',
  })
  try {
    await client.connect(transport)

    // Act
    const answer = await client.callTool({
      name: 'codebook_stop',
      arguments: {
        instanceId: run.service.instanceId,
        runId: '00000000-0000-4000-8000-000000000000',
      },
    })

    // Assert
    assert.equal(answer.isError, true)
    const structured = z
      .object({
        ok: z.literal(false),
        error: z.object({ code: z.string(), message: z.string() }),
        state: z.undefined().optional(),
      })
      .parse(answer.structuredContent)
    assert.deepEqual(structured.error, {
      code: 'NOT_FOUND',
      message: 'No run with that identity exists in this instance.',
    })
  } finally {
    await transport.terminateSession().catch(() => undefined)
    await client.close()
    await endpoint.close()
    await run.harness.close()
  }
})

// Value: protects=a continuation that finishes after the whole-run deadline already marked the test failed: the run stays failed and the late stop is not announced as a pause; fails_when=continueNodeTest sets nodePhase paused after its await, overwriting the deadline's failed phase so a failed run reads paused at a stop it cannot continue; why_new=the phase was set after the awaits without checking a deadline expiry meanwhile (F77 part 1); seam=the owned run's advance is held until the deadline passed and released right after maintain marked the run; no_claim=the real debugger's timing
test('a continuation that finishes after the deadline marked the test failed leaves the run failed', async () => {
  // Arrange
  let nowMs = 1_000_000
  let letAdvanceFinish!: () => void
  const advanceHeld = new Promise<void>((resolve) => {
    letAdvanceFinish = resolve
  })
  const run = await testRunHarness({ stops: 2, advanceHeld, now: () => nowMs })
  try {
    const { record } = await run.start()
    const advancing = continueCurrentPause(run.service, record)
    advancing.catch(() => undefined)
    await waitUntil(() => record.nodePhase === 'advancing', 'the advance')
    nowMs = record.deadlineAt + 1

    // Act
    run.service.maintain()
    letAdvanceFinish()
    await advancing.catch(() => undefined)
    await waitUntil(() => record.stopped, 'the run released')

    // Assert
    assert.equal(record.nodePhase, 'failed')
    assert.equal(
      run.service.state(record).error?.message,
      'Study wall deadline expired; history only.',
    )
  } finally {
    await run.harness.close()
  }
})

// Value: protects=an agent whose continuation reaches a stop without its required fact after the whole-run deadline already failed the test: the answer does not say the run stays paused, and the run reads failed with the deadline; fails_when=continueNodeTest refuses with EVIDENCE_UNAVAILABLE "The run stays paused at this stop" for a run that is failed and released; why_new=pt3 /ship review (state machines): the refusal was computed from the journaled stop whatever the run's phase; seam=the owned run's advance is held until the deadline passed, and its last stop carries no fact; no_claim=the real debugger's timing
test('a continuation that reaches a stop without its required fact after the deadline failed the test does not say the run stays paused', async () => {
  // Arrange
  let nowMs = 1_000_000
  let letAdvanceFinish!: () => void
  const advanceHeld = new Promise<void>((resolve) => {
    letAdvanceFinish = resolve
  })
  const run = await testRunHarness({
    stops: 2,
    advanceHeld,
    now: () => nowMs,
    lastStopUnread: true,
  })
  try {
    const { record } = await run.start()
    const advancing = continueCurrentPause(run.service, record)
    const answer = advancing.then(
      () => 'answered',
      (error: unknown) =>
        error instanceof StudyError
          ? `${error.code}: ${error.message}`
          : String(error),
    )
    await waitUntil(() => record.nodePhase === 'advancing', 'the advance')
    nowMs = record.deadlineAt + 1

    // Act
    run.service.maintain()
    letAdvanceFinish()
    const continuation = await answer
    await waitUntil(() => record.stopped, 'the run released')

    // Assert
    assert.doesNotMatch(continuation, /stays paused/)
    assert.equal(record.nodePhase, 'failed')
    assert.equal(
      run.service.state(record).error?.message,
      'Study wall deadline expired; history only.',
    )
  } finally {
    await run.harness.close()
  }
})

// Value: protects=the node-history resource summarizing the history only for its own page: its events and learning-material pages read no summary; fails_when=every page of the resource summarizes the history first, so paging through a long journal repeats a summary for each page; why_new=the resource summarized before branching (F77 part 3, F14); seam=the store's summarize is counted; no_claim=the summary's content (the coverage tests)
test('the node-history resource summarizes only for the history page, not for its events or learning-material pages', async (context) => {
  // Arrange
  const run = await testRunHarness()
  try {
    const { record } = await run.start()
    await continueCurrentPause(run.service, record)
    const state = await run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    const historyUri = state.nodeTest!.historyUri!
    const summaries = context.mock.method(
      run.service.nodeHistoryStore!,
      'summarize',
    )

    // Act
    await readResource(run.service, `${historyUri}/events`)
    await readResource(run.service, `${historyUri}/learning-material`)
    const callsForSubPages = summaries.mock.callCount()
    await readResource(run.service, historyUri)

    // Assert
    assert.equal(callsForSubPages, 0)
    assert.equal(summaries.mock.callCount(), 1)
  } finally {
    context.mock.restoreAll()
    await run.harness.close()
  }
})

// Value: protects=a run the library refused at its admission and that is then stopped while its preparation unwinds: it keeps refused-at-admission and its reason; fails_when=the stop overwrites the refusal with stopped-before-history, so the run reads "ended before its history began" and a repeat under its key is treated as a stop, not a refusal; why_new=the preparation catch assigned the stop's exclusion unconditionally (F222); seam=the exclusion is set on the record as the admission would set it, the file check is held and then rejects; no_claim=the admission itself (studyAdmission tests)
test('a run refused at its admission and then stopped keeps refused-at-admission and its reason', async () => {
  // Arrange
  const run = await testRunHarness()
  let checkIsHeld = false,
    letCheckFail!: () => void
  const checkMayFail = new Promise<void>((resolve) => {
    letCheckFail = resolve
  })
  run.service.environment.checkNodeTestFiles = async (): Promise<void> => {
    checkIsHeld = true
    await checkMayFail
    throw new Error('The operation was aborted.')
  }
  try {
    const receipt = run.service.start({
      instanceId: run.service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: randomUUID(),
      configuration: run.configuration,
    })
    const record = run.service.record(receipt)
    await waitUntil(() => checkIsHeld, 'the file check holds the preparation')
    record.historyExcluded = 'refused-at-admission'

    // Act
    const stopping = run.service.stop({
      instanceId: run.service.instanceId,
      runId: record.id,
    })
    letCheckFail()
    const state = await stopping

    // Assert
    assert.equal(record.historyExcluded, 'refused-at-admission')
    assert.equal(
      state.recording.reason,
      'The run was refused before it started; nothing was saved.',
    )
  } finally {
    letCheckFail()
    await run.harness.close()
  }
})

// Value: protects=a test run whose release failed: the rejection of codebook_stop and the run resource's cleanupError name `<storage>` where the failure named the service's storage path; fails_when=the release error is stored and thrown raw, so the stop tool and the run resource carry the private path; why_new=stopRecord kept and threw the release failure unsanitized (F218); seam=the owned run's release throws a message with the storage root; no_claim=the removal rewording (studyRemoval tests)
test('a failed release of a test run names no storage path in the stop rejection or the run resource', async () => {
  // Arrange
  let storageRoot = ''
  const run = await testRunHarness({
    releaseFailures: 1,
    releaseFailureText: () =>
      `process group still running in '${storageRoot}/x'`,
  })
  storageRoot = run.service.causeRoots.storage[0]!
  try {
    const { record } = await run.start()

    // Act
    const rejection = await run.service
      .stop({ instanceId: run.service.instanceId, runId: record.id })
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    // Assert
    assert.ok(rejection instanceof Error)
    assert.equal(
      rejection.message,
      "process group still running in '<storage>/x'",
    )
    assert.equal(
      run.service.state(record).cleanupError?.cause,
      "Error: process group still running in '<storage>/x'",
    )
  } finally {
    await run.harness.close()
  }
})
