import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import type { NodeServerHistorySink } from '../nodeServerHistorySink'
import type { NodeServerResponse } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { StateChangingRequestQuestion } from '../utils/askToSendStateChangingRequest'

import { createHarness as createServiceHarness } from './helpers'
import {
  readyHarness,
  RESPONSE_200,
  until,
  type Harness,
  type HarnessOptions,
} from './utils/nodeServerRunHarness'
import { startFakeNodeServerRun } from './utils/startFakeNodeServerRun'

const SECRET = 'hunter2-correct-horse'
/** A signed session cookie as express-session writes it: percent-encoded, with a signature. */
const SET_COOKIE =
  'sid=s%3Asid1234567890abcdef.sigABCDEFGHIJKLMNOP; Path=/; HttpOnly'
const COOKIE_VALUE = 's%3Asid1234567890abcdef.sigABCDEFGHIJKLMNOP'
const SIGN_IN = {
  path: '/login',
  fields: { email: 'learner@example.test' },
  secretField: 'password',
  secret: 'ask-learner' as const,
}
const SIGN_IN_OPTIONS: HarnessOptions = { signIn: SIGN_IN }

/** A history sink that logs every call as `[name, ...arguments]`, so a test reads the sequence the run reported. */
function recordingHistory() {
  const log: unknown[][] = []
  const sink = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args: unknown[]) =>
          // The server's output is not what these tests read.
          name === 'output' ? undefined : log.push([name, ...args]),
    },
  ) as NodeServerHistorySink
  return { sink, log }
}

/** Sends the request with the typed secret and returns the harness at the moment the sign-in request is written. */
async function signingIn(options: HarnessOptions = SIGN_IN_OPTIONS) {
  const harness = await readyHarness(options)
  await harness.run.sendRequest('key-1', { secret: SECRET })
  return harness
}

/** Answers the sign-in the way a server that opens a session does: the headers first, then the response. */
function answerSignIn(
  harness: Harness,
  response: Partial<NodeServerResponse> = {},
  setCookie: string[] = [SET_COOKIE],
): void {
  const [signInExchange] = harness.sender.exchanges
  signInExchange?.onSetCookie?.(setCookie)
  signInExchange?.response.resolve({ ...RESPONSE_200, ...response })
}

/** Waits until the run sent its second request, the declared one. */
function declaredRequestSent(harness: Harness): Promise<boolean> {
  return waitUntil(
    () => harness.sender.exchanges.length === 2,
    'the declared request was sent',
  )
}

// protects=the sign-in request carries the declared fields plus the typed password as JSON, and the declared request that follows carries exactly the session cookie; fails_when=the body lacks a field or the password, the declared request goes without the cookie or with another new input; no_claim=real bytes on a socket (sendDeclaredRequest tests); the sender is a fake that records its input
test('the sign-in body holds the typed password and the declared request follows with only the session cookie', async () => {
  // Arrange
  const harness = await signingIn()
  // Act
  answerSignIn(harness)
  await declaredRequestSent(harness)
  // Assert
  const [signInExchange, declaredExchange] = harness.sender.exchanges
  assert.deepEqual(signInExchange?.request, {
    method: 'POST',
    path: '/login',
    contentType: 'application/json',
    body: `{"email":"learner@example.test","password":"${SECRET}"}`,
  })
  assert.equal(signInExchange?.cookie, undefined)
  assert.deepEqual(declaredExchange?.request, {
    method: 'GET',
    path: '/api/users/7',
  })
  assert.equal(declaredExchange?.cookie, `sid=${COOKIE_VALUE}`)
  assert.deepEqual(declaredExchange?.inputKeys, [
    'host',
    'port',
    'request',
    'runId',
    'verifyPeer',
    'signal',
    'sanitize',
    'cookie',
    'onSetCookie',
  ])
})

