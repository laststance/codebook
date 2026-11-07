import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import type {
  LibraryPackageFacts,
  PreparedLibraryCore,
} from '../libraryPackage'
import {
  ViteLibraryRoute,
  isInPackageCopy,
  type ViteLibraryRouteDependencies,
} from '../viteLibraryRoute'

import { removeTestFolder } from './utils/removeTestFolder'

const ORIGIN = 'http://localhost:4321'

/** Tells the route the test page's origin is the run's own. */
const isOwned = (origin: string): boolean => origin === ORIGIN

const FACTS: LibraryPackageFacts = {
  package: '@acme/widgets',
  version: '1.2.0',
  packageRoot: 'packages/widgets',
  revision: 'a'.repeat(40),
  dirty: false,
  packageManager: { name: 'pnpm', version: '10.0.0' },
  buildMs: 7,
  packMs: 3,
  tarballSha256: 'b'.repeat(64),
  installedVersion: '1.1.0',
}

/** Writes a file below a folder, creating its parents, and returns its path. */
async function put(path: string, text = 'export {}\n'): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return path
}

/** A staged run: the repository, the Example, the private folder and a route over fake build seams. */
async function stage(
  context: TestContext,
  overrides: Partial<ViteLibraryRouteDependencies> = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codebook-route-')))
  context.after(() => removeTestFolder(root))
  const appRoot = join(root, 'app')
  const privateFolder = join(root, 'private')
  await mkdir(appRoot, { recursive: true })
  await mkdir(privateFolder, { recursive: true })
  const journal: { type: string; detail?: unknown }[] = []
  const disposed: string[] = []
  const prepared = (): PreparedLibraryCore => ({
    facts: FACTS,
    packedRoot: join(privateFolder, 'node_modules', '@acme', 'widgets'),
    peers: ['react'],
    imports: undefined,
    libraryRoot: join(root, 'packages', 'widgets'),
    privateFolder,
    dispose: async () => {
      disposed.push('core')
      return { cleanup: 'removed' }
    },
    failLink: async (sentence) => {
      throw new Error(sentence)
    },
  })
  const dependencies: ViteLibraryRouteDependencies = {
    confirm: async () => true,
    resolveNode: async () => ({
      executable: process.execPath,
      version: '24.0.0',
    }),
    assertSupported: async () => ({
      libraryRoot: join(root, 'packages', 'widgets'),
      relativeRoot: 'packages/widgets',
      name: '@acme/widgets',
      version: '1.2.0',
      peers: ['react'],
      packageManager: {
        ok: true,
        name: 'pnpm',
        version: '10.0.0',
        executable: '/bin/pnpm',
      },
    }),
    readManifest: async () => ({ peers: ['react', 'react-dom'] }),
    allocatePrivateFolder: async () => privateFolder,
    prepareCore: async () => prepared(),
    writeAnchor: async () => join(privateFolder, 'codebook-anchor.js'),
    ...overrides,
  }
  const route = new ViteLibraryRoute({
    runId: 'run-0001',
    declared: 'packages/widgets',
    workspace: root,
    appRoot,
    appRootRelative: 'app',
    record: (type, detail) => journal.push({ type, detail }),
    dependencies,
  })
  const controller = new AbortController()
  const options = await route.plan(controller.signal)
  await route.prepare(controller.signal)
  return { root, appRoot, privateFolder, route, journal, disposed, options }
}

/** The URL the page announces for a file the dev server serves by absolute path. */
function fsUrl(file: string): string {
  return `${ORIGIN}/@fs${file}?v=abc`
}

// protects=the plan names the package the checks found, fixes the packed root inside the private folder and reads peers from the checked-out library; fails_when=the packed root is outside the private folder or the peers are not the library's; no_claim=a real build (the shared core has its own tests)
test('plans the packed root below the private folder with the library peers', async (context) => {
  // Arrange
  const run = await stage(context)
  // Assert
  assert.equal(run.options.packageName, '@acme/widgets')
  assert.equal(
    run.options.packedRoot,
    join(run.privateFolder, 'node_modules', '@acme', 'widgets'),
  )
  assert.deepEqual(run.options.peers, ['react', 'react-dom'])
  assert.equal(
    run.options.anchorFile,
    join(run.privateFolder, 'codebook-anchor.js'),
  )
})

