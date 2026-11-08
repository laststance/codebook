import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import type { StudyError } from '../errors'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { readResource } from '../resources'
import type { RuntimeControl } from '../runtime'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { configuredServiceHarness } from './utils/configuredServiceHarness'
import { ControlledOperationsRuntime } from './utils/controlledOperationsRuntime'
import { defer } from './utils/defer'
import { readEvidenceText } from './utils/readEvidenceText'

/** The origin a learner types for their local reverse proxy; the neutral placeholder of the help texts. */
const DECLARED_ORIGIN = 'https://app.example.test'
/** The port the learner's proxy forwards to; the run starts the development server on it. */
const UPSTREAM_PORT = 4310
/** The origin the stand-in server reports for the port it was started on. */
const SERVER_ORIGIN = `http://127.0.0.1:${UPSTREAM_PORT}`
/** The whole pin switch the run gives its browser for the declared host mapped to loopback. */
const PIN_RULE = '--host-resolver-rules=MAP app.example.test 127.0.0.1'
const DECLARATION = { origin: DECLARED_ORIGIN, upstreamPort: UPSTREAM_PORT }
const CLICK: RepositoryOperation = {
  kind: 'click',
  title: 'Open the invoice',
  selector: '#open',
}
/** What a proof that reached another responder reports. */
const WRONG_SERVER = {
  ok: false as const,
  reason: 'proof-wrong-server' as const,
  requestWritten: true,
  status: 404,
}

/** Builds the control the service gives a run, with its own abort. @example controlOf(context).signal */
function controlOf(
  context: TestContext,
  abort = new AbortController(),
  outputLines: string[] = [],
): RuntimeControl {
  context.after(() => abort.abort())
  return {
    signal: abort.signal,
    deadlineAt: Date.now() + 300_000,
    preparationDeadlineAt: Date.now() + 300_000,
    runId: 'service-run-9',
    outputLog: (line) => outputLines.push(line.text),
  }
}

/** Copies a value out of the run module's realm. @example plain(run.view().reverseProxy) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Opens a version 3 Next harness that declares `reverseProxy`, with a browser stop and one click. @example await proxyHarness(context, { reverseProxy: { declaration: DECLARATION, dependencies } }) */
async function proxyHarness(
  context: TestContext,
  options: NonNullable<Parameters<typeof configuredRuntimeHarness>[3]> = {},
  control: RuntimeControl = controlOf(context),
) {
  return configuredRuntimeHarness(context, control, [], {
    serverOrigin: SERVER_ORIGIN,
    reverseProxy: { declaration: DECLARATION },
    ...options,
    operations: {
      operations: [CLICK],
      stopOperations: [1],
      ...options.operations,
    },
  })
}

/** Reads the refusal a preparation ended with. @example const refusal = await refusalOf(harness) */
async function refusalOf(harness: { run: { prepare(): Promise<void> } }) {
  const refusal: unknown = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // The run module lives in its own realm, so the error is read by its fields, not by `instanceof`.
  assert.ok(typeof refusal === 'object' && refusal !== null)
  return refusal as StudyError
}

// Value: protects=AC 6 entry at the declared origin and the pin before any launch: the run loads its entry at the declared origin and gives the browser the pin rule before the browser launches; fails_when=the entry opens at localhost, the pin is missing or comes after the launch; no_claim=a real Chrome resolving the name (reverseProxyBrowser.test)
test('a reverse proxy run loads its entry at the declared origin with the browser pinned before it launches', async (context) => {
  // Arrange
  const harness = await proxyHarness(context, { entryPath: '/invoices' })

  // Act
  await harness.run.prepare()

  // Assert
  assert.deepEqual(harness.navigations, [`${DECLARED_ORIGIN}/invoices`])
  assert.deepEqual(harness.pinnedHostRules, [PIN_RULE])
  const order = harness.reverseProxyOrder
  assert.ok(order.indexOf('pin') < order.indexOf('browser launch'))
  assert.equal(harness.run.view().applicationOrigin, DECLARED_ORIGIN)
  assert.equal(harness.run.view().status, 'ready')
  await harness.run.stop()
})

