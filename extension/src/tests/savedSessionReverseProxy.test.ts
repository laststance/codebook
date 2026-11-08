import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type {
  DevelopmentApp,
  DevelopmentServerAdapter,
  DevelopmentServerStart,
} from '../developmentServerAdapter'
import { StudyError } from '../errors'
import type { ReverseProxyDeclaration } from '../reverseProxyDeclarationSchema'
import type { ReverseProxyFailure } from '../reverseProxyGate'
import type { ReverseProxyRefusalFacts } from '../reverseProxyRefusals'
import type { SavedSessionServer } from '../runtimeSupport/savedSessionTypes'
import type * as SavedSessionCommands from '../savedSessionCommands'
import type * as SavedSessionServerModule from '../savedSessionServer'
import type {
  SavedSessionServerDependencies,
  SetupReverseProxyGate,
} from '../savedSessionServer'
import {
  SavedSessionSetup,
  type SavedSessionSetupInput,
} from '../savedSessionSetup'
import { assertSavedSessionOrigin } from '../utils/assertSavedSessionOrigin'
import { signInRequiredMessage } from '../utils/signInRequiredMessage'
import { signInRequiredNotice } from '../utils/signInRequiredNotice'

import { createManualClock } from './utils/createManualClock'
import { defer } from './utils/defer'
import { loadModule } from './utils/loadModule'

const COMMANDS_MODULE = join(__dirname, '..', 'savedSessionCommands.js')
const SERVER_MODULE = join(__dirname, '..', 'savedSessionServer.js')
const ORIGIN = 'https://app.example.test'
const OTHER_ORIGIN = 'https://other.example.test'
const DECLARATION: ReverseProxyDeclaration = {
  origin: ORIGIN,
  upstreamPort: 4310,
}
const OTHER_DECLARATION: ReverseProxyDeclaration = {
  origin: OTHER_ORIGIN,
  upstreamPort: 4311,
}
const SET_UP = 'Set Up Saved Session…'
const NOTICE_TEXT = `This run opens the app at ${ORIGIN} and needs your saved sign-in there. Set up the saved session at that address?`
const PIN = '--host-resolver-rules=MAP app.example.test 127.0.0.1'

const settle = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve))

/** Waits, a turn at a time, until a condition holds; the setup reads the sign-in routes from disk before it starts, so a fixed number of turns would guess. */
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 500 && !condition(); turn += 1) await settle()
}

/** Makes a stand-in for the refusal builder so the tests read how the setup server calls it; the real wording is lane D's. */
const refusalStandIn = (reason: string, facts: ReverseProxyRefusalFacts) =>
  new StudyError(
    'REVERSE_PROXY_REFUSED',
    `refused ${reason}`,
    undefined,
    undefined,
    undefined,
    { reason, resourcesReleased: facts.resourcesReleased },
  )

/** One stand-in gate whose every step is written to a shared ordered list. */
function gateStandIn(
  steps: string[],
  scenario: {
    resolveFailure?: ReverseProxyFailure
    proveFailure?: ReverseProxyFailure
    admitsAtTheEnd?: boolean
  } = {},
): SetupReverseProxyGate {
  return {
    resolve: async () => {
      steps.push('gate.resolve')
      return scenario.resolveFailure
    },
    preparePreload: async () => {
      steps.push('gate.preparePreload')
      return {
        upstreamPort: 4310,
        identity: { preloadPath: '/private/preload.js', secret: 'run-secret' },
      }
    },
    prove: async () => {
      steps.push('gate.prove')
      return scenario.proveFailure
    },
    hostResolverRules: () => PIN,
    admits: (origin) => {
      steps.push(`gate.admits ${origin}`)
      return scenario.admitsAtTheEnd ?? true
    },
    dispose: async (): Promise<void> => {
      steps.push('gate.dispose')
    },
  }
}

/** Failure facts of the gate as the setup server receives them. */
const failureOf = (
  reason: 'not-resolved' | 'proof-timeout',
): ReverseProxyFailure => ({
  reason,
  facts: {
    origin: ORIGIN,
    upstreamPort: 4310,
    resourcesReleased: true,
  },
})

