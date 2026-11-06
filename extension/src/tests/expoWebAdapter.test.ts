import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { test, type TestContext } from 'node:test'

import type { DevelopmentBundleRequest } from '../developmentServerAdapter'
import { StudyError } from '../errors'
import { EXPO_WEB_DEV_ADAPTER } from '../expoWebDevAdapter'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { EXPO_WEB_SOURCE_MAP_LIMITS } from '../sourceMapLimits'
import { isProcessGone } from '../utils/isProcessGone'

import {
  createExpoWebRepository,
  expoWebStartRequest,
  FAKE_BUNDLE_PATH,
  type ExpoWebFixtureOptions,
  type ExpoWebRepository,
} from './utils/expoWebFixture'

/** Starts the adapter on a staged fake Expo app and closes the server when the test ends. */
async function startAdapter(
  context: TestContext,
  options: ExpoWebFixtureOptions = {},
) {
  const repository = await createExpoWebRepository(context, options)
  const controller = new AbortController()
  const prepared = await expoWebStartRequest(repository, controller.signal)
  context.after(async () => {
    await prepared.handle.app?.close()
  })
  return {
    repository,
    controller,
    ...prepared,
    started: () => EXPO_WEB_DEV_ADAPTER.start(prepared.request),
  }
}

/** Builds the seal request of the stop in `src/app/index.tsx` for a started app. */
function bundleRequest(
  repository: ExpoWebRepository,
  request: Awaited<ReturnType<typeof startAdapter>>['request'],
  path = `${repository.appFolder}/src/app/index.tsx`,
): DevelopmentBundleRequest {
  return {
    workspace: repository.root,
    expoWebPackage: request.expoWebPackage!,
    source: { path, hash: repository.sourceHash, line: 2, column: 1 },
    citationEndLine: 3,
    signal: new AbortController().signal,
    entryPath: '/',
    execution: 'browser',
    ownedOrigin: `http://127.0.0.1:${repository.port}`,
    record: () => undefined,
  }
}

/** Reads the refusal a promise ended with. */
async function refusalOf(promise: Promise<unknown>): Promise<StudyError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  assert.ok(error instanceof StudyError, String(error))
  return error
}

// Value: protects=AC 2: the app's own CLI runs on Codebook's Node as start --web --port <declared> in the app folder, with Codebook's CI, BROWSER and EXPO_NO_TELEMETRY winning over the script's assignments while its other assignments pass; fails_when=the arguments, the folder or a Codebook variable differ, or an assignment is dropped; why_new=Cycle 0089 launch contract (E-3, E-13); seam=the real shared launcher over a fake Expo CLI; no_claim=real Expo or Metro
test('the Expo CLI starts with the declared port, the app folder as its working folder and Codebook environment over the script assignments', async (context) => {
  // Arrange
  const { repository, started } = await startAdapter(context, {
    webScript: (port) =>
      `CI=0 BROWSER=chrome API_BASE=http://api.example expo start --web --port ${port}`,
  })
  // Act
  await started()
  const launch = JSON.parse(await readFile(repository.launchFile, 'utf8'))
  // Assert
  assert.deepEqual(launch.argv, [
    'start',
    '--web',
    '--localhost',
    '--port',
    String(repository.port),
  ])
  assert.equal(await realpath(launch.cwd), repository.appRoot)
  assert.deepEqual(launch.env, {
    CI: '1',
    BROWSER: 'none',
    EXPO_NO_TELEMETRY: '1',
    API_BASE: 'http://api.example',
  })
})

// Value: protects=DX-15 / E-4: the port the web script declares is the port the start reports and listens on; fails_when=Codebook picks another port; why_new=declared-port contract; seam=real launcher, fake CLI; no_claim=Expo's default 8081 (refusal test below)
test('the start listens on the port the web script declares and reports where it was declared', async (context) => {
  // Arrange
  const { repository, declared, started } = await startAdapter(context)
  // Act
  const { port } = await started()
  // Assert
  assert.equal(port, repository.port)
  assert.deepEqual(declared, [
    { port: repository.port, source: 'the web script --port' },
  ])
})