// Value: protects=AC 3 the upstream port and the identity: the development server starts on the declared upstream port with the identity preload and a secret, and the run reads the port as declared by reverseProxy; fails_when=the server starts on the dev script's port, or without the identity; no_claim=the real launcher (launchDevelopmentServer tests)
test('a reverse proxy run starts the development server on the declared upstream port with the identity', async (context) => {
  // Arrange
  const harness = await proxyHarness(context)

  // Act
  await harness.run.prepare()

  // Assert
  const launch = harness.developmentServerLaunchArguments[0]!
  assert.equal(launch[4], UPSTREAM_PORT)
  const nextOptions = plain(launch[8]) as {
    identity: { preloadPath: string; secret: string }
  }
  assert.match(nextOptions.identity.preloadPath, /identity-preload\.cjs$/)
  assert.match(nextOptions.identity.secret, /^[0-9a-f]{64}$/)
  assert.equal(
    harness.run.view().applicationPortSource,
    'declared by reverseProxy.upstreamPort',
  )
  await harness.run.stop()
})

// Value: protects=AC 6 operations and conditions at the declared origin: the page reports the declared origin as its own, the run owns it and reaches ready with its click; fails_when=the origin check refuses the declared origin as foreign; no_claim=a real page behind a real proxy
test('a page at the declared origin is the owned application, so the operations and conditions run there', async (context) => {
  // Arrange
  const harness = await proxyHarness(context)

  // Act
  await harness.run.prepare()

  // Assert
  assert.equal(harness.run.view().status, 'ready')
  assert.deepEqual(plain(harness.run.view().reverseProxy), {
    origin: DECLARED_ORIGIN,
    upstreamPort: UPSTREAM_PORT,
    state: 'proved',
    address: '127.0.0.1',
    proofMs: plain(harness.run.view().reverseProxy)!.proofMs,
  })
  await harness.run.stop()
})

// Value: protects=AC 6 the owned-origin bound: a page that leaves both the declared origin and the loopback names of the server's port is refused; fails_when=any other origin is accepted because a declaration exists; no_claim=every redirect shape
for (const foreignOrigin of [
  'https://other.example.test',
  'https://app.example.test:8443',
  'http://app.example.test',
])
  test(`a page at ${foreignOrigin} is refused as leaving the owned application origin`, async (context) => {
    // Arrange
    const harness = await proxyHarness(context)
    harness.setPageOrigin(foreignOrigin)

    // Act / Assert
    await assert.rejects(
      harness.run.prepare(),
      /Selected page left its owned application origin/,
    )
    await harness.run.stop()
  })

// Value: protects=AC 6 the loopback names of the server's port stay owned beside the declared origin; fails_when=the declared origin replaces the loopback origins; no_claim=Codebook's own requests, which go to the server directly
test('a page at the loopback name of the upstream port is still the owned application', async (context) => {
  // Arrange
  const harness = await proxyHarness(context)
  harness.setPageOrigin(`http://localhost:${UPSTREAM_PORT}`)

  // Act
  await harness.run.prepare()

  // Assert
  assert.equal(harness.run.view().status, 'ready')
  await harness.run.stop()
})

// Value: protects=AC 6 a server stop run: a run with a scripted server session prepares at the declared origin and arms its server stop; fails_when=the server participant is not attached for a reverse proxy run; no_claim=a real Node inspector
test('a reverse proxy run with a server stop prepares and stops cleanly', async (context) => {
  // Arrange
  const harness = await proxyHarness(context, {
    serverRuntime: { route: '/' },
    participant: 'server',
  })

  // Act
  await harness.run.prepare()
  await harness.run.stop()

  // Assert
  assert.equal(harness.run.view().status, 'cancelled')
  assert.ok(harness.releases.includes('application'))
})

