import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  configuredStudySchema,
  type ConfiguredStudy,
} from '../configuredStudySchemas'
import {
  READABLE_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
  VITE_PACKAGE_ROOT_STUDY_VERSION,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import type * as NewerStudyFormatMessageModule from '../utils/newerStudyFormatMessage'
import {
  evidenceFormatOfStudy,
  studyFormatOfConfiguration,
} from '../utils/studyFormatOfConfiguration'

import { captureBrowserOnlyOperationsStudy } from './utils/captureBrowserOnlyOperationsStudy'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'
import { replaySavedServerStop } from './utils/replaySavedServerStop'
import { savedStudyFileWithoutRunIds } from './utils/savedStudyFileWithoutRunIds'

const FIXTURES = resolve(__dirname, '../../src/tests/fixtures')
const BROWSER_ONLY_V7_PATH = join(
  FIXTURES,
  'operations-study-v0.2.72.0/browser-only-v3.study.v7.json',
)
const ROOT_VITE_GOLDEN_DIRECTORY = join(FIXTURES, 'saved-bytes-0ae7c82c')
const NESTED_VITE_FOLDER = 'examples/react/basic'

/**
 * Reseals the 0.2.72.0 browser-only study as a study of another adapter, format and package folder, the way a save of that shape is built (the configuration hash covers the new configuration).
 * @param adapter - The adapter the configuration names.
 * @param version - The format number to give the study.
 * @param packageRoot - The `packageRoot` value; `undefined` leaves the field out.
 * @returns The resealed study.
 * @example await resealedBrowserStudy('vite-dev', 10, 'examples/react/basic') // version 10
 */
async function resealedBrowserStudy(
  adapter: 'vite-dev' | 'next-dev-webpack',
  version: number,
  packageRoot: string | undefined,
): Promise<ConfiguredStudy> {
  const study: ConfiguredStudy = JSON.parse(
    await readFile(BROWSER_ONLY_V7_PATH, 'utf8'),
  )
  const configuration = {
    ...study.configuration,
    adapter,
    ...(packageRoot === undefined ? {} : { packageRoot }),
  }
  return {
    ...study,
    version,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
  } as ConfiguredStudy
}

// protects=a format 10 study of a nested Vite app is saved as .study.v10.json, reads back with its packageRoot and follows the format 7 evidence rules; fails_when=the storage table lacks v10, the library drops the packageRoot, or browser-only evidence is read by the format 8 rules; no_claim=a live run (the study is resealed from the 0.2.72.0 golden)
test('a format 10 study of a nested Vite app is saved as .study.v10.json and reopens with its package folder', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-10-'))
  context.after(() => removeTestFolder(directory))
  const study = await resealedBrowserStudy('vite-dev', 10, NESTED_VITE_FOLDER)
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const files = (await readdir(directory)).sort()
  // Assert
  assert.deepEqual(files, [
    `${study.id}.study.meta.v10.json`,
    `${study.id}.study.v10.json`,
  ])
  assert.equal(reopened.version, 10)
  assert.equal(
    'packageRoot' in reopened.configuration &&
      reopened.configuration.packageRoot,
    'examples/react/basic',
  )
  assert.equal(evidenceFormatOfStudy(reopened), 7)
})

// protects=format 10 belongs to a Vite configuration and format 9 to a Next one: the pairing refuses the crossed studies and a format 10 study without a package folder or with "."; fails_when=format 10 decodes with a Next configuration, format 9 decodes with a Vite one, or format 10 decodes without a package folder; no_claim=the wording of the schema message for "."
test('a format 10 study with a Next configuration and a format 9 study with a Vite configuration are refused', async () => {
  // Arrange
  const tenWithNext = await resealedBrowserStudy(
    'next-dev-webpack',
    10,
    NESTED_VITE_FOLDER,
  )
  const nineWithVite = await resealedBrowserStudy(
    'vite-dev',
    9,
    NESTED_VITE_FOLDER,
  )
  const tenWithoutFolder = await resealedBrowserStudy('vite-dev', 10, undefined)
  const tenWithRoot = await resealedBrowserStudy('vite-dev', 10, '.')
  // Act
  const decodeOf = (study: ConfiguredStudy) => (): unknown =>
    decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  for (const crossed of [tenWithNext, nineWithVite, tenWithoutFolder])
    assert.throws(decodeOf(crossed), {
      message: 'Configured archive and intent versions disagree.',
    })
  assert.throws(decodeOf(tenWithRoot))
})

