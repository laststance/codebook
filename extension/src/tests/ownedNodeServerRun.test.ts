import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { ownedDevelopmentPortState } from '../utils/ownedDevelopmentPorts'

import { defer } from './utils/defer'
import {
  createHarness,
  readyHarness,
  RESPONSE_200,
  sendRequest,
  until,
  WORKSPACE,
  type Harness,
} from './utils/nodeServerRunHarness'

/** Asserts a promise rejects with a StudyError of this code and returns the error. */
async function rejectsWith(
  promise: Promise<unknown>,
  code: string,
): Promise<StudyError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  assert.ok(
    error instanceof StudyError,
    `expected ${code}, got ${String(error)}`,
  )
  assert.equal(error.code, code)
  return error
}

/** Sends the request and waits for a pause at stop `index`; returns its continuation identity. */
async function pausedAtStop(harness: Harness, index = 0) {
  await sendRequest(harness)
  harness.debug.hit(index)
  const view = await until(harness, (current) => current.state === 'paused')
  assert.ok(view.pause)
  return view.pause
}

// ---------------------------------------------------------------- preparation

// protects=nothing is spawned before the cited-source, launch, stop and port checks pass (D5, D12); fails_when=a process is launched or a debugger attached while the editor holds other text for a cited source; no_claim=the real editor documents
test('a cited source open in the editor with other text refuses the start before anything is launched', async () => {
  // Arrange
  const harness = createHarness({
    sourcesChanged: new StudyError(
      'SOURCE_CHANGED',
      'The cited source differs.',
    ),
  })
  // Act
  const error = await rejectsWith(harness.run.prepare(), 'SOURCE_CHANGED')
  // Assert
  assert.equal(error.message, 'The cited source differs.')
  assert.equal(harness.calls.launch, 0)
  assert.deepEqual(harness.order.slice(0, 3), [
    'resolveStops',
    'assertSourcesUnchanged',
    'debugger.release',
  ])
})

// protects=a refused launch input (realpath, loader) spawns nothing; fails_when=launch runs after NODE_SERVER_SOURCE_REFUSED; no_claim=the real realpath checks
test('a launch input the resolver refuses starts no server and keeps the typed refusal', async () => {
  // Arrange
  const harness = createHarness({
    resolveLaunchFails: new StudyError(
      'NODE_SERVER_SOURCE_REFUSED',
      "node-server's entry is not a file inside packageRoot.",
    ),
  })
  // Act
  await rejectsWith(harness.run.prepare(), 'NODE_SERVER_SOURCE_REFUSED')
  // Assert
  assert.equal(harness.calls.launch, 0)
  assert.equal(
    harness.run.view().runFailure?.code,
    'NODE_SERVER_SOURCE_REFUSED',
  )
})

// protects=a declared port that is taken refuses before the launch; fails_when=the server is spawned on a taken port; no_claim=the real port probe
test('a declared port that is taken starts no server and rejects with PORT_UNAVAILABLE', async () => {
  // Arrange
  const harness = createHarness({
    portTaken: new StudyError(
      'PORT_UNAVAILABLE',
      'Process 99 (node) listens on port 4100.',
    ),
  })
  // Act
  const error = await rejectsWith(harness.run.prepare(), 'PORT_UNAVAILABLE')
  // Assert
  assert.match(error.message, /Process 99 \(node\)/)
  assert.equal(harness.calls.launch, 0)
})

// protects=the preparation order of task 9 and the orphan record before the release; fails_when=any step moves, or the process is not remembered before the server is released; no_claim=real processes
test('the preparation runs the checks, then launches, attaches, arms, remembers the process, releases and verifies the listener', async () => {
  // Arrange
  const harness = createHarness({ inspectorPort: 9333 })
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(harness.order, [
    'resolveStops',
    'assertSourcesUnchanged',
    'resolveLaunch',
    'assertPortFree',
    'launch',
    'rememberProcess',
    'attach',
    'armStops',
    'releaseEntry',
    'waitForReadiness',
    'verifyListener',
  ])
  assert.equal(harness.run.view().state, 'ready')
  assert.deepEqual(harness.run.view().address, {
    host: '127.0.0.1',
    port: harness.port,
  })
  assert.deepEqual(harness.calls.remembered, [
    {
      runId: 'run-1',
      pid: 4242,
      processGroup: 4242,
      leaderStartedAt: 'start-1',
      cwd: WORKSPACE,
      inspectorPort: 9333,
      declaredPort: harness.port,
    },
  ])
})

// protects=the stops are armed with the lines the debugger bound them to; fails_when=the view hides a bound line; no_claim=the real adapter
test('the view lists every declared stop with the line the debugger bound it to', async () => {
  // Arrange
  const harness = createHarness({ stops: 2 })
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(harness.run.view().stops, [
    {
      declaredStopIndex: 0,
      path: 'src/routes/users.ts',
      declaredLine: 14,
      boundLine: 14,
    },
    {
      declaredStopIndex: 1,
      path: 'src/routes/users.ts',
      declaredLine: 15,
      boundLine: 15,
    },
  ])
})

// protects=an owned hit before readiness is recorded and continued, the entry pause is not reported as a pause; fails_when=the hit is held, missed or the generation does not grow; no_claim=DAP
test('a declared stop hit before readiness is recorded in stopsHitAtStart and continued', async () => {
  // Arrange
  const harness = createHarness({
    stops: 2,
    duringRelease: (debug) => debug.hit(1),
  })
  // Act
  await harness.run.prepare()
  // Assert
  const view = harness.run.view()
  assert.deepEqual(view.stopsHitAtStart, [1])
  assert.deepEqual(harness.debug.resumed, [1])
  assert.equal(view.state, 'ready')
  assert.equal(view.heldPause, undefined)
  assert.equal(view.pauseGeneration, 1)
})

