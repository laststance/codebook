import assert from 'node:assert/strict'
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'

import type { PreparedLibraryCore } from '../libraryPackage'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { ViteLibraryRouteDependencies } from '../viteLibraryRoute'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { entryControl } from './utils/entryRenderHarness'
import {
  armedAppServerRun,
  libraryAppServerOptions,
  stageAppServer,
} from './utils/libraryAppServerRunHarness'
import { removeTestFolder } from './utils/removeTestFolder'

const PACKAGE_ROOT = 'examples/web'
const OPERATION_ACTION = 'repository-operation'
const ORIGIN = 'http://localhost:4321'
const PAGE_ASSET = 'static/chunks/main-app.js'
const SERVER_ASSET = 'vendor-chunks/react-redux.js'
const PAGE_HASH = 'a'.repeat(64)
const SERVER_HASH = 'b'.repeat(64)
const CLICK: RepositoryOperation = {
  kind: 'click',
  title: 'Toggle',
  selector: '#toggle',
}

/** Writes a file below a folder, creating its parents, and returns its path. */
async function put(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, 'export {}\n')
  return path
}

/** The fake seams of a Next library run over a real private folder, and what they were asked. */
async function libraryDependencies(
  context: TestContext,
  overrides: Partial<ViteLibraryRouteDependencies> = {},
) {
  const privateFolder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-next-run-')),
  )
  context.after(() => removeTestFolder(privateFolder))
  const packedRoot = join(privateFolder, 'node_modules', 'react-redux')
  const calls: string[] = []
  const dependencies: ViteLibraryRouteDependencies = {
    confirm: async () => {
      calls.push('confirm')
      return true
    },
    resolveNode: async () => ({
      executable: process.execPath,
      version: '24.0.0',
    }),
    assertSupported: async () => ({
      libraryRoot: join(privateFolder, 'library'),
      relativeRoot: '.',
      name: 'react-redux',
      version: '9.3.1',
      peers: [],
      packageManager: {
        ok: true,
        name: 'pnpm',
        version: '11.23.0',
        executable: '/bin/pnpm',
      },
    }),
    readManifest: async () => ({ peers: [] }),
    allocatePrivateFolder: async () => privateFolder,
    prepareCore: async (): Promise<PreparedLibraryCore> => {
      calls.push('prepare')
      await mkdir(packedRoot, { recursive: true })
      return {
        facts: {
          package: 'react-redux',
          version: '9.3.1',
          packageRoot: '.',
          revision: 'a'.repeat(40),
          dirty: false,
          packageManager: { name: 'pnpm', version: '11.23.0' },
          buildMs: 5,
          packMs: 2,
          tarballSha256: 'c'.repeat(64),
          installedVersion: '9.3.0',
        },
        packedRoot,
        peers: [],
        imports: undefined,
        libraryRoot: join(privateFolder, 'library'),
        privateFolder,
        dispose: async () => {
          calls.push('dispose')
          await removeTestFolder(privateFolder)
          return { cleanup: 'removed' }
        },
        failLink: async (sentence) => {
          throw new Error(sentence)
        },
      }
    },
    writeAnchor: async () => join(privateFolder, 'codebook-anchor.js'),
    ...overrides,
  }
  return { dependencies, privateFolder, packedRoot, calls }
}

type Library = Awaited<ReturnType<typeof libraryDependencies>>

/** Opens the harness on a nested Next app that declares the library, with a browser stop, a scripted server session and the readiness request held. */
async function nextLibraryHarness(
  context: TestContext,
  library: Library,
  extra: { applicationCloseFailsOnce?: boolean; holdReadiness?: boolean } = {},
) {
  return configuredRuntimeHarness(context, undefined, [], {
    holdReadiness: true,
    ...extra,
    packageRoot: PACKAGE_ROOT,
    serverRuntime: {},
    operations: { operations: [CLICK], stopOperations: [1] },
    libraryRoute: {
      declared: 'packages/widgets',
      dependencies: library.dependencies,
    },
  })
}

