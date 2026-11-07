import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type {
  DevelopmentApp,
  DevelopmentServerStart,
} from '../developmentServerAdapter'
import { StudyError } from '../errors'
import { assessViteWorkspace } from '../utils/assessViteWorkspace'
import { launchViteDevelopmentServer } from '../utils/launchViteDevelopmentServer'
import { resolveVitePackage } from '../utils/resolveVitePackage'

import {
  createViteRepository,
  freePort,
  type StubViteBehavior,
} from './utils/createViteRepository'
import { removeTestFolder } from './utils/removeTestFolder'

/** The compiled launcher beside the compiled tests' parent folder. */
const LAUNCHER = join(__dirname, '..', 'viteLauncher.js')

/** The folder of the nested Example below the repository. */
const APP = 'examples/widgets-vite'

/** Whether something answers HTTP on the port now. */
async function isListening(port: number): Promise<boolean> {
  return fetch(`http://127.0.0.1:${port}/`).then(
    () => true,
    () => false,
  )
}

/**
 * Starts the owned launcher over the stub Vite for a library run, with a `prepareLibrary` the test supplies.
 * @returns The start's outcome (settled), the steps the test saw and the app handle.
 */
async function startLibraryRun(
  context: TestContext,
  options: {
    behavior: StubViteBehavior
    prepareLibrary: (
      port: number,
      signal?: AbortSignal,
      app?: DevelopmentApp,
      controller?: AbortController,
    ) => Promise<void>
    factsTimeoutMs?: number
  },
) {
  const repository = await createViteRepository(context)
  const appFolder = join(repository.root, APP)
  await mkdir(appFolder, { recursive: true })
  await writeFile(
    join(appFolder, 'package.json'),
    JSON.stringify({
      name: 'example',
      devDependencies: { vite: '^8.3.5' },
      scripts: { dev: 'vite' },
    }),
  )
  await mkdir(dirname(join(appFolder, 'stub-vite.json')), { recursive: true })
  await writeFile(
    join(appFolder, 'stub-vite.json'),
    JSON.stringify(options.behavior),
  )
  const privateFolder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-lib-')),
  )
  context.after(() => removeTestFolder(privateFolder))
  const controller = new AbortController()
  let app: DevelopmentApp | undefined
  context.after(async () => {
    await app?.close()
  })
  const prepareCalls: string[] = []
  const request: DevelopmentServerStart = {
    workspace: appFolder,
    vitePackage: await resolveVitePackage(repository.root, APP),
    node: process.execPath,
    record: () => undefined,
    inspectServer: false,
    signal: controller.signal,
    alive: () => controller.signal.throwIfAborted(),
    assertPortFree: async () => undefined,
    onDeclaredPort: () => undefined,
    onApp: (value) => {
      app = value
    },
    onStep: () => undefined,
    viteLibrary: {
      packageName: '@acme/widgets',
      packedRoot: join(privateFolder, 'node_modules', '@acme', 'widgets'),
      anchorFile: join(privateFolder, 'codebook-anchor.js'),
      libraryRoot: join(repository.root, 'packages', 'widgets'),
      peers: ['react'],
      privateFolder,
    },
    prepareLibrary: async (signal) => {
      prepareCalls.push('prepare')
      await options.prepareLibrary(
        options.behavior.port,
        signal,
        app,
        controller,
      )
    },
  }
  const workspaceInfo = await assessViteWorkspace(
    appFolder,
    process.execPath,
    controller.signal,
    repository.root,
  )
  const outcome = await launchViteDevelopmentServer(
    request,
    workspaceInfo,
    LAUNCHER,
    options.factsTimeoutMs,
  ).then(
    (started) => ({ started }),
    (error: unknown) => ({ error }),
  )
  return { outcome, prepareCalls, controller }
}

// protects=an alias of the package in the resolved config refuses LIBRARY_BUILD_UNSUPPORTED library-aliased with sideEffects none, names the config entries, and never builds nor listens; fails_when=the build starts, the server listens, or the reason/side effect differs; no_claim=real Vite alias resolution (a stub Vite echoes the config the blockers are read from)
test('refuses an aliased library before anything is built or listening', async (context) => {
  // Arrange
  const port = await freePort()
  // Act
  const run = await startLibraryRun(context, {
    behavior: {
      port,
      config: {
        resolve: { alias: [{ find: '@acme/widgets', replacement: '/x' }] },
      },
    },
    prepareLibrary: async () => undefined,
  })
  // Assert
  assert.ok('error' in run.outcome)
  const error = run.outcome.error
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'LIBRARY_BUILD_UNSUPPORTED')
  assert.equal(error.details?.reason, 'library-aliased')
  assert.equal(error.details?.sideEffects, 'none')
  assert.deepEqual(error.details?.entries, ['@acme/widgets'])
  assert.deepEqual(run.prepareCalls, [])
  assert.equal(await isListening(port), false)
})

// protects=an optimizeDeps.include of the package refuses with library-optimize-include before the build; fails_when=the include is not read from the resolved config or the build starts; no_claim=real optimizer behavior
test('refuses a pre-bundled library before anything is built', async (context) => {
  // Arrange
  const port = await freePort()
  // Act
  const run = await startLibraryRun(context, {
    behavior: {
      port,
      config: { optimizeDeps: { include: ['@acme/widgets/sub'] } },
    },
    prepareLibrary: async () => undefined,
  })
  // Assert
  assert.ok('error' in run.outcome)
  const error = run.outcome.error
  assert.ok(error instanceof StudyError)
  assert.equal(error.details?.reason, 'library-optimize-include')
  assert.equal(error.details?.sideEffects, 'none')
  assert.deepEqual(run.prepareCalls, [])
})