// protects=a learner's pause during preparation is never resumed and suspends the readiness budget; fails_when=the budget runs out while held or the pause is resumed; no_claim=the real readiness poll
test('a learner pause during preparation is never resumed and the readiness budget waits for it', async () => {
  // Arrange
  let learnerToken = 0
  const accepted = defer<{ host: '127.0.0.1'; bothAccept: boolean }>()
  const harness = createHarness({
    duringRelease: (debug) => {
      learnerToken = debug.learnerPause('pause')
    },
    waitForReadiness: () => accepted.promise,
  })
  const preparing = harness.run.prepare()
  const held = await until(harness, (view) => view.state === 'learner-paused')
  await harness.readinessStarted
  const readiness = harness.calls.readiness[0]
  // Act
  harness.clock.advance(100_000)
  const timeLeftWhileHeld = readiness?.hasTimeLeft()
  harness.debug.nativeContinue(learnerToken)
  harness.clock.advance(29_999)
  const timeLeftJustBefore = readiness?.hasTimeLeft()
  harness.clock.advance(1)
  const timeLeftAtLimit = readiness?.hasTimeLeft()
  accepted.resolve({ host: '127.0.0.1', bothAccept: false })
  await preparing
  // Assert
  assert.equal(held.heldPause?.kind, 'learner')
  assert.equal(held.heldPause?.reason, 'pause')
  assert.deepEqual(harness.debug.resumed, [])
  assert.equal(timeLeftWhileHeld, true)
  assert.equal(timeLeftJustBefore, true)
  assert.equal(timeLeftAtLimit, false)
})

// protects=a server that exits before readiness fails the start with its exit and masked output, and leaves nothing running; fails_when=another code, a missing output, or a process, port claim or orphan record left; no_claim=a real exit
test('a server that exits before readiness fails the start with SERVER_EXITED and closes everything it started', async () => {
  // Arrange
  const harness = createHarness({
    waitForReadiness: () => new Promise<never>(() => undefined),
  })
  const preparing = harness.run.prepare()
  await harness.readinessStarted
  // Act
  harness.server.exitNow({ exitCode: 3, signal: null })
  const error = await rejectsWith(preparing, 'SERVER_EXITED')
  // Assert
  assert.equal(
    error.message,
    'The server exited with code 3. Its last output:\nserver log line\n',
  )
  assert.equal(harness.run.view().runFailure, error)
  assert.equal(harness.run.view().state, 'stopped')
  assert.equal(harness.server.closeCalls, 1)
  assert.deepEqual(harness.calls.forgotten, ['run-1'])
  assert.equal(ownedDevelopmentPortState(harness.port), undefined)
})

// protects=SERVER_EXITED keeps only the last 4,096 characters of output; fails_when=the whole output is named; no_claim=redaction (done by the output capture)
test('SERVER_EXITED names at most the last 4096 characters of the server output', async () => {
  // Arrange
  const harness = createHarness({
    waitForReadiness: () => new Promise<never>(() => undefined),
  })
  const preparing = harness.run.prepare()
  await harness.readinessStarted
  // Act
  harness.server.exitNow({ exitCode: null, signal: 'SIGKILL' })
  const error = await rejectsWith(preparing, 'SERVER_EXITED')
  // Assert
  assert.match(error.message, /^The server exited with signal SIGKILL\./)
  assert.ok(error.message.length < 4_200)
})

// protects=a server that does not listen within 30 s of running time names the declared port and the port it listens on instead, never the inspector's; fails_when=the corrected port is missing or the inspector port is named; no_claim=a real lsof
test('a server that listens on another port than declared fails with SERVER_NOT_LISTENING naming the corrected port but not the inspector port', async () => {
  // Arrange
  const harness = createHarness({
    waitForReadiness: async () => undefined,
    listeningPorts: [9229, 4101],
  })
  // Act
  const error = await rejectsWith(harness.run.prepare(), 'SERVER_NOT_LISTENING')
  // Assert
  assert.equal(
    error.message,
    `The server did not listen on the declared port ${harness.port} within 30 s of running time. The launched process listens on port 4101: declare port: 4101.`,
  )
  assert.doesNotMatch(error.message, /9229/)
  assert.equal(harness.server.closeCalls, 1)
})

// protects=SERVER_NOT_LISTENING without a corrected port when the process listens nowhere else; fails_when=a made-up port is offered; no_claim=real listeners
test('a server that listens nowhere fails with SERVER_NOT_LISTENING and offers no corrected port', async () => {
  // Arrange
  const harness = createHarness({
    waitForReadiness: async () => undefined,
    listeningPorts: [9229],
  })
  // Act
  const error = await rejectsWith(harness.run.prepare(), 'SERVER_NOT_LISTENING')
  // Assert
  assert.doesNotMatch(error.message, /declare port:/)
})

// protects=attach, arming and endpoint failures are RUNTIME_FAILED naming the step; fails_when=a raw error escapes or the step is missing; no_claim=the real adapter
test('a refused attach and a stop bound elsewhere fail the start with RUNTIME_FAILED naming the step', async () => {
  // Arrange
  const refused = createHarness({
    attachFails: new Error(
      'The native Node debugger refused the owned attach.',
    ),
  })
  const elsewhere = createHarness({
    armFails: new Error(
      'Declared breakpoint 14:3 is bound at 16:1; declare 16:1.',
    ),
  })
  // Act
  const attach = await rejectsWith(refused.run.prepare(), 'RUNTIME_FAILED')
  const arming = await rejectsWith(elsewhere.run.prepare(), 'RUNTIME_FAILED')
  // Assert
  assert.equal(
    attach.message,
    'The node-server run failed while attaching the debugger: The native Node debugger refused the owned attach.',
  )
  assert.match(
    arming.message,
    /while arming the declared stops: Declared breakpoint 14:3 is bound at 16:1/,
  )
  assert.equal(refused.server.closeCalls, 1)
  assert.equal(elsewhere.server.closeCalls, 1)
})

// protects=a step failure never names a private path; fails_when=an absolute path reaches the error; no_claim=every possible cause text
test('a step failure names the repository as <workspace> and no other private path', async () => {
  // Arrange
  const harness = createHarness({
    attachFails: new Error(
      `ENOENT ${WORKSPACE}/server.js and /Users/someone/.secret/file`,
    ),
  })
  // Act
  const error = await rejectsWith(harness.run.prepare(), 'RUNTIME_FAILED')
  // Assert
  assert.doesNotMatch(error.message, /Users|repo-of-the-run-test/)
  assert.match(error.message, /<workspace>/)
})

