import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertReadableStudyFormat } from '../utils/assertReadableStudyFormat'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import type * as NewerStudyFormatMessageModule from '../utils/newerStudyFormatMessage'
import {
  evidenceFormatOfStudy,
  isOperationsStudyFormat,
} from '../utils/studyFormatOfConfiguration'

import { loadModule } from './utils/loadModule'

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
