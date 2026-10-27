import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPOSITORY_BROWSER_ACTION } from '../constants'
import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { ContinueInput } from '../schemas'
import type { StudyService } from '../service'

import { createHarness } from './helpers'
import { createManualClock } from './utils/createManualClock'
import { defer } from './utils/defer'
import {
  nodeServerConfigurationOf,
  startFakeNodeServerRun,
} from './utils/startFakeNodeServerRun'

const POST_REQUEST = {
  method: 'POST',
  path: '/api/items',
  contentType: 'application/json',
  body: '{"name":"example"}',
} as const

/** Runs a call that may throw synchronously or reject and returns what it threw, so a test asserts one refusal shape. */
async function refusalOf(call: () => unknown): Promise<unknown> {
  try {
    await call()
  } catch (error) {
    return error
  }
  return undefined
}

/** The identity every action and continuation of a run names. */
function identityOf(service: { instanceId: string }, record: { id: string }) {
  return { instanceId: service.instanceId, runId: record.id }
}

// protects=a GET http-request answers its receipt at once and the run reads request-in-flight with the key; a repeat of the same key replays the receipt without a second request, also after later state changes; fails_when=the request is sent twice, the receipt differs, or the run omits the request; no_claim=the bytes on the wire (part U)
test('a GET http-request returns its receipt at once and the same key replays it without sending again', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  const action = {
    ...identityOf(service, record),
    key: 'send-1',
    action: 'http-request' as const,
  }
  // Act
  const receipt = await service.performAction(action)
  run.respond()
  const replay = await service.performAction(action)
  // Assert
  assert.deepEqual(Object.keys(receipt).sort(), [
    'key',
    'operationId',
    'runUri',
  ])
  assert.equal(receipt.key, 'send-1')
  assert.equal(receipt.runUri, service.uri(record.id))
  assert.deepEqual(replay, receipt)
  assert.deepEqual(run.calls, ['prepare', 'sendRequest:send-1'])
  assert.equal(service.state(record).state, 'responded')
  assert.deepEqual(service.state(record).operations, [receipt])
})

// protects=the same key naming the other action is a conflict, not a replay; fails_when=a key is reused for a different action without IDEMPOTENCY_CONFLICT; no_claim=none
test('an http-request key reused for another action is an IDEMPOTENCY_CONFLICT', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record } = await startFakeNodeServerRun(harness)
  const identity = identityOf(service, record)
  await service.performAction({
    ...identity,
    key: 'send-1',
    action: 'http-request',
  })
  // Act
  const refusal = await refusalOf(() =>
    service.performAction({
      ...identity,
      key: 'send-1',
      action: REPOSITORY_BROWSER_ACTION,
    }),
  )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'IDEMPOTENCY_CONFLICT')
})

// protects=one run sends one request: another key after it was sent gets REQUEST_ALREADY_SENT and nothing is dispatched; fails_when=a second request reaches the run; no_claim=none
test('a second http-request with another key is REQUEST_ALREADY_SENT and dispatches nothing', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  const identity = identityOf(service, record)
  await service.performAction({
    ...identity,
    key: 'send-1',
    action: 'http-request',
  })
  // Act
  const refusal = await refusalOf(() =>
    service.performAction({
      ...identity,
      key: 'send-2',
      action: 'http-request',
    }),
  )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'REQUEST_ALREADY_SENT')
  assert.deepEqual(run.calls, ['prepare', 'sendRequest:send-1'])
})

// protects=an http-request before the run is ready is RUN_NOT_READY and an action the profile does not offer is refused before it reaches the run; fails_when=a request is handed to a run that is still preparing; no_claim=none
test('an http-request while the run is still preparing is RUN_NOT_READY and sends nothing', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    holdPrepare: true,
  })
  await waitUntil(() => run.calls.includes('prepare'), 'the run was created')
  // Act
  const refusal = await refusalOf(() =>
    service.performAction({
      ...identityOf(service, record),
      key: 'early',
      action: 'http-request',
    }),
  )
  run.prepareGate.resolve()
  await record.preparation
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'RUN_NOT_READY')
  assert.deepEqual(run.calls, ['prepare'])
})