// protects=the receipt returns once the sign-in is written, before its response, so the action never blocks on a learner pause in the sign-in handler; fails_when=sendRequest waits for the response or the view does not read request-in-flight and signing-in; no_claim=the service receipt (service tests)
test('sendRequest returns once the sign-in is written while the view reads signing-in', async () => {
  // Arrange
  const harness = await readyHarness(SIGN_IN_OPTIONS)
  // Act
  await harness.run.sendRequest('key-1', { secret: SECRET })
  // Assert
  const view = harness.run.view()
  assert.equal(view.state, 'request-in-flight')
  assert.deepEqual(view.signIn, { state: 'signing-in' })
  assert.equal(harness.sender.exchanges.length, 1)
})

// protects=a refused sign-in (401) ends the request as request-failed with NODE_SERVER_SIGN_IN_FAILED and sends no declared request; fails_when=the declared request is sent anyway, the code or its details differ, or the history lacks the failed sign-in; no_claim=the server's real 401
test('a 401 sign-in ends the request as NODE_SERVER_SIGN_IN_FAILED and sends no declared request', async () => {
  // Arrange
  const history = recordingHistory()
  const harness = await signingIn({ ...SIGN_IN_OPTIONS, history: history.sink })
  // Act
  answerSignIn(harness, { status: 401 }, [])
  const view = await until(
    harness,
    (current) => current.state === 'request-failed',
  )
  // Assert
  assert.equal(view.requestFailure?.code, 'NODE_SERVER_SIGN_IN_FAILED')
  assert.deepEqual(view.requestFailure?.details, {
    status: 401,
    reason: 'rejected',
  })
  assert.deepEqual(view.signIn, { state: 'failed', status: 401 })
  assert.equal(harness.sender.exchanges.length, 1)
  assert.deepEqual(
    history.log.map(([name]) => name),
    ['signIn'],
  )
  assert.deepEqual(history.log[0]?.[2], {
    path: '/login',
    status: 401,
    outcome: 'failed',
    code: 'NODE_SERVER_SIGN_IN_FAILED',
    durationMs: 21,
  })
})

// protects=a 2xx sign-in that sets no cookie is no session: the request fails with reason no-session-cookie and the declared request is not sent; fails_when=the declared request goes out without a session; no_claim=real servers that answer a bearer token
test('a 200 sign-in without a session cookie fails with reason no-session-cookie', async () => {
  // Arrange
  const harness = await signingIn()
  // Act
  answerSignIn(harness, { status: 200 }, [])
  const view = await until(
    harness,
    (current) => current.state === 'request-failed',
  )
  // Assert
  assert.equal(view.requestFailure?.code, 'NODE_SERVER_SIGN_IN_FAILED')
  assert.deepEqual(view.requestFailure?.details, {
    status: 200,
    reason: 'no-session-cookie',
  })
  assert.equal(harness.sender.exchanges.length, 1)
})

// protects=the history hears the sign-in, then the declared request in order; fails_when=the request opens before the sign-in entry or the sign-in entry is missing; no_claim=the history file (history tests)
test('the history is told the sign-in, then the declared request, its bytes and its answer', async () => {
  // Arrange
  const history = recordingHistory()
  const harness = await signingIn({ ...SIGN_IN_OPTIONS, history: history.sink })
  // Act
  answerSignIn(harness)
  await declaredRequestSent(harness)
  const [, declaredExchange] = harness.sender.exchanges
  await declaredExchange?.verified
  declaredExchange?.response.resolve(RESPONSE_200)
  await until(harness, (current) => current.state === 'responded')
  // Assert
  assert.deepEqual(
    history.log.map(([name]) => name),
    ['signIn', 'openRequest', 'markRequestSent', 'response'],
  )
  assert.equal(
    (history.log[0]?.[2] as { outcome: string }).outcome,
    'signed-in',
  )
})

