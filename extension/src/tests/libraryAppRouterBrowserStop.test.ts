import assert from 'node:assert/strict'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { refusalFailureOf } from '../utils/refusalFailureOf'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  LIBRARY_BROWSER_OPERATION,
  libraryBrowserOptions,
  pausedLibraryBrowserRun,
  type LibraryBrowserRunOptions,
} from './utils/libraryBrowserRunHarness'
import {
  LIBRARY_APP_FOLDER,
  LIBRARY_RETURN_LINE,
  LIBRARY_SOURCE,
  LIBRARY_SOURCE_PATH,
  type LibraryFixtureSpec,
} from './utils/libraryBuildHarness'
import {
  stageLibrary,
  type StagedLibrary,
} from './utils/libraryServerRunHarness'

/** Copies a value out of the run module's realm. @example plain(view.snapshots) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Stages a nested App Router app whose two client chunks hold the library's modern build. @example stageApp({ appRouter: { routeGroup: true } }) */
function stageApp(
  spec: LibraryFixtureSpec['appRouter'] = {},
  extra: LibraryFixtureSpec = {},
): StagedLibrary {
  return stageLibrary({
    inBrowser: ['modern'],
    inCompile: [],
    appRouter: spec,
    ...extra,
  })
}

/** The options of an App Router browser library run: no Pages build, the library stop in an app with an `app/` folder. */
function appOptions(
  staged: StagedLibrary,
  extra: LibraryBrowserRunOptions = {},
): LibraryBrowserRunOptions {
  return libraryBrowserOptions(staged, { nextPages: undefined, ...extra })
}

/** Opens the App Router browser library run without preparing it. */
function openRun(
  context: TestContext,
  staged: StagedLibrary,
  extra: LibraryBrowserRunOptions = {},
) {
  return configuredRuntimeHarness(
    context,
    undefined,
    [],
    appOptions(staged, extra),
  )
}

/** Catches what the run's preparation rejects with. */
async function preparationFailure(
  harness: Awaited<ReturnType<typeof openRun>>,
): Promise<unknown> {
  return harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
}

/** Reads a thrown refusal's code and details as plain data. */
function refusalOf(failure: unknown) {
  return {
    code: Reflect.get(Object(failure), 'code'),
    details: plain(Reflect.get(Object(failure), 'details')),
  }
}

/** Waits for the run to fail and reads its first failure as the agent does. */
async function firstFailureOf(harness: Awaited<ReturnType<typeof openRun>>) {
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

/** The details a refusal at the seal carries: an App Router app, after the entry request. */
const AT_SEAL = { router: 'app', sideEffects: 'unknown' }

/** The checked-out library file's real path and the path Next writes for it (the build map's entry resolved against the app). */
async function pathsOf(harness: Awaited<ReturnType<typeof openRun>>) {
  const realRoot = await realpath(harness.directory)
  return {
    checkedOut: join(realRoot, LIBRARY_SOURCE_PATH),
    appResolved: resolve(
      join(realRoot, LIBRARY_APP_FOLDER),
      '../../src/core.ts',
    ),
  }
}

// protects=AC 1 a browser stop on `return doubled` in a workspace library of a nested App Router app pauses in the library module, requests its breakpoint on the checked-out file, launches the browser with the one exact override for the path Next writes, and records the library's repository path, the checked-out hash and the source line; fails_when=the stop is refused outside-package, the breakpoint is requested on a built file or the app-resolved path, the override is missing or a wildcard, or the record names another file, hash or line; no_claim=a real Next compile, Chrome or js-debug (chunks, debugger and click are scripted; the module is announced in js-debug's resolved spelling; the maps are written as Next 16.2.2 writes them in E1 of Cycle 0080)
test('a browser stop in a workspace library of a nested App Router app pauses in the checked-out library file with the exact map override', async (context) => {
  // Arrange
  const staged = stageApp({ chunks: { layout: [], page: ['modern'] } })
  const harness = await openRun(context, staged)
  await harness.run.prepare()
  const { checkedOut, appResolved } = await pathsOf(harness)
  // Act
  const requested = harness.breakpoints
    .filter((breakpoint) => breakpoint.id.startsWith('owned-breakpoint'))
    .map((breakpoint) => breakpoint.location.uri.fsPath)
  harness.run.action('op-1', LIBRARY_BROWSER_OPERATION)
  const stop = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the browser stop in the library',
  )
  // Assert
  assert.equal(
    harness.definition.configuration.source.path,
    LIBRARY_SOURCE_PATH,
  )
  assert.equal(stop.source.line, LIBRARY_RETURN_LINE)
  assert.equal(stop.source.hash, sha256(LIBRARY_SOURCE))
  assert.deepEqual(plain(stop.values), { 'value:doubled': 6 })
  assert.deepEqual(requested, [checkedOut])
  // The path Next writes is spelled by the app's lexical folder and by its real folder, which differ under a symlinked temp folder.
  assert.deepEqual(
    plain(harness.launchConfigurations[0]!.sourceMapPathOverrides),
    {
      'webpack://_N_E/./*': `${await realpath(harness.directory)}/${LIBRARY_APP_FOLDER}/*`,
      [appResolved]: checkedOut,
      [resolve(
        join(harness.directory, LIBRARY_APP_FOLDER),
        '../../src/core.ts',
      )]: checkedOut,
    },
  )
  await harness.run.continue('browser', stop.pause)
})