// Value: protects=AC 3 the proof precedes every request that runs the entry page's code, for an App workspace: lookup, listening, proof, browser check, pin, then the readiness request; fails_when=the readiness request is sent before the proof; no_claim=the Pages workspace (next test)
test('the proof and the browser check come before the readiness request of an App workspace', async (context) => {
  // Arrange
  const harness = await proxyHarness(context)

  // Act
  await harness.run.prepare()

  // Assert
  assert.deepEqual(harness.reverseProxyOrder.slice(0, 7), [
    'lookup',
    'listening',
    'certificates',
    'prove',
    'probe',
    'pin',
    'ready',
  ])
  await harness.run.stop()
})

// Value: protects=AC 3 the same order for a workspace with a Pages folder, whose readiness request runs the page's data function; fails_when=the structured entry check is sent before the proof; no_claim=a real Pages page
test('the proof and the browser check come before the structured entry check of a workspace with a Pages folder', async (context) => {
  // Arrange
  const harness = await proxyHarness(context, {
    nextPages: {
      withAppFolder: true,
      manifests: {
        settings: {},
        kind: 'app',
        route: {
          key: '/page',
          path: '.next/dev/server/app/page_client-reference-manifest.js',
        },
      },
    },
  })

  // Act
  await harness.run.prepare()

  // Assert
  const order = harness.reverseProxyOrder
  assert.ok(order.indexOf('prove') >= 0)
  assert.ok(order.indexOf('prove') < order.indexOf('probe'))
  assert.ok(order.indexOf('probe') < order.indexOf('readyEntry'))
  await harness.run.stop()
})

// Value: protects=AC 4 the run resource's states: resolving while the host is looked up, proving while the proof holds, proved after, each readable while the run prepares; fails_when=the view shows no state or a late one; no_claim=the service's message sentence (reverseProxyService.test)
test('the run view shows resolving, proving and proved while the check holds', async (context) => {
  // Arrange
  const lookupEntered = defer<void>()
  const lookupGate = defer<void>()
  const proveEntered = defer<void>()
  const proveGate = defer<void>()
  const harness = await proxyHarness(context, {
    reverseProxy: {
      declaration: DECLARATION,
      dependencies: {
        lookup: async () => {
          lookupEntered.resolve()
          await lookupGate.promise
          return [{ address: '127.0.0.1', family: 4 }]
        },
        prove: async () => {
          proveEntered.resolve()
          await proveGate.promise
          return { ok: true, serverPid: 5151 }
        },
      },
    },
  })

  // Act
  const preparing = harness.run.prepare()
  // Each stand-in announces that the run reached it, so a loaded run never reads the view too early.
  await lookupEntered.promise
  const whileResolving = harness.run.view().reverseProxy?.state
  lookupGate.resolve()
  await proveEntered.promise
  const whileProving = harness.run.view().reverseProxy?.state
  proveGate.resolve()
  await preparing

  // Assert
  assert.equal(whileResolving, 'resolving')
  assert.equal(whileProving, 'proving')
  assert.equal(harness.run.view().reverseProxy?.state, 'proved')
  await harness.run.stop()
})

// Value: protects=AC 5 a refusal before the start holds nothing: a host that resolves to a non-loopback address starts no server, opens no browser and says the resources are released; fails_when=the server is started first, or resourcesReleased is false or a constant; no_claim=the wording of every reason (reverseProxyRefusals.test)
test('a host that is not loopback is refused before any server starts, with the resources released', async (context) => {
  // Arrange
  const harness = await proxyHarness(context, {
    reverseProxy: {
      declaration: DECLARATION,
      dependencies: {
        lookup: async () => [{ address: '10.0.0.5', family: 4 }],
      },
    },
  })

  // Act
  const refusal = await refusalOf(harness)

  // Assert
  assert.equal(refusal.code, 'REVERSE_PROXY_REFUSED')
  assert.equal(refusal.details?.reason, 'not-loopback')
  assert.equal(refusal.details?.resourcesReleased, true)
  assert.equal(refusal.details?.browserOpened, false)
  assert.equal(harness.developmentServerLaunches(), 0)
  assert.equal(harness.reverseProxyOrder.includes('browser launch'), false)
  await harness.run.stop()
})

