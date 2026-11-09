import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  READABLE_STUDY_VERSION,
  STATIC_PAGE_STUDY_VERSION,
  STUDY_STORAGE_FORMATS,
} from '../constants'
import { LearningLibrary } from '../learningLibrary'
import type { LibraryRunFacts } from '../libraryRunFactsSchema'
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
} from '../utils/studyFormatOfConfiguration'
import { validateRecordingContext } from '../utils/validateRecordingContext'

import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

const BROWSER_ONLY_V7_PATH = join(
  resolve(__dirname, '../../src/tests/fixtures'),
  'operations-study-v0.2.72.0/browser-only-v3.study.v7.json',
)

/** The address the page script of the saved stop was sealed at. */
const PAGE_SCRIPT_URL = 'http://127.0.0.1:4310/'

/** The facts of a library that was built, packed and completely observed. */
const COMPLETE_FACTS: LibraryRunFacts = {
  package: 'lib',
  packageRoot: 'packages/lib',
  prepared: true,
  version: '1.0.0',
  revision: '7114787aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  dirty: false,
  packageManager: { name: 'pnpm', version: '11.23.0' },
  buildMs: 7000,
  packMs: 900,
  tarballSha256: 'b'.repeat(64),
  installedVersion: '1.0.0',
  observation: 'complete',
  loaded: true,
  loadCount: 1,
  publishedCopyLoaded: false,
  cleanup: 'removed',
}

/**
 * Reseals the 0.2.72.0 browser-only study as a study of a `static-page` configuration whose one stop sits in the page's inline script.
 * @param version - The format number to give the study.
 * @param options - `adapter` replaces the adapter; `packageRoot` the page folder; `library` declares a library; `facts` adds the library facts; `press` declares a press operation.
 * @returns The resealed study, its configuration hash recomputed.
 * @example await pageStudy(23, { packageRoot: 'examples/page' }) // => { version: 23, … }
 */
