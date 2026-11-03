import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  configuredStudySchema,
  type ConfiguredStudy,
} from '../configuredStudySchemas'
import {
  PACKAGE_ROOT_STUDY_VERSION,
  READABLE_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { retainedRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import {
  evidenceFormatOfStudy,
  studyFormatOfConfiguration,
  usesServerRenderEvidence,
} from '../utils/studyFormatOfConfiguration'

import { captureBrowserOnlyOperationsStudy } from './utils/captureBrowserOnlyOperationsStudy'
import { capturePagesServerStudy } from './utils/capturePagesServerStudy'
import { createOperationsStudy } from './utils/createOperationsStudy'
import { savedStudyFileWithoutRunIds } from './utils/savedStudyFileWithoutRunIds'

const FIXTURES = resolve(__dirname, '../../src/tests/fixtures')
const BROWSER_ONLY_V7_PATH = join(
  FIXTURES,
  'operations-study-v0.2.72.0/browser-only-v3.study.v7.json',
)
const SERVER_STOP_V7_PATH = join(
  FIXTURES,
  'operations-study-v0.2.72.0/server-action-stop-v3.study.v7.json',
)
const SAVED_BYTES_DIRECTORY = join(FIXTURES, 'saved-bytes-09859e5d')

/**
 * Reseals a study as another format with a package folder in its configuration, the way a format 9 save is shaped (the configuration hash covers the new configuration).
 * @param study - A decodable version 3 study.
 * @param version - The format number to give it.
 * @param packageRoot - The value of `packageRoot`; `undefined` leaves the field out.
 * @returns The study with the field set and its hash recomputed.
 * @example sealedWithPackageRoot(createOperationsStudy(), 9, 'apps/web').version // => 9
 */
function sealedWithPackageRoot(
  study: ConfiguredStudy,
  version: number,
  packageRoot: string | undefined,
): ConfiguredStudy {
  const configuration = {
    ...study.configuration,
    ...(packageRoot === undefined ? {} : { packageRoot }),
  }
  return {
    ...study,
    version,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
  } as ConfiguredStudy
}

async function browserOnlyStudy(): Promise<ConfiguredStudy> {
  return JSON.parse(await readFile(BROWSER_ONLY_V7_PATH, 'utf8'))
}

// protects=D3/V8: a format 9 study of browser-only stops saves as .study.v9.json, reads back and validates by the format 7 rules; fails_when=the storage table lacks v9, or format 9 is read with format 8 rules for a browser-only run; no_claim=a live run (the study is resealed from the 0.2.72.0 golden)
test('a format 9 study of browser-only stops is saved as .study.v9.json, reopens and follows the format 7 rules', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-9-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = sealedWithPackageRoot(await browserOnlyStudy(), 9, 'apps/web')
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const files = (await readdir(directory)).sort()
  // Assert
  assert.deepEqual(files, [
    `${study.id}.study.meta.v9.json`,
    `${study.id}.study.v9.json`,
  ])
  assert.equal(reopened.version, 9)
  assert.equal(evidenceFormatOfStudy(reopened), 7)
  assert.equal(usesServerRenderEvidence(reopened), false)
})

// protects=D3/V8: a format 9 browser-only study that carries a format 8 observation field is refused, as format 7 refuses it; fails_when=format 9 accepts execution fields without a server stop; no_claim=the wording of the refusal beyond the format 8 sentence
test('a format 9 browser-only study carrying an execution field is refused', async () => {
  // Arrange
  const study = sealedWithPackageRoot(await browserOnlyStudy(), 9, 'apps/web')
  const withExecution = {
    ...study,
    observations: study.observations.map((observation) => ({
      ...observation,
      execution: 'browser' as const,
    })),
  }
  // Act
  const decode = (): unknown =>
    decodeConfiguredStudy(withExecution, study.workspaceKey)
  // Assert
  assert.throws(decode, {
    message: 'Only a study of format 8 keeps execution fields.',
  })
})

// protects=D3/V8: a format 9 study with a server stop follows the format 8 rules and decodes with its execution fields; fails_when=format 9 is always read with format 7 rules; no_claim=a live run
test('a format 9 study with a server stop reopens and follows the format 8 rules', () => {
  // Arrange
  const study = sealedWithPackageRoot(createOperationsStudy(), 9, 'apps/web')
  // Act
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  assert.equal(decoded.version, 9)
  assert.equal(evidenceFormatOfStudy(decoded), 8)
  assert.equal(usesServerRenderEvidence(decoded), true)
  assert.deepEqual(
    decoded.observations.map((observation) => observation.declaredIndex),
    [0, 1, 2],
  )
})

// protects=R8: formats 3 to 8 keep rejecting a packageRoot field, in the retained schema and in a saved study; fails_when=a format 7 or 8 study with packageRoot decodes, or the retained union accepts the field; no_claim=the live version 3 schema (lane A1)
test('formats 3 to 8 reject a packageRoot in their configuration', async () => {
  // Arrange
  const asFormat7 = sealedWithPackageRoot(
    await browserOnlyStudy(),
    7,
    'apps/web',
  )
  const asFormat8 = sealedWithPackageRoot(
    createOperationsStudy(),
    8,
    'apps/web',
  )
  // Act
  const retained = retainedRepositoryConfigSchema.safeParse(
    asFormat8.configuration,
  )
  // Assert
  assert.equal(retained.success, false)
  assert.throws(
    () => decodeConfiguredStudy(asFormat7, asFormat7.workspaceKey),
    { message: 'Configured archive and intent versions disagree.' },
  )
  assert.throws(
    () => decodeConfiguredStudy(asFormat8, asFormat8.workspaceKey),
    { message: 'Configured archive and intent versions disagree.' },
  )
})

// protects=R10: a format 9 study whose packageRoot is absent or "." is refused; fails_when=format 9 decodes without a package folder or with the repository root; no_claim=which message the schema gives for "."
test('a format 9 study without a package folder or with "." is refused', () => {
  // Arrange
  const absent = sealedWithPackageRoot(createOperationsStudy(), 9, undefined)
  const rootFolder = sealedWithPackageRoot(createOperationsStudy(), 9, '.')
  // Act
  const decodeAbsent = (): unknown =>
    decodeConfiguredStudy(absent, absent.workspaceKey)
  const decodeRoot = (): unknown =>
    decodeConfiguredStudy(rootFolder, rootFolder.workspaceKey)
  // Assert
  assert.throws(decodeAbsent, {
    message: 'Configured archive and intent versions disagree.',
  })
  assert.throws(decodeRoot)
})

// protects=E12: the configuration decides the format of a new save: a package folder other than "." gives 9, "." or none keeps 7 or 8; fails_when=a "." package root changes the format; no_claim=captureStudy (it needs the live schema of lane A1)
test('studyFormatOfConfiguration gives 9 for a package folder and keeps 7 and 8 for none or "."', async () => {
  // Arrange
  const browserOnly = (await browserOnlyStudy()).configuration
  const withServer = createOperationsStudy().configuration
  const withRoot = (
    configuration: ConfiguredStudy['configuration'],
    packageRoot: string,
  ): ConfiguredStudy['configuration'] =>
    ({ ...configuration, packageRoot }) as ConfiguredStudy['configuration']
  // Act
  const formats = [
    browserOnly,
    withServer,
    withRoot(browserOnly, '.'),
    withRoot(withServer, '.'),
    withRoot(browserOnly, 'apps/web'),
    withRoot(withServer, 'apps/web'),
  ].map(studyFormatOfConfiguration)
  // Assert
  assert.deepEqual(formats, [7, 8, 7, 8, 9, 9])
})

// protects=E11/H1: an old format 7 study with a server-action stop keeps its own format 7 rules (no execution fields required) and still decodes; fails_when=the helper derives format 8 rules for every old format 7 study; no_claim=playback
test('an old format 7 study with a server stop keeps the format 7 rules and decodes', async () => {
  // Arrange
  const golden: ConfiguredStudy = JSON.parse(
    await readFile(SERVER_STOP_V7_PATH, 'utf8'),
  )
  // Act
  const decoded = decodeConfiguredStudy(golden, golden.workspaceKey)
  // Assert
  assert.equal(decoded.version, 7)
  assert.equal(evidenceFormatOfStudy(decoded), 7)
  assert.equal(usesServerRenderEvidence(decoded), false)
})

// protects=D3: the storage table, the readable version and the study schema know format 9; fails_when=v9 is missing from one of them or a format above 9 is accepted; no_claim=archive contents
test('storage names, readable version and schema include format 9', () => {
  // Arrange
  const row = STUDY_STORAGE_FORMATS.find((format) => format.version === 9)
  const schemaVersion = configuredStudySchema.shape.version
  // Act
  const acceptsTen = schemaVersion.safeParse(10).success
  // Assert
  assert.deepEqual(row, {
    version: 9,
    format: 'v9',
    archiveSuffix: '.study.v9.json',
    metadataSuffix: '.study.meta.v9.json',
  })
  assert.equal(READABLE_STUDY_VERSION, 9)
  assert.equal(PACKAGE_ROOT_STUDY_VERSION, 9)
  assert.equal(schemaVersion.safeParse(9).success, true)
  assert.equal(acceptsTen, false)
})

/**
 * Lists the TypeScript sources under `extension/src` outside `tests`.
 * @param directory - The folder to read.
 * @returns Absolute paths of the `.ts` files.
 */
async function sourceFilesOutsideTests(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'tests')
        found.push(...(await sourceFilesOutsideTests(path)))
    } else if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found
}

