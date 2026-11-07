import assert from 'node:assert/strict'
import {
  appendFile,
  mkdir,
  mkdtemp,
  realpath,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type {
  LibraryPackageFacts,
  PreparedLibraryCore,
} from '../libraryPackage'
import type { LibraryRouteDependencies } from '../libraryRoute'
import { ReactScriptsLibraryRoute } from '../reactScriptsLibraryRoute'
import type { LibraryDependencyRelation } from '../utils/assertLibraryRouteSupported'

import { removeTestFolder } from './utils/removeTestFolder'

const ORIGIN = 'http://localhost:3000'
const BUNDLE_URL = `${ORIGIN}/static/js/bundle.js`
const BUNDLE_HASH = 'a'.repeat(64)

/** Tells the route the test page's origin is the run's own. */
const isOwned = (origin: string): boolean => origin === ORIGIN

const FACTS: LibraryPackageFacts = {
  package: 'redux',
  version: '5.0.1',
  packageRoot: '.',
  revision: 'a'.repeat(40),
  dirty: false,
  packageManager: { name: 'pnpm', version: '11.23.0' },
  buildMs: 7,
  packMs: 3,
  tarballSha256: 'b'.repeat(64),
  installedVersion: '5.0.1',
  reachedThrough: ['@reduxjs/toolkit', 'react-redux'],
  reachedThroughCount: 2,
}

/** Writes a file below a folder, creating its parents, and returns its path. */
async function put(path: string, text = 'export {}\n'): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return path
}

/** One compilation line of the report, as the preload writes it. */
function compilationLine(
  assets: { name: string; sha256: string; resources: string[] }[],
): string {
  return `${JSON.stringify({ compilationHash: 'c1', publicPath: '/', assets })}\n`
}

/** A staged run before `plan`: the repository, the Example, the private folder and a route over fake build seams. */
async function buildRoute(
  context: TestContext,
  overrides: Partial<LibraryRouteDependencies> = {},
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-rs-route-')),
  )
  context.after(() => removeTestFolder(root))
  const appRoot = join(root, 'examples', 'counter')
  const libraryRoot = root
  const privateFolder = join(
    root,
    '..',
    `private-${Date.now()}-${Math.random()}`,
  )
  await mkdir(appRoot, { recursive: true })
  await mkdir(privateFolder, { recursive: true })
  const realPrivateFolder = await realpath(privateFolder)
  context.after(() => removeTestFolder(realPrivateFolder))
  const journal: { type: string; detail?: unknown }[] = []
  const seen: { relations: (LibraryDependencyRelation | undefined)[] } = {
    relations: [],
  }
  const packedRoot = join(realPrivateFolder, 'node_modules', 'redux')
  const dependencies: LibraryRouteDependencies = {
    confirm: async () => true,
    resolveNode: async () => ({
      executable: process.execPath,
      version: '24.0.0',
    }),
    assertSupported: async (inputs) => {
      seen.relations.push(inputs.dependencyRelation)
      return {
        libraryRoot,
        relativeRoot: '.',
        name: 'redux',
        version: '5.0.1',
        peers: [],
        packageManager: {
          ok: true,
          name: 'pnpm',
          version: '11.23.0',
          executable: '/bin/pnpm',
        },
      }
    },
    readManifest: async () => ({ peers: [] }),
    allocatePrivateFolder: async () => realPrivateFolder,
    prepareCore: async (_declared, _roots, prepareDependencies) => {
      seen.relations.push(prepareDependencies.dependencyRelation)
      await mkdir(packedRoot, { recursive: true })
      const prepared: PreparedLibraryCore = {
        facts: FACTS,
        packedRoot,
        peers: [],
        imports: undefined,
        libraryRoot,
        privateFolder: realPrivateFolder,
        dispose: async () => {
          await removeTestFolder(realPrivateFolder)
          return { cleanup: 'removed' }
        },
        failLink: async (sentence) => {
          throw new Error(sentence)
        },
      }
      return prepared
    },
    ...overrides,
  }
  const route = new ReactScriptsLibraryRoute({
    runId: 'run-0001',
    declared: '.',
    workspace: root,
    appRoot,
    appRootRelative: 'examples/counter',
    record: (type, detail) => journal.push({ type, detail }),
    dependencies,
  })
  return {
    root,
    appRoot,
    libraryRoot,
    privateFolder: realPrivateFolder,
    packedRoot,
    reportPath: join(realPrivateFolder, 'report.jsonl'),
    route,
    journal,
    seen,
    controller: new AbortController(),
  }
}

/** A staged run after `plan` and `prepare`. */
async function stage(context: TestContext) {
  const run = await buildRoute(context)
  await run.route.plan(run.controller.signal)
  await run.route.prepare(run.controller.signal)
  return run
}

