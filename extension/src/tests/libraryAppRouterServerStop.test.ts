import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import { libraryPlaceAmbiguousRefusal } from '../nextRefusals'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import {
  appLibraryPathConflictOf,
  libraryMapOverridesFor,
} from '../utils/libraryMapOverrides'
import * as reader from '../utils/readRepositoryBuildText'
import { refusalFailureOf } from '../utils/refusalFailureOf'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  announceResolved,
  armedAppServerRun,
  libraryAppServerOptions,
  openAppServerRun,
  stageAppServer,
} from './utils/libraryAppServerRunHarness'
import {
  LIBRARY_APP_FOLDER,
  LIBRARY_RETURN_LINE,
  LIBRARY_SOURCE,
  LIBRARY_SOURCE_PATH,
} from './utils/libraryBuildHarness'
import {
  stageLibrary,
  type StagedLibrary,
} from './utils/libraryServerRunHarness'

/** Copies a value out of the run module's realm. @example plain(view.snapshots) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Reads a thrown refusal's code and details as plain data. */
function refusalOf(failure: unknown) {
  return {
    code: Reflect.get(Object(failure), 'code'),
    details: plain(Reflect.get(Object(failure), 'details')),
  }
}

/** Catches what the run's preparation rejects with. */
async function preparationFailure(
  harness: Awaited<ReturnType<typeof openAppServerRun>>,
): Promise<unknown> {
  return harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
}

/** Waits for the run to fail and reads its first failure as the agent does. */
async function firstFailureOf(
  harness: Awaited<ReturnType<typeof openAppServerRun>>,
) {
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  return refusalFailureOf(harness.run.view().failures[0]!)
}

/** The details every library refusal of this fixture carries besides its reason. */
const LIBRARY_IDENTITY = {
  packageRoot: LIBRARY_APP_FOLDER,
  library: 'lib',
  file: LIBRARY_SOURCE_PATH,
}

/** The details a refusal at the seal carries: an App Router app, after the readiness request. */
const AT_SEAL = { router: 'app', sideEffects: 'unknown' }

/** The checked-out library file's real path and the path Next writes for it (the build map's entry resolved against the app). */
async function pathsOf(harness: Awaited<ReturnType<typeof openAppServerRun>>) {
  const realRoot = await realpath(harness.directory)
  return {
    realRoot,
    checkedOut: join(realRoot, LIBRARY_SOURCE_PATH),
    appResolved: resolve(
      join(realRoot, LIBRARY_APP_FOLDER),
      '../../src/core.ts',
    ),
  }
}

/** Reads the details of the journal entries of one type. @example journaled(harness, 'breakpoint.library-copy') */
function journaled(
  harness: Awaited<ReturnType<typeof openAppServerRun>>,
  type: string,
) {
  return harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => plain(event.detail))
}

/** Waits until the run journaled an entry of a type. @example await journaledOnce(harness, 'stop.module-parsed') */
function journaledOnce(
  harness: Awaited<ReturnType<typeof openAppServerRun>>,
  type: string,
) {
  return waitUntil(
    () => journaled(harness, type).length > 0,
    `the journal entry ${type}`,
  )
}

// protects=AC 1 a server stop on `return doubled` in a workspace library of a nested App Router app pauses in the library's `(rsc)` module at the entry render, requests its breakpoint on the checked-out file, attaches the server with the exact override for the path Next writes (and no wildcard), and records the library's repository path, the checked-out hash, the source line and the format 8 fields; fails_when=the stop is refused outside-package, the breakpoint is requested on a built file or the app-resolved path, the attach carries a wildcard or no override, or the record names another file, hash, line or execution; no_claim=a real Next compile, js-debug or the Space (the compile, the debugger and the hit are scripted; the `(rsc)` and `(ssr)` modules are written as Next 16.2.2 writes them in E1 of Cycle 0081; the script was parsed before the attach, so it is found through its own `sourceURL`)
test('a server stop in a workspace library of a nested App Router app pauses in the (rsc) module with the exact map override and the library record', async (context) => {
  // Arrange
  const staged = stageAppServer()
  const { harness, prepared } = await armedAppServerRun(context, staged)
  const files = staged.files()
  const { realRoot, checkedOut, appResolved } = await pathsOf(harness)
  const requested = harness.breakpoints
    .filter((breakpoint) => breakpoint.id.startsWith('owned-breakpoint'))
    .map((breakpoint) => breakpoint.location.uri.fsPath)
  // Act
  harness.server!.hit({
    ...files.appRouterServer!.hitAt(LIBRARY_RETURN_LINE),
    unannounced: {},
  })
  const stop = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the server stop in the library',
  )
  // Assert
  assert.equal(stop.source.line, LIBRARY_RETURN_LINE)
  assert.equal(stop.source.hash, sha256(LIBRARY_SOURCE))
  assert.deepEqual(plain(stop.values), { 'value:doubled': 6 })
  assert.equal(stop.execution, 'server-render')
  assert.equal(stop.attribution, 'entry-load')
  assert.equal(stop.declaredIndex, 0)
  assert.equal(stop.executionIndex, 0)
  assert.deepEqual(requested, [checkedOut])
  assert.deepEqual(plain(harness.serverLaunches[0]!.sourceMapPathOverrides), {
    'webpack://_N_E/./*': `${realRoot}/${LIBRARY_APP_FOLDER}/*`,
    [appResolved]: checkedOut,
    [resolve(join(harness.directory, LIBRARY_APP_FOLDER), '../../src/core.ts')]:
      checkedOut,
  })
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', stop.pause)
  await prepared
})

