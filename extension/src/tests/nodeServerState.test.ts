import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { readResource } from '../resources'

import { createHarness } from './helpers'
import { createManualClock } from './utils/createManualClock'
import { startFakeNodeServerRun } from './utils/startFakeNodeServerRun'

/** Reads a paged JSON resource the way an agent does: follow nextUri, concatenate the content, parse. */
async function readPagedJson(
  service: Parameters<typeof readResource>[0],
  uri: string,
): Promise<any> {
  let content = ''
  for (let next: string | undefined = uri; next;) {
    const page = await readResource(service, next)
    assert.ok('text' in page)
    const parsed = JSON.parse(page.text)
    content += parsed.content
    next = parsed.nextUri
  }
  return JSON.parse(content)
}

// protects=a ready server run shows its address, its two declared stops, no request yet and only http-request and stop as ways forward; fails_when=the nodeServer block, the manifest or the next actions are missing; no_claim=how the run finds the address (part R)
test('a ready node-server run shows its address, stops and the http-request action', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record } = await startFakeNodeServerRun(harness)
  // Act
  const state = service.state(record)
  // Assert
  assert.equal(state.state, 'ready')
  assert.deepEqual(state.nextActions, ['http-request', 'stop'])
  assert.equal(state.runtimeRunId, 'fake-server-run')
  assert.equal(state.manifestUri, service.uri(record.id, 'manifest'))
  assert.deepEqual(state.nodeServer?.address, { host: '127.0.0.1', port: 4100 })
  assert.deepEqual(
    state.nodeServer?.stops.map((stop) => stop.declaredStopIndex),
    [0, 1],
  )
  assert.deepEqual(state.nodeServer?.stopsHitAtStart, [])
  assert.equal(state.nodeServer?.request, undefined)
  assert.equal(state.participants.server?.continueArguments, undefined)
  assert.equal(state.terminalReason, undefined)
})

// protects=a pause at a declared stop shows the stop with its captured facts, attribution timing, the generation and the exact continuation arguments, and offers continue-server as the other profiles name it; fails_when=the facts, the generation or the arguments are missing or the action has another name; no_claim=the facts' correctness (part R)
test('a node-server run paused at a declared stop shows the stop, its facts and the continuation arguments', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('request-in-flight')
  run.pauseAt(1, { 'value:nextTheme': 'dark' })
  // Act
  const state = service.state(record)
  // Assert
  assert.equal(state.state, 'paused')
  assert.deepEqual(state.nextActions, ['continue-server', 'stop'])
  assert.deepEqual(state.nodeServer?.pause, {
    declaredStopIndex: 1,
    stopNumber: 2,
    sessionId: 'server-session',
    threadId: 7,
    generation: 1,
    path: 'src/theme.ts',
    line: 1,
    sourceHash: 'a'.repeat(64),
    facts: { 'value:nextTheme': 'dark' },
    unavailable: [],
    attribution: 'timing',
    capturedAtMs: 21,
  })
  assert.deepEqual(state.nodeServer?.stopsReached, [1])
  assert.equal(state.nodeServer?.captureCount, 1)
  assert.equal(state.nodeServer?.captureBudgetExhausted, false)
  assert.deepEqual(state.participants.server?.continueArguments, {
    instanceId: service.instanceId,
    runId: record.id,
    participant: 'server',
    sessionId: 'server-session',
    threadId: 7,
    generation: 1,
    answer: 'next',
  })
})

// protects=a lost response is recovered by reading: the request, the response and the held pause stay on the run resource and in status; fails_when=a reader cannot tell what was sent or answered; no_claim=none
test('the run resource and status keep the request and the response a lost answer would have carried', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('responded')
  run.respond({ status: 503, body: '{"status":"down"}' })
  // Act
  const state = service.state(record)
  const status = await service.status()
  // Assert
  assert.equal(state.nodeServer?.request?.path, '/api/healthz')
  assert.equal(state.nodeServer?.response?.status, 503)
  assert.equal(state.nodeServer?.response?.body, '{"status":"down"}')
  assert.deepEqual(
    status.runs.map((entry) => [entry.runId, entry.state]),
    [[record.id, 'responded']],
  )
})

// protects=D1: a request failure is the request's outcome: state request-failed, the code in error, never the terminal reason, and the run goes on to stop; fails_when=the run's terminalReason or finalOutcome claims the run failed; no_claim=none
test('a request failure reads as request-failed with its error and is not the run terminal reason', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('request-failed')
  // Act
  const state = service.state(record)
  // Assert
  assert.equal(state.state, 'request-failed')
  assert.equal(state.error?.code, 'REQUEST_FAILED')
  assert.equal(state.error?.message, 'Connection reset.')
  assert.equal(state.terminalReason, undefined)
  assert.equal(state.finalOutcome, 'pending-teardown')
  assert.deepEqual(state.nodeServer?.requestFailure, {
    code: 'REQUEST_FAILED',
    message: 'Connection reset.',
  })
})