// protects=listener failures of the owner check end the start with the listener's code; fails_when=another code or a server left running; no_claim=the real lsof/ss
test('a listener that is not the launched server fails the start with LISTENER_NOT_OWNED and closes the server', async () => {
  // Arrange
  const harness = createHarness({
    listener: {
      owned: false,
      code: 'LISTENER_NOT_OWNED',
      message: 'Process 777 (node) also accepts on port 4100.',
    },
  })
  // Act
  const error = await rejectsWith(harness.run.prepare(), 'LISTENER_NOT_OWNED')
  // Assert
  assert.equal(error.message, 'Process 777 (node) also accepts on port 4100.')
  assert.equal(harness.server.closeCalls, 1)
  assert.equal(ownedDevelopmentPortState(harness.port), undefined)
})

// protects=a stop during preparation cancels it and closes the server; fails_when=the start continues or the process is left; no_claim=the service's cancel path
test('a stop while the run is preparing ends the preparation and closes what it started', async () => {
  // Arrange
  const harness = createHarness({
    waitForReadiness: ({ signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        }),
      ),
  })
  const preparing = harness.run.prepare()
  await harness.readinessStarted
  // Act
  await harness.run.stop()
  const error = await rejectsWith(preparing, 'RUNTIME_FAILED')
  // Assert
  assert.equal(error.message, 'The run was stopped while it was preparing.')
  assert.equal(harness.run.view().state, 'stopped')
  assert.equal(harness.run.view().runFailure, undefined)
  assert.equal(harness.server.closeCalls, 1)
})

// ---------------------------------------------------------------- the request

// protects=refusals of the request call in their order; fails_when=RUN_NOT_READY answers a sent request, LEARNER_PAUSED is not first, or a second request goes out; no_claim=the service's receipts
test('sendRequest refuses with RUN_NOT_READY while preparing, REQUEST_ALREADY_SENT after a send, and LEARNER_PAUSED before both', async () => {
  // Arrange
  const preparing = createHarness({
    waitForReadiness: () => new Promise<never>(() => undefined),
  })
  void preparing.run.prepare().catch(() => undefined)
  await preparing.readinessStarted
  const harness = await readyHarness()
  // Act
  const notReady = await rejectsWith(
    preparing.run.sendRequest('k'),
    'RUN_NOT_READY',
  )
  await sendRequest(harness)
  const again = await rejectsWith(
    harness.run.sendRequest('k2'),
    'REQUEST_ALREADY_SENT',
  )
  harness.debug.learnerPause()
  const paused = await rejectsWith(
    harness.run.sendRequest('k3'),
    'LEARNER_PAUSED',
  )
  // Assert
  assert.match(notReady.message, /not ready/)
  assert.match(again.message, /already sent/)
  assert.match(paused.message, /learner paused/)
  assert.equal(harness.sender.calls.length, 1)
})

// protects=the request window opens before the bytes are written and the run reads request-in-flight; fails_when=the state is still ready when the sender writes; no_claim=the real sender
test('the request window opens before the request is written and the run reads request-in-flight', async () => {
  // Arrange
  const harness = await readyHarness()
  // Act
  await sendRequest(harness)
  // Assert
  assert.equal(harness.sender.calls[0]?.stateAtCall, 'request-in-flight')
  assert.equal(harness.sender.calls[0]?.headers, 'run-1')
  assert.deepEqual(harness.run.view().request, {
    key: 'key-1',
    method: 'GET',
    path: '/api/users/7',
    bodyBytes: 0,
    address: `127.0.0.1:${harness.port}`,
    sentAtMs: 12,
  })
  assert.ok(
    harness.order.indexOf('window:true') < harness.order.indexOf('sendRequest'),
  )
})

// protects=a connection that reaches another process sends zero bytes and the run stays ready; fails_when=bytes are written or the state stays in flight; no_claim=the real socket
test('a connection that reaches another process than the launched server sends nothing and the run stays ready', async () => {
  // Arrange
  const harness = await readyHarness({ connectionHolders: [9999] })
  // Act
  const error = await rejectsWith(
    harness.run.sendRequest('k'),
    'LISTENER_NOT_OWNED',
  )
  // Assert
  assert.match(error.message, /Process 9999 /)
  assert.equal(harness.sender.bytesWritten, 0)
  assert.equal(harness.run.view().state, 'ready')
  assert.equal(harness.run.view().request, undefined)
})

// ---------------------------------------------------------------- pauses

// protects=an owned hit inside the window is captured and reported as a pause with its identity; fails_when=index, number, generation or reached list are wrong; no_claim=real DAP
test('an owned hit inside the request window pauses the run with its stop number, generation and captured facts', async () => {
  // Arrange
  const harness = await readyHarness({ stops: 2 })
  // Act
  const pause = await pausedAtStop(harness, 1)
  // Assert
  const view = harness.run.view()
  assert.deepEqual(pause, {
    sessionId: 'session-1',
    threadId: 1,
    generation: 1,
    declaredStopIndex: 1,
    stopNumber: 2,
    captureIndex: 0,
  })
  assert.deepEqual(view.stopsReached, [1])
  assert.deepEqual(view.captures[0]?.facts, {
    'value:user.id': '7',
    'type:user.id': 'number',
  })
  assert.deepEqual(
    view.captures[0]?.unavailable.map((entry) => entry.path),
    ['type:user.name'],
  )
  assert.equal(view.captures[0]?.attribution, 'timing')
  assert.equal(view.captures[0]?.stopNumber, 2)
})

// protects=continue resumes the pause and the state returns to request-in-flight, the response then ends the request; fails_when=the resume is missing or the run stays paused; no_claim=the service's wait
test('continuing the pause resumes the server and the response ends the request with all breakpoints retired', async () => {
  // Arrange
  const harness = await readyHarness()
  const pause = await pausedAtStop(harness)
  // Act
  await harness.run.continue(pause)
  const resumedState = harness.run.view().state
  harness.sender.response.resolve(RESPONSE_200)
  const view = await until(harness, (current) => current.state === 'responded')
  // Assert
  assert.equal(resumedState, 'request-in-flight')
  assert.deepEqual(harness.debug.resumed, [1])
  assert.deepEqual(view.response, RESPONSE_200)
  await until(harness, () => harness.debug.retireCount === 1)
  assert.ok(
    harness.order.indexOf('window:false') > harness.order.indexOf('resume:1'),
  )
})

