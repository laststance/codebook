import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NODE_SERVER_PROFILE } from '../constants'
import type { ErrorCode } from '../errors'
import { StudyError } from '../errors'
import type { NodeServerState } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { createHarness } from './helpers'
import {
  nodeServerConfigurationOf,
  startFakeNodeServerRun,
} from './utils/startFakeNodeServerRun'

/** What a call answers in a state: a refusal with its code, or that the call is accepted. */
type Outcome = ErrorCode | 'accepted'

/**
 * THE STATE × CALL TABLE (Issue #139 task 10, AC 3), the one source of the cell tests below. Rows are the ten states of a node-server run; columns are the calls an agent makes. A cell is the code the call is refused with, or `accepted`.
 *
 * - start (a new key): `BUSY` while any run still owns resources (every state but stopped); accepted once the run is stopped.
 * - http-request (a new key): the order is LEARNER_PAUSED (the learner holds the server: learner-paused, unattributed), then REQUEST_ALREADY_SENT (a request went out: in flight, paused, responded, request-failed, and a stopping or stopped run that sent one), then RUN_NOT_READY (preparing; a run that never sent and is ending). Only `ready` accepts.
 * - continue (the current arguments when the run is paused, otherwise the arguments of the earlier pause): LEARNER_PAUSED first; then STALE_PAUSE for a run that is ending or ended (every pause is historical); then NO_PAUSE when the server is not paused at a declared stop (preparing, ready, in flight, responded, request-failed). Only `paused` accepts.
 * - stop: accepted in every state (idempotent; it cancels a preparation, releases a live run, retries a failed stop and answers the stopped run).
 * - the same key and arguments replay the stored receipt in every state: for start in every row; for http-request in every row after the request went out.
 */
const STATE_TABLE: readonly {
  state: NodeServerState
  start: Outcome
  httpRequest: Outcome
  continue: Outcome
  stop: Outcome
}[] = [
  {
    state: 'preparing',
    start: 'BUSY',
    httpRequest: 'RUN_NOT_READY',
    continue: 'NO_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'ready',
    start: 'BUSY',
    httpRequest: 'accepted',
    continue: 'NO_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'request-in-flight',
    start: 'BUSY',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'NO_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'paused',
    start: 'BUSY',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'accepted',
    stop: 'accepted',
  },
  {
    state: 'learner-paused',
    start: 'BUSY',
    httpRequest: 'LEARNER_PAUSED',
    continue: 'LEARNER_PAUSED',
    stop: 'accepted',
  },
  {
    state: 'unattributed',
    start: 'BUSY',
    httpRequest: 'LEARNER_PAUSED',
    continue: 'LEARNER_PAUSED',
    stop: 'accepted',
  },
  {
    state: 'responded',
    start: 'BUSY',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'NO_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'request-failed',
    start: 'BUSY',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'NO_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'stopping',
    start: 'BUSY',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'STALE_PAUSE',
    stop: 'accepted',
  },
  {
    state: 'stopped',
    start: 'accepted',
    httpRequest: 'REQUEST_ALREADY_SENT',
    continue: 'STALE_PAUSE',
    stop: 'accepted',
  },
]

/** Brings a fresh node-server run into a state by the same calls an agent makes, so the state is the service's, not only the fake's. */
async function runInState(state: NodeServerState) {
  const harness = await createHarness()
  const started = await startFakeNodeServerRun(harness, {
    holdPrepare: state === 'preparing',
  })
  const { service, record, run } = started
  const identity = { instanceId: service.instanceId, runId: record.id }
  if (state === 'preparing')
    await waitUntil(() => run.calls.includes('prepare'), 'the run was created')
  let sentReceipt: Awaited<ReturnType<typeof service.performAction>> | undefined
  const sendsFirst = !['preparing', 'ready'].includes(state)
  if (sendsFirst)
    sentReceipt = await service.performAction({
      ...identity,
      key: 'first',
      action: 'http-request',
    })
  if (state === 'paused') run.pauseAt(0, { nextTheme: 'dark' })
  if (state === 'learner-paused') run.learnerPause('learner')
  if (state === 'unattributed') run.learnerPause('unattributed')
  if (state === 'responded') run.respond()
  if (state === 'request-failed')
    run.failRequest('REQUEST_FAILED', 'Connection reset.')
  if (state === 'stopping') {
    run.respond()
    run.stopFailures = 1
    await assert.rejects(service.stop(identity), { code: 'RUNTIME_FAILED' })
  }
  if (state === 'stopped') {
    run.respond()
    await service.stop(identity)
  }
  assert.equal(service.state(record).state, state, `the setup reached ${state}`)
  return { harness, ...started, identity, sentReceipt }
}

/** Runs a call and reports `accepted` or the code it was refused with. */
async function outcomeOf(call: () => unknown): Promise<Outcome> {
  try {
    await call()
    return 'accepted'
  } catch (error) {
    if (error instanceof StudyError) return error.code
    throw error
  }
}

