import assert from 'node:assert/strict'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
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

// protects=the react-scripts route asks for the installed-dependency relation twice (the checks and the shared build core) and writes the anchor manifest, the anchor folder and a preload; fails_when=the relation is left at direct or a file is missing
test('plans with the direct-or-installed relation and writes the preload files into the private folder', async (context) => {
  // Arrange
  const run = await stage(context)
  // Act
  const preload = await readFile(run.route.preloadPath(), 'utf8')
  const manifest: unknown = JSON.parse(
    await readFile(join(run.privateFolder, 'package.json'), 'utf8'),
  )
  // Assert
  assert.deepEqual(run.seen.relations, [
    'direct-or-installed',
    'direct-or-installed',
  ])
  assert.deepEqual(manifest, {
    name: 'codebook-library-anchor',
    private: true,
  })
  assert.equal(
    (await stat(join(run.privateFolder, 'anchor'))).isDirectory(),
    true,
  )
  assert.equal(run.route.preloadPath(), join(run.privateFolder, 'preload.cjs'))
  assert.match(preload, /^const CONFIG = \{"packageName":"redux"/)
  assert.match(preload, /"reportPath":"[^"]*report\.jsonl"/)
})

// protects=a matched asset whose files lie in the packed folder makes loaded true, complete after the page closed, and the facts carry the declared-by relation; fails_when=the hash match, the packed classification or reachedThrough is lost
test('counts the packed files of the bundle the page parsed and reports the declared relation', async (context) => {
  // Arrange
  const run = await stage(context)
  const file = await put(join(run.packedRoot, 'dist', 'redux.mjs'))
  await appendFile(
    run.reportPath,
    `{"wrapped":true}\n${compilationLine([{ name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [file] }])}`,
  )
  // Act
  run.route.assertRedirectApplied()
  run.route.observeParsedScript(bundleScript())
  run.route.observeParsedScript(bundleScript())
  await run.route.finalize(true)
  // Assert
  const view = run.route.view()
  assert.equal(view.observation, 'complete')
  assert.equal(view.loaded, true)
  assert.equal(view.loadCount, 1)
  assert.equal(view.publishedCopyLoaded, false)
  assert.deepEqual(view.reachedThrough, ['@reduxjs/toolkit', 'react-redux'])
  assert.equal(view.reachedThroughCount, 2)
})

// protects=another copy of the library in the same bundle is reported as a published copy and the first one is kept; fails_when=a node_modules copy in a matched asset is not seen
test('reports an installed copy of the library inside a matched bundle', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'redux.mjs'))
  const installed = await put(
    join(run.appRoot, 'node_modules', 'redux', 'dist', 'redux.mjs'),
  )
  await appendFile(
    run.reportPath,
    `{"wrapped":true}\n${compilationLine([{ name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [packed, installed] }])}`,
  )
  // Act
  run.route.observeParsedScript(bundleScript())
  await run.route.finalize(true)
  // Assert
  const view = run.route.view()
  assert.equal(view.observation, 'complete')
  assert.equal(view.loaded, true)
  assert.equal(view.publishedCopyLoaded, true)
  assert.equal(view.publishedCopyPath, installed)
})

// protects=the library folder's own node_modules and the Example's own files are no other copy; fails_when=a dependency of the library reads as a published copy
test('does not count the library own node_modules or the Example files as another copy', async (context) => {
  // Arrange
  const run = await stage(context)
  const packed = await put(join(run.packedRoot, 'dist', 'redux.mjs'))
  const dependency = await put(
    join(run.libraryRoot, 'node_modules', 'immer', 'index.js'),
  )
  const exampleFile = await put(join(run.appRoot, 'src', 'index.js'))
  await appendFile(
    run.reportPath,
    `{"wrapped":true}\n${compilationLine([{ name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [packed, dependency, exampleFile] }])}`,
  )
  // Act
  run.route.observeParsedScript(bundleScript())
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().publishedCopyLoaded, false)
  assert.equal(run.route.view().observation, 'complete')
})