async function pageStudy(
  version: number = STATIC_PAGE_STUDY_VERSION,
  options: {
    adapter?: string
    packageRoot?: string
    library?: boolean
    facts?: LibraryRunFacts
    press?: boolean
  } = {},
): Promise<ConfiguredStudy> {
  const study: ConfiguredStudy = JSON.parse(
    await readFile(BROWSER_ONLY_V7_PATH, 'utf8'),
  )
  const base = study.configuration
  const configuration = {
    ...base,
    adapter: options.adapter ?? 'static-page',
    ...(options.packageRoot === undefined
      ? {}
      : { packageRoot: options.packageRoot }),
    ...(options.library ? { library: { packageRoot: 'packages/lib' } } : {}),
    ...(options.press
      ? {
          operations: [
            {
              kind: 'press',
              title: 'Open',
              key: 'Control+k',
              after: [{ kind: 'visible', selector: '#palette' }],
            },
          ],
        }
      : {}),
  }
  return {
    ...study,
    version,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    observations: study.observations.map((observation) => ({
      ...observation,
      source: { ...observation.source, scriptUrl: PAGE_SCRIPT_URL },
    })),
    ...(options.facts === undefined ? {} : { library: options.facts }),
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

// Value: protects=AC 7 a static-page run is saved as format 23 stored in .study.v23.json beside its metadata, this Codebook reads 23 and refuses 24 as newer, and Codebook 0.2.106 (readable up to 22) lists a .study.v23.json archive as saved by a newer Codebook; fails_when=the storage table lacks v23, the readable limit stays 22, or the file name rule stops recognising v23; no_claim=disk errors
test('format 23 is stored and readable, 24 is saved by a newer Codebook and a reader limited to 22 lists v23 as newer', async () => {
  // Arrange
  const frozenConstants = { READABLE_STUDY_VERSION: 22 }
  const newerStudyArchive = await loadModule<typeof NewerStudyArchiveModule>(
    resolve(__dirname, '../utils/newerStudyArchive.js'),
    { '../constants': frozenConstants },
  )
  // Act
  const row = STUDY_STORAGE_FORMATS.find((entry) => entry.version === 23)
  const archive = newerStudyArchive.newerStudyArchive('a_b.study.v23.json')
  // Assert
  assert.equal(STATIC_PAGE_STUDY_VERSION, 23)
  assert.deepEqual(row, {
    version: 23,
    format: 'v23',
    archiveSuffix: '.study.v23.json',
    metadataSuffix: '.study.meta.v23.json',
  })
  assert.deepEqual({ ...archive }, { id: 'a_b', version: 23 })
  assert.equal(READABLE_STUDY_VERSION, 23)
  assert.equal(isOperationsStudyFormat(23), true)
  assert.equal(isOperationsStudyFormat(24), false)
  assert.doesNotThrow(() => assertReadableStudyFormat({ version: 23 }))
  assert.throws(
    () => assertReadableStudyFormat({ version: 24 }),
    /saved in format 24 by a newer Codebook; this Codebook reads formats up to 23/,
  )
})

// Value: protects=AC 7 every static-page configuration takes format 23, at the root, nested, with a library and with a press (which would otherwise take 21), while react-scripts keeps 11 and a Vite root run 7; fails_when=a static-page run falls back to another format or another adapter moves; no_claim=the formats of observations (Next only)
test('studyFormatOfConfiguration gives 23 to every static-page configuration and leaves other adapters alone', async () => {
  // Arrange
  const studies = await Promise.all([
    pageStudy(7),
    pageStudy(7, { packageRoot: '.' }),
    pageStudy(7, { packageRoot: 'examples/page' }),
    pageStudy(7, { packageRoot: 'examples/page', library: true }),
    pageStudy(7, { packageRoot: 'examples/page', press: true }),
    pageStudy(7, { adapter: 'react-scripts-dev', packageRoot: 'apps/app' }),
    pageStudy(7, { adapter: 'vite-dev' }),
  ])
  // Act
  const formats = studies.map((study) =>
    studyFormatOfConfiguration(study.configuration),
  )
  // Assert
  assert.deepEqual(formats, [23, 23, 23, 23, 23, 11, 7])
})

// Value: protects=AC 7 a static-page configuration is readable as format 23 only (formats 7 to 22 each refuse it, press formats included), and format 23 refuses the other adapters; fails_when=an older format decodes a static-page study or format 23 decodes another adapter's; no_claim=the schema member for each older format beyond its refusal
test('only format 23 holds a static-page configuration, and format 23 holds no other adapter', async () => {
  // Arrange
  const older = [7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 20, 21, 22]
  const pageStudies = await Promise.all(
    older.map((version) =>
      pageStudy(version, { packageRoot: 'examples/page' }),
    ),
  )
  const pressStudy = await pageStudy(21, {
    packageRoot: 'examples/page',
    press: true,
  })
  const others = await Promise.all([
    pageStudy(23, { adapter: 'vite-dev', packageRoot: 'apps/app' }),
    pageStudy(23, { adapter: 'react-scripts-dev' }),
    pageStudy(23, { adapter: 'next-dev-webpack' }),
  ])
  const own = await pageStudy(23, { packageRoot: 'examples/page' })
  // Act
  const olderResults = pageStudies.map(decodes)
  // Assert
  assert.deepEqual(
    olderResults,
    older.map(() => false),
  )
  assert.equal(decodes(pressStudy), false)
  assert.deepEqual(others.map(decodes), [false, false, false])
  assert.equal(decodes(own), true)
  assert.equal(
    isReadableStudyFormatOfConfiguration(23, own.configuration),
    true,
  )
  assert.equal(
    isReadableStudyFormatOfConfiguration(21, own.configuration),
    false,
  )
})

// Value: protects=AC 7 a static-page study follows the format 7 evidence rules derived from its configuration (browser-only stops); fails_when=evidenceFormatOfStudy returns 23 or 8 for a browser-only static-page study; no_claim=server stops (a static-page run refuses a server participant)
test('a static-page study follows the format 7 evidence rules', async () => {
  // Arrange
  const study = await pageStudy(23, { packageRoot: 'examples/page' })
  // Act
  const evidenceFormat = evidenceFormatOfStudy(study)
  // Assert
  assert.equal(evidenceFormat, 7)
})

// Value: protects=AC 7 the library facts belong to a static-page study exactly when its configuration declares library: facts without a declaration, a declaration without facts and facts naming another folder are each refused; fails_when=any of the three decodes; no_claim=the facts' content rules (formats 16 to 18 pin them)
test('a static-page study keeps library facts exactly when its configuration declares a library', async () => {
  // Arrange
  const declaredWithFacts = await pageStudy(23, {
    packageRoot: 'examples/page',
    library: true,
    facts: COMPLETE_FACTS,
  })
  const declaredWithoutFacts = await pageStudy(23, {
    packageRoot: 'examples/page',
    library: true,
  })
  const factsWithoutDeclaration = await pageStudy(23, {
    packageRoot: 'examples/page',
    facts: COMPLETE_FACTS,
  })
  const otherFolder = await pageStudy(23, {
    packageRoot: 'examples/page',
    library: true,
    facts: { ...COMPLETE_FACTS, packageRoot: 'packages/other' },
  })
  // Act
  const results = [
    declaredWithFacts,
    declaredWithoutFacts,
    factsWithoutDeclaration,
    otherFolder,
  ].map(decodes)
  // Assert
  assert.deepEqual(results, [true, false, false, false])
})

// Value: protects=AC 7 the saved study, not the live run, names and shows its page-script stop after a window reload: the reopened study is format 23 with the static-page configuration, its stop's source text and line, and the address the page script was sealed at, and its replay context validates; fails_when=the reopened study drops the adapter, the stop's source or the page script address, or the replay context is refused; no_claim=the replay UI (native check)
test('a static-page study reopened after a window reload names and shows its page-script stop', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-format-23-'))
  context.after(() => removeTestFolder(directory))
  const study = await pageStudy(23, { packageRoot: 'examples/page' })
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
  assert.equal(reopened.version, 23)
  assert.equal(reopened.configuration.version, 3)
  assert.equal(
    reopened.configuration.version === 3 && reopened.configuration.adapter,
    'static-page',
  )
  assert.deepEqual(
    reopened.observations.map((observation) => [
      observation.participant,
      observation.source.line,
      observation.source.text,
      observation.source.scriptUrl,
    ]),
    [['browser', 1, 'const nextTheme = "dark";\n', PAGE_SCRIPT_URL]],
  )
  assert.equal(recording.study.observations.length, 1)
  assert.deepEqual(files, [
    `${study.id}.study.meta.v23.json`,
    `${study.id}.study.v23.json`,
  ])
  assert.deepEqual(listed, ['v23'])
})