// Value: protects=E-4: a script without --port declares Expo's 8081 and a busy declared port is refused before any process starts, never moved; fails_when=another port is tried or the CLI is spawned; why_new=busy-port contract; seam=the run's port check stand-in; no_claim=a port taken after the check (CLI exit test below)
test('a busy declared port is refused before the CLI spawns, and a script without --port declares 8081', async (context) => {
  // Arrange
  const { repository, request, declared, started } = await startAdapter(
    context,
    { webScript: () => 'expo start --web' },
  )
  request.assertPortFree = async (portDeclared, refuse) => {
    throw await refuse!({ port: portDeclared.port, reason: 'in-use' })
  }
  // Act
  const refusal = await refusalOf(started())
  // Assert
  assert.equal(refusal.code, 'EXPO_WEB_PORT_UNAVAILABLE')
  assert.deepEqual(
    {
      port: refusal.details?.port,
      source: refusal.details?.source,
      sideEffects: refusal.details?.sideEffects,
    },
    { port: 8081, source: 'pre-start-check', sideEffects: 'none' },
  )
  assert.deepEqual(declared, [{ port: 8081, source: "Expo's default port" }])
  await assert.rejects(readFile(repository.launchFile, 'utf8'))
})

// Value: protects=DX-3: the CLI's own busy-port exit is EXPO_WEB_PORT_UNAVAILABLE, not a generic exit; fails_when=the line is read as an exit or a timeout; why_new=port-in-use from the CLI; seam=real launcher, fake CLI printing Expo's non-interactive port message; no_claim=Expo's exact wording across versions
test('the Expo CLI exiting on a busy port is refused as port-in-use with the owned server stopped', async (context) => {
  // Arrange
  const { repository, started } = await startAdapter(context, {
    mode: 'port-conflict',
  })
  // Act
  const refusal = await refusalOf(started())
  // Assert
  assert.equal(refusal.code, 'EXPO_WEB_PORT_UNAVAILABLE')
  assert.deepEqual(
    { port: refusal.details?.port, source: refusal.details?.source },
    { port: repository.port, source: 'expo-exit' },
  )
})

// Value: protects=E-2: readiness is the served bundle and map, not Metro's Waiting on line: the start returns at that line, and the settle wait ends only after the late bundle and the map were read, journaling the three steps in order; fails_when=readiness passes on the log line, or a step is missing or out of order; why_new=Metro prints before it bundles; seam=real launcher, fake Metro that answers the bundle after a delay; no_claim=Metro's real timings
test('readiness waits for the bundle and map after the Waiting on line and journals html, bundle and map in order', async (context) => {
  // Arrange
  const { controller, journal, started } = await startAdapter(context, {
    mode: 'late-bundle',
    lateBundleMs: 800,
  })
  const startedAtMs = performance.now()
  const { app } = await started()
  const afterStartMs = performance.now() - startedAtMs
  // Act
  await EXPO_WEB_DEV_ADAPTER.waitForServerSettled(
    app,
    10_000,
    controller.signal,
  )
  const afterSettleMs = performance.now() - startedAtMs
  // Assert
  assert.ok(afterSettleMs >= 700, `settled after ${afterSettleMs} ms`)
  assert.ok(afterStartMs < afterSettleMs)
  assert.deepEqual(
    journal
      .filter((entry) => entry.type === 'expo.step')
      .map((entry) => (entry.detail as { step: string }).step),
    ['cli-started', 'html-served', 'bundle-served', 'map-served'],
  )
})

// Value: protects=E-2: a Metro error response for the bundle is EXPO_WEB_LAUNCHER_FAILED bundle-failed quoting Metro's message with the EXPO_PUBLIC value masked; fails_when=the failure reads as a timeout or the secret is quoted; why_new=bundle failure; seam=real launcher, fake Metro answering 500 JSON; no_claim=Metro's real error JSON fields beyond message
test('a Metro error response is refused as bundle-failed with the masked message', async (context) => {
  // Arrange
  const { controller, started } = await startAdapter(context, {
    mode: 'bundle-error',
    files: { '.env': 'EXPO_PUBLIC_API_KEY=pk-live-abc123xyz\n' },
  })
  const { app } = await started()
  // Act
  const refusal = await refusalOf(
    EXPO_WEB_DEV_ADAPTER.waitForServerSettled(app, 10_000, controller.signal),
  )
  // Assert
  assert.equal(refusal.code, 'EXPO_WEB_LAUNCHER_FAILED')
  assert.equal(refusal.details?.reason, 'bundle-failed')
  const bundlerLine = String(refusal.details?.bundlerLine)
  assert.match(bundlerLine, /^Unable to resolve module \.\/missing from /)
  assert.equal(bundlerLine.includes('pk-live-abc123xyz'), false)
})

