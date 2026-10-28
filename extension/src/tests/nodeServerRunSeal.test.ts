import assert from 'node:assert/strict'
import fileSystem from 'node:fs/promises'
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

// protects=a run that failed on its own (not a server exit) seals its history with an end of reason failed and the run's own failure code, read from the run's failure and not from the record's error; fails_when=the end says stopped, or the code is lost; no_claim=which failures the real run raises (the process tests pin its own failure)
test('a run that failed on its own seals the server history failed with its failure code', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  await run.sendRequest('k1')
  run.failRun(new StudyError('RUNTIME_FAILED', 'The run failed.'))

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const history = await repository.serverHistories.read(
    `${service.instanceId}_${record.id}`,
  )

  // Assert
  const end = history.entries.at(-1)
  assert.equal(end?.type === 'end' && end.reason, 'failed')
  assert.equal(end?.type === 'end' && end.code, 'RUNTIME_FAILED')
})

// protects=a seal already published stays sealed on the live run when the writer-record removal stalls past the seal bound, and the store lists it sealed; fails_when=the live run reads failed with a timeout while the store lists sealed; no_claim=a stalled removal on a real disk
test('a published seal stays sealed when the writer record removal stalls past the bound', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  service.nodeServerHistorySealBoundMs = 250
  await run.sendRequest('k1')
  const originalRemove = fileSystem.rm
  context.mock.method(
    fileSystem,
    'rm',
    (...removal: Parameters<typeof fileSystem.rm>) =>
      String(removal[0]).endsWith('writer.json')
        ? new Promise<never>(() => undefined)
        : originalRemove(...removal),
  )

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const listed = await repository.serverHistories.list()

  // Assert
  assert.equal(record.nodeServer?.history?.status, 'sealed')
  assert.equal(record.nodeServer?.history?.failure, undefined)
  assert.deepEqual(
    listed.map((summary) => summary.status),
    ['partial'],
  )
})

// protects=a deadline that fires after sealed.json was published but before the writer's finish returns (the temporary file's cleanup still stalls) leaves the live run sealed, not abandoned; fails_when=the live run reads failed with a timeout though sealed.json stands; no_claim=a stalled cleanup on a real disk, or how another window lists the folder
test('a deadline firing right after the seal was published but before finish returns keeps the run sealed', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startHistoryServerRun(harness, context)
  service.nodeServerHistorySealBoundMs = 250
  await run.sendRequest('k1')
  const originalUnlink = fileSystem.unlink
  context.mock.method(
    fileSystem,
    'unlink',
    (...removal: Parameters<typeof fileSystem.unlink>) =>
      String(removal[0]).includes('sealed.json')
        ? new Promise<never>(() => undefined)
        : originalUnlink(...removal),
  )

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })

  // Assert
  assert.equal(record.nodeServer?.history?.status, 'sealed')
  assert.equal(record.nodeServer?.history?.failure, undefined)
  assert.ok(record.nodeServer?.history?.sealed?.hash)
})

// protects=a seal that was published after the deadline already fired still gets its summary read within a bound of its own, so the run resource shows the verdicts at once; fails_when=sealed.summary stays undefined because the read raced an already-settled deadline; no_claim=the verdict values
test('a seal taken as published after the deadline fired still reads its summary', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  service.nodeServerHistorySealBoundMs = 250
  await run.sendRequest('k1')
  const originalUnlink = fileSystem.unlink
  context.mock.method(
    fileSystem,
    'unlink',
    (...removal: Parameters<typeof fileSystem.unlink>) =>
      String(removal[0]).includes('sealed.json')
        ? new Promise<never>(() => undefined)
        : originalUnlink(...removal),
  )
  const studyId = `${service.instanceId}_${record.id}`

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })

  // Assert
  assert.equal(record.nodeServer?.history?.sealed?.summary?.studyId, studyId)
  assert.ok(await repository.serverHistories.summarize(studyId))
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

