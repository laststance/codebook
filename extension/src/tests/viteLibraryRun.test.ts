import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ACTIVE_TIMEOUT_MS, REPOSITORY_SETUP_TIMEOUT_MS } from '../constants'
import { StudyError } from '../errors'
import type { PreparedLibraryCore } from '../libraryPackage'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { describeStudyLibraryLine } from '../utils/describeStudyLibraryLine'
import type { ViteLibraryRouteDependencies } from '../viteLibraryRoute'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { removeTestFolder } from './utils/removeTestFolder'

const PACKAGE_ROOT = 'examples/widgets-vite'
const OPERATION_ACTION = 'repository-operation'
const ORIGIN = 'http://localhost:4321'
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

/** The fake seams of a library run over a real private folder, and what they were asked. */
async function libraryDependencies(
  context: TestContext,
  overrides: Partial<ViteLibraryRouteDependencies> = {},
  prepareHold?: Promise<void>,
) {
  const privateFolder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-lib-run-')),
  )
  context.after(() => removeTestFolder(privateFolder))
  const packedRoot = join(privateFolder, 'node_modules', '@acme', 'widgets')
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
      relativeRoot: 'packages/widgets',
      name: '@acme/widgets',
      version: '1.2.0',
      peers: [],
      packageManager: {
        ok: true,
        name: 'pnpm',
        version: '10.0.0',
        executable: '/bin/pnpm',
      },
    }),
    readManifest: async () => ({ peers: ['react'] }),
    allocatePrivateFolder: async () => privateFolder,
    prepareCore: async (): Promise<PreparedLibraryCore> => {
      calls.push('prepare')
      await prepareHold
      await mkdir(packedRoot, { recursive: true })
      return {
        facts: {
          package: '@acme/widgets',
          version: '1.2.0',
          packageRoot: 'packages/widgets',
          revision: 'a'.repeat(40),
          dirty: false,
          packageManager: { name: 'pnpm', version: '10.0.0' },
          buildMs: 5,
          packMs: 2,
          tarballSha256: 'c'.repeat(64),
          installedVersion: '1.1.0',
        },
        packedRoot,
        peers: ['react'],
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

/** Opens the harness on a nested Vite app that declares the library. */
async function libraryHarness(
  context: TestContext,
  library: Awaited<ReturnType<typeof libraryDependencies>>,
  extra: {
    firstCloseFailsAfter?: Promise<void>
    onFirstCloseStarted?: () => void
    pageStaysAfterClose?: boolean
    pageCloseEndsSession?: boolean
    browserCloseWaitsForDebuggerStop?: boolean
  } = {},
) {
  return configuredRuntimeHarness(context, undefined, [], {
    ...extra,
    adapter: 'vite-dev',
    packageRoot: PACKAGE_ROOT,
    packageApp: { decoyRoot: true },
    operations: { operations: [CLICK], stopOperations: [1] },
    libraryRoute: {
      declared: 'packages/widgets',
      dependencies: library.dependencies,
    },
  })
}

/** Runs the declared operation to its stop, continues it and waits for completion. */
async function runToCompletion(
  harness: Awaited<ReturnType<typeof libraryHarness>>,
): Promise<void> {
  harness.run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'the browser stop')
  await harness.run.continue('browser', stop.pause)
  await waitUntil(() => harness.run.view().status === 'completed', 'completed')
}

// protects=a run on the checked-out library whose page parsed a packed module states loaded, one distinct file, no other copy, a complete observation and the removed folder, and the replay line reads the correspondence sentence; fails_when=any fact is missing at the run's end or the folder stays; no_claim=real Vite, Chrome or a build (stand-in page announces the scripts; the build is faked)
test('a library run states the correspondence after the page parsed a packed module', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await libraryHarness(context, library)
  await harness.run.prepare()
  const packed = await put(join(library.packedRoot, 'dist', 'index.mjs'))
  // Act
  harness.announceScript('p1', `${ORIGIN}/@fs${packed}?v=1`)
  await runToCompletion(harness)
  await harness.run.stop()
  // Assert
  const view = harness.run.view()
  assert.deepEqual(
    {
      observation: view.library?.observation,
      loaded: view.library?.loaded,
      loadCount: view.library?.loadCount,
      publishedCopyLoaded: view.library?.publishedCopyLoaded,
      cleanup: view.library?.cleanup,
      installedVersion: view.library?.installedVersion,
    },
    {
      observation: 'complete',
      loaded: true,
      loadCount: 1,
      publishedCopyLoaded: false,
      cleanup: 'removed',
      installedVersion: '1.1.0',
    },
  )
  assert.equal(
    describeStudyLibraryLine(view.library),
    'Ran on the checked-out @acme/widgets 1.2.0 built from aaaaaaa (packed by pnpm)',
  )
  await assert.rejects(access(library.privateFolder))
  assert.deepEqual(library.calls, ['confirm', 'prepare', 'dispose'])
})