// protects=a format 10 Vite study that declares a server participant is refused, as the live schema refuses it; fails_when=the saved-study variant skips the vite-dev server refusal; no_claim=which message the schema gives
test('a format 10 Vite study that declares a server stop is refused', async () => {
  // Arrange
  const study = await resealedBrowserStudy('vite-dev', 10, NESTED_VITE_FOLDER)
  const configuration = { ...study.configuration, participant: 'server' }
  const withServer = {
    ...study,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
  } as ConfiguredStudy
  // Act
  const decode = (): unknown =>
    decodeConfiguredStudy(withServer, withServer.workspaceKey)
  // Assert
  assert.throws(decode)
})

// protects=the configuration decides the format of a new save: a nested Vite app gives 10, a nested Next app 9, a root Vite app (no field or ".") keeps 7; fails_when=a Vite package folder is saved as format 9, or "." changes the format; no_claim=captureStudy (test below)
test('studyFormatOfConfiguration gives 10 for a nested Vite app, 9 for a nested Next app and 7 for a root Vite app', async () => {
  // Arrange
  const browserOnly = (await browserStudyConfiguration('vite-dev'))
    .configuration
  const withFolder = (
    adapter: 'vite-dev' | 'next-dev-webpack',
    packageRoot: string | undefined,
  ): ConfiguredStudy['configuration'] => ({
    ...browserOnly,
    adapter,
    ...(packageRoot === undefined ? {} : { packageRoot }),
  })
  // Act
  const formats = [
    withFolder('vite-dev', undefined),
    withFolder('vite-dev', '.'),
    withFolder('vite-dev', NESTED_VITE_FOLDER),
    withFolder('next-dev-webpack', NESTED_VITE_FOLDER),
  ].map(studyFormatOfConfiguration)
  // Assert
  assert.deepEqual(formats, [7, 7, 10, 9])
})

/**
 * Gives the 0.2.72.0 browser-only study resealed for an adapter, for its configuration.
 * @param adapter - The adapter to name.
 * @returns The resealed root study.
 * @example (await browserStudyConfiguration('vite-dev')).configuration.adapter // => 'vite-dev'
 */
function browserStudyConfiguration(
  adapter: 'vite-dev' | 'next-dev-webpack',
): Promise<ConfiguredStudy> {
  return resealedBrowserStudy(adapter, 7, undefined)
}

// protects=the study writer saves a Vite run that resolved a folder below the repository root as format 10 with packageRoot in its configuration; fails_when=the writer saves it as format 9 or without the folder; no_claim=a real Vite run (the controlled runtime reports the folder the way the run view does)
test('the study writer saves a Vite run below the repository root as format 10 with its package folder', async (context) => {
  // Arrange
  const options = {
    adapter: 'vite-dev' as const,
    resolvedPackageRoot: NESTED_VITE_FOLDER,
  }
  // Act
  const study = await captureBrowserOnlyOperationsStudy(context, options)
  const saved = await savedStudyFileWithoutRunIds(context, study)
  // Assert
  assert.equal(study.version, 10)
  assert.equal(
    'packageRoot' in study.configuration && study.configuration.packageRoot,
    'examples/react/basic',
  )
  assert.equal(saved.fileName, '<run-specific>.study.v10.json')
})

// protects=a root Vite run is saved byte for byte as main 0ae7c82c (v0.2.77.0) saved it, run ids and times masked; fails_when=the writer changes a field, its order, the format or the file name of a root Vite study; no_claim=a real run (the controlled operations runtime stands in); the golden was recorded once on 0ae7c82c from this test's capture
test('a root Vite run is saved as the same format 7 file main 0ae7c82c saved', async (context) => {
  // Arrange
  const recorded = await readFile(
    join(ROOT_VITE_GOLDEN_DIRECTORY, 'vite-root-browser-format-7.json'),
    'utf8',
  )
  // Act
  const saved = await savedStudyFileWithoutRunIds(
    context,
    await captureBrowserOnlyOperationsStudy(context, { adapter: 'vite-dev' }),
  )
  // Assert
  assert.equal(saved.fileName, '<run-specific>.study.v7.json')
  assert.equal(saved.text, recorded)
})