// protects=a packed module the page parsed makes loaded true with its distinct file count and a complete observation after the page closed; fails_when=packed files are not counted once each or the observation stays pending; no_claim=that the module ran (a parsed script only)
test('counts the distinct packed files the page parsed once the page closed', async (context) => {
  // Arrange
  const run = await stage(context)
  const first = await put(join(run.options.packedRoot, 'dist', 'index.mjs'))
  const second = await put(join(run.options.packedRoot, 'dist', 'slice.mjs'))
  // Act
  run.route.observeScript(fsUrl(first), isOwned)
  run.route.observeScript(fsUrl(first), isOwned)
  run.route.observeScript(fsUrl(second), isOwned)
  run.route.finalize(true)
  // Assert
  const view = run.route.view()
  assert.equal(view.observation, 'complete')
  assert.equal(view.loaded, true)
  assert.equal(view.loadCount, 2)
  assert.equal(view.publishedCopyLoaded, false)
})

// protects=a module that was transformed but never parsed by the page is no evidence: nothing of the package parsed reads built but not served; fails_when=a served-only file counts as loaded; no_claim=the transform hook (the route has none by design)
test('says nothing was served when the page parsed no file of the package', async (context) => {
  // Arrange
  const run = await stage(context)
  await put(join(run.options.packedRoot, 'dist', 'index.mjs'))
  const appFile = await put(join(run.appRoot, 'src', 'main.tsx'))
  // Act
  run.route.observeScript(fsUrl(appFile), isOwned)
  run.route.finalize(true)
  // Assert
  const view = run.route.view()
  assert.equal(view.loaded, false)
  assert.equal(view.loadCount, 0)
  assert.equal(view.publishedCopyLoaded, false)
})

// protects=a file served by pathname from the app root (no /@fs/) is attributed to the app, not to the package; fails_when=the app root is not joined to the pathname; no_claim=none beyond protects
test('attributes a root-relative URL to the app folder', async (context) => {
  // Arrange
  const run = await stage(context)
  const installed = await put(
    join(run.appRoot, 'node_modules', '@acme', 'widgets', 'dist', 'a.js'),
  )
  void installed
  // Act
  run.route.observeScript(
    `${ORIGIN}/node_modules/@acme/widgets/dist/a.js`,
    isOwned,
  )
  run.route.finalize(true)
  // Assert
  const view = run.route.view()
  assert.equal(view.publishedCopyLoaded, true)
  assert.match(
    view.publishedCopyPath ?? '',
    /node_modules\/@acme\/widgets\/dist\/a\.js$/,
  )
})

// protects=another copy parsed between the last stop and the page close still counts and is named; fails_when=the observation ends at the last stop or the copy path is lost; no_claim=which copy the page's code called
test('names the installed copy the page parsed before it closed', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.options.packedRoot, 'dist', 'index.mjs'))
  const installed = await put(
    join(run.appRoot, 'node_modules', '@acme', 'widgets', 'dist', 'index.mjs'),
  )
  // Act
  run.route.observeScript(fsUrl(packed), isOwned)
  run.route.observeScript(fsUrl(installed), isOwned)
  run.route.finalize(true)
  // Assert
  const view = run.route.view()
  assert.equal(view.loaded, true)
  assert.equal(view.publishedCopyLoaded, true)
  assert.equal(view.publishedCopyPath, installed)
})

// protects=an installed copy reached through a link (pnpm) is recognized by its real path; fails_when=the link path is judged instead of the real file; no_claim=Windows junctions
test('recognizes an installed copy reached through a symbolic link', async (context) => {
  // Arrange
  const run = await stage(context)
  const store = await put(
    join(run.root, 'store', 'node_modules', '@acme', 'widgets', 'dist', 'x.js'),
  )
  const { symlink } = await import('node:fs/promises')
  const link = join(run.appRoot, 'linked.js')
  await symlink(store, link)
  // Act
  run.route.observeScript(`${ORIGIN}/linked.js`, isOwned)
  run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().publishedCopyPath, store)
})