// protects=AC 1 a library module that two client chunks (layout.js and page.js) carry as byte-identical copies is one module: the stop is sealed and pauses; fails_when=identical copies are refused as not-in-build or ambiguous; no_claim=a real second chunk, the one script id of the pair (E1 measured it natively; here the page announces the module once)
test('a nested App Router library stop whose module sits in two client chunks as identical copies pauses', async (context) => {
  // Arrange
  const staged = stageApp()
  // Act
  const { harness, stop } = await pausedLibraryBrowserRun(
    context,
    staged,
    appOptions(staged),
  )
  // Assert
  assert.equal(
    harness.definition.configuration.source.path,
    LIBRARY_SOURCE_PATH,
  )
  assert.equal(stop.source.line, LIBRARY_RETURN_LINE)
  assert.deepEqual(plain(stop.values), { 'value:doubled': 6 })
  await harness.run.continue('browser', stop.pause)
})

// protects=AC 1 (D16) a top page inside a route group (app/(shop)/page.tsx, entry /) still resolves the entry route's client chunks through the App paths manifest, so the library stop pauses; fails_when=the route is looked up as app/page and the chunk set is missing; no_claim=Next's real route-group manifest names (the manifest keys are written as Next writes them)
test('a nested App Router library stop under a top page in a route group pauses', async (context) => {
  // Arrange
  const staged = stageApp({ routeGroup: true })
  // Act
  const { harness, stop } = await pausedLibraryBrowserRun(
    context,
    staged,
    appOptions(staged),
  )
  // Assert
  assert.equal(
    harness.definition.configuration.source.path,
    LIBRARY_SOURCE_PATH,
  )
  assert.equal(stop.source.line, LIBRARY_RETURN_LINE)
  assert.deepEqual(plain(stop.values), { 'value:doubled': 6 })
  await harness.run.continue('browser', stop.pause)
})