/** A stand-in adapter and app for a setup server at the declared port; every step lands in `steps`. */
function serverStandIns(options: { appCloseFails?: boolean } = {}) {
  const steps: string[] = []
  const startRequests: DevelopmentServerStart[] = []
  const readyEntryCalls: (string | undefined)[][] = []
  const app = {
    pid: 4242,
    isRunning: () => true,
    listening: async () => undefined,
    readyEntry: async (
      _signal: AbortSignal,
      entryPath: string,
      _signInPaths?: readonly string[],
      _observer?: unknown,
      declaredOrigin?: string,
    ) => {
      steps.push(`readyEntry ${entryPath}`)
      readyEntryCalls.push([entryPath, declaredOrigin])
      return { origin: 'http://127.0.0.1:4310', entry: { status: 200 } }
    },
    close: async () => {
      steps.push('close app')
      if (options.appCloseFails) throw new Error('the server did not stop')
    },
  } as unknown as DevelopmentApp
  const adapter = {
    name: 'next-dev-webpack',
    assertWorkspace: async () => {
      steps.push('assertWorkspace')
    },
    start: async (request: DevelopmentServerStart) => {
      steps.push('start')
      startRequests.push(request)
      request.onApp(app)
      return { app, port: 4310 }
    },
  } as unknown as DevelopmentServerAdapter
  const forwarder = {
    close: async (): Promise<void> => {
      steps.push('close forwarder')
    },
  }
  const dependencies = (
    gate: SetupReverseProxyGate,
  ): SavedSessionServerDependencies => ({
    assertPortFree: async (): Promise<void> => {
      steps.push('assertPortFree')
    },
    startForwarder: async (port) => {
      steps.push(`startForwarder ${port}`)
      return forwarder
    },
    createGate: () => gate,
  })
  return { steps, startRequests, readyEntryCalls, adapter, dependencies }
}

/** Loads the setup server module with the refusal builder replaced by {@link refusalStandIn}. */
const loadServerModule = () =>
  loadModule<typeof SavedSessionServerModule>(
    SERVER_MODULE,
    { './reverseProxyRefusals': { reverseProxyRefusal: refusalStandIn } },
    // The loaded module runs in its own context, which has no `URL` of its own.
    { URL },
  )

const REQUEST = {
  workspace: '/repo',
  node: '/usr/local/bin/node',
  signInPath: '/login',
  reverseProxy: { declaration: DECLARATION, chromeBinary: '/chrome' },
}

// Value: protects=the setup at a declared origin resolves, proves and only then asks the app for its sign-in page; fails_when=the readiness request is sent before the proof, the preload facts miss the start, or the sign-in path is asked without the declared origin; no_claim=a real gate, a real Next server or a real proxy
test('a setup at a declared origin resolves, starts on the declared port, proves the origin and only then asks the sign-in page', async () => {
  // Arrange
  const standIns = serverStandIns()
  const gate = gateStandIn(standIns.steps)
  const { startSavedSessionServer } = await loadServerModule()
  // Act
  const server = await startSavedSessionServer(
    standIns.adapter,
    { ...REQUEST, signal: new AbortController().signal },
    standIns.dependencies(gate),
  )
  // Assert
  assert.deepEqual(standIns.steps, [
    'gate.resolve',
    'gate.preparePreload',
    'assertWorkspace',
    'start',
    'gate.prove',
    'readyEntry /login',
    'startForwarder 4310',
    `gate.admits ${ORIGIN}`,
  ])
  assert.deepEqual(standIns.startRequests[0]?.reverseProxy, {
    upstreamPort: 4310,
    identity: { preloadPath: '/private/preload.js', secret: 'run-secret' },
  })
  assert.deepEqual(standIns.readyEntryCalls, [['/login', ORIGIN]])
  assert.equal(server.origin, ORIGIN)
  assert.equal(server.port, 4310)
})

// Value: protects=the setup browser is pinned to the checked address and reads the declared host's cookies; fails_when=the server hands back localhost, loses the pin switch or the cookie host; no_claim=Chrome honoring the switch
test('a setup at a declared origin hands the setup browser the declared origin, the pin switch and the declared cookie host', async () => {
  // Arrange
  const standIns = serverStandIns()
  const { startSavedSessionServer } = await loadServerModule()
  // Act
  const server = await startSavedSessionServer(
    standIns.adapter,
    { ...REQUEST, signal: new AbortController().signal },
    standIns.dependencies(gateStandIn(standIns.steps)),
  )
  // Assert
  assert.equal(server.hostResolverRules, PIN)
  assert.equal(server.cookieHost, 'app.example.test')
})

