import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { defer } from './utils/defer'
import {
  createHarness,
  type HarnessOptions,
  RESPONSE_200,
  sendRequest,
  until,
} from './utils/nodeServerRunHarness'

/** The Bun loader a `loader: "bun"` declaration resolves to, with a learner's Bun and the extension's bootstrap. */
const BUN_LOADER = {
  kind: 'bun',
  executable: '/Users/learner/.bun/bin/bun',
  version: '1.4.5',
  bootstrap: '/extension/dist/bunInspectorBootstrap.js',
} as const

/** A test that waits on a held peer check fails after this long instead of hanging the suite. */
const PEER_CHECK_TEST_TIMEOUT_MS = 15_000

// Value: protects=the order of a Bun server run's preparation (Cycle 0152 E1-M2): Bun has no paused entry, so the run attaches as Bun, releases without continuing anything and arms every stop only once the declared port answered and the listener is verified, before the run is ready; fails_when=the stops are armed before the server listens (js-debug's guessed TypeScript-line breakpoint and its source-mapped replacement can collapse into none on Bun), the release continues a pause that does not exist, or the run reads ready before its stops are armed; seam=the run harness's fake debugger, launch and readiness; no_claim=Bun or js-debug themselves (the native check and the real-Bun launch test cover them)
test('a Bun server run attaches as Bun, releases without an entry pause and arms its stops after the port answers, before it is ready', async () => {
  // Arrange
  const harness = createHarness({ stops: 2, launchLoader: BUN_LOADER })
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
    'releaseEntry',
    'waitForReadiness',
    'verifyListener',
    'armStops',
  ])
  assert.deepEqual(harness.debug.attachedRuntimes, ['bun'])
  assert.deepEqual(harness.debug.releaseOptions, [{ entryPause: false }])
  assert.equal(harness.run.view().state, 'ready')
  assert.deepEqual(
    harness.run.view().stops.map((stop) => stop.boundLine),
    [14, 15],
  )
})

// Value: protects=a node server run keeps its entry-pause order when Bun support is added: attach as node, arm, then continue the real entry pause; fails_when=the Bun branch leaks into a node launch (late arming, or a release that no longer continues the entry); seam=the run harness; no_claim=the real node inspector
test('a node server run still arms its stops before it continues the entry pause', async () => {
  // Arrange
  const harness = createHarness()
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(harness.order.slice(harness.order.indexOf('attach')), [
    'attach',
    'armStops',
    'releaseEntry',
    'waitForReadiness',
    'verifyListener',
  ])
  assert.deepEqual(harness.debug.attachedRuntimes, ['node'])
  assert.deepEqual(harness.debug.releaseOptions, [{ entryPause: true }])
})

// Value: protects=a Bun stop that binds elsewhere fails the start after readiness as the arming step and closes the server, and no request is ever sent; fails_when=the late arming's failure is swallowed (the run reads ready with an unarmed stop) or the server keeps running; seam=the harness's failing arm; no_claim=the real adapter's binding message
test('a Bun stop that binds elsewhere fails the start with RUNTIME_FAILED naming the arming step and sends no request', async () => {
  // Arrange
  const harness = createHarness({
    launchLoader: BUN_LOADER,
    armFails: new Error(
      'Declared breakpoint 14:3 is bound at 16:1; declare 16:1.',
    ),
  })
  // Act
  const error = await harness.run.prepare().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'RUNTIME_FAILED')
  assert.match(
    error.message,
    /while arming the declared stops: Declared breakpoint 14:3 is bound at 16:1/,
  )
  assert.equal(harness.server.closeCalls, 1)
  assert.equal(harness.sender.calls.length, 0)
})