// protects=another copy parsed after the last stop and before the page closed makes publishedCopyLoaded true and removes the sentence; fails_when=the observation ended at the last stop; no_claim=which copy ran the learner's code
test('an installed copy parsed after the last stop still counts before the page closes', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await libraryHarness(context, library)
  await harness.run.prepare()
  const packed = await put(join(library.packedRoot, 'dist', 'index.mjs'))
  const installed = await put(
    join(
      library.privateFolder,
      'installed',
      'node_modules',
      '@acme',
      'widgets',
      'index.js',
    ),
  )
  harness.announceScript('p1', `${ORIGIN}/@fs${packed}?v=1`)
  await runToCompletion(harness)
  // Act
  harness.announceScript('p2', `${ORIGIN}/@fs${installed}?v=1`)
  await harness.run.stop()
  // Assert
  const facts = harness.run.view().library
  assert.equal(facts?.publishedCopyLoaded, true)
  assert.equal(facts?.publishedCopyPath, installed)
  assert.match(
    describeStudyLibraryLine(facts) ?? '',
    /but the page also loaded another copy at /,
  )
})

// protects=a built library that the page never parsed reads built but not served, not loaded; fails_when=the sentence claims the checked-out library ran; no_claim=none beyond protects
test('a library the page never parsed reads built but not served', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await libraryHarness(context, library)
  await harness.run.prepare()
  await put(join(library.packedRoot, 'dist', 'index.mjs'))
  // Act
  await runToCompletion(harness)
  await harness.run.stop()
  // Assert
  const facts = harness.run.view().library
  assert.equal(facts?.loaded, false)
  assert.equal(
    describeStudyLibraryLine(facts),
    'Built @acme/widgets 1.2.0, but not served to this page.',
  )
})

// protects=the page closes and the observation is finalized before the server stops; fails_when=the server is released before the browser; no_claim=a real browser close
test('the owned page closes before the server stops', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await libraryHarness(context, library)
  await harness.run.prepare()
  // Act
  await harness.run.stop()
  // Assert
  const pageAt = harness.releases.indexOf('page')
  const applicationAt = harness.releases.indexOf('application')
  assert.ok(pageAt >= 0 && applicationAt >= 0)
  assert.ok(pageAt < applicationAt)
  assert.equal(harness.run.view().library?.observation, 'complete')
})

// protects=a managed Chrome, which exits only after the debuggers stop, still ends the observation complete and the stop does not wait for the close bound; fails_when=finalization waits for the browser process exit, so the bound wins and the observation reads incomplete (or the stop hangs); no_claim=a real Chrome or js-debug: the stand-in page reports its detach at once
test(
  'a managed browser that exits only after the debuggers stop still ends the observation complete',
  { timeout: 15_000 },
  async (context) => {
    // Arrange
    const library = await libraryDependencies(context)
    const harness = await libraryHarness(context, library, {
      browserCloseWaitsForDebuggerStop: true,
    })
    await harness.run.prepare()
    const packed = await put(join(library.packedRoot, 'dist', 'index.mjs'))
    harness.announceScript('p1', `${ORIGIN}/@fs${packed}?v=1`)
    await runToCompletion(harness)
    // Act
    // The run's manual clock is never advanced: a stop that needed the close bound would not return.
    await harness.run.stop()
    // Assert
    const facts = harness.run.view().library
    assert.equal(facts?.observation, 'complete')
    assert.equal(facts?.loaded, true)
    assert.deepEqual(
      harness.releases.filter((name) =>
        ['page', 'debugger', 'browser'].includes(name),
      ),
      ['page', 'debugger', 'browser'],
    )
  },
)