// protects=continuation refusals NO_PAUSE, STALE_PAUSE for session, thread and generation; fails_when=a stale identity resumes the server; no_claim=the service's argument copying
test('continue refuses with NO_PAUSE when not paused and STALE_PAUSE for another session, thread or generation', async () => {
  // Arrange
  const harness = await readyHarness()
  const noPause = await rejectsWith(
    harness.run.continue({
      sessionId: 'session-1',
      threadId: 1,
      generation: 1,
    }),
    'NO_PAUSE',
  )
  const pause = await pausedAtStop(harness)
  // Act
  const otherSession = await rejectsWith(
    harness.run.continue({ ...pause, sessionId: 'other' }),
    'STALE_PAUSE',
  )
  const otherThread = await rejectsWith(
    harness.run.continue({ ...pause, threadId: 2 }),
    'STALE_PAUSE',
  )
  const otherGeneration = await rejectsWith(
    harness.run.continue({ ...pause, generation: pause.generation + 1 }),
    'STALE_PAUSE',
  )
  // Assert
  assert.match(noPause.message, /not paused/)
  assert.ok(otherSession && otherThread && otherGeneration)
  assert.deepEqual(harness.debug.resumed, [])
})

// protects=the generation is reserved atomically; fails_when=two concurrent continues both resume; no_claim=real latency
test('two concurrent continues of one pause resume once and the other is STALE_PAUSE', async () => {
  // Arrange
  const harness = await readyHarness()
  const pause = await pausedAtStop(harness)
  // Act
  const results = await Promise.allSettled([
    harness.run.continue(pause),
    harness.run.continue(pause),
  ])
  // Assert
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(
    results[1].status === 'rejected' && results[1].reason instanceof StudyError
      ? results[1].reason.code
      : undefined,
    'STALE_PAUSE',
  )
  assert.deepEqual(harness.debug.resumed, [1])
})

// protects=a pause that is no declared stop is the learner's: held, never resumed, LEARNER_PAUSED for continue, and the state returns when the learner continues; fails_when=Codebook resumes it or the state does not return; no_claim=real breakpoints
test('a learner pause inside the request is held and never resumed, and the state returns when the learner continues', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  // Act
  const token = harness.debug.learnerPause('exception')
  const held = await until(harness, (view) => view.state === 'learner-paused')
  const refused = await rejectsWith(
    harness.run.continue({
      sessionId: 'session-1',
      threadId: 1,
      generation: 1,
    }),
    'LEARNER_PAUSED',
  )
  harness.debug.nativeContinue(token)
  const back = harness.run.view()
  // Assert
  assert.deepEqual(held.heldPause, {
    kind: 'learner',
    reason: 'exception',
    sessionId: 'session-1',
    threadId: 1,
    path: 'src/other.ts',
    line: 3,
  })
  assert.match(refused.message, /learner paused/)
  assert.deepEqual(harness.debug.resumed, [])
  assert.equal(back.state, 'request-in-flight')
  assert.equal(
    harness.events.some((event) => event.type === 'node-server.learner-paused'),
    true,
  )
})

// protects=a native Continue of a declared stop is journaled and the run goes on; fails_when=no learner-resumed event or the run stays paused; no_claim=the editor's button
test('the learner continuing a declared stop in the editor is journaled and the run goes on', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  const token = harness.debug.hit(0)
  await until(harness, (view) => view.state === 'paused')
  // Act
  harness.debug.nativeContinue(token)
  // Assert
  assert.equal(harness.run.view().state, 'request-in-flight')
  assert.deepEqual(
    harness.events.filter(
      (event) => event.type === 'node-server.learner-resumed',
    ),
    [{ type: 'node-server.learner-resumed', detail: { declaredStopIndex: 0 } }],
  )
})

// protects=an owned hit outside the request window is unattributed and held, before the request and after the response; fails_when=it is captured or resumed; no_claim=real timing
test('a declared stop hit outside the request window is unattributed, held and never resumed', async () => {
  // Arrange
  const before = await readyHarness()
  const after = await readyHarness()
  await sendRequest(after)
  after.sender.response.resolve(RESPONSE_200)
  await until(after, (view) => view.state === 'responded')
  // Act
  before.debug.hit(0)
  after.debug.hit(0)
  // Assert
  assert.equal(before.run.view().state, 'unattributed')
  assert.equal(after.run.view().state, 'unattributed')
  assert.equal(after.run.view().heldPause?.kind, 'unattributed')
  assert.deepEqual(before.debug.resumed, [])
  assert.equal(before.run.view().captures.length, 0)
})

// protects=at most 16 captures per request, then every owned breakpoint is retired and the request continues uncaptured; fails_when=a 17th capture is made or the hit is held; no_claim=a real loop
test('the seventeenth hit retires the owned breakpoints and continues uncaptured', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  for (let hit = 1; hit <= 16; hit++) {
    harness.debug.hit(0)
    const view = await until(harness, (current) => current.state === 'paused')
    assert.ok(view.pause)
    await harness.run.continue(view.pause)
  }
  // Act
  harness.debug.hit(0)
  await until(
    harness,
    (view) =>
      view.captureBudgetExhausted && harness.debug.resumed.length === 17,
  )
  // Assert
  const view = harness.run.view()
  assert.equal(view.captures.length, 16)
  assert.equal(view.state, 'request-in-flight')
  assert.equal(harness.debug.retireCount, 1)
})

// ---------------------------------------------------------------- request outcomes

// protects=a reset is the request's outcome, not the run's (D1); fails_when=the run fails or stops; no_claim=a real reset
test('a reset connection reads request-failed while the server keeps running', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  // Act
  harness.sender.response.reject(new StudyError('REQUEST_FAILED', 'ECONNRESET'))
  const view = await until(
    harness,
    (current) => current.state === 'request-failed',
  )
  // Assert
  assert.equal(view.requestFailure?.code, 'REQUEST_FAILED')
  assert.equal(view.runFailure, undefined)
  assert.equal(harness.server.closeCalls, 0)
})