// protects=an owned script that matches no asset of the report makes the observation unreadable instead of claiming not loaded; fails_when=an unmatched owned script is ignored
test('marks the observation unreadable for an owned script that matches no report asset', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(
    run.reportPath,
    `{"wrapped":true}\n${compilationLine([{ name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [] }])}`,
  )
  // Act
  run.route.observeParsedScript(bundleScript('1', 'f'.repeat(64)))
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(
    run.journal.find((entry) => entry.type === 'library.observation-unreadable')
      ?.detail,
    { cause: 'script-matches-no-asset' },
  )
})

// protects=a script the debugger gave no hash cannot be tied to an asset and makes the observation unreadable (no source-reading fallback); fails_when=a hashless script is matched by name
test('marks the observation unreadable for an owned script without a hash', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(
    run.reportPath,
    `{"wrapped":true}\n${compilationLine([{ name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [] }])}`,
  )
  // Act
  run.route.observeParsedScript(bundleScript('1', null))
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(
    run.journal.find((entry) => entry.type === 'library.observation-unreadable')
      ?.detail,
    { cause: 'script-without-hash' },
  )
})

// protects=a malformed report line makes the observation unreadable; fails_when=a broken report is read as no evidence
test('marks the observation unreadable when the report holds a malformed line', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(run.reportPath, '{"wrapped":true}\n{oops\n')
  // Act
  run.route.observeParsedScript(bundleScript())
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
})

// protects=a script of a foreign origin is ignored and a run whose page never opened stays pending; fails_when=a foreign script counts as the page
test('keeps the observation pending when no script of the own origin was parsed', async (context) => {
  // Arrange
  const run = await stage(context)
  // Act
  run.route.observeParsedScript({
    url: 'https://example.com/a.js',
    scriptId: '9',
    hash: BUNDLE_HASH,
    isOwnedOrigin: isOwned,
  })
  await run.route.finalize(false)
  // Assert
  assert.equal(run.route.view().observation, 'pending')
})

// protects=a script parsed while the report's last line was still being written is judged after the line ended; fails_when=the unterminated line makes the script unreadable or lost
test('waits for the unterminated last report line and then matches the script', async (context) => {
  // Arrange
  const run = await stage(context)
  const file = await put(join(run.packedRoot, 'dist', 'redux.mjs'))
  const line = compilationLine([
    { name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [file] },
  ])
  await appendFile(run.reportPath, `{"wrapped":true}\n${line.slice(0, 20)}`)
  // Act
  run.route.observeParsedScript(bundleScript())
  const finalizing = run.route.finalize(true)
  // gstack-timing-ok: the pause only lets finalize start waiting for the line; the outcome is asserted, and the settle bound (REACT_SCRIPTS_LIBRARY_REPORT_SETTLE_MS, 2000 ms) is far above it
  await new Promise((resolve) => setTimeout(resolve, 120))
  await appendFile(run.reportPath, line.slice(20))
  await finalizing
  // Assert
  assert.equal(run.route.view().observation, 'complete')
  assert.equal(run.route.view().loaded, true)
})

// protects=readiness refuses a first compile without the applied marker, naming the reason and the partial side effects; fails_when=a run without the marker proceeds to the browser
test('refuses library-redirect-not-applied when the report has no wrapped line', async (context) => {
  // Arrange
  const run = await stage(context)
  // Act
  const refusal = (() => {
    try {
      run.route.assertRedirectApplied()
    } catch (error) {
      return error
    }
    return undefined
  })()
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'REACT_SCRIPTS_UNSUPPORTED')
  assert.equal(refusal.details?.reason, 'library-redirect-not-applied')
  assert.equal(refusal.details?.sideEffects, 'partial')
  assert.equal(refusal.details?.cause, undefined)
})