// protects=an optimizer chunk whose metadata names a source in an installed copy counts as another copy; fails_when=the chunk is ignored; no_claim=chunks that bundle the package inside another dependency (the metadata names only the entry's own source)
test('counts an optimizer chunk of the installed copy as another copy', async (context) => {
  // Arrange
  const run = await stage(context)
  const source = await put(
    join(run.appRoot, 'node_modules', '@acme', 'widgets', 'dist', 'index.mjs'),
  )
  const deps = join(run.privateFolder, 'vite-cache', 'deps')
  const chunk = await put(join(deps, 'acme_widgets.js'))
  await put(
    join(deps, '_metadata.json'),
    JSON.stringify({
      optimized: { '@acme/widgets': { src: source, file: 'acme_widgets.js' } },
    }),
  )
  // Act
  run.route.observeScript(fsUrl(chunk), isOwned)
  run.route.finalize(true)
  // Assert
  const view = run.route.view()
  assert.equal(view.publishedCopyLoaded, true)
  assert.equal(view.publishedCopyPath, source)
})

// protects=an optimizer chunk of another package is not the library's copy; fails_when=any optimizer chunk counts as another copy; no_claim=none beyond protects
test('does not count an optimizer chunk of another package', async (context) => {
  // Arrange
  const run = await stage(context)
  const source = await put(
    join(run.appRoot, 'node_modules', 'react', 'index.js'),
  )
  const deps = join(run.privateFolder, 'vite-cache', 'deps')
  const chunk = await put(join(deps, 'react.js'))
  await put(
    join(deps, '_metadata.json'),
    JSON.stringify({ optimized: { react: { src: source, file: 'react.js' } } }),
  )
  // Act
  run.route.observeScript(fsUrl(chunk), isOwned)
  run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().publishedCopyLoaded, false)
})

// protects=unreadable optimizer metadata makes the observation unreadable with no loaded fields and a journaled cause, never "not loaded"; fails_when=an unreadable file reads as loaded false or leaves the observation complete; no_claim=none beyond protects
test('marks the observation unreadable when the optimizer metadata cannot be read', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.options.packedRoot, 'dist', 'index.mjs'))
  const chunk = await put(
    join(run.privateFolder, 'vite-cache', 'deps', 'chunk.js'),
  )
  // Act
  run.route.observeScript(fsUrl(packed), isOwned)
  run.route.observeScript(fsUrl(chunk), isOwned)
  run.route.finalize(true)
  // Assert
  const view = run.route.view()
  assert.equal(view.observation, 'unreadable')
  assert.equal('loaded' in view, false)
  assert.equal('publishedCopyLoaded' in view, false)
  assert.ok(
    run.journal.some(
      (entry) => entry.type === 'library.observation-unreadable',
    ),
  )
})

// protects=a page that did not close within the bound leaves the observation incomplete, with counts kept as lower bounds; fails_when=an unclosed page reads complete; no_claim=none beyond protects
test('leaves the observation incomplete when the page did not close', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.options.packedRoot, 'dist', 'index.mjs'))
  run.route.observeScript(fsUrl(packed), isOwned)
  // Act
  run.route.finalize(false)
  // Assert
  const view = run.route.view()
  assert.equal(view.observation, 'incomplete')
  assert.equal(view.loadCount, 1)
})

// protects=a script parsed after the finalization no longer changes the facts; fails_when=late events are counted after the observation was journaled; no_claim=none beyond protects
test('ignores scripts parsed after the observation was finalized', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.options.packedRoot, 'dist', 'index.mjs'))
  run.route.finalize(true)
  // Act
  run.route.observeScript(fsUrl(packed), isOwned)
  // Assert
  assert.equal(run.route.view().loadCount, 0)
})

// protects=a foreign origin and a virtual module are never attributed to a file; fails_when=another site's script counts as the library; no_claim=none beyond protects
test('ignores scripts of another origin and virtual modules', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.options.packedRoot, 'dist', 'index.mjs'))
  // Act
  run.route.observeScript(`http://evil.test/@fs${packed}`, isOwned)
  run.route.observeScript(`${ORIGIN}/@vite/client`, isOwned)
  run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().loaded, false)
})

