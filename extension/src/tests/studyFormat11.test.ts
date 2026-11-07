import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  REACT_SCRIPTS_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import type * as NewerStudyFormatMessageModule from '../utils/newerStudyFormatMessage'
import {
  evidenceFormatOfStudy,
  isReadableStudyFormatOfConfiguration,
  studyFormatOfConfiguration,
} from '../utils/studyFormatOfConfiguration'

import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

const BROWSER_ONLY_V7_PATH = join(
  resolve(__dirname, '../../src/tests/fixtures'),
  'operations-study-v0.2.72.0/browser-only-v3.study.v7.json',
)
const NESTED_FOLDER = 'examples/counter'

/**
 * Reseals the 0.2.72.0 browser-only study as a study of another adapter, format and package folder (the configuration hash covers the new configuration).
 * @param adapter - The adapter the configuration names.
 * @param version - The format number to give the study.
 * @param packageRoot - The `packageRoot` value; `undefined` leaves the field out.
 * @returns The resealed study.
 * @example await resealedBrowserStudy('react-scripts-dev', 11, 'examples/counter') // version 11
 */
async function resealedBrowserStudy(
  adapter: 'react-scripts-dev' | 'vite-dev' | 'next-dev-webpack',
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

// Value: protects=every react-scripts-dev configuration takes format 11, root (absent or ".") or nested, while a Vite root run keeps 7; fails_when=a root react-scripts run falls back to format 7 or a nested one takes 9 or 10, which an older Codebook would read as unreadable instead of newer; why_new=D5 and DX-10; seam=the 0.2.72.0 golden resealed; no_claim=a live run (the study writer test pins the saved file)
test('studyFormatOfConfiguration gives 11 for a react-scripts-dev run at the root and below it', async () => {
  // Arrange
  const configurations = await Promise.all(
    [
      ['react-scripts-dev', undefined],
      ['react-scripts-dev', '.'],
      ['react-scripts-dev', NESTED_FOLDER],
      ['vite-dev', undefined],
    ].map(
      async ([adapter, packageRoot]) =>
        (
          await resealedBrowserStudy(
            adapter as 'react-scripts-dev' | 'vite-dev',
            7,
            packageRoot,
          )
        ).configuration,
    ),
  )
  // Act
  const formats = configurations.map(studyFormatOfConfiguration)
  // Assert
  assert.deepEqual(formats, [11, 11, 11, 7])
})

// Value: protects=a format 11 study decodes for a react-scripts-dev configuration with packageRoot absent, "." and nested, follows the format 7 evidence rules, and reopens from .study.v11.json; fails_when=the storage table lacks v11, the schema refuses one of the three spellings, or the evidence rules differ from the browser-only format 7; why_new=Cycle 0083 adds format 11; seam=the 0.2.72.0 golden resealed, a real LearningLibrary on a temporary folder; no_claim=a live run
test('a format 11 study of a react-scripts-dev app decodes with the package folder absent, "." or nested and is saved as .study.v11.json', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-11-'))
  context.after(() => removeTestFolder(directory))
  const studies = await Promise.all(
    [undefined, '.', NESTED_FOLDER].map((packageRoot) =>
      resealedBrowserStudy('react-scripts-dev', 11, packageRoot),
    ),
  )
  const nested = studies[2]!
  const library = new LearningLibrary(directory, nested.workspaceKey)
  // Act
  const decodedVersions = studies.map(
    (study) => decodeConfiguredStudy(study, study.workspaceKey).version,
  )
  await library.saveStudy(nested)
  const reopened = await library.readStudy(nested.id)
  const files = (await readdir(directory)).sort()
  // Assert
  assert.deepEqual(decodedVersions, [11, 11, 11])
  assert.deepEqual(files, [
    `${nested.id}.study.meta.v11.json`,
    `${nested.id}.study.v11.json`,
  ])
  assert.equal(reopened.version, 11)
  assert.equal(evidenceFormatOfStudy(reopened), 7)
  assert.deepEqual(
    STUDY_STORAGE_FORMATS.find((row) => row.version === 11),
    {
      version: 11,
      format: 'v11',
      archiveSuffix: '.study.v11.json',
      metadataSuffix: '.study.meta.v11.json',
    },
  )
})

// Value: protects=DX-10: a react-scripts-dev configuration is readable only as format 11, so formats 7, 9 and 10 refuse it with packageRoot absent, "." and nested, and the format 7 fallback cannot accept it; fails_when=any other format decodes a react-scripts-dev study, or isReadableStudyFormatOfConfiguration accepts format 7; why_new=an older Codebook would otherwise misread the adapter; seam=the 0.2.72.0 golden resealed; no_claim=the wording of the refusal
test('formats 7, 9 and 10 refuse a react-scripts-dev study whatever its package folder', async () => {
  // Arrange
  const refusedMessage = 'Configured archive and intent versions disagree.'
  const attempts = await Promise.all(
    [7, 9, 10].flatMap((version) =>
      [undefined, '.', NESTED_FOLDER].map((packageRoot) =>
        resealedBrowserStudy('react-scripts-dev', version, packageRoot),
      ),
    ),
  )
  // Act
  const outcomes = attempts.map((study) => {
    try {
      decodeConfiguredStudy(study, study.workspaceKey)
      return 'decoded'
    } catch (error) {
      return error instanceof Error ? error.message : 'unknown'
    }
  })
  const readableAsSeven = isReadableStudyFormatOfConfiguration(
    7,
    attempts[0]!.configuration,
  )
  // Assert
  assert.equal(readableAsSeven, false)
  for (const outcome of outcomes) assert.notEqual(outcome, 'decoded')
  assert.equal(
    outcomes.filter((outcome) => outcome === refusedMessage).length > 0,
    true,
  )
})

// Value: protects=format 11 does not take the configurations of the other adapters: a Vite or Next study sealed as 11 is refused; fails_when=format 11 accepts a non-react-scripts configuration; why_new=the pairing keeps the formats exclusive; seam=the 0.2.72.0 golden resealed; no_claim=the wording of the refusal
test('a format 11 study with a Vite or Next configuration is refused', async () => {
  // Arrange
  const studies = await Promise.all([
    resealedBrowserStudy('vite-dev', 11, NESTED_FOLDER),
    resealedBrowserStudy('next-dev-webpack', 11, undefined),
  ])
  // Act
  const decodeOf = (study: ConfiguredStudy) => (): unknown =>
    decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  for (const study of studies)
    assert.throws(decodeOf(study), {
      message: 'Configured archive and intent versions disagree.',
    })
})

// Value: protects=Codebook 0.2.82 (readable up to 10) lists a .study.v11.json file as saved by a newer Codebook and keeps its sidecar out of the listing; fails_when=the file name rule stops recognising v11 or takes the sidecar for an archive; why_new=D5 forward listing; seam=the 0.2.82 rule is replayed over the constant 10; no_claim=the 0.2.82 binary
test('the previous release lists a .study.v11.json archive as saved by a newer Codebook', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 10 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  const message = await loadModule<typeof NewerStudyFormatMessageModule>(
    resolve(__dirname, '../utils/newerStudyFormatMessage.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v11.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v11.json')
  // Assert
  assert.equal(REACT_SCRIPTS_STUDY_VERSION, 11)
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 11 })
  assert.equal(sidecar, undefined)
  assert.equal(
    message.newerStudyFormatMessage(11),
    'This study was saved in format 11 by a newer Codebook; this Codebook reads formats up to 10. Update the extension to open it. The study is kept as it is.',
  )
})
