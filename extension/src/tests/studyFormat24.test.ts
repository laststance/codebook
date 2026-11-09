import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  HOLD_STUDY_VERSION,
  READABLE_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { operationsRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertReadableStudyFormat } from '../utils/assertReadableStudyFormat'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
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

/** Where the `hold` is declared in {@link holdStudy}: the top-level stop, an additional stop, or nowhere. */
type HoldPlace = 'top-level' | 'additional' | 'none'

/**
 * Reseals the format 8 operations study with `hold` declared on one stop and gives it a format number.
 * @param version - The format number to write.
 * @param place - Which stop declares the hold.
 * @param hold - The declared hold.
 * @returns The study with its configuration hash recomputed.
 * @example holdStudy(24, 'additional', 'record') // => { version: 24, … }
 */
function holdStudy(
  version: number,
  place: HoldPlace,
  hold: 'explain' | 'record' = 'record',
): ConfiguredStudy {
  const study = createOperationsStudy()
  const base = study.configuration
  if (base.version !== 3) throw new Error('expected a version 3 study')
  // Parsed so that the keys sit in the schema's order, as the start seals them.
  const configuration: Configuration = operationsRepositoryConfigSchema.parse({
    ...base,
    ...(place === 'top-level' ? { hold } : {}),
    additionalStops:
      place === 'additional'
        ? base.additionalStops?.map((stop, position) =>
            position === 0 ? { ...stop, hold } : stop,
          )
        : base.additionalStops,
  })
  return {
    ...study,
    version,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
  } as ConfiguredStudy
}

