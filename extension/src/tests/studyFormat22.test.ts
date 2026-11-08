import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  PRESS_STUDY_VERSION,
  READABLE_STUDY_VERSION,
  REVERSE_PROXY_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { studyConfigurationSchema } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertReadableStudyFormat } from '../utils/assertReadableStudyFormat'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { declaresReverseProxy } from '../utils/declaresReverseProxy'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import { projectReplayOperations } from '../utils/projectReplayOperations'
import {
  evidenceFormatOfStudy,
  isOperationsStudyFormat,
  isReadableStudyFormatOfConfiguration,
  studyFormatOfConfiguration,
  studyRulesVersionOf,
} from '../utils/studyFormatOfConfiguration'
import { validateRecordingContext } from '../utils/validateRecordingContext'

import { createOperationsStudy } from './utils/createOperationsStudy'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

type Configuration = ConfiguredStudy['configuration']

const REVERSE_PROXY = {
  origin: 'https://app.example.test',
  upstreamPort: 4310,
}

/** Decodes a study and answers `accepted` or the refusal sentence. @example refusalOf(createOperationsStudy('complete', { reverseProxy: true })) // => 'accepted' */
function refusalOf(study: ConfiguredStudy): string {
  try {
    decodeConfiguredStudy(study, study.workspaceKey)
    return 'accepted'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// Value: protects=D28 a run that declares reverseProxy takes format 22 for every base shape; without it each keeps its own format; fails_when=a base shape moves format without the declaration, or the declaration leaves a shape at its own format; no_claim=a live run
test('a run that declares reverseProxy takes format 22 for every base shape; without it each keeps its own format', () => {
  // Arrange
  const base = createOperationsStudy().configuration as Configuration & {
    version: 3
  }
  const shapes: Array<Record<string, unknown>> = [
    { ...base, additionalStops: [] },
    base,
    { ...base, packageRoot: 'apps/web' },
  ]
  // Act
  const withoutDeclaration = shapes.map((shape) =>
    studyFormatOfConfiguration(shape as Configuration),
  )
  const withDeclaration = shapes.map((shape) =>
    studyFormatOfConfiguration({
      ...shape,
      reverseProxy: REVERSE_PROXY,
    } as Configuration),
  )
  // Assert
  assert.deepEqual(withoutDeclaration, [7, 8, 9])
  assert.deepEqual(withDeclaration, [22, 22, 22])
})

// Value: protects=D28 format 22 wins over format 21 when a press is also declared, and an explicit reverseProxy undefined declares nothing; fails_when=a press keeps the study at 21 beside a reverse proxy, or an undefined key moves a study to 22; no_claim=the schema refusal of the key
test('format 22 wins over format 21 for a run that declares a press and a reverse proxy; an explicit undefined declares nothing', () => {
  // Arrange
  const withPress = createOperationsStudy('complete', {
    press: true,
  }).configuration
  const withBoth = {
    ...withPress,
    reverseProxy: REVERSE_PROXY,
  } as Configuration
  const withUndefined = {
    ...withPress,
    reverseProxy: undefined,
  } as Configuration
  // Act
  const formats = [
    studyFormatOfConfiguration(withBoth),
    studyFormatOfConfiguration(withPress),
    studyFormatOfConfiguration(withUndefined),
  ]
  // Assert
  assert.deepEqual(formats, [22, 21, 21])
  assert.equal(REVERSE_PROXY_STUDY_VERSION, 22)
  assert.equal(PRESS_STUDY_VERSION, 21)
})

// Value: protects=D28 a format 22 study follows the rules and evidence format of the run it would otherwise be (format 8 here); fails_when=format 22 reads its own number for the underlying rules and refuses a server-stop observation or demands one it does not keep; no_claim=the fields of formats 12 to 20
test('format 22 keeps the format 8 rules of its underlying run: a study with a server stop decodes', () => {
  // Arrange
  const study = createOperationsStudy('complete', { reverseProxy: true })
  // Act
  const results = [
    studyRulesVersionOf(study),
    evidenceFormatOfStudy(study),
    refusalOf(study),
  ]
  // Assert
  assert.deepEqual(results, [8, 8, 'accepted'])
  assert.equal(study.version, 22)
})

// Value: protects=D28 AC 4 a reverse-proxy replay saves as .study.v22.json, lists as v22 with its outcome, a lost sidecar is repaired by reconcile and a v23 file lists as saved by a newer Codebook; fails_when=keepsCheckpoint or the catalog type omits v22, or the storage table lacks v22; no_claim=disk errors
test('a reverse-proxy replay saves as .study.v22.json, lists as v22, repairs a lost sidecar and lists v23 as saved by a newer Codebook', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-22-'))
  context.after(() => removeTestFolder(directory))
  const study = createOperationsStudy('complete', { reverseProxy: true })
  const library = new LearningLibrary(directory, study.workspaceKey)
  const newerId =
    '00000000-0000-4000-8000-000000000000_11111111-1111-4111-8111-111111111111'
  // Act
  await library.saveStudy(study)
  const files = (await readdir(directory)).sort()
  const listed = (await library.list()).map((entry) => [
    entry.format,
    entry.metadata,
    entry.outcome,
  ])
  await rm(join(directory, `${study.id}.study.meta.v22.json`))
  await library.reconcile()
  const repaired = await library.readCheckpoint(study.id)
  await writeFile(
    join(directory, `${newerId}.study.v23.json`),
    '{"version":23}',
  )
  const withNewer = (await library.list()).map((entry) => entry.format).sort()
  // Assert
  assert.deepEqual(files, [
    `${study.id}.study.meta.v22.json`,
    `${study.id}.study.v22.json`,
  ])
  assert.deepEqual(listed, [['v22', 'validated', 'demonstrated']])
  assert.equal(repaired.status, 'saved')
  assert.deepEqual(withNewer, ['newer', 'v22'])
  assert.deepEqual(
    STUDY_STORAGE_FORMATS.find((format) => format.version === 22),
    {
      version: 22,
      format: 'v22',
      archiveSuffix: '.study.v22.json',
      metadataSuffix: '.study.meta.v22.json',
    },
  )
})

// Value: protects=AC 4 the saved study, not the live run, keeps the stops in order with their Variables in the replay after a window reload; fails_when=the reopened study drops a stop, reorders the stops, loses a Variable, or the replay rows lose an operation; no_claim=a real editor window reload (the native check covers it)
test('a replay reopened after a window reload keeps the stops in order with their Variables', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-22-reload-'))
  context.after(() => removeTestFolder(directory))
  const study = createOperationsStudy('complete', { reverseProxy: true })
  await new LearningLibrary(directory, study.workspaceKey).saveStudy(study)
  // Act
  // A new library object on the stored files is what a window reload does.
  const reopened = await new LearningLibrary(
    directory,
    study.workspaceKey,
  ).readStudy(study.id)
  const recording = validateRecordingContext(
    buildRecordingContext(reopened, [], 1),
    study.workspaceKey,
  )
  const marks = projectReplayOperations(recording, { startMs: 0, endMs: 7000 })
  // Assert
  assert.equal(reopened.version, 22)
  assert.deepEqual(
    reopened.observations.map((observation) => [
      observation.participant,
      observation.debugger?.variables.map((variable) => [
        variable.name,
        variable.value,
      ]),
    ]),
    [
      ['browser', [['nextTheme', 'dark']]],
      ['server', [['mode', 'display']]],
      ['browser', [['nextTheme', 'dark']]],
    ],
  )
  assert.deepEqual(
    marks.map((mark) => [mark.index, mark.kind, mark.title, mark.state]),
    [
      [1, 'choose', 'Customer', 'done'],
      [2, 'text', 'Amount', 'done'],
      [3, 'click', 'Pending', 'done'],
      [4, 'click', 'Create Invoice', 'done'],
    ],
  )
})

