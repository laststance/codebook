import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  DevelopmentApp,
  DevelopmentServerAdapter,
  DevelopmentServerStart,
} from '../developmentServerAdapter'
import {
  startSavedSessionServer,
  type SavedSessionServerDependencies,
} from '../savedSessionServer'
import type { PortCheckOptions } from '../utils/assertDevelopmentPortFree'
import type { Ipv6LoopbackForwarder } from '../utils/startIpv6LoopbackForwarder'

import { defer } from './utils/defer'

/** What one stand-in setup server does differently from a start that succeeds at once. */
type StandInScenario = {
  /** The adapter's workspace check refuses with this error. */
  workspaceRefusal?: Error
  /** The port check refuses with this error, before any app exists. */
  portRefusal?: Error
  /** The adapter's start fails with this error after it handed over the app. */
  startFailureAfterApp?: Error
  /** The sign-in page answers only when the setup is closed, as a first compile that is still running does. */
  readinessWaitsForClose?: boolean
  /** The `[::1]` listener's start refuses with this error. */
  forwarderRefusal?: Error
  /** The `[::1]` listener's start is held until the test releases it. */
  forwarderHeld?: boolean
  /** The `[::1]` listener's close fails. */
  forwarderCloseFails?: boolean
}

/** Names a member of the app or the adapter that the setup server never calls, so a call to it fails the test loudly. */
const unusedBySetup = (member: string): Error =>
  new Error(`the saved-session setup server never calls ${member}`)

/**
 * Makes a stand-in adapter, app, port check and `[::1]` listener whose every step is written to one ordered list, so a test reads the start and the cleanup order of {@link startSavedSessionServer} at once.
 * @param scenario - Which step refuses, fails or waits.
 * @returns The ordered steps, the stand-ins to pass, what the start and the port check were given, and the holds a test waits on or releases.
 */
function setupServerStandIns(scenario: StandInScenario = {}) {
  const steps: string[] = []
  const startRequests: DevelopmentServerStart[] = []
  const portChecks: PortCheckOptions[] = []
  const readinessAsked = defer<void>()
  const forwarderAsked = defer<void>()
  const forwarderHold = defer<void>()
  const app: DevelopmentApp = {
    pid: undefined,
    isRunning: () => true,
    nextMessage: async () => {
      throw unusedBySetup('nextMessage')
    },
    send: () => {
      throw unusedBySetup('send')
    },
    outputTail: () => '',
    declarePort: () => {
      throw unusedBySetup('declarePort')
    },
    verifyInspector: async () => {
      throw unusedBySetup('verifyInspector')
    },
    inspectorEndpoint: async () => {
      throw unusedBySetup('inspectorEndpoint')
    },
    ready: async () => {
      throw unusedBySetup('ready')
    },
    readyEntry: async (signal: AbortSignal, entryPath: string) => {
      steps.push(`readyEntry ${entryPath}`)
      readinessAsked.resolve()
      // A first compile that has not finished answers only when the setup is closed.
      if (scenario.readinessWaitsForClose)
        await new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          }),
        )
      return { origin: 'http://127.0.0.1:3165', entry: { status: 200 } }
    },
    confirmAppEntry: async () => {
      throw unusedBySetup('confirmAppEntry')
    },
    close: async () => {
      steps.push('close app')
    },
  }
  const forwarder: Ipv6LoopbackForwarder = {
    close: async () => {
      steps.push('close forwarder')
      if (scenario.forwarderCloseFails)
        throw new Error('the [::1] listener could not be closed')
    },
  }
  const adapter: DevelopmentServerAdapter = {
    name: 'next-dev-webpack',
    assertWorkspace: async (workspace: string) => {
      steps.push(`assertWorkspace ${workspace}`)
      if (scenario.workspaceRefusal) throw scenario.workspaceRefusal
    },
    // Like the real Next adapter: the port check comes first, then the app exists and is handed over at once.
    start: async (request: DevelopmentServerStart) => {
      steps.push('start')
      startRequests.push(request)
      await request.assertPortFree({ port: 3165, source: 'next dev default' })
      request.onApp(app)
      if (scenario.startFailureAfterApp) throw scenario.startFailureAfterApp
      return { app, port: 3165 }
    },
    readOwnedLock: async () => {
      throw unusedBySetup('readOwnedLock')
    },
    waitForServerSettled: async () => {
      throw unusedBySetup('waitForServerSettled')
    },
    readBundle: async () => {
      throw unusedBySetup('readBundle')
    },
    browserDebugFields: () => {
      throw unusedBySetup('browserDebugFields')
    },
    isScriptOfModule: () => {
      throw unusedBySetup('isScriptOfModule')
    },
  }
  const dependencies: SavedSessionServerDependencies = {
    assertPortFree: async (declared, options = {}) => {
      steps.push(`assertPortFree ${declared.port}`)
      portChecks.push(options)
      if (scenario.portRefusal) throw scenario.portRefusal
    },
    startForwarder: async (port: number) => {
      steps.push(`startForwarder ${port}`)
      forwarderAsked.resolve()
      if (scenario.forwarderHeld) await forwarderHold.promise
      if (scenario.forwarderRefusal) throw scenario.forwarderRefusal
      return forwarder
    },
  }
  return {
    steps,
    adapter,
    dependencies,
    startRequests,
    portChecks,
    readinessAsked: readinessAsked.promise,
    forwarderAsked: forwarderAsked.promise,
    releaseForwarder: (): void => forwarderHold.resolve(),
  }
}