// protects=V8: only the evidence-format helper compares a study version with the format 7 or 8 constants; fails_when=another source file compares a version with SERVER_RENDER_STUDY_VERSION or OPERATIONS_STUDY_VERSION; no_claim=comparisons by number literal (the helper owns the rules)
test('no source outside the evidence-format helper compares a study version with the format 7 or 8 constants', async () => {
  // Arrange
  const sourceDirectory = resolve(__dirname, '../../src')
  const helperPath = join(
    sourceDirectory,
    'utils/studyFormatOfConfiguration.ts',
  )
  const comparison =
    /(?:[!=]==?|<=?|>=?)\s*(?:SERVER_RENDER_STUDY_VERSION|OPERATIONS_STUDY_VERSION)\b|\b(?:SERVER_RENDER_STUDY_VERSION|OPERATIONS_STUDY_VERSION)\s*(?:[!=]==?|<=?|>=?)/
  // Act
  const offenders: string[] = []
  for (const path of await sourceFilesOutsideTests(sourceDirectory)) {
    if (path === helperPath) continue
    const lines = (await readFile(path, 'utf8')).split('\n')
    lines.forEach((line, position) => {
      // Comments and doc lines may name the constants.
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return
      if (comparison.test(line))
        offenders.push(
          `${path.slice(sourceDirectory.length + 1)}:${position + 1}`,
        )
    })
  }
  // Assert
  assert.deepEqual(offenders, [])
})