// protects=a learner pause refuses http-request with LEARNER_PAUSED before any other refusal, even REQUEST_ALREADY_SENT; fails_when=the agent is told the request was already sent while the learner holds the server; no_claim=none
test('an http-request while the learner holds the server is LEARNER_PAUSED, before REQUEST_ALREADY_SENT', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('learner-paused')
  // Act
  const refusal = await refusalOf(() =>
    service.performAction({
      ...identityOf(service, record),
      key: 'again',
      action: 'http-request',
    }),
  )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'LEARNER_PAUSED')
})

// protects=D6: a POST waits for the learner's Send in the native modal, which names the method and path, and only then reaches the run; fails_when=the request is sent before the answer or the modal lacks the method or path; no_claim=the modal's text (environment tests)
test('a POST http-request is sent only after the learner confirms it, and the confirmation names its method and path', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const answer = defer<boolean>()
  const asked: { method: string; path: string }[] = []
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    request: POST_REQUEST,
    confirm: (request) => {
      asked.push(request)
      return answer.promise
    },
  })
  // Act
  const sending = service.performAction({
    ...identityOf(service, record),
    key: 'post-1',
    action: 'http-request',
  })
  await waitUntil(() => asked.length === 1, 'the learner was asked')
  const sentWhileAsking = run.calls.includes('sendRequest:post-1')
  answer.resolve(true)
  const receipt = await sending
  // Assert
  assert.deepEqual(asked, [{ method: 'POST', path: '/api/items' }])
  assert.equal(sentWhileAsking, false)
  assert.equal(receipt.key, 'post-1')
  assert.deepEqual(run.calls, ['prepare', 'sendRequest:post-1'])
})

// protects=D6: Cancel answers REQUEST_NOT_CONFIRMED, sends nothing, keeps the run ready and does not consume the key, so a retry with the same key asks again; fails_when=a cancelled request is sent, the run leaves ready, or the key is remembered as used; no_claim=none
test('a cancelled POST is REQUEST_NOT_CONFIRMED, leaves the run ready, and the same key asks the learner again', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const answers = [false, true]
  let asked = 0
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    request: POST_REQUEST,
    confirm: async () => answers[asked++] ?? false,
  })
  const action = {
    ...identityOf(service, record),
    key: 'post-1',
    action: 'http-request' as const,
  }
  // Act
  const cancelled = await refusalOf(() => service.performAction(action))
  const stateAfterCancel = service.state(record)
  const retried = await service.performAction(action)
  // Assert
  assert.ok(cancelled instanceof StudyError)
  assert.equal(cancelled.code, 'REQUEST_NOT_CONFIRMED')
  assert.equal(stateAfterCancel.state, 'ready')
  assert.deepEqual(stateAfterCancel.nextActions, ['http-request', 'stop'])
  assert.equal(asked, 2)
  assert.equal(retried.key, 'post-1')
  assert.deepEqual(run.calls, ['prepare', 'sendRequest:post-1'])
})

// protects=D6: no answer within the bound is REQUEST_NOT_CONFIRMED: the modal's signal aborts and nothing is sent; fails_when=a request nobody confirmed is sent or the call never answers; no_claim=the 300 s default (a constant)
test('a POST nobody answers within the bound is REQUEST_NOT_CONFIRMED and sends nothing', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  harness.service.confirmationTimeoutMs = 20
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    request: POST_REQUEST,
    confirm: (_request, signal) =>
      new Promise<boolean>((resolve) => {
        signal.addEventListener('abort', () => resolve(false))
      }),
  })
  // Act
  const refusal = await refusalOf(() =>
    service.performAction({
      ...identityOf(service, record),
      key: 'post-1',
      action: 'http-request',
    }),
  )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'REQUEST_NOT_CONFIRMED')
  assert.deepEqual(run.calls, ['prepare'])
  assert.equal(service.state(record).state, 'ready')
})

// protects=an editor without the confirmation modal sends no state-changing request, while a GET is unaffected; fails_when=a POST is sent unconfirmed; no_claim=none
test('a state-changing request in an editor that cannot ask the learner is PREREQUISITE_MISSING and sends nothing', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    request: POST_REQUEST,
  })
  // Act
  const refusal = await refusalOf(() =>
    service.performAction({
      ...identityOf(service, record),
      key: 'post-1',
      action: 'http-request',
    }),
  )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'PREREQUISITE_MISSING')
  assert.deepEqual(run.calls, ['prepare'])
})