// protects=Step 7 coverage gap (the setup server's start order, ENG-10): the workspace check, the start with its port check, the sign-in page and only then the [::1] listener; fails_when=the listener starts before the sign-in page answered, the readiness asks another path than the setup's sign-in path, or the port check loses the setup's signal; no_claim=a real Next or Vite server, the real port check
test('a setup server checks the workspace, starts the app on its port, waits for the sign-in page and only then holds [::1]', async () => {
  // Arrange
  const standIns = setupServerStandIns()
  const setup = new AbortController()
  // Act
  await startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: setup.signal,
    },
    standIns.dependencies,
  )
  // Assert
  assert.deepEqual(standIns.steps, [
    'assertWorkspace /repo',
    'start',
    'assertPortFree 3165',
    'readyEntry /login',
    'startForwarder 3165',
  ])
  assert.equal(standIns.portChecks[0]?.signal, setup.signal)
})

// protects=the setup server records nothing and opens no run (its JSDoc contract); fails_when=the setup starts the server with the native server inspector, or with another workspace or Node than the setup's; no_claim=what the adapter does with them
test('a setup server starts the app in the setup workspace with the setup Node and without the server inspector', async () => {
  // Arrange
  const standIns = setupServerStandIns()
  // Act
  await startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: new AbortController().signal,
    },
    standIns.dependencies,
  )
  // Assert
  assert.equal(standIns.startRequests[0]?.workspace, '/repo')
  assert.equal(standIns.startRequests[0]?.node, '/usr/local/bin/node')
  assert.equal(standIns.startRequests[0]?.inspectServer, false)
})

// protects=the returned origin/port contract (the learner signs in on localhost at the project's own port, where the app's auth origin points); fails_when=the browser is sent to 127.0.0.1 or to another port than the one the app started on; no_claim=port 80 (browserOriginOf's own tests)
test('a started setup server opens the sign-in page on localhost at the port the app started on', async () => {
  // Arrange
  const standIns = setupServerStandIns()
  // Act
  const server = await startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: new AbortController().signal,
    },
    standIns.dependencies,
  )
  // Assert
  assert.equal(server.origin, 'http://localhost:3165')
  assert.equal(server.port, 3165)
})

// protects=the returned close contract (the setup's finally stops what the start started); fails_when=close leaves the app or the [::1] listener running, or closes the app while the listener still forwards to it; no_claim=a real process group
test('closing a started setup server frees [::1] first and then stops the app', async () => {
  // Arrange
  const standIns = setupServerStandIns()
  const server = await startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: new AbortController().signal,
    },
    standIns.dependencies,
  )
  // Act
  await server.close()
  // Assert
  assert.deepEqual(standIns.steps.slice(-2), ['close forwarder', 'close app'])
})

// protects=the returned close contract when the [::1] listener fails to close; fails_when=a failed listener close leaves the app server running, or the failure is hidden from the setup; no_claim=which close error wins when both fail
test('closing a started setup server still stops the app when [::1] cannot be freed, and reports that failure', async () => {
  // Arrange
  const standIns = setupServerStandIns({ forwarderCloseFails: true })
  const server = await startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: new AbortController().signal,
    },
    standIns.dependencies,
  )
  // Act
  const closing = server.close()
  // Assert
  await assert.rejects(closing, /the \[::1\] listener could not be closed/)
  assert.deepEqual(standIns.steps.slice(-2), ['close forwarder', 'close app'])
})

// protects=cleanup on a refused workspace (nothing started, nothing to stop); fails_when=the app is started for a workspace the adapter refused, or the refusal is replaced; no_claim=the adapter's refusal wording
test('a workspace the adapter refuses starts no app and keeps the refusal', async () => {
  // Arrange
  const standIns = setupServerStandIns({
    workspaceRefusal: new Error('Next is not installed in this workspace'),
  })
  // Act
  const starting = startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: new AbortController().signal,
    },
    standIns.dependencies,
  )
  // Assert
  await assert.rejects(starting, /Next is not installed in this workspace/)
  assert.deepEqual(standIns.steps, ['assertWorkspace /repo'])
})

