import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import { REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES } from '../constants'
import type { DevelopmentBundleRequest } from '../developmentServerAdapter'
import { StudyError } from '../errors'
import { REACT_SCRIPTS_DEV_ADAPTER } from '../reactScriptsDevAdapter'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { awaitReactScriptsFirstCompile } from '../utils/awaitReactScriptsFirstCompile'
import { reactScriptsPublicPathOf } from '../utils/reactScriptsPublicPath'
import {
  ReactScriptsBundleCache,
  ReactScriptsBundleNotReadyError,
  readReactScriptsServedBundle,
} from '../utils/readReactScriptsServedBundle'
import { sealReactScriptsStop } from '../utils/sealReactScriptsStop'

import {
  createReactScriptsRepository,
  reactScriptsStartRequest,
  serveFakeBundle,
  type ReactScriptsFixtureOptions,
  type ReactScriptsRepository,
} from './utils/reactScriptsFixture'

/** Starts the adapter on a staged fake app and closes the server when the test ends. */
async function startAdapter(
  context: TestContext,
  options: ReactScriptsFixtureOptions = {},
  prepare: (repository: ReactScriptsRepository) => Promise<void> = async () =>
    undefined,
) {
  const repository = await createReactScriptsRepository(context, options)
  await prepare(repository)
  const controller = new AbortController()
  const { request, handle } = await reactScriptsStartRequest(
    repository,
    controller.signal,
  )
  context.after(async () => {
    await handle.app?.close()
  })
  return {
    repository,
    controller,
    request,
    started: () => REACT_SCRIPTS_DEV_ADAPTER.start(request),
  }
}

/** Builds the seal request of the stop in `src/App.js` for a started app. */
function bundleRequest(
  repository: ReactScriptsRepository,
  request: Awaited<ReturnType<typeof startAdapter>>['request'],
  origin: string,
): DevelopmentBundleRequest {
  return {
    workspace: repository.root,
    reactScriptsPackage: request.reactScriptsPackage!,
    source: {
      path: `${repository.appFolder}/src/App.js`,
      hash: repository.sourceHash,
      line: 2,
      column: 1,
    },
    citationEndLine: 3,
    signal: new AbortController().signal,
    entryPath: '/',
    execution: 'browser',
    ownedOrigin: origin,
    record: () => undefined,
  }
}

/** Reads the reason of the refusal a promise ended with. */
async function refusalReasonOf(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  assert.ok(error instanceof StudyError, String(error))
  return error.details?.reason ?? error.code
}

/** Starts the app, waits until it is settled and seals the stop; returns the sealed bundle and the launch. */
async function startAndSeal(
  context: TestContext,
  options: ReactScriptsFixtureOptions,
  prepare?: (repository: ReactScriptsRepository) => Promise<void>,
) {
  const { repository, controller, request, started } = await startAdapter(
    context,
    options,
    prepare,
  )
  const launch = await started()
  await launch.app.ready(controller.signal)
  await REACT_SCRIPTS_DEV_ADAPTER.waitForServerSettled(
    launch.app,
    10_000,
    controller.signal,
  )
  const sealed = await REACT_SCRIPTS_DEV_ADAPTER.readBundle(
    bundleRequest(repository, request, `http://127.0.0.1:${launch.port}`),
  )
  return { repository, launch, sealed }
}

// Value: protects=a first compile with warnings (react-scripts prints no origin line) is ready, not a setup-deadline after 90 s; fails_when=readiness waits only for the printed origin URL; no_claim=real react-scripts output of a warnings compile (native check)
test('an app whose first compile has warnings is ready, settled and sealed well before the deadline', async (context) => {
  // Arrange
  const startedAtMs = performance.now()
  // Act
  const { launch, sealed } = await startAndSeal(
    context,
    { mode: 'warnings' },
    undefined,
  )
  // Assert
  assert.equal(launch.app.isRunning(), true)
  assert.equal(sealed.bundle.source.includes('const count = 1'), true)
  // gstack-timing-ok: the bound is the contract; a warnings compile is ready in about a second, and readiness that waited for the origin line would end only at the 90 s setup deadline, so 20 s leaves a wide margin under load
  assert.ok(performance.now() - startedAtMs < 20_000)
})