// Value: protects=AC 5 a proof that reached another server: the server the run started is stopped, no browser opens, no pin is given, and the refusal reports the stop as confirmed; fails_when=the server keeps running, the browser opens, or resourcesReleased is not the run's confirmed result; no_claim=a real forwarded request
test('a proof answered by another server stops the started server and opens no browser', async (context) => {
  // Arrange
  const harness = await proxyHarness(context, {
    reverseProxy: {
      declaration: DECLARATION,
      dependencies: { prove: async () => WRONG_SERVER },
    },
  })

  // Act
  const refusal = await refusalOf(harness)

  // Assert
  assert.equal(refusal.code, 'REVERSE_PROXY_REFUSED')
  assert.equal(refusal.details?.reason, 'proof-wrong-server')
  assert.equal(refusal.details?.resourcesReleased, true)
  assert.ok(harness.releases.includes('application'))
  assert.equal(harness.reverseProxyOrder.includes('browser launch'), false)
  assert.deepEqual(harness.pinnedHostRules, [])
  assert.equal(harness.run.view().reverseProxy?.state, 'refused')
  await harness.run.stop()
})

// Value: protects=AC 5 the refusal never claims a stop it could not confirm: when the server's close fails, resourcesReleased is false and the message says so; fails_when=the refusal keeps a constant true; no_claim=a real process kill
test('a refusal whose server stop could not be confirmed reports resourcesReleased false', async (context) => {
  // Arrange
  const harness = await proxyHarness(context, {
    applicationCloseFailsOnce: true,
    reverseProxy: {
      declaration: DECLARATION,
      dependencies: { prove: async () => WRONG_SERVER },
    },
  })

  // Act
  const refusal = await refusalOf(harness)

  // Assert
  assert.equal(refusal.details?.resourcesReleased, false)
  assert.match(
    refusal.message,
    /could not confirm that it stopped the development server it started/,
  )
  await harness.run.stop()
  assert.ok(harness.releases.includes('application'))
})

// Value: protects=AC 5 a browser check refusal: the throwaway browser's finding (the browser reached another address) refuses the run before the real browser launches or is pinned; fails_when=the real browser opens after a failed browser check; no_claim=the real probe (reverseProxyBrowser.test)
test('a failed browser address check refuses the run before the real browser opens or is pinned', async (context) => {
  // Arrange
  const harness = await proxyHarness(context, {
    reverseProxy: {
      declaration: DECLARATION,
      dependencies: {
        probe: async () => ({
          ok: false,
          reason: 'browser-address-mismatch',
          browserAddress: '192.0.2.7',
          cleanupConfirmed: true,
        }),
      },
    },
  })

  // Act
  const refusal = await refusalOf(harness)

  // Assert
  assert.equal(refusal.details?.reason, 'browser-address-mismatch')
  assert.equal(refusal.details?.browserAddress, '192.0.2.7')
  assert.equal(refusal.details?.browserOpened, false)
  assert.deepEqual(harness.pinnedHostRules, [])
  assert.equal(harness.reverseProxyOrder.includes('browser launch'), false)
  await harness.run.stop()
})

// Value: protects=AC 5 cancellation during the proof: aborting the run while the proof holds ends the preparation with the run's own cancellation, not a refusal, and the started server is stopped; fails_when=the proof keeps the run alive, or the abort is worded as a reverse proxy refusal; no_claim=the socket destruction (reverseProxyProof.test)
test('cancelling the run during the proof ends the preparation and stops the server', async (context) => {
  // Arrange
  const abort = new AbortController()
  const proveStarted = defer<void>()
  const harness = await proxyHarness(
    context,
    {
      reverseProxy: {
        declaration: DECLARATION,
        dependencies: {
          prove: (_input, signal) =>
            new Promise((_resolve, reject) => {
              proveStarted.resolve()
              signal.addEventListener('abort', () => reject(signal.reason))
            }),
        },
      },
    },
    controlOf(context, abort),
  )

  // Act
  const preparing = harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await proveStarted.promise
  abort.abort()
  const outcome = await preparing
  await harness.run.stop()

  // Assert
  assert.ok(typeof outcome === 'object' && outcome !== null)
  assert.notEqual((outcome as StudyError).code, 'REVERSE_PROXY_REFUSED')
  assert.ok(harness.releases.includes('application'))
})

