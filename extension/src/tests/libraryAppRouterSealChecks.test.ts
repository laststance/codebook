import assert from 'node:assert/strict'
import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  libraryBrowserOptions,
  type LibraryBrowserRunOptions,
} from './utils/libraryBrowserRunHarness'
import {
  LIBRARY_APP_FOLDER,
  LIBRARY_SOURCE_PATH,
} from './utils/libraryBuildHarness'
import {
  stageLibrary,
  type StagedLibrary,
} from './utils/libraryServerRunHarness'

/** The chunk Next writes for the root layout, below the app's `.next/dev`. */
const LAYOUT_CHUNK = 'static/chunks/app/layout.js'

/** Copies a value out of the run module's realm. @example plain(details) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Stages a nested App Router app whose client chunks hold the library's modern build. @example stageApp() */
function stageApp(
  spec: NonNullable<Parameters<typeof stageLibrary>[0]>['appRouter'] = {},
): StagedLibrary {
  return stageLibrary({ inBrowser: ['modern'], inCompile: [], appRouter: spec })
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
    libraryBrowserOptions(staged, { nextPages: undefined, ...extra }),
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

/** The path Next writes for the library file and the checked-out real path. */
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

/**
 * Appends one module with the given map payload to the root layout chunk of the staged app, after the harness wrote it.
 * @param harness - The opened run.
 * @param mapPayload - The base64 payload of the module's inline source map, or `undefined` for a module without a map.
 * @example await addCompetingModule(harness, Buffer.from('{}').toString('base64'))
 */
async function addCompetingModule(
  harness: Awaited<ReturnType<typeof openRun>>,
  mapPayload: string | undefined,
): Promise<void> {
  const path = join(
    harness.directory,
    LIBRARY_APP_FOLDER,
    '.next/dev',
    LAYOUT_CHUNK,
  )
  const chunk = await readFile(path, 'utf8')
  const moduleText = `work();\n${
    mapPayload === undefined
      ? ''
      : `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${mapPayload}\n`
  }//# sourceURL=webpack-internal:///(app-pages-browser)/./src/other.ts\n`
  const entry = `/***/ "(app-pages-browser)/./src/other.ts":\n/***/ ((module, __webpack_exports__, __webpack_require__) => {\n"use strict";\neval(__webpack_require__.ts(${JSON.stringify(moduleText)}));\n/***/ })`
  await writeFile(path, chunk.replace(/\n\}\]\);\n$/, `,\n${entry}\n}]);\n`))
}

/** A map payload naming the given sources, with the first letter of every path escaped so that no file name appears in the JSON text. */
function escapedMapPayload(sources: readonly string[]): string {
  const json = JSON.stringify({ version: 3, sources, mappings: '' })
  return Buffer.from(json.replaceAll('core.ts', '\\u0063ore.ts')).toString(
    'base64',
  )
}

/** The refusal a collision with another module raises. */
const PLACE_AMBIGUOUS = {
  code: 'NEXT_STOP_NOT_SEALED',
  details: {
    reason: 'library-place-ambiguous',
    packageRoot: LIBRARY_APP_FOLDER,
    library: 'lib',
    file: LIBRARY_SOURCE_PATH,
    router: 'app',
    sideEffects: 'unknown',
  },
}

/** Reads a thrown refusal's code and details as plain data. */
function refusalOf(failure: unknown) {
  return {
    code: Reflect.get(Object(failure), 'code'),
    details: plain(Reflect.get(Object(failure), 'details')),
  }
}

// protects=AC 3 a competing module whose inline map is not JSON may name the stop file, so the stop is refused library-place-ambiguous instead of sealed; fails_when=the collision check skips a module it cannot read and the stop is sealed beside it; no_claim=a map over the byte limit (a module that large does not fit the chunk read bounds of this harness)
test('an App Router library stop is refused as place-ambiguous when another module carries a map that is not JSON', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  await addCompetingModule(
    harness,
    Buffer.from('not json {').toString('base64'),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), PLACE_AMBIGUOUS)
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 a competing module whose inline map has a malformed base64 encoding may name the stop file, so the stop is refused library-place-ambiguous; fails_when=an undecodable map counts as naming nothing; no_claim=a map over the byte limit
test('an App Router library stop is refused as place-ambiguous when another module carries an undecodable map', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  // A payload whose canonical encoding differs from the text: the reader rejects it as malformed.
  await addCompetingModule(harness, 'eyJzb3VyY2VzIjpbXX1=')
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), PLACE_AMBIGUOUS)
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 a competing module that writes the stop file's path with JSON escapes, so the file name never appears in the map text, still collides; fails_when=the cheap file-name test skips the module before the map is parsed; no_claim=other spellings of the path (relative sources)
test('an App Router library stop is refused as place-ambiguous when another module writes the path with escapes', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  const { appResolved } = await pathsOf(harness)
  await addCompetingModule(harness, escapedMapPayload([appResolved]))
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), PLACE_AMBIGUOUS)
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 a competing module whose map names the checked-out real path of the stop file collides, not only the app-resolved path; fails_when=the collision check covers only the found flavour's app-resolved paths; no_claim=a symlinked package root
test('an App Router library stop is refused as place-ambiguous when another module names the checked-out file', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  const { checkedOut } = await pathsOf(harness)
  await addCompetingModule(
    harness,
    Buffer.from(
      JSON.stringify({ version: 3, sources: [checkedOut], mappings: '' }),
    ).toString('base64'),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), PLACE_AMBIGUOUS)
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 a competing module with a readable map that names other files does not block the seal; fails_when=the fail-closed collision check refuses every other module of the chunk set; no_claim=a module without a map
test('an App Router library stop is sealed when another module carries a readable map that names other files', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  await addCompetingModule(
    harness,
    Buffer.from(
      JSON.stringify({
        version: 3,
        sources: ['/elsewhere/x.ts'],
        mappings: '',
      }),
    ).toString('base64'),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.equal(failure, undefined)
})

// protects=AC 3 the map source a library-not-in-build refusal reports is cut to a bounded length, since it is served text; fails_when=a long source path is copied whole into the refusal details; no_claim=other detail fields
test('an App Router library-not-in-build refusal cuts a long map source in its details', async (context) => {
  // Arrange
  const staged = stageApp({ mapSources: [`/${'x'.repeat(5_000)}`] })
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  const { mapSource } = refusalOf(failure).details
  assert.equal(mapSource.length, 512)
  assert.equal(mapSource.endsWith('… [cut]'), true)
  assert.equal(mapSource.startsWith('/xxxx'), true)
})

// protects=AC 3 an uncoded failure of the App Router seal (a listed client chunk that is absent) reports router app, not pages; fails_when=the failure details say router pages for an App Router app; no_claim=the message wording
test('an uncoded failure of the App Router seal reports the app router', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  await rm(
    join(harness.directory, LIBRARY_APP_FOLDER, '.next/dev', LAYOUT_CHUNK),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'RUNTIME_FAILED',
    details: { router: 'app', sideEffects: 'unknown' },
  })
})