// protects=in a native run js-debug answers the page close and then ends the page's debug session without a detach on its proxy, and the observation still ends complete without waiting for the close bound; fails_when=finalization waits only for a detach or the proxy's end, so the bound wins and every native library run reads incomplete (seen in VS Code 1.145.2 with js-debug 1.140, Cycle 0096 native check); no_claim=a real js-debug: the stand-in ends the session a turn after the close, as the native journal showed (about 100 ms later)
test(
  'a page close that js-debug answers by ending the page session still ends the observation complete',
  { timeout: 15_000 },
  async (context) => {
    // Arrange
    const library = await libraryDependencies(context)
    const harness = await libraryHarness(context, library, {
      browserCloseWaitsForDebuggerStop: true,
      pageCloseEndsSession: true,
    })
    await harness.run.prepare()
    const packed = await put(join(library.packedRoot, 'dist', 'index.mjs'))
    harness.announceScript('p1', `${ORIGIN}/@fs${packed}?v=1`)
    await runToCompletion(harness)
    // Act
    // The run's manual clock is never advanced: a stop that needed the close bound would not return.
    await harness.run.stop()
    // Assert
    const facts = harness.run.view().library
    assert.equal(facts?.observation, 'complete')
    assert.equal(facts?.loaded, true)
    assert.equal(facts?.loadCount, 1)
  },
)

// protects=a page whose close is acknowledged but which stays listed past the close bound leaves the observation incomplete; fails_when=an acknowledged close alone counts as the page being gone; no_claim=a real Chrome: the stand-in page never reports a detach
test('a page that stays after an acknowledged close leaves the observation incomplete', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await libraryHarness(context, library, {
    pageStaysAfterClose: true,
  })
  await harness.run.prepare()
  harness.announceScript('a1', `${ORIGIN}/@vite/client`)
  // Act
  const stopping = harness.run.stop()
  // The close bound is armed before the close is sent, so once the close was acknowledged the run's own clock can pass it.
  await waitUntil(() => harness.releases.includes('page'), 'the page close')
  harness.advance(ACTIVE_TIMEOUT_MS + 1_000)
  await stopping
  // Assert
  assert.equal(harness.run.view().library?.observation, 'incomplete')
})

// protects=a declined confirmation ends the run with SCRIPT_NOT_CONFIRMED, starts no server and builds nothing; fails_when=the server starts or the build runs after a no; no_claim=the editor dialog
test('a declined confirmation starts no server and builds nothing', async (context) => {
  // Arrange
  const library = await libraryDependencies(context, {
    confirm: async () => false,
  })
  const harness = await libraryHarness(context, library)
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await harness.run.stop()
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'SCRIPT_NOT_CONFIRMED')
  assert.deepEqual(harness.viteRequests.started, [])
  assert.deepEqual(library.calls, [])
})

// protects=a failed build ends the run with its own LIBRARY_BUILD_FAILED, closes the server and leaves no private folder; fails_when=the server stays or the folder stays; no_claim=a real build
test('a failed build closes the server and removes the private folder', async (context) => {
  // Arrange
  const failure = new StudyError(
    'LIBRARY_BUILD_FAILED',
    'The library build failed.',
    undefined,
    undefined,
    undefined,
    { reason: 'build-error', cleanup: 'removed' },
  )
  const library = await libraryDependencies(context, {
    prepareCore: async () => {
      throw failure
    },
  })
  const harness = await libraryHarness(context, library)
  // Act
  const raised = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await harness.run.stop()
  // Assert
  assert.equal(raised, failure)
  assert.ok(harness.releases.includes('application'))
  await assert.rejects(access(library.privateFolder))
})

// protects=the setup deadline does not run while the library builds: a build that outlasts the setup budget still lets the run become ready; fails_when=the budget expires during the build and fails the run; no_claim=the build bound LIBRARY_BUILD_TIMEOUT_MS (the core's tests)
test('the setup deadline does not run during the build', async (context) => {
  // Arrange
  let releaseBuild: () => void = () => undefined
  const hold = new Promise<void>((resolve) => {
    releaseBuild = resolve
  })
  const library = await libraryDependencies(context, {}, hold)
  const harness = await libraryHarness(context, library)
  // Act
  const preparing = harness.run.prepare()
  await waitUntil(() => library.calls.includes('prepare'), 'the build to start')
  harness.advance(REPOSITORY_SETUP_TIMEOUT_MS + 5_000)
  releaseBuild()
  await preparing
  // Assert
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(harness.run.view().library?.prepared, true)
})