// protects=a refusal before any sign-in byte keeps the run ready with the sign-in phase named, and publishes the output it held; fails_when=the run reads request-failed, the phase is missing, or the output stays held; no_claim=a real lsof
test('a peer check that refuses the sign-in before any byte leaves the run ready and says phase sign-in', async () => {
  // Arrange
  const harness = await readyHarness({
    ...SIGN_IN_OPTIONS,
    connectionHolders: [999],
  })
  // Act
  const error = await harness.run.sendRequest('key-1', { secret: SECRET }).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'LISTENER_NOT_OWNED')
  assert.deepEqual(error.details, { phase: 'sign-in' })
  const view = harness.run.view()
  assert.equal(view.state, 'ready')
  assert.equal(view.request, undefined)
  assert.deepEqual(view.signIn, { state: 'none' })
  assert.equal(harness.server.releasedHeld, 1)
  assert.equal(harness.server.droppedHeld, 0)
})

// protects=after the sign-in was written, a refusal of the declared request's own peer check ends the request (the sign-in changed the server) with phase request; fails_when=the run returns to ready or the phase is missing; no_claim=a real lsof
test('a declared request refused by the peer check after the sign-in ends as request-failed with phase request', async () => {
  // Arrange
  const options: HarnessOptions = { ...SIGN_IN_OPTIONS }
  const harness = await signingIn(options)
  // Act
  options.connectionHolders = [999]
  answerSignIn(harness)
  const view = await until(
    harness,
    (current) => current.state === 'request-failed',
  )
  // Assert
  assert.equal(view.requestFailure?.code, 'LISTENER_NOT_OWNED')
  assert.deepEqual(view.requestFailure?.details, { phase: 'request' })
  assert.deepEqual(view.signIn, { state: 'signed-in', status: 200 })
})

// protects=a declared stop that the sign-in request reaches is resumed without a capture, journaled and listed, and the same stop still pauses during the declared request; fails_when=the hit pauses the run, is captured, counts as reached, or the later hit is missed; no_claim=real DAP pauses
test('a declared stop hit during the sign-in is resumed and listed, and the same stop pauses at the declared request', async () => {
  // Arrange
  const harness = await signingIn()
  // Act
  const duringToken = harness.debug.hit(0)
  const during = await until(
    harness,
    (current) => current.stopsHitDuringSignIn?.length === 1,
  )
  answerSignIn(harness)
  await declaredRequestSent(harness)
  harness.debug.hit(0)
  const paused = await until(harness, (current) => current.state === 'paused')
  // Assert
  assert.deepEqual(harness.debug.resumed, [duringToken])
  assert.deepEqual(during.stopsHitDuringSignIn, [0])
  assert.deepEqual(during.stopsReached, [])
  assert.deepEqual(during.captures, [])
  assert.equal(during.state, 'request-in-flight')
  assert.deepEqual(
    harness.events
      .filter((event) => event.type === 'node-server.stop-hit-during-sign-in')
      .map((event) => event.detail),
    [{ declaredStopIndex: 0 }],
  )
  assert.deepEqual(paused.stopsReached, [0])
  assert.equal(paused.captures.length, 1)
})

// protects=a sign-in that ends without headers drops the output held for a possible session value and the run reports the withheld bytes; the hold lasts the whole exchange and ends at the headers; fails_when=held output is released after a reset, holdback is finite during the exchange, or the withheld event is missing; no_claim=the launcher's mask stage (captureProcessOutput tests)
test('a reset before the sign-in headers drops the held output and journals output-withheld', async () => {
  // Arrange
  const harness = await signingIn()
  const known = harness.calls.knownValues
  const holdbackDuringExchange = known?.holdback()
  // Act
  harness.sender.exchanges[0]?.response.reject(
    new StudyError('REQUEST_FAILED', 'reset'),
  )
  const view = await until(
    harness,
    (current) => current.state === 'request-failed',
  )
  known?.onWithheld(12)
  // Assert
  assert.equal(holdbackDuringExchange, Number.POSITIVE_INFINITY)
  assert.equal(harness.server.droppedHeld, 1)
  assert.equal(harness.server.releasedHeld, 0)
  assert.equal(view.requestFailure?.code, 'REQUEST_FAILED')
  assert.deepEqual(view.requestFailure?.details, { phase: 'sign-in' })
  assert.deepEqual(
    harness.events
      .filter((event) => event.type === 'node-server.output-withheld')
      .map((event) => event.detail),
    [{ bytes: 12 }],
  )
})