type Harness = Awaited<ReturnType<typeof nextLibraryHarness>>

/** The three folders a Next library run's compilations write to, created below the app. */
async function compilerFolders(harness: Harness) {
  const appRoot = join(await realpath(harness.directory), PACKAGE_ROOT)
  const folders = {
    client: join(appRoot, '.next', 'dev'),
    server: join(appRoot, '.next', 'dev', 'server'),
    edge: join(appRoot, '.next', 'dev', 'server', 'edge'),
  }
  for (const folder of Object.values(folders))
    await mkdir(folder, { recursive: true })
  return folders
}

/** One line of the report as the Next preload writes it. */
function line(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`
}

/**
 * Writes the report a healthy Next run leaves: a `wrapped` line per compiler, a client compilation holding a page chunk and a server compilation whose chunk holds the packed module.
 * @param withWrapped - The compilers that wrote their `wrapped` line.
 */
async function writeReport(
  library: Library,
  folders: Awaited<ReturnType<typeof compilerFolders>>,
  options: { wrapped?: readonly string[]; errorLine?: boolean } = {},
): Promise<void> {
  const packed = await put(join(library.packedRoot, 'dist', 'rsc.mjs'))
  const outputs: Record<string, string> = {
    client: folders.client,
    server: folders.server,
    'edge-server': folders.edge,
  }
  const wrapped = options.wrapped ?? ['server', 'edge-server', 'client']
  const text =
    wrapped
      .map((compiler) =>
        line({ wrapped: true, compiler, outputPath: outputs[compiler] }),
      )
      .join('') +
    (options.errorLine
      ? line({
          error: 'webpack-config was not patched',
          compiler: 'edge-server',
        })
      : '') +
    line({
      compiler: 'client',
      outputPath: folders.client,
      compilationHash: 'h-client',
      publicPath: '/_next/',
      assets: [{ name: PAGE_ASSET, sha256: PAGE_HASH, resources: [] }],
    }) +
    line({
      compiler: 'server',
      outputPath: folders.server,
      compilationHash: 'h-server',
      publicPath: '/_next/',
      assets: [
        { name: SERVER_ASSET, sha256: SERVER_HASH, resources: [packed] },
      ],
    })
  await writeFile(join(library.privateFolder, 'report.jsonl'), text)
}

/** Runs the declared operation to its stop, continues it and waits for completion. */
async function runToCompletion(harness: Harness): Promise<void> {
  harness.run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'the browser stop')
  await harness.run.continue('browser', stop.pause)
  await waitUntil(() => harness.run.view().status === 'completed', 'completed')
}

// Value: protects=a Next library run with browser-only stops still opens the server inspector and has the server debugger attached while the readiness request is open, and the launch carries the preload; fails_when=inspectServer follows the declared server stops only, or the attach waits until after the readiness request; why_new=the server session was attached only for server stops; seam=none; no_claim=real js-debug attach or a real Next start
test('a Next library run with browser-only stops opens the server inspector and attaches before the readiness request', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await nextLibraryHarness(context, library)
  await writeReport(library, await compilerFolders(harness))
  // Act
  const prepared = harness.run.prepare()
  prepared.catch(() => undefined)
  await waitUntil(
    () => harness.readinessRequestHeld(),
    'the readiness request is open',
  )
  const launch = harness.developmentServerLaunchArguments[0]!
  const attachedWhileRequestIsOpen = harness.serverLaunches.length
  harness.releaseReadiness()
  await prepared
  await harness.run.stop()
  // Assert
  assert.equal(launch[3], true)
  assert.equal(
    Reflect.get(Object(launch[8]), 'preloadPath'),
    join(library.privateFolder, 'preload.cjs'),
  )
  assert.equal(attachedWhileRequestIsOpen, 1)
})

// Value: protects=a server chunk the server parsed while Codebook's own readiness request was open, before the run knew the page origin, is counted and the observation ends complete beside the page's chunk; fails_when=server scripts are dropped while the origin is unset, so a loaded library reads not loaded; why_new=only the page's scripts reached the library route; seam=none; no_claim=js-debug's replay timing (native)
test('a Next library run counts the server chunk parsed before the page origin was set', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await nextLibraryHarness(context, library)
  const folders = await compilerFolders(harness)
  await writeReport(library, folders)
  const prepared = harness.run.prepare()
  prepared.catch(() => undefined)
  await waitUntil(
    () => harness.readinessRequestHeld(),
    'the readiness request is open',
  )
  // Act
  harness.server!.announceScript(
    's1',
    pathToFileURL(join(folders.server, SERVER_ASSET)).href,
    SERVER_HASH,
  )
  harness.releaseReadiness()
  await prepared
  harness.announceScript('p1', `${ORIGIN}/_next/${PAGE_ASSET}?v=1`, PAGE_HASH)
  await runToCompletion(harness)
  await harness.run.stop()
  // Assert
  const facts = harness.run.view().library
  assert.deepEqual(
    {
      observation: facts?.observation,
      loaded: facts?.loaded,
      loadCount: facts?.loadCount,
      publishedCopyLoaded: facts?.publishedCopyLoaded,
      cleanup: facts?.cleanup,
    },
    {
      observation: 'complete',
      loaded: true,
      loadCount: 1,
      publishedCopyLoaded: false,
      cleanup: 'removed',
    },
  )
})

// Value: protects=a compiler whose configuration the preload did not wrap ends the run before the first request with the documented partial refusal, and the owned server is stopped; fails_when=the readiness request is sent while a compiler is unwrapped, or the run reads ready; why_new=the react-scripts check ran after the first compile; seam=none; no_claim=real Next timing of the wrapped lines (E1 addendum)
test('an unwrapped compiler refuses the Next library run before the first request', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await nextLibraryHarness(context, library, {
    holdReadiness: false,
  })
  await writeReport(library, await compilerFolders(harness), {
    wrapped: ['server', 'client'],
    errorLine: true,
  })
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await harness.run.stop()
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_UNSUPPORTED_SETTING')
  const details = Reflect.get(Object(failure), 'details')
  assert.equal(details.reason, 'library-redirect-not-applied')
  assert.equal(details.sideEffects, 'partial')
  assert.deepEqual([...details.compilers], ['edge-server'])
  assert.deepEqual(harness.readyEntryPaths, [])
  assert.equal(harness.developmentServerLaunches(), 1)
  assert.ok(harness.releases.includes('application'))
  assert.equal(harness.run.view().library?.cleanup, 'removed')
})

// Value: protects=a Next library run closes the owned page and settles the observation before it stops the server and its debugger, then removes the private folder; fails_when=the server is released before the page, or the folder is removed before the server stopped; why_new=the shell was only run with a page participant; seam=none; no_claim=a real browser or server close
test('a Next library run closes the page before it stops the server', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await nextLibraryHarness(context, library, {
    holdReadiness: false,
  })
  await writeReport(library, await compilerFolders(harness))
  await harness.run.prepare()
  harness.announceScript('p1', `${ORIGIN}/_next/${PAGE_ASSET}?v=1`, PAGE_HASH)
  // Act
  await harness.run.stop()
  // Assert
  const pageAt = harness.releases.indexOf('page')
  const applicationAt = harness.releases.indexOf('application')
  assert.ok(pageAt >= 0 && applicationAt >= 0)
  assert.ok(pageAt < applicationAt)
  assert.equal(harness.run.view().library?.observation, 'complete')
  assert.deepEqual(library.calls, ['confirm', 'prepare', 'dispose'])
})

// Value: protects=a server whose stop failed may still run on the packed copy, so the private folder stays and the facts read pending until the retried Stop removes it; fails_when=the folder is removed while the owned server stop failed; why_new=the Next route is a new owner of the folder; seam=none; no_claim=a real server process (the stand-in application rejects its first close)
test('a failed server stop keeps the Next library private folder until the retried Stop removes it', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await nextLibraryHarness(context, library, {
    holdReadiness: false,
    applicationCloseFailsOnce: true,
  })
  await writeReport(library, await compilerFolders(harness))
  await harness.run.prepare()
  // Act
  const firstStop = await harness.run.stop().then(
    () => undefined,
    (error: unknown) => error,
  )
  const folderAfterFailedStop = await access(library.privateFolder).then(
    () => 'exists',
    () => 'missing',
  )
  const factsAfterFailedStop = harness.run.view().library?.cleanup
  await harness.run.stop()
  // Assert
  assert.notEqual(firstStop, undefined)
  assert.equal(folderAfterFailedStop, 'exists')
  assert.equal(factsAfterFailedStop, 'pending')
  assert.equal(harness.run.view().library?.cleanup, 'removed')
  await assert.rejects(access(library.privateFolder))
})

// Value: protects=a Next app that resolves to the repository root and declares library is refused library-needs-package-root with nothing built, confirmed or started; fails_when=the root app builds the library or starts the server; why_new=the Next route is new; seam=none; no_claim=a literal root packageRoot (the study schema refuses it before a run exists)
test('a Next app that resolves to the repository root and declares library is refused before anything starts', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    packageRoot: PACKAGE_ROOT,
    packageApp: { declared: 'root-alias', decoyRoot: true },
    operations: { operations: [CLICK], stopOperations: [1] },
    libraryRoute: {
      declared: 'packages/widgets',
      dependencies: library.dependencies,
    },
  })
  // The declared folder is a link to the repository root, so the app is the root app.
  await removeTestFolder(join(harness.directory, 'root-alias'))
  await symlink(
    await realpath(harness.directory),
    join(harness.directory, 'root-alias'),
  )
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    Reflect.get(Object(failure), 'code'),
    'LIBRARY_BUILD_UNSUPPORTED',
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(Reflect.get(Object(failure), 'details'))),
    { reason: 'library-needs-package-root', sideEffects: 'none' },
  )
  assert.equal(harness.developmentServerLaunches(), 0)
  assert.deepEqual(library.calls, [])
})

// Value: protects=a stop in the declared library's own source on a run that declares library is refused before the confirmation, the build and the server, with the documented reason, library name and file; fails_when=the stop is frozen against the checked-out library's build, or the refusal comes after the build; why_new=D13/D19 seam in the Next package resolution; seam=none; no_claim=a stop in a library the run does not declare (kept by the next test)
test('a library-source stop of a declared-library run is refused before the build', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await configuredRuntimeHarness(
    context,
    entryControl(context),
    [],
    {
      ...libraryAppServerOptions(stageAppServer()),
      libraryRoute: {
        declared: 'packages/lib',
        dependencies: library.dependencies,
      },
    },
  )
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await harness.run.stop()
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  const details = JSON.parse(
    JSON.stringify(Reflect.get(Object(failure), 'details')),
  )
  assert.equal(details.reason, 'library-stop-unsupported')
  assert.equal(details.file, 'packages/lib/src/core.ts')
  assert.equal(details.sideEffects, 'none')
  assert.equal(harness.developmentServerLaunches(), 0)
  assert.deepEqual(library.calls, [])
})

// Value: protects=a stop in a workspace library of a run that does not declare library still freezes against the library's build and arms, as before the Next library route; fails_when=the library-stop refusal reaches a run without library; why_new=D19 changes the isHandled callback of the same resolver; seam=none; no_claim=the library stop's pause (covered by the libraryAppRouterServerStop tests)
test('a library-source stop of a run without library still freezes and arms', async (context) => {
  // Arrange and Act
  const { harness, prepared } = await armedAppServerRun(
    context,
    stageAppServer(),
  )
  prepared.catch(() => undefined)
  // Assert
  assert.equal(harness.developmentServerLaunches(), 1)
  assert.equal(harness.run.view().failures.length, 0)
  await harness.run.stop()
})