// protects=the library is built after the facts and before the listen: while the build runs nothing listens, and the server listens once it finished; fails_when=the server listens during the build or the build is skipped; no_claim=the build itself (a stub callback)
test('builds the library while the server does not listen, then listens', async (context) => {
  // Arrange
  const port = await freePort()
  let listeningDuringBuild: boolean | undefined
  // Act
  const run = await startLibraryRun(context, {
    behavior: { port },
    prepareLibrary: async (buildPort) => {
      listeningDuringBuild = await isListening(buildPort)
    },
  })
  // Assert
  assert.ok('started' in run.outcome)
  assert.equal(listeningDuringBuild, false)
  assert.deepEqual(run.prepareCalls, ['prepare'])
  assert.equal(await isListening(port), true)
})

// protects=a build slower than the launcher facts bound still starts the server (the facts bound does not run during the build); fails_when=the build time counts against the facts or listen wait; no_claim=the run's own setup deadline (covered in the run test)
test('a build slower than the facts bound still starts the server', async (context) => {
  // Arrange
  const port = await freePort()
  // Act
  const run = await startLibraryRun(context, {
    behavior: { port },
    factsTimeoutMs: 400,
    prepareLibrary: async () => {
      // gstack-timing-ok: the build must outlast the 400 ms facts bound to show the bound does not run during the build
      await new Promise((resolve) => setTimeout(resolve, 900))
    },
  })
  // Assert
  assert.ok('started' in run.outcome)
  assert.equal(await isListening(port), true)
})

// protects=a build failure ends the start with the build's own LIBRARY_BUILD_FAILED and the server never listens; fails_when=the error is replaced or the server listens after a failed build; no_claim=the run's closing of the process (its cleanup test)
test('a failed build ends with its own error and the server never listens', async (context) => {
  // Arrange
  const port = await freePort()
  const failure = new StudyError(
    'LIBRARY_BUILD_FAILED',
    'build failed',
    undefined,
    undefined,
    undefined,
    { reason: 'build-error' },
  )
  // Act
  const run = await startLibraryRun(context, {
    behavior: { port },
    prepareLibrary: async () => {
      throw failure
    },
  })
  // Assert
  assert.ok('error' in run.outcome)
  assert.equal(run.outcome.error, failure)
  assert.equal(await isListening(port), false)
})

/** Ends the launcher process the way a crash does, and waits until the handle reads it as gone. */
async function killLauncher(app: DevelopmentApp | undefined): Promise<void> {
  assert.ok(app?.pid)
  process.kill(app.pid, 'SIGKILL')
  const deadline = Date.now() + 5_000
  while (app.isRunning() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10))
}

// protects=a launcher that exits during a long library build ends the start with VITE_LAUNCHER_FAILED and cancels the build; fails_when=nothing watches the launcher, so the build runs on and the start ends only at the listen; no_claim=the build itself (a stub callback)
test('a launcher that exits during the build ends the start and cancels the build', async (context) => {
  // Arrange
  const port = await freePort()
  let buildWasCancelled = false
  // Act
  const run = await startLibraryRun(context, {
    behavior: { port },
    prepareLibrary: async (_port, signal, app) => {
      await killLauncher(app)
      // A build that is never cancelled would run on; this one gives up after 5 s so a missing watcher fails instead of hanging.
      await new Promise<void>((resolve) => {
        const giveUp = setTimeout(resolve, 5_000)
        signal?.addEventListener('abort', () => {
          buildWasCancelled = true
          clearTimeout(giveUp)
          resolve()
        })
      })
    },
  })
  // Assert
  assert.ok('error' in run.outcome)
  const error = run.outcome.error
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.match(error.message, /exited while the library was being built/)
  assert.equal(buildWasCancelled, true)
})

// protects=a launcher that is gone when the listen is sent reads as VITE_LAUNCHER_FAILED, not a raw send error; fails_when=the send's own Error escapes; no_claim=none beyond protects
test('a launcher gone before the listen ends with a typed launcher failure', async (context) => {
  // Arrange
  const port = await freePort()
  // Act
  const run = await startLibraryRun(context, {
    behavior: { port },
    prepareLibrary: async (_port, _signal, app) => {
      await killLauncher(app)
    },
  })
  // Assert
  assert.ok('error' in run.outcome)
  const error = run.outcome.error
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
})

// Value: protects=a run stopped while its library builds ends with the stop, even when the launcher dies with it; fails_when=the watcher reports VITE_LAUNCHER_FAILED for a launcher the stop itself closed; why_new=the launcher-exit tests never stop the run, so the abort guard was untested; seam=none; no_claim=the build cancellation (the test above)
test('a stop during the build is not reported as a launcher failure', async (context) => {
  // Arrange
  const port = await freePort()
  // Act
  const run = await startLibraryRun(context, {
    behavior: { port },
    prepareLibrary: async (_port, _signal, app, controller) => {
      // The run is stopped and its launcher goes with it.
      controller?.abort(new Error('run stopped'))
      await killLauncher(app)
      // The build ends after the launcher watcher has looked more than once.
      await new Promise((resolve) => setTimeout(resolve, 400))
    },
  })
  // Assert
  assert.ok('error' in run.outcome)
  const error = run.outcome.error
  assert.equal(error instanceof StudyError, false)
  assert.equal((error as Error).message, 'run stopped')
})