// protects=one confirmation per key: a repeat of the key being confirmed joins it (one modal, one receipt) and another key meanwhile is BUSY; fails_when=the learner is asked twice for one request or two requests are confirmed at once; no_claim=none
test('a repeated key joins the open confirmation and another key meanwhile is BUSY', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const answer = defer<boolean>()
  let asked = 0
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    request: POST_REQUEST,
    confirm: () => {
      asked++
      return answer.promise
    },
  })
  const identity = identityOf(service, record)
  // Act
  const first = service.performAction({
    ...identity,
    key: 'post-1',
    action: 'http-request',
  })
  await waitUntil(() => asked === 1, 'the learner was asked')
  const joined = service.performAction({
    ...identity,
    key: 'post-1',
    action: 'http-request',
  })
  const other = await refusalOf(() =>
    service.performAction({
      ...identity,
      key: 'post-2',
      action: 'http-request',
    }),
  )
  answer.resolve(true)
  const receipts = await Promise.all([first, joined])
  // Assert
  assert.equal(asked, 1)
  assert.deepEqual(receipts[0], receipts[1])
  assert.ok(other instanceof StudyError)
  assert.equal(other.code, 'BUSY')
  assert.deepEqual(run.calls, ['prepare', 'sendRequest:post-1'])
})

// protects=the run is checked again after the learner answered: a server the learner paused while the modal was open gets no request; fails_when=Send reaches a run that is no longer ready; no_claim=none
test('a confirmed POST is refused when the learner paused the server while the modal was open', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  let run: Awaited<ReturnType<typeof startFakeNodeServerRun>>['run'] | undefined
  const started = await startFakeNodeServerRun(harness, {
    request: POST_REQUEST,
    confirm: async () => {
      run?.learnerPause()
      return true
    },
  })
  run = started.run
  // Act
  const refusal = await refusalOf(() =>
    started.service.performAction({
      ...identityOf(started.service, started.record),
      key: 'post-1',
      action: 'http-request',
    }),
  )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'LEARNER_PAUSED')
  assert.deepEqual(started.run.calls, ['prepare'])
})

// protects=a request the run refuses at the last moment (a foreign listener replaced the server) is the run's own typed refusal and the key stays free; fails_when=the refusal becomes a generic error or the key is consumed; no_claim=the real listener check (part U)
test('a refusal of the run itself reaches the agent with its code and does not consume the key', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  const sendRequest = run.sendRequest.bind(run)
  let refuse = true
  run.sendRequest = async (key): Promise<void> => {
    if (refuse)
      throw new StudyError(
        'LISTENER_NOT_OWNED',
        'Another process answers on the port.',
      )
    await sendRequest(key)
  }
  const action = {
    ...identityOf(service, record),
    key: 'send-1',
    action: 'http-request' as const,
  }
  // Act
  const refusal = await refusalOf(() => service.performAction(action))
  refuse = false
  const receipt = await service.performAction(action)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'LISTENER_NOT_OWNED')
  assert.equal(receipt.key, 'send-1')
})

/** Narrows a continuation's answer to the one that waited: it carries the run's state beside the acknowledgement. */
function waitedAnswer(
  answer: Awaited<ReturnType<StudyService['continueToNextState']>>,
) {
  assert.ok('state' in answer, 'the answer carries the run state')
  return answer
}

/** Copies the continuation arguments of a paused run the way an agent does. */
function continueArgumentsOf(
  service: Awaited<ReturnType<typeof startFakeNodeServerRun>>['service'],
  record: Awaited<ReturnType<typeof startFakeNodeServerRun>>['record'],
) {
  const copied: ContinueInput | undefined =
    service.state(record).participants.server?.continueArguments
  assert.ok(copied, 'the run offers continue arguments')
  return copied
}

// protects=codebook_continue with the copied arguments answers with the next pause and its new generation; fails_when=the answer repeats the pause being continued, the generation does not grow, or next is missing; no_claim=the debugger resuming (part R)
test('a continuation with the copied arguments answers the next pause with a new generation', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('paused')
  const args = continueArgumentsOf(service, record)
  // Act
  const answering = service.continueToNextState(args)
  await waitUntil(() => run.calls.includes('continue:1'), 'the run resumed')
  run.pauseAt(1, { nextTheme: 'light' })
  const answer = waitedAnswer(await answering)
  // Assert
  assert.deepEqual(args, {
    instanceId: service.instanceId,
    runId: record.id,
    participant: 'server',
    sessionId: 'server-session',
    threadId: 7,
    generation: 1,
    answer: 'next',
  })
  assert.equal(answer.next, 'paused')
  assert.equal(answer.state.state, 'paused')
  assert.equal(
    answer.state.participants.server?.continueArguments?.generation,
    2,
  )
  assert.equal(answer.state.nodeServer?.pause?.stopNumber, 2)
})

