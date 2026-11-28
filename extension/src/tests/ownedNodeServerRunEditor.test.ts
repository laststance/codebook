import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { codebookStopLedger } from '../runtimeSupport/codebookStopLedger'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { defer } from './utils/defer'
import {
  editorRun,
  hitDeclaredStop,
  RUN_STOP_FILE,
} from './utils/nodeServerEditorRunHarness'
import {
  type HarnessOptions,
  RESPONSE_200,
  until,
} from './utils/nodeServerRunHarness'

const SECRET = 'hunter2-correct-horse'
/** A signed session cookie as express-session writes it: percent-encoded, with a signature. */
const SET_COOKIE = 'sid=s%3Asid1234567890abcdef.sigABCDEFGHIJKLMNOP; Path=/'
const SIGN_IN = {
  path: '/login',
  fields: { email: 'learner@example.test' },
  secretField: 'password',
  secret: 'ask-learner' as const,
}

/** What a promise rejects with, so a test reads the refusal. */
async function refusalOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call
  } catch (error) {
    return error
  }
  return undefined
}

// protects=a node server run writes no request byte while a stop of the server is still being read: the adapter already knows execution stopped, so the learner's exception must not be followed by a state-changing request; fails_when=the unreported-stop check runs only for a Bun run, so a node run whose exception stop is read while the peer check finishes writes the request and then reports the learner's held exception (Cycle 0153 ship pass 1 S1); seam=the editor's real debugger behind the run, a held stack read and a held peer check; no_claim=the adapter's real message timing
test(
  'a node run writes no request while an exception stop of the server is still being read',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const stackRead = defer<void>()
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    const { editor, harness } = await editorRun({
      editor: { stackTraceGate: stackRead.promise },
      run: {
        peerCheckGate: peerCheck.promise,
        onPeerCheckEntered: () => peerCheckEntered.resolve(),
      },
    })
    // Act
    const sending = refusalOf(harness.run.sendRequest('key-1'))
    await peerCheckEntered.promise
    editor.adapter.stop('exception', undefined, {
      file: RUN_STOP_FILE,
      line: 30,
    })
    peerCheck.resolve()
    const refusal = await sending
    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.equal(refusal.code, 'RUN_NOT_READY')
    assert.match(refusal.message, /A pause of the server is still being read/)
    assert.equal(harness.sender.bytesWritten, 0)
    stackRead.resolve()
    await harness.run.stop()
  },
)

// protects=a Pause the learner sent while the sign-in's peer check ran keeps the sign-in unwritten and its stop the learner's: the run's intent to send never opens the attribution window over an outstanding Pause; fails_when=the window opens in the pre-write check, so the sign-in is written and the learner's stop on a declared line is recorded as the sign-in's and continued by Codebook (Cycle 0153 ship pass 1 S2); seam=the editor's real debugger behind a sign-in run, a held peer check and the adapter's Pause reply after the check; no_claim=the adapter's real Pause timing
test(
  "a Pause sent during the sign-in peer check refuses the sign-in and its stop on a declared line stays the learner's",
  { timeout: 15_000 },
  async () => {
    // Arrange
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    const { editor, harness } = await editorRun({
      run: {
        signIn: SIGN_IN,
        peerCheckGate: peerCheck.promise,
        onPeerCheckEntered: () => peerCheckEntered.resolve(),
      },
    })
    const continuesAfterEntry = editor.requests.filter(
      (request) => request.command === 'continue',
    ).length
    // Act
    const sending = refusalOf(
      harness.run.sendRequest('key-1', { secret: SECRET }),
    )
    await peerCheckEntered.promise
    const answerPause = editor.adapter.learnerSendsPause()
    peerCheck.resolve()
    const refusal = await sending
    answerPause()
    hitDeclaredStop(editor, 0)
    const held = await until(harness, (view) => view.heldPause !== undefined)
    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.equal(refusal.code, 'LEARNER_PAUSED')
    assert.equal(harness.sender.bytesWritten, 0)
    assert.equal(held.heldPause?.reason, 'breakpoint')
    assert.equal(
      editor.requests.filter((request) => request.command === 'continue')
        .length,
      continuesAfterEntry,
    )
    assert.deepEqual(held.stopsHitDuringSignIn, [])
  },
)