// Value: protects=the declared request of a Bun run goes out only after the stops were armed; fails_when=the request window opens before armStops ran, or armStops never ran at all (a missing index must fail, not sort first); seam=the harness's order journal and request sender; no_claim=network timing of a real server
test('a Bun server run sends the declared request only after its stops are armed', async () => {
  // Arrange
  const harness = createHarness({ launchLoader: BUN_LOADER })
  await harness.run.prepare()
  // Act
  await sendRequest(harness)
  // Assert
  const armedAt = harness.order.indexOf('armStops')
  const windowAt = harness.order.indexOf('window:true')
  assert.ok(armedAt >= 0, 'the stops were armed')
  assert.ok(windowAt >= 0, 'the request window opened')
  assert.ok(armedAt < windowAt)
})

// Value: protects=a request tried while a Bun run's late arming is still open sends nothing, and the same request after the arming finished is sent exactly once; fails_when=the run publishes ready (or accepts the request) before its stops are armed; seam=the harness's arming held open by a gate; no_claim=real adapter timing
test('a Bun run sends no request while its stops are still being armed and one request once they are armed', async () => {
  // Arrange
  const armGate = defer<void>()
  const armStarted = defer<void>()
  const harness = createHarness({
    launchLoader: BUN_LOADER,
    armGate: armGate.promise,
    duringArm: () => armStarted.resolve(),
  })
  const preparing = harness.run.prepare()
  await armStarted.promise
  // Act
  const early = await sendRequest(harness).catch((error: unknown) => error)
  const sentWhileArming = harness.sender.calls.length
  armGate.resolve()
  await preparing
  await sendRequest(harness)
  // Assert
  assert.ok(early instanceof StudyError)
  assert.equal(sentWhileArming, 0)
  assert.equal(harness.sender.calls.length, 1)
})

// Value: protects=a Bun server that exits while its stops are being armed after the listener check fails the start promptly with the server-exit error and no request; fails_when=the exit is ignored until the run is prepared, so arming waits for its deadline or the run publishes ready for a dead server; seam=the harness's arming held open until the run aborts it, and the fake server's exit during it; no_claim=a real Bun crash
test('a Bun server that exits during the late arming fails the start with the server-exit error and sends no request', async () => {
  // Arrange
  const harnessRef: { current?: ReturnType<typeof createHarness> } = {}
  const harness = createHarness({
    launchLoader: BUN_LOADER,
    armHangsUntilAborted: true,
    duringArm: () =>
      harnessRef.current?.server.exitNow({ exitCode: 7, signal: null }),
  })
  harnessRef.current = harness
  // Act
  const failure = await harness.run.prepare().catch((error: unknown) => error)
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'SERVER_EXITED')
  assert.match(failure.message, /The server exited with code 7/)
  assert.equal(harness.sender.calls.length, 0)
})

// Value: protects=a Bun stop the adapter withdrew after it verified it fails the start before the request with the unbound-stop sentence; fails_when=the run trusts the arming's earlier answer and sends the request with a stop that no longer pauses; seam=the harness's debugger re-read of its bindings; no_claim=how js-debug withdraws a binding
test('a Bun stop withdrawn after arming fails the start before the request, naming that stop', async () => {
  // Arrange
  const harness = createHarness({
    stops: 2,
    launchLoader: BUN_LOADER,
    withdrawnStops: [0],
  })
  // Act
  const error = await harness.run.prepare().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'RUNTIME_FAILED')
  assert.match(
    error.message,
    /while arming the declared stops: Declared stop 1 at src\/routes\/users\.ts:14 did not bind on Bun/,
  )
  assert.equal(harness.sender.calls.length, 0)
})

// Value: protects=a Bun run whose debug session ends while it arms its stops after readiness stops arming at once, fails the start with the session's own reason and sends no request; fails_when=the late arming ignores the run's abort and waits for its arming deadline (the start then fails late, as a timeout, not as the session end), or the request is sent; seam=the harness's arming that waits for its abort signal and a session end during it; no_claim=the real adapter's session end
test('a Bun run whose debug session ends during the late arming fails with the session reason and sends no request', async () => {
  // Arrange
  const harness = createHarness({
    launchLoader: BUN_LOADER,
    armHangsUntilAborted: true,
    duringArm: (debug) => debug.handlers?.onEnd('adapter crashed'),
  })
  // Act
  const failure = await harness.run.prepare().catch((error: unknown) => error)
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'RUNTIME_FAILED')
  assert.match(
    String(failure.causeDetail ?? failure.message),
    /adapter crashed/,
  )
  // The session ended inside the late arming, after the readiness check.
  assert.ok(
    harness.order.indexOf('armStops') > harness.order.indexOf('verifyListener'),
  )
  assert.equal(harness.sender.calls.length, 0)
})

