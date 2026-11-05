import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { NODE_SCRIPT_PROFILE } from '../constants'
import { StudyError } from '../errors'
import { readResource } from '../resources'

import { createHarness } from './helpers'
import {
  FakeNodeScriptRuntime,
  FAKE_SCRIPT_SESSION_ID,
  FAKE_SCRIPT_THREAD_ID,
} from './utils/fakeNodeScriptRuntime'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

type Harness = Awaited<ReturnType<typeof createHarness>>

/** The script declaration over the harness's published article: two stops in the cited file, run once from the repository root. */
function scriptConfigurationOf(harness: Pick<Harness, 'configuration'>) {
  const base = harness.configuration
  return {
    version: 1,
    adapter: 'node-script',
    book: base.book,
    entry: 'src/run.mjs',
    source: base.source,
    inspections: base.inspections.slice(0, 1),
    additionalStops: [
      {
        ...base.source,
        anchorIndex: 0,
        inspections: base.inspections.slice(0, 1),
      },
    ],
  }
}

/** Starts a script run on a service whose environment creates a {@link FakeNodeScriptRuntime}, and waits for its preparation unless the confirmation is held. */
async function startFakeScriptRun(
  harness: Harness,
  options: { key?: string; holdConfirmation?: boolean } = {},
) {
  const { service } = harness
  const run = new FakeNodeScriptRuntime()
  run.holdsConfirmation = options.holdConfirmation === true
  service.environment.createNodeScriptRun = async () => run
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_SCRIPT_PROFILE,
    key: options.key ?? 'first',
    configuration: scriptConfigurationOf(harness),
  })
  const record = service.record(receipt)
  if (!options.holdConfirmation) await record.preparation
  return { service, record, run, receipt }
}

/** Reads the run resource's JSON. */
async function runJson(
  service: Harness['service'],
  record: { id: string },
): Promise<Record<string, any>> {
  const resource = await readResource(service, service.uri(record.id))
  return JSON.parse('text' in resource ? resource.text : '{}')
}

// protects=a node-script start with a valid configuration prepares and the run resource reads running with the continue and stop ways forward; fails_when=the profile is refused as unsupported or the run never reaches running; no_claim=the real process (the run tests cover it)
test('a node-script start prepares to running and offers only stop', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())

  // Act
  const { service, record, run } = await startFakeScriptRun(harness)
  const state = service.state(record)

  // Assert
  assert.equal(record.profile, NODE_SCRIPT_PROFILE)
  assert.equal(run.calls[0], 'prepare')
  assert.equal(state.state, 'running')
  assert.deepEqual(state.nextActions, ['stop'])
})

// protects=the run resource names the fields the node-script help documents: nodeScript.state, confirmation, pause, continueArguments, end, stops and the history fields; fails_when=a documented name is missing or renamed; no_claim=the help text (its own test pins it)
test('the run resource carries the nodeScript block with the names the help documents', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeScriptRun(harness)
  run.pauseAt(0, { total: 3 })

  // Act
  const paused = await runJson(service, record)
  await service.continue(paused.nodeScript.continueArguments)
  run.end({ exitCode: 3 })
  await runJson(service, record)
  const ended = await runJson(service, record)

  // Assert
  assert.equal(paused.nodeScript.state, 'paused')
  assert.equal(paused.nodeScript.confirmation, 'confirmed')
  assert.equal(paused.nodeScript.pause.stopNumber, 1)
  assert.deepEqual(paused.nodeScript.pause.facts, { total: 3 })
  assert.deepEqual(paused.nodeScript.continueArguments, {
    instanceId: service.instanceId,
    runId: record.id,
    participant: 'server',
    sessionId: FAKE_SCRIPT_SESSION_ID,
    threadId: FAKE_SCRIPT_THREAD_ID,
    generation: 1,
    answer: 'next',
  })
  assert.deepEqual(paused.participants.server.continueArguments, {
    ...paused.nodeScript.continueArguments,
  })
  // The harness holds no learning storage, so the history reads unavailable with its issue.
  assert.equal(paused.nodeScript.history, 'unavailable')
  assert.equal(paused.nodeScript.historyIssue.code, 'HISTORY_UNAVAILABLE')
  assert.equal(ended.nodeScript.end.kind, 'exited')
  assert.equal(ended.nodeScript.end.exitCode, 3)
})

// protects=a script that ended by itself, even with a nonzero exit, reads ended with no error and the service releases the run; fails_when=the exit becomes the run's error or the record stays unreleased (the next start answers BUSY); no_claim=the real exit
test('a script that ends by itself reads ended with no error and the run is released', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeScriptRun(harness)

  // Act
  run.end({ exitCode: 3 })
  await record.stopPromise
  const state = service.state(record)

  // Assert
  assert.equal(state.state, 'ended')
  assert.equal(record.error, undefined)
  assert.equal(record.stopped, true)
  assert.deepEqual(run.calls.at(-1), 'stop')
})

// protects=codebook_continue with the run's current arguments resumes the pause through the run, and stale arguments are refused; fails_when=the continue skips the run or accepts an old generation; no_claim=the debugger resume
test('codebook_continue routes the current pause to the run and refuses a stale one', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeScriptRun(harness)
  run.pauseAt(0)
  const { continueArguments } = (await runJson(service, record)).nodeScript

  // Act
  const stale = await service
    .continue({ ...continueArguments, generation: 9 })
    .catch((error: unknown) => error)
  const accepted = await service.continue(continueArguments)

  // Assert
  assert.ok(stale instanceof StudyError)
  assert.equal(stale.code, 'STALE_PAUSE')
  assert.equal(accepted.accepted, true)
  assert.deepEqual(run.calls, ['prepare', 'continue:1'])
})