// protects=AC 1 a second server stop in the same library file, on another line of the entry render, pauses after the first one is continued and is recorded with its own declared and execution index; fails_when=the second stop is refused as a collision with the first (they share one file), never armed, or recorded with the first stop's indexes; no_claim=a second stop in another library file (the fixture stages one library file; the exact keys of several files are the override unit test's) and a real Next compile
test('a second server stop in the same library file pauses after the first and is recorded with its own indexes', async (context) => {
  // Arrange
  const staged = stageAppServer()
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [
      {
        line: 2,
        column: 1,
        // `doubled` is declared on line 2, so a stop there that required it would be requested on line 3.
        inspections: [{ path: 'count', mode: 'value', required: true }],
      },
    ],
    libraryAppServerOptions(staged, {
      inspectionScope: { doubled: 6, count: 3 },
      operations: {
        operations: [],
        stopOperations: [0, 0],
        stopParticipants: ['server', 'server'],
      },
    }),
  )
  const prepared = harness.run.prepare()
  prepared.catch(() => undefined)
  // Both stops follow the entry render, so both are armed before it runs.
  await waitUntil(
    () => harness.server!.breakpointsAcknowledged() > 1,
    'both server stops were registered',
  )
  await waitUntil(() => harness.navigations.length >= 1, 'the entry load began')
  const hitAt = staged.files().appRouterServer!.hitAt
  // Act
  harness.server!.hit({ ...hitAt(LIBRARY_RETURN_LINE), unannounced: {} })
  const first = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the first library stop',
  )
  await harness.run.continue('server', first.pause)
  harness.server!.hit({ ...hitAt(2), unannounced: {} })
  const second = await waitUntil(
    () =>
      harness.run
        .view()
        .snapshots.find((snapshot) => snapshot.source.line === 2),
    'the second library stop',
  )
  // Assert
  assert.deepEqual(
    [first.source.line, first.declaredIndex, first.executionIndex],
    [LIBRARY_RETURN_LINE, 0, 0],
  )
  assert.deepEqual(
    [second.source.line, second.declaredIndex, second.executionIndex],
    [2, 1, 1],
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', second.pause)
  await prepared
})

/** Stages the compile of a refusal case and returns what the preparation rejects with. @example await refusedAtSeal(context, { clientStub: true }) */
async function refusedAtSeal(context: TestContext, staged: StagedLibrary) {
  const harness = await openAppServerRun(context, staged)
  const failure = await preparationFailure(harness)
  return { harness, failure }
}

// protects=AC 3 case 1 a build made from an older source is refused library-build-stale at the freeze, before any server starts, for a server stop too; fails_when=a server starts or the refusal reports other effects; no_claim=the freeze's own cases (library unit tests)
test('a server library stop with a stale build is refused before any server starts', async (context) => {
  // Arrange
  const staged = stageAppServer(
    {},
    { builtFrom: LIBRARY_SOURCE.replace('count * 2', 'count + count') },
  )
  // Act
  const { harness, failure } = await refusedAtSeal(context, staged)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-build-stale',
      ...LIBRARY_IDENTITY,
      sideEffects: 'none',
    },
  })
  assert.equal(harness.developmentServerLaunches(), 0)
})

// protects=AC 3 case 2 a build map that does not name the stop file is refused library-build-unmapped at the freeze, before any server starts; fails_when=the stop is sealed from a map that cannot translate it; no_claim=the other unmapped causes (library unit tests)
test('a server library stop with an unmapped build is refused before any server starts', async (context) => {
  // Arrange
  const staged = stageAppServer(
    {},
    {
      rewriteBuilt: ({ builtText, mapText }) => ({
        builtText,
        mapText: JSON.stringify({
          ...JSON.parse(mapText),
          sources: ['../../src/other.ts'],
        }),
      }),
    },
  )
  // Act
  const { harness, failure } = await refusedAtSeal(context, staged)
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.equal(refusalOf(failure).details.reason, 'library-build-unmapped')
  assert.equal(refusalOf(failure).details.sideEffects, 'none')
  assert.equal(harness.developmentServerLaunches(), 0)
})