/** The script the page parses for the bundle, with a hash. */
function bundleScript(scriptId = '1', hash: string | null = BUNDLE_HASH) {
  return {
    url: BUNDLE_URL,
    scriptId,
    ...(hash === null ? {} : { hash }),
    isOwnedOrigin: isOwned,
  }
}

/** The journaled cause of the unreadable observation, or `undefined` when none was journaled. */
function unreadableCauseOf(run: Awaited<ReturnType<typeof stage>>) {
  return run.journal.find(
    (entry) => entry.type === 'library.observation-unreadable',
  )?.detail
}

// protects=a report whose compilation line was never written leaves the page's bundle script unclassified, so the observation is unreadable instead of the stated "not loaded"; fails_when=a script judged against a report without any public path ends complete with loaded false
test('marks the observation unreadable when the report holds no compilation for a parsed bundle script', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(run.reportPath, '{"wrapped":true}\n')
  // Act
  run.route.observeParsedScript(bundleScript())
  await run.route.finalize(true)
  // Assert
  const view = run.route.view()
  assert.equal(view.observation, 'unreadable')
  assert.equal(view.loaded, undefined)
  assert.equal(view.loadCount, undefined)
  assert.deepEqual(unreadableCauseOf(run), { cause: 'no-compilation-report' })
})

// protects=a report error line without any compilation names the preload's message as the cause of the unreadable observation; fails_when=the report error is dropped and the run ends complete
test('names the report error when the preload failed before describing any compilation', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(
    run.reportPath,
    '{"wrapped":true}\n{"reportError":"hash failed"}\n',
  )
  // Act
  run.route.observeParsedScript(bundleScript())
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(unreadableCauseOf(run), {
    cause: 'report-error: hash failed',
  })
})

// protects=compilation lines whose only public path is unusable ('auto') cannot classify scripts, so the observation is unreadable; fails_when=an auto public path lets the script read as foreign and the run ends complete
test('marks the observation unreadable when every compilation public path is unusable', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(
    run.reportPath,
    `{"wrapped":true}\n${JSON.stringify({ compilationHash: 'c1', publicPath: 'auto', assets: [] })}\n`,
  )
  // Act
  run.route.observeParsedScript(bundleScript())
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(unreadableCauseOf(run), { cause: 'no-usable-public-path' })
})

// protects=a script judged before the first compilation line arrived is not turned unreadable once the line names its public path; fails_when=the missing-evidence rule fires although a usable public path is known at the end
test('keeps the observation complete when the compilation line arrives after the page parsed the script', async (context) => {
  // Arrange
  const run = await stage(context)
  const file = await put(join(run.packedRoot, 'dist', 'redux.mjs'))
  await appendFile(run.reportPath, '{"wrapped":true}\n')
  run.route.observeParsedScript(bundleScript('1'))
  await appendFile(
    run.reportPath,
    compilationLine([
      { name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [file] },
    ]),
  )
  // Act
  run.route.observeParsedScript(bundleScript('2'))
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'complete')
  assert.equal(run.route.view().loaded, true)
})

// protects=a run whose page parsed no script (ended before the first compile) keeps its pending observation; fails_when=the missing-evidence rule fires without a parsed script
test('keeps the observation pending when the page parsed no script and the report holds no compilation', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(run.reportPath, '{"wrapped":true}\n')
  // Act
  await run.route.finalize(false)
  // Assert
  assert.equal(run.route.view().observation, 'pending')
  assert.equal(unreadableCauseOf(run), undefined)
})

// protects=an inline script (document URL, no .js path) is no bundle script and cannot make a report without compilations unreadable; fails_when=an inline script counts as missing evidence
test('does not call the observation unreadable for an inline script alone', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(run.reportPath, '{"wrapped":true}\n')
  // Act
  run.route.observeParsedScript({
    url: `${ORIGIN}/`,
    scriptId: '3',
    hash: BUNDLE_HASH,
    isOwnedOrigin: isOwned,
  })
  await run.route.finalize(true)
  // Assert
  assert.equal(unreadableCauseOf(run), undefined)
})

// protects=a normal report with a matched packed asset still ends complete and loaded; fails_when=the missing-evidence rule fires for a report that holds a usable public path
test('keeps a matched packed asset complete and loaded', async (context) => {
  // Arrange
  const run = await stage(context)
  const file = await put(join(run.packedRoot, 'dist', 'redux.mjs'))
  await appendFile(
    run.reportPath,
    `{"wrapped":true}\n${compilationLine([{ name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [file] }])}`,
  )
  // Act
  run.route.observeParsedScript(bundleScript())
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'complete')
  assert.equal(run.route.view().loaded, true)
  assert.equal(run.route.view().loadCount, 1)
})