// protects=a stop admitted during the sign-in hold ends the exchange without headers: the held output is dropped (never released) so the journal can record its bytes; fails_when=the hold is left open after a stop and the held bytes vanish unrecorded; no_claim=the launcher's byte count (captureProcessOutput tests); the fake server only counts drop and release calls
test('a stop during the sign-in hold drops the held output', async () => {
  // Arrange
  const harness = await signingIn()
  // Act
  await harness.run.stop()
  // Assert
  assert.equal(harness.server.droppedHeld, 1)
  assert.equal(harness.server.releasedHeld, 0)
})

// protects=the server's exit during the sign-in hold drops the held output like a stop does; fails_when=the exit leaves the hold open and the held bytes are lost without a record; no_claim=the launcher's byte count; the exit is the fake server's
test('the server exiting during the sign-in hold drops the held output', async () => {
  // Arrange
  const harness = await signingIn()
  // Act
  harness.server.exitNow({ exitCode: 1, signal: null })
  await waitUntil(
    () => harness.server.droppedHeld === 1,
    'the held output was dropped',
  )
  // Assert
  assert.equal(harness.server.droppedHeld, 1)
  assert.equal(harness.server.releasedHeld, 0)
})

// protects=during the sign-in and after a failed one the view publishes no declared request (only signIn and the error describe what happened); fails_when=request is published for a request that was never sent; no_claim=the service resource (projection tests)
test('the view shows no declared request during the sign-in nor after a failed sign-in', async () => {
  // Arrange
  const harness = await signingIn()
  // Act
  const during = harness.run.view()
  answerSignIn(harness, { status: 401 }, [])
  const failed = await until(
    harness,
    (current) => current.state === 'request-failed',
  )
  // Assert
  assert.equal(during.state, 'request-in-flight')
  assert.equal(during.request, undefined)
  assert.equal(failed.request, undefined)
  assert.deepEqual(failed.signIn, { state: 'failed', status: 401 })
})

// protects=once a signed-in sign-in opened the declared request's window the view publishes that request; fails_when=the declared request never appears after the sign-in; no_claim=the bytes sent (sender tests)
test('the view publishes the declared request once the sign-in succeeded', async () => {
  // Arrange
  const harness = await signingIn()
  // Act
  answerSignIn(harness)
  await declaredRequestSent(harness)
  // Assert
  assert.equal(harness.run.view().request?.path, '/api/users/7')
})

// protects=cookies the declared request's response sets (a rotated session) join the mask set so a later echo is masked, and the cookies sent stay the sign-in's; fails_when=the rotated value is not masked or the declared request carries another cookie; no_claim=real Set-Cookie parsing (cookie utility tests); the sender is a fake that invokes the observer by hand
test('a session cookie rotated by the declared response joins the mask set', async () => {
  // Arrange
  const harness = await signingIn()
  answerSignIn(harness)
  await declaredRequestSent(harness)
  const declaredExchange = harness.sender.exchanges[1]
  // Act
  declaredExchange?.onSetCookie?.(['sid=rotatedSessionValue9; Path=/'])
  // Assert
  assert.equal(declaredExchange?.cookie, `sid=${COOKIE_VALUE}`)
  assert.ok(harness.run.learnerSecrets?.has('rotatedSessionValue9'))
  assert.equal(
    declaredExchange?.sanitize?.('echo rotatedSessionValue9'),
    'echo [masked]',
  )
})

// protects=the real run reads signIn awaiting-learner while the editor's box is open and none again once it closed; fails_when=setSignInAwaiting does not move the real run's signIn state; no_claim=the editor box itself
test('the run reads awaiting-learner while the password box is open and none after', async () => {
  // Arrange
  const harness = await readyHarness(SIGN_IN_OPTIONS)
  // Act
  harness.run.setSignInAwaiting?.(true)
  const awaiting = harness.run.view().signIn
  harness.run.setSignInAwaiting?.(false)
  const closed = harness.run.view().signIn
  // Assert
  assert.deepEqual(awaiting, { state: 'awaiting-learner' })
  assert.deepEqual(closed, { state: 'none' })
})

