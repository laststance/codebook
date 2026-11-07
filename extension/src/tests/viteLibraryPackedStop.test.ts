import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { PreparedLibraryCore } from '../libraryPackage'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { createViteLibraryModuleSource } from '../utils/createViteLibraryModuleSource'
import { detectPackedLibraryStop } from '../utils/detectPackedLibraryStop'
import { sealViteLibraryStop } from '../utils/sealViteLibraryStop'
import type { ViteLibraryRouteDependencies } from '../viteLibraryRoute'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  NESTED_VITE_LIBRARY_SOURCE_PATH,
  servedViteLibraryModule,
} from './utils/nestedViteWorkspace'
import { removeTestFolder } from './utils/removeTestFolder'

const PACKAGE_ROOT = 'examples/react/basic'
const OPERATION_ACTION = 'repository-operation'
const LIBRARY_FOLDER = 'packages/core'
const LIBRARY_NAME = '@scope/core'
const REVISION = 'a'.repeat(40)
const CLICK: RepositoryOperation = {
  kind: 'click',
  title: 'Toggle',
  selector: '#toggle',
}

/** Copies a value out of the run module's realm. @example plain(view.snapshots) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** The fake seams of the library route over a real private folder: the packed copy exists after the fake build. */
async function libraryDependencies(context: TestContext) {
  const privateFolder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-packed-stop-')),
  )
  context.after(() => removeTestFolder(privateFolder))
  const packedRoot = join(privateFolder, 'node_modules', '@scope', 'core')
  const dependencies: ViteLibraryRouteDependencies = {
    confirm: async () => true,
    resolveNode: async () => ({
      executable: process.execPath,
      version: '24.0.0',
    }),
    assertSupported: async () => ({
      libraryRoot: join(privateFolder, 'library'),
      relativeRoot: LIBRARY_FOLDER,
      name: LIBRARY_NAME,
      version: '1.2.0',
      peers: [],
      packageManager: {
        ok: true,
        name: 'pnpm',
        version: '10.0.0',
        executable: '/bin/pnpm',
      },
    }),
    readManifest: async () => ({ peers: [] }),
    allocatePrivateFolder: async () => privateFolder,
    prepareCore: async (): Promise<PreparedLibraryCore> => {
      await mkdir(packedRoot, { recursive: true })
      return {
        facts: {
          package: LIBRARY_NAME,
          version: '1.2.0',
          packageRoot: LIBRARY_FOLDER,
          revision: REVISION,
          dirty: false,
          packageManager: { name: 'pnpm', version: '10.0.0' },
          buildMs: 5,
          packMs: 2,
          tarballSha256: 'c'.repeat(64),
          installedVersion: '1.1.0',
        },
        packedRoot,
        peers: [],
        imports: undefined,
        libraryRoot: join(privateFolder, 'library'),
        privateFolder,
        dispose: async () => {
          await removeTestFolder(privateFolder)
          return { cleanup: 'removed' }
        },
        failLink: async (sentence) => {
          throw new Error(sentence)
        },
      }
    },
    writeAnchor: async () => join(privateFolder, 'codebook-anchor.js'),
  }
  return { dependencies, packedRoot }
}

/** Opens the run on a nested Vite app that declares the library and a stop in the library's checked-out source. */
async function packedHarness(
  context: TestContext,
  viteLibrary: { listTwice?: boolean } = {},
) {
  const library = await libraryDependencies(context)
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    packageRoot: PACKAGE_ROOT,
    packageApp: { decoyRoot: true, stopsOutside: true },
    sourcePath: NESTED_VITE_LIBRARY_SOURCE_PATH,
    viteLibrary,
    operations: { operations: [CLICK], stopOperations: [1] },
    libraryRoute: {
      declared: LIBRARY_FOLDER,
      dependencies: library.dependencies,
    },
  })
  return { harness, packedRoot: library.packedRoot }
}

/** Catches what a run's preparation rejects with, copied out of the run module's realm. */
async function refusalOf(
  harness: Awaited<ReturnType<typeof packedHarness>>['harness'],
) {
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  return {
    code: Reflect.get(Object(failure), 'code'),
    message: String(Reflect.get(Object(failure), 'message')),
    details: plain(Reflect.get(Object(failure), 'details')),
  }
}