// Value: protects=AC 6 an unclassified proof failure carries the log id the Output line names, and an unreadable system trust store writes its own line; fails_when=the refusal has no logId, or the Output has no line to find; no_claim=the real certificate read
test('an unreadable system trust store refuses with a log id and writes the Output line', async (context) => {
  // Arrange
  const outputLines: string[] = []
  const harness = await proxyHarness(
    context,
    {
      reverseProxy: {
        declaration: DECLARATION,
        dependencies: { readSystemCertificates: async () => ({ ok: false }) },
      },
    },
    controlOf(context, undefined, outputLines),
  )

  // Act
  const refusal = await refusalOf(harness)

  // Assert
  assert.equal(refusal.details?.reason, 'proof-unclassified')
  assert.equal(refusal.details?.logId, 'service-run-9#start')
  assert.ok(
    outputLines.some((text) =>
      text.includes('reverse proxy: system trust store unreadable'),
    ),
  )
  assert.ok(
    outputLines.some((text) => text.includes('[log service-run-9#start]')),
  )
  await harness.run.stop()
})

// Value: protects=AC 7 an absolute Location at the declared origin: the entry answers a redirect to the declared sign-in path, the run reads it as a sign-in redirect, refuses with SIGN_IN_REQUIRED and hands the editor the declaration; fails_when=the redirect is read as another origin, or the notice carries no declaration; no_claim=the editor's notice (savedSessionReverseProxy.test)
test('an entry redirect with an absolute Location at the declared origin to a sign-in path asks for the saved session and hands the declaration', async (context) => {
  // Arrange
  const harness = await proxyHarness(context, {
    entryPath: '/dashboard',
    entryAnswer: {
      status: 307,
      location: `${DECLARED_ORIGIN}/login?callbackUrl=%2Fdashboard`,
    },
    savedSession: { admission: 'no-saved-session' },
    operations: {
      operations: [CLICK],
      stopOperations: [1],
      signInPaths: ['/login'],
    },
  })

  // Act
  await assert.rejects(harness.run.prepare())

  // Assert
  const failure = harness.run.view().failures[0]!
  assert.match(failure, /^SIGN_IN_REQUIRED\(no-saved-session\): /)
  assert.deepEqual(harness.declaredOriginsSeen, [DECLARED_ORIGIN])
  assert.deepEqual(plain(harness.signInDeclarations), [DECLARATION])
  assert.match(failure, /press Set Up Saved Session… in the editor's notice/)
  await harness.run.stop()
})

// Value: protects=AC 6 initialStorage seeds the declared origin: the script that writes the initial storage guards on the declared origin; fails_when=the guard lists only loopback origins, so no entry is written at the declared origin; no_claim=the browser's storage
test('initial storage is seeded at the declared origin', async (context) => {
  // Arrange
  const harness = await proxyHarness(context, {
    operations: {
      operations: [CLICK],
      stopOperations: [1],
      initialStorage: [{ key: 'theme', value: 'dark' }],
    },
  })

  // Act
  await harness.run.prepare()

  // Assert
  assert.equal(harness.newDocumentScripts.length, 1)
  assert.ok(harness.newDocumentScripts[0]!.includes(`"${DECLARED_ORIGIN}"`))
  await harness.run.stop()
})

// Value: protects=AC 8 a nested packageRoot run gets no saved session: it starts with a fresh profile and no notice is shown, whether or not it declares reverseProxy; fails_when=a nested reverse proxy run asks the store for the root app's session; no_claim=the root run (the tests above)
test('a nested packageRoot reverse proxy run starts fresh and shows no saved-session notice', async (context) => {
  // Arrange
  const harness = await proxyHarness(context, {
    packageRoot: 'apps/web',
    entryAnswer: {
      status: 307,
      location: `${DECLARED_ORIGIN}/login`,
    },
    savedSession: { admission: 'saved' },
    operations: {
      operations: [CLICK],
      stopOperations: [1],
      signInPaths: ['/login'],
    },
  })

  // Act
  await assert.rejects(harness.run.prepare())

  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /^SIGN_IN_REQUIRED\(package-root-fresh-session\): /,
  )
  assert.deepEqual(harness.savedProfileFolders, [])
  assert.deepEqual(harness.signInNotices, [])
  await harness.run.stop()
})