// Value: protects=a setup at localhost keeps its cookie host and pins nothing; fails_when=a setup without a declaration gets a pin switch or another cookie host; no_claim=the declared-origin path
test('a setup without a declaration opens localhost with no pin switch and the localhost cookie host', async () => {
  // Arrange
  const standIns = serverStandIns()
  const { startSavedSessionServer } = await loadServerModule()
  // Act
  const server = await startSavedSessionServer(
    standIns.adapter,
    {
      workspace: '/repo',
      node: '/usr/local/bin/node',
      signInPath: '/login',
      signal: new AbortController().signal,
    },
    {
      ...standIns.dependencies(gateStandIn(standIns.steps)),
      createGate: () => {
        throw new Error('a setup at localhost must not build a gate')
      },
    },
  )
  // Assert
  assert.equal(server.origin, 'http://localhost:4310')
  assert.equal(server.hostResolverRules, undefined)
  assert.equal(server.cookieHost, 'localhost')
})

// Value: protects=a host that does not resolve to a loopback address starts nothing; fails_when=the server starts, a port is checked or a request is sent after the gate refused the resolution; no_claim=the wording of the refusal (lane D)
test('a setup refused at the resolution starts no server and reports that nothing is left running', async () => {
  // Arrange
  const standIns = serverStandIns()
  const gate = gateStandIn(standIns.steps, {
    resolveFailure: failureOf('not-resolved'),
  })
  const { startSavedSessionServer } = await loadServerModule()
  // Act
  const refusal = await startSavedSessionServer(
    standIns.adapter,
    { ...REQUEST, signal: new AbortController().signal },
    standIns.dependencies(gate),
  ).catch((error: unknown) => error)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'REVERSE_PROXY_REFUSED')
  assert.deepEqual(refusal.details, {
    reason: 'not-resolved',
    resourcesReleased: true,
  })
  assert.deepEqual(standIns.steps, ['gate.resolve', 'gate.dispose'])
})

// Value: protects=a proof that fails closes the server it started before the refusal says so; fails_when=the server or the gate keeps running after the refusal, or the readiness request is sent without a proof; no_claim=the proof transport
test('a setup refused at the proof closes the server and the gate, and never asks the sign-in page', async () => {
  // Arrange
  const standIns = serverStandIns()
  const gate = gateStandIn(standIns.steps, {
    proveFailure: failureOf('proof-timeout'),
  })
  const { startSavedSessionServer } = await loadServerModule()
  // Act
  const refusal = await startSavedSessionServer(
    standIns.adapter,
    { ...REQUEST, signal: new AbortController().signal },
    standIns.dependencies(gate),
  ).catch((error: unknown) => error)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.details?.reason, 'proof-timeout')
  assert.equal(refusal.details?.resourcesReleased, true)
  assert.deepEqual(standIns.steps, [
    'gate.resolve',
    'gate.preparePreload',
    'assertWorkspace',
    'start',
    'gate.prove',
    'close app',
    'gate.dispose',
  ])
})

// Value: protects=the refusal tells the truth about cleanup; fails_when=resourcesReleased is true after the server's stop failed; no_claim=which process the failed stop left behind
test('a setup refused at the proof reports resourcesReleased false when the server did not stop', async () => {
  // Arrange
  const standIns = serverStandIns({ appCloseFails: true })
  const gate = gateStandIn(standIns.steps, {
    proveFailure: failureOf('proof-timeout'),
  })
  const { startSavedSessionServer } = await loadServerModule()
  // Act
  const refusal = await startSavedSessionServer(
    standIns.adapter,
    { ...REQUEST, signal: new AbortController().signal },
    standIns.dependencies(gate),
  ).catch((error: unknown) => error)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.details?.resourcesReleased, false)
  assert.equal(standIns.steps.filter((step) => step === 'close app').length, 1)
})

// Value: protects=the setup never opens its browser at an origin whose proof ended (the answering server process exited while the CLI lives); fails_when=the setup returns a server although the gate no longer admits the origin, or leaves the forwarder or server running; no_claim=the gate's own process checks
test('a setup whose proof no longer admits the origin refuses with origin-not-proven and closes everything it started', async () => {
  // Arrange
  const standIns = serverStandIns()
  const gate = gateStandIn(standIns.steps, { admitsAtTheEnd: false })
  const { startSavedSessionServer } = await loadServerModule()
  // Act
  const refusal = await startSavedSessionServer(
    standIns.adapter,
    { ...REQUEST, signal: new AbortController().signal },
    standIns.dependencies(gate),
  ).catch((error: unknown) => error)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'SIGN_IN_ORIGIN_REFUSED')
  assert.equal(refusal.details?.reason, 'origin-not-proven')
  assert.deepEqual(standIns.steps.slice(-4), [
    `gate.admits ${ORIGIN}`,
    'close forwarder',
    'close app',
    'gate.dispose',
  ])
})