// Value: protects=a Bun run whose declared stop the debugger leaves unverified after the late arming fails before its request, naming the stop and how to recover, and closes the server; fails_when=the run sends the request with an unbound stop, so the stop is silently never reached (Cycle 0152 Task 6 in Cursor: a stop on the first statement of a module that only declares functions sat on js-debug's module-entry breakpoint and never bound), or the failure names no stop; seam=the harness's arming that leaves the second stop without a bound line; no_claim=which lines js-debug cannot place
test('a Bun run whose declared stop stays unbound after the late arming fails before its request, naming that stop', async () => {
  // Arrange
  const harness = createHarness({
    stops: 2,
    launchLoader: BUN_LOADER,
    unboundStops: [1],
  })
  // Act
  const error = await harness.run.prepare().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'RUNTIME_FAILED')
  assert.match(
    error.message,
    /while arming the declared stops: Declared stop 2 at src\/routes\/users\.ts:15 did not bind on Bun: the debugger verified no breakpoint on that line once the server listened, so the request was not sent\./,
  )
  assert.equal(harness.server.closeCalls, 1)
  assert.equal(harness.sender.calls.length, 0)
})

// Value: protects=a node run keeps accepting a stop that is still unverified at arming (its file loads after the entry pause), so the Bun binding check never refuses a node launch; fails_when=the check leaks into node runs and refuses every stop in a file node has not loaded yet; seam=the harness's arming that leaves the second stop without a bound line on a node launch; no_claim=node's own late binding
test('a node run with a stop still unverified at arming is prepared as before', async () => {
  // Arrange
  const harness = createHarness({ stops: 2, unboundStops: [1] })
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(harness.run.view().state, 'ready')
})

// Value: protects=a Bun run re-reads every declared stop's binding right before the request bytes are written, so a stop withdrawn after the preparation refuses the send with the unbound-stop sentence and writes nothing; fails_when=the send trusts the preparation's cached readiness and the POST runs with a stop that no longer pauses; seam=the harness debugger withdrawing stop 0 after the run is prepared; no_claim=how js-debug withdraws a binding
test('a Bun run refuses its request when a declared stop was withdrawn after the preparation and writes no byte', async () => {
  // Arrange
  const harness = createHarness({ stops: 2, launchLoader: BUN_LOADER })
  await harness.run.prepare()
  harness.debug.withdrawnAfterArming.add(0)
  // Act
  const error = await sendRequest(harness).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.match(
    error.message,
    /^Declared stop 1 at src\/routes\/users\.ts:14 did not bind on Bun/,
  )
  assert.equal(harness.sender.calls.length, 0)
})

// Value: protects=a Bun run does not send its request while a pause is still being classified, so a pause that came before the request is never read as caused by it; fails_when=the request window opens with an unclassified pause pending; seam=the harness debugger reporting an unreported pause; no_claim=how long a stack read takes
test('a Bun run sends no request while a pause of the server is still being read', async () => {
  // Arrange
  const harness = createHarness({ launchLoader: BUN_LOADER })
  await harness.run.prepare()
  harness.debug.unreportedPause = true
  // Act
  const error = await sendRequest(harness).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.match(error.message, /A pause of the server is still being read/)
  assert.equal(harness.sender.calls.length, 0)
})