// protects=a request is not written after the debug session of the run ended: the editor ends the session before the run learns whether the server exited, and nothing observes a request written in between; fails_when=the session's end leaves the write eligible, so the peer check finishing within that wait writes the request and reopens the ledger window of the dead session (Cycle 0153 ship pass 1 S4); seam=the editor's real debugger behind the run, the editor's termination event, a held peer check and an exit check that stays open; no_claim=js-debug's real termination timing
test(
  'a node run writes no request once its debug session ended while the exit of the server is still being checked',
  { timeout: 15_000 },
  async () => {
    // Arrange
    codebookStopLedger.reset()
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    const exitCheck = defer<void>()
    const { editor, harness } = await editorRun({
      run: {
        peerCheckGate: peerCheck.promise,
        onPeerCheckEntered: () => peerCheckEntered.resolve(),
      },
    })
    // The run waits for the server's exit after the session ended; the check stays open, as the real 500 ms wait does.
    harness.server.waitForExit = async () => {
      await exitCheck.promise
      return undefined
    }
    // Act
    const sending = refusalOf(harness.run.sendRequest('key-1'))
    await peerCheckEntered.promise
    editor.adapter.end()
    peerCheck.resolve()
    const refusal = await sending
    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.equal(refusal.code, 'RUN_NOT_READY')
    assert.match(refusal.message, /debug session of the server ended/)
    assert.equal(harness.sender.bytesWritten, 0)
    assert.equal(codebookStopLedger.isWindowOpen('node-server-session'), false)
    exitCheck.resolve()
    await harness.run.stop()
  },
)

// protects=a declared stop that arrived inside the request stays the request's capture when the response settles before the stop's stack read does: the run keeps the owned breakpoints' binding until every stop that already arrived is classified, and judges the stop by its arrival; fails_when=the response retires the breakpoints and closes the window first, so the stop read afterwards is held as unattributed with no capture (Cycle 0153 ship pass 1 S6, OV6); seam=the editor's real debugger behind the run, a second declared stop whose stack read is held, the response delivered before it is released; no_claim=the real timing of an adapter's stack read
test(
  'a declared stop that arrived inside the request is captured when the response is delivered before its stack read finished',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const editorOptions: { stackTraceGate?: Promise<void> } = {}
    const { editor, harness } = await editorRun({
      editor: editorOptions,
      run: { stops: 2 },
    })
    await harness.run.sendRequest('key-1')
    hitDeclaredStop(editor, 0)
    await until(harness, (view) => view.state === 'paused')
    editor.adapter.learnerContinues()
    const secondStackRead = defer<void>()
    editorOptions.stackTraceGate = secondStackRead.promise
    hitDeclaredStop(editor, 1)
    // Act
    harness.sender.exchanges[0]?.response.resolve(RESPONSE_200)
    await until(harness, (view) => view.state === 'responded')
    secondStackRead.resolve()
    const view = await until(
      harness,
      (current) => current.captures.length === 2,
    )
    // Assert
    assert.deepEqual(view.stopsReached, [0, 1])
    assert.equal(view.heldPause, undefined)
    await harness.run.stop()
  },
)

// protects=an accepted learner Pause that lands on an armed declared line before the server is ready stays the learner's: it is held, never continued as a start hit; fails_when=the run takes the stop for a declared stop hit during startup, so Codebook sends a continue the learner never asked for (Cycle 0153 ship pass 1 S8); seam=the editor's real debugger behind the run, a held readiness check, the editor's Pause with its accepted reply and a breakpoint stop on the declared line; no_claim=js-debug's real reason for a pause that lands on a breakpoint
test(
  'a learner Pause that lands on a declared line before the server is ready is held and never continued',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const readiness = defer<void>()
    const { editor, harness } = await editorRun({
      prepare: false,
      run: {
        waitForReadiness: async () => {
          await readiness.promise
          return { host: '127.0.0.1', bothAccept: false }
        },
      },
    })
    const preparing = harness.run.prepare()
    await harness.readinessStarted
    const continuesAfterEntry = editor.requests.filter(
      (request) => request.command === 'continue',
    ).length
    // Act
    editor.adapter.learnerPauses()
    hitDeclaredStop(editor, 0)
    await until(harness, (view) => view.heldPause !== undefined)
    readiness.resolve()
    await preparing
    // Assert
    const view = harness.run.view()
    assert.equal(view.state, 'learner-paused')
    assert.equal(view.heldPause?.kind, 'learner')
    assert.deepEqual(view.stopsHitAtStart, [])
    assert.equal(
      editor.requests.filter((request) => request.command === 'continue')
        .length,
      continuesAfterEntry,
    )
    await harness.run.stop()
  },
)