// protects=the preload's error line is the refusal's cause; fails_when=the cause is dropped
test('refuses library-redirect-not-applied with the cause of the preload error line', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(
    run.reportPath,
    '{"error":"unexpected configuration shape"}\n',
  )
  // Act
  const refusal = (() => {
    try {
      run.route.assertRedirectApplied()
    } catch (error) {
      return error
    }
    return undefined
  })()
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.details?.reason, 'library-redirect-not-applied')
  assert.equal(refusal.details?.cause, 'unexpected configuration shape')
})

/** Runs a check and returns what it threw, or `undefined`. */
function refusalOf(check: () => void): unknown {
  try {
    check()
  } catch (error) {
    return error
  }
  return undefined
}

// Value: protects=readiness passes only when the report names the packed library among the compiled modules; fails_when=a wrapped line alone, or a report without the packed folder, is accepted; no_claim=that the page runs the packed copy (the script match judges that)
test('accepts a report with the wrapped marker and a compiled module of the packed library', async (context) => {
  // Arrange
  const run = await stage(context)
  const file = await put(join(run.packedRoot, 'es', 'redux.js'))
  await appendFile(
    run.reportPath,
    `{"wrapped":true}\n${compilationLine([{ name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [file] }])}`,
  )
  // Act and Assert
  assert.doesNotThrow(() => run.route.assertRedirectApplied())
})

// Value: protects=a wrapped line without any packed-library resource is not taken for an applied redirect (webpack 4 wrapped the factory and redirected nothing); fails_when=readiness passes on the wrapped marker alone or on the installed copy's resource; no_claim=which resolver step failed
test('refuses library-redirect-not-applied when wrapped is followed only by the installed copy of the library', async (context) => {
  // Arrange
  const run = await stage(context)
  const installed = await put(
    join(run.appRoot, 'node_modules', 'redux', 'es', 'redux.js'),
  )
  await appendFile(
    run.reportPath,
    `{"wrapped":true}\n${compilationLine([{ name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [installed] }])}`,
  )
  // Act
  const refusal = refusalOf(() => run.route.assertRedirectApplied())
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.details?.reason, 'library-redirect-not-applied')
  assert.equal(
    refusal.details?.cause,
    'the compilation names no module of the packed library',
  )
})

// Value: protects=the exact report of the webpack 4 run (a wrapped line, then a reportError line) is refused with the report error as its cause; fails_when=the reportError line is ignored and wrapped alone passes; no_claim=that webpack 4 is supported
test('refuses library-redirect-not-applied for the report of the webpack 4 run, wrapped then reportError', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(
    run.reportPath,
    '{"wrapped":true}\n{"reportError":"Cannot read properties of undefined (reading \'getChunkModulesIterable\')"}\n',
  )
  // Act
  const refusal = refusalOf(() => run.route.assertRedirectApplied())
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.details?.reason, 'library-redirect-not-applied')
  assert.equal(
    refusal.details?.cause,
    "Cannot read properties of undefined (reading 'getChunkModulesIterable')",
  )
})

// Value: protects=readiness waits for the compilation line the preload writes at emit instead of reading too early; fails_when=awaitRedirectApplied reads once and refuses a line that arrives within the bound; no_claim=the length of the default bound
test('waits for a compilation line that arrives after the wrapped line within the bound', async (context) => {
  // Arrange
  const run = await stage(context)
  const file = await put(join(run.packedRoot, 'es', 'redux.js'))
  await appendFile(run.reportPath, '{"wrapped":true}\n')
  const waiting = run.route.awaitRedirectApplied(
    run.controller.signal,
    () => undefined,
    2000,
  )
  // gstack-timing-ok: the pause only lets the wait start polling; the outcome is asserted and the bound (2000 ms) is far above it
  await new Promise((resolve) => setTimeout(resolve, 120))
  // Act
  await appendFile(
    run.reportPath,
    compilationLine([
      { name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [file] },
    ]),
  )
  // Assert
  await assert.doesNotReject(waiting)
})