// Value: protects=the declared request that follows a sign-in is not written when a declared stop was withdrawn meanwhile, and the request ends with the unbound-stop sentence; fails_when=only the sign-in is checked and the declared POST runs unobserved; seam=the harness debugger withdrawing stop 0 between the sign-in and its response; no_claim=the sign-in's own server behaviour
test(
  'a Bun run with sign-in writes no declared request when a stop was withdrawn during the sign-in',
  { timeout: PEER_CHECK_TEST_TIMEOUT_MS },
  async () => {
    // Arrange
    const harness = createHarness({
      launchLoader: BUN_LOADER,
      signIn: {
        path: '/login',
        fields: { email: 'learner@example.test' },
        secretField: 'password',
        secret: 'ask-learner',
      },
    })
    await harness.run.prepare()
    await harness.run.sendRequest('key-1', { secret: 'hunter2-correct-horse' })
    harness.debug.withdrawnAfterArming.add(0)
    // Act
    const [signInExchange] = harness.sender.exchanges
    signInExchange?.onSetCookie?.(['sid=s%3Aabc123def456; Path=/; HttpOnly'])
    signInExchange?.response.resolve(RESPONSE_200)
    await until(harness, (view) => view.state === 'request-failed')
    // Assert
    assert.equal(harness.sender.exchanges.length, 1)
    assert.match(
      JSON.stringify(harness.run.view()),
      /Declared stop 1 at src\/routes\/users\.ts:14 did not bind on Bun/,
    )
  },
)

// Value: protects=a Bun stop withdrawn while the sender's peer check is still reading the connection's holder is refused before the first byte, and the request leaves nothing on the wire; fails_when=the binding check runs only before the sender connects and the POST is written after the stop is gone; seam=the harness's peer check held open by a gate while the debugger withdraws stop 0; no_claim=how js-debug withdraws a binding
test(
  'a Bun run writes no request byte when a declared stop is withdrawn while the connection is being verified',
  { timeout: PEER_CHECK_TEST_TIMEOUT_MS },
  async () => {
    // Arrange
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    const harness = createHarness({
      launchLoader: BUN_LOADER,
      peerCheckGate: peerCheck.promise,
      onPeerCheckEntered: peerCheckEntered.resolve,
    })
    await harness.run.prepare()
    const outcome = harness.run.sendRequest('key-1').then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
    // The stop is withdrawn only once the peer check is really open.
    await peerCheckEntered.promise
    // Act
    harness.debug.withdrawnAfterArming.add(0)
    peerCheck.resolve()
    const error = await outcome
    // Assert
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'RUN_NOT_READY')
    assert.match(
      error.message,
      /^Declared stop 1 at src\/routes\/users\.ts:14 did not bind on Bun/,
    )
    assert.equal(harness.sender.bytesWritten, 0)
    assert.equal(harness.run.view().state, 'ready')
    assert.equal(harness.run.view().request, undefined)
    assert.equal(harness.order.includes('window:true'), false)
  },
)

// Value: protects=the declared request after a sign-in writes no byte when a stop is withdrawn while its own connection is being verified, and the request ends with the unbound-stop sentence; fails_when=the recheck runs before the declared sender connects and the withdrawal during its peer check is ignored; seam=the harness's peer check held open for the declared request only; no_claim=the sign-in's server behaviour
test(
  'a Bun run with sign-in writes no declared request byte when a stop is withdrawn while its connection is being verified',
  { timeout: PEER_CHECK_TEST_TIMEOUT_MS },
  async () => {
    // Arrange
    const options: HarnessOptions = {
      launchLoader: BUN_LOADER,
      signIn: {
        path: '/login',
        fields: { email: 'learner@example.test' },
        secretField: 'password',
        secret: 'ask-learner',
      },
    }
    const harness = createHarness(options)
    await harness.run.prepare()
    await harness.run.sendRequest('key-1', { secret: 'hunter2-correct-horse' })
    const bytesAfterSignIn = harness.sender.bytesWritten
    // The declared request's peer check stays open until the stop is withdrawn.
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    options.peerCheckGate = peerCheck.promise
    options.onPeerCheckEntered = peerCheckEntered.resolve
    const [signInExchange] = harness.sender.exchanges
    signInExchange?.onSetCookie?.(['sid=s%3Aabc123def456; Path=/; HttpOnly'])
    signInExchange?.response.resolve(RESPONSE_200)
    // The stop is withdrawn only once the declared request's peer check is really open.
    await peerCheckEntered.promise
    // Act
    harness.debug.withdrawnAfterArming.add(0)
    peerCheck.resolve()
    await until(harness, (view) => view.state === 'request-failed')
    // Assert
    assert.equal(bytesAfterSignIn, 1)
    assert.equal(harness.sender.bytesWritten, 1)
    assert.match(
      JSON.stringify(harness.run.view()),
      /Declared stop 1 at src\/routes\/users\.ts:14 did not bind on Bun/,
    )
  },
)