// protects=AC 3 case 3 an app-resolved path holding `*` is a wildcard conflict that names the path for a server stop's entry too, so the freeze can refuse before any process starts; fails_when=the path is dropped silently or the refusal reports effects; no_claim=the wiring in ConfiguredBrowserRun.freezeLibraryStop (the run harness cannot stage a package root whose folder holds a star) and a real Next compile
test('a server stop whose app-resolved path holds a star is a wildcard conflict with the place-ambiguous refusal', () => {
  // Arrange
  const starred = {
    appResolvedPaths: ['/repo/src/*.ts'],
    checkedOutFile: '/repo/packages/lib/src/core.ts',
    participants: new Set<'browser' | 'server'>(['server']),
  }
  // Act
  const conflict = appLibraryPathConflictOf([], starred)
  const error = libraryPlaceAmbiguousRefusal(
    LIBRARY_APP_FOLDER,
    'lib',
    LIBRARY_SOURCE_PATH,
    LIBRARY_RETURN_LINE,
    'the path holds the character *',
    'app',
    'none',
  )
  // Assert
  assert.deepEqual(conflict, { kind: 'wildcard', path: '/repo/src/*.ts' })
  assert.deepEqual(plain(Reflect.get(error, 'details')), {
    reason: 'library-place-ambiguous',
    ...LIBRARY_IDENTITY,
    router: 'app',
    sideEffects: 'none',
  })
})

// protects=AC 3 case 4 (T4) an app-resolved path that a browser stop's file already holds is a collision for a server stop in another file, and the same file shares its keys; fails_when=the conflict check sees the stops of one participant only, so a server stop silently takes a browser stop's key; no_claim=the wiring in ConfiguredBrowserRun.freezeLibraryStop (the run harness cannot stage two libraries behind one path)
test('a server stop that shares an app-resolved path with a browser stop in another file is a collision, and in the same file it is not', () => {
  // Arrange
  const browserEntry = {
    appResolvedPaths: ['/repo/src/core.ts'],
    checkedOutFile: '/repo/packages/a/src/core.ts',
    participants: new Set<'browser' | 'server'>(['browser']),
  }
  const serverInOtherFile = {
    appResolvedPaths: ['/repo/src/core.ts'],
    checkedOutFile: '/repo/packages/b/src/core.ts',
    participants: new Set<'browser' | 'server'>(['server']),
  }
  const serverInSameFile = { ...browserEntry }
  // Act
  const collision = appLibraryPathConflictOf([browserEntry], serverInOtherFile)
  const sameFile = appLibraryPathConflictOf([browserEntry], serverInSameFile)
  // Assert
  assert.deepEqual(collision, {
    kind: 'collision',
    path: '/repo/src/core.ts',
    otherFile: '/repo/packages/a/src/core.ts',
  })
  assert.equal(sameFile, undefined)
})

// protects=AC 3 case 5 a server compile with no `(rsc)` module of the library file, only its `(ssr)` module, is refused library-not-in-build naming the frozen built file, after the readiness request; fails_when=the `(ssr)` module is sealed as the stop's module or the refusal reports sideEffects none; no_claim=a real compile that does not load the module on the server
test('a server library stop whose (rsc) module is absent from the server compile is refused as not-in-build', async (context) => {
  // Arrange
  const staged = stageAppServer({ rsc: [], ssr: ['modern'] })
  // Act
  const { harness, failure } = await refusedAtSeal(context, staged)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-not-in-build',
      ...LIBRARY_IDENTITY,
      candidates: ['packages/lib/build/modern/core.js'],
      ...AT_SEAL,
    },
  })
  assert.equal(harness.server!.breakpointsAcknowledged(), 0)
})

// protects=AC 3 case 6 two built flavours of the library as `(rsc)` modules are refused library-not-in-build naming both candidates; fails_when=one flavour is sealed anyway; no_claim=which flavour a bundler would pick
test('a server library stop whose two built flavours are both (rsc) modules is refused as not-in-build', async (context) => {
  // Arrange
  const staged = stageLibrary({
    flavours: ['modern', 'legacy'],
    inBrowser: ['modern'],
    inCompile: [],
    appRouter: { server: { rsc: ['modern', 'legacy'] } },
  })
  // Act
  const { failure } = await refusedAtSeal(context, staged)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-not-in-build',
      ...LIBRARY_IDENTITY,
      candidates: [
        'packages/lib/build/legacy/core.js',
        'packages/lib/build/modern/core.js',
      ],
      ...AT_SEAL,
    },
  })
})

// protects=AC 3 case 7 differing `(rsc)` copies of the module are refused library-not-in-build, not as an uncoded ambiguity, while the `(ssr)` module beside them is no copy; fails_when=the run ends with the raw ambiguity text or seals one copy; no_claim=how a bundler would come to carry two different copies
test('a server library stop whose (rsc) module differs between two copies is refused as not-in-build', async (context) => {
  // Arrange
  const staged = stageAppServer({ differingRscCopy: true })
  // Act
  const { failure } = await refusedAtSeal(context, staged)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-not-in-build',
      ...LIBRARY_IDENTITY,
      candidates: ['packages/lib/build/modern/core.js'],
      ...AT_SEAL,
    },
  })
})