// Value: protects=AC 2 one stored spelling of the origin: two starts with the same key and the origin spelled with capitals and a slash, then canonically, are one intent, and the run holds the canonical origin; fails_when=the service signs the origin as written, so the second start conflicts; no_claim=the run's use of the origin
test('two spellings of the declared origin give one start intent holding the canonical origin', async (context) => {
  // Arrange
  const harness = await configuredServiceHarness(
    context,
    undefined,
    (directory, definition) =>
      new ControlledOperationsRuntime(directory, definition),
  )
  const { service, configuration } = harness
  const startWith = (origin: string) =>
    service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'origin',
      configuration: {
        version: 3,
        adapter: configuration.adapter,
        book: configuration.book,
        source: configuration.source,
        participant: 'browser',
        afterOperation: 1,
        before: configuration.action.before,
        after: configuration.action.after,
        operations: [{ kind: 'click', title: 'First', selector: '#first' }],
        inspections: configuration.inspections,
        reverseProxy: { origin, upstreamPort: UPSTREAM_PORT },
      },
    })

  // Act
  const first = startWith('https://App.Example.test/')
  await service.record(first).preparation
  const second = startWith(DECLARED_ORIGIN)

  // Assert
  assert.equal(second.runId, first.runId)
  const runtime = harness.runtimes[0]!
  assert.ok(runtime instanceof ControlledOperationsRuntime)
  assert.equal(
    (runtime.definition.configuration as { reverseProxy?: { origin: string } })
      .reverseProxy?.origin,
    DECLARED_ORIGIN,
  )
})

// Value: protects=AC 3 the identity secret never leaves the launch: neither the run view nor the evidence journal holds the secret the server was started with; fails_when=the run copies the secret into its view or journal; no_claim=the launcher's own journal record (nextLaunchArguments and launchDevelopmentServer tests)
test('the identity secret appears in neither the run view nor the evidence journal', async (context) => {
  // Arrange
  const harness = await proxyHarness(context)

  // Act
  await harness.run.prepare()
  await harness.run.stop()

  // Assert
  const nextOptions = plain(
    harness.developmentServerLaunchArguments[0]![8],
  ) as {
    identity: { secret: string }
  }
  const { secret } = nextOptions.identity
  assert.equal(secret.length, 64)
  assert.equal(JSON.stringify(harness.run.view()).includes(secret), false)
  assert.equal(
    (await readEvidenceText(harness.run.view().artifactDirectory)).includes(
      secret,
    ),
    false,
  )
})