// Value: protects=a Bun pause that arrived before the request's bytes were written (the learner's Pause) and is then reported as a breakpoint at a declared line is held for the learner and records no capture, whatever the request state is when its stack has been read; fails_when=the run re-derives the attribution from the request in flight and saves a replay entry for the learner's pause; seam=the harness debugger reporting the arrival-time window as closed; no_claim=the real adapter's event order
test('a Bun pause that arrived before the request was written is left to the learner and recorded as no capture', async () => {
  // Arrange
  const harness = createHarness({ launchLoader: BUN_LOADER })
  await harness.run.prepare()
  await sendRequest(harness)
  // Act
  harness.debug.pause({
    declaredStopIndex: 0,
    location: { path: 'src/routes/users.ts', line: 14 },
    inRequestWindowAtStop: false,
  })
  // Assert
  const view = harness.run.view()
  assert.equal(view.captures.length, 0)
  assert.equal(view.heldPause?.kind, 'unattributed')
  assert.equal(
    harness.order.some((step) => step.startsWith('capture:')),
    false,
  )
  assert.deepEqual(harness.debug.resumed, [])
})

// Value: protects=the debugger's request-attribution window closes when the sign-in exchange ends, so a declared stop hit while the declared request is still connecting and verifying its peer is held as unattributed and is never captured as that request's hit; fails_when=the sign-in's window stays open into the declared request's connection and peer check (the hit is then saved as the request's capture although no byte of the declared request was written); seam=the harness's fake debugger recording setRequestWindow, with the declared request's peer check held open; no_claim=the real adapter's stop ledger or js-debug's event order
test(
  'a declared stop hit while the declared request after a sign-in is still being verified is held as unattributed, not captured',
  { timeout: PEER_CHECK_TEST_TIMEOUT_MS },
  async () => {
    // Arrange
    const options: HarnessOptions = {
      launchLoader: BUN_LOADER,
      signIn: {
        path: '/login',
        fields: { email: 'learner@example.test' },
        secretField: 'password',
        secret: 'ask-learner',
      },
    }
    const harness = createHarness(options)
    await harness.run.prepare()
    await harness.run.sendRequest('key-1', { secret: 'hunter2-correct-horse' })
    // The declared request's peer check stays open while the stop is hit.
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    options.peerCheckGate = peerCheck.promise
    options.onPeerCheckEntered = peerCheckEntered.resolve
    const [signInExchange] = harness.sender.exchanges
    signInExchange?.onSetCookie?.(['sid=s%3Aabc123def456; Path=/; HttpOnly'])
    signInExchange?.response.resolve(RESPONSE_200)
    await peerCheckEntered.promise
    // Act
    const windowOpenAtHit = harness.debug.requestWindowOpen
    harness.debug.pause({
      declaredStopIndex: 0,
      location: { path: 'src/routes/users.ts', line: 14 },
      inRequestWindowAtStop: windowOpenAtHit,
    })
    // Assert
    assert.equal(windowOpenAtHit, false)
    const view = harness.run.view()
    assert.equal(view.heldPause?.kind, 'unattributed')
    assert.equal(view.captures.length, 0)
    assert.equal(
      harness.order.some((step) => step.startsWith('capture:')),
      false,
    )
    // The held pause then refuses the declared request's write, so the run settles with the request ended and the window never opens again; the refused exchange closes the window once when its rejection arrives (Cycle 0153 ship pass 2 T8) and once more when the request ends.
    peerCheck.resolve()
    await until(harness, (current) => current.requestFailure !== undefined)
    assert.equal(harness.sender.bytesWritten, 1)
    assert.deepEqual(
      harness.order.filter((step) => step.startsWith('window:')),
      ['window:true', 'window:false', 'window:false', 'window:false'],
    )
  },
)