// protects=AC 3 case 8 an `(rsc)` module whose map names another path than Next writes is refused library-not-in-build and names the path the map gave; fails_when=the module is sealed and the override would point at a path nothing maps; no_claim=a map without any source (library unit tests)
test('a server library stop whose map names another path than Next writes is refused as not-in-build', async (context) => {
  // Arrange
  const staged = stageAppServer({ mapSources: ['/elsewhere/src/core.ts'] })
  // Act
  const { failure } = await refusedAtSeal(context, staged)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-not-in-build',
      ...LIBRARY_IDENTITY,
      candidates: ['packages/lib/build/modern/core.js'],
      mapSource: '/elsewhere/src/core.ts',
      ...AT_SEAL,
    },
  })
})

// protects=AC 3 case 9 an `(rsc)` module whose map has several sources is refused library-not-in-build even when one of them is the path Next writes, and the refusal names the first source; fails_when=a map with extra sources is sealed or the first source is not named; no_claim=which source Next would bind
test('a server library stop whose map has several sources is refused as not-in-build', async (context) => {
  // Arrange
  const staged = stageAppServer({
    mapSources: (appResolved) => [appResolved, '/elsewhere/x.ts'],
  })
  // Act
  const { harness, failure } = await refusedAtSeal(context, staged)
  // Assert
  const { appResolved } = await pathsOf(harness)
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-not-in-build',
      ...LIBRARY_IDENTITY,
      candidates: ['packages/lib/build/modern/core.js'],
      mapSource: appResolved,
      ...AT_SEAL,
    },
  })
})

// protects=AC 3 case 10 another `(rsc)` module of the server compile whose map names the same path is refused library-place-ambiguous, while the `(ssr)` module of the file that every compile holds is no collision (the first test of this file seals beside it); fails_when=the stop is sealed on one of two `(rsc)` modules, or the `(ssr)` module counts as a competitor; no_claim=a real second module that composes the same file
test('a server library stop whose path another (rsc) module also names is refused as place-ambiguous', async (context) => {
  // Arrange
  const staged = stageAppServer({ extraNamingRscModule: true })
  // Act
  const { failure } = await refusedAtSeal(context, staged)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-place-ambiguous',
      ...LIBRARY_IDENTITY,
      ...AT_SEAL,
    },
  })
})

// protects=AC 3 case 11 an `(rsc)` module whose sourcesContent differs from the checked-out file is refused RUNTIME_FAILED library-build-changed after the readiness request; fails_when=the module is sealed with other text than the checked-out file; no_claim=Next's real recompile (the chunk is written with other content before the start)
test('a server library stop whose module carries other source text than the checked-out file is refused as build-changed', async (context) => {
  // Arrange
  const staged = stageAppServer({
    mapContent: LIBRARY_SOURCE.replace('count * 2', 'count + count'),
  })
  // Act
  const { failure } = await refusedAtSeal(context, staged)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'RUNTIME_FAILED',
    details: {
      reason: 'library-build-changed',
      ...LIBRARY_IDENTITY,
      ...AT_SEAL,
    },
  })
})

// protects=AC 3 case 12 a frozen built file that changed on disk after the freeze, with the module map's sourcesContent unchanged, is refused RUNTIME_FAILED library-build-changed at the server seal; fails_when=the seal checks only sourcesContent and records the run as the checked-out source's; no_claim=a rebuild Next performs itself
test('a server library stop is refused as build-changed when the built file changed after the freeze', async (context) => {
  // Arrange
  const staged = stageAppServer()
  const harness = await openAppServerRun(context, staged)
  let reads = 0
  const original = reader.readRepositoryBuildText
  context.mock.method(
    reader,
    'readRepositoryBuildText',
    async (...args: Parameters<typeof original>) => {
      const [root, path] = args
      if (path.endsWith('build/modern/core.js') && ++reads === 2) {
        const fullPath = join(root, path)
        await writeFile(fullPath, `${await readFile(fullPath, 'utf8')}\n`)
      }
      return original(...args)
    },
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'RUNTIME_FAILED',
    details: {
      reason: 'library-build-changed',
      ...LIBRARY_IDENTITY,
      ...AT_SEAL,
    },
  })
})

// protects=AC 3 case 13 executed library bytes that differ from the sealed ones when the pause is inspected end the run with library-build-changed and capture nothing; fails_when=the pause is captured, or the failure is the generic one; no_claim=a real rebuild, and the arming-time check (a server stop has none: only a pause reads the executed server script)
test('executed server library bytes that differ at the pause end the run with library-build-changed and capture nothing', async (context) => {
  // Arrange
  const staged = stageAppServer()
  const { harness } = await armedAppServerRun(context, staged)
  const files = staged.files().appRouterServer!
  // Act
  harness.server!.hit({
    ...files.hitAt(LIBRARY_RETURN_LINE),
    unannounced: {
      scriptText: files.rscJavascript.replace('work3();', 'rebuilt();'),
      url: files.rscAddress,
    },
  })
  const restored = await firstFailureOf(harness)
  // Assert
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.equal(restored?.libraryDetails?.reason, 'library-build-changed')
  assert.equal(harness.run.view().snapshots.length, 0)
})