// protects=the end of the request after a continuation is a result: responded, request-failed, learner-paused, unattributed each answer with next naming it and the state beside; fails_when=a word is missing, mislabelled, or the wait outlasts the change; no_claim=the error channel at the MCP boundary (protocol tests)
test('a continuation answers the state the request reached: responded, request-failed, learner-paused or unattributed', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const outcomes = [
    [
      'responded',
      (run: Awaited<ReturnType<typeof startFakeNodeServerRun>>['run']): void =>
        run.respond(),
    ],
    [
      'request-failed',
      (run: Awaited<ReturnType<typeof startFakeNodeServerRun>>['run']): void =>
        run.failRequest('REQUEST_FAILED', 'Connection reset.'),
    ],
    [
      'learner-paused',
      (run: Awaited<ReturnType<typeof startFakeNodeServerRun>>['run']): void =>
        run.learnerPause('learner'),
    ],
    [
      'unattributed',
      (run: Awaited<ReturnType<typeof startFakeNodeServerRun>>['run']): void =>
        run.learnerPause('unattributed'),
    ],
  ] as const
  const answered: string[] = []
  // Act
  for (const [index, [word, reach]] of outcomes.entries()) {
    const { service, record, run } = await startFakeNodeServerRun(harness, {
      key: String(index),
    })
    await run.enter('paused')
    const answering = service.continueToNextState(
      continueArgumentsOf(service, record),
    )
    await waitUntil(() => run.calls.includes('continue:1'), 'the run resumed')
    reach(run)
    const answer = waitedAnswer(await answering)
    answered.push(`${word}:${answer.next}:${answer.state.state}`)
    await service.stop({ instanceId: service.instanceId, runId: record.id })
  }
  // Assert
  assert.deepEqual(answered, [
    'responded:responded:responded',
    'request-failed:request-failed:request-failed',
    'learner-paused:learner-paused:learner-paused',
    'unattributed:unattributed:unattributed',
  ])
})

// protects=a stop during the continuation's wait answers stopped, a result; fails_when=the wait ends in failure or hangs after the stop; no_claim=none
test('a stop during the continuation wait answers next stopped', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('paused')
  const answering = service.continueToNextState(
    continueArgumentsOf(service, record),
  )
  await waitUntil(() => run.calls.includes('continue:1'), 'the run resumed')
  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const answer = waitedAnswer(await answering)
  // Assert
  assert.equal(answer.next, 'stopped')
  assert.ok(['stopping', 'stopped'].includes(answer.state.state))
})

// protects=D1: a failure of the run itself ends the wait with failure, sets the run's error and releases the server; fails_when=the run keeps its server after SERVER_EXITED or the wait does not see it; no_claim=none
test('a server that exits during the continuation wait ends it with failure, the run error and a released run', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('paused')
  const answering = service.continueToNextState(
    continueArgumentsOf(service, record),
  )
  await waitUntil(() => run.calls.includes('continue:1'), 'the run resumed')
  // Act
  run.failRun(new StudyError('SERVER_EXITED', 'The server exited with code 1.'))
  const answer = waitedAnswer(await answering)
  await record.stopPromise
  // Assert
  assert.equal(answer.next, 'failure')
  assert.equal(answer.state.error?.code, 'SERVER_EXITED')
  assert.equal(record.error?.code, 'SERVER_EXITED')
  assert.equal(service.state(record).state, 'stopped')
  assert.equal(run.calls.at(-1), 'stop')
})