// Value: protects=the declared request after a sign-in opens the debugger's window again only when its first byte is about to be written, after the sign-in's window closed with the sign-in's response; fails_when=the window stays closed for the declared request (its stop is held as unattributed and never captured) or stays open between the two requests; seam=the harness's fake debugger recording setRequestWindow with the declared request's peer check held open; no_claim=the real adapter's stop ledger
test(
  'the window of a Bun run with sign-in is closed after the sign-in answered and opens again when the declared request is written',
  { timeout: PEER_CHECK_TEST_TIMEOUT_MS },
  async () => {
    // Arrange
    const options: HarnessOptions = {
      launchLoader: BUN_LOADER,
      signIn: {
        path: '/login',
        fields: { email: 'learner@example.test' },
        secretField: 'password',
        secret: 'ask-learner',
      },
    }
    const harness = createHarness(options)
    await harness.run.prepare()
    await harness.run.sendRequest('key-1', { secret: 'hunter2-correct-horse' })
    // The window the real sign-in send opened is marked as the sign-in's (Cycle 0153 ship pass 1 S14 added this: only the declared request's window was read before).
    const signInWindowIsMarked = harness.debug.requestWindowIsSignIn
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    options.peerCheckGate = peerCheck.promise
    options.onPeerCheckEntered = peerCheckEntered.resolve
    const [signInExchange] = harness.sender.exchanges
    signInExchange?.onSetCookie?.(['sid=s%3Aabc123def456; Path=/; HttpOnly'])
    signInExchange?.response.resolve(RESPONSE_200)
    await peerCheckEntered.promise
    // Act
    const windowWhileVerifying = harness.debug.requestWindowOpen
    peerCheck.resolve()
    await waitUntil(
      () => (harness.sender.bytesWritten === 2 ? true : undefined),
      'the declared request to be written',
      5_000,
    )
    // Assert
    assert.equal(signInWindowIsMarked, true)
    assert.equal(windowWhileVerifying, false)
    assert.equal(harness.debug.requestWindowOpen, true)
    assert.equal(harness.debug.requestWindowIsSignIn, false)
    assert.deepEqual(
      harness.order.filter((step) => step.startsWith('window:')),
      ['window:true', 'window:false', 'window:true'],
    )
  },
)

// Value: protects=a request is not written when the learner pauses the server while the sender is still verifying the connection's peer: the pause is classified as the learner's, Codebook never writes while one is held, and the chat reads LEARNER_PAUSED with the request taken back; fails_when=the last check before the first byte reads only the declared stops, so the POST goes out into a server the learner paused; seam=the harness's peer check held open while the fake debugger reports a learner pause; no_claim=how the editor shows the pause
test(
  'a Bun run writes no request byte and refuses with LEARNER_PAUSED when the learner pauses the server while the connection is being verified',
  { timeout: PEER_CHECK_TEST_TIMEOUT_MS },
  async () => {
    // Arrange
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    const harness = createHarness({
      launchLoader: BUN_LOADER,
      peerCheckGate: peerCheck.promise,
      onPeerCheckEntered: peerCheckEntered.resolve,
    })
    await harness.run.prepare()
    const outcome = harness.run.sendRequest('key-1').then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
    // The learner pauses only once the peer check is really open.
    await peerCheckEntered.promise
    // Act
    const pauseToken = harness.debug.learnerPause()
    peerCheck.resolve()
    const error = await outcome
    // Assert
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'LEARNER_PAUSED')
    assert.equal(harness.sender.bytesWritten, 0)
    assert.equal(harness.run.view().request, undefined)
    assert.equal(harness.run.view().state, 'learner-paused')
    // The learner continues: the run reads ready again, with no request left behind.
    harness.debug.nativeContinue(pauseToken)
    const settled = await until(harness, (view) => view.state === 'ready')
    assert.equal(settled.request, undefined)
    assert.equal(harness.order.includes('window:true'), false)
  },
)