// Value: protects=a homepage moves the served bundle and the run still reaches ready and seals the stop at that path; fails_when=the bundle is read from a fixed /static/js/bundle.js; no_claim=a deployed homepage on another host
test('an app with a homepage is ready and its stop seals from the bundle under that path', async (context) => {
  // Arrange
  const options = { homepage: 'https://example.com/app', publicPath: '/app/' }
  // Act
  const { launch, sealed } = await startAndSeal(context, options)
  // Assert
  assert.equal(
    sealed.bundle.scriptUrl,
    `http://127.0.0.1:${launch.port}/app/static/js/bundle.js`,
  )
})

// Value: protects=a PUBLIC_URL in the app's .env wins over the homepage and moves the served bundle; fails_when=PUBLIC_URL of an .env file is ignored; no_claim=PUBLIC_URL set only in the shell of the learner
test('an app with PUBLIC_URL in its env file is ready and its stop seals from the bundle under that path', async (context) => {
  // Arrange
  const options = { homepage: '/ignored', publicPath: '/preview/' }
  // Act
  const { launch, sealed } = await startAndSeal(
    context,
    options,
    (repository) => repository.write('.env', 'PUBLIC_URL=/preview\n'),
  )
  // Assert
  assert.equal(
    sealed.bundle.scriptUrl,
    `http://127.0.0.1:${launch.port}/preview/static/js/bundle.js`,
  )
})

// Value: protects=the public path is computed as react-dev-utils does in development; fails_when=a relative homepage, a URL homepage or PUBLIC_URL gives another path; no_claim=react-scripts production builds
test('the development public path follows react-dev-utils for homepage and PUBLIC_URL', () => {
  // Arrange
  const cases: [string | undefined, string | undefined, string][] = [
    [undefined, undefined, '/'],
    ['.', undefined, '/'],
    ['./app', undefined, '/'],
    ['https://example.com/app', undefined, '/app/'],
    ['/app/', undefined, '/app/'],
    ['/app', '/preview', '/preview/'],
    ['/app', 'https://cdn.example.com/x', '/x/'],
    [undefined, '.', '/'],
  ]
  // Act
  const paths = cases.map(([homepage, publicUrl]) =>
    reactScriptsPublicPathOf(homepage, publicUrl),
  )
  // Assert
  assert.deepEqual(
    paths,
    cases.map(([, , expected]) => expected),
  )
})

// Value: protects=HTTPS=true (script or env file) is refused before any process starts, because the server cannot be observed over http; fails_when=the app is started and the run waits for a deadline; no_claim=HTTPS set only in the learner's shell
test('HTTPS=true in an env file is refused with reason https, and in the start script as a refused start-script form, before anything starts', async (context) => {
  // Arrange
  const scripted = await startAdapter(context, {
    startScript: (port) => `HTTPS=true PORT=${port} react-scripts start`,
  })
  const filed = await startAdapter(context, {}, (repository) =>
    repository.write('.env.local', 'HTTPS=true\n'),
  )
  // Act
  const scriptedReason = await refusalReasonOf(scripted.started())
  const filedReason = await refusalReasonOf(filed.started())
  // Assert
  // An HTTPS assignment in the start script is a refused start-script form (codebook_status shows it too); one in an env file is only known at the start.
  assert.equal(scriptedReason, 'start-script-not-react-scripts')
  assert.equal(filedReason, 'https')
  await assert.rejects(access(scripted.repository.pidFile))
  await assert.rejects(access(filed.repository.pidFile))
})