// protects=AC 4 library-source stops: a browser stop in the declared library's checked-out source is sealed against a served module whose map names the checked-out file, pauses with its value and the walk looks at the run's packed copy; fails_when=the stop is refused as outside-package, the walk looks at the checked-out folder or the run does not complete; no_claim=real Vite, js-debug or a real build (E2 proves the mechanism natively)
test('a stop in the declared library source pauses through the packed copy and the walk looks at the packed folder', async (context) => {
  // Arrange
  const { harness, packedRoot } = await packedHarness(context)
  // Act
  await harness.run.prepare()
  harness.run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'the browser stop in the library')
  const values = plain(stop.values)
  await harness.run.continue('browser', stop.pause)
  await waitUntil(() => harness.run.view().status === 'completed', 'completed')
  await harness.run.stop()
  // Assert
  assert.equal(values['value:nextTheme'], 'dark')
  assert.deepEqual(plain(harness.viteLibrary?.walks), [
    { entries: ['/@vite/client', '/src/main.tsx'], libraryFolder: packedRoot },
  ])
  assert.equal(
    harness.viteRequests.sealed[0]?.sourcePath,
    NESTED_VITE_LIBRARY_SOURCE_PATH,
  )
})

// protects=D11 stale on the packed route: a served map whose text differs from the checked-out file is refused before the browser opens with library-build-stale, the packed-build sentence with the revision, and sideEffects partial; fails_when=the workspace sentence (Codebook never builds) or sideEffects none is used; no_claim=the real map rewrite (seal-level test below)
test('a stop whose checked-out file differs from the packed map is refused as library-build-stale with the packed sentence and partial side effects', async (context) => {
  // Arrange
  const { harness } = await packedHarness(context)
  harness.viteLibrary?.setModuleText(
    servedViteLibraryModule('export const stale = true\n', 'const old = 1;'),
  )
  // Act
  const refusal = await refusalOf(harness)
  // Assert
  assert.equal(refusal.code, 'VITE_SEAL_FAILED')
  assert.deepEqual(refusal.details, {
    reason: 'library-build-stale',
    packageRoot: PACKAGE_ROOT,
    library: LIBRARY_NAME,
    file: NESTED_VITE_LIBRARY_SOURCE_PATH,
    sideEffects: 'partial',
  })
  assert.match(
    refusal.message,
    /the packed build of library @scope\/core \(built from revision a{40}\)/,
  )
  assert.doesNotMatch(refusal.message, /never builds/)
  assert.equal(harness.launchConfigurations.length, 0)
})

// protects=D11 not-in-build on the packed route: two served modules that map the stop file are refused as library-not-in-build with the packed sentence and partial side effects; fails_when=the stop is sealed from one of them or the workspace sentence is used; no_claim=a page that never loads the file (that case reads library-build-unmapped no-map)
test('a library file served by two modules is refused as library-not-in-build with the packed sentence', async (context) => {
  // Arrange
  const { harness } = await packedHarness(context, { listTwice: true })
  // Act
  const refusal = await refusalOf(harness)
  // Assert
  assert.equal(refusal.code, 'VITE_SEAL_FAILED')
  assert.equal(refusal.details.reason, 'library-not-in-build')
  assert.equal(refusal.details.sideEffects, 'partial')
  assert.match(refusal.message, /the packed build of library @scope\/core/)
  assert.doesNotMatch(refusal.message, /never builds/)
})

// protects=outside-package kept: a stop outside both the app and the declared library keeps the outside-package refusal before anything starts; fails_when=a file outside the declared library folder is accepted as a library stop; no_claim=links into the library (detector unit test)
test('a stop outside the app and the declared library keeps the outside-package refusal', async (context) => {
  // Arrange
  const outside = 'packages/other/src/b.ts'
  const library = await libraryDependencies(context)
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    packageRoot: PACKAGE_ROOT,
    packageApp: { decoyRoot: true, stopsOutside: true },
    sourcePath: outside,
    operations: { operations: [CLICK], stopOperations: [1] },
    libraryRoute: {
      declared: LIBRARY_FOLDER,
      dependencies: library.dependencies,
    },
  })
  // Act
  const refusal = await refusalOf(harness)
  // Assert
  assert.deepEqual(refusal.details, {
    reason: 'outside-package',
    files: [outside],
    packageRoot: PACKAGE_ROOT,
    sideEffects: 'none',
  })
  assert.deepEqual(harness.viteRequests.started, [])
})

const SEAL_TEXT = 'export const a = 1\nexport const b = 2\n'

/** A served module in the packed copy whose map names the packed `src/a.ts` with the given text (the map rewrite leaves it so where the bytes differ). */
function packedServedModule(sourcesContent: string): string {
  const map = JSON.stringify({
    version: 3,
    sources: ['../src/a.ts'],
    sourcesContent: [sourcesContent],
    names: [],
    mappings: 'AAAA;AACA',
  })
  return `export {}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString('base64')}`
}

// protects=D11 stale for an edited file: when the packed map still names the packed src path because the checked-out text differs, the seal reads library-build-stale, not a missing map; fails_when=the refusal reads library-build-unmapped no-map or loses the packed sentence; no_claim=the launcher's rewrite itself (viteLibraryRedirect tests)
test('seals an edited checked-out file as library-build-stale when the packed map keeps its own src path', async (context) => {
  await expectEditedFileStale(context, false)
})