// protects=REQUEST_TIMEOUT counts running time only: paused time is excluded; fails_when=a pause counts toward the 30 s or the timeout is missed; no_claim=wall time of real servers
test('the request times out after 30 s of running time and a pause does not count', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  harness.clock.advance(20_000)
  const token = harness.debug.hit(0)
  await until(harness, (view) => view.state === 'paused')
  harness.clock.advance(200_000)
  harness.debug.nativeContinue(token)
  // Act
  harness.clock.advance(9_999)
  const justBefore = harness.run.view().state
  harness.clock.advance(1)
  const view = await until(
    harness,
    (current) => current.state === 'request-failed',
  )
  // Assert
  assert.equal(justBefore, 'request-in-flight')
  assert.equal(view.requestFailure?.code, 'REQUEST_TIMEOUT')
  assert.equal(view.runFailure, undefined)
  assert.equal(harness.debug.retireCount, 1)
})

// protects=the 15-minute wall-time backstop ends a request whose pauses kept the running time low; fails_when=the request waits past 15 minutes; no_claim=a real clock
test('the request ends as timed out at the 15 minute wall-time backstop even when paused time kept its running time low', async () => {
  // Arrange
  const harness = await readyHarness({ stops: 2 })
  await sendRequest(harness)
  for (let round = 0; round < 3; round++) {
    const token = harness.debug.hit(0)
    await until(harness, (view) => view.state === 'paused')
    harness.clock.advance(250_000)
    harness.debug.nativeContinue(token)
  }
  // Act
  harness.clock.advance(150_000)
  const view = await until(
    harness,
    (current) => current.requestFailure !== undefined,
  )
  // Assert
  assert.equal(view.requestFailure?.code, 'REQUEST_TIMEOUT')
})

// protects=a server that exits before answering is the run's failure SERVER_EXITED, not a reset; fails_when=request-failed REQUEST_FAILED hides the exit; no_claim=a real crash
test('a server that exits before it answers fails the run with SERVER_EXITED and closes the group', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  // Act
  harness.server.exitNow({ exitCode: 1, signal: null })
  harness.sender.response.reject(new StudyError('REQUEST_FAILED', 'ECONNRESET'))
  const view = await until(harness, (current) => current.state === 'stopped')
  // Assert
  assert.equal(view.runFailure?.code, 'SERVER_EXITED')
  assert.equal(view.requestFailure, undefined)
  assert.equal(harness.server.closeCalls, 1)
})

// protects=a leader that exits while a group member lives still closes the whole group; fails_when=the group is not closed after the leader's exit; no_claim=a real child
test('a leader that exits after readiness has the whole group closed and verified', async () => {
  // Arrange
  const harness = await readyHarness()
  // Act
  harness.server.exitNow({ exitCode: 0, signal: null })
  await until(harness, (view) => view.state === 'stopped')
  // Assert
  assert.equal(harness.run.view().runFailure?.code, 'SERVER_EXITED')
  assert.equal(harness.server.closeCalls, 1)
  assert.deepEqual(harness.calls.forgotten, ['run-1'])
})

// ---------------------------------------------------------------- pause hold and stop

// protects=a pause held beyond 300 s ends the run with PAUSE_HOLD_EXPIRED, kills the group first and never resumes (D14); fails_when=the code resumes, SIGKILL comes after the detach, or the run stays alive; no_claim=a real server
test('a pause held beyond 300 s ends the run, kills the group before the debugger lets go and resumes nothing', async () => {
  // Arrange
  const harness = await readyHarness()
  await pausedAtStop(harness)
  // Act
  harness.clock.advance(300_000)
  const view = await until(harness, (current) => current.state === 'stopped')
  // Assert
  assert.equal(view.runFailure?.code, 'PAUSE_HOLD_EXPIRED')
  assert.deepEqual(harness.debug.resumed, [])
  assert.deepEqual(harness.calls.signals, [[4242, 'SIGKILL']])
  assert.deepEqual(harness.server.closeWithDetach, [false])
  assert.ok(
    harness.order.indexOf('signal:SIGKILL') <
      harness.order.indexOf('debugger.release'),
  )
})

// protects=Stop v2: the debugger detaches inside the close, before the group's TERM, when the server is not paused in the request; fails_when=SIGKILL is sent first or the detach is missing; no_claim=a real SIGTERM handler
test('stopping a running server detaches the debugger first and signals no kill', async () => {
  // Arrange
  const harness = await readyHarness()
  // Act
  await harness.run.stop()
  // Assert
  assert.deepEqual(harness.server.closeWithDetach, [true])
  assert.deepEqual(harness.calls.signals, [])
  assert.deepEqual(harness.order.slice(harness.order.indexOf('server.close')), [
    'server.close',
    'detach',
    'debugger.release',
    'server.closed',
    'debugger.release',
    'forgetProcess',
  ])
  assert.equal(harness.run.view().state, 'stopped')
  assert.equal(ownedDevelopmentPortState(harness.port), undefined)
})

// protects=D14: stopping while paused inside the request kills the group first, never letting the paused code run; fails_when=the detach comes first; no_claim=the real handler
test('stopping while paused at a declared stop kills the group before the debug session ends', async () => {
  // Arrange
  const harness = await readyHarness()
  await pausedAtStop(harness)
  // Act
  await harness.run.stop()
  // Assert
  assert.deepEqual(harness.calls.signals, [[4242, 'SIGKILL']])
  assert.deepEqual(harness.server.closeWithDetach, [false])
  assert.deepEqual(harness.debug.resumed, [])
  assert.ok(
    harness.order.indexOf('signal:SIGKILL') <
      harness.order.indexOf('debugger.release'),
  )
})

// protects=concurrent stops share one stop and a finished stop stays finished; fails_when=the server is closed twice; no_claim=the service's callers
test('concurrent and repeated stops share one release', async () => {
  // Arrange
  const harness = await readyHarness()
  // Act
  await Promise.all([harness.run.stop(), harness.run.stop()])
  await harness.run.stop()
  // Assert
  assert.equal(harness.server.closeCalls, 1)
  assert.deepEqual(harness.calls.forgotten, ['run-1'])
})

