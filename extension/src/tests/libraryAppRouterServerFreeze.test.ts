import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  libraryAppServerOptions,
  stageAppServer,
} from './utils/libraryAppServerRunHarness'
import {
  buildLibraryFile,
  LIBRARY_APP_FOLDER,
  LIBRARY_SOURCE_PATH,
  type LibraryFixtureSpec,
} from './utils/libraryBuildHarness'

/** The second library file's repository-relative path; its package is {@link SECOND_LIBRARY_NAME}. */
const SECOND_SOURCE_PATH = 'packages/lib2/src/core.ts'

/** The package name of the second library. */
const SECOND_LIBRARY_NAME = 'lib2'

/** The text `createConfiguredStudy` gives its second source, which the second stop cites at line 1. */
const SECOND_SOURCE_TEXT = 'export const mode = "display";\n'

/** Copies a value out of the run module's realm. @example plain(details) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Reads a thrown refusal's code and details as plain data. @example refusalOf(failure) */
function refusalOf(failure: unknown) {
  return {
    code: Reflect.get(Object(failure), 'code'),
    details: plain(Reflect.get(Object(failure), 'details')),
  }
}

/**
 * Opens a run of two server stops, the first in the staged library file and the second in a file of another library.
 *
 * Why it exists: the freeze's conflict check sees the stops one after the other, so a collision needs a second frozen file; a second library is the way two checked-out files share one build-map entry string.
 * @param context - The running test.
 * @param rewriteBuilt - Replaces the first library's build map (the star case).
 * @returns The opened (not prepared) harness.
 * @example const harness = await openTwoStopRun(context)
 */
async function openTwoStopRun(
  context: TestContext,
  rewriteBuilt?: LibraryFixtureSpec['rewriteBuilt'],
) {
  const staged = stageAppServer({}, rewriteBuilt ? { rewriteBuilt } : {})
  return configuredRuntimeHarness(
    context,
    undefined,
    [
      {
        line: 1,
        column: 1,
        inspections: [{ path: 'mode', mode: 'value', required: true }],
      },
    ],
    libraryAppServerOptions(staged, {
      additionalStopFile: SECOND_SOURCE_PATH,
      operations: {
        operations: [],
        stopOperations: [0, 0],
        stopParticipants: ['server', 'server'],
      },
    }),
  )
}

/** Writes a file below the repository, creating its folders. @example await put(directory, 'packages/lib2/package.json', '{}') */
async function put(
  directory: string,
  path: string,
  text: string,
): Promise<void> {
  await mkdir(dirname(join(directory, path)), { recursive: true })
  await writeFile(join(directory, path), text)
}

/**
 * Stages the second library: a package whose build map names `../../src/core.ts`, the same string the first library's map holds, so both resolve to one path against the app's package root.
 * @param directory - The repository directory.
 * @example await stageSecondLibrary(harness.directory)
 */
async function stageSecondLibrary(directory: string): Promise<void> {
  const built = buildLibraryFile(SECOND_SOURCE_TEXT, 'modern')
  await put(
    directory,
    'packages/lib2/package.json',
    JSON.stringify({ name: SECOND_LIBRARY_NAME }),
  )
  await put(directory, 'packages/lib2/build/modern/core.js', built.builtText)
  await put(directory, 'packages/lib2/build/modern/core.js.map', built.mapText)
  await symlink(
    '../../../packages/lib2',
    join(directory, LIBRARY_APP_FOLDER, 'node_modules', SECOND_LIBRARY_NAME),
  )
}

/** Prepares the run and returns what it rejects with. @example await preparationFailure(harness) */
function preparationFailure(
  harness: Awaited<ReturnType<typeof openTwoStopRun>>,
) {
  return harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
}

// protects=AC 3 case 4 two server stops in files of different libraries whose build maps resolve to one app-resolved path are refused library-place-ambiguous at the freeze with sideEffects none, before any server starts; fails_when=the freeze does not hand a server stop's entry to the conflict check, so the second stop silently takes the first one's override key; no_claim=a browser stop beside the server stop (the unit test covers the participant mix) and a real Next compile
test('two server library stops whose build maps resolve to one app path are refused as place-ambiguous before any server starts', async (context) => {
  // Arrange
  const harness = await openTwoStopRun(context)
  await stageSecondLibrary(harness.directory)
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  const refusal = refusalOf(failure)
  assert.equal(refusal.code, 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(
    {
      reason: refusal.details.reason,
      router: refusal.details.router,
      sideEffects: refusal.details.sideEffects,
      file: refusal.details.file,
    },
    {
      reason: 'library-place-ambiguous',
      router: 'app',
      sideEffects: 'none',
      file: SECOND_SOURCE_PATH,
    },
  )
  assert.equal(harness.developmentServerLaunches(), 0)
})

// protects=AC 3 case 3 a server stop whose build map names a path holding `*` is refused library-place-ambiguous at the freeze with sideEffects none, before any server starts; fails_when=the freeze skips the wildcard check for a server stop, so an override key with a star reaches the debugger; no_claim=a package root whose own folder holds a star (the star here sits in the map entry, reached through a link) and a real Next compile
test('a server library stop whose build map path holds a star is refused as place-ambiguous before any server starts', async (context) => {
  // Arrange
  const harness = await openTwoStopRun(context, (built) => ({
    builtText: built.builtText,
    mapText: JSON.stringify({
      ...JSON.parse(built.mapText),
      sources: ['../../s*/core.ts'],
    }),
  }))
  // The star folder is a link to the real source folder, so the map entry still names the checked-out file.
  await symlink('src', join(harness.directory, 'packages/lib/s*'))
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  const refusal = refusalOf(failure)
  assert.equal(refusal.code, 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(
    {
      reason: refusal.details.reason,
      router: refusal.details.router,
      sideEffects: refusal.details.sideEffects,
      file: refusal.details.file,
    },
    {
      reason: 'library-place-ambiguous',
      router: 'app',
      sideEffects: 'none',
      file: LIBRARY_SOURCE_PATH,
    },
  )
  assert.equal(harness.developmentServerLaunches(), 0)
})