// protects=Codebook 0.2.77.0 (readable up to 9) lists a .study.v10.json file as saved by a newer Codebook and keeps it, with its sidecar kept out of the listing; fails_when=the 9-reader rule stops recognising the v10 file name or takes the sidecar for an archive; no_claim=the 0.2.77.0 binary (its newerStudyArchive and message run here over the constant 9)
test('the 0.2.77.0 rule lists a .study.v10.json archive as saved by a newer Codebook, with its sidecar kept out of the listing', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 9 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  const message = await loadModule<typeof NewerStudyFormatMessageModule>(
    resolve(__dirname, '../utils/newerStudyFormatMessage.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v10.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v10.json')
  // Assert
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 10 })
  assert.equal(sidecar, undefined)
  assert.equal(
    message.newerStudyFormatMessage(10),
    'This study was saved in format 10 by a newer Codebook; this Codebook reads formats up to 9. Update the extension to open it. The study is kept as it is.',
  )
})

// protects=format 10 stays a known format in the storage table and the schema, while this Codebook now reads up to format 23; fails_when=v10 is missing from the storage table or the schema, or format 23 is accepted; no_claim=archive contents
test('storage names and schema keep format 10 and read nothing above format 22', () => {
  // Arrange
  const row = STUDY_STORAGE_FORMATS.find((format) => format.version === 10)
  const schemaVersion = configuredStudySchema.shape.version
  // Act
  const acceptsTwentyFour = schemaVersion.safeParse(24).success
  // Assert
  assert.deepEqual(row, {
    version: 10,
    format: 'v10',
    archiveSuffix: '.study.v10.json',
    metadataSuffix: '.study.meta.v10.json',
  })
  assert.equal(READABLE_STUDY_VERSION, 23)
  assert.equal(VITE_PACKAGE_ROOT_STUDY_VERSION, 10)
  assert.equal(schemaVersion.safeParse(10).success, true)
  assert.equal(acceptsTwentyFour, false)
})

// protects=a format 10 study replays its recorded browser stop (source line and values) from the library, also after the app folder is removed; fails_when=the replay of format 10 needs the app folder or loses the recorded values; no_claim=the editor's native debugger (the replay debug adapter is driven directly); the study is resealed from the 0.2.72.0 golden
test('a format 10 study replays its recorded browser stop after the app folder is removed', async (context) => {
  // Arrange
  const appFolder = await mkdtemp(join(tmpdir(), 'codebook-vite-app-'))
  context.after(() => removeTestFolder(appFolder))
  await mkdir(join(appFolder, 'src'), { recursive: true })
  const sealed = await resealedBrowserStudy('vite-dev', 10, NESTED_VITE_FOLDER)
  const [paused, ...later] = sealed.observations
  assert.ok(paused)
  // The golden holds no native debugger state; give its one browser stop the frame and value the editor would show.
  const study: ConfiguredStudy = {
    ...sealed,
    observations: [
      {
        ...paused,
        debugger: {
          version: 1,
          frames: [
            {
              name: 'handleClick',
              line: 1,
              column: 1,
              source: {
                name: sealed.configuration.source.path,
                text: paused.source.text,
                hash: paused.source.hash,
                line: 1,
              },
              scopes: [{ name: 'Local', variables: [0] }],
            },
          ],
          variables: [{ name: 'count', value: '3', children: [] }],
          limitations: [],
        },
      },
      ...later,
    ],
  }
  const replayedBefore = await replaySavedServerStop(context, study, 'browser')
  // not cleanup: deletes a path the code under test must find missing
  await rm(appFolder, { recursive: true, force: true })
  // Act
  const replayedAfter = await replaySavedServerStop(context, study, 'browser')
  // Assert
  assert.equal(replayedAfter.study.version, 10)
  assert.equal(replayedAfter.topFrameName, 'handleClick')
  assert.equal(replayedAfter.topFrameLine, 1)
  assert.deepEqual(replayedAfter.variables, [{ name: 'count', value: '3' }])
  assert.deepEqual(replayedAfter.variables, replayedBefore.variables)
})