// Value: protects=the returned server closes the forwarder, the app and the gate once; fails_when=a close skips the gate, runs twice or runs in another order; no_claim=what the browser does at close
test('closing a setup server at a declared origin stops the forwarder, the app and the gate once, in that order', async () => {
  // Arrange
  const standIns = serverStandIns()
  const { startSavedSessionServer } = await loadServerModule()
  const server: SavedSessionServer = await startSavedSessionServer(
    standIns.adapter,
    { ...REQUEST, signal: new AbortController().signal },
    standIns.dependencies(gateStandIn(standIns.steps)),
  )
  // Act
  await server.close()
  await server.close()
  // Assert
  assert.deepEqual(standIns.steps.slice(-3), [
    'close forwarder',
    'close app',
    'gate.dispose',
  ])
})

// Value: protects=the saved-session origin rule for a declared origin; fails_when=a proven origin is refused, an unproven one is admitted, a non-loopback owned origin is admitted, or a run without a declaration changes; no_claim=the gate's liveness checks
test('assertSavedSessionOrigin admits a proven declared origin, refuses an unproven one and keeps the loopback rule without a declaration', () => {
  // Arrange
  const proven = { origin: ORIGIN, admits: () => true }
  const unproven = { origin: ORIGIN, admits: () => false }
  // Act
  const provenResult = (): void =>
    assertSavedSessionOrigin('http://127.0.0.1:4310', proven)
  const unprovenResult = (): void =>
    assertSavedSessionOrigin('http://127.0.0.1:4310', unproven)
  const foreignOwned = (): void =>
    assertSavedSessionOrigin('http://192.0.2.10:4310', proven)
  const withoutDeclaration = (): void =>
    assertSavedSessionOrigin('http://127.0.0.1:3000')
  // Assert
  assert.doesNotThrow(provenResult)
  assert.throws(unprovenResult, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'SIGN_IN_ORIGIN_REFUSED')
    assert.equal(error.details?.reason, 'origin-not-proven')
    assert.equal(error.details?.sideEffects, 'none')
    return true
  })
  assert.throws(foreignOwned, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.details?.reason, 'origin-not-loopback')
    return true
  })
  assert.doesNotThrow(withoutDeclaration)
})

// Value: protects=the learner reads which address the notice sets up; fails_when=the notice for a declared origin omits the origin or keeps the localhost sentence, or the status tooltip loses its reason sentence; no_claim=the editor's notification rendering
test('the notice of a run at a declared origin names that origin, and the plain notice is unchanged', () => {
  // Arrange
  const reason = 'redirected-to-sign-in'
  // Act
  const declared = signInRequiredNotice(reason, 'shop', ORIGIN)
  const plain = signInRequiredNotice(reason, 'shop')
  // Assert
  assert.equal(declared, NOTICE_TEXT)
  assert.equal(
    plain,
    'The saved session for shop may have expired. Set it up again.',
  )
})

// Value: protects=a session-cookie-only app at a declared origin is not invited to a setup the next run refuses again; fails_when=the notice for that reason drops the origin or the keep-me-signed-in condition; no_claim=the editor's notification rendering
test('the notice of a session-cookie-only run at a declared origin keeps the origin and the keep-me-signed-in condition', () => {
  // Arrange
  const reason = 'session-cookie-only'
  // Act
  const declared = signInRequiredNotice(reason, 'shop', ORIGIN)
  // Assert
  assert.equal(
    declared,
    'This run opens the app at https://app.example.test, but the app keeps your sign-in only while the browser stays open. Set up the saved session at that address only if the sign-in page offers a keep-me-signed-in choice, and select it.',
  )
})