// Value: protects=E-2: a bundle that is never served is not ready and the wait ends at its budget with the wait timeout the run words as the setup deadline; fails_when=readiness passes on the page alone; why_new=deadline; seam=real launcher, fake Metro whose bundle never answers; no_claim=the deadline wording (refusal tests)
test('a Metro that never serves the bundle is not ready before the budget ends', async (context) => {
  // Arrange
  const { controller, started } = await startAdapter(context, {
    mode: 'never-serves-bundle',
  })
  const { app } = await started()
  // Act
  const waiting = EXPO_WEB_DEV_ADAPTER.waitForServerSettled(
    app,
    1_000,
    controller.signal,
  )
  // Assert
  await assert.rejects(waiting, WaitTimeoutError)
})

// Value: protects=DX-3: a CLI that ends while Metro bundles is the exited refusal with its exit code, not a timeout; fails_when=the wait polls to the deadline; why_new=early exit; seam=real launcher, fake CLI exiting 300 ms after listening; no_claim=the journal's masked output
test('an Expo CLI that ends while bundling is refused as exited with its exit code', async (context) => {
  // Arrange
  const { controller, started } = await startAdapter(context, {
    mode: 'exits-while-bundling',
  })
  const { app } = await started()
  // Act
  const refusal = await refusalOf(
    EXPO_WEB_DEV_ADAPTER.waitForServerSettled(app, 10_000, controller.signal),
  )
  // Assert
  assert.equal(refusal.code, 'EXPO_WEB_LAUNCHER_FAILED')
  assert.deepEqual(
    { reason: refusal.details?.reason, exitCode: refusal.details?.exitCode },
    { reason: 'exited', exitCode: 1 },
  )
})

// Value: protects=E-2: an entry page that names two web bundles is not ready (the bundle is ambiguous); fails_when=the first script is chosen; why_new=exactly one web bundle; seam=real launcher, fake Metro; no_claim=the wording
test('an entry page naming two web bundles is not ready', async (context) => {
  // Arrange
  const { controller, started } = await startAdapter(context, {
    mode: 'two-bundles',
  })
  const { app } = await started()
  // Act
  const waiting = EXPO_WEB_DEV_ADAPTER.waitForServerSettled(
    app,
    800,
    controller.signal,
  )
  // Assert
  await assert.rejects(waiting, WaitTimeoutError)
})

// Value: protects=AC 2 and 4: a stop in the app's own source seals from the served bundle and map (the map named by a localhost address is read at the owned origin), under the Expo limits, with the bundle's address and Metro's query kept; fails_when=the map is not read, the limits are today's, or the address loses its query; why_new=seal through the Expo profile; seam=real launcher, fake Metro; no_claim=js-debug's binding (native checks)
test('a stop in the app seals from the served bundle and map under the Expo limits', async (context) => {
  // Arrange
  const { repository, controller, request, started } =
    await startAdapter(context)
  const { app, port } = await started()
  await EXPO_WEB_DEV_ADAPTER.waitForServerSettled(
    app,
    10_000,
    controller.signal,
  )
  // Act
  const sealed = await EXPO_WEB_DEV_ADAPTER.readBundle(
    bundleRequest(repository, request),
  )
  // Assert
  assert.equal(sealed.bundle.source, repository.sourceText)
  assert.equal(
    sealed.bundle.scriptUrl,
    `http://127.0.0.1:${port}${FAKE_BUNDLE_PATH}`,
  )
  assert.equal(sealed.limits, EXPO_WEB_SOURCE_MAP_LIMITS)
})

