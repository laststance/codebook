import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  READABLE_STUDY_VERSION,
  REACT_SCRIPTS_LIBRARY_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import type { LibraryRunFacts } from '../libraryRunFactsSchema'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertReadableStudyFormat } from '../utils/assertReadableStudyFormat'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import type * as NewerStudyArchiveModule from '../utils/newerStudyArchive'
import {
  evidenceFormatOfStudy,
  isOperationsStudyFormat,
  studyFormatOfConfiguration,
} from '../utils/studyFormatOfConfiguration'

import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

const BROWSER_ONLY_V7_PATH = join(
  resolve(__dirname, '../../src/tests/fixtures'),
  'operations-study-v0.2.72.0/browser-only-v3.study.v7.json',
)

/** The facts of a library that was built, packed and completely observed. */
const COMPLETE_FACTS: LibraryRunFacts = {
  package: '@acme/widgets',
  packageRoot: 'packages/widgets',
  prepared: true,
  version: '2.14.0',
  revision: '7114787aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  dirty: false,
  packageManager: { name: 'pnpm', version: '11.23.0' },
  buildMs: 7000,
  packMs: 900,
  tarballSha256: 'b'.repeat(64),
  installedVersion: '2.12.0',
  observation: 'complete',
  loaded: true,
  loadCount: 12,
  publishedCopyLoaded: false,
  cleanup: 'removed',
}

/**
 * Reseals the 0.2.72.0 browser-only study as a nested `react-scripts-dev` study that declares `library`, of the given format and with the given library facts.
 * @param library - The library facts; `undefined` leaves the field out.
 * @param version - The format number to give the study; defaults to 17.
 * @returns The resealed study, its configuration hash recomputed.
 * @example await libraryStudy(COMPLETE_FACTS) // => { version: 17, library: { package: '@acme/widgets', … }, … }
 */
async function libraryStudy(
  library: unknown,
  version: number = REACT_SCRIPTS_LIBRARY_STUDY_VERSION,
): Promise<ConfiguredStudy> {
  const study: ConfiguredStudy = JSON.parse(
    await readFile(BROWSER_ONLY_V7_PATH, 'utf8'),
  )
  const configuration = {
    ...study.configuration,
    adapter: 'react-scripts-dev',
    packageRoot: 'examples/counter',
    library: { packageRoot: 'packages/widgets' },
  }
  return {
    ...study,
    version,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    ...(library === undefined ? {} : { library }),
  } as ConfiguredStudy
}

/** Whether the reader accepts the study. */
function decodes(study: ConfiguredStudy): boolean {
  try {
    decodeConfiguredStudy(study, study.workspaceKey)
    return true
  } catch {
    return false
  }
}

// protects=Codebook 0.2.98 (readable up to 16) lists a .study.v17.json file as saved by a newer Codebook and keeps its sidecar out of the listing; fails_when=the file name rule stops recognising v17; no_claim=the 0.2.98 binary
test('Codebook 0.2.98 lists a .study.v17.json archive as saved by a newer Codebook', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 16 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v17.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v17.json')
  // Assert
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 17 })
  assert.equal(sidecar, undefined)
})

// protects=this Codebook reads format 17, stores it as .study.v17.json and still reads it; fails_when=the row is missing or changes its suffixes, or the readable limit drops below 17; no_claim=a run's round trip
test('format 17 is a stored and readable format', () => {
  // Arrange / Act
  const row = STUDY_STORAGE_FORMATS.find((format) => format.version === 17)
  // Assert
  assert.deepEqual(row, {
    version: 17,
    format: 'v17',
    archiveSuffix: '.study.v17.json',
    metadataSuffix: '.study.meta.v17.json',
  })
  assert.equal(READABLE_STUDY_VERSION, 21)
  assert.equal(isOperationsStudyFormat(17), true)
  assert.doesNotThrow(() => assertReadableStudyFormat({ version: 17 }))
})

// protects=a react-scripts-dev run that declares library takes format 17, one without keeps 11 and an explicit undefined library declares nothing; fails_when=a library run falls back to 11, or an undefined library moves to 17; no_claim=a live run
test('studyFormatOfConfiguration gives 17 for react-scripts-dev with library and 11 without it', async () => {
  // Arrange
  const withLibrary = (await libraryStudy(COMPLETE_FACTS)).configuration
  const { library: _dropped, ...withoutLibrary } =
    withLibrary as typeof withLibrary & { library: unknown }
  const undeclared = {
    ...withoutLibrary,
    library: undefined,
  } as typeof withLibrary
  const viteWithLibrary = {
    ...withLibrary,
    adapter: 'vite-dev',
  } as typeof withLibrary
  // Act
  const formats = [
    studyFormatOfConfiguration(withLibrary),
    studyFormatOfConfiguration(withoutLibrary),
    studyFormatOfConfiguration(undeclared),
    studyFormatOfConfiguration(viteWithLibrary),
  ]
  // Assert
  assert.deepEqual(formats, [17, 11, 11, 16])
})