// protects=AC 6/T17: a format 7 save of the browser-only run has the same keys in the same order and the same values (run ids, times and generated-code hashes masked) as 09859e5d saved; fails_when=the writer changes a field, its order or the file name of a package-root-free format 7 study; no_claim=a real run (the controlled runtime stands in); the fixture was recorded once at 09859e5d
test('a browser-only run is saved as the same format 7 file 09859e5d saved', async (context) => {
  // Arrange
  const recorded = await readFile(
    join(SAVED_BYTES_DIRECTORY, 'browser-only-format-7.json'),
    'utf8',
  )
  // Act
  const saved = await savedStudyFileWithoutRunIds(
    context,
    await captureBrowserOnlyOperationsStudy(context),
  )
  // Assert
  assert.equal(saved.fileName, '<run-specific>.study.v7.json')
  // The recorded file is formatted by the repository's formatter, so compare compact JSON: key order and every value must match.
  assert.equal(
    JSON.stringify(JSON.parse(saved.text)),
    JSON.stringify(JSON.parse(recorded)),
  )
})

// protects=AC 6/T17: a format 8 save of the Pages server run has the same keys in the same order and the same values (run ids, times and generated-code hashes masked) as 09859e5d saved; fails_when=the writer changes a field, its order or the file name of a package-root-free format 8 study; no_claim=a real run; the fixture was recorded once at 09859e5d
test('a server-render run is saved as the same format 8 file 09859e5d saved', async (context) => {
  // Arrange
  const recorded = await readFile(
    join(SAVED_BYTES_DIRECTORY, 'server-render-format-8.json'),
    'utf8',
  )
  // Act
  const saved = await savedStudyFileWithoutRunIds(
    context,
    await capturePagesServerStudy(context),
  )
  // Assert
  assert.equal(saved.fileName, '<run-specific>.study.v8.json')
  // The recorded file is formatted by the repository's formatter, so compare compact JSON: key order and every value must match.
  assert.equal(
    JSON.stringify(JSON.parse(saved.text)),
    JSON.stringify(JSON.parse(recorded)),
  )
})
