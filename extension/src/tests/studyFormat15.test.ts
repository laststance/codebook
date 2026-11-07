import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  configuredStudySchema,
  type ConfiguredStudy,
} from '../configuredStudySchemas'
import {
  EXPO_WEB_STUDY_VERSION,
  READABLE_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertReadableStudyFormat } from '../utils/assertReadableStudyFormat'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import type * as NewerStudyFormatMessageModule from '../utils/newerStudyFormatMessage'
import {
  evidenceFormatOfStudy,
  isOperationsStudyFormat,
  isReadableStudyFormatOfConfiguration,
  studyFormatOfConfiguration,
} from '../utils/studyFormatOfConfiguration'

import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

const BROWSER_ONLY_V7_PATH = join(
  resolve(__dirname, '../../src/tests/fixtures'),
  'operations-study-v0.2.72.0/browser-only-v3.study.v7.json',
)

/**
 * Reseals the 0.2.72.0 browser-only study as a study of format 15 with the given Expo version.
 *
 * Why it exists: the format 15 rules (schema field, evidence rules) are tested here with the browser-only fixture; the adapter value `expo-web-dev` of the retained configuration belongs to the adapter's own tests.
 * @param expoVersion - The `expoVersion` value; `undefined` leaves the field out.
 * @returns The study with `version: 15` and the configuration hash recomputed.
 * @example await expoStudy('57.0.25') // => { version: 15, expoVersion: '57.0.25', … }
 */
async function expoStudy(expoVersion: string | undefined): Promise<unknown> {
  const study: ConfiguredStudy = JSON.parse(
    await readFile(BROWSER_ONLY_V7_PATH, 'utf8'),
  )
  return {
    ...study,
    version: EXPO_WEB_STUDY_VERSION,
    configurationHash: sha256(JSON.stringify(study.configuration)),
    ...(expoVersion === undefined ? {} : { expoVersion }),
  }
}

// Value: protects=DX-16 Codebook 0.2.88 (readable up to 14) lists a .study.v15.json file as saved by a newer Codebook and keeps its sidecar out of the listing, never as unreadable; fails_when=the file name rule stops recognising v15; why_new=Expo runs save a new format number so the listing never parses them; seam=none; no_claim=the 0.2.88 binary
test('Codebook 0.2.88 lists a .study.v15.json archive as saved by a newer Codebook', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 14 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  const message = await loadModule<typeof NewerStudyFormatMessageModule>(
    resolve(__dirname, '../utils/newerStudyFormatMessage.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v15.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v15.json')
  // Assert
  assert.equal(EXPO_WEB_STUDY_VERSION, 15)
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 15 })
  assert.equal(sidecar, undefined)
  assert.equal(
    message.newerStudyFormatMessage(15),
    'This study was saved in format 15 by a newer Codebook; this Codebook reads formats up to 14. Update the extension to open it. The study is kept as it is.',
  )
})

// Value: protects=DX-8 this Codebook reads format 15, stores it as .study.v15.json beside its metadata and refuses format 16 as a newer Codebook's; fails_when=the storage table lacks v15, the readable limit stays 14, or 16 is read; why_new=a new format number; seam=none; no_claim=the library round trip of an Expo run
test('format 15 is a stored and readable format and format 16 is refused as saved by a newer Codebook', () => {
  // Arrange
  const sixteen = { version: 16 }
  // Act
  const row = STUDY_STORAGE_FORMATS.find((entry) => entry.version === 15)
  // Assert
  assert.deepEqual(row, {
    version: 15,
    format: 'v15',
    archiveSuffix: '.study.v15.json',
    metadataSuffix: '.study.meta.v15.json',
  })
  assert.equal(READABLE_STUDY_VERSION, 15)
  assert.equal(isOperationsStudyFormat(15), true)
  assert.doesNotThrow(() => assertReadableStudyFormat({ version: 15 }))
  assert.throws(
    () => assertReadableStudyFormat(sixteen),
    /saved in format 16 by a newer Codebook; this Codebook reads formats up to 15/,
  )
})

// Value: protects=E-8 a format 15 study with expoVersion reads back with that version and a longer value than 64 characters or an empty one is refused; fails_when=the schema drops expoVersion, accepts a 65-character version or rejects format 15; why_new=expoVersion is new; seam=none; no_claim=that an Expo run writes the field, which the run's own tests prove
test('a format 15 study with expoVersion reads back with it and refuses one longer than 64 characters', async () => {
  // Arrange
  const withVersion = await expoStudy('57.0.25')
  const tooLong = await expoStudy('5'.repeat(65))
  const empty = await expoStudy('')
  const without = await expoStudy(undefined)
  // Act
  const parsed = configuredStudySchema.parse(withVersion)
  const parsedWithout = configuredStudySchema.parse(without)
  // Assert
  assert.equal(parsed.version, 15)
  assert.equal(parsed.expoVersion, '57.0.25')
  assert.equal(parsedWithout.expoVersion, undefined)
  assert.equal(configuredStudySchema.safeParse(tooLong).success, false)
  assert.equal(configuredStudySchema.safeParse(empty).success, false)
})