for (const row of STATE_TABLE) {
  // protects=one cell of the state × call table: the call's result or code in this state; fails_when=the call answers another code, or is accepted where the table refuses it; no_claim=the other cells (each has its own test)
  test(`while ${row.state}, a new start is ${row.start}`, async (context) => {
    // Arrange
    const { harness, service } = await runInState(row.state)
    context.after(() => harness.close())
    // Act
    const outcome = await outcomeOf(() =>
      service.start({
        instanceId: service.instanceId,
        profile: NODE_SERVER_PROFILE,
        key: 'another-start',
        configuration: nodeServerConfigurationOf(harness),
      }),
    )
    // Assert
    assert.equal(outcome, row.start)
  })

  // protects=one cell of the state × call table: a new http-request key in this state; fails_when=another code answers, or a request is sent where the table refuses it; no_claim=the modal for state-changing requests (its own tests)
  test(`while ${row.state}, a new http-request is ${row.httpRequest}`, async (context) => {
    // Arrange
    const { harness, service, record, run } = await runInState(row.state)
    context.after(() => harness.close())
    const sentBefore = run.calls.filter((call) =>
      call.startsWith('sendRequest:'),
    ).length
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
    const sentAfter = run.calls.filter((call) =>
      call.startsWith('sendRequest:'),
    ).length
    assert.equal(sentAfter - sentBefore, row.httpRequest === 'accepted' ? 1 : 0)
  })

  // protects=one cell of the state × call table: a continuation in this state; fails_when=another code answers, a stale pause reaches the run, or the current pause is refused; no_claim=the wait after a continuation (request tests)
  test(`while ${row.state}, a continue is ${row.continue}`, async (context) => {
    // Arrange
    const { harness, service, record, run } = await runInState(row.state)
    context.after(() => harness.close())
    const current = service.state(record).participants.server?.continueArguments
    const earlier = {
      instanceId: service.instanceId,
      runId: record.id,
      participant: 'server' as const,
      sessionId: 'server-session',
      threadId: 7,
      generation: 1,
    }
    // Act
    const outcome = await outcomeOf(() => service.continue(current ?? earlier))
    // Assert
    assert.equal(outcome, row.continue)
    assert.equal(run.calls.includes('continue:1'), row.continue === 'accepted')
  })

  // protects=one cell of the state × call table: a stop in this state; fails_when=a stop is refused, leaves the run unstopped, or a stopped run is stopped twice; no_claim=the release itself (part R)
  test(`while ${row.state}, a stop is ${row.stop} and the run reads stopped`, async (context) => {
    // Arrange
    const { harness, service, record, run } = await runInState(row.state)
    context.after(() => harness.close())
    const stopsBefore = run.calls.filter((call) => call === 'stop').length
    // Act
    const outcome = await outcomeOf(() =>
      service.stop({ instanceId: service.instanceId, runId: record.id }),
    )
    // Assert
    assert.equal(outcome, row.stop)
    assert.equal(service.state(record).state, 'stopped')
    // A stopped run is not released twice.
    if (row.state === 'stopped')
      assert.equal(
        run.calls.filter((call) => call === 'stop').length,
        stopsBefore,
      )
  })

  // protects=the replay column of the table: the same start key and arguments return the original receipt in this state; fails_when=a replay starts a run, is refused, or answers another receipt; no_claim=a changed declaration (admission tests)
  test(`while ${row.state}, the same start key and arguments replay the receipt`, async (context) => {
    // Arrange
    const { harness, service, receipt } = await runInState(row.state)
    context.after(() => harness.close())
    // Act
    const replay = service.start({
      instanceId: service.instanceId,
      profile: NODE_SERVER_PROFILE,
      key: 'server-run',
      configuration: nodeServerConfigurationOf(harness),
    })
    // Assert
    assert.deepEqual(replay, receipt)
    assert.equal(service.records.size, 1)
  })

  if (!['preparing', 'ready'].includes(row.state))
    // protects=the replay column of the table: after the request went out, its key and action return the original receipt in this state, also from a stopped run; fails_when=a replay is refused as REQUEST_ALREADY_SENT or LEARNER_PAUSED, or sends again; no_claim=a lost response of the first call (the replay is the recovery)
    test(`while ${row.state}, the same http-request key replays the receipt`, async (context) => {
      // Arrange
      const { harness, service, record, run, sentReceipt } = await runInState(
        row.state,
      )
      context.after(() => harness.close())
      // Act
      const replay = await service.performAction({
        instanceId: service.instanceId,
        runId: record.id,
        key: 'first',
        action: 'http-request',
      })
      // Assert
      assert.deepEqual(replay, sentReceipt)
      assert.equal(
        run.calls.filter((call) => call.startsWith('sendRequest:')).length,
        1,
      )
    })
}

// protects=the table covers every state of the contract once; fails_when=a state is added to NodeServerState without a row; no_claim=none
test('the state × call table has one row for each of the ten node-server states', () => {
  // Arrange
  const states = STATE_TABLE.map((row) => row.state)
  // Assert
  assert.deepEqual(states, [
    'preparing',
    'ready',
    'request-in-flight',
    'paused',
    'learner-paused',
    'unattributed',
    'responded',
    'request-failed',
    'stopping',
    'stopped',
  ])
})
