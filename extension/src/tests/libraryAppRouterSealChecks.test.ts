import assert from 'node:assert/strict'
import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'

import * as reader from '../utils/readRepositoryBuildText'

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

// protects=AC 3 a competing module without any inline map names no file, so the stop is sealed beside it (most modules of a real chunk set carry no map); fails_when=the fail-closed collision check treats an absent map as unreadable and refuses the seal; no_claim=a module whose map is present but unreadable (refused above)
test('an App Router library stop is sealed when another module carries no source map at all', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  await addCompetingModule(harness, undefined)
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.equal(failure, undefined)
})

// protects=AC 3 a competing module that spells the app-resolved path with a `..` segment still collides, since the check compares resolved paths; fails_when=the check compares the source text as written and seals beside a module that binds the same breakpoint; no_claim=relative sources and symlinked package roots
test('an App Router library stop is refused as place-ambiguous when another module spells the path with a dot-dot segment', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  const { appResolved } = await pathsOf(harness)
  const unnormalized = appResolved.replace(/core\.ts$/, 'sub/../core.ts')
  await addCompetingModule(
    harness,
    Buffer.from(
      JSON.stringify({ version: 3, sources: [unnormalized], mappings: '' }),
    ).toString('base64'),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), PLACE_AMBIGUOUS)
  assert.equal(harness.inputsSeen(), 0)
})

/** Encodes a map object as the base64 payload of an inline source map. @example mapPayloadOf({ version: 3, sources: [], mappings: '' }) */
function mapPayloadOf(map: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(map)).toString('base64')
}

// protects=AC 3 a competing module whose map spells the stop file as sourceRoot plus a relative source collides; fails_when=the collision check compares the source text alone and seals beside a module that binds the same breakpoint; no_claim=a relative sourceRoot (it has no base to resolve against)
test('an App Router library stop is refused as place-ambiguous when another module names the file through sourceRoot', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  const { appResolved } = await pathsOf(harness)
  await addCompetingModule(
    harness,
    mapPayloadOf({
      version: 3,
      sourceRoot: dirname(appResolved),
      sources: ['core.ts'],
      mappings: '',
    }),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), PLACE_AMBIGUOUS)
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 a competing module whose map names the stop file as a file:// URL collides; fails_when=a file URL is compared as text and never resolved to its path; no_claim=other URL schemes
test('an App Router library stop is refused as place-ambiguous when another module names the file as a file URL', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  const { appResolved } = await pathsOf(harness)
  await addCompetingModule(
    harness,
    mapPayloadOf({
      version: 3,
      sources: [pathToFileURL(appResolved).href],
      mappings: '',
    }),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), PLACE_AMBIGUOUS)
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 a competing module with an indexed map whose section names the stop file collides; fails_when=only the top-level sources of a map are read; no_claim=sections nested deeper than the depth limit
test('an App Router library stop is refused as place-ambiguous when another module names the file inside an indexed map section', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  const { appResolved } = await pathsOf(harness)
  await addCompetingModule(
    harness,
    mapPayloadOf({
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: { version: 3, sources: [appResolved], mappings: '' },
        },
      ],
    }),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), PLACE_AMBIGUOUS)
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 a competing indexed map with a section the debugger would fetch by url cannot be read, so the stop is refused; fails_when=an external section is treated as naming nothing; no_claim=fetching the url
test('an App Router library stop is refused as place-ambiguous when another module carries an indexed map with an external section', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  await addCompetingModule(
    harness,
    mapPayloadOf({
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, url: 'https://example.test/a.map' },
      ],
    }),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), PLACE_AMBIGUOUS)
})

// protects=AC 3 a readable file URL map that names another file does not block the seal; fails_when=the widened collision check refuses every file URL; no_claim=a map that names the stop file (refused above)
test('an App Router library stop is sealed when another module names another file as a file URL', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  await addCompetingModule(
    harness,
    mapPayloadOf({
      version: 3,
      sources: [pathToFileURL('/elsewhere/x.ts').href],
      mappings: '',
    }),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.equal(failure, undefined)
})

// protects=AC 3 a map with sourceRoot and a relative source that names another file does not block the seal; fails_when=any sourceRoot map is refused; no_claim=a sourceRoot map that names the stop file (refused above)
test('an App Router library stop is sealed when another module joins sourceRoot to a source in another folder', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  await addCompetingModule(
    harness,
    mapPayloadOf({
      version: 3,
      sourceRoot: '/elsewhere',
      sources: ['core.ts'],
      mappings: '',
    }),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.equal(failure, undefined)
})

/**
 * Rewrites one frozen library file on disk the moment the seal reads it again, after the freeze read it once, so the file changes between the freeze and the seal.
 * @param context - The test context, which restores the reader after the test.
 * @param suffix - The end of the file name to change (`core.js` or `core.js.map`).
 * @example changeFrozenFileAtSeal(context, 'core.js.map')
 */
function changeFrozenFileAtSeal(context: TestContext, suffix: string): void {
  let reads = 0
  const original = reader.readRepositoryBuildText
  context.mock.method(
    reader,
    'readRepositoryBuildText',
    async (...args: Parameters<typeof original>) => {
      const [root, path] = args
      if (path.endsWith(`build/modern/${suffix}`) && ++reads === 2) {
        const fullPath = join(root, path)
        // The text changes; the module map's sourcesContent stays the checked-out text.
        await writeFile(fullPath, `${await readFile(fullPath, 'utf8')}\n`)
      }
      return original(...args)
    },
  )
}

/** The refusal a build that changed after the freeze raises. */
const BUILD_CHANGED = {
  code: 'RUNTIME_FAILED',
  details: {
    reason: 'library-build-changed',
    packageRoot: LIBRARY_APP_FOLDER,
    library: 'lib',
    file: LIBRARY_SOURCE_PATH,
    router: 'app',
    sideEffects: 'unknown',
  },
}

// protects=AC 3 (OV-1) a frozen built file that changed after the freeze, with the module map's sourcesContent unchanged, is refused RUNTIME_FAILED library-build-changed; fails_when=the seal checks only sourcesContent and records the run as the checked-out source's; no_claim=a rebuild Next performs itself
test('an App Router library stop is refused as build-changed when the built file changed after the freeze', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  changeFrozenFileAtSeal(context, 'core.js')
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), BUILD_CHANGED)
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 (OV-1) a frozen build map that changed after the freeze, with the module map's sourcesContent unchanged, is refused RUNTIME_FAILED library-build-changed; fails_when=the seal never re-hashes the build map; no_claim=a rebuild Next performs itself
test('an App Router library stop is refused as build-changed when the build map changed after the freeze', async (context) => {
  // Arrange
  const staged = stageApp()
  const harness = await openRun(context, staged)
  changeFrozenFileAtSeal(context, 'core.js.map')
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), BUILD_CHANGED)
  assert.equal(harness.inputsSeen(), 0)
})
