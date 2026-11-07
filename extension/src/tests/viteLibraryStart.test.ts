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
    prepareLibrary: (port: number) => Promise<void>
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
    prepareLibrary: async () => {
      prepareCalls.push('prepare')
      await options.prepareLibrary(options.behavior.port)
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
  return { outcome, prepareCalls }
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