// Value: protects=the chat repeats the setup step as a whole, not after a parenthesis; fails_when=again trails the palette parenthesis again or a run without a declaration changes its sentence; no_claim=the other reasons' wording
test('the sign-in message for an expired session at a declared origin puts again with the step it repeats', () => {
  // Arrange
  const facts = { repositoryName: 'shop' }
  // Act
  const declared = signInRequiredMessage('redirected-to-sign-in', {
    ...facts,
    declaredOrigin: ORIGIN,
  })
  const plain = signInRequiredMessage('redirected-to-sign-in', facts)
  // Assert
  assert.equal(
    declared,
    `The page landed on a sign-in page although the run used the saved session of shop, so the saved session may have expired. The run stopped before it sent anything. Ask the learner to press Set Up Saved Session… again in the editor's notice for this run, which sets it up at ${ORIGIN} (the command palette entry opens localhost, where it would not apply), then start one new run.`,
  )
  assert.equal(
    plain,
    'The page landed on a sign-in page although the run used the saved session of shop, so the saved session may have expired. The run stopped before it sent anything. Ask the learner to run Codebook: Set Up Saved Session… again, then start one new run.',
  )
})

// Value: protects=the chat is never sent to the palette entry for a run at a declared origin; fails_when=the run's message for such a run still says to run the palette command, or a run without a declaration changes its message; no_claim=the run's own wording of other facts
test('the sign-in message of a run at a declared origin sends the learner to the notice button, not the palette', () => {
  // Arrange
  const facts = { repositoryName: 'shop' }
  // Act
  const declared = signInRequiredMessage('no-saved-session', {
    ...facts,
    declaredOrigin: ORIGIN,
  })
  const plain = signInRequiredMessage('no-saved-session', facts)
  // Assert
  assert.equal(
    declared,
    `The page landed on a sign-in page and shop has no saved session, so the run stopped before it sent anything. Ask the learner to press Set Up Saved Session… in the editor's notice for this run, which sets it up at ${ORIGIN} (the command palette entry opens localhost, where it would not apply), then start one new run.`,
  )
  assert.equal(
    plain,
    'The page landed on a sign-in page and shop has no saved session, so the run stopped before it sent anything. Ask the learner to run Codebook: Set Up Saved Session…, then start one new run.',
  )
})

/** Everything the setup at a declared origin acts through, with the setup's start requests recorded. */
function setupHarness() {
  const logs: string[] = []
  const notices: { severity: string; message: string }[] = []
  const launches: { url: string; hostResolverRules?: string }[] = []
  const cookieHosts: string[] = []
  const records: unknown[] = []
  const clock = createManualClock()
  const offers: ((choice: 'Done' | 'Close setup' | undefined) => void)[] = []
  const setup = new SavedSessionSetup({
    store: {
      acquireForSetup: async () => ({
        profile: '/store/sign-in-profiles/abc123',
        recordBrowser: async () => undefined,
        writeRecord: async (fields): Promise<void> => {
          records.push(fields)
        },
        release: async (): Promise<void> => undefined,
      }),
    },
    startServer: async (_adapter, _path, _signal, reverseProxy) => {
      if (reverseProxy === undefined) throw new Error('no declaration')
      return {
        origin: reverseProxy.origin,
        port: reverseProxy.upstreamPort,
        hostResolverRules: PIN,
        cookieHost: 'app.example.test',
        close: async (): Promise<void> => undefined,
      }
    },
    launchBrowser: async (launchOptions) => {
      launches.push({
        url: launchOptions.url,
        hostResolverRules: launchOptions.hostResolverRules,
      })
      return {
        chromeVersion: 'Chrome/154.0.1.2',
        onClosedByLearner: () => () => undefined,
        readAppCookieKind: async (host: string) => {
          cookieHosts.push(host)
          return 'persistent'
        },
        close: async () => 'graceful',
      }
    },
    ui: {
      showStatus: () => undefined,
      offerDoneOrClose: () =>
        new Promise((resolve) => {
          offers.push(resolve)
        }),
      warnClosingSoon: () => new Promise(() => undefined),
      notify: async (severity, message) => {
        notices.push({ severity, message })
        return undefined
      },
      log: (level, line) => logs.push(`${level}: ${line}`),
      showLog: () => undefined,
    },
    clock: {
      now: () => Date.parse('2026-11-02T12:10:00.000Z') + clock.now(),
      setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
      clearTimeout: (handle) => clock.clearTimeout(Number(handle)),
    },
  })
  return { setup, logs, notices, launches, cookieHosts, records }
}

const SETUP_INPUT: SavedSessionSetupInput = {
  repositoryRoot: '/work/shop',
  repositoryName: 'shop',
  adapter: 'next-dev-webpack',
  signInPath: '/login',
  knownSignInPaths: [],
  chromeExecutable: '/chrome',
  reverseProxy: DECLARATION,
}