// Value: protects=secret-named and REACT_APP_* values of the app's .env files are masked in the bundle text the run archives; fails_when=only start-script assignments are masked; no_claim=values react-scripts inlines from the real shell environment
test('env file secrets inlined in the bundle are masked in the archived bundle text', async (context) => {
  // Arrange
  const secret = 'sk-live-secret-value-123'
  const { launch, sealed } = await startAndSeal(
    context,
    { bundleLiteral: `${secret}|https://private.example.com/api` },
    (repository) =>
      repository.write(
        '.env',
        `REACT_APP_API_KEY=${secret}\nREACT_APP_BACKEND=https://private.example.com/api\n`,
      ),
  )
  // Act
  assert.ok(launch.maskModuleText)
  const archived = launch.maskModuleText(sealed.bundle.javascript)
  // Assert
  assert.equal(sealed.bundle.javascript.includes(secret), true)
  assert.equal(archived.includes(secret), false)
  assert.equal(archived.includes('private.example.com'), false)
})

// Value: protects=a value reached through a chain of .env references is masked in the archived bundle, as react-scripts inlines the final value; fails_when=the bundle text keeps synthetic-only-value; no_claim=values from the learner's real shell
test('a REACT_APP_ value reached through a chain of references is masked in the archived bundle text', async (context) => {
  // Arrange
  const secret = 'synthetic-only-value'
  const { launch, sealed } = await startAndSeal(
    context,
    { bundleLiteral: secret },
    (repository) =>
      repository.write(
        '.env',
        `REACT_APP_TOKEN=$ALIAS\nALIAS=$BASE\nBASE=${secret}\n`,
      ),
  )
  // Act
  assert.ok(launch.maskModuleText)
  const archived = launch.maskModuleText(sealed.bundle.javascript)
  // Assert
  assert.equal(sealed.bundle.javascript.includes(secret), true)
  assert.equal(archived.includes(secret), false)
})

// Value: protects=react-scripts selects client env with /^REACT_APP_/i, so a lowercase name is inlined and must be masked; fails_when=react_app_lower stays in the archived bundle; no_claim=names react-scripts does not inline
test('a lowercase react_app_ value is masked in the archived bundle text', async (context) => {
  // Arrange
  const secret = 'synthetic-lower-value'
  const { launch, sealed } = await startAndSeal(
    context,
    { bundleLiteral: secret },
    (repository) => repository.write('.env', `react_app_lower=${secret}\n`),
  )
  // Act
  assert.ok(launch.maskModuleText)
  const archived = launch.maskModuleText(sealed.bundle.javascript)
  // Assert
  assert.equal(sealed.bundle.javascript.includes(secret), true)
  assert.equal(archived.includes(secret), false)
})

// Value: protects=an .env over the size limit, which react-scripts still reads, refuses before anything starts instead of leaving its values unmasked; fails_when=the app starts or the reason is not env-file-unreadable; no_claim=the wording
test('an .env file over the limit is refused with reason env-file-unreadable before anything starts', async (context) => {
  // Arrange
  const oversized = await startAdapter(context, {}, (repository) =>
    repository.write(
      '.env',
      `REACT_APP_KEY=${'x'.repeat(REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES)}\n`,
    ),
  )
  // Act
  const error = await oversized.started().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'REACT_SCRIPTS_UNSUPPORTED')
  assert.equal(error.details?.reason, 'env-file-unreadable')
  assert.equal(error.details?.sideEffects, 'none')
  assert.match(error.message, /\.env/)
  await assert.rejects(access(oversized.repository.pidFile))
})

// Value: protects=an .env that is a FIFO never hangs the extension host and is refused; fails_when=the read waits for a writer or the app starts; no_claim=sockets and devices (same branch)
test('an .env file that is a FIFO is refused promptly instead of hanging', async (context) => {
  // Arrange
  if (process.platform === 'win32') {
    context.skip('FIFOs do not exist on Windows')
    return
  }
  const fifo = await startAdapter(context, {}, async (repository) => {
    await promisify(execFile)('mkfifo', [join(repository.appRoot, '.env')])
  })
  // Act
  const error = await fifo.started().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.details?.reason, 'env-file-unreadable')
  assert.equal(error.details?.sideEffects, 'none')
  await assert.rejects(access(fifo.repository.pidFile))
})