// protects=the response headers end the hold: the held output is released and holdback becomes the longest masking form; fails_when=output stays held after the headers or the holdback is wrong; no_claim=the launcher's mask stage
test('the sign-in response headers release the held output and make the holdback finite', async () => {
  // Arrange
  const harness = await signingIn()
  const known = harness.calls.knownValues
  // Act
  harness.sender.exchanges[0]?.onSetCookie?.([SET_COOKIE])
  // Assert
  assert.equal(harness.server.releasedHeld, 1)
  // The longest form is the cookie value percent-encoded again (s%253A...).
  assert.equal(known?.holdback(), 45)
})

// protects=the typed password and the session cookie never appear in the journal, the run view, the history or an error text, however the server echoes them; fails_when=any of those values, or its signature or payload part, reaches one of those sinks; no_claim=masking of the launcher's output stage and of MCP answers (their own tests); the sender here is a fake that applies the run's sanitize to a body the way the real one does
test('no password or cookie value reaches the journal, the view, the history or the failure text', async () => {
  // Arrange
  const history = recordingHistory()
  const harness = await signingIn({ ...SIGN_IN_OPTIONS, history: history.sink })
  const echoed = `{"session":"${COOKIE_VALUE}","payload":"sid1234567890abcdef","signature":"sigABCDEFGHIJKLMNOP","pw":"${SECRET}"}`
  // Act
  answerSignIn(harness)
  // Output printed once the headers are known is masked by the run even where the launcher's own mask is absent.
  await harness.emitOutput(`logged in ${SECRET} with sid1234567890abcdef\n`)
  await declaredRequestSent(harness)
  const declaredExchange = harness.sender.exchanges[1]
  declaredExchange?.response.resolve({
    ...RESPONSE_200,
    body: declaredExchange.sanitize?.(echoed) ?? echoed,
  })
  const view = await until(harness, (current) => current.state === 'responded')
  // Assert
  const published = JSON.stringify([harness.events, view, history.log])
  for (const hidden of [
    SECRET,
    COOKIE_VALUE,
    'sid1234567890abcdef',
    'sigABCDEFGHIJKLMNOP',
  ])
    assert.equal(published.includes(hidden), false, `${hidden} leaked`)
  assert.equal(
    view.response?.body,
    '{"session":"[masked]","payload":"[masked]","signature":"[masked]","pw":"[masked]"}',
  )
})

// protects=the run lists the typed password and every cookie form for the service's protocol masking; fails_when=the password, the whole value, its decoded form, its parts or the JSON-escaped forms are missing; no_claim=the service merging the set (service test)
test('learnerSecrets holds the password and the session cookie forms', async () => {
  // Arrange
  const harness = await signingIn()
  // Act
  harness.sender.exchanges[0]?.onSetCookie?.([SET_COOKIE])
  // Assert
  assert.deepEqual([...(harness.run.learnerSecrets ?? [])].sort(), [
    SECRET,
    's%3Asid1234567890abcdef.sigABCDEFGHIJKLMNOP',
    's:sid1234567890abcdef.sigABCDEFGHIJKLMNOP',
    'sid1234567890abcdef',
    'sid1234567890abcdef.sigABCDEFGHIJKLMNOP',
    'sigABCDEFGHIJKLMNOP',
  ])
})