// Value: protects=the setup browser opens at the declared origin pinned to the checked address, and Done reads the declared host's cookies; fails_when=the browser opens at localhost, loses the pin switch, or Done reads the cookie kind of localhost so a session-cookie app behind the proxy is recorded as none; no_claim=Chrome's own cookie store
test('a setup at a declared origin opens the browser pinned at that origin and reads the cookie kind of the declared host on Done', async () => {
  // Arrange
  const harness = setupHarness()
  await harness.setup.start(SETUP_INPUT)
  // Act
  await harness.setup.done()
  // Assert
  assert.deepEqual(harness.launches, [
    { url: `${ORIGIN}/login`, hostResolverRules: PIN },
  ])
  assert.deepEqual(harness.cookieHosts, ['app.example.test'])
})

// Value: protects=a refused declared setup is shown with its Fix line and its reason in the log; fails_when=the editor error loses the refusal's message or the Output line loses reason=; no_claim=the wording of any one reason (lane D)
test('a setup refused by the reverse proxy shows the whole refusal message and logs its reason', async () => {
  // Arrange
  const message =
    'Codebook did not trust the reverse proxy this run declared. Fix: start your proxy.'
  const refusal = new StudyError(
    'REVERSE_PROXY_REFUSED',
    message,
    undefined,
    undefined,
    undefined,
    { reason: 'proof-unreachable' },
  )
  const notices: { severity: string; message: string }[] = []
  const logs: string[] = []
  const clock = createManualClock()
  const setup = new SavedSessionSetup({
    store: {
      acquireForSetup: async () => ({
        profile: '/store/sign-in-profiles/abc123',
        recordBrowser: async () => undefined,
        writeRecord: async (): Promise<void> => undefined,
        release: async (): Promise<void> => undefined,
      }),
    },
    startServer: async () => {
      throw refusal
    },
    launchBrowser: async () => {
      throw new Error('the browser must not open')
    },
    ui: {
      showStatus: () => undefined,
      offerDoneOrClose: () => new Promise(() => undefined),
      warnClosingSoon: () => new Promise(() => undefined),
      notify: async (severity, text) => {
        notices.push({ severity, message: text })
        return undefined
      },
      log: (level, line) => logs.push(`${level}: ${line}`),
      showLog: () => undefined,
    },
    clock: {
      now: () => 0,
      setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
      clearTimeout: (handle) => clock.clearTimeout(Number(handle)),
    },
  })
  // Act
  await setup.start(SETUP_INPUT)
  // Assert
  assert.deepEqual(notices, [{ severity: 'error', message }])
  assert.ok(
    logs.includes(
      `error: Saved session setup: could not start for shop: ${message} reason=proof-unreachable`,
    ),
  )
})

type StartRequest = {
  adapter: string
  signInPath: string
  reverseProxy: ReverseProxyDeclaration | undefined
}

/**
 * Loads the commands with an environment whose setup server records the declaration it was asked for and then refuses to start, so a setup ends at once and leaves no timer.
 * The notice's answers are scripted by `answer`, and the status item's menu picks the Set Up entry.
 */