// protects=AC 3 case 14 the sealed `(rsc)` module announced again under a new script id with bytes that differ from the seal ends the run with library-build-changed, not the generic changed-after-sealing text; fails_when=the generic text is used or the new bytes are accepted as an instance; no_claim=Next's real hot update (the announcement is scripted)
test('a server library module announced again under a new script id with other bytes ends the run with library-build-changed', async (context) => {
  // Arrange
  const staged = stageAppServer()
  const { harness } = await armedAppServerRun(context, staged)
  const files = staged.files().appRouterServer!
  announceResolved(harness, 'rsc-1', files.rscJavascript, files.rscAddress)
  await journaledOnce(harness, 'stop.module-parsed')
  // Act
  announceResolved(
    harness,
    'rsc-2',
    files.rscJavascript.replace('work3();', 'rebuilt();'),
    files.rscAddress,
  )
  const restored = await firstFailureOf(harness)
  // Assert
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'library-build-changed',
    router: 'app',
    sideEffects: 'unknown',
  })
})

// protects=D16 the sealed `(rsc)` module announced again under a new script id with the sealed bytes (a recompile of the route) is a coexisting instance: the run goes on and the stop pauses in the new script; fails_when=a normal server recompile fails the run, or the new script is not usable for the stop; no_claim=Next's real recompile and the existing coexisting-instance rules for app files (nativeParticipantsCoexistingInstances)
test('a server library module announced again under a new script id with the sealed bytes is a coexisting instance and the stop pauses in it', async (context) => {
  // Arrange
  const staged = stageAppServer()
  const { harness } = await armedAppServerRun(context, staged)
  const files = staged.files().appRouterServer!
  announceResolved(harness, 'rsc-1', files.rscJavascript, files.rscAddress)
  await journaledOnce(harness, 'stop.module-parsed')
  announceResolved(harness, 'rsc-2', files.rscJavascript, files.rscAddress)
  await journaledOnce(harness, 'stop.instance-coexisting')
  // Act
  harness.server!.hit({
    ...files.hitAt(LIBRARY_RETURN_LINE),
    scriptId: 'rsc-2',
  })
  const stop = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the server stop in the coexisting script',
  )
  // Assert
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(stop.source.scriptId, 'rsc-2')
  assert.equal(stop.source.line, LIBRARY_RETURN_LINE)
})

// protects=D15 an `(ssr)` copy announced before the `(rsc)` module, both in js-debug's resolved spelling that loses the layer, is not bound as the stop's script: the stop pauses in the `(rsc)` script and the run does not fail on the other layer's bytes; fails_when=the first script with the resolved address becomes the stop's script, so the `(rsc)` module is judged against the `(ssr)` text; no_claim=js-debug's real announcement order (E1 saw every module parsed before the attach)
test('an (ssr) copy announced before the (rsc) module in the resolved spelling is not bound as the stop', async (context) => {
  // Arrange
  const staged = stageAppServer()
  const { harness } = await armedAppServerRun(context, staged)
  const files = staged.files().appRouterServer!
  announceResolved(harness, 'ssr-1', files.ssrJavascript, files.ssrAddress)
  await journaledOnce(harness, 'stop.library-copy')
  announceResolved(harness, 'rsc-1', files.rscJavascript, files.rscAddress)
  await journaledOnce(harness, 'stop.module-parsed')
  // Act
  harness.server!.hit({
    ...files.hitAt(LIBRARY_RETURN_LINE),
    scriptId: 'rsc-1',
  })
  const stop = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the server stop in the (rsc) script',
  )
  // Assert
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(stop.source.scriptId, 'rsc-1')
  assert.equal(journaled(harness, 'stop.module-parsed').length, 1)
})

// protects=copies a pause in the `(ssr)` copy of the library module at the server stop's own line is resumed with a journal entry that names the copy's script address, never observed, and the stop then pauses in its own `(rsc)` script; fails_when=the copy's pause is saved as the stop's observation, fails the run as an extra server stop, or is resumed without a journal entry; no_claim=js-debug's real `(ssr)` pause (E1 saw it only at a browser-only line)
test('a pause in the (ssr) copy at the server stop line is resumed and journaled, and the stop then pauses in the (rsc) script', async (context) => {
  // Arrange
  const staged = stageAppServer()
  const { harness } = await armedAppServerRun(context, staged)
  const files = staged.files().appRouterServer!
  announceResolved(harness, 'ssr-1', files.ssrJavascript, files.ssrAddress)
  announceResolved(harness, 'rsc-1', files.rscJavascript, files.rscAddress)
  await journaledOnce(harness, 'stop.module-parsed')
  // Act
  harness.server!.hit({
    ...files.hitAt(LIBRARY_RETURN_LINE),
    scriptId: 'ssr-1',
    hitBreakpoints: ['owned-breakpoint'],
  })
  await waitUntil(
    () => harness.server!.continues.length === 1,
    'the copy pause was resumed',
  )
  const resumedWithoutStop = harness.run.view().participants.server?.snapshot
  harness.server!.hit({
    ...files.hitAt(LIBRARY_RETURN_LINE),
    scriptId: 'rsc-1',
    hitBreakpoints: ['owned-breakpoint'],
  })
  const stop = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the server stop in the (rsc) script',
  )
  // Assert
  assert.equal(resumedWithoutStop, undefined)
  assert.deepEqual(journaled(harness, 'breakpoint.library-copy'), [
    { scriptUrl: files.ssrAddress },
  ])
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(stop.source.scriptId, 'rsc-1')
  assert.equal(harness.run.view().snapshots.length, 1)
})