// Value: protects=the wait ends with the refusal at the bound when no packed-library resource ever arrives; fails_when=the wait returns without a refusal or never ends; no_claim=the default bound
test('refuses library-redirect-not-applied when the bound ends with wrapped and no compilation line', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(run.reportPath, '{"wrapped":true}\n')
  // Act
  const refusal = await run.route
    .awaitRedirectApplied(run.controller.signal, () => undefined, 150)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.details?.reason, 'library-redirect-not-applied')
})

// protects=a declined confirmation builds nothing and leaves no preload; fails_when=prepare runs after a decline
test('does not build or write a preload when the learner declines', async (context) => {
  // Arrange
  const run = await buildRoute(context, { confirm: async () => false })
  // Act
  const error = await run.route.plan(run.controller.signal).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'SCRIPT_NOT_CONFIRMED')
  assert.equal(run.seen.relations.length, 1)
  assert.throws(() => run.route.preloadPath(), /prepare must run/)
})

/** The bundler-neutral core the route delegates to (the unit under test for the unreadable guard). */
function coreOf(route: ReactScriptsLibraryRoute): {
  markUnreadable(cause: string): void
} {
  return (route as unknown as { core: { markUnreadable(c: string): void } })
    .core
}

const unreadableEntries = (journal: { type: string; detail?: unknown }[]) =>
  journal.filter((entry) => entry.type === 'library.observation-unreadable')

// protects=an unreadable cause arriving after library.observed was journaled does not flip a complete observation; fails_when=markUnreadable overwrites a finalized observation
test('keeps a finalized complete observation when an unreadable cause arrives afterwards', async (context) => {
  // Arrange
  const run = await stage(context)
  const file = await put(join(run.packedRoot, 'dist', 'redux.mjs'))
  await appendFile(
    run.reportPath,
    `{"wrapped":true}\n${compilationLine([{ name: 'static/js/bundle.js', sha256: BUNDLE_HASH, resources: [file] }])}`,
  )
  run.route.observeParsedScript(bundleScript())
  await run.route.finalize(true)
  // Act
  coreOf(run.route).markUnreadable('late-fault')
  // Assert
  assert.equal(run.route.view().observation, 'complete')
  assert.equal(unreadableEntries(run.journal).length, 0)
})

// protects=several unreadable verdicts of one attribution journal one entry with the first cause; fails_when=every verdict journals again
test('journals the unreadable observation once for repeated unreadable verdicts', async (context) => {
  // Arrange
  const run = await stage(context)
  // Act
  coreOf(run.route).markUnreadable('first-cause')
  coreOf(run.route).markUnreadable('second-cause')
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(
    unreadableEntries(run.journal).map((entry) => entry.detail),
    [{ cause: 'first-cause' }],
  )
})

// protects=a retried Stop re-runs finalize without journaling the unreadable cause or the observation again and keeps the first result; fails_when=finalize repeats its settle and journal writes
test('finalizes the route once when a retried Stop calls finalize again', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(run.reportPath, '{"wrapped":true}\n{oops\n')
  run.route.observeParsedScript(bundleScript())
  // Act
  await run.route.finalize(true)
  await run.route.finalize(false)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.equal(unreadableEntries(run.journal).length, 1)
  assert.equal(
    run.journal.filter((entry) => entry.type === 'library.observed').length,
    1,
  )
})

// protects=a report that fails to read at the end (a failed read or close) never makes finalize reject, so the run's cleanup still stops the server, the browser and the debugger, and the observation stays unclaimed; fails_when=finalize lets the settle error escape; no_claim=the run's own cleanup order (its finalize call has a guard of its own)
test('finalize resolves and leaves the observation unreadable when the report cannot be read at the end', async (context) => {
  // Arrange
  const run = await stage(context)
  await appendFile(run.reportPath, '{"wrapped":true}\n')
  run.route.observeParsedScript(bundleScript())
  const attribution = (
    run.route as unknown as { attribution: { settle(): Promise<void> } }
  ).attribution
  attribution.settle = async () => {
    throw new Error('close failed')
  }
  // Act
  await run.route.finalize(true)
  // Assert
  assert.equal(run.route.view().observation, 'unreadable')
  assert.deepEqual(unreadableEntries(run.journal)[0]?.detail, {
    cause: 'report-read-failed: close failed',
  })
})