// protects=the stop's 10 s deadline names the pid that remains, the run reads stopping, the second failure names the pid for the learner, a later stop succeeds; fails_when=the deadline is missed, the message names no pid, or the retry cannot succeed; no_claim=a real hung process
test('a stop that hangs fails at 10 s naming the pid, reads stopping, and a retry succeeds', async () => {
  // Arrange
  const harness = await readyHarness({ holdClose: true })
  const first = harness.run.stop()
  const firstOutcome = rejectsWith(first, 'RUNTIME_FAILED')
  // Act
  harness.clock.advance(9_999)
  const midway = harness.run.view().state
  harness.clock.advance(1)
  const firstError = await firstOutcome
  const afterFirst = harness.run.view()
  const second = harness.run.stop()
  const secondOutcome = rejectsWith(second, 'RUNTIME_FAILED')
  harness.clock.advance(10_000)
  const secondError = await secondOutcome
  harness.server.closeGate.resolve()
  await harness.run.stop()
  // Assert
  assert.equal(midway, 'stopping')
  assert.match(
    firstError.message,
    /process 4242 \(it holds port \d+\) is still there\. Stop again with codebook_stop\./,
  )
  assert.equal(afterFirst.state, 'stopping')
  assert.equal(afterFirst.failedStops, 1)
  assert.match(
    secondError.message,
    /ask the learner to end process 4242 themselves/,
  )
  assert.equal(harness.run.view().state, 'stopped')
  assert.equal(harness.run.view().failedStops, 2)
})

// protects=a verified foreign listener on the port never keeps the run from stopping and is reported apart; fails_when=the stop fails or the foreign pid is not reported; no_claim=a real foreign listener
test('a foreign listener on the declared port does not hold the stop and is reported apart', async () => {
  // Arrange
  const harness = await readyHarness({
    occupant: { pid: 777, command: 'node' },
  })
  // Act
  await harness.run.stop()
  await harness.eventSeen('node-server.port-held-by-other')
  // Assert
  assert.equal(harness.run.view().state, 'stopped')
  assert.equal(ownedDevelopmentPortState(harness.port), undefined)
  assert.deepEqual(
    harness.events.find(
      (event) => event.type === 'node-server.port-held-by-other',
    )?.detail,
    { port: harness.port, pid: 777, command: 'node' },
  )
})

// protects=Node's own stderr notice, printed when the program is finished and no port is listened on, makes the run let its debugger go; fails_when=a crashed server stays alive for the readiness budget; no_claim=js-debug's own handling of an ended target
test('the notice on stderr of a finished server that listens nowhere releases the debugger', async () => {
  // Arrange
  const harness = await readyHarness({ listeningPorts: [9229] })
  // Act
  await harness.emitOutput(
    'Waiting for the debugger to disconnect...\n',
    'stderr',
  )
  // Assert
  assert.equal(harness.debug.releaseCount, 1)
})

// protects=output an application logs is never taken for Node's notice: not on stdout, not while the server still listens, not during the request; fails_when=a logged sentence drops the debugger and the stops; no_claim=other texts
test('the notice sentence in application output never releases the debugger', async () => {
  // Arrange
  const notice = 'Waiting for the debugger to disconnect...\n'
  const stdout = await readyHarness({ listeningPorts: [] })
  const listening = await readyHarness({ listeningPorts: [4100] })
  const inRequest = await readyHarness({ listeningPorts: [] })
  await sendRequest(inRequest)
  // Act
  await stdout.emitOutput(notice, 'stdout')
  await listening.emitOutput(notice, 'stderr')
  await inRequest.emitOutput(notice, 'stderr')
  await stdout.emitOutput(`user said: ${notice}`, 'stderr')
  // Assert
  assert.equal(stdout.debug.releaseCount, 0)
  assert.equal(listening.debug.releaseCount, 0)
  assert.equal(inRequest.debug.releaseCount, 0)
})

// ---------------------------------------------------------------- events and changes

// protects=the journal carries the output, request, response and failure events with the shapes the service whitelists, and no private path; fails_when=a field is missing or a path leaks; no_claim=the service's whitelist
test('the journal carries output, request and response events without a private path', async () => {
  // Arrange
  const harness = await readyHarness()
  // Act
  await sendRequest(harness)
  harness.sender.response.resolve(RESPONSE_200)
  await until(harness, (view) => view.state === 'responded')
  // Assert
  const byType = (type: string) =>
    harness.events
      .filter((event) => event.type === type)
      .map((event) => event.detail)
  assert.deepEqual(byType('node-server.output'), [
    { sequence: 1, elapsedMs: 5, channel: 'stdout', text: 'server log line\n' },
  ])
  assert.deepEqual(byType('node-server.request'), [
    {
      method: 'GET',
      path: '/api/users/7',
      bodyBytes: 0,
      address: `127.0.0.1:${harness.port}`,
    },
  ])
  assert.deepEqual(byType('node-server.response'), [
    {
      status: 200,
      contentType: 'application/json',
      body: '{"id":7}',
      bodyBytes: 8,
      readCut: false,
      location: undefined,
      elapsedMs: 21,
    },
  ])
  assert.doesNotMatch(JSON.stringify(harness.events), /repo-of-the-run-test/)
})

// protects=the failure event carries the code and a sanitized cause; fails_when=the event is missing or names the output; no_claim=the service's whitelist
test('a failed request journals node-server.failure with its code and cause', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  // Act
  harness.sender.response.reject(new StudyError('REQUEST_FAILED', 'ECONNRESET'))
  await until(harness, (view) => view.state === 'request-failed')
  // Assert
  assert.deepEqual(
    harness.events.filter((event) => event.type === 'node-server.failure'),
    [
      {
        type: 'node-server.failure',
        detail: {
          code: 'REQUEST_FAILED',
          cause: 'The connection failed before a response: ECONNRESET',
        },
      },
    ],
  )
})

// protects=onDidChange fires after every view change and stops after dispose; fails_when=the service misses a change; no_claim=the service's own refresh
test('onDidChange fires for each change of the view and not after it is disposed', async () => {
  // Arrange
  const harness = createHarness()
  let changes = 0
  const subscription = harness.run.onDidChange(() => (changes += 1))
  // Act
  await harness.run.prepare()
  const afterPreparation = changes
  subscription.dispose()
  await sendRequest(harness)
  // Assert
  assert.ok(afterPreparation > 0)
  assert.equal(changes, afterPreparation)
})

// ---------------------------------------------------------------- review fixes