// protects=a run without signIn behaves as before: one request, no cookie, no sign-in fields in the view, no secrets, no masking hook for the launcher; fails_when=the plain path gains a sign-in artifact; no_claim=the existing node-server suites, which stay green unchanged
test('a run without signIn sends its one request with no cookie and shows no sign-in state', async () => {
  // Arrange
  const harness = await readyHarness()
  // Act
  await harness.run.sendRequest('key-1')
  // Assert
  const view = harness.run.view()
  assert.equal(harness.sender.exchanges.length, 1)
  assert.equal(harness.sender.exchanges[0]?.cookie, undefined)
  assert.equal('signIn' in view, false)
  assert.equal('stopsHitDuringSignIn' in view, false)
  assert.equal(harness.run.learnerSecrets, undefined)
  assert.equal(harness.calls.knownValues, undefined)
})

// protects=a run with signIn refuses a send without the typed password and sends nothing; fails_when=a sign-in with an empty body password is sent; no_claim=the service always supplies the password
test('a run with signIn given no password sends nothing and stays ready', async () => {
  // Arrange
  const harness = await readyHarness(SIGN_IN_OPTIONS)
  // Act
  const error = await harness.run.sendRequest('key-1').then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'REQUEST_NOT_CONFIRMED')
  assert.deepEqual(error.details, { question: 'secret' })
  assert.equal(harness.sender.exchanges.length, 0)
  assert.equal(harness.run.view().state, 'ready')
})

// ---------------------------------------------------------------- the service's two questions

const SERVICE_SIGN_IN = {
  path: '/api/auth/sign-in/email',
  fields: { email: 'learner@example.test' },
  secretField: 'password',
  secret: 'ask-learner' as const,
}

/** Runs a service-level call and returns what it threw. */
async function refusalOf(call: () => unknown): Promise<unknown> {
  try {
    await call()
  } catch (error) {
    return error
  }
  return undefined
}

// protects=a GET with signIn asks the modal naming the sign-in, then the masked box titled for the sign-in route, and hands the typed secret to the run; fails_when=a GET is sent without asking, the question lacks the sign-in path, the box title differs, or the secret does not reach the run; no_claim=the modal's and the box's real text (environment tests)
test('a GET with signIn asks the modal naming the sign-in, then the password box, and sends the typed password to the run', async (context) => {
  // Arrange
  const harness = await createServiceHarness()
  context.after(() => harness.close())
  const asked: StateChangingRequestQuestion[] = []
  const boxTitles: string[] = []
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    signIn: SERVICE_SIGN_IN,
    confirm: async (question) => {
      asked.push(question)
      return true
    },
    ask: async (question) => {
      boxTitles.push(question.title)
      return SECRET
    },
  })
  // Act
  await service.performAction({
    instanceId: service.instanceId,
    runId: record.id,
    key: 'send-1',
    action: 'http-request',
  })
  // Assert
  assert.deepEqual(asked, [
    {
      runId: record.id,
      method: 'GET',
      path: '/api/healthz',
      signInPath: '/api/auth/sign-in/email',
    },
  ])
  assert.deepEqual(boxTitles, ['Sign in to /api/auth/sign-in/email'])
  assert.equal(run.lastSecret, SECRET)
  assert.deepEqual(run.awaitingCalls, [true, false])
})

// protects=Cancel at the modal answers REQUEST_NOT_CONFIRMED question request, shows no password box, keeps the run ready and leaves the key usable; fails_when=the box opens after Cancel, the code or question differs, or the key is consumed; no_claim=none
test('Cancel at the modal is REQUEST_NOT_CONFIRMED for the request, opens no password box and the same key works afterwards', async (context) => {
  // Arrange
  const harness = await createServiceHarness()
  context.after(() => harness.close())
  const answers = [false, true]
  let boxOpened = 0
  let modalCount = 0
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    signIn: SERVICE_SIGN_IN,
    confirm: async () => answers[modalCount++] ?? false,
    ask: async () => {
      boxOpened += 1
      return SECRET
    },
  })
  const action = {
    instanceId: service.instanceId,
    runId: record.id,
    key: 'send-1',
    action: 'http-request' as const,
  }
  // Act
  const refusal = await refusalOf(() => service.performAction(action))
  const stateAfterCancel = service.state(record).state
  const receipt = await service.performAction(action)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'REQUEST_NOT_CONFIRMED')
  assert.deepEqual(refusal.details, { question: 'request' })
  assert.equal(stateAfterCancel, 'ready')
  assert.equal(boxOpened, 1)
  assert.equal(receipt.key, 'send-1')
  assert.deepEqual(run.calls, ['prepare', 'sendRequest:send-1'])
})