// protects=AC 3 a build map that does not name the file is refused library-build-unmapped at the freeze before any server starts, for an App Router app too; fails_when=the stop is sealed from a map that cannot translate it; no_claim=the other unmapped causes (library unit tests)
test('a nested App Router library stop with an unmapped build is refused before any server starts', async (context) => {
  // Arrange
  const staged = stageApp(
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
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.equal(refusalOf(failure).details.reason, 'library-build-unmapped')
  assert.equal(refusalOf(failure).details.sideEffects, 'none')
  assert.equal(harness.developmentServerLaunches(), 0)
})

// protects=AC 3 a build made from an older source is refused library-build-stale at the freeze before any server starts; fails_when=a server starts or the refusal reports other effects; no_claim=the freeze's own cases (library unit tests)
test('a nested App Router library stop with a stale build is refused before any server starts', async (context) => {
  // Arrange
  const staged = stageApp(
    {},
    { builtFrom: LIBRARY_SOURCE.replace('count * 2', 'count + count') },
  )
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
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

// protects=AC 3 a library module that no client chunk of the route carries is refused library-not-in-build, naming the frozen built file, before any input; fails_when=the stop is armed on a module the page never loads; no_claim=a real lazily loaded chunk (the chunks simply lack the module)
test('a nested App Router library stop whose module is in no client chunk is refused as not-in-build before any input', async (context) => {
  // Arrange
  const staged = stageApp({ chunks: { layout: [], page: [] } })
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
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
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 two built flavours of the library in the client chunks are refused library-not-in-build naming both candidates; fails_when=one flavour is sealed anyway; no_claim=which flavour a bundler would pick
test('a nested App Router library stop whose two built flavours are both in the client chunks is refused as not-in-build', async (context) => {
  // Arrange
  const staged = stageLibrary({
    flavours: ['modern', 'legacy'],
    inBrowser: ['modern', 'legacy'],
    inCompile: [],
    appRouter: {},
  })
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
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
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 copies of the module that differ between the two client chunks are refused library-not-in-build, not as an uncoded ambiguity; fails_when=the run ends with the raw ambiguity text or seals one copy; no_claim=how a bundler would come to carry two different copies
test('a nested App Router library stop whose module differs between the two client chunks is refused as not-in-build', async (context) => {
  // Arrange
  const staged = stageApp({ differingPageCopy: true })
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
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

// protects=AC 3 a module whose map names the file at another path than the flavour's app-resolved path is refused library-not-in-build and names the path the map gave; fails_when=the module is sealed and the override would point at a path nothing maps; no_claim=a module with several sources (this row is the other-path case)
test('a nested App Router library stop whose map names another path than Next writes is refused as not-in-build', async (context) => {
  // Arrange
  const staged = stageApp({ mapSources: ['/elsewhere/src/core.ts'] })
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
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
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 a second module of the chunk set whose map names the same path is refused library-place-ambiguous, since two modules would bind one breakpoint; fails_when=the stop is sealed on one of two modules; no_claim=a real second module that composes the same file
test('a nested App Router library stop whose path another module also names is refused as place-ambiguous', async (context) => {
  // Arrange
  const staged = stageApp({ extraNamingModule: true })
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-place-ambiguous',
      ...LIBRARY_IDENTITY,
      ...AT_SEAL,
    },
  })
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 a module whose sourcesContent differs from the checked-out file (a build changed between the freeze and the seal) is refused RUNTIME_FAILED library-build-changed before any input; fails_when=the module is sealed with other text than the checked-out file; no_claim=Next's real recompile (the chunk is written with other content before the start)
test('a nested App Router library stop whose module carries other source text than the checked-out file is refused as build-changed', async (context) => {
  // Arrange
  const staged = stageApp({
    mapContent: LIBRARY_SOURCE.replace('count * 2', 'count + count'),
  })
  const harness = await openRun(context, staged)
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
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 (arming) executed library bytes that differ from the sealed ones when the stop is armed end the run with library-build-changed; fails_when=the generic changed-module error is raised instead; no_claim=a real rebuild
test('executed App Router library bytes that differ at arming end the run with library-build-changed', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  harness.replaceExecutedModule('rebuilt()')
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

// protects=AC 3 (new script id) the sealed library module parsed again under another script id ends the run with library-build-changed, not the generic changed-after-sealing text; fails_when=the generic text is used; no_claim=Next's real hot update (the announcement is scripted)
test('an App Router library module announced again under a new script id ends the run with library-build-changed', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  await harness.run.prepare()
  // Act
  harness.announceSealedModule('second')
  const restored = await firstFailureOf(harness)
  // Assert
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.equal(restored?.libraryDetails?.reason, 'library-build-changed')
})

// protects=AC 3 (pause) executed library bytes that differ only when the pause is inspected end the run with library-build-changed and capture nothing; fails_when=the pause is captured, or the failure is the generic one; no_claim=a real rebuild
test('executed App Router library bytes that differ only at the pause end the run with library-build-changed and capture nothing', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  await harness.run.prepare()
  harness.replaceExecutedModule('rebuilt()')
  // Act
  harness.run.action('op-1', LIBRARY_BROWSER_OPERATION)
  const restored = await firstFailureOf(harness)
  // Assert
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.equal(restored?.libraryDetails?.reason, 'library-build-changed')
  assert.equal(harness.run.view().snapshots.length, 0)
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

// protects=AC 4 a server stop in a workspace library of a nested App Router app stays refused outside-package before any process starts; fails_when=the stop is frozen as a library stop or a server starts; no_claim=a server stop of a Pages app (library server stop tests)
test('a server stop in a library of a nested App Router app stays refused outside-package before any server starts', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged, {
    participant: 'server',
    operations: {
      operations: [{ kind: 'click', title: 'Next page', selector: 'a' }],
      stopOperations: [1],
      stopParticipants: ['server'],
    },
  })
  // Act
  const failure = await preparationFailure(harness)
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

// protects=AC 4 a browser stop in a library of a nested app with both routers stays refused outside-package before any process starts, since its entry route is known only after the server started; fails_when=the stop is frozen as an App Router library stop; no_claim=a both-routers app whose entry resolves to an App page
test('a browser stop in a library of a nested app with both routers stays refused outside-package before any server starts', async (context) => {
  // Arrange
  const staged = withPagesFolder(stageApp())
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
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

/** The options of a run without a nested app: a stop in a library path of the repository's root app. */
const ROOT_APP_OPTIONS: LibraryBrowserRunOptions = {
  participant: 'browser',
  sourcePath: LIBRARY_SOURCE_PATH,
  fixture: {
    source: LIBRARY_SOURCE,
    citationEndLine: 4,
    declaredLine: LIBRARY_RETURN_LINE,
  },
  // The stand-in reader's module maps the first three lines.
  mappings: 'AAAA;AACA;AACA',
}

// protects=AC 4 a library-path browser stop of a root App Router app is not frozen: the app's own App Router reader gets the stop and the browser launch carries no library override; fails_when=a root app freezes a library build or the launch carries an override; no_claim=the reader's own refusal text (the harness stands in for the reader, whose refusal tests live with it)
test('a library-path browser stop of a root app is read by the app reader and launches with no library override', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    ...ROOT_APP_OPTIONS,
    operations: {
      operations: [{ kind: 'click', title: 'Next page', selector: 'a' }],
      stopOperations: [1],
      stopParticipants: ['browser'],
    },
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(harness.readerRoots.developmentBundle.length, 1)
  assert.deepEqual(
    Object.keys(plain(harness.launchConfigurations[0]!.sourceMapPathOverrides)),
    ['webpack://_N_E/./*'],
  )
})

// protects=AC 4 a version 2 configuration has no packageRoot and so no library freeze: its browser stop in a library path goes to the app reader and the launch carries no library override; fails_when=a version 2 run freezes a library build; no_claim=the reader's own refusal text
test('a version 2 browser stop in a library path is read by the app reader and launches with no library override', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    ROOT_APP_OPTIONS,
  )
  // Act
  await harness.run.prepare().catch(() => undefined)
  // Assert
  assert.equal(harness.readerRoots.developmentBundle.length, 1)
  assert.deepEqual(
    Object.keys(plain(harness.launchConfigurations[0]!.sourceMapPathOverrides)),
    ['webpack://_N_E/./*'],
  )
})