// Value: protects=E-6: a stop in a file the entry bundle's map does not name is refused as not-in-entry-bundle naming the file; fails_when=another reason, or the stop seals from a map that lacks the file; why_new=lazy route files; seam=real launcher, fake Metro; no_claim=Expo Router async routes themselves
test('a stop in a file the entry bundle does not include is refused as not-in-entry-bundle', async (context) => {
  // Arrange
  const { repository, controller, request, started } = await startAdapter(
    context,
    {
      files: { 'src/app/lazy.tsx': 'export const lazy = 1\n' },
    },
  )
  const { app } = await started()
  await EXPO_WEB_DEV_ADAPTER.waitForServerSettled(
    app,
    10_000,
    controller.signal,
  )
  await repository.write('src/app/lazy.tsx', repository.sourceText)
  // Act
  const refusal = await refusalOf(
    EXPO_WEB_DEV_ADAPTER.readBundle(
      bundleRequest(
        repository,
        request,
        `${repository.appFolder}/src/app/lazy.tsx`,
      ),
    ),
  )
  // Assert
  assert.equal(refusal.code, 'EXPO_WEB_SEAL_FAILED')
  assert.deepEqual(
    { reason: refusal.details?.reason, file: refusal.details?.file },
    { reason: 'not-in-entry-bundle', file: 'apps/app/src/app/lazy.tsx' },
  )
})

// Value: protects=E-7: the js-debug launch fields are the app folder as webRoot with source maps and no override; fails_when=a resolveSourceMapLocations or path override appears (E1c showed the defaults bind); why_new=settled by E1c; seam=pure; no_claim=js-debug itself
test('the browser debug fields are the app folder as webRoot with source maps and nothing else', () => {
  // Arrange
  const workspace = '/repo/apps/app'
  // Act
  const fields = EXPO_WEB_DEV_ADAPTER.browserDebugFields(workspace)
  // Assert
  assert.deepEqual(fields, { webRoot: '/repo/apps/app', sourceMaps: true })
})

// Value: protects=AC 2: closing the run ends the Expo CLI and its worker in one process group; fails_when=a process of the fixture outlives close; why_new=ownership; seam=real launcher; no_claim=Windows process trees
test('close ends the Expo CLI and its worker so no process of the app remains', async (context) => {
  // Arrange
  const { repository, started } = await startAdapter(context)
  const { app } = await started()
  const serverPid = Number(await readFile(repository.pidFile, 'utf8'))
  const workerPid = Number(await readFile(repository.workerPidFile, 'utf8'))
  // Act
  await app.close()
  // Assert
  assert.equal(isProcessGone(serverPid), true)
  assert.equal(isProcessGone(workerPid), true)
})

// Value: protects=E-9: EXPO_PUBLIC values from the .env files and secret-named script assignments are masked in the output tail the run journals, in the text it keeps and in sealed module text; fails_when=a value reaches any of the three; why_new=Expo inlines EXPO_PUBLIC_* into the bundle; seam=real launcher, fake CLI printing the value; no_claim=values the CLI derives itself
test('EXPO_PUBLIC values and secret assignments are masked in the output tail, kept text and module text', async (context) => {
  // Arrange
  const { started } = await startAdapter(context, {
    files: { '.env': 'EXPO_PUBLIC_API_KEY=pk-live-abc123xyz\n' },
    webScript: (port) =>
      `DB_PASSWORD=sw0rdf1sh-987 expo start --web --port ${port}`,
  })
  // Act
  const { app, maskText, maskModuleText } = await started()
  const tail = app.outputTail()
  // Assert
  assert.ok(maskText && maskModuleText)
  assert.match(tail, /Waiting on http:\/\/localhost:/)
  assert.equal(tail.includes('pk-live-abc123xyz'), false)
  assert.equal(
    maskText('key pk-live-abc123xyz pass sw0rdf1sh-987').includes('pk-live'),
    false,
  )
  assert.equal(
    maskText('key pk-live-abc123xyz pass sw0rdf1sh-987').includes('sw0rdf1sh'),
    false,
  )
  assert.equal(
    maskModuleText('const k = "pk-live-abc123xyz"').includes('pk-live'),
    false,
  )
})