// Value: protects=the sign-in request is not written when the learner pauses the server while the sign-in's connection is being verified, and the run reads no request in flight; fails_when=the sign-in sender's last check ignores a held pause and the password is posted into a paused server; seam=the harness's peer check held open for the sign-in while the fake debugger reports a learner pause; no_claim=the sign-in's server behaviour
test(
  'a Bun run with sign-in writes no sign-in byte and refuses with LEARNER_PAUSED when the learner pauses the server while the connection is being verified',
  { timeout: PEER_CHECK_TEST_TIMEOUT_MS },
  async () => {
    // Arrange
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    const harness = createHarness({
      launchLoader: BUN_LOADER,
      peerCheckGate: peerCheck.promise,
      onPeerCheckEntered: peerCheckEntered.resolve,
      signIn: {
        path: '/login',
        fields: { email: 'learner@example.test' },
        secretField: 'password',
        secret: 'ask-learner',
      },
    })
    await harness.run.prepare()
    const typedByLearner = { secret: 'hunter2-correct-horse' }
    const outcome = harness.run.sendRequest('key-1', typedByLearner).then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
    await peerCheckEntered.promise
    // Act
    const pauseToken = harness.debug.learnerPause()
    peerCheck.resolve()
    const error = await outcome
    // Assert
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'LEARNER_PAUSED')
    assert.equal(harness.sender.bytesWritten, 0)
    assert.equal(harness.run.view().state, 'learner-paused')
    // The learner continues: the run reads ready again, with no request left behind.
    harness.debug.nativeContinue(pauseToken)
    const settled = await until(harness, (view) => view.state === 'ready')
    assert.equal(settled.request, undefined)
    assert.equal(harness.order.includes('window:true'), false)
  },
)

// Value: protects=the declared request after a sign-in is not written when the learner pauses the server while its own connection is being verified, and the request ends with the learner-paused sentence; fails_when=only the sign-in is guarded and the declared POST goes out into a paused server; seam=the harness's peer check held open for the declared request only; no_claim=the sign-in's server behaviour
test(
  'a Bun run with sign-in writes no declared request byte when the learner pauses the server while its connection is being verified',
  { timeout: PEER_CHECK_TEST_TIMEOUT_MS },
  async () => {
    // Arrange
    const options: HarnessOptions = {
      launchLoader: BUN_LOADER,
      signIn: {
        path: '/login',
        fields: { email: 'learner@example.test' },
        secretField: 'password',
        secret: 'ask-learner',
      },
    }
    const harness = createHarness(options)
    await harness.run.prepare()
    await harness.run.sendRequest('key-1', { secret: 'hunter2-correct-horse' })
    // The declared request's peer check stays open until the learner pauses.
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    options.peerCheckGate = peerCheck.promise
    options.onPeerCheckEntered = peerCheckEntered.resolve
    const [signInExchange] = harness.sender.exchanges
    signInExchange?.onSetCookie?.(['sid=s%3Aabc123def456; Path=/; HttpOnly'])
    signInExchange?.response.resolve(RESPONSE_200)
    await peerCheckEntered.promise
    // Act
    harness.debug.learnerPause()
    peerCheck.resolve()
    // The run reads learner-paused while the pause is held; the request's failure is kept beside it.
    await until(harness, (view) => view.requestFailure !== undefined)
    // Assert
    const { requestFailure } = harness.run.view()
    assert.equal(harness.sender.bytesWritten, 1)
    assert.equal(requestFailure?.code, 'REQUEST_FAILED')
    assert.equal(
      requestFailure?.message,
      'The declared request was not sent because the learner held a pause of the server after the sign-in, which already ran; Codebook never resumes it. Let the learner continue the server in the debugger, then stop this run (codebook_stop) and start a new run.',
    )
  },
)
