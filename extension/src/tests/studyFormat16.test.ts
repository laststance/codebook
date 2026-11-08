import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import { STUDY_STORAGE_FORMATS, VITE_LIBRARY_STUDY_VERSION } from '../constants'
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

/** The facts of a library that was built, packed and completely observed: the packed copy was served alone. */
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
 * Reseals the 0.2.72.0 browser-only study as a nested `vite-dev` study that declares `library`, of the given format and with the given library facts.
 *
 * Why it exists: the format 16 rules (schema field, format mapping, state rules) are tested with the browser-only golden; the run that writes the facts belongs to the run's own tests.
 * @param library - The library facts; `undefined` leaves the field out.
 * @param version - The format number to give the study; defaults to 16.
 * @returns The resealed study, its configuration hash recomputed.
 * @example await libraryStudy(COMPLETE_FACTS) // => { version: 16, library: { package: '@acme/widgets', … }, … }
 */
async function libraryStudy(
  library: unknown,
  version: number = VITE_LIBRARY_STUDY_VERSION,
): Promise<ConfiguredStudy> {
  const study: ConfiguredStudy = JSON.parse(
    await readFile(BROWSER_ONLY_V7_PATH, 'utf8'),
  )
  const configuration = {
    ...study.configuration,
    adapter: 'vite-dev',
    packageRoot: 'examples/widgets-vite',
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

// protects=Codebook 0.2.97 (readable up to 15) lists a .study.v16.json file as saved by a newer Codebook and keeps its sidecar out of the listing, never as unreadable; fails_when=the file name rule stops recognising v16; no_claim=the 0.2.97 binary
test('Codebook 0.2.97 lists a .study.v16.json archive as saved by a newer Codebook', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 15 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v16.json')
  const sidecar = newerStudyArchive.newerStudyArchive('a_b.study.meta.v16.json')
  // Assert
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 16 })
  assert.equal(sidecar, undefined)
})

// protects=the fourth storage format row is format 16 with the v16 archive and metadata suffixes, and format 16 is an operations format that passes the readable check; fails_when=that row is missing, moves from index 3 or changes its suffixes, or format 16 stops being an operations or readable format; no_claim=the order against format 17 or the library round trip of a run
test('storage format row 3 is format 16 with its v16 suffixes and format 16 is readable', () => {
  // Arrange / Act
  const row = STUDY_STORAGE_FORMATS[4]
  // Assert
  assert.deepEqual(row, {
    version: 16,
    format: 'v16',
    archiveSuffix: '.study.v16.json',
    metadataSuffix: '.study.meta.v16.json',
  })
  assert.equal(isOperationsStudyFormat(16), true)
  assert.doesNotThrow(() => assertReadableStudyFormat({ version: 16 }))
})

// protects=a nested vite-dev run that declares library takes format 16 while the same run without library keeps format 10; fails_when=a library run falls back to 10, which an older Codebook would read as unreadable instead of newer, or a run without library moves to 16; no_claim=a live run
test('studyFormatOfConfiguration gives 16 for a nested vite-dev run with library and 10 without it', async () => {
  // Arrange
  const withLibrary = (await libraryStudy(COMPLETE_FACTS)).configuration
  const { library: _dropped, ...withoutLibrary } =
    withLibrary as typeof withLibrary & {
      library: unknown
    }
  // Act
  const formats = [
    studyFormatOfConfiguration(withLibrary),
    studyFormatOfConfiguration(withoutLibrary),
  ]
  // Assert
  assert.deepEqual(formats, [16, 10])
})

// protects=a browser-only format 16 study follows the format 7 evidence rules; fails_when=evidenceFormatOfStudy returns 16 or 8 for it, which would let execution fields in or refuse its observations; no_claim=a server-stop configuration, which a Vite run refuses
test('a browser-only format 16 study follows the format 7 evidence rules', async () => {
  // Arrange
  const study = await libraryStudy(COMPLETE_FACTS)
  // Act
  const evidenceFormat = evidenceFormatOfStudy(study)
  // Assert
  assert.equal(evidenceFormat, 7)
})