// protects=a sign-in whose connection failed closes its attribution window at once, so a declared line hit while the exit of the server is still being checked is held as a stop outside the request instead of being continued as the sign-in's; fails_when=the window stays open until the error report finishes its exit check, so the stop reads as arrived during the sign-in and Codebook continues it (Cycle 0153 ship pass 1 S9); seam=the editor's real debugger behind a sign-in run, a rejected sign-in response and an exit check that stays open; no_claim=a real connection reset
test(
  'a declared line hit after the sign-in connection failed is held and not continued while the server exit is still being checked',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const exitCheck = defer<void>()
    const { editor, harness } = await editorRun({ run: { signIn: SIGN_IN } })
    harness.server.waitForExit = async () => {
      await exitCheck.promise
      return undefined
    }
    await harness.run.sendRequest('key-1', { secret: SECRET })
    const continuesBefore = editor.requests.filter(
      (request) => request.command === 'continue',
    ).length
    // Act
    harness.sender.exchanges[0]?.response.reject(
      new StudyError('REQUEST_FAILED', 'connection reset'),
    )
    // Let the rejection reach the run before the stop arrives.
    await new Promise((resolve) => setImmediate(resolve))
    hitDeclaredStop(editor, 0)
    const held = await until(harness, (view) => view.heldPause !== undefined)
    // Assert
    assert.deepEqual(held.stopsHitDuringSignIn, [])
    assert.equal(
      editor.requests.filter((request) => request.command === 'continue')
        .length,
      continuesBefore,
    )
    exitCheck.resolve()
    await harness.run.stop()
  },
)

// protects=a declared breakpoint that is hit right after the learner pressed Continue on the last held learner pause, before the adapter answered, is the request's capture: the window the run intends counts while that Continue is in flight; fails_when=the held pause still closes the window when the stop arrives, so the stop is recorded as arrived outside the request and held as unattributed although the Continue reply reopened the window an instant later (Cycle 0153 ship pass 1 OV4); seam=the editor's real debugger behind the run, the editor's Pause with its stop, a Continue request whose reply is held and a declared hit before it; no_claim=the adapter's real message order (the native check covers it)
test(
  "a declared breakpoint hit before the reply to the learner Continue of the last held pause is captured as the request's",
  { timeout: 15_000 },
  async () => {
    // Arrange
    const { editor, harness } = await editorRun()
    await harness.run.sendRequest('key-1')
    editor.adapter.learnerPauses()
    editor.adapter.stop('pause', undefined, { file: RUN_STOP_FILE, line: 30 })
    await until(harness, (view) => view.state === 'learner-paused')
    const answerContinue = editor.adapter.learnerSendsContinue()
    // Act
    hitDeclaredStop(editor, 0)
    answerContinue()
    const view = await until(
      harness,
      (current) => current.captures.length === 1,
    )
    // Assert
    assert.deepEqual(view.stopsReached, [0])
    assert.equal(view.heldPause, undefined)
    await harness.run.stop()
  },
)

// protects=a declared stop that hit while the sign-in was out is the sign-in's even when its stack read is delivered after the sign-in answered, and the phase comes from the window the real sign-in send opened; fails_when=the sign-in's send stops marking its window as the sign-in's, or the phase is read when the stack read finishes, so the late stop is captured as the declared request's hit (Cycle 0153 ship pass 1 S14, which replaces the hand-supplied phase of the isolated run test and the manually opened sign-in window of the isolated adapter test with the real send path); seam=the editor's real debugger behind a sign-in run, a held stack read delivered after the sign-in's response (the declared request is refused meanwhile, since a pause is still being read); no_claim=a real server's handler timing
test(
  'a declared stop that hit during the sign-in is resumed and not captured when its stack read is delivered after the sign-in answered',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const stackRead = defer<void>()
    const { editor, harness } = await editorRun({
      editor: { stackTraceGate: stackRead.promise },
      run: { signIn: SIGN_IN },
    })
    await harness.run.sendRequest('key-1', { secret: SECRET })
    hitDeclaredStop(editor, 0)
    const continuesBefore = editor.requests.filter(
      (request) => request.command === 'continue',
    ).length
    harness.sender.exchanges[0]?.onSetCookie?.([SET_COOKIE])
    harness.sender.exchanges[0]?.response.resolve(RESPONSE_200)
    // The declared request is refused while the stop is still being read; the stop's delivery comes after that.
    await until(harness, (current) => current.requestFailure !== undefined)
    // Act
    stackRead.resolve()
    const view = await until(
      harness,
      (current) => current.stopsHitDuringSignIn?.length === 1,
    )
    // Assert
    assert.deepEqual(view.stopsHitDuringSignIn, [0])
    assert.deepEqual(view.captures, [])
    assert.deepEqual(view.stopsReached, [])
    await waitUntil(
      () =>
        editor.requests.filter((request) => request.command === 'continue')
          .length ===
        continuesBefore + 1,
      'the sign-in hit continued',
      5_000,
    )
    await harness.run.stop()
  },
)

