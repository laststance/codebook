import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NODE_SERVER_PROFILE } from '../constants'
import { StudyError } from '../errors'
import type { NodeServerState } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { createHarness } from './helpers'
import {
  createHarness as createRunHarness,
  RESPONSE_200,
  type Harness as RunHarness,
} from './utils/nodeServerRunHarness'
import { outcomeOf, STATE_TABLE } from './utils/nodeServerStateTable'
import { nodeServerConfigurationOf } from './utils/startFakeNodeServerRun'

/**
 * Brings the real run class (over the run harness's fake debugger, server and sender) into a state through the service, by the calls an agent makes and the events the editor would send.
 * @param state - The state to reach.
 * @returns The service harness, the service, the run's record and the real run's handles.
 * @example const { service, record, real } = await realRunInState('paused')
 */
async function realRunInState(state: NodeServerState) {
  const harness = await createHarness()
  const { service } = harness
  let real: RunHarness | undefined
  service.environment.createNodeServerRun = async (
    _configuration,
    record,
    _citedSources,
    runId,
  ) => {
    real = createRunHarness({
      record,
      runId,
      // The stopping row needs a close that hangs until the test releases it; the preparing row a readiness that waits for the stop.
      holdClose: state === 'stopping',
      waitForReadiness:
        state === 'preparing'
          ? ({ signal }) =>
              new Promise((resolve) =>
                signal.addEventListener('abort', () => resolve(undefined)),
              )
          : undefined,
    })
    return real.run
  }
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_SERVER_PROFILE,
    key: 'server-run',
    configuration: nodeServerConfigurationOf(harness),
  })
  const record = service.record(receipt)
  const identity = { instanceId: service.instanceId, runId: record.id }
  if (state !== 'preparing') await record.preparation
  await waitUntil(() => real, 'the real run was created', 5_000)
  const control = real!
  const reaches = (wanted: NodeServerState): Promise<unknown> =>
    waitUntil(
      () => service.state(record).state === wanted,
      `the run reads ${wanted}`,
      5_000,
    )
  if (!['preparing', 'ready'].includes(state))
    await service.performAction({
      ...identity,
      key: 'first',
      action: 'http-request',
    })
  if (state === 'paused') control.debug.hit(0)
  if (state === 'learner-paused') control.debug.learnerPause()
  if (['responded', 'unattributed', 'stopping', 'stopped'].includes(state)) {
    control.sender.response.resolve(RESPONSE_200)
    await reaches('responded')
  }
  // A declared stop hit after the response is held outside the request window.
  if (state === 'unattributed') control.debug.hit(0)
  if (state === 'request-failed')
    control.sender.response.reject(new StudyError('REQUEST_FAILED', 'reset'))
  if (state === 'stopping') {
    const stopping = service.stop(identity)
    await waitUntil(
      () => control.server.closeCalls === 1,
      'the hung close began',
      5_000,
    )
    control.clock.advance(10_000)
    await assert.rejects(stopping, { code: 'RUNTIME_FAILED' })
  }
  if (state === 'stopped') await service.stop(identity)
  await reaches(state)
  return { harness, service, record, identity, real: control }
}

for (const row of STATE_TABLE) {
  // protects=the real run class answers the table's http-request cell through the service, as the fake run does; fails_when=the real run sends where the table refuses, or refuses with another code; no_claim=the fake run's cell (its own test)
  test(`the real run while ${row.state} answers a new http-request ${row.httpRequest}`, async (context) => {
    // Arrange
    const { harness, service, record, real } = await realRunInState(row.state)
    context.after(() => {
      // The stopping row's hung close lets go so that closing the service can finish it.
      real.server.closeGate.resolve()
      return harness.close()
    })
    const sentBefore = real.sender.calls.length
    // Act
    const outcome = await outcomeOf(() =>
      service.performAction({
        instanceId: service.instanceId,
        runId: record.id,
        key: 'second',
        action: 'http-request',
      }),
    )
    // Assert
    assert.equal(outcome, row.httpRequest)
    assert.equal(
      real.sender.calls.length - sentBefore,
      row.httpRequest === 'accepted' ? 1 : 0,
    )
  })

  // protects=the real run class answers the table's continue cell through the service, the stopping row included; fails_when=a stale or absent pause reaches the real run's debugger, the current pause is refused, or the code differs from the table; no_claim=the wait after a continuation (request tests)
  test(`the real run while ${row.state} answers a continue ${row.continue}`, async (context) => {
    // Arrange
    const { harness, service, record, real } = await realRunInState(row.state)
    context.after(() => {
      // The stopping row's hung close lets go so that closing the service can finish it.
      real.server.closeGate.resolve()
      return harness.close()
    })
    const current = service.state(record).participants.server?.continueArguments
    const earlier = {
      instanceId: service.instanceId,
      runId: record.id,
      participant: 'server' as const,
      sessionId: 'session-1',
      threadId: 1,
      generation: 1,
    }
    // Act
    const outcome = await outcomeOf(() => service.continue(current ?? earlier))
    // Assert
    assert.equal(outcome, row.continue)
    assert.equal(real.debug.resumed.length, row.continue === 'accepted' ? 1 : 0)
  })

  // protects=the real run class accepts a stop in every state and reads stopped, and a stopped run is not released twice; fails_when=a stop is refused or leaves the run unstopped; no_claim=the release itself (run tests)
  test(`the real run while ${row.state} accepts a stop and reads stopped`, async (context) => {
    // Arrange
    const { harness, service, record, real } = await realRunInState(row.state)
    context.after(() => {
      // The stopping row's hung close lets go so that closing the service can finish it.
      real.server.closeGate.resolve()
      return harness.close()
    })
    // The stopping row's hung close lets go so that its retry can finish.
    real.server.closeGate.resolve()
    const closesBefore = real.server.closeCalls
    // Act
    const outcome = await outcomeOf(() =>
      service.stop({ instanceId: service.instanceId, runId: record.id }),
    )
    // Assert
    assert.equal(outcome, row.stop)
    assert.equal(service.state(record).state, 'stopped')
    if (row.state === 'stopped')
      assert.equal(real.server.closeCalls, closesBefore)
  })
}

// protects=the real run itself, called without the service in front, refuses a continue of a stopping run with STALE_PAUSE as the table says; fails_when=the run answers NO_PAUSE for a run that is ending; no_claim=the service's own pre-check (the table above)
test('the real run answers a continue of a stopping run STALE_PAUSE and not NO_PAUSE', async () => {
  // Arrange
  const harness = createRunHarness({ holdClose: true })
  await harness.run.prepare()
  const stopping = harness.run.stop()
  void stopping.catch(() => undefined)
  // Act
  const outcome = await outcomeOf(() =>
    harness.run.continue({
      sessionId: 'session-1',
      threadId: 1,
      generation: 1,
    }),
  )
  harness.server.closeGate.resolve()
  await stopping
  // Assert
  assert.equal(outcome, 'STALE_PAUSE')
})