// protects=a new start while the learner is asked to confirm a script answers BUSY with reason awaiting-confirmation, not the generic BUSY; fails_when=the reason is missing or a second run starts; no_claim=the real dialog
test('a start while the confirmation dialog is open answers BUSY with reason awaiting-confirmation', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeScriptRun(harness, {
    holdConfirmation: true,
  })
  while (!run.calls.includes('prepare'))
    await new Promise((resolve) => setImmediate(resolve))
  const confirmationWhileAsked = (await runJson(service, record)).nodeScript
    .confirmation

  // Act
  let refusal: unknown
  try {
    service.start({
      instanceId: service.instanceId,
      profile: NODE_SCRIPT_PROFILE,
      key: 'second',
      configuration: scriptConfigurationOf(harness),
    })
  } catch (error) {
    refusal = error
  }
  run.confirmGate.resolve()
  await record.preparation

  // Assert
  assert.equal(confirmationWhileAsked, 'awaiting-learner')
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'BUSY')
  assert.equal(refusal.details?.reason, 'awaiting-confirmation')
})

// protects=a port, a node option or an environment in the configuration is refused as INVALID_CONFIGURATION naming the node-script help; fails_when=the strict schema is loosened or the help named is the server's; no_claim=each field's own wording
test('a node-script configuration with a port is refused and names codebook://help/node-script', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service } = harness

  // Act
  let refusal: unknown
  try {
    service.start({
      instanceId: service.instanceId,
      profile: NODE_SCRIPT_PROFILE,
      key: 'bad',
      configuration: { ...scriptConfigurationOf(harness), port: 4100 },
    })
  } catch (error) {
    refusal = error
  }

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.match(refusal.message, /See codebook:\/\/help\/node-script\.$/)
})

// protects=codebook_status lists the node-script profile with its help, adapter, no action and the 60 s running-time limit; fails_when=the profile is missing or advertises an action; no_claim=the machine readiness
test('codebook_status lists the node-script profile with its help and limits', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  harness.service.environment.createNodeScriptRun = async () => {
    throw new Error('not created by status')
  }

  // Act
  const status = await harness.service.status()
  const profile = status.profiles.find((entry) => entry.id === 'node-script')

  // Assert
  assert.equal(profile?.helpUri, 'codebook://help/node-script')
  assert.equal(profile?.adapter, 'node-script')
  assert.deepEqual(profile?.actions, [])
  assert.equal(
    profile?.limits && 'scriptRunningTimeoutMs' in profile.limits
      ? profile.limits.scriptRunningTimeoutMs
      : undefined,
    60_000,
  )
  assert.equal(profile?.prerequisites.ready, true)
})

// protects=a script run offers no action: performing one is refused; fails_when=a script run accepts the server's http-request; no_claim=the tool boundary's own validation
test('performing an action on a script run is refused', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record } = await startFakeScriptRun(harness)

  // Act
  const refusal = await service
    .performAction({
      instanceId: service.instanceId,
      runId: record.id,
      key: 'send',
      action: 'http-request',
    })
    .catch((error: unknown) => error)

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
})

// protects=a stop during the learner's confirmation reports stopped only after the script run released its process group; fails_when=the service does not await the run's stop that it started for an unprepared script; no_claim=the real process group release
test('a stop during the confirmation dialog resolves only after the script run finished stopping', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeScriptRun(harness, {
    holdConfirmation: true,
  })
  while (!run.calls.includes('prepare'))
    await new Promise((resolve) => setImmediate(resolve))
  run.holdsStop = true
  let didStopResolve = false

  // Act
  const stopping = service
    .stop({ instanceId: service.instanceId, runId: record.id })
    .then(() => {
      didStopResolve = true
    })
  for (let turn = 0; turn < 20; turn += 1)
    await new Promise((resolve) => setImmediate(resolve))
  const didResolveBeforeRelease = didStopResolve
  const stoppedBeforeRelease = record.stopped
  run.stopGate.resolve()
  await stopping

  // Assert
  assert.equal(didResolveBeforeRelease, false)
  assert.equal(stoppedBeforeRelease, false)
  assert.equal(didStopResolve, true)
  assert.equal(record.stopped, true)
})

// protects=a script run whose stop fails during preparation fails the stop and leaves the run not stopped, so the next stop retries; fails_when=the failed stop is swallowed and the record reads stopped; no_claim=the wording of the failure
test('a failed script stop during the confirmation dialog fails the stop and leaves the run unstopped', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeScriptRun(harness, {
    holdConfirmation: true,
  })
  while (!run.calls.includes('prepare'))
    await new Promise((resolve) => setImmediate(resolve))
  run.stopFailure = new Error('process group not released')

  // Act
  const failure = await service
    .stop({ instanceId: service.instanceId, runId: record.id })
    .then(
      () => undefined,
      (error: unknown) => error,
    )

  // Assert
  assert.ok(failure instanceof Error)
  assert.equal(record.stopped, false)

  // Cleanup: the retry releases the group, as the next stop would.
  run.stopFailure = undefined
  await service.stop({ instanceId: service.instanceId, runId: record.id })
})

// protects=the script run is given the time left of the service's absolute deadline, so a late start cannot outlive the service's bound; fails_when=prepare gets no limit and the run arms its full own limit from its late start; no_claim=the run's own timer (ownedNodeScriptRun tests)
test('a script run is prepared with the time left of the service deadline', async (context) => {
  // Arrange
  const nowMs = 1_000_000
  const harness = await createHarness({ now: () => nowMs })
  context.after(() => harness.close())

  // Act
  const { run } = await startFakeScriptRun(harness)

  // Assert
  assert.equal(run.prepareLimits?.runTimeoutMs, 600_000)
})
