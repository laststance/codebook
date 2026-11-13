import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  ENTRY_BROWSER_STUDY_VERSION,
  READABLE_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { operationsRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertObservationFormatFields } from '../utils/assertObservationFormatFields'
import { assertReadableStudyFormat } from '../utils/assertReadableStudyFormat'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { configuredStops } from '../utils/configuredStops'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import {
  isReadableStudyFormatOfConfiguration,
  studyFormatOfConfiguration,
} from '../utils/studyFormatOfConfiguration'
import { validateRecordingContext } from '../utils/validateRecordingContext'

import { createOperationsStudy } from './utils/createOperationsStudy'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

type Configuration = ConfiguredStudy['configuration']

/**
 * Reseals the format 8 operations study with its first stop, the browser stop, declared at the entry load, and gives it a format number.
 * @param version - The format number to write.
 * @param observation - The fields the browser observation gets; by default the ones a run writes at the entry load.
 * @returns The study with its configuration hash recomputed and its first observation labelled as an entry-load browser pause.
 * @example entryBrowserStudy(25) // => { version: 25, … }
 */
function entryBrowserStudy(
  version: number,
  observation: Record<string, unknown> = {
    execution: 'browser',
    attribution: 'entry-load',
  },
): ConfiguredStudy {
  const study = createOperationsStudy()
  const base = study.configuration
  if (base.version !== 3) throw new Error('expected a version 3 study')
  // Parsed so that the keys sit in the schema's order, as the start seals them.
  const configuration: Configuration = operationsRepositoryConfigSchema.parse({
    ...base,
    afterOperation: 0,
  })
  const [browser, ...later] = study.observations
  const { attribution: _attribution, ...plain } = browser!
  return {
    ...study,
    version,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    // The entry-load pause happens before the first operation was sent.
    observations: [{ ...plain, elapsedMs: 1, ...observation }, ...later],
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

// Value: protects=a browser pause at the entry load is saved as execution browser with attribution entry-load and no operation index or scope, and nothing else is accepted at that stop; fails_when=the validator refuses an entry-load browser observation, accepts one without the attribution, or accepts an operation index, a module scope or another attribution beside it; no_claim=the writer (entryBrowserStop.test.ts) or the format number
test('the validator accepts an entry-load browser observation and refuses every other shape at a browser stop of the entry load', () => {
  // Arrange
  const attempts = [
    { execution: 'browser', attribution: 'entry-load' },
    { execution: 'browser' },
    { execution: 'browser', attribution: 'entry-load', operationIndex: 1 },
    { execution: 'browser', attribution: 'entry-load', scope: 'module' },
    { execution: 'browser', attribution: 'after-operation' },
  ]
  // Act
  const messages = attempts.map((observation) => {
    const study = entryBrowserStudy(25, observation)
    try {
      assertObservationFormatFields(study, configuredStops(study.configuration))
      return 'accepted'
    } catch (error) {
      return (error as Error).message
    }
  })
  // Assert
  const refusal =
    'An entry-load browser observation is attributed entry-load and has no operationIndex or scope.'
  assert.deepEqual(messages, ['accepted', refusal, refusal, refusal, refusal])
})

// Value: protects=a configuration with a browser stop at the entry load is saved as format 25 and readable as format 25 only, an older format refuses it, and the same configuration at format 8 is not accepted; fails_when=the stop leaves the study at format 8 so Codebook 0.2.128 and older fail on the schema instead of listing it as saved by a newer Codebook, or an older format decodes it; no_claim=a live run
test('a configuration with a browser stop at the entry load is saved as format 25 and no older format holds it', () => {
  // Arrange
  const study = entryBrowserStudy(25)
  const olderFormats = [7, 8, 9, 10, 21, 22, 23, 24]
  // Act
  const format = studyFormatOfConfiguration(study.configuration)
  const olderRefusals = olderFormats.map((version) =>
    refusalOf({ ...study, version } as ConfiguredStudy),
  )
  // Assert
  assert.equal(ENTRY_BROWSER_STUDY_VERSION, 25)
  assert.equal(format, 25)
  assert.equal(refusalOf(study), 'accepted')
  assert.deepEqual(
    olderRefusals,
    olderFormats.map(() => 'Configured archive and intent versions disagree.'),
  )
  assert.equal(
    isReadableStudyFormatOfConfiguration(25, study.configuration),
    true,
  )
})

// Value: protects=this Codebook reads format 25 stored in .study.v25.json, and a Codebook that reads up to 24 (simulated by its readable version; no older build is run) lists that file as saved by a newer Codebook and keeps it; fails_when=the storage table lacks v25, the readable limit stays 24, or the file name rule stops recognising v25; no_claim=the 0.2.128 binary
test('format 25 is stored and readable, 26 is saved by a newer Codebook and a reader limited to 24 lists v25 as newer', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 24 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const row = STUDY_STORAGE_FORMATS.find((entry) => entry.version === 25)
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v25.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v25.json')
  // Assert
  assert.deepEqual(row, {
    version: 25,
    format: 'v25',
    archiveSuffix: '.study.v25.json',
    metadataSuffix: '.study.meta.v25.json',
  })
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 25 })
  assert.equal(sidecar, undefined)
  assert.equal(READABLE_STUDY_VERSION, 25)
  assert.doesNotThrow(() => assertReadableStudyFormat({ version: 25 }))
  assert.throws(
    () => assertReadableStudyFormat({ version: 26 }),
    /saved in format 26 by a newer Codebook; this Codebook reads formats up to 25/,
  )
})

// Value: protects=the saved study, not the live run, names and shows its stop after a window reload: the reopened study is format 25 with the browser stop declared afterOperation 0, keeps its three observations in order with the entry-load label on the first, its replay context validates and it is listed as v25; fails_when=the reopened study drops the label or a stop, the replay context is refused, or the file is stored under another format; no_claim=the replay UI (native check)
test('a format 25 study reopened after a window reload names and shows its entry-load browser stop', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-25-'))
  context.after(() => removeTestFolder(directory))
  const study = entryBrowserStudy(25)
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
  assert.equal(reopened.version, 25)
  assert.deepEqual(
    reopened.observations.map((observation) => [
      observation.participant,
      observation.execution,
      observation.attribution,
      observation.operationIndex,
    ]),
    [
      ['browser', 'browser', 'entry-load', undefined],
      ['server', 'server-action', undefined, undefined],
      ['browser', 'browser', undefined, undefined],
    ],
  )
  // The declared stop the label belongs to is the browser stop at the entry load.
  assert.deepEqual(
    reopened.configuration.version === 3 && [
      reopened.configuration.participant,
      reopened.configuration.afterOperation,
    ],
    ['browser', 0],
  )
  assert.equal(recording.study.observations.length, 3)
  assert.deepEqual(files, [
    `${study.id}.study.meta.v25.json`,
    `${study.id}.study.v25.json`,
  ])
  assert.deepEqual(listed, ['v25'])
})