// Value: protects=D28 a reverseProxy configuration is held by format 22 only: every older format, 7 to 21, refuses it, one table row per format; fails_when=an older format accepts a reverseProxy configuration, or format 22 refuses one; no_claim=the wording of the refusal beyond the version sentence
test('only format 22 holds a reverseProxy configuration: formats 7 to 21 each refuse it and format 22 accepts it', () => {
  // Arrange
  const study = createOperationsStudy('complete', { reverseProxy: true })
  const olderFormats = [7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 20, 21]
  // Act
  const refusals = olderFormats.map((version) =>
    refusalOf({ ...study, version } as ConfiguredStudy),
  )
  // Assert
  assert.deepEqual(
    refusals.map((refusal) => refusal === 'accepted'),
    olderFormats.map(() => false),
  )
  assert.equal(refusalOf(study), 'accepted')
})

// Value: protects=D28 format 22 holds a configuration that declares reverseProxy only; fails_when=a format 22 study without the declaration decodes; no_claim=the schema member of the declaration
test('a format 22 study without a reverseProxy declaration is refused', () => {
  // Arrange
  const withDeclaration = createOperationsStudy('complete', {
    reverseProxy: true,
  })
  const plain = createOperationsStudy()
  // Act
  const refusal = refusalOf({ ...plain, version: 22 })
  // Assert
  assert.equal(refusal, 'Configured archive and intent versions disagree.')
  assert.equal(
    isReadableStudyFormatOfConfiguration(22, plain.configuration),
    false,
  )
  assert.equal(
    isReadableStudyFormatOfConfiguration(22, withDeclaration.configuration),
    true,
  )
  assert.equal(
    isReadableStudyFormatOfConfiguration(21, withDeclaration.configuration),
    false,
  )
})

