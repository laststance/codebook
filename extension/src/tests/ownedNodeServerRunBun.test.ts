import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'

import { createHarness, sendRequest } from './utils/nodeServerRunHarness'

/** The Bun loader a `loader: "bun"` declaration resolves to, with a learner's Bun and the extension's bootstrap. */
const BUN_LOADER = {
  kind: 'bun',
  executable: '/Users/learner/.bun/bin/bun',
  version: '1.4.5',
  bootstrap: '/extension/dist/bunInspectorBootstrap.js',
} as const

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

// Value: protects=the declared request of a Bun run goes out only after the stops were armed; fails_when=the request window opens before armStops ran; seam=the harness's order journal and request sender; no_claim=network timing of a real server
test('a Bun server run sends the declared request only after its stops are armed', async () => {
  // Arrange
  const harness = createHarness({ launchLoader: BUN_LOADER })
  await harness.run.prepare()
  // Act
  await sendRequest(harness)
  // Assert
  assert.ok(
    harness.order.indexOf('armStops') < harness.order.indexOf('window:true'),
  )
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