// protects=D1: a failed request ends the request and not the server: the run keeps its server, shows the failure in error and is not stopped by the maintenance loop; fails_when=maintain stops the run after REQUEST_FAILED; no_claim=none
test('a failed request shows in the run error but the maintenance loop does not stop the server', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('request-failed')
  // Act
  service.maintain()
  const state = service.state(record)
  // Assert
  assert.equal(state.state, 'request-failed')
  assert.equal(state.error?.code, 'REQUEST_FAILED')
  assert.equal(state.terminalReason, undefined)
  assert.equal(record.error, undefined)
  assert.equal(run.calls.includes('stop'), false)
  assert.deepEqual(state.nextActions, ['stop'])
})

// protects=the contract's continue refusals in order: LEARNER_PAUSED first, then NO_PAUSE without a pause, STALE_PAUSE for another generation or a run that ended; fails_when=a stale continuation reaches the run or the codes swap; no_claim=the run's own atomic reservation (part R)
test('continue is refused as LEARNER_PAUSED, NO_PAUSE or STALE_PAUSE and never reaches the run', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  const stale = {
    ...identityOf(service, record),
    participant: 'server' as const,
    sessionId: 'server-session',
    threadId: 7,
    generation: 1,
  }
  // Act
  const noPause = await refusalOf(() => service.continue(stale))
  await run.enter('paused')
  const wrongGeneration = await refusalOf(() =>
    service.continue({ ...stale, generation: 9 }),
  )
  const wrongThread = await refusalOf(() =>
    service.continue({ ...stale, threadId: 8 }),
  )
  const wrongParticipant = await refusalOf(() =>
    service.continue({ ...stale, participant: 'browser' }),
  )
  run.learnerPause('learner')
  const learnerPaused = await refusalOf(() => service.continue(stale))
  await service.stop(identityOf(service, record))
  const afterStop = await refusalOf(() => service.continue(stale))
  // Assert
  const codes = [
    noPause,
    wrongGeneration,
    wrongThread,
    wrongParticipant,
    learnerPaused,
    afterStop,
  ].map((error) => (error instanceof StudyError ? error.code : String(error)))
  assert.deepEqual(codes, [
    'NO_PAUSE',
    'STALE_PAUSE',
    'STALE_PAUSE',
    'STALE_PAUSE',
    'LEARNER_PAUSED',
    'STALE_PAUSE',
  ])
  assert.equal(
    run.calls.some((call) => call.startsWith('continue:')),
    false,
  )
})

// protects=a continuation without answer next returns the acknowledgement only; fails_when=the call waits or adds a state; no_claim=none
test('a continuation without answer next returns only its acknowledgement', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('paused')
  const withoutAnswer: ContinueInput = {
    ...continueArgumentsOf(service, record),
    answer: undefined,
  }
  // Act
  const receipt = await service.continueToNextState(withoutAnswer)
  // Assert
  assert.deepEqual(receipt, { accepted: true, runUri: service.uri(record.id) })
})

// protects=the wait is bounded like the other profiles: at the bound the answer carries the latest state and no next word; fails_when=the call never returns while the request is still in flight; no_claim=the exact bound (a constant)
test('a continuation whose request is still in flight at the bound answers the latest state without next', async (context) => {
  // Arrange
  const clock = createManualClock()
  const harness = await createHarness({ now: clock.now })
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('paused')
  const answering = service.continueToNextState(
    continueArgumentsOf(service, record),
  )
  await waitUntil(() => run.calls.includes('continue:1'), 'the run resumed')
  // Act
  clock.advance(60_000)
  const answer = waitedAnswer(await answering)
  // Assert
  assert.equal('next' in answer, false)
  assert.equal(answer.state.state, 'request-in-flight')
})

// protects=a continuation before the environment created the run is NO_PAUSE, not a false STALE_PAUSE claiming the run ended; fails_when=the answer says the run is ending or historical; no_claim=none
test('continue before the server run exists is NO_PAUSE', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const gate = defer<void>()
  let asked = false
  harness.service.environment.createNodeServerRun = async () => {
    asked = true
    await gate.promise
    throw new Error('never created')
  }
  const { service } = harness
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'node-server',
    key: 'early',
    configuration: nodeServerConfigurationOf(harness),
  })
  await waitUntil(() => asked, 'the factory was asked')
  // Act
  const refusal = await refusalOf(() =>
    service.continue({
      ...receipt,
      participant: 'server',
      sessionId: 'server-session',
      threadId: 7,
      generation: 1,
    }),
  )
  gate.resolve()
  await service.record(receipt).preparation
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'NO_PAUSE')
})