// protects=cleanup on a refused port (the app never existed); fails_when=a close is sent to an app that was never started, or the port refusal is replaced; no_claim=the real port check's wording
test('a busy project port starts no app and keeps the port refusal', async () => {
  // Arrange
  const standIns = setupServerStandIns({
    portRefusal: new Error('Port 3165 is in use on this machine'),
  })
  // Act
  const starting = startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: new AbortController().signal,
    },
    standIns.dependencies,
  )
  // Assert
  await assert.rejects(starting, /Port 3165 is in use on this machine/)
  assert.deepEqual(standIns.steps, [
    'assertWorkspace /repo',
    'start',
    'assertPortFree 3165',
  ])
})

// protects=cleanup on failure (CEO-R2: the setup server stops on every exit path); fails_when=an app the adapter handed over before its start failed keeps running; no_claim=a real process exit
test('a start that fails after the app process exists stops that app and keeps the failure', async () => {
  // Arrange
  const standIns = setupServerStandIns({
    startFailureAfterApp: new Error('Application exited: 1'),
  })
  // Act
  const starting = startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: new AbortController().signal,
    },
    standIns.dependencies,
  )
  // Assert
  await assert.rejects(starting, /Application exited: 1/)
  assert.deepEqual(standIns.steps, [
    'assertWorkspace /repo',
    'start',
    'assertPortFree 3165',
    'close app',
  ])
})

// protects=cleanup on failure of the [::1] listener (ENG-10); fails_when=the app keeps running after [::1] was refused, a close is sent to a listener that never started, or the refusal is replaced; no_claim=the real listener's PREREQUISITE_MISSING wording
test('a setup server whose [::1] listener is refused stops the app and keeps the refusal', async () => {
  // Arrange
  const standIns = setupServerStandIns({
    forwarderRefusal: new Error('Port 3165 is in use on this machine at [::1]'),
  })
  // Act
  const starting = startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: new AbortController().signal,
    },
    standIns.dependencies,
  )
  // Assert
  await assert.rejects(
    starting,
    /Port 3165 is in use on this machine at \[::1\]/,
  )
  assert.deepEqual(standIns.steps.slice(-2), [
    'startForwarder 3165',
    'close app',
  ])
})

// protects=cleanup on abort while the sign-in page compiles (Close setup while the app is still starting); fails_when=the app keeps running after Close setup, or [::1] is still taken for a closed setup; no_claim=how long a real compile takes
test('a setup closed while the sign-in page still compiles stops the app and never holds [::1]', async () => {
  // Arrange
  const standIns = setupServerStandIns({ readinessWaitsForClose: true })
  const setup = new AbortController()
  const starting = startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: setup.signal,
    },
    standIns.dependencies,
  )
  await standIns.readinessAsked
  // Act
  setup.abort()
  // Assert
  await assert.rejects(starting, { name: 'AbortError' })
  assert.deepEqual(standIns.steps, [
    'assertWorkspace /repo',
    'start',
    'assertPortFree 3165',
    'readyEntry /login',
    'close app',
  ])
})

// protects=cleanup on abort while [::1] is taken (the abort check after the listener's start); fails_when=a setup closed during the listener's start returns a server, or leaves the listener or the app running, or stops the app while the listener still forwards to it; no_claim=a real listen
test('a setup closed while [::1] is being taken frees [::1] and then stops the app', async () => {
  // Arrange
  const standIns = setupServerStandIns({ forwarderHeld: true })
  const setup = new AbortController()
  const starting = startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: setup.signal,
    },
    standIns.dependencies,
  )
  await standIns.forwarderAsked
  // Act
  setup.abort()
  standIns.releaseForwarder()
  // Assert
  await assert.rejects(starting, { name: 'AbortError' })
  assert.deepEqual(standIns.steps.slice(-3), [
    'startForwarder 3165',
    'close forwarder',
    'close app',
  ])
})

// protects=cleanup on abort when [::1] cannot be freed; fails_when=a failed listener close leaves the app running, or replaces the close of the setup as the start's outcome; no_claim=which close error is logged
test('a setup closed while [::1] is being taken still stops the app when [::1] cannot be freed, and ends as closed', async () => {
  // Arrange
  const standIns = setupServerStandIns({
    forwarderHeld: true,
    forwarderCloseFails: true,
  })
  const setup = new AbortController()
  const starting = startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: setup.signal,
    },
    standIns.dependencies,
  )
  await standIns.forwarderAsked
  // Act
  setup.abort()
  standIns.releaseForwarder()
  // Assert
  await assert.rejects(starting, { name: 'AbortError' })
  assert.deepEqual(standIns.steps.slice(-2), ['close forwarder', 'close app'])
})