async function loadCommands(
  answer: (message: string) => string | undefined | Promise<string | undefined>,
  holdStart?: Promise<never>,
) {
  const startRequests: StartRequest[] = []
  const notices: { severity: string; message: string; actions: string[] }[] = []
  const handlers = new Map<
    string,
    (...commandArguments: unknown[]) => unknown
  >()
  const item = {
    name: '',
    text: '',
    tooltip: '',
    command: undefined as string | undefined,
    show(): void {},
    hide(): void {},
    dispose(): void {},
  }
  const stored = {
    view: {
      available: true,
      state: 'saved' as const,
      setupAt: '2026-11-02T12:10:00.000Z',
      repositoryName: 'shop',
      setupOpenHere: false,
    },
  }
  let storeChanged: (hash: string) => void = () => undefined
  let windowStateChanged: (state: { focused: boolean }) => void = () =>
    undefined
  const module = await loadModule<typeof SavedSessionCommands>(
    COMMANDS_MODULE,
    {},
  )
  const environment = {
    savedSessionSetupInputs: async () => ({
      ready: true,
      node: '/node',
      chrome: { binary: '/chrome', version: 'Chrome/154.0.1.2' },
      adapters: {
        'next-dev-webpack': { ready: true, missing: [] },
        'vite-dev': { ready: false, missing: ['no vite'] },
        'react-scripts-dev': { ready: false, missing: ['no react-scripts'] },
        'expo-web-dev': { ready: false, missing: ['no expo'] },
      },
    }),
    startSavedSessionServer: async (
      adapter: string,
      signInPath: string,
      _signal: AbortSignal,
      reverseProxy?: ReverseProxyDeclaration,
    ) => {
      startRequests.push({ adapter, signInPath, reverseProxy })
      // A held start keeps the setup open, so a second notice meets an active setup.
      if (holdStart) return holdStart
      throw new Error('stop after recording')
    },
  }
  const installed = module.installSavedSessions({
    editor: {
      StatusBarAlignment: { Right: 2 },
      window: {
        createStatusBarItem: () => item,
        onDidChangeWindowState: (listener) => {
          windowStateChanged = listener
          return { dispose(): void {} }
        },
        showQuickPick: async (items: readonly unknown[]) =>
          (items.includes(SET_UP) ? SET_UP : '/login') as never,
        showInputBox: async () => undefined,
        showWarningMessage: async () => undefined,
      },
      commands: {
        executeCommand: async (
          command: string,
          ...commandArguments: unknown[]
        ) => handlers.get(command)?.(...commandArguments),
      },
    },
    store: {
      describeForUi: async () => stored.view,
      list: async () => [],
      remove: async () => ({ outcome: 'removed' }),
      whenReleased: async () => undefined,
      lastSignInPaths: async () => ['/login'],
      onDidChange: (listener) => {
        storeChanged = listener
        return () => undefined
      },
      describe: async () => ({ available: true, state: 'saved' }),
      acquireForRun: async () => {
        throw new Error('not used')
      },
      acquireForSetup: async () => ({
        profile: '/store/sign-in-profiles/abc123',
        recordBrowser: async () => undefined,
        writeRecord: async (): Promise<void> => undefined,
        release: async (): Promise<void> => undefined,
      }),
      rememberSignInPaths: async () => undefined,
    },
    register: (command, handler) => {
      handlers.set(command, handler)
      return { dispose(): void {} }
    },
    showNotice: async (severity, message, ...actions) => {
      notices.push({ severity, message, actions })
      return answer(message) as never
    },
    output: undefined,
    ensureEnvironment: async () => environment as never,
    stopRun: async () => undefined,
    workspaceRoot: () => '/work/shop',
  })
  return {
    installed,
    startRequests,
    notices,
    handlers,
    stored,
    emitStoreChange: (hash: string): void => storeChanged(hash),
    focusWindow: (): void => windowStateChanged({ focused: true }),
  }
}

/** Presses the button of every notice that names a declared origin. */
const pressesDeclaredNotices = (message: string): string | undefined =>
  message.startsWith('This run opens the app at') ? SET_UP : undefined

// Value: protects=the notice of a run at a declared origin names it and its button sets up there; fails_when=the notice keeps the localhost text, or the button starts a setup without the declaration; no_claim=the setup's own start (setup tests)
test('the notice of a run at a declared origin names the origin and its button starts the setup for that declaration', async () => {
  // Arrange
  const { installed, notices, startRequests } = await loadCommands(
    pressesDeclaredNotices,
  )
  // Act
  installed.showSignInRequired('no-saved-session', DECLARATION)
  await waitUntil(() => startRequests.length > 0)
  // Assert
  assert.equal(notices[0]?.message, NOTICE_TEXT)
  assert.deepEqual(notices[0]?.actions, [SET_UP])
  assert.deepEqual(startRequests, [
    {
      adapter: 'next-dev-webpack',
      signInPath: '/login',
      reverseProxy: DECLARATION,
    },
  ])
})

// Value: protects=a notice sets up the origin it named, not the one a later refusal handed over (Codex F7); fails_when=pressing an older notice after a newer refusal starts the setup for the newer origin; no_claim=VS Code's notification center
test('a stale notice pressed after a later refusal starts the setup for the origin that notice named', async () => {
  // Arrange
  const olderNoticeAnswer = defer<string | undefined>()
  const { installed, startRequests } = await loadCommands((message) =>
    message === NOTICE_TEXT ? olderNoticeAnswer.promise : undefined,
  )
  installed.showSignInRequired('no-saved-session', DECLARATION)
  installed.showSignInRequired('no-saved-session', OTHER_DECLARATION)
  await settle()
  // Act
  olderNoticeAnswer.resolve(SET_UP)
  await waitUntil(() => startRequests.length > 0)
  // Assert
  assert.deepEqual(
    startRequests.map((request) => request.reverseProxy?.origin),
    [ORIGIN],
  )
})