// protects=copies a pause in React's copy of the library module (`about://React/Server/…`) at the server stop's line is resumed as a copy and never observed, and the stop then pauses in its own script; fails_when=React's copy is taken for the stop or fails the run; no_claim=js-debug's real React copies (E1 saw them loaded but never paused)
test('a pause in the React copy of the library module at the server stop line is resumed, and the stop then pauses', async (context) => {
  // Arrange
  const staged = stageAppServer()
  const { harness } = await armedAppServerRun(context, staged)
  const files = staged.files().appRouterServer!
  // Act
  harness.server!.hit({
    ...files.hitAt(LIBRARY_RETURN_LINE),
    scriptId: 'react-copy',
    unannounced: { reactCopy: 107 },
    hitBreakpoints: ['owned-breakpoint'],
  })
  await waitUntil(
    () => harness.server!.continues.length === 1,
    'the React copy pause was resumed',
  )
  const resumedWithoutStop = harness.run.view().participants.server?.snapshot
  harness.server!.hit({
    ...files.hitAt(LIBRARY_RETURN_LINE),
    unannounced: {},
  })
  const stop = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the server stop',
  )
  // Assert
  assert.equal(resumedWithoutStop, undefined)
  assert.equal(journaled(harness, 'breakpoint.react-copy').length, 1)
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(stop.source.line, LIBRARY_RETURN_LINE)
})

/** The click operation of a run with a browser stop after it. */
const CLICK_OPERATION = {
  kind: 'click',
  title: 'Next page',
  selector: 'a',
} as const

// protects=AC 4 (D12/D17) a server stop S at the entry render and a browser stop B in the same library file for operation 1: S is observed at the entry render, and operation 1's server render, which reaches B's line in the `(ssr)` copy, is resumed with a journal entry and never saved as an observation; fails_when=the server pause at B's line is saved, fails the run as an extra stop, or leaves the server paused; no_claim=the browser pause of B (not scripted here: the stand-in page pauses nothing for it) and js-debug's real `(ssr)` pause (E1 saw it at `hydrate`)
test('a server pause at the line only a browser stop declares, in the (ssr) copy, is resumed and never observed', async (context) => {
  // Arrange
  const staged = stageAppServer()
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [
      {
        line: 2,
        column: 1,
        // `doubled` is declared on line 2, so a stop there that required it would be requested on line 3.
        inspections: [{ path: 'count', mode: 'value', required: true }],
      },
    ],
    libraryAppServerOptions(staged, {
      inspectionScope: { doubled: 6, count: 3 },
      operations: {
        operations: [CLICK_OPERATION],
        stopOperations: [0, 1],
        stopParticipants: ['server', 'browser'],
      },
    }),
  )
  const prepared = harness.run.prepare()
  prepared.catch(() => undefined)
  await waitUntil(
    () => harness.server!.breakpointsAcknowledged() > 0,
    'the entry-render stop was registered',
  )
  const files = staged.files().appRouterServer!
  announceResolved(harness, 'rsc-1', files.rscJavascript, files.rscAddress)
  announceResolved(harness, 'ssr-1', files.ssrJavascript, files.ssrAddress)
  await journaledOnce(harness, 'stop.module-parsed')
  harness.server!.hit({
    ...files.hitAt(LIBRARY_RETURN_LINE),
    scriptId: 'rsc-1',
  })
  const entry = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the entry-render stop S',
  )
  // The page parsed the library's `(app-pages-browser)` module before B is armed.
  harness.replaceExecutedModule(staged.files().browserModuleJavascript)
  harness.announceScript(
    'browser-lib',
    new URL(staged.files().browserAddress).href,
  )
  harness.setDocumentReadyState('complete')
  harness.suppressInputPause()
  await harness.run.continue('server', entry.pause)
  await prepared
  // Act
  harness.run.action('op-1', 'repository-operation')
  const browserLine = harness.breakpoints.find(
    (breakpoint) => breakpoint.location.range.start.line + 1 === 2,
  )!
  await waitUntil(
    () => harness.server!.breakpointsAcknowledged() > 1,
    'the browser stop B was registered on the server session',
  )
  harness.server!.hit({
    ...files.hitAt(2),
    scriptId: 'ssr-1',
    hitBreakpoints: [browserLine.id],
  })
  await waitUntil(
    () => harness.server!.continues.length === 2,
    'the server pause at B was resumed',
  )
  // Assert
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.deepEqual(journaled(harness, 'breakpoint.library-copy'), [
    { scriptUrl: files.ssrAddress },
  ])
})

