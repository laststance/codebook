import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { StudyError } from '../errors'
import { readResource } from '../resources'

import { createHarness } from './helpers'
import { createManualClock } from './utils/createManualClock'
import { realProcessStart } from './utils/realProcessStart'
import { startHistoryServerRun } from './utils/startHistoryServerRun'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=the end entry of a stopped server history carries the time of the Stop on the run's clock; fails_when=the end keeps the time of the last output entry (100 ms) or reads 0; no_claim=the real clock of a launched server
test('a Stop at 900 ms seals the server history with an end entry of 900 ms after output at 100 ms', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  await run.sendRequest('k1')
  run.history?.output(100, 'stdout', 'listening')
  run.launchElapsedMs = 900

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const history = await repository.serverHistories.read(
    `${service.instanceId}_${record.id}`,
  )

  // Assert
  const end = history.entries.at(-1)
  assert.equal(end?.type, 'end')
  assert.equal(end?.elapsedMs, 900)
})

// protects=forgetting a stopped server run leaves no per-study bookkeeping of its verdict reads in the service; fails_when=a map keyed by the study id still holds the run's entry after the run is forgotten; no_claim=memory use of other maps
test('forgetting a stopped server run leaves no per-study entry in the service', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startHistoryServerRun(harness, context)
  await run.sendRequest('k1')
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  await service.refreshNodeServerVerdicts(record)
  const studyId = `${service.instanceId}_${record.id}`

  // Act
  service['forgetRecord'](record)

  // Assert
  const keptEntries = Object.values(service)
    .filter((value): value is Map<unknown, unknown> => value instanceof Map)
    .filter((map) => map.has(studyId))
  assert.equal(keptEntries.length, 0)
})

// protects=a verdict read that resolves with nothing keeps the summary the seal read; fails_when=the refresh assigns undefined over the sealed summary; no_claim=what the summary holds
test('a verdict read that resolves with nothing keeps the sealed summary', async (context) => {
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
  const kept = sealed.summary
  repository.serverHistories.summarize = async () => undefined

  // Act
  await service.refreshNodeServerVerdicts(record)

  // Assert
  assert.equal(sealed.summary, kept)
})

// protects=a clean Stop seals with the end reason stopped even when an earlier release failure sits on the record; fails_when=the seal borrows the record's error and writes failed; no_claim=the wording of the earlier failure
test('a clean Stop after an earlier release failure seals with the end reason stopped', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  await run.sendRequest('k1')
  run.respond()
  record.error = new StudyError('RUNTIME_FAILED', 'An earlier release failed.')

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const history = await repository.serverHistories.read(
    `${service.instanceId}_${record.id}`,
  )

  // Assert
  const end = history.entries.at(-1)
  assert.equal(end?.type === 'end' && end.reason, 'stopped')
})

// protects=a run whose whole-run deadline expires while its request is in flight seals the history failed with RUNTIME_FAILED, so a replay tells a deadline expiry from a manual stop; fails_when=the seal reads only the run's own failure and writes stopped for the service's deadline; no_claim=an earlier release failure on the record (the test above)
test('a deadline that expires while the request is in flight seals the server history failed with RUNTIME_FAILED', async (context) => {
  // Arrange
  const clock = createManualClock()
  const harness = await createHarness({ now: clock.now })
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  await run.sendRequest('k1')

  // Act
  clock.advance(600_001)
  service.maintain()
  await record.stopPromise
  const history = await repository.serverHistories.read(
    `${service.instanceId}_${record.id}`,
  )

  // Assert
  const end = history.entries.at(-1)
  assert.equal(end?.type === 'end' && end.reason, 'failed')
  assert.equal(end?.type === 'end' && end.code, 'RUNTIME_FAILED')
})

// protects=a run resource read answers within the seal bound with the sealed verdicts while the stored summary read never settles; fails_when=the read waits on the summary forever or loses the sealed verdicts; no_claim=which file system stalls
test('a run resource read answers within the bound with the sealed verdicts when the summary read never settles', async (context) => {
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
  const sealedCoverage = service.state(record).nodeServer?.learningCoverage
  assert.equal(sealedCoverage, 'none')
  repository.serverHistories.summarize = () =>
    new Promise<never>(() => undefined)
  service.nodeServerHistorySealBoundMs = 50

  // Act
  let guard: ReturnType<typeof setTimeout> | undefined
  const answer = await Promise.race([
    readResource(service, service.uri(record.id)).then((resource) =>
      'text' in resource ? resource.text : '{}',
    ),
    // gstack-timing-ok: the bound is the contract; a read still pending 5 s after a 50 ms bound waits on the summary read
    new Promise<string>((resolve) => {
      guard = setTimeout(() => resolve('pending'), 5_000)
    }),
  ]).finally(() => clearTimeout(guard))

  // Assert
  assert.notEqual(answer, 'pending')
  assert.equal(
    (JSON.parse(answer) as { nodeServer?: { learningCoverage?: string } })
      .nodeServer?.learningCoverage,
    'none',
  )
})

// protects=a Stop after a failed request reads through the state and the run resource as stopped with a partial capture whose only reason is the no-response request failure; fails_when=the end reads failed, the capture reads complete, or another reason is added; no_claim=the writer-level seal (nodeServerHistorySeal tests)
test('a stop after a request failure reads partial with the request failure as the only capture reason in the state and the run resource', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run, repository } = await startHistoryServerRun(
    harness,
    context,
  )
  await run.sendRequest('k1')
  // Both declared stops are reached, so the request failure is the only thing the capture lacks.
  run.pauseAt(0)
  run.pauseAt(1)
  run.failRequest('REQUEST_FAILED', 'Connection reset.')
  run.history?.failRequest(40, 'ECONNRESET', 'Connection reset.')

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const history = await repository.serverHistories.read(
    `${service.instanceId}_${record.id}`,
  )
  const resource = await readResource(service, service.uri(record.id))
  const fromResource = JSON.parse(
    'text' in resource ? resource.text : '{}',
  ) as {
    nodeServer?: { captureMissing?: Array<{ text: string }> }
  }

  // Assert
  const end = history.entries.at(-1)
  assert.equal(end?.type === 'end' && end.reason, 'stopped')
  assert.equal(history.status, 'partial')
  assert.deepEqual(
    history.seal?.reasons.map((reason) => reason.code),
    ['SERVER_HISTORY_NO_RESPONSE_REQUEST_FAILED'],
  )
  const expectedText =
    'No response was recorded: the request failed with ECONNRESET.'
  assert.deepEqual(
    service.state(record).nodeServer?.captureMissing?.map(({ text }) => text),
    [expectedText],
  )
  assert.deepEqual(
    fromResource.nodeServer?.captureMissing?.map(({ text }) => text),
    [expectedText],
  )
})