// Value: protects=the run seals a library stop through the packed library only after the preload was written, and the route hands out exactly the real names the seal needs (D3); fails_when=packedLibrary answers before prepare, is not set after the preload was written, or loses the package name, library folder or packed folder; why_new=the seal and the adapter tests feed a hand-made library stop, so nothing checks the route produces that input; seam=none; no_claim=the run's own stop request (private wiring of ConfiguredBrowserRun)
test('hands out the packed library for a library stop only once the preload was written', async (context) => {
  // Arrange
  const run = await buildRoute(context)
  await run.route.plan(run.controller.signal)
  const beforePrepare = run.route.packedLibrary()
  // Act
  await run.route.prepare(run.controller.signal)
  // Assert
  assert.equal(beforePrepare, undefined)
  assert.deepEqual(run.route.packedLibrary(), {
    packageName: 'redux',
    libraryRoot: run.libraryRoot,
    packedRoot: run.packedRoot,
  })
})

// Value: protects=a failed server stop keeps the private folder of a react-scripts library run (the server may still run on the packed copy and the webpack caches) until the retried Stop removes it; fails_when=the route drops the serverStopped option and removes the folder while the server may run; why_new=the retained-folder test runs the Vite route only, and the react-scripts route has its own dispose forwarding; seam=none; no_claim=a real server process
test('keeps the private folder while the server stop failed and removes it on the retried Stop', async (context) => {
  // Arrange
  const run = await stage(context)
  // Act
  await run.route.dispose({ serverStopped: false })
  const afterFailedStop = {
    cleanup: run.route.view().cleanup,
    folder: await stat(run.privateFolder).then(
      () => 'exists',
      () => 'missing',
    ),
  }
  await run.route.dispose()
  // Assert
  assert.deepEqual(afterFailedStop, { cleanup: 'pending', folder: 'exists' })
  assert.equal(run.route.view().cleanup, 'removed')
  await assert.rejects(stat(run.privateFolder))
})

// Value: protects=a preload that cannot be written ends the build as a partial link failure and leaves no preload or packed library for a stop to be sealed through; fails_when=the write error escapes unwrapped, the failure is not reported as sideEffects partial, or the route still announces a preload; why_new=every route test writes the preload successfully; seam=none; no_claim=the real removal of the private folder by failLink
test('refuses with a partial link failure when the preload cannot be written', async (context) => {
  // Arrange
  const failLinks: { sentence: string; sideEffects: unknown }[] = []
  const run = await buildRoute(context, {
    prepareCore: async () => ({
      facts: FACTS,
      packedRoot: join(await realpath(tmpdir()), 'unused-packed'),
      peers: [],
      imports: undefined,
      libraryRoot: tmpdir(),
      privateFolder: join(tmpdir(), 'codebook-rs-missing-private-folder'),
      dispose: async () => ({ cleanup: 'removed' as const }),
      failLink: async (sentence, options) => {
        failLinks.push({ sentence, sideEffects: options?.sideEffects })
        throw new Error('link failed')
      },
    }),
  })
  await run.route.plan(run.controller.signal)
  // Act
  const error = await run.route.prepare(run.controller.signal).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.equal(error instanceof Error ? error.message : error, 'link failed')
  assert.equal(failLinks.length, 1)
  assert.match(
    failLinks[0]?.sentence ?? '',
    /^The react-scripts preload could not be written: /,
  )
  assert.equal(failLinks[0]?.sideEffects, 'partial')
  assert.equal(run.route.packedLibrary(), undefined)
  assert.throws(() => run.route.preloadPath(), /prepare must run/)
})