/** The sentence a declared request carries when the learner's pause refuses it after the sign-in ran. */
const TERMINAL_PAUSE_SENTENCE =
  'The declared request was not sent because the learner held a pause of the server after the sign-in, which already ran; Codebook never resumes it. Let the learner continue the server in the debugger, then stop this run (codebook_stop) and start a new run.'

// protects=a declared request refused after its sign-in because a pause of the server is still being read says the request was not sent, the sign-in already ran, and the run must be stopped and started again: the run consumed its one request, so no send is left; fails_when=the refusal keeps the generic sentence that asks to send again once the pause is reported, or omits the stop that releases the running server (Cycle 0153 ship pass 1 S13); seam=the editor's real debugger behind a sign-in run, an exception stop whose stack read is held and the sign-in's response; no_claim=the learner's reading of the sentence
test(
  'a declared request refused after the sign-in while a pause is still being read tells the chat to stop the run and start a new one',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const stackRead = defer<void>()
    const { editor, harness } = await editorRun({
      editor: { stackTraceGate: stackRead.promise },
      run: { signIn: SIGN_IN },
    })
    await harness.run.sendRequest('key-1', { secret: SECRET })
    editor.adapter.stop('exception', undefined, {
      file: RUN_STOP_FILE,
      line: 30,
    })
    // Act
    harness.sender.exchanges[0]?.onSetCookie?.([SET_COOKIE])
    harness.sender.exchanges[0]?.response.resolve(RESPONSE_200)
    const view = await until(
      harness,
      (current) => current.requestFailure !== undefined,
    )
    // Assert
    assert.equal(view.requestFailure?.code, 'REQUEST_FAILED')
    assert.equal(view.requestFailure?.message, TERMINAL_PAUSE_SENTENCE)
    stackRead.resolve()
    await harness.run.stop()
  },
)

// protects=a declared request whose own peer check finishes while a pause of the server is still being read ends with the same terminal sentence as the refusal before it; fails_when=the refusal at the write keeps the generic sentence that asks to send again (Cycle 0153 ship pass 1 S13); seam=the editor's real debugger behind a sign-in run, a held peer check of the declared request and an exception stop whose stack read is held; no_claim=the learner's reading of the sentence
test(
  'a declared request whose peer check ends while a pause is still being read ends with the terminal sentence',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const stackRead = defer<void>()
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    const runOptions: HarnessOptions = { signIn: SIGN_IN }
    const { editor, harness } = await editorRun({
      editor: { stackTraceGate: stackRead.promise },
      run: runOptions,
    })
    await harness.run.sendRequest('key-1', { secret: SECRET })
    // The declared request's peer check stays open until the stop arrived.
    runOptions.peerCheckGate = peerCheck.promise
    runOptions.onPeerCheckEntered = (): void => peerCheckEntered.resolve()
    harness.sender.exchanges[0]?.onSetCookie?.([SET_COOKIE])
    harness.sender.exchanges[0]?.response.resolve(RESPONSE_200)
    await peerCheckEntered.promise
    // Act
    editor.adapter.stop('exception', undefined, {
      file: RUN_STOP_FILE,
      line: 30,
    })
    peerCheck.resolve()
    const view = await until(
      harness,
      (current) => current.requestFailure !== undefined,
    )
    // Assert
    assert.equal(view.requestFailure?.code, 'REQUEST_FAILED')
    assert.equal(view.requestFailure?.message, TERMINAL_PAUSE_SENTENCE)
    stackRead.resolve()
    await harness.run.stop()
  },
)