// protects=a dismissed password box answers REQUEST_NOT_CONFIRMED question secret and sends nothing; fails_when=an empty or missing answer reaches the run or the question is not secret; no_claim=none
test('Cancel at the password box is REQUEST_NOT_CONFIRMED for the secret and sends nothing', async (context) => {
  // Arrange
  const harness = await createServiceHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    signIn: SERVICE_SIGN_IN,
    confirm: async () => true,
    ask: async () => undefined,
  })
  // Act
  const refusal = await refusalOf(() =>
    service.performAction({
      instanceId: service.instanceId,
      runId: record.id,
      key: 'send-1',
      action: 'http-request',
    }),
  )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'REQUEST_NOT_CONFIRMED')
  assert.deepEqual(refusal.details, { question: 'secret' })
  assert.deepEqual(run.calls, ['prepare'])
  assert.equal(service.state(record).state, 'ready')
})

// protects=the sign-in box is asked for at least 8 characters and an answer of 7 is no answer, so a short value is never masked service-wide; fails_when=the question lacks minChars 8 or a 7-character answer reaches the run; no_claim=the box's own validation (asker test); the stand-in ignores validateInput on purpose
test('the sign-in box asks for 8 characters and a 7-character answer sends nothing', async (context) => {
  // Arrange
  const harness = await createServiceHarness()
  context.after(() => harness.close())
  const minimums: (number | undefined)[] = []
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    signIn: SERVICE_SIGN_IN,
    confirm: async () => true,
    ask: async (question) => {
      minimums.push(question.minChars)
      return 'pausedx'
    },
  })
  // Act
  const refusal = await refusalOf(() =>
    service.performAction({
      instanceId: service.instanceId,
      runId: record.id,
      key: 'send-1',
      action: 'http-request',
    }),
  )
  // Assert
  assert.deepEqual(minimums, [8])
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'REQUEST_NOT_CONFIRMED')
  assert.deepEqual(refusal.details, { question: 'secret' })
  assert.deepEqual(run.calls, ['prepare'])
})

// protects=an editor without the password box cannot sign in: PREREQUISITE_MISSING and nothing is sent; fails_when=the sign-in is sent without a typed password; no_claim=none
test('an editor with no password box answers PREREQUISITE_MISSING for a signIn run', async (context) => {
  // Arrange
  const harness = await createServiceHarness()
  context.after(() => harness.close())
  harness.service.environment.askLearnerSecret = undefined
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    signIn: SERVICE_SIGN_IN,
    confirm: async () => true,
  })
  // Act
  const refusal = await refusalOf(() =>
    service.performAction({
      instanceId: service.instanceId,
      runId: record.id,
      key: 'send-1',
      action: 'http-request',
    }),
  )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'PREREQUISITE_MISSING')
  assert.deepEqual(run.calls, ['prepare'])
})

// protects=the service masks every node-server run's secrets in the answers it serves (MCP masking); fails_when=a password or cookie value of a node-server run is served unmasked; no_claim=the MCP protocol wiring
test('the service masks the password and cookie values of a node-server run in its answers', async (context) => {
  // Arrange
  const harness = await createServiceHarness()
  context.after(() => harness.close())
  const { service, run } = await startFakeNodeServerRun(harness, {
    signIn: SERVICE_SIGN_IN,
  })
  run.learnerSecrets.add(SECRET)
  run.learnerSecrets.add(COOKIE_VALUE)
  // Act
  const masked = service.maskLearnerSecretsInText(
    `signed in as ${SECRET} with ${COOKIE_VALUE}`,
  )
  // Assert
  assert.equal(masked, 'signed in as [masked] with [masked]')
})