// protects=a browser-only format 17 study follows the format 7 evidence rules; fails_when=evidenceFormatOfStudy returns 17 or 8; no_claim=a server-stop configuration
test('a browser-only format 17 study follows the format 7 evidence rules', async () => {
  // Arrange
  const study = await libraryStudy(COMPLETE_FACTS)
  // Act
  const evidenceFormat = evidenceFormatOfStudy(study)
  // Assert
  assert.equal(evidenceFormat, 7)
})

// protects=a study saved through the real LearningLibrary reopens with its library facts, including reachedThrough, and is listed as v17 in .study.v17.json; fails_when=facts are dropped, the file name differs or the catalog lists another format; no_claim=a live run writes them
for (const [name, facts] of [
  ['complete', COMPLETE_FACTS],
  [
    'complete transitive',
    {
      ...COMPLETE_FACTS,
      reachedThrough: ['@acme/a', '@acme/b'],
      reachedThroughCount: 5,
    },
  ],
] as const)
  test(`a format 17 study with a ${name} observation reopens with its library facts and is listed as v17`, async (context) => {
    // Arrange
    const directory = await mkdtemp(join(tmpdir(), 'codebook-format-17-'))
    context.after(() => removeTestFolder(directory))
    const study = await libraryStudy(JSON.parse(JSON.stringify(facts)))
    const library = new LearningLibrary(directory, study.workspaceKey)
    // Act
    await library.saveStudy(study)
    const reopened = await library.readStudy(study.id)
    const files = (await readdir(directory)).sort()
    const listed = (await library.list()).map((entry) => entry.format)
    // Assert
    assert.equal(reopened.version, 17)
    assert.deepEqual(reopened.library, JSON.parse(JSON.stringify(facts)))
    assert.deepEqual(files, [
      `${study.id}.study.meta.v17.json`,
      `${study.id}.study.v17.json`,
    ])
    assert.deepEqual(listed, ['v17'])
  })

// protects=a format 17 study whose library facts break the state rules or the reachedThrough rules, or whose format and facts disagree, is unreadable; fails_when=any of these decodes; no_claim=the wording of the refusals
test('refuses a format 17 study whose library facts break the state or reachedThrough rules', async () => {
  // Arrange
  const names17 = Array.from(
    { length: 17 },
    (_, index) => `p${String(index).padStart(2, '0')}`,
  )
  const attempts = await Promise.all([
    libraryStudy({ ...COMPLETE_FACTS, version: undefined }),
    libraryStudy({ ...COMPLETE_FACTS, loaded: undefined }),
    libraryStudy(undefined),
    // Facts on a format 11 study.
    libraryStudy(COMPLETE_FACTS, 11),
    libraryStudy({ ...COMPLETE_FACTS, packageRoot: 'packages/other' }),
    // Unsorted names.
    libraryStudy({
      ...COMPLETE_FACTS,
      reachedThrough: ['b', 'a'],
      reachedThroughCount: 2,
    }),
    // Duplicate names.
    libraryStudy({
      ...COMPLETE_FACTS,
      reachedThrough: ['a', 'a'],
      reachedThroughCount: 2,
    }),
    // More than 16 names.
    libraryStudy({
      ...COMPLETE_FACTS,
      reachedThrough: names17,
      reachedThroughCount: 17,
    }),
    // A count smaller than the list.
    libraryStudy({
      ...COMPLETE_FACTS,
      reachedThrough: ['a', 'b'],
      reachedThroughCount: 1,
    }),
    // One of the pair missing.
    libraryStudy({ ...COMPLETE_FACTS, reachedThrough: ['a'] }),
    libraryStudy({ ...COMPLETE_FACTS, reachedThroughCount: 3 }),
  ])
  const accepted = await libraryStudy({
    ...COMPLETE_FACTS,
    reachedThrough: names17.slice(0, 16),
    reachedThroughCount: 17,
  })
  // Act
  const results = attempts.map(decodes)
  // Assert
  assert.deepEqual(
    results,
    Array.from({ length: 11 }, () => false),
  )
  assert.equal(decodes(accepted), true)
})

// protects=a format 11 study (react-scripts-dev without library) cannot hold a library declaration; fails_when=the format 11 variant accepts library, which an older Codebook would then misread; no_claim=none beyond protects
test('a format 11 study whose configuration declares library is unreadable', async () => {
  // Arrange
  const study = await libraryStudy(undefined, 11)
  // Act
  const result = decodes(study)
  // Assert
  assert.equal(result, false)
})