// protects=the journal states what was prepared and observed in the node-script vocabulary; fails_when=library.prepared or library.observed is missing; no_claim=none beyond protects
test('journals library.prepared and library.observed', async (context) => {
  // Arrange
  const run = await stage(context)
  // Act
  run.route.finalize(true)
  // Assert
  assert.deepEqual(
    run.journal.map((entry) => entry.type),
    ['library.prepared', 'library.observed'],
  )
})

// protects=dispose removes the private folder after the server stopped and reports removed once; fails_when=the core's disposer is not used or runs twice; no_claim=real deletion (the core has its own tests)
test('disposes the prepared library once and reports it removed', async (context) => {
  // Arrange
  const run = await stage(context)
  // Act
  await run.route.dispose()
  await run.route.dispose()
  // Assert
  assert.deepEqual(run.disposed, ['core'])
  assert.equal(run.route.view().cleanup, 'removed')
})

// protects=a declined confirmation throws SCRIPT_NOT_CONFIRMED with sideEffects none and allocates no folder; fails_when=a folder is made or the build starts before the answer; no_claim=the editor dialog (its asker has its own tests)
test('a declined confirmation starts nothing', async (context) => {
  // Arrange
  let allocated = 0
  let built = 0
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codebook-route-')))
  context.after(() => removeTestFolder(root))
  const route = new ViteLibraryRoute({
    runId: 'run-0002',
    declared: 'packages/widgets',
    workspace: root,
    appRoot: root,
    appRootRelative: '.',
    record: () => undefined,
    dependencies: {
      confirm: async () => false,
      resolveNode: async () => ({
        executable: process.execPath,
        version: '24.0.0',
      }),
      assertSupported: async () => ({
        libraryRoot: root,
        relativeRoot: 'packages/widgets',
        name: '@acme/widgets',
        version: '1.2.0',
        peers: [],
        packageManager: {
          ok: true,
          name: 'pnpm',
          version: null,
          executable: '/bin/pnpm',
        },
      }),
      readManifest: async () => ({ peers: [] }),
      allocatePrivateFolder: async () => {
        allocated += 1
        return root
      },
      prepareCore: async () => {
        built += 1
        throw new Error('must not build')
      },
    },
  })
  // Act
  const failure = await route.plan(new AbortController().signal).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'SCRIPT_NOT_CONFIRMED')
  assert.equal(failure.details?.sideEffects, 'none')
  assert.equal(allocated, 0)
  assert.equal(built, 0)
})

// protects=a refusal of the route checks (library not a dependency) surfaces before the learner is asked; fails_when=the dialog opens for a route that cannot run; no_claim=the check list itself (assertLibraryRouteSupported has its own tests)
test('refuses on the route checks before asking the learner', async (context) => {
  // Arrange
  let asked = 0
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codebook-route-')))
  context.after(() => removeTestFolder(root))
  const route = new ViteLibraryRoute({
    runId: 'run-0003',
    declared: 'packages/widgets',
    workspace: root,
    appRoot: root,
    appRootRelative: '.',
    record: () => undefined,
    dependencies: {
      confirm: async () => {
        asked += 1
        return true
      },
      resolveNode: async () => ({
        executable: process.execPath,
        version: '24.0.0',
      }),
      assertSupported: async () => {
        throw new StudyError(
          'LIBRARY_BUILD_UNSUPPORTED',
          'not a dependency',
          undefined,
          undefined,
          undefined,
          { reason: 'not-a-dependency' },
        )
      },
    },
  })
  // Act
  const failure = await route.plan(new AbortController().signal).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.details?.reason, 'not-a-dependency')
  assert.equal(asked, 0)
})

// protects=package copy detection follows path segments, not substrings; fails_when=widgets-extra counts as widgets; no_claim=none beyond protects
test('matches a package copy by whole path segments', () => {
  // Assert
  assert.equal(
    isInPackageCopy('/a/node_modules/@acme/widgets/x.js', '@acme/widgets'),
    true,
  )
  assert.equal(
    isInPackageCopy(
      '/a/node_modules/@acme/widgets-extra/x.js',
      '@acme/widgets',
    ),
    false,
  )
  assert.equal(
    isInPackageCopy('/a/src/@acme/widgets/x.js', '@acme/widgets'),
    false,
  )
})