// protects=D14 also for a declared stop held outside the request window: a stop never resumes that code; fails_when=detach runs first for an unattributed or post-response hit; no_claim=a real server
test('stopping while a declared stop is held outside the request window kills the group first', async () => {
  // Arrange
  const unattributed = await readyHarness()
  unattributed.debug.hit(0)
  const afterResponse = await readyHarness()
  await sendRequest(afterResponse)
  afterResponse.sender.response.resolve(RESPONSE_200)
  await until(afterResponse, (view) => view.state === 'responded')
  afterResponse.debug.hit(0)
  // Act
  await unattributed.run.stop()
  await afterResponse.run.stop()
  // Assert
  assert.deepEqual(unattributed.calls.signals, [[4242, 'SIGKILL']])
  assert.deepEqual(unattributed.server.closeWithDetach, [false])
  assert.deepEqual(afterResponse.calls.signals, [[4242, 'SIGKILL']])
})

// protects=a Stop while the server's identity is checked before the first byte sends nothing, and the request call says so; fails_when=the declared request is written after the Stop was admitted, or the call answers as if it were sent; no_claim=the real socket (the process test covers the sender)
test('a Stop while the connection is checked before the first byte sends nothing and the request call says so', async () => {
  // Arrange
  const peerCheck = defer<void>()
  const harness = await readyHarness({ peerCheckGate: peerCheck.promise })
  const sending = harness.run.sendRequest('key-1')
  // Act
  const stopping = harness.run.stop()
  peerCheck.resolve()
  const error = await rejectsWith(sending, 'RUN_NOT_READY')
  await stopping
  // Assert
  assert.equal(harness.sender.bytesWritten, 0)
  assert.match(error.message, /nothing was sent/)
  assert.equal(harness.run.view().state, 'stopped')
  assert.equal(harness.run.view().request, undefined)
})

// protects=D14: a stop the editor reported but whose stack it is still reading (so the run has not classified it) is killed first, never resumed by the detach; fails_when=the debugger detaches while that pause may be inside the request; no_claim=the real adapter's stackTrace timing
test('stopping while the editor still reads a reported stop kills the group before the debugger lets go', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  harness.debug.unreportedPause = true
  // Act
  await harness.run.stop()
  // Assert
  assert.deepEqual(harness.calls.signals, [[4242, 'SIGKILL']])
  assert.deepEqual(harness.server.closeWithDetach, [false])
  assert.ok(
    harness.order.indexOf('signal:SIGKILL') <
      harness.order.indexOf('debugger.release'),
  )
})

// protects=D14: a declared stop the request reaches after the Stop was admitted is killed first, never resumed by the detach; fails_when=the pause arriving while stopping is ignored and the detach lets the handler run on; no_claim=the real adapter's event order
test('a declared stop reached after the Stop was admitted is killed before the debugger lets go', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  // Act
  const stopping = harness.run.stop()
  harness.debug.hit(0)
  await stopping
  // Assert
  assert.deepEqual(harness.calls.signals, [[4242, 'SIGKILL']])
  assert.deepEqual(harness.server.closeWithDetach, [false])
  assert.deepEqual(harness.debug.resumed, [])
})

// protects=D14 v2: a Stop while the request is under way kills the group before the debugger lets go, even with no pause reported, so a stop the handler reaches during the detach cannot be resumed by it; fails_when=the debugger detaches first while the request is in flight; no_claim=the real adapter's event order
test('a Stop while the request is under way kills the group before the debugger lets go, with no pause reported', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  // Act
  await harness.run.stop()
  // Assert
  assert.deepEqual(harness.calls.signals, [[4242, 'SIGKILL']])
  assert.deepEqual(harness.server.closeWithDetach, [false])
  assert.ok(
    harness.order.indexOf('signal:SIGKILL') <
      harness.order.indexOf('debugger.release'),
  )
})

// protects=a Stop after the request's first byte ends the request without a failure: the run reads stopped, the request stays recorded as sent, and the sender's signal is aborted; fails_when=the stop journals a request failure, forgets the sent request, or leaves the socket open; no_claim=the real socket
test('a Stop after the first byte ends the request without a failure and keeps it recorded as sent', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  // Act
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().state, 'stopped')
  assert.equal(harness.run.view().request?.method, 'GET')
  assert.equal(harness.sender.calls[0]?.signal?.aborted, true)
  assert.equal(
    harness.events.some((event) => event.type === 'node-server.failure'),
    false,
  )
})

// protects=D14: a learner pause inside the request at the Stop is killed first, never resumed; fails_when=the debugger detaches first; no_claim=none
test('stopping while the learner paused inside the request kills the group before the debugger lets go', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  harness.debug.learnerPause()
  // Act
  await harness.run.stop()
  // Assert
  assert.deepEqual(harness.calls.signals, [[4242, 'SIGKILL']])
  assert.deepEqual(harness.server.closeWithDetach, [false])
  assert.deepEqual(harness.debug.resumed, [])
})

// protects=D14: a learner pause that arrives inside the request after the Stop was admitted is killed first; fails_when=the detach resumes it; no_claim=the real adapter's event order
test('a learner pause arriving inside the request after the Stop was admitted is killed before the debugger lets go', async () => {
  // Arrange
  const harness = await readyHarness()
  await sendRequest(harness)
  // Act
  const stopping = harness.run.stop()
  harness.debug.learnerPause()
  await stopping
  // Assert
  assert.deepEqual(harness.calls.signals, [[4242, 'SIGKILL']])
  assert.deepEqual(harness.server.closeWithDetach, [false])
})

// protects=D14: a learner pause that arrives outside the request after the Stop was admitted still takes Stop v2 (detach, SIGTERM), so the server's own shutdown runs; fails_when=any pause arriving while stopping is killed; no_claim=none
test('a learner pause arriving outside the request after the Stop was admitted lets the debugger go first', async () => {
  // Arrange
  const harness = await readyHarness()
  // Act
  const stopping = harness.run.stop()
  harness.debug.learnerPause()
  await stopping
  // Assert
  assert.deepEqual(harness.calls.signals, [])
  assert.deepEqual(harness.server.closeWithDetach, [true])
})

// protects=D14: a stop the editor reports after the Stop was admitted, and is still reading at the release, is killed first; fails_when=only the admission looks at unreported stops; no_claim=the real adapter's timing
test('a stop the editor reports after the Stop was admitted and still reads at the release is killed first', async () => {
  // Arrange
  const harness = await readyHarness()
  // Act
  const stopping = harness.run.stop()
  harness.debug.unreportedPause = true
  await stopping
  // Assert
  assert.deepEqual(harness.calls.signals, [[4242, 'SIGKILL']])
  assert.deepEqual(harness.server.closeWithDetach, [false])
})