// protects=the run resource shows the building phase and its status words while the build runs, then no phase; fails_when=the phase is missing during the build or stays after; no_claim=the status bar text (derived from the same view)
test('the run reads the building phase only while the library builds', async (context) => {
  // Arrange
  let releaseBuild: () => void = () => undefined
  const hold = new Promise<void>((resolve) => {
    releaseBuild = resolve
  })
  const library = await libraryDependencies(context, {}, hold)
  const harness = await libraryHarness(context, library)
  // Act
  const preparing = harness.run.prepare()
  await waitUntil(() => library.calls.includes('prepare'), 'the build to start')
  const during = harness.run.view().libraryPhase
  releaseBuild()
  await preparing
  // Assert
  assert.equal(during, 'building')
  assert.equal(harness.run.view().libraryPhase, undefined)
})

// protects=a run without library keeps no library fields; fails_when=library facts leak into an ordinary nested Vite run; no_claim=none beyond protects
test('a nested Vite run without library has no library facts', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    packageRoot: PACKAGE_ROOT,
    packageApp: { decoyRoot: true },
    operations: { operations: [CLICK], stopOperations: [1] },
  })
  // Act
  await harness.run.prepare()
  // Assert
  const view = harness.run.view()
  assert.equal('library' in view, false)
  assert.equal('libraryPhase' in view, false)
})

// protects=a refusal of the build or the learner is not followed by a setup-timeout failure that overwrites the real error; fails_when=the setup timer is re-armed after a failing step and expires later; no_claim=none beyond protects
test('a declined confirmation is not overwritten by a later setup timeout', async (context) => {
  // Arrange
  const library = await libraryDependencies(context, {
    confirm: async () => false,
  })
  const harness = await libraryHarness(context, library)
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  assert.ok(failure instanceof StudyError)
  // Act
  harness.advance(REPOSITORY_SETUP_TIMEOUT_MS + 5_000)
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures.filter((text) => /setup|timed out/i.test(text))
      .length,
    0,
  )
})

// protects=a page close that outlasts the close bound and then fails is journaled as a late failure; fails_when=the late rejection is dropped without a trace; no_claim=a real browser close
test('journals a page close that fails after the close bound', async (context) => {
  // Arrange
  let failClose: () => void = () => undefined
  const hold = new Promise<void>((resolve) => {
    failClose = resolve
  })
  let closeStarted: () => void = () => undefined
  const closeHasStarted = new Promise<void>((resolve) => {
    closeStarted = resolve
  })
  const library = await libraryDependencies(context)
  const harness = await libraryHarness(context, library, {
    firstCloseFailsAfter: hold,
    onFirstCloseStarted: closeStarted,
  })
  await harness.run.prepare()
  harness.announceScript('a1', `${ORIGIN}/@vite/client`)
  // Act
  const stopping = harness.run.stop()
  // The close bound is armed before the close starts, so once the close has started the run's own clock can pass it.
  await closeHasStarted
  harness.advance(ACTIVE_TIMEOUT_MS + 1_000)
  failClose()
  await stopping
  // Assert
  const late = harness.run
    .view()
    .events.filter((event) => event.type === 'library.page-close-failed-late')
    .map((event) => JSON.parse(JSON.stringify(event.detail)))
  assert.deepEqual(late, [{ cause: 'Error: The page close failed late' }])
  assert.equal(harness.run.view().library?.observation, 'incomplete')
})

// Value: protects=an editor that offers no library route refuses the declared library before any server starts; fails_when=the run starts the Example on its installed copy, or the refusal loses PREREQUISITE_MISSING or its sideEffects none; why_new=no run test covered the PREREQUISITE_MISSING branch of planViteLibrary; seam=none; no_claim=the wording of the sentence beyond naming the library route
test('a library run in an editor without the library route is refused before any server starts', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    packageRoot: PACKAGE_ROOT,
    packageApp: { decoyRoot: true },
    operations: { operations: [CLICK], stopOperations: [1] },
    libraryRoute: {
      declared: 'packages/widgets',
      // The editor passes no library dependencies, as a build of the host without the route does.
      dependencies: undefined as unknown as ViteLibraryRouteDependencies,
    },
  })
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await harness.run.stop()
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'PREREQUISITE_MISSING')
  assert.match(failure.message, /library route is unavailable/)
  assert.equal(failure.details?.sideEffects, 'none')
  assert.deepEqual(harness.viteRequests.started, [])
  assert.deepEqual(library.calls, [])
})