// Value: protects=a redirecting entry page is not followed and a page over the entry limit is not scanned, so the app is not ready from either; fails_when=the entry fetch follows a redirect or reads an unbounded body; no_claim=the real dev server's own redirects
test('an entry page that redirects or exceeds the size limit is not ready and is not followed', async (context) => {
  // Arrange
  const redirecting = await serveFakeBundle(context, () => ({}), {
    entry: 'redirect',
  })
  const huge = await serveFakeBundle(context, () => ({}), { entry: 'huge' })
  const signal = new AbortController().signal
  // Act
  const redirectedRead = readReactScriptsServedBundle(
    redirecting.origin,
    signal,
    new ReactScriptsBundleCache(),
  )
  const hugeRead = readReactScriptsServedBundle(
    huge.origin,
    signal,
    new ReactScriptsBundleCache(),
  )
  // Assert
  await assert.rejects(redirectedRead, ReactScriptsBundleNotReadyError)
  await assert.rejects(hugeRead, ReactScriptsBundleNotReadyError)
  assert.equal(redirecting.counts.redirected, 0)
  assert.equal(huge.counts.bundle, 0)
})

// Value: protects=a connection reset while the bundle body is read is the retryable not-ready error and only invalid UTF-8 is map-unreadable; fails_when=every body read failure is reported as not valid UTF-8; no_claim=resets of the map body
test('a reset during the bundle body is not ready, and a non-UTF-8 bundle is map-unreadable', async (context) => {
  // Arrange
  const resetting = await serveFakeBundle(context, () => ({}), {
    bundle: 'reset',
  })
  const invalid = await serveFakeBundle(context, () => ({}), {
    bundle: 'invalid-utf8',
  })
  const signal = new AbortController().signal
  // Act
  const resetRead = readReactScriptsServedBundle(
    resetting.origin,
    signal,
    new ReactScriptsBundleCache(),
  )
  const invalidReason = await refusalReasonOf(
    readReactScriptsServedBundle(
      invalid.origin,
      signal,
      new ReactScriptsBundleCache(),
    ),
  )
  // Assert
  await assert.rejects(resetRead, ReactScriptsBundleNotReadyError)
  assert.equal(invalidReason, 'map-unreadable')
})

// Value: protects=an entry body cut short during the first compile is polled again until the page is whole; fails_when=a failed response body read ends the wait with an error; no_claim=how long a real compile takes
test('the first-compile wait retries an entry page cut short and then succeeds', async (context) => {
  // Arrange
  const stopPath = '/unused/src/App.js'
  const served = await serveFakeBundle(
    context,
    () => ({ sources: [stopPath], sourcesContent: ['x'] }),
    { entry: 'reset-once' },
  )
  const cache = new ReactScriptsBundleCache()
  // Act
  await awaitReactScriptsFirstCompile(
    served.origin,
    cache,
    10_000,
    new AbortController().signal,
  )
  // Assert
  assert.equal(served.counts.entry >= 2, true)
  assert.equal(cache.entry !== undefined, true)
})

// Value: protects=the first-compile wait ends with its own budget even when a request hangs; fails_when=one hung request keeps the wait for the 15 s fetch limit; no_claim=the length of a real hang
test('the first-compile wait ends near its budget when the entry request hangs', async (context) => {
  // Arrange
  const served = await serveFakeBundle(context, () => ({}), { entry: 'hang' })
  const startedAtMs = performance.now()
  // Act
  const waiting = awaitReactScriptsFirstCompile(
    served.origin,
    new ReactScriptsBundleCache(),
    600,
    new AbortController().signal,
  )
  // Assert
  await assert.rejects(waiting, WaitTimeoutError)
  // gstack-timing-ok: the bound is the contract; the wait has a 600 ms budget and must end near it instead of waiting on the hung entry request, so 5 s leaves a wide margin under load
  assert.ok(performance.now() - startedAtMs < 5_000)
})

