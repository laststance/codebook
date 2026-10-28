import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { StudyError } from '../errors'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import { createHarness } from './helpers'
import { openServerRepository } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { debuggerCapture } from './utils/serverRunCapture'
import { startHistoryServerRun } from './utils/startHistoryServerRun'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=a learner's Stop of a live server run seals its history with an end of reason stopped, and the run resource still reads stopped; fails_when=the stop path does not seal, or seals partial for the request that went through two stops and a response; no_claim=the status text
test('a learner Stop seals the server history complete with the end reason stopped', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  await run.sendRequest('k1')
  run.pauseAt(0)
  run.pauseAt(1)
  run.respond()

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const history = await repository.serverHistories.read(
    `${service.instanceId}_${record.id}`,
  )

  // Assert
  assert.equal(history.status, 'complete')
  assert.deepEqual(history.entries.at(-1) && { ...history.entries.at(-1) }, {
    type: 'end',
    sequence: history.entries.length,
    elapsedMs: history.entries.at(-1)?.elapsedMs,
    reason: 'stopped',
  })
  assert.equal(record.nodeServer?.history?.status, 'sealed')
})

// protects=a server that exits on its own seals its history with an end of reason closed and its exit code; fails_when=the end says stopped, or the history is left unsealed; no_claim=the real process exit
test('a server that exits on its own seals its history closed with its exit code', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  await run.sendRequest('k1')
  run.pauseAt(0)
  run.record('node-server.closed', { pid: 4242, exitCode: 1, signal: null })

  // Act
  run.failRun(new StudyError('SERVER_EXITED', 'The server exited with code 1.'))
  service.maintain()
  await record.stopPromise
  const history = await repository.serverHistories.read(
    `${service.instanceId}_${record.id}`,
  )

  // Assert
  const end = history.entries.at(-1)
  assert.equal(end?.type === 'end' && end.reason, 'closed')
  assert.equal(end?.type === 'end' && end.exitCode, 1)
  assert.equal(history.status, 'partial')
})

// protects=a dispose whose seal passes the bound leaves the folder unsealed, so it lists as interrupted, and the stop itself still finishes; fails_when=the stop hangs on the seal, or the folder reads recording or sealed; no_claim=real disk stalls
test('a seal past its bound is abandoned and the folder lists as interrupted while the stop finishes', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  service.nodeServerHistorySealBoundMs = 30
  await run.sendRequest('k1')
  const writer = record.nodeServer?.history?.writer
  assert.ok(writer)
  writer.seal = () => new Promise<never>(() => undefined)

  // Act
  await service.shutdown()
  const listed = await repository.serverHistories.list()

  // Assert
  assert.equal(record.nodeServer?.history?.status, 'failed')
  assert.equal(
    record.nodeServer?.history?.failure,
    'Learning replay could not be saved: timed out after 0.03 s.',
  )
  assert.deepEqual(
    listed.map((summary) => summary.status),
    ['interrupted'],
  )
})

// protects=a failing seal write abandons the history and names its cause, without failing the stop; fails_when=the stop rejects, or the cause is missing or names a private path; no_claim=which file system error occurs
test('a failing sealed.json names its cause on the history and the stop still succeeds', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startHistoryServerRun(harness, context)
  await run.sendRequest('k1')
  const writer = record.nodeServer?.history?.writer
  assert.ok(writer)
  writer.seal = () =>
    Promise.reject(new Error('EROFS: sealed.json is read-only'))

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })

  // Assert
  assert.equal(record.nodeServer?.history?.status, 'failed')
  assert.match(
    record.nodeServer?.history?.failure ?? '',
    /EROFS: sealed.json is read-only/,
  )
  assert.equal(record.stopped, true)
})

// protects=a run whose request never went out seals no history: the empty folder is removed and nothing lists; fails_when=an empty history is listed as a saved server replay; no_claim=the run's error
test('a run stopped before its request leaves no history folder', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, repository } = await startHistoryServerRun(
    harness,
    context,
  )

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })

  // Assert
  assert.deepEqual(await repository.serverHistories.list(), [])
})

// protects=storage that is full or unavailable never refuses the live run: it starts, and the record keeps the cause; fails_when=the run is refused, or no cause is kept for the status and Save; no_claim=the status text
test('a full learning store leaves the server run running and keeps the cause', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())

  // Act
  const { record, run } = await startHistoryServerRun(harness, context, {
    repositoryOptions: { limit: 1, savedStudies: async () => 1 },
  })

  // Assert
  assert.equal(run.view().state, 'ready')
  assert.equal(record.nodeServer?.history, undefined)
  assert.match(
    record.nodeServer?.historyUnavailable ?? '',
    /Saved Study Limit|limit/i,
  )
})

// protects=a history start slower than its bound lets the server launch anyway and keeps a cause naming the bound; fails_when=the launch waits for the slow storage; no_claim=real disk latency
test('a history that starts too slowly never delays the server', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  harness.service.nodeServerHistoryStartBoundMs = 20
  const { repository } = await openServerRepository(context)
  repository.serverHistories.start = () => new Promise<never>(() => undefined)

  // Act
  const { record, run } = await startHistoryServerRun(harness, context, {
    repository,
  })

  // Assert
  assert.equal(run.view().state, 'ready')
  assert.match(
    record.nodeServer?.historyUnavailable ?? '',
    /did not start within 0\.02 s/,
  )
})

// protects=a fault of the server history's own sink (a stop outside any request) reaches the diagnostics with its cause once, while the run goes on; fails_when=the fault is held only by the writer and nothing is logged; no_claim=the Output channel's rendering
test('a server history sink fault is written to the diagnostics once', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record } = await startHistoryServerRun(harness, context)
  const diagnostics: CodebookDiagnostic[] = []
  service.diagnostics = (entry) => diagnostics.push(entry)
  const sink = record.nodeServer?.history?.sink
  assert.ok(sink)

  // Act
  sink.stop(5, { declaredStopIndex: 0 }, 1, debuggerCapture())
  sink.stop(6, { declaredStopIndex: 0 }, 1, debuggerCapture())

  // Assert
  assert.deepEqual(
    diagnostics.map((entry) => ({
      surface: entry.surface,
      cause: entry.cause,
    })),
    [
      {
        surface: 'HISTORY_SINK_FAULT',
        cause: 'A stop was captured outside an open request.',
      },
    ],
  )
})