// protects=a pause the learner holds shows as a held pause with its place and offers no continue; an unattributed hit reads unattributed; fails_when=continue arguments are offered for a pause Codebook does not own; no_claim=none
test('a learner pause and an unattributed hit show as held pauses without continuation arguments', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('learner-paused')
  // Act
  const learner = service.state(record)
  run.learnerPause('unattributed')
  const unattributed = service.state(record)
  // Assert
  assert.equal(learner.state, 'learner-paused')
  assert.equal(learner.nodeServer?.heldPause?.kind, 'learner')
  assert.equal(learner.nodeServer?.heldPause?.path, 'src/theme.ts')
  assert.equal(learner.participants.server?.continueArguments, undefined)
  assert.deepEqual(learner.nextActions, ['stop'])
  assert.equal(unattributed.state, 'unattributed')
  assert.equal(unattributed.nodeServer?.heldPause?.kind, 'unattributed')
})

// protects=stops hit before readiness and an exhausted capture budget reach the agent; fails_when=the agent cannot tell that the request may not reach a stop or that captures stopped; no_claim=the run counting them (part R)
test('stops hit at start and an exhausted capture budget are shown on the run', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  run.change({ stopsHitAtStart: [0], captureBudgetExhausted: true })
  // Act
  const block = service.state(record).nodeServer
  // Assert
  assert.deepEqual(block?.stopsHitAtStart, [0])
  assert.equal(block?.captureBudgetExhausted, true)
})

// protects=D9: a failed stop reads stopping with only stop offered until a retry succeeds, and the second failure names the pid for the learner; fails_when=the run reads stopped or failed after a failed release, or stop is not offered again; no_claim=the real release (part R)
test('a failed stop keeps the run stopping with stop offered, and the second failure names the pid', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('responded')
  run.stopFailures = 2
  const identity = { instanceId: service.instanceId, runId: record.id }
  // Act
  const first = await service.stop(identity).catch((error: unknown) => error)
  const afterFirst = service.state(record)
  const second = await service.stop(identity).catch((error: unknown) => error)
  const afterSecond = service.state(record)
  const third = await service.stop(identity)
  // Assert
  assert.ok(first instanceof StudyError)
  assert.equal(afterFirst.state, 'stopping')
  assert.deepEqual(afterFirst.nextActions, ['stop'])
  assert.equal(afterFirst.nodeServer?.failedStops, 1)
  assert.ok(second instanceof StudyError)
  assert.match(second.message, /end process 4242 yourself/)
  assert.match(
    afterSecond.cleanupError?.message ?? '',
    /end process 4242 yourself/,
  )
  assert.equal(third.state, 'stopped')
})

// protects=D1: a failure of the run (the server exited) becomes the run's error and terminal reason, releases the server and leaves the run stopped with the error; fails_when=the server keeps running after SERVER_EXITED or the error is lost; no_claim=none
test('a server that exits ends the run with SERVER_EXITED as its error and releases it', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('request-in-flight')
  // Act
  run.failRun(new StudyError('SERVER_EXITED', 'The server exited with code 1.'))
  await record.stopPromise
  const state = service.state(record)
  // Assert
  assert.equal(state.state, 'stopped')
  assert.equal(state.error?.code, 'SERVER_EXITED')
  assert.equal(state.terminalReason, 'The server exited with code 1.')
  assert.equal(state.finalOutcome, 'not-demonstrated')
  assert.equal(run.calls.at(-1), 'stop')
})

// protects=D2: the repository run deadline (600 s) applies to a node-server run, also after its response: the deadline error and a release follow; fails_when=a server outlives the run deadline; no_claim=the request's 15-minute backstop (part R)
test('the run deadline stops a node-server run even after its request was answered', async (context) => {
  // Arrange
  const clock = createManualClock()
  const harness = await createHarness({ now: clock.now })
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('responded')
  // Act
  clock.advance(600_001)
  service.maintain()
  await record.stopPromise
  const state = service.state(record)
  // Assert
  assert.equal(state.state, 'stopped')
  assert.equal(
    state.error?.message,
    'Study wall deadline expired; history only.',
  )
  assert.equal(run.calls.at(-1), 'stop')
})

// protects=the run resource family answers for a node-server run: its manifest freezes the declaration and its hash, and images and snapshots are refused; fails_when=the manifest is the browser's, or an image read answers a file; no_claim=none
test('a node-server run resource serves its manifest and refuses images and snapshots', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record } = await startFakeNodeServerRun(harness)
  const runUri = service.uri(record.id)
  // Act
  const body = await readPagedJson(service, service.uri(record.id, 'manifest'))
  const image = await readResource(
    service,
    service.uri(record.id, 'images/before'),
  ).catch((error: unknown) => error)
  const snapshot = await readResource(
    service,
    service.uri(record.id, 'snapshots/server-1'),
  ).catch((error: unknown) => error)
  const runResource = await readResource(service, runUri)
  // Assert
  assert.equal(body.profile, 'node-server')
  assert.equal(body.configuration.port, 4100)
  assert.equal(body.configuration.loader, 'tsx')
  assert.equal(body.configurationHash, service.state(record).manifestHash)
  assert.ok(
    image instanceof StudyError && image.code === 'EVIDENCE_UNAVAILABLE',
  )
  assert.ok(
    snapshot instanceof StudyError && snapshot.code === 'EVIDENCE_UNAVAILABLE',
  )
  assert.equal(
    'text' in runResource && JSON.parse(runResource.text).state,
    'ready',
  )
})
