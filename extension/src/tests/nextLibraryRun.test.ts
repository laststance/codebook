import assert from 'node:assert/strict'
import { access, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { entryControl } from './utils/entryRenderHarness'
import {
  armedAppServerRun,
  libraryAppServerOptions,
  stageAppServer,
} from './utils/libraryAppServerRunHarness'
import {
  compilerFolders,
  libraryDependencies,
  ORIGIN,
  PACKAGE_ROOT,
  PAGE_ASSET,
  PAGE_HASH,
  SERVER_ASSET,
  SERVER_HASH,
  writeReport,
  type Library,
} from './utils/nextLibraryRunHarness'
import { removeTestFolder } from './utils/removeTestFolder'

const OPERATION_ACTION = 'repository-operation'
const CLICK: RepositoryOperation = {
  kind: 'click',
  title: 'Toggle',
  selector: '#toggle',
}

/** Opens the harness on a nested Next app that declares the library, with a browser stop, a scripted server session and the readiness request held. */
async function nextLibraryHarness(
  context: TestContext,
  library: Library,
  extra: Partial<
    Pick<
      NonNullable<Parameters<typeof configuredRuntimeHarness>[3]>,
      | 'applicationCloseFailsOnce'
      | 'holdReadiness'
      | 'listeningAfterMs'
      | 'exitedWith'
      | 'runtimeConstants'
      | 'declaredPortTaken'
    >
  > = {},
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

// Value: protects=a Next start that listens later than the wrapped-line bound after the spawn still runs, because the bound counts from the listener; fails_when=the run refuses library-redirect-not-applied although Next only started slowly; why_new=the bound used to count from the spawn; seam=none; no_claim=real Next timing
test('a Next library run whose server listens later than the wrapped-line bound is not refused', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await nextLibraryHarness(context, library, {
    holdReadiness: false,
    listeningAfterMs: 400,
    runtimeConstants: { NEXT_LIBRARY_WRAPPED_WAIT_MS: 200 },
  })
  const folders = await compilerFolders(harness)
  // The preload writes its lines 50 ms after the listener appeared, 450 ms after the spawn.
  const writing = new Promise<void>((resolve, reject) =>
    setTimeout(() => writeReport(library, folders).then(resolve, reject), 450),
  )
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await writing
  await harness.run.stop()
  // Assert
  assert.equal(failure, undefined)
  assert.equal(harness.readyEntryPaths.length, 1)
})

// Value: protects=a Next process that exits before writing its wrapped lines ends the run with its own exit failure and output tail; fails_when=the exit is reported as library-redirect-not-applied; why_new=the wrapped wait never looked at the process; seam=none; no_claim=a real process exit
test('a Next process that exits before its wrapped lines ends the run with the exit failure', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await nextLibraryHarness(context, library, {
    holdReadiness: false,
    exitedWith: 'Application exited: 1: EADDRINUSE',
    runtimeConstants: { NEXT_LIBRARY_WRAPPED_WAIT_MS: 200 },
  })
  await compilerFolders(harness)
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await harness.run.stop()
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), undefined)
  assert.match(
    String(Reflect.get(Object(failure), 'message')),
    /Application exited: 1: EADDRINUSE/,
  )
})

// Value: protects=the Stop the service schedules after a failed preparation (it calls stopRecord on any preparation error) stops the owned server and removes the private folder after a process exit, as after a missing wrapped line; fails_when=the exit failure leaves the server released late or the folder behind; why_new=the exit failure is new; seam=none; no_claim=that the service schedules that Stop (a run-level harness has no service) and a real server process
test('a Next library run that exited before its wrapped lines stops the server and removes the private folder on Stop', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await nextLibraryHarness(context, library, {
    holdReadiness: false,
    exitedWith: 'Application exited: 1: boom',
    runtimeConstants: { NEXT_LIBRARY_WRAPPED_WAIT_MS: 200 },
  })
  await compilerFolders(harness)
  await harness.run.prepare().catch(() => undefined)
  // Act
  await harness.run.stop()
  // Assert
  assert.ok(harness.releases.includes('application'))
  assert.deepEqual(library.calls, ['confirm', 'prepare', 'dispose'])
  await assert.rejects(access(library.privateFolder))
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

// Value: protects=a Next library run whose declared port is taken is refused before the learner's confirmation and the build, so the refusal's "nothing was built" is true; fails_when=the port check moves after the confirmation or the build, or the Next route skips it; why_new=planNextLibrary checks the port first and no other test pins the order; seam=none; no_claim=the real port probe (assertDevelopmentPortFree has its own tests)
test('a Next library run on a taken port is refused before the confirmation and the build', async (context) => {
  // Arrange
  const library = await libraryDependencies(context)
  const harness = await nextLibraryHarness(context, library, {
    declaredPortTaken: true,
  })
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    String(Reflect.get(Object(failure), 'message')),
    'Port 4321 is in use on this machine',
  )
  assert.deepEqual(library.calls, [])
  assert.equal(harness.developmentServerLaunches(), 0)
})