// protects=a study saved through the real LearningLibrary reopens with its library facts and is listed as v16 stored in .study.v16.json beside its metadata, for a complete, an incomplete and an unreadable observation; fails_when=the facts are dropped or rewritten, the file name differs or the catalog lists another format; no_claim=a live run writes them (the run lane proves that)
for (const [name, facts] of [
  ['complete', COMPLETE_FACTS],
  [
    'incomplete',
    {
      ...COMPLETE_FACTS,
      observation: 'incomplete',
      loadCount: 3,
      cleanup: undefined,
    },
  ],
  [
    'unreadable',
    {
      ...COMPLETE_FACTS,
      observation: 'unreadable',
      loaded: undefined,
      loadCount: undefined,
      publishedCopyLoaded: undefined,
    },
  ],
] as const)
  test(`a format 16 study with a ${name} observation reopens with its library facts and is listed as v16`, async (context) => {
    // Arrange
    const directory = await mkdtemp(join(tmpdir(), 'codebook-format-16-'))
    context.after(() => removeTestFolder(directory))
    const study = await libraryStudy(JSON.parse(JSON.stringify(facts)))
    const library = new LearningLibrary(directory, study.workspaceKey)
    // Act
    await library.saveStudy(study)
    const reopened = await library.readStudy(study.id)
    const files = (await readdir(directory)).sort()
    const listed = (await library.list()).map((entry) => entry.format)
    // Assert
    assert.equal(reopened.version, 16)
    assert.deepEqual(reopened.library, JSON.parse(JSON.stringify(facts)))
    assert.deepEqual(files, [
      `${study.id}.study.meta.v16.json`,
      `${study.id}.study.v16.json`,
    ])
    assert.deepEqual(listed, ['v16'])
  })

// protects=a format 16 study whose library facts break the state rules, or whose format and facts disagree, is refused by the reader so it is listed as unreadable; fails_when=any of these decodes; no_claim=the wording of the refusals
test('refuses a format 16 study whose library facts break the state rules or disagree with the format', async () => {
  // Arrange
  const withoutBuildFacts = {
    package: '@acme/widgets',
    packageRoot: 'packages/widgets',
    prepared: false,
    observation: 'pending',
  }
  const attempts = await Promise.all([
    // A prepared library without its build facts.
    libraryStudy({ ...COMPLETE_FACTS, version: undefined }),
    // Build facts on a library that was never prepared.
    libraryStudy({ ...withoutBuildFacts, version: '2.14.0' }),
    // A complete observation without what was served.
    libraryStudy({ ...COMPLETE_FACTS, loaded: undefined }),
    // An unreadable observation that still claims a negative.
    libraryStudy({
      ...COMPLETE_FACTS,
      observation: 'unreadable',
      loaded: false,
    }),
    // A path to another copy although none was served.
    libraryStudy({ ...COMPLETE_FACTS, publishedCopyPath: '/x/node_modules/a' }),
    // A format 16 study without facts.
    libraryStudy(undefined),
    // Facts on a format 10 study.
    libraryStudy(COMPLETE_FACTS, 10),
    // Facts naming another library folder than the configuration declares.
    libraryStudy({ ...COMPLETE_FACTS, packageRoot: 'packages/other' }),
  ])
  const accepted = await libraryStudy(withoutBuildFacts)
  // Act
  const results = attempts.map(decodes)
  // Assert
  assert.deepEqual(results, [
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ])
  assert.equal(decodes(accepted), true)
})

// protects=before the package name is known `package` holds the declared folder, which may be up to the path limit, while a prepared library keeps the name limit; fails_when=an early-failure study with a long declared folder fails its own schema, or a prepared name longer than 214 is accepted; no_claim=none beyond protects
test('an unprepared library may name a declared folder up to 512 characters but a prepared package name stops at 214', async () => {
  // Arrange
  const folder = (length: number) => 'p'.repeat(length)
  const pending = (length: number) => ({
    package: folder(length),
    packageRoot: 'packages/widgets',
    prepared: false,
    observation: 'pending',
  })
  const attempts = await Promise.all([
    libraryStudy(pending(512)),
    libraryStudy(pending(513)),
    libraryStudy({ ...COMPLETE_FACTS, package: folder(214) }),
    libraryStudy({ ...COMPLETE_FACTS, package: folder(215) }),
  ])
  // Act
  const results = attempts.map(decodes)
  // Assert
  assert.deepEqual(results, [true, false, true, false])
})

// protects=a complete observation claims the correspondence only with a count: loaded is true exactly when loadCount is above zero, and the library must be prepared; fails_when=loaded true with count 0, loaded false with a count, or a complete observation on an unprepared library decodes; no_claim=none beyond protects
test('refuses a complete observation whose loaded flag disagrees with the load count or whose library is unprepared', async () => {
  // Arrange
  const attempts = await Promise.all([
    libraryStudy({ ...COMPLETE_FACTS, loaded: true, loadCount: 0 }),
    libraryStudy({ ...COMPLETE_FACTS, loaded: false, loadCount: 3 }),
    libraryStudy({
      package: 'packages/widgets',
      packageRoot: 'packages/widgets',
      prepared: false,
      observation: 'complete',
      loaded: false,
      loadCount: 0,
      publishedCopyLoaded: false,
    }),
    libraryStudy({ ...COMPLETE_FACTS, loaded: false, loadCount: 0 }),
  ])
  // Act
  const results = attempts.map(decodes)
  // Assert
  assert.deepEqual(results, [false, false, false, true])
})