// Value: protects=the palette entry always opens localhost and no caller can pass a declaration through the command; fails_when=the registered command forwards an argument or a handed declaration to the setup; no_claim=the status item's menu
test('the Set Up Saved Session command opens localhost even after a refused run at a declared origin and ignores a declaration passed as an argument', async () => {
  // Arrange
  const { installed, startRequests, handlers } = await loadCommands(
    () => undefined,
  )
  installed.showSignInRequired('no-saved-session', DECLARATION)
  await settle()
  // Act
  await handlers.get('codebook.setUpSavedSession')?.(OTHER_DECLARATION)
  // Assert
  assert.deepEqual(
    startRequests.map((request) => request.reverseProxy),
    [undefined],
  )
})

// Value: protects=the status item's Set Up entry sets up where the refused run opened the app while the need is alive; fails_when=the entry opens localhost for a run at a declared origin, or keeps an older refusal's origin after a newer one; no_claim=the item's text
test('the status item Set Up entry uses the declaration of the latest refusal while its need is shown', async () => {
  // Arrange
  const { installed, startRequests, handlers } = await loadCommands(
    () => undefined,
  )
  installed.showSignInRequired('no-saved-session', DECLARATION)
  installed.showSignInRequired('no-saved-session', OTHER_DECLARATION)
  await settle()
  // Act
  await handlers.get('codebook.savedSession.actions')?.()
  await settle()
  // Assert
  assert.deepEqual(
    startRequests.map((request) => request.reverseProxy?.origin),
    [OTHER_ORIGIN],
  )
})

// Value: protects=the handed declaration ends with its need once the saved session changed after the refused run; fails_when=the status item still sets up at the old declared origin after another window changed the saved session; no_claim=the store's own hold events
test('the status item Set Up entry opens localhost once the saved session changed after the refused run', async () => {
  // Arrange
  const { installed, startRequests, handlers, stored, focusWindow } =
    await loadCommands(() => undefined)
  installed.showSignInRequired('redirected-to-sign-in', DECLARATION)
  await settle()
  focusWindow()
  await settle()
  stored.view = { ...stored.view, setupAt: '2026-11-03T09:00:00.000Z' }
  focusWindow()
  await settle()
  // Act
  await handlers.get('codebook.savedSession.actions')?.()
  await settle()
  // Assert
  assert.deepEqual(
    startRequests.map((request) => request.reverseProxy),
    [undefined],
  )
})

// Value: protects=the handed declaration is memory only and a setup ends it; fails_when=a second status-item Set Up after a setup started still uses the old declaration; no_claim=window disposal
test('the status item Set Up entry no longer uses the declaration after a setup started from it', async () => {
  // Arrange
  const { installed, startRequests, handlers } = await loadCommands(
    () => undefined,
  )
  installed.showSignInRequired('no-saved-session', DECLARATION)
  await settle()
  await handlers.get('codebook.savedSession.actions')?.()
  await settle()
  // Act
  await handlers.get('codebook.savedSession.actions')?.()
  await settle()
  // Assert
  assert.deepEqual(
    startRequests.map((request) => request.reverseProxy?.origin),
    [ORIGIN, undefined],
  )
})

// Value: protects=a notice for one address never silently re-offers the open setup of another; fails_when=pressing a declared-origin notice while a localhost setup is open re-offers the localhost setup with no word about the address; no_claim=the open setup's own Done and Close buttons
test('pressing a declared-origin notice while a setup at another address is open says so instead of re-offering that setup', async () => {
  // Arrange
  const held = defer<never>()
  const { installed, handlers, notices, startRequests } = await loadCommands(
    pressesDeclaredNotices,
    held.promise,
  )
  void handlers.get('codebook.setUpSavedSession')?.()
  await waitUntil(() => startRequests.length > 0)
  // Act
  installed.showSignInRequired('no-saved-session', DECLARATION)
  await waitUntil(() =>
    notices.some((notice) =>
      notice.message.startsWith('A saved session setup'),
    ),
  )
  // Assert
  assert.equal(
    notices.at(-1)?.message,
    'A saved session setup at another address is open for shop. Finish it with Done or close it first, then set up again here.',
  )
  assert.equal(startRequests.length, 1)
  held.reject(new Error('stop after recording'))
  await settle()
})