/** Decodes a study and answers `accepted` or the refusal sentence. */
function refusalOf(study: ConfiguredStudy): string {
  try {
    decodeConfiguredStudy(study, study.workspaceKey)
    return 'accepted'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// Value: protects=a configuration whose top-level or additional stop declares hold (explain or record) is saved as format 24, and one without hold keeps format 8; fails_when=a hold leaves the study at its old format, so Codebook 0.2.107 and older fail on the strict key instead of listing it as saved by a newer Codebook; no_claim=a live run
test('a configuration that declares hold on any stop is saved as format 24; without hold it keeps format 8', () => {
  // Arrange
  const declarations = [
    holdStudy(8, 'top-level', 'record').configuration,
    holdStudy(8, 'additional', 'record').configuration,
    holdStudy(8, 'top-level', 'explain').configuration,
  ]
  const withoutHold = holdStudy(8, 'none').configuration
  const explicitUndefined = {
    ...withoutHold,
    hold: undefined,
  } as Configuration
  // Act
  const formats = declarations.map(studyFormatOfConfiguration)
  const unchanged = [withoutHold, explicitUndefined].map(
    studyFormatOfConfiguration,
  )
  // Assert
  assert.deepEqual(formats, [24, 24, 24])
  assert.deepEqual(unchanged, [8, 8])
})

// Value: protects=format 24 wins over format 21 (press) and format 22 (reverse proxy) when a hold is also declared; fails_when=a press or a reverse proxy keeps the study at 21 or 22 beside a hold; no_claim=the schema refusal of the key
test('format 24 wins over the press format 21 and the reverse proxy format 22', () => {
  // Arrange
  const press = createOperationsStudy('complete', { press: true })
  const proxy = createOperationsStudy('complete', { reverseProxy: true })
  const withHold = (configuration: Configuration): Configuration =>
    ({ ...configuration, hold: 'record' }) as Configuration
  // Act
  const formats = [
    studyFormatOfConfiguration(withHold(press.configuration)),
    studyFormatOfConfiguration(withHold(proxy.configuration)),
    studyFormatOfConfiguration(press.configuration),
    studyFormatOfConfiguration(proxy.configuration),
  ]
  // Assert
  assert.deepEqual(formats, [24, 24, 21, 22])
})

// Value: protects=a format 24 study follows the rules of the run it would otherwise be (format 8 here) and decodes; fails_when=format 24 reads its own number for the underlying rules and refuses a server-stop observation; no_claim=the fields of formats 12 to 20
test('format 24 keeps the format 8 rules of its underlying run: a study with a server stop decodes', () => {
  // Arrange
  const study = holdStudy(24, 'top-level')
  // Act
  const results = [
    studyRulesVersionOf(study),
    evidenceFormatOfStudy(study),
    refusalOf(study),
  ]
  // Assert
  assert.deepEqual(results, [8, 8, 'accepted'])
})

// Value: protects=a study that declares hold is readable as format 24 only, and format 24 holds no configuration without hold, so every older Codebook format refuses the key; fails_when=a format 7 to 22 study decodes a configuration with hold, or format 24 decodes one without; no_claim=the schema member of each older format beyond its refusal
test('only format 24 holds a configuration that declares hold, and format 24 holds none without it', () => {
  // Arrange
  const older = [7, 8, 9, 10, 21, 22, 23]
  const olderStudies = older.map((version) =>
    holdStudy(version, 'additional', 'explain'),
  )
  const own = holdStudy(24, 'additional', 'explain')
  const withoutHold = holdStudy(24, 'none')
  // Act
  const olderRefusals = olderStudies.map(refusalOf)
  // Assert
  assert.deepEqual(
    olderRefusals,
    older.map(() => 'Configured archive and intent versions disagree.'),
  )
  assert.equal(refusalOf(own), 'accepted')
  assert.equal(
    refusalOf(withoutHold),
    'Configured archive and intent versions disagree.',
  )
  assert.equal(
    isReadableStudyFormatOfConfiguration(24, own.configuration),
    true,
  )
  assert.equal(
    isReadableStudyFormatOfConfiguration(8, own.configuration),
    false,
  )
})

// Value: protects=a format 24 study is stored in .study.v24.json beside its metadata, this Codebook reads 24 and refuses 25 as newer, and Codebook 0.2.107 (readable up to 23) lists a .study.v24.json archive as saved by a newer Codebook; fails_when=the storage table lacks v24, the readable limit stays 23, or the file name rule stops recognising v24; no_claim=disk errors
test('format 24 is stored and readable, 25 is saved by a newer Codebook and a reader limited to 23 lists v24 as newer', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 23 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const row = STUDY_STORAGE_FORMATS.find((entry) => entry.version === 24)
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v24.json')
  // Assert
  assert.equal(HOLD_STUDY_VERSION, 24)
  assert.deepEqual(row, {
    version: 24,
    format: 'v24',
    archiveSuffix: '.study.v24.json',
    metadataSuffix: '.study.meta.v24.json',
  })
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 24 })
  assert.equal(READABLE_STUDY_VERSION, 24)
  assert.equal(isOperationsStudyFormat(24), true)
  assert.equal(isOperationsStudyFormat(25), false)
  assert.doesNotThrow(() => assertReadableStudyFormat({ version: 24 }))
  assert.throws(
    () => assertReadableStudyFormat({ version: 25 }),
    /saved in format 25 by a newer Codebook; this Codebook reads formats up to 24/,
  )
})

// Value: protects=the saved study, not the live run, names and shows its stops after a window reload: the reopened study is format 24 with the hold on the declared stop, keeps its three observations in order, and its replay context validates; fails_when=the reopened study drops the hold, a stop, or the replay context is refused; no_claim=the replay UI (native check)
test('a format 24 study reopened after a window reload keeps its hold and its stops in order', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-24-'))
  context.after(() => removeTestFolder(directory))
  const study = holdStudy(24, 'additional', 'record')
  await new LearningLibrary(directory, study.workspaceKey).saveStudy(study)
  // Act
  // A new library object on the stored files is what a window reload does.
  const library = new LearningLibrary(directory, study.workspaceKey)
  const reopened = await library.readStudy(study.id)
  const recording = validateRecordingContext(
    buildRecordingContext(reopened, [], 1),
    study.workspaceKey,
  )
  const files = (await readdir(directory)).sort()
  const listed = (await library.list()).map((entry) => entry.format)
  // Assert
  assert.equal(reopened.version, 24)
  assert.equal(
    reopened.configuration.version === 3 &&
      reopened.configuration.additionalStops?.[0]?.hold,
    'record',
  )
  assert.deepEqual(
    reopened.observations.map((observation) => observation.participant),
    ['browser', 'server', 'browser'],
  )
  assert.equal(recording.study.observations.length, 3)
  assert.deepEqual(files, [
    `${study.id}.study.meta.v24.json`,
    `${study.id}.study.v24.json`,
  ])
  assert.deepEqual(listed, ['v24'])
})