// Value: protects=O1-3 the Output line names what was really done: a refusal decided before anything starts says nothing was started, a later one says the started server is stopped; fails_when=a resolve-stage refusal claims a stop of a server that never started, or a later one drops the claim; no_claim=the wording of the refusal error (reverseProxyRefusals.test)
test('the start Output line of a refusal says nothing was started before the server starts and that it stops the server after', async (context) => {
  // Arrange
  const beforeStartLines: string[] = []
  const afterStartLines: string[] = []
  const beforeStart = await proxyHarness(
    context,
    {
      reverseProxy: {
        declaration: DECLARATION,
        dependencies: {
          lookup: async () => [{ address: '10.0.0.5', family: 4 }],
        },
      },
    },
    controlOf(context, undefined, beforeStartLines),
  )
  const afterStart = await proxyHarness(
    context,
    {
      reverseProxy: {
        declaration: DECLARATION,
        dependencies: { prove: async () => WRONG_SERVER },
      },
    },
    controlOf(context, undefined, afterStartLines),
  )

  // Act
  await refusalOf(beforeStart)
  await refusalOf(afterStart)

  // Assert
  const beforeStartLine = beforeStartLines.find((line) =>
    line.includes('(not-loopback)'),
  )
  const afterStartLine = afterStartLines.find((line) =>
    line.includes('(proof-wrong-server)'),
  )
  assert.ok(beforeStartLine?.includes('nothing was started'))
  assert.equal(
    beforeStartLine?.includes('stops the development server it started'),
    false,
  )
  assert.ok(
    afterStartLine?.includes(
      'Codebook stops the development server it started',
    ),
  )
  await beforeStart.run.stop()
  await afterStart.run.stop()
})

// Value: protects=C3-3 a preload folder that cannot be removed does not abort the cleanup: the failure is reported by Stop while the cleanup record and the final persist still happen; fails_when=the rejection escapes before cleanup.completed is recorded; no_claim=the real folder removal (reverseProxyGate.test)
test('a failing preload folder removal is reported by Stop after the cleanup record is written', async (context) => {
  // Arrange
  const harness = await proxyHarness(context)
  await harness.run.prepare()
  const gate = (
    harness.run as unknown as {
      reverseProxyGateCache: { dispose(): Promise<void> }
    }
  ).reverseProxyGateCache
  const realDispose = gate.dispose.bind(gate)
  // Only the first removal fails; the retried Stop of the harness's own cleanup removes the folder for real.
  let removalAttempts = 0
  gate.dispose = (): Promise<void> =>
    removalAttempts++ === 0
      ? Promise.reject(new Error('preload folder is busy'))
      : realDispose()

  // Act
  const stopOutcome = await harness.run.stop().then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.match(
    String(stopOutcome),
    /reverse proxy preload folder removal: Error: preload folder is busy/,
  )
  assert.match(
    await readEvidenceText(harness.run.view().artifactDirectory),
    /cleanup\.completed/,
  )
})

// Value: protects=O1-1 the run resource tells the agent to read it again only while the run still prepares: a run that failed while its check was proving keeps the last state and carries no checking message; fails_when=the sentence stays on a failed run, or is missing on a preparing one; no_claim=the gate's own states (the run view test above)
test('the run resource carries the checking message only while the run prepares', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'notice',
    configuration,
  })
  await service.record(receipt).preparation
  const runtime = runtimes[0]
  assert.ok(runtime)
  const baseView = runtime.view.bind(runtime)
  runtime.view = () => ({
    ...baseView(),
    reverseProxy: {
      origin: DECLARED_ORIGIN,
      upstreamPort: UPSTREAM_PORT,
      state: 'proving' as const,
    },
  })
  const stateOf = async () => {
    const resource = await readResource(service, receipt.runUri)
    assert.ok('text' in resource)
    return JSON.parse(resource.text) as {
      message?: string
      reverseProxy?: { state: string }
    }
  }
  // The run is made to read as still preparing, the way it does before its preparation ends.
  service.record(receipt).prepared = false
  const whilePreparing = await stateOf()

  // Act
  runtime.status = 'failed'
  runtime.failures.push('The development server exited before it listened.')
  const afterFailure = await stateOf()

  // Assert
  assert.equal(
    whilePreparing.message,
    'Codebook is checking that the declared origin reaches the development server it started; read this run resource again in a few seconds and start no other run.',
  )
  assert.equal(afterFailure.message, undefined)
  assert.equal(afterFailure.reverseProxy?.state, 'proving')
})