// Value: protects=format 15 follows the format 7 evidence rules for a browser-only configuration like formats 10 and 11; fails_when=evidenceFormatOfStudy returns 15 or 8 for a browser-only format 15 study, which would let execution fields in or refuse its observations; why_new=format 15 joins the derived-evidence list; seam=none; no_claim=a server-stop configuration, which an Expo run refuses
test('a browser-only format 15 study follows the format 7 evidence rules', async () => {
  // Arrange
  const study = configuredStudySchema.parse(await expoStudy('57.0.25'))
  // Act
  const evidenceFormat = evidenceFormatOfStudy(study)
  // Assert
  assert.equal(evidenceFormat, 7)
})

/**
 * Reseals the 0.2.72.0 browser-only study as a study of another adapter and format (the configuration hash covers the new configuration).
 * @param adapter - The adapter the configuration names.
 * @param version - The format number to give the study.
 * @param packageRoot - The `packageRoot` value; `undefined` leaves the field out.
 * @param expoVersion - The `expoVersion` value; `undefined` leaves the field out.
 * @returns The resealed study.
 * @example await resealedStudy('expo-web-dev', 15, 'apps/app', '57.0.25') // version 15
 */
async function resealedStudy(
  adapter:
    'expo-web-dev' | 'react-scripts-dev' | 'vite-dev' | 'next-dev-webpack',
  version: number,
  packageRoot: string | undefined,
  expoVersion?: string,
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
    ...(expoVersion === undefined ? {} : { expoVersion }),
  } as ConfiguredStudy
}

// Value: protects=E-8: every expo-web-dev configuration takes format 15, root (absent or ".") or nested, while a react-scripts run keeps 11 and a Vite root run 7; fails_when=an Expo run falls back to 7, 9 or 11, which an older Codebook would read as unreadable instead of newer; why_new=Cycle 0089 maps the adapter; seam=the 0.2.72.0 golden resealed; no_claim=a live run
test('studyFormatOfConfiguration gives 15 for an expo-web-dev run at the root and below it', async () => {
  // Arrange
  const configurations = await Promise.all(
    [
      ['expo-web-dev', undefined],
      ['expo-web-dev', '.'],
      ['expo-web-dev', 'apps/app'],
      ['react-scripts-dev', 'apps/app'],
      ['vite-dev', undefined],
    ].map(
      async ([adapter, packageRoot]) =>
        (
          await resealedStudy(
            adapter as 'expo-web-dev' | 'react-scripts-dev' | 'vite-dev',
            7,
            packageRoot,
          )
        ).configuration,
    ),
  )
  // Act
  const formats = configurations.map(studyFormatOfConfiguration)
  // Assert
  assert.deepEqual(formats, [15, 15, 15, 11, 7])
})

// Value: protects=AC 5: an Expo study saved through the real LearningLibrary reopens with its expoVersion and is listed as format v15 stored in .study.v15.json beside its metadata; fails_when=the version is dropped, the file name differs, or the catalog lists another format; why_new=Cycle 0089 saves expoVersion; seam=the 0.2.72.0 golden resealed, a real LearningLibrary on a temporary folder; no_claim=a live run
test('an expo-web-dev study saved in the library reopens with its expoVersion and is listed as v15', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-15-'))
  context.after(() => removeTestFolder(directory))
  const study = await resealedStudy('expo-web-dev', 15, 'apps/app', '57.0.25')
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const files = (await readdir(directory)).sort()
  const listed = (await library.list()).map((entry) => entry.format)
  // Assert
  assert.equal(reopened.version, 15)
  assert.equal(reopened.expoVersion, '57.0.25')
  assert.deepEqual(files, [
    `${study.id}.study.meta.v15.json`,
    `${study.id}.study.v15.json`,
  ])
  assert.deepEqual(listed, ['v15'])
})

// Value: protects=DX-16: an expo-web-dev configuration is readable only as format 15, so formats 7, 9, 10 and 11 refuse it and the format 7 fallback cannot accept it; fails_when=any other format decodes an Expo study; why_new=an older Codebook would otherwise misread the adapter; seam=the 0.2.72.0 golden resealed; no_claim=the wording of the refusal
test('formats 7, 9, 10 and 11 refuse an expo-web-dev study and format 15 refuses the other adapters', async () => {
  // Arrange
  const expoAttempts = await Promise.all(
    [7, 9, 10, 11].map((version) =>
      resealedStudy('expo-web-dev', version, 'apps/app'),
    ),
  )
  const otherAttempts = await Promise.all([
    resealedStudy('vite-dev', 15, 'apps/app'),
    resealedStudy('react-scripts-dev', 15, undefined),
    resealedStudy('next-dev-webpack', 15, undefined),
  ])
  // Act
  const decodes = (study: ConfiguredStudy): boolean => {
    try {
      decodeConfiguredStudy(study, study.workspaceKey)
      return true
    } catch {
      return false
    }
  }
  const readableAsSeven = isReadableStudyFormatOfConfiguration(
    7,
    expoAttempts[0]!.configuration,
  )
  // Assert
  assert.equal(readableAsSeven, false)
  assert.deepEqual(expoAttempts.map(decodes), [false, false, false, false])
  assert.deepEqual(otherAttempts.map(decodes), [false, false, false])
})