// protects=D11 stale through a symlinked repository root: the relative path to the packed copy is taken from real paths, so the retry still finds the packed file; fails_when=the retry misses and the refusal reads library-build-unmapped no-map; no_claim=symlinked library folders inside the repository (detection refuses those)
test('seals an edited file as library-build-stale when the repository is opened through a symlink', async (context) => {
  await expectEditedFileStale(context, true)
})

/** Runs the edited-file seal and asserts the stale refusal; `viaSymlink` opens the repository through a link to its real folder. */
async function expectEditedFileStale(
  context: TestContext,
  viaSymlink: boolean,
): Promise<void> {
  // Arrange
  const root = await realpath(await mkdtemp(join(tmpdir(), 'packed-seal-')))
  context.after(() => removeTestFolder(root))
  const linkedRoot = `${root}-link`
  if (viaSymlink) {
    await symlink(root, linkedRoot)
    context.after(() => rm(linkedRoot, { force: true }))
  }
  await mkdir(join(root, 'packages/core/src'), { recursive: true })
  await mkdir(join(root, 'examples/app'), { recursive: true })
  await writeFile(join(root, 'packages/core/src/a.ts'), SEAL_TEXT)
  const packedFolder = join(root, 'private/node_modules/@scope/core')
  const modulePath = `/@fs${packedFolder}/dist/a.mjs`
  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.setHeader('content-type', 'text/html')
      response.end('<script type="module" src="/src/main.tsx"></script>')
      return
    }
    if (request.url?.startsWith(modulePath)) {
      response.setHeader('content-type', 'text/javascript')
      response.end(packedServedModule('export const a = 0\n'))
      return
    }
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const address = server.address()
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  const library = {
    name: LIBRARY_NAME,
    folder: LIBRARY_FOLDER,
    realFolder: packedFolder,
  }
  const moduleSource = createViteLibraryModuleSource({
    ownedOrigin: origin,
    entryPath: '/',
    libraryRealFolder: packedFolder,
    requestWalk: async () => ({
      modules: [`${modulePath}?v=1`],
      optimizedLibrary: false,
    }),
    signal: new AbortController().signal,
  })
  // Act
  const failure = await sealViteLibraryStop({
    appRoot: join(root, 'examples/app'),
    packageRootRelative: 'examples/app',
    library,
    packed: { revision: REVISION },
    repositoryRoot: viaSymlink ? linkedRoot : root,
    source: {
      path: 'packages/core/src/a.ts',
      line: 1,
      column: 1,
      hash: sha256(SEAL_TEXT),
    },
    citationEndLine: 2,
    ownedOrigin: origin,
    moduleSource,
    signal: new AbortController().signal,
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.deepEqual(plain(Reflect.get(Object(failure), 'details')), {
    reason: 'library-build-stale',
    packageRoot: 'examples/app',
    library: LIBRARY_NAME,
    file: 'packages/core/src/a.ts',
    sideEffects: 'partial',
  })
  assert.match(
    String(Reflect.get(Object(failure), 'message')),
    /edited after the build/,
  )
}

// protects=an aborted run stops at detection instead of being treated as a stop outside the packed library; fails_when=detectPackedLibraryStop swallows the abort and resolves undefined; no_claim=cancellation mid-way through the realpath calls
test('rejects with the abort reason when the run is cancelled before detecting a packed library stop', async () => {
  // Arrange
  const controller = new AbortController()
  controller.abort(new Error('run cancelled'))
  // Act
  const outcome = detectPackedLibraryStop(
    '/repo',
    'packages/core',
    'packages/core/src/a.ts',
    controller.signal,
  )
  // Assert
  await assert.rejects(outcome, /run cancelled/)
})

// protects=one library per run: with library declared, a stop in ANOTHER workspace library the app links to (not the declared one, not the app) is refused as outside-package before anything starts; fails_when=the stop is registered through the workspace-library route; no_claim=the workspace route without a declared library (viteLibraryStop tests)
test('a stop in another linked workspace library than the declared one keeps the outside-package refusal', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    packageRoot: PACKAGE_ROOT,
    packageApp: { decoyRoot: true, stopsOutside: true },
    sourcePath: NESTED_VITE_LIBRARY_SOURCE_PATH,
    viteLibrary: {},
    operations: { operations: [CLICK], stopOperations: [1] },
    libraryRoute: {
      declared: 'packages/declared',
      dependencies: library.dependencies,
    },
  })
  // Act
  const refusal = await refusalOf(harness)
  // Assert
  assert.equal(refusal.code, 'VITE_SEAL_FAILED')
  assert.deepEqual(refusal.details, {
    reason: 'outside-package',
    files: [NESTED_VITE_LIBRARY_SOURCE_PATH],
    packageRoot: PACKAGE_ROOT,
    sideEffects: 'none',
  })
  assert.deepEqual(harness.viteRequests.started, [])
})