// protects=D19 a browser pause in the page's copy of a library file that holds stops of both participants, at a line only a server stop declares (S, whose breakpoint the editor also bound in the page), is resumed with a journal entry that names the page's script address and is never observed, and the browser stop B of the same file then pauses and is observed; fails_when=the page pause at S's line is saved as an observation, fails the run as an extra stop, leaves the page paused, or B's own pause is taken for a copy; no_claim=js-debug's real page pause at a server stop's line (scripted, with the retired breakpoint's id) and a real click handler that runs both lines
test('a browser pause at the line only a server stop declares is resumed and never observed, and the browser stop then pauses', async (context) => {
  // Arrange
  const staged = stageAppServer()
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [
      {
        line: 2,
        column: 1,
        inspections: [{ path: 'count', mode: 'value', required: true }],
      },
    ],
    libraryAppServerOptions(staged, {
      inspectionScope: { doubled: 6, count: 3 },
      operations: {
        operations: [CLICK_OPERATION],
        stopOperations: [0, 1],
        stopParticipants: ['server', 'browser'],
      },
    }),
  )
  const prepared = harness.run.prepare()
  prepared.catch(() => undefined)
  await waitUntil(
    () => harness.server!.breakpointsAcknowledged() > 0,
    'the entry-render stop was registered',
  )
  const files = staged.files()
  const server = files.appRouterServer!
  announceResolved(harness, 'rsc-1', server.rscJavascript, server.rscAddress)
  await journaledOnce(harness, 'stop.module-parsed')
  harness.server!.hit({
    ...server.hitAt(LIBRARY_RETURN_LINE),
    scriptId: 'rsc-1',
  })
  const entry = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the entry-render stop S',
  )
  // The page parsed the library's `(app-pages-browser)` module before B is armed.
  harness.replaceExecutedModule(files.browserModuleJavascript)
  harness.announceScript('browser-lib', new URL(files.browserAddress).href)
  harness.setDocumentReadyState('complete')
  harness.suppressInputPause()
  await harness.run.continue('server', entry.pause)
  await prepared
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(
    () =>
      harness.breakpoints.some(
        (breakpoint) => breakpoint.id === 'owned-breakpoint-2',
      ),
    'the browser stop B was armed',
  )
  // The page runs both lines inside the input of operation 1.
  await waitUntil(() => harness.inputsSeen() >= 1, 'the click was sent')
  const serverBreakpointId = harness.browserAdapterIdOf('owned-breakpoint')
  const browserBreakpointId = harness.browserAdapterIdOf('owned-breakpoint-2')
  // Act
  harness.pauseBrowserInLibrary({
    scriptId: 'browser-lib',
    ...files.hitAt(LIBRARY_RETURN_LINE),
    hitBreakpointIds: [serverBreakpointId],
  })
  await waitUntil(
    () =>
      harness.commands.filter((command) => command === 'continue').length >= 1,
    'the page pause at S was resumed',
  )
  const observedAtCopy = harness.run.view().participants.browser?.snapshot
  harness.pauseBrowserInLibrary({
    scriptId: 'browser-lib',
    ...files.hitAt(2),
    hitBreakpointIds: [browserBreakpointId],
  })
  const stop = await waitUntil(
    () => harness.run.view().participants.browser?.snapshot,
    'the browser stop B',
  )
  // Assert
  assert.equal(observedAtCopy, undefined)
  assert.deepEqual(journaled(harness, 'breakpoint.library-copy'), [
    { scriptUrl: new URL(files.browserAddress).href },
  ])
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(stop.source.line, 2)
  assert.equal(harness.run.view().snapshots.length, 2)
})

/** Adds a Pages folder to the nested app, so it holds both routers. */
function withPagesFolder(staged: StagedLibrary): StagedLibrary {
  return {
    ...staged,
    stop: async (input) => {
      const pagesFolder = join(input.directory, LIBRARY_APP_FOLDER, 'pages')
      await mkdir(pagesFolder, { recursive: true })
      await writeFile(
        join(pagesFolder, 'index.tsx'),
        'export default function Index() { return null }\n',
      )
      return staged.stop(input)
    },
  }
}

// protects=AC 5 a server stop in a library of a nested app with both routers stays refused outside-package before any process starts, since its entry route is known only after the server started; fails_when=the stop is frozen as an App Router library stop; no_claim=a both-routers app whose entry resolves to an App page
test('a server stop in a library of a nested app with both routers stays refused outside-package before any server starts', async (context) => {
  // Arrange
  const staged = withPagesFolder(stageAppServer())
  // Act
  const { harness, failure } = await refusedAtSeal(context, staged)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'outside-package',
      files: [LIBRARY_SOURCE_PATH],
      packageRoot: LIBRARY_APP_FOLDER,
      sideEffects: 'none',
    },
  })
  assert.equal(harness.developmentServerLaunches(), 0)
})