// Value: protects=D28 AC 5 the declared origin is stored in canonical spelling only: a trailing slash or an upper-case host is refused by the format 22 member; fails_when=a non-canonical origin is stored, or the canonical one is refused; no_claim=the wording of the refusal
test('a non-canonical origin is not stored in a format 22 study', () => {
  // Arrange
  const study = createOperationsStudy('complete', { reverseProxy: true })
  const spelled = (origin: string): Configuration =>
    ({
      ...study.configuration,
      reverseProxy: { ...REVERSE_PROXY, origin },
    }) as Configuration
  // Act
  const results = [
    'https://app.example.test',
    'https://app.example.test/',
    'https://APP.example.test',
  ].map((origin) => studyConfigurationSchema.safeParse(spelled(origin)).success)
  // Assert
  assert.deepEqual(results, [true, false, false])
})

// Value: protects=D14 D28 Codebook 0.2.103 (readable up to 21) lists .study.v22.json as saved by a newer Codebook, this one reads 22 and refuses 23; fails_when=the file name rule stops recognising v22, the readable limit stays 21, or format 22 is not an operations format; no_claim=the 0.2.103 binary
test('Codebook 0.2.103 lists a .study.v22.json archive and its sidecar as saved by a newer Codebook; this one reads 22', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 21 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v22.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v22.json')
  // Assert
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 22 })
  assert.equal(sidecar, undefined)
  assert.equal(READABLE_STUDY_VERSION, 22)
  assert.equal(isOperationsStudyFormat(22), true)
  assert.equal(isOperationsStudyFormat(23), false)
  assert.doesNotThrow(() => assertReadableStudyFormat({ version: 22 }))
  assert.throws(
    () => assertReadableStudyFormat({ version: 23 }),
    /saved in format 23 by a newer Codebook; this Codebook reads formats up to 22/,
  )
})

// Value: protects=D28 the format decision tells a present reverseProxy key from an absent one; fails_when=declaresReverseProxy counts an explicit undefined or ignores a present key; no_claim=the run's use of the declaration
test('declaresReverseProxy counts a present key and ignores an absent or explicitly undefined one', () => {
  // Arrange
  const present = { reverseProxy: REVERSE_PROXY }
  const absent = {}
  const explicitlyUndefined = { reverseProxy: undefined }
  // Act
  const results = [present, absent, explicitlyUndefined].map(
    declaresReverseProxy,
  )
  // Assert
  assert.deepEqual(results, [true, false, false])
})

// Value: protects=D28 format 22 is an operations format: a version 2 configuration never takes it; fails_when=a version 2 configuration is given format 22 or declared readable in it; no_claim=the version 1 and 2 schemas
test('a version 2 configuration never takes format 22', () => {
  // Arrange
  const study = createOperationsStudy('complete', { reverseProxy: true })
  const legacy = {
    ...study.configuration,
    version: 2,
    reverseProxy: REVERSE_PROXY,
  } as unknown as Configuration
  // Act
  const format = studyFormatOfConfiguration(legacy)
  // Assert
  assert.equal(format, 6)
  assert.equal(isReadableStudyFormatOfConfiguration(22, legacy), false)
})

// Value: protects=D28 the format of a study is fixed by its configuration alone, so a failed run and a complete run of one configuration save to the same format; fails_when=the format depends on the observations or on the outcome; no_claim=the file names
test('a failed and a complete run of one reverse-proxy configuration take the same format', () => {
  // Arrange
  const complete = createOperationsStudy('complete', { reverseProxy: true })
  const failed = createOperationsStudy('failed-at-3', { reverseProxy: true })
  // Act
  const formats = [complete, failed].map((study) =>
    studyFormatOfConfiguration(study.configuration),
  )
  // Assert
  assert.deepEqual(formats, [22, 22])
  assert.equal(sha256(JSON.stringify(failed.configuration)).length, 64)
})