// Value: protects=a cached map that no longer matches an edited file is read once more before SOURCE_CHANGED, so an unchanged bundle with a changed map seals; fails_when=the stale cached map refuses an edit the server already compiled; no_claim=a real recompile changing the bundle bytes
test('a stop sealed from a cached map refetches the map once when the checked-out file changed', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const stopPath = join(repository.appRoot, 'src/App.js')
  let compiledText = repository.sourceText
  const served = await serveFakeBundle(context, () => ({
    sources: [stopPath],
    sourcesContent: [compiledText],
  }))
  const cache = new ReactScriptsBundleCache()
  const sealWith = (text: string) =>
    sealReactScriptsStop({
      appRoot: repository.appRoot,
      packageRootRelative: repository.appFolder,
      packageRelativePath: 'src/App.js',
      source: {
        path: `${repository.appFolder}/src/App.js`,
        hash: sha256(text),
        line: 2,
        column: 1,
      },
      citationEndLine: 3,
      ownedOrigin: served.origin,
      signal: new AbortController().signal,
      cache,
    })
  await sealWith(repository.sourceText)
  const editedText = repository.sourceText.replace('count = 1', 'count = 2')
  await repository.write('src/App.js', editedText)
  compiledText = editedText
  // Act
  const sealed = await sealWith(editedText)
  // Assert
  assert.equal(sealed.bundle.source, editedText)
  assert.equal(served.counts.map, 2)
})

// Value: protects=a map that really differs from the checked-out file is still refused after the one refetch; fails_when=the refetch hides a real SOURCE_CHANGED; no_claim=edits made while paused
test('a stop whose refetched map still differs from the file is refused with SOURCE_CHANGED', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const stopPath = join(repository.appRoot, 'src/App.js')
  const served = await serveFakeBundle(context, () => ({
    sources: [stopPath],
    sourcesContent: [repository.sourceText],
  }))
  const cache = new ReactScriptsBundleCache()
  const editedText = repository.sourceText.replace('count = 1', 'count = 2')
  await repository.write('src/App.js', editedText)
  const sealing = () =>
    sealReactScriptsStop({
      appRoot: repository.appRoot,
      packageRootRelative: repository.appFolder,
      packageRelativePath: 'src/App.js',
      source: {
        path: `${repository.appFolder}/src/App.js`,
        hash: sha256(editedText),
        line: 2,
        column: 1,
      },
      citationEndLine: 3,
      ownedOrigin: served.origin,
      signal: new AbortController().signal,
      cache,
    })
  // Act
  const first = await refusalReasonOf(sealing())
  const second = await refusalReasonOf(sealing())
  // Assert
  assert.equal(first, 'SOURCE_CHANGED')
  assert.equal(second, 'SOURCE_CHANGED')
})

// Value: protects=a read for an origin no run of the adapter started keeps no cache, so no entry outlives a run; fails_when=readBundle stores a cache by origin string; no_claim=caches of started runs, which close drops
test('a seal read for an origin no run started keeps nothing between two reads', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const stopPath = join(repository.appRoot, 'src/App.js')
  const served = await serveFakeBundle(context, () => ({
    sources: [stopPath],
    sourcesContent: [repository.sourceText],
  }))
  const controller = new AbortController()
  const { request } = await reactScriptsStartRequest(
    repository,
    controller.signal,
  )
  const sealRequest = bundleRequest(repository, request, served.origin)
  // Act
  await REACT_SCRIPTS_DEV_ADAPTER.readBundle(sealRequest)
  await REACT_SCRIPTS_DEV_ADAPTER.readBundle(sealRequest)
  // Assert
  assert.equal(served.counts.map, 2)
})

// Value: protects=a busy-port line printed just before the process exits is read before the ending is worded; fails_when=the exit is classified before the output is drained and reads as exited; no_claim=ordering of real react-scripts output
test('a busy-port line that arrives after the process exited is still refused as port-in-use', async (context) => {
  // Arrange
  const { started } = await startAdapter(context, {
    mode: 'port-conflict-after-exit',
  })
  // Act
  const reason = await refusalReasonOf(started())
  // Assert
  assert.equal(reason, 'port-in-use')
})