/** The options of a run without a nested app: a server stop in a library path of the repository's root app. */
const ROOT_APP_SERVER_OPTIONS = {
  participant: 'server',
  serverSeal: 'rsc',
  serverRuntime: { route: '/' },
  documentReadyState: 'loading',
  sourcePath: LIBRARY_SOURCE_PATH,
  fixture: {
    source: LIBRARY_SOURCE,
    citationEndLine: 4,
    declaredLine: LIBRARY_RETURN_LINE,
  },
  // The stand-in reader's module maps the first three lines.
  mappings: 'AAAA;AACA;AACA',
} as const

// protects=AC 5 a library-path server stop of a root App Router app is not frozen: the app's own App Router reader gets the stop and the server attach carries no library override; fails_when=a root app freezes a library build or the attach carries an override; no_claim=the reader's own refusal text (the harness stands in for the reader)
test('a library-path server stop of a root app is read by the app reader and attaches with no library override', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    ...ROOT_APP_SERVER_OPTIONS,
    operations: {
      operations: [],
      stopOperations: [0],
      stopParticipants: ['server'],
    },
  })
  // Act
  harness.run.prepare().catch(() => undefined)
  await waitUntil(
    () => harness.server!.breakpointsAcknowledged() > 0,
    'the server stop was registered',
  )
  // Assert
  assert.equal(harness.readerRoots.developmentBundle.length, 1)
  assert.deepEqual(
    Object.keys(plain(harness.serverLaunches[0]!.sourceMapPathOverrides)),
    ['webpack://_N_E/./*'],
  )
})

// protects=AC 5 a version 2 configuration has no packageRoot and so no library freeze: its server stop in a library path goes to the app reader and the attach carries no library override; fails_when=a version 2 run freezes a library build; no_claim=the reader's own refusal text
test('a version 2 server stop in a library path is read by the app reader and attaches with no library override', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    ROOT_APP_SERVER_OPTIONS,
  )
  // Act
  harness.run.prepare().catch(() => undefined)
  await waitUntil(
    () => harness.serverLaunches.length > 0,
    'the server attach was configured',
  )
  // Assert
  assert.equal(harness.readerRoots.developmentBundle.length, 1)
  assert.deepEqual(
    Object.keys(plain(harness.serverLaunches[0]!.sourceMapPathOverrides)),
    ['webpack://_N_E/./*'],
  )
})

// protects=AC 5 a server stop in a library file whose only `(rsc)` module is a client reference stub is refused as a client component, as the app's own client component file is, and nothing is armed; fails_when=the stub is sealed as the stop's module or the refusal is an uncoded mapping error; no_claim=the stub text Next writes for every `'use client'` shape (the fixture writes the marker Next 16.1.4 and 16.3.4 write)
test('a server stop in a library file whose (rsc) module is a client reference stub is refused as a client component', async (context) => {
  // Arrange
  const staged = stageAppServer({ clientStub: true })
  // Act
  const { harness, failure } = await refusedAtSeal(context, staged)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'client-component',
      stop: `${LIBRARY_SOURCE_PATH}:${LIBRARY_RETURN_LINE}`,
      router: 'app',
      sideEffects: 'unknown',
    },
  })
  assert.equal(harness.server!.breakpointsAcknowledged(), 0)
})

// protects=AC 1 (T3) the per-participant override builder gives exact keys only and only for the stops that name the participant: a file only the server declares gives the browser no entry, a file only the browser declares gives the server none, and a file both declare gives both; fails_when=a wildcard key appears, or a file leaks into the other participant's debugger; no_claim=the wiring that hands the keys to the editor (the run tests above)
test('the per-participant override builder gives exact keys only, for the stops that name the participant', () => {
  // Arrange
  const entries = [
    {
      appResolvedPaths: ['/repo/src/server-only.ts'],
      checkedOutFile: '/repo/packages/lib/src/server-only.ts',
      participants: new Set<'browser' | 'server'>(['server']),
    },
    {
      appResolvedPaths: ['/repo/src/browser-only.ts'],
      checkedOutFile: '/repo/packages/lib/src/browser-only.ts',
      participants: new Set<'browser' | 'server'>(['browser']),
    },
    {
      appResolvedPaths: ['/repo/src/both.ts', '/repo/src/star-*.ts'],
      checkedOutFile: '/repo/packages/lib/src/both.ts',
      participants: new Set<'browser' | 'server'>(['browser', 'server']),
    },
  ]
  // Act
  const server = libraryMapOverridesFor(entries, 'server')
  const browser = libraryMapOverridesFor(entries, 'browser')
  // Assert
  assert.deepEqual(server, {
    '/repo/src/server-only.ts': '/repo/packages/lib/src/server-only.ts',
    '/repo/src/both.ts': '/repo/packages/lib/src/both.ts',
  })
  assert.deepEqual(browser, {
    '/repo/src/browser-only.ts': '/repo/packages/lib/src/browser-only.ts',
    '/repo/src/both.ts': '/repo/packages/lib/src/both.ts',
  })
})