// protects=the journal records the request only once its bytes were handed to the socket: a connection that reaches another process leaves no sent request in the events or Output; fails_when=a refused request reads as sent; no_claim=the Output wording (service tests)
test('a connection that reaches another process journals no sent request', async () => {
  // Arrange
  const harness = await readyHarness({ connectionHolders: [9999] })
  // Act
  await rejectsWith(harness.run.sendRequest('k'), 'LISTENER_NOT_OWNED')
  // Assert
  assert.equal(
    harness.events.some((event) => event.type === 'node-server.request'),
    false,
  )
})

// protects=a learner pause outside the window still takes Stop v2; fails_when=SIGKILL for a plain learner pause outside the request; no_claim=none
test('stopping while the learner paused outside the request window detaches first', async () => {
  // Arrange
  const harness = await readyHarness()
  harness.debug.learnerPause()
  // Act
  await harness.run.stop()
  // Assert
  assert.deepEqual(harness.calls.signals, [])
  assert.deepEqual(harness.server.closeWithDetach, [true])
})

// protects=a continue that fails after the editor reported the resume leaves the run paused and retryable; fails_when=the state reads request-in-flight while paused, or the retry answers NO_PAUSE; no_claim=a real adapter timeout
test('a continue the adapter fails keeps the run paused and the same arguments usable again', async () => {
  // Arrange
  const harness = await readyHarness({
    resumeFails: new Error('adapter timeout'),
  })
  const pause = await pausedAtStop(harness)
  // Act
  const first = await rejectsWith(harness.run.continue(pause), 'RUNTIME_FAILED')
  const afterFailure = harness.run.view()
  const retry = await rejectsWith(harness.run.continue(pause), 'RUNTIME_FAILED')
  // Assert
  assert.match(first.message, /adapter timeout/)
  assert.equal(afterFailure.state, 'paused')
  assert.deepEqual(afterFailure.pause?.generation, pause.generation)
  assert.match(retry.message, /adapter timeout/)
})

// protects=a second continue while the first one's resume is under way is STALE_PAUSE even after the editor reported the resume; fails_when=NO_PAUSE answers it or the pause is cleared early; no_claim=real latency
test('a second continue during the first one is STALE_PAUSE when the resume event came first', async () => {
  // Arrange
  const gate = defer<void>()
  const harness = await readyHarness({ resumeEmitsOnResume: true })
  const pause = await pausedAtStop(harness)
  harness.debug.resumeGate = gate.promise
  const first = harness.run.continue(pause)
  // Act
  const second = await rejectsWith(harness.run.continue(pause), 'STALE_PAUSE')
  const stateDuring = harness.run.view().state
  gate.resolve()
  await first
  // Assert
  assert.ok(second)
  assert.equal(stateDuring, 'paused')
  assert.equal(harness.run.view().state, 'request-in-flight')
})

// protects=the foreign-listener lookup is no part of the stop's deadline; fails_when=a slow lookup fails or delays a complete stop; no_claim=a real lsof
test('a stop completes while the lookup of a foreign listener is still pending', async () => {
  // Arrange
  const gate = defer<void>()
  const harness = await readyHarness({
    occupant: { pid: 777, command: 'node' },
    occupantGate: gate.promise,
  })
  // Act
  await harness.run.stop()
  const stateAtStop = harness.run.view().state
  gate.resolve()
  await harness.eventSeen('node-server.port-held-by-other')
  // Assert
  assert.equal(stateAtStop, 'stopped')
  assert.equal(harness.run.view().failedStops, 0)
})

// protects=a synchronous throw of the request sender closes the window and fails the call with REQUEST_FAILED; fails_when=the run reads request-in-flight for good; no_claim=the real sender
test('a request sender that throws leaves no open request window', async () => {
  // Arrange
  const harness = await readyHarness({
    sendThrows: new Error('socket setup failed'),
  })
  // Act
  const error = await rejectsWith(
    harness.run.sendRequest('k'),
    'REQUEST_FAILED',
  )
  // Assert
  assert.match(error.message, /socket setup failed/)
  assert.equal(harness.run.view().state, 'ready')
  assert.equal(harness.run.view().request, undefined)
  assert.equal(harness.order.at(-1), 'window:false')
})

// protects=the SERVER_EXITED output tail names no private path; fails_when=a stack trace's absolute path reaches the message; no_claim=paths inside the application's own text
test('the output tail of SERVER_EXITED shows the repository as <workspace> and hides other absolute paths', async () => {
  // Arrange
  const harness = createHarness({
    serverOutput: `Error at /Users/someone/secret-project/node_modules/x/a.js:3\n    at ${WORKSPACE}/src/app.ts:9\n`,
    waitForReadiness: () => new Promise<never>(() => undefined),
  })
  const preparing = harness.run.prepare()
  await harness.readinessStarted
  // Act
  harness.server.exitNow({ exitCode: 1, signal: null })
  const error = await rejectsWith(preparing, 'SERVER_EXITED')
  // Assert
  assert.match(error.message, /<workspace>\/src\/app\.ts:9/)
  assert.doesNotMatch(error.message, /Users|someone/)
})

// protects=verifyPeer needs exactly the launched pid among the holders; fails_when=an empty, foreign or extra holder passes; no_claim=real sockets
test('the peer check accepts only the launched server as the holder of the connection', async () => {
  // Arrange
  const none = await readyHarness({ connectionHolders: [] })
  const extra = await readyHarness({ connectionHolders: [4242, 9999] })
  const alone = await readyHarness({ connectionHolders: [4242] })
  // Act
  const unknown = await rejectsWith(
    none.run.sendRequest('k'),
    'PORT_OWNER_UNKNOWN',
  )
  const shared = await rejectsWith(
    extra.run.sendRequest('k'),
    'LISTENER_NOT_OWNED',
  )
  await alone.run.sendRequest('k')
  // Assert
  assert.ok(unknown)
  assert.match(shared.message, /9999/)
  assert.equal(extra.sender.bytesWritten, 0)
  assert.equal(alone.sender.bytesWritten, 1)
})
