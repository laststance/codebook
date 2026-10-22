import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { NODE_TEST_HISTORY_DIRECTORY, NODE_TEST_PROFILE } from '../constants'
import { StudyError } from '../errors'
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
  /** Holds the advance to the second stop until it settles, or until a stop cancels it. */
  advanceHeld?: Promise<void>
  /** Holds the final continuation (the process's result and the report check) until it settles. */
  completeHeld?: Promise<void>
  /** What the final continuation answers or throws. */
  complete?: () => ReturnType<NodeTestRuntime['complete']>
  /** How many releases fail before one succeeds. */
  releaseFailures?: number
}

/**
 * Starts the harness's node-test service with a fake owned Node run the test steers, recording into a real history store.
 * @param steps - What the fake run does.
 * @returns The harness, its service, a start function and counters of the run's releases.
 */
async function testRunHarness(steps: FakeRunSteps = {}) {
  const harness = await createHarness(),
    { service } = harness
  service.nodeHistoryStore = new NodeTestHistoryStore(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  service.environment.build.sourceHash = 'f'.repeat(64)
  const base = harness.configuration
  const declaredStops = steps.stops ?? 1
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: base.book,
    testFile: 'src/scheduler.test.ts',
    testTitles: ['job scheduler', 'runs a delayed job after its timer'],
    testHash: 'a'.repeat(64),
    source: base.source,
    inspections: base.inspections.slice(0, 1),
    ...(declaredStops === 2
      ? {
          additionalStops: [
            {
              ...base.source,
              anchorIndex: 0,
              inspections: base.inspections.slice(0, 1),
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
    facts: [
      { path: 'delayMs', mode: 'value', display: '5000', type: 'number' },
    ],
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
      return stops[cursor]!
    },
    hasNextStop() {
      return cursor < stops.length - 1
    },
    async advance() {
      // A stop aborts the owned run: an advance under way rejects, as the debugger's wait does.
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
          `process group still running (release ${releaseAttempts})`,
        )
      releases++
    },
  }
  service.environment.createNodeTestRun = async (_configuration, record) => {
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
    await (
      await store.start(earlier)
    ).finish('partial', 'An earlier window stopped it.')
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