// protects=a verdict read that finishes after a newer one does not overwrite the newer summary on the run; fails_when=the last read to finish wins whatever its order; no_claim=what the summary's fields mean
test('an older server summary read that finishes last keeps the newer summary', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  await run.sendRequest('k1')
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const sealed = record.nodeServer?.history?.sealed
  assert.ok(sealed?.summary)
  const sealedSummary = sealed.summary
  const resolvers: Array<(summary: typeof sealedSummary) => void> = []
  repository.serverHistories.summarize = () =>
    new Promise((resolve) => resolvers.push(resolve))
  const older = { ...sealedSummary, materialRevision: 111 }
  const newer = { ...sealedSummary, materialRevision: 222 }

  // Act
  const firstRead = service.refreshNodeServerVerdicts(record)
  const secondRead = service.refreshNodeServerVerdicts(record)
  resolvers[1]!(newer)
  await secondRead
  resolvers[0]!(older)
  await firstRead

  // Assert
  assert.equal(sealed.summary?.materialRevision, 222)
})

// protects=a run whose reader has no history repository keeps the summary its seal read; fails_when=the refresh assigns undefined over a good summary; no_claim=the learning coverage text
test('a verdict refresh without a history repository keeps the sealed summary', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startHistoryServerRun(harness, context)
  await run.sendRequest('k1')
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const sealed = record.nodeServer?.history?.sealed
  assert.ok(sealed?.summary)
  const kept = sealed.summary
  service.nodeHistoryRepository = undefined

  // Act
  await service.refreshNodeServerVerdicts(record)

  // Assert
  assert.equal(sealed.summary, kept)
})

// protects=a stop whose seal published but whose summary read never settles still ends within the seal bound, sealed with an unknown summary, so Save, codebook_stop and the next run are not held; fails_when=the seal waits on the summary read past its bound; why_new=Codex structured and adversarial reviews (ship pass 1) reproduced the unbounded read; seam=none; no_claim=which file system stalls
test('a seal whose summary read never settles still ends the stop within its bound and reads sealed', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  service.nodeServerHistorySealBoundMs = 1_000
  await run.sendRequest('k1')
  run.respond()
  repository.serverHistories.summarize = () =>
    new Promise<never>(() => undefined)

  // Act
  const stopping = service.stop({
    instanceId: service.instanceId,
    runId: record.id,
  })
  let guard: ReturnType<typeof setTimeout> | undefined
  const outcome = await Promise.race([
    stopping.then(() => 'stopped'),
    // gstack-timing-ok: the seal's bound is the contract; a stop still pending 5 s after a 1 s bound waits on the summary read (the real writer seal fits the bound under load)
    new Promise<string>((resolve) => {
      guard = setTimeout(() => resolve('still stopping'), 5_000)
    }),
  ])
  clearTimeout(guard)

  // Assert
  assert.equal(outcome, 'stopped')
  assert.equal(record.nodeServer?.history?.status, 'sealed')
  assert.equal(record.nodeServer?.history?.sealed?.summary, undefined)
})

// protects=a seal whose summary read rejects keeps the history sealed with an unknown summary and leaves one trace in the diagnostics; fails_when=the rejection abandons the sealed history, fails the stop, or leaves no trace; why_new=untested cell of the seal machine and the silent summary loss (ship pass 2, state-machines and native adversarial); seam=none; no_claim=which read error occurs
test('a seal whose summary read rejects stays sealed with an unknown summary and writes one diagnostic', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  const diagnostics: CodebookDiagnostic[] = []
  service.diagnostics = (entry) => diagnostics.push(entry)
  await run.sendRequest('k1')
  run.respond()
  repository.serverHistories.summarize = () =>
    Promise.reject(new Error('EIO: read failed'))

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })

  // Assert
  assert.equal(record.nodeServer?.history?.status, 'sealed')
  assert.equal(record.nodeServer?.history?.sealed?.summary, undefined)
  assert.deepEqual(
    diagnostics.map((entry) => ({
      surface: entry.surface,
      cause: entry.cause,
    })),
    [
      {
        surface: 'HISTORY_SUMMARY_UNAVAILABLE',
        cause:
          'The sealed history was kept, but its summary could not be read (the read failed or passed the seal bound); the run resource reads it again.',
      },
    ],
  )
})
